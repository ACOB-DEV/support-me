jest.mock("../../prisma", () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), upsert: jest.fn() },
    creator: { findUnique: jest.fn() },
    magicLinkToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../services/email/mailer", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

import { createHash } from "crypto";
import prisma from "../../prisma";
import { sendEmail } from "../../services/email/mailer";
import { requestMagicLink, verifyMagicLink } from "../../services/magicLink";

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; upsert: jest.Mock };
  creator: { findUnique: jest.Mock };
  magicLinkToken: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  $transaction: jest.Mock;
};
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.$transaction.mockImplementation((callback: (client: typeof mockedPrisma) => unknown) =>
    callback(mockedPrisma)
  );
});

describe("requestMagicLink (#15)", () => {
  it("emails a signed link for an email with no existing account", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.magicLinkToken.create.mockResolvedValue({});

    await requestMagicLink("New@Example.com");

    expect(mockedPrisma.magicLinkToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "new@example.com", userId: undefined }),
      })
    );
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "new@example.com", subject: expect.stringContaining("Sign in") })
    );
  });

  it("links the token to an existing account when the email already has one", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: 5, email: "existing@example.com" });
    mockedPrisma.magicLinkToken.create.mockResolvedValue({});

    await requestMagicLink("existing@example.com");

    expect(mockedPrisma.magicLinkToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 5 }) })
    );
  });

  it("stores only a hash of the token, never the raw token", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.magicLinkToken.create.mockResolvedValue({});

    await requestMagicLink("a@example.com");

    const storedData = mockedPrisma.magicLinkToken.create.mock.calls[0][0].data;
    expect(storedData.tokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex digest
    const emailedUrl = mockedSendEmail.mock.calls[0][0].text;
    expect(emailedUrl).not.toContain(storedData.tokenHash);
  });

  it("normalizes email casing/whitespace before storing", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.magicLinkToken.create.mockResolvedValue({});

    await requestMagicLink("  Mixed@Case.COM  ");

    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "mixed@case.com" } });
  });

});

describe("verifyMagicLink (#15)", () => {
  const RAW_TOKEN = "test-token-value";
  const TOKEN_HASH = createHash("sha256").update(RAW_TOKEN).digest("hex");

  it("rejects an empty token", async () => {
    await expect(verifyMagicLink("")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a token that does not match any stored hash", async () => {
    mockedPrisma.magicLinkToken.findUnique.mockResolvedValue(null);

    await expect(verifyMagicLink("wrong-token")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects an already-used token", async () => {
    mockedPrisma.magicLinkToken.findUnique.mockResolvedValue({
      tokenHash: TOKEN_HASH,
      email: "a@example.com",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(verifyMagicLink(RAW_TOKEN)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects an expired token", async () => {
    mockedPrisma.magicLinkToken.findUnique.mockResolvedValue({
      tokenHash: TOKEN_HASH,
      email: "a@example.com",
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(verifyMagicLink(RAW_TOKEN)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("creates a new account and issues a session for a first-time verification", async () => {
    const record = {
      tokenHash: TOKEN_HASH,
      email: "new@example.com",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    mockedPrisma.magicLinkToken.findUnique.mockResolvedValue(record);
    mockedPrisma.magicLinkToken.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.user.upsert.mockResolvedValue({
      id: 9,
      email: "new@example.com",
      walletAddress: null,
    });
    mockedPrisma.magicLinkToken.update.mockResolvedValue({});
    mockedPrisma.creator.findUnique.mockResolvedValue(null);

    const session = await verifyMagicLink(RAW_TOKEN);

    expect(mockedPrisma.user.upsert).toHaveBeenCalledWith({
      where: { email: "new@example.com" },
      update: {},
      create: { email: "new@example.com" },
    });
    expect(session.user).toEqual({ id: 9, email: "new@example.com", walletAddress: null });
    expect(session.hasProfile).toBe(false);
    expect(typeof session.token).toBe("string");
  });

  it("starts a fresh account rather than reviving one deleted after the link was requested (#270)", async () => {
    // The account that requested this link was soft-deleted (email cleared
    // to null) before the link was verified. `record.email` is the address
    // captured on MagicLinkToken at request time, which no User row's
    // email column matches anymore, so the upsert below creates a new
    // account instead of resurrecting the deleted one.
    const record = {
      tokenHash: TOKEN_HASH,
      email: "was-deleted@example.com",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    mockedPrisma.magicLinkToken.findUnique.mockResolvedValue(record);
    mockedPrisma.magicLinkToken.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.user.upsert.mockResolvedValue({
      id: 55,
      email: "was-deleted@example.com",
      walletAddress: null,
    });
    mockedPrisma.magicLinkToken.update.mockResolvedValue({});
    mockedPrisma.creator.findUnique.mockResolvedValue(null);

    const session = await verifyMagicLink(RAW_TOKEN);

    expect(mockedPrisma.user.upsert).toHaveBeenCalledWith({
      where: { email: "was-deleted@example.com" },
      update: {},
      create: { email: "was-deleted@example.com" },
    });
    expect(session.user.id).toBe(55);
  });

  it("attaches a returning account and reports its existing profile", async () => {
    const record = {
      tokenHash: TOKEN_HASH,
      email: "existing@example.com",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    mockedPrisma.magicLinkToken.findUnique.mockResolvedValue(record);
    mockedPrisma.magicLinkToken.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.user.upsert.mockResolvedValue({
      id: 3,
      email: "existing@example.com",
      walletAddress: "GABC",
    });
    mockedPrisma.magicLinkToken.update.mockResolvedValue({});
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 1, username: "bob" });

    const session = await verifyMagicLink(RAW_TOKEN);

    expect(session.hasProfile).toBe(true);
    expect(session.username).toBe("bob");
    expect(session.user.walletAddress).toBe("GABC");
  });

  it("marks the token used within the same transaction as the account upsert, via a conditional updateMany", async () => {
    const record = {
      tokenHash: TOKEN_HASH,
      email: "a@example.com",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    mockedPrisma.magicLinkToken.findUnique.mockResolvedValue(record);
    mockedPrisma.magicLinkToken.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.user.upsert.mockResolvedValue({ id: 1, email: "a@example.com", walletAddress: null });
    mockedPrisma.magicLinkToken.update.mockResolvedValue({});
    mockedPrisma.creator.findUnique.mockResolvedValue(null);

    await verifyMagicLink(RAW_TOKEN);

    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.magicLinkToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: TOKEN_HASH, usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });
    expect(mockedPrisma.magicLinkToken.update).toHaveBeenCalledWith({
      where: { tokenHash: TOKEN_HASH },
      data: { userId: 1 },
    });
  });

  it("rejects a concurrent double-submit of the same token: the conditional updateMany matches zero rows for the loser", async () => {
    const record = {
      tokenHash: TOKEN_HASH,
      email: "a@example.com",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    mockedPrisma.magicLinkToken.findUnique.mockResolvedValue(record); // the initial pre-transaction check still sees it as unused
    // Inside the transaction, a racing request already consumed the token first:
    // the conditional updateMany's WHERE (usedAt: null) matches nothing.
    mockedPrisma.magicLinkToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(verifyMagicLink(RAW_TOKEN)).rejects.toMatchObject({ statusCode: 401 });
    expect(mockedPrisma.user.upsert).not.toHaveBeenCalled();
  });

  it("the same token verified twice concurrently produces exactly one success (#269)", async () => {
    // Models Postgres' row-level locking for the conditional updateMany:
    // the field is shared state, so only the first of two concurrent calls
    // sees `usedAt: null` and flips it; the second's WHERE clause then
    // matches zero rows, exactly as it would against a real database.
    let usedAt: Date | null = null;
    const record = {
      tokenHash: TOKEN_HASH,
      email: "a@example.com",
      get usedAt() {
        return usedAt;
      },
      expiresAt: new Date(Date.now() + 60_000),
    };
    mockedPrisma.magicLinkToken.findUnique.mockImplementation(() => Promise.resolve(record));
    mockedPrisma.magicLinkToken.updateMany.mockImplementation(() => {
      if (usedAt !== null) return Promise.resolve({ count: 0 });
      usedAt = new Date();
      return Promise.resolve({ count: 1 });
    });
    mockedPrisma.user.upsert.mockResolvedValue({ id: 1, email: "a@example.com", walletAddress: null });
    mockedPrisma.magicLinkToken.update.mockResolvedValue({});
    mockedPrisma.creator.findUnique.mockResolvedValue(null);

    const results = await Promise.allSettled([verifyMagicLink(RAW_TOKEN), verifyMagicLink(RAW_TOKEN)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ statusCode: 401 });
    expect(mockedPrisma.user.upsert).toHaveBeenCalledTimes(1);
  });
});
