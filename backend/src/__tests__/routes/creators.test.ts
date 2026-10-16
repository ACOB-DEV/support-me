jest.mock("../../prisma", () => ({
  __esModule: true,
  default: {
    creator: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    donation: {
      groupBy: jest.fn(),
    },
  },
}));

import request from "supertest";
import { Prisma } from "@prisma/client";
import app from "../../app";
import prisma from "../../prisma";
import { generateToken } from "../../middleware/auth";
import { leaderboardCache } from "../../routes/creators";

const mockedPrisma = prisma as unknown as {
  creator: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  donation: {
    groupBy: jest.Mock;
  };
};

describe("GET /api/creators", () => {
  it("lists creators, newest first by default", async () => {
    const creators = [{ id: 1, username: "bob", _count: { donations: 0 } }];
    mockedPrisma.creator.findMany.mockResolvedValue(creators);
    mockedPrisma.creator.count.mockResolvedValue(1);

    const res = await request(app).get("/api/creators");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: creators,
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(mockedPrisma.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" }, where: undefined })
    );
  });

  it("searches by username/displayName and sorts by donation count", async () => {
    mockedPrisma.creator.findMany.mockResolvedValue([]);
    mockedPrisma.creator.count.mockResolvedValue(0);

    const res = await request(app).get("/api/creators?q=jane&sort=most-supported");

    expect(res.status).toBe(200);
    expect(mockedPrisma.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { donations: { _count: "desc" } },
        where: {
          OR: [
            { username: { contains: "jane", mode: "insensitive" } },
            { displayName: { contains: "jane", mode: "insensitive" } },
          ],
        },
      })
    );
  });
});

describe("GET /api/creators/me", () => {
  const token = generateToken(1, "GUSERADDRESS");

  it("rejects requests without an auth token", async () => {
    const res = await request(app).get("/api/creators/me");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the authenticated user has no creator profile", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue(null);

    const res = await request(app).get("/api/creators/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns only the authenticated user's own creator profile", async () => {
    const creator = { id: 5, userId: 1, username: "bob" };
    mockedPrisma.creator.findUnique.mockResolvedValue(creator);

    const res = await request(app).get("/api/creators/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(creator);
    expect(mockedPrisma.creator.findUnique).toHaveBeenCalledWith({ where: { userId: 1 } });
  });
});

describe("GET /api/creators/:username", () => {
  it("returns the creator when found", async () => {
    const creator = { id: 1, username: "bob", donations: [] };
    mockedPrisma.creator.findUnique.mockResolvedValue(creator);

    const res = await request(app).get("/api/creators/bob");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(creator);
  });

  // Issue #120: the donate page needs a creator's custom preset amounts
  // (when set) to render quick-select buttons. Uses a username no other
  // test in this file touches — creatorProfileCache caches by username, so
  // reusing "bob" here would return another test's cached (unrelated) entry.
  it("includes the creator's custom preset amounts in the public profile", async () => {
    const creator = { id: 42, username: "presetcarol", presetAmounts: [2, 5, 20] };
    mockedPrisma.creator.findUnique.mockResolvedValue(creator);

    const res = await request(app).get("/api/creators/presetcarol");

    expect(res.status).toBe(200);
    expect(res.body.presetAmounts).toEqual([2, 5, 20]);
  });

  it("returns 404 when the creator does not exist", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue(null);

    const res = await request(app).get("/api/creators/missing");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

describe("POST /api/creators/:username/create", () => {
  const token = generateToken(1, "GUSERADDRESS");

  it("rejects requests without an auth token", async () => {
    const res = await request(app).post("/api/creators/bob/create").send({});
    expect(res.status).toBe(401);
  });

  it("rejects an invalid username shape before hitting the database", async () => {
    const res = await request(app)
      .post("/api/creators/a/create")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 when the username is already taken", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValueOnce({ id: 2, username: "bob" });

    const res = await request(app)
      .post("/api/creators/bob/create")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("returns 409 when the authenticated user already has a profile", async () => {
    mockedPrisma.creator.findUnique
      .mockResolvedValueOnce(null) // username lookup
      .mockResolvedValueOnce({ id: 3, username: "existing-profile" }); // userId lookup

    const res = await request(app)
      .post("/api/creators/bob/create")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
  });

  it("creates a creator profile for a new, authenticated user", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const created = {
      id: 4,
      userId: 1,
      username: "bob",
      walletAddress:
        "GA7D5LDGFABXNYEO6LZVMTWK5JWEPTODCLYZ7TG4XDZRKKXP6OS5K5JW",
    };
    mockedPrisma.creator.create.mockResolvedValue(created);

    const res = await request(app)
      .post("/api/creators/bob/create")
      .set("Authorization", `Bearer ${token}`)
      .send({
        walletAddress:
          "GA7D5LDGFABXNYEO6LZVMTWK5JWEPTODCLYZ7TG4XDZRKKXP6OS5K5JW",
        displayName: "Bob",
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
  });
});

describe("PUT /api/creators/:username", () => {
  const token = generateToken(1, "GUSERADDRESS");

  it("rejects requests without an auth token", async () => {
    const res = await request(app).put("/api/creators/bob").send({ bio: "hi" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when updating a creator that does not exist", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put("/api/creators/missing")
      .set("Authorization", `Bearer ${token}`)
      .send({ bio: "hi" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("rejects editing a profile the authenticated user does not own", async () => {
    // Token is for userId 1; this profile belongs to userId 2.
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 9, userId: 2, username: "bob" });

    const res = await request(app)
      .put("/api/creators/bob")
      .set("Authorization", `Bearer ${token}`)
      .send({ bio: "hijack" });

    expect(res.status).toBe(401);
    expect(mockedPrisma.creator.update).not.toHaveBeenCalled();
  });

  it("updates a creator the authenticated user owns", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 1, userId: 1, username: "bob" });
    const updated = { id: 1, userId: 1, username: "bob", bio: "hi there" };
    mockedPrisma.creator.update.mockResolvedValue(updated);

    const res = await request(app)
      .put("/api/creators/bob")
      .set("Authorization", `Bearer ${token}`)
      .send({ bio: "hi there" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
    expect(mockedPrisma.creator.update).toHaveBeenCalledWith({
      where: { username: "bob" },
      data: { bio: "hi there" },
    });
  });

  // Issue #18: a creator opts into accepting USDT the same way they already
  // do for XLM/USDC.
  it("allows the owner to opt into accepting USDT", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 1, userId: 1, username: "bob" });
    const updated = { id: 1, userId: 1, username: "bob", acceptsUsdt: true };
    mockedPrisma.creator.update.mockResolvedValue(updated);

    const res = await request(app)
      .put("/api/creators/bob")
      .set("Authorization", `Bearer ${token}`)
      .send({ acceptsUsdt: true });

    expect(res.status).toBe(200);
    expect(mockedPrisma.creator.update).toHaveBeenCalledWith({
      where: { username: "bob" },
      data: { acceptsUsdt: true },
    });
  });

  // Issue #120: a creator can optionally customize the quick-select preset
  // amounts shown on their donate page.
  it("allows the owner to set custom preset donation amounts", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 1, userId: 1, username: "bob" });
    const updated = { id: 1, userId: 1, username: "bob", presetAmounts: [1, 5, 10, 25] };
    mockedPrisma.creator.update.mockResolvedValue(updated);

    const res = await request(app)
      .put("/api/creators/bob")
      .set("Authorization", `Bearer ${token}`)
      .send({ presetAmounts: [1, 5, 10, 25] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
    expect(mockedPrisma.creator.update).toHaveBeenCalledWith({
      where: { username: "bob" },
      data: { presetAmounts: [1, 5, 10, 25] },
    });
  });

  it("allows clearing preset amounts back to the frontend defaults", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 1, userId: 1, username: "bob" });
    const updated = { id: 1, userId: 1, username: "bob", presetAmounts: [] };
    mockedPrisma.creator.update.mockResolvedValue(updated);

    const res = await request(app)
      .put("/api/creators/bob")
      .set("Authorization", `Bearer ${token}`)
      .send({ presetAmounts: [] });

    expect(res.status).toBe(200);
    expect(mockedPrisma.creator.update).toHaveBeenCalledWith({
      where: { username: "bob" },
      data: { presetAmounts: [] },
    });
  });

  it("rejects preset amounts containing a non-positive number", async () => {
    const res = await request(app)
      .put("/api/creators/bob")
      .set("Authorization", `Bearer ${token}`)
      .send({ presetAmounts: [1, 0, 10] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(mockedPrisma.creator.update).not.toHaveBeenCalled();
  });

  it("rejects more than 6 preset amounts", async () => {
    const res = await request(app)
      .put("/api/creators/bob")
      .set("Authorization", `Bearer ${token}`)
      .send({ presetAmounts: [1, 2, 3, 4, 5, 6, 7] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(mockedPrisma.creator.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/creators/:username/theme (#227)", () => {
  const token = generateToken(1, "GUSERADDRESS");
  const theme = { backgroundColor: "#fdfcf7", accentColor: "#7c3aed", font: "serif", layout: "compact" };

  const patchTheme = (body: object) =>
    request(app).patch("/api/creators/bob/theme").set("Authorization", `Bearer ${token}`).send(body);

  it("rejects requests without an auth token", async () => {
    const res = await request(app).patch("/api/creators/bob/theme").send({ theme });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the creator does not exist", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue(null);

    const res = await patchTheme({ theme });

    expect(res.status).toBe(404);
  });

  it("rejects editing another creator's theme", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 9, userId: 2, username: "bob" });

    const res = await patchTheme({ theme });

    expect(res.status).toBe(401);
    expect(mockedPrisma.creator.update).not.toHaveBeenCalled();
  });

  it("saves a valid theme for the owner", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 1, userId: 1, username: "bob" });
    mockedPrisma.creator.update.mockResolvedValue({ id: 1, username: "bob", theme });

    const res = await patchTheme({ theme });

    expect(res.status).toBe(200);
    expect(res.body.theme).toEqual(theme);
    expect(mockedPrisma.creator.update).toHaveBeenCalledWith({ where: { username: "bob" }, data: { theme } });
  });

  it("resets to the default design when theme is null", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 1, userId: 1, username: "bob" });
    mockedPrisma.creator.update.mockResolvedValue({ id: 1, username: "bob", theme: null });

    const res = await patchTheme({ theme: null });

    expect(res.status).toBe(200);
    expect(mockedPrisma.creator.update).toHaveBeenCalledWith({
      where: { username: "bob" },
      data: { theme: Prisma.DbNull },
    });
  });

  it.each([
    ["a malformed color", { ...theme, accentColor: "purple" }],
    ["a font outside the curated list", { ...theme, font: "comic-sans" }],
    ["an unknown layout", { ...theme, layout: "grid" }],
    ["a background too mid-toned for either text color (WCAG AA)", { ...theme, backgroundColor: "#777777" }],
    ["an accent too light for white button text (WCAG AA)", { ...theme, accentColor: "#ffd84d" }],
  ])("rejects %s", async (_label, invalidTheme) => {
    const res = await patchTheme({ theme: invalidTheme });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(mockedPrisma.creator.update).not.toHaveBeenCalled();
  });
});

describe("GET /api/creators/leaderboard (#16)", () => {
  beforeEach(() => {
    // Each test uses its own type/currency combo except the caching test,
    // which deliberately keys on a currency ("EURC") no other test in this
    // file touches — but clearing between tests keeps that independence
    // explicit instead of implicit.
    leaderboardCache.clear();
  });

  it("returns exact totals from Decimal sums (0.1 + 0.2 must be 0.3, not 0.30000000000000004)", async () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the float behaviour this guards against
    mockedPrisma.donation.groupBy.mockResolvedValue([
      { creatorId: 1, _sum: { amount: new Prisma.Decimal("0.1").plus("0.2") }, _count: { _all: 2 } },
    ]);
    mockedPrisma.creator.findMany.mockResolvedValue([
      { id: 1, username: "alice", displayName: "Alice", avatarUrl: null },
    ]);

    const res = await request(app).get("/api/creators/leaderboard?currency=DEC");

    expect(res.status).toBe(200);
    expect(res.body.items[0].total).toBe(0.3);
  });

  it("ranks top creators by total received, defaulting to XLM", async () => {
    mockedPrisma.donation.groupBy.mockResolvedValue([
      { creatorId: 1, _sum: { amount: 500 }, _count: { _all: 10 } },
      { creatorId: 2, _sum: { amount: 200 }, _count: { _all: 3 } },
    ]);
    mockedPrisma.creator.findMany.mockResolvedValue([
      { id: 1, username: "alice", displayName: "Alice", avatarUrl: null },
      { id: 2, username: "bob", displayName: null, avatarUrl: null },
    ]);

    const res = await request(app).get("/api/creators/leaderboard");

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("XLM");
    expect(res.body.items).toEqual([
      {
        rank: 1,
        total: 500,
        donationCount: 10,
        creator: { id: 1, username: "alice", displayName: "Alice", avatarUrl: null },
      },
      {
        rank: 2,
        total: 200,
        donationCount: 3,
        creator: { id: 2, username: "bob", displayName: null, avatarUrl: null },
      },
    ]);
    expect(mockedPrisma.donation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["creatorId"],
        where: { currency: "XLM" },
        orderBy: { _sum: { amount: "desc" } },
      })
    );
  });

  it("ranks top supporters by total given when type=supporters", async () => {
    mockedPrisma.donation.groupBy.mockResolvedValue([
      { senderAddress: "GADDRESS1", _sum: { amount: 100 }, _count: { _all: 2 } },
    ]);

    const res = await request(app).get("/api/creators/leaderboard?type=supporters");

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { rank: 1, total: 100, donationCount: 2, senderAddress: "GADDRESS1" },
    ]);
    expect(mockedPrisma.donation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ["senderAddress"], where: { currency: "XLM" } })
    );
    // Supporters are ranked by wallet address, not matched to a creator record.
    expect(mockedPrisma.creator.findMany).not.toHaveBeenCalled();
  });

  it("ranks a non-default currency independently, never mixing totals across currencies", async () => {
    mockedPrisma.donation.groupBy.mockResolvedValue([
      { creatorId: 1, _sum: { amount: 42 }, _count: { _all: 1 } },
    ]);
    mockedPrisma.creator.findMany.mockResolvedValue([
      { id: 1, username: "alice", displayName: null, avatarUrl: null },
    ]);

    const res = await request(app).get("/api/creators/leaderboard?currency=USDC");

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("USDC");
    expect(mockedPrisma.donation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { currency: "USDC" } })
    );
  });

  it("paginates the ranked results", async () => {
    mockedPrisma.donation.groupBy.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        creatorId: i + 1,
        _sum: { amount: 100 - i },
        _count: { _all: 1 },
      }))
    );
    mockedPrisma.creator.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        username: `creator${i + 1}`,
        displayName: null,
        avatarUrl: null,
      }))
    );

    const res = await request(app).get("/api/creators/leaderboard?page=2&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].rank).toBe(3);
    expect(res.body.pagination).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 });
  });

  it("excludes a creator from the ranking if their record no longer exists (defensive against a deleted creator)", async () => {
    mockedPrisma.donation.groupBy.mockResolvedValue([
      { creatorId: 1, _sum: { amount: 50 }, _count: { _all: 1 } },
      { creatorId: 999, _sum: { amount: 999 }, _count: { _all: 1 } },
    ]);
    mockedPrisma.creator.findMany.mockResolvedValue([
      { id: 1, username: "alice", displayName: null, avatarUrl: null },
    ]);

    const res = await request(app).get("/api/creators/leaderboard");

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].creator.id).toBe(1);
  });

  it("rejects an invalid leaderboard type", async () => {
    const res = await request(app).get("/api/creators/leaderboard?type=nonsense");
    expect(res.status).toBe(400);
  });

  it("serves a second request for the same type/currency from cache without querying again", async () => {
    mockedPrisma.donation.groupBy.mockResolvedValue([
      { creatorId: 1, _sum: { amount: 10 }, _count: { _all: 1 } },
    ]);
    mockedPrisma.creator.findMany.mockResolvedValue([
      { id: 1, username: "alice", displayName: null, avatarUrl: null },
    ]);

    await request(app).get("/api/creators/leaderboard?currency=EURC");
    mockedPrisma.donation.groupBy.mockClear();
    const res = await request(app).get("/api/creators/leaderboard?currency=EURC");

    expect(res.status).toBe(200);
    expect(mockedPrisma.donation.groupBy).not.toHaveBeenCalled();
  });
});

describe("GET /api/creators/me/stats (#224)", () => {
  const token = generateToken(1, "GUSERADDRESS");

  it("rejects requests without an auth token", async () => {
    const res = await request(app).get("/api/creators/me/stats");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the authenticated user has no creator profile", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/creators/me/stats")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("aggregates only the creator's verified donations", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 5, userId: 1, username: "bob" });
    mockedPrisma.donation.groupBy
      .mockResolvedValueOnce([
        {
          currency: "XLM",
          _count: { _all: 2 },
          _sum: { amount: new Prisma.Decimal("30") },
          _avg: { amount: new Prisma.Decimal("15") },
          _max: { amount: new Prisma.Decimal("25") },
        },
      ])
      .mockResolvedValueOnce([
        { currency: "XLM", senderAddress: "GA" },
        { currency: "XLM", senderAddress: "GB" },
      ]);

    const res = await request(app)
      .get("/api/creators/me/stats")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      donationCount: 2,
      uniqueSupporters: 2,
      currencies: [
        {
          currency: "XLM",
          total: 30,
          donationCount: 2,
          uniqueSupporters: 2,
          average: 15,
          largest: 25,
        },
      ],
    });
    for (const call of mockedPrisma.donation.groupBy.mock.calls) {
      expect(call[0].where).toEqual({ creatorId: 5, verified: true });
    }
  });
});
