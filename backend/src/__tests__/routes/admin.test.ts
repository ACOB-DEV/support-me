jest.mock("../../prisma", () => ({
  __esModule: true,
  default: {
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    creator: {
      count: jest.fn(),
    },
    donation: {
      groupBy: jest.fn(),
    },
    subscription: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    adminAuditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

import request from "supertest";
import app from "../../app";
import prisma from "../../prisma";
import { generateToken } from "../../middleware/auth";

const mockedPrisma = prisma as unknown as {
  user: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
  creator: { count: jest.Mock };
  donation: { groupBy: jest.Mock };
  subscription: { count: jest.Mock; findMany: jest.Mock };
  adminAuditLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
};

const ADMIN_WALLET = "GADMINWALLET";
const NON_ADMIN_WALLET = "GRANDOMWALLET";

describe("GET /api/admin/overview", () => {
  const originalAdminWallets = process.env.ADMIN_WALLETS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_WALLETS = ADMIN_WALLET;
    mockedPrisma.user.findUnique.mockResolvedValue({ deletedAt: null });
    mockedPrisma.adminAuditLog.create.mockResolvedValue({ id: 1 });
    mockedPrisma.adminAuditLog.findMany.mockResolvedValue([]);
    mockedPrisma.adminAuditLog.count.mockResolvedValue(0);
    mockedPrisma.subscription.count.mockResolvedValue(0);
    mockedPrisma.subscription.findMany.mockResolvedValue([]);
  });

  afterAll(() => {
    process.env.ADMIN_WALLETS = originalAdminWallets;
  });

  it("rejects requests without an auth token", async () => {
    const res = await request(app).get("/api/admin/overview");
    expect(res.status).toBe(401);
  });

  it("rejects a valid token whose wallet is not allowlisted", async () => {
    const token = generateToken(2, NON_ADMIN_WALLET);
    const res = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Admin access required");
  });

  it("denies everyone when ADMIN_WALLETS is unset (fail-closed)", async () => {
    delete process.env.ADMIN_WALLETS;
    const token = generateToken(1, ADMIN_WALLET);
    const res = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it("returns aggregated overview data for an allowlisted admin", async () => {
    mockedPrisma.user.count.mockResolvedValue(3);
    mockedPrisma.creator.count.mockResolvedValue(2);
    mockedPrisma.donation.groupBy
      // totalByCurrency
      .mockResolvedValueOnce([
        { currency: "XLM", _sum: { amount: 150 } },
        { currency: "USDC", _sum: { amount: 40 } },
      ])
      // perCreatorByCurrency
      .mockResolvedValueOnce([
        { creatorId: 7, currency: "XLM", _sum: { amount: 100 } },
        { creatorId: 7, currency: "USDC", _sum: { amount: 40 } },
        { creatorId: 8, currency: "XLM", _sum: { amount: 50 } },
      ]);
    mockedPrisma.user.findMany.mockResolvedValue([
      {
        id: 1,
        walletAddress: "GUSER1",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        creator: { id: 7, username: "alice", displayName: "Alice" },
      },
      {
        id: 2,
        walletAddress: "GUSER2",
        createdAt: new Date("2026-06-01T00:00:00Z"),
        creator: { id: 8, username: "bob", displayName: null },
      },
      {
        id: 3,
        walletAddress: "GUSER3",
        createdAt: new Date("2026-05-01T00:00:00Z"),
        creator: null,
      },
    ]);

    const token = generateToken(1, ADMIN_WALLET);
    const res = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalSignups).toBe(3);
    expect(res.body.totalCreators).toBe(2);
    expect(res.body.earningsByCurrency).toEqual({ XLM: 150, USDC: 40 });

    expect(res.body.users).toHaveLength(3);
    // Creator with two currencies gets both folded into their bucket.
    expect(res.body.users[0]).toMatchObject({
      walletAddress: "GUSER1",
      username: "alice",
      displayName: "Alice",
      earningsByCurrency: { XLM: 100, USDC: 40 },
    });
    // Creator with a single currency.
    expect(res.body.users[1].earningsByCurrency).toEqual({ XLM: 50 });
    // User with no creator profile has no earnings.
    expect(res.body.users[2]).toMatchObject({
      username: null,
      displayName: null,
      earningsByCurrency: {},
    });
    
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
      })
    );

    expect(mockedPrisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 1,
        adminWalletAddress: ADMIN_WALLET,
        action: "admin.overview.viewed",
        targetType: "admin",
        targetId: "overview",
      }),
    });
  });

  it("returns a paginated user list with custom page and limit", async () => {
    mockedPrisma.user.count.mockResolvedValue(50);
    mockedPrisma.creator.count.mockResolvedValue(10);
    // group bys return empty arrays for simplicity here
    mockedPrisma.donation.groupBy.mockResolvedValue([]);
    mockedPrisma.user.findMany.mockResolvedValue([]);

    const token = generateToken(1, ADMIN_WALLET);
    const res = await request(app)
      .get("/api/admin/overview?page=2&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 2, limit: 10, total: 50, totalPages: 5 });
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
      })
    );
  });
});

describe("GET /api/admin/audit-logs", () => {
  const originalAdminWallets = process.env.ADMIN_WALLETS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_WALLETS = ADMIN_WALLET;
    mockedPrisma.user.findUnique.mockResolvedValue({ deletedAt: null });
    mockedPrisma.adminAuditLog.findMany.mockResolvedValue([
      { id: 9, adminWalletAddress: ADMIN_WALLET, action: "admin.overview.viewed" },
    ]);
    mockedPrisma.adminAuditLog.count.mockResolvedValue(21);
  });

  afterAll(() => {
    if (originalAdminWallets === undefined) delete process.env.ADMIN_WALLETS;
    else process.env.ADMIN_WALLETS = originalAdminWallets;
  });

  it("returns a paginated, newest-first audit feed to an allowlisted admin", async () => {
    const token = generateToken(1, ADMIN_WALLET);
    const res = await request(app)
      .get("/api/admin/audit-logs?page=2&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 2, limit: 10, total: 21, totalPages: 3 });
    expect(mockedPrisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 10,
      take: 10,
    });
  });

  it("rejects invalid audit-log pagination", async () => {
    const token = generateToken(1, ADMIN_WALLET);
    const res = await request(app)
      .get("/api/admin/audit-logs?limit=101")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(mockedPrisma.adminAuditLog.findMany).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated audit-log reads", async () => {
    const res = await request(app).get("/api/admin/audit-logs");
    expect(res.status).toBe(401);
    expect(mockedPrisma.adminAuditLog.findMany).not.toHaveBeenCalled();
  });
});
