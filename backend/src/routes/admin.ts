import { Router } from "express";
import prisma from "../prisma";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { adminAuth } from "../middleware/adminAuth";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { listAdminAuditQuerySchema } from "../schemas/admin";
import { recordAdminActionSafely, adminAuditMiddleware } from "../services/adminAuditLog";
import { sorobanEventListener } from "../services/sorobanEventListener";
import { subscriptionExecutor } from "../services/subscriptionExecutor";
import { networkReset } from "../services/networkReset";
import { log } from "../lib/logger";
import { toAmount } from "../lib/money";

const router = Router();

// All admin routes require a verified JWT (authMiddleware) AND an allowlisted
// wallet (adminAuth). This data exposes every user's wallet + earnings, so both
// gates always run first.
router.use(authMiddleware as any, adminAuth as any, adminAuditMiddleware);

// Earnings keyed by currency, e.g. { XLM: 1234.5, USDC: 50 }. XLM and USDC are
// not equal in value, so we never collapse them into one number.
type EarningsByCurrency = Record<string, number>;

router.get(
  "/overview",
  validate({ query: listAdminAuditQuerySchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };

    // Run the independent aggregates concurrently.
    const [totalSignups, totalCreators, totalByCurrency, perCreatorByCurrency, users, failingSubscriptions] =
      await Promise.all([
        prisma.user.count(),
        prisma.creator.count(),
        // Platform-wide earnings, grouped by currency.
        prisma.donation.groupBy({
          where: { verified: true },
          by: ["currency"],
          _sum: { amount: true },
        }),
        // Per-creator earnings, grouped by creator + currency. One flat query we
        // fold into a per-creator map below — avoids an N+1 loop over creators.
        prisma.donation.groupBy({
          where: { verified: true },
          by: ["creatorId", "currency"],
          _sum: { amount: true },
        }),
        // Every user, with their creator profile (if they've made one yet).
        prisma.user.findMany({
          orderBy: { createdAt: "desc" },
          include: { creator: true },
          skip: (page - 1) * limit,
          take: limit,
        }),
        // Surface long-failing subscriptions for admin visibility
        prisma.subscription.findMany({
          where: { failureCount: { gt: 0 } },
          include: { creator: true },
          orderBy: { failureCount: "desc" },
          take: 50,
        }),
      ]);

    const earningsByCurrency: EarningsByCurrency = {};
    for (const row of totalByCurrency) {
      earningsByCurrency[row.currency] = toAmount(row._sum.amount);
    }

    // creatorId -> { currency -> summed amount }
    const earningsByCreator = new Map<number, EarningsByCurrency>();
    for (const row of perCreatorByCurrency) {
      const bucket = earningsByCreator.get(row.creatorId) ?? {};
      bucket[row.currency] = toAmount(row._sum.amount);
      earningsByCreator.set(row.creatorId, bucket);
    }

    const userRows = users.map((u) => ({
      id: u.id,
      walletAddress: u.walletAddress,
      joinedAt: u.createdAt,
      username: u.creator?.username ?? null,
      displayName: u.creator?.displayName ?? null,
      earningsByCurrency: u.creator ? earningsByCreator.get(u.creator.id) ?? {} : {},
    }));

    // The dashboard is currently read-only, but viewing the privileged
    // earnings/user export is still an auditable admin action. Future
    // mutating handlers should call recordAdminAction in their transaction.
    await recordAdminActionSafely(req, {
      action: "admin.overview.viewed",
      targetType: "admin",
      targetId: "overview",
    });

    return res.json({
      totalSignups,
      totalCreators,
      earningsByCurrency,
      failingSubscriptions,
      users: userRows,
      pagination: {
        page,
        limit,
        total: totalSignups,
        totalPages: Math.ceil(totalSignups / limit),
      },
    });
  })
);

// Keep the audit feed read-only. The singular alias keeps the endpoint easy to
// discover for older clients while `/audit-logs` is the canonical name.
const listAuditLogs = asyncHandler(async (req: AuthRequest, res) => {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  const [items, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.adminAuditLog.count(),
  ]);

  return res.json({
    items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get(
  "/audit-logs",
  validate({ query: listAdminAuditQuerySchema }),
  listAuditLogs
);
router.get(
  "/audit-log",
  validate({ query: listAdminAuditQuerySchema }),
  listAuditLogs
);

// Operator recovery after a Stellar testnet reset (#278). Once the contracts
// have been redeployed and the env contract IDs updated (then the backend
// restarted, so the new env is in effect), this drops the stale event cursor,
// deactivates subscriptions that only existed on the old chain, clears the
// reset state/checkpoint, and resumes the background workers. See the runbook
// in docs/testnet-troubleshooting.md.
router.post(
  "/network-resync",
  asyncHandler(async (req: AuthRequest, res) => {
    sorobanEventListener.resetCursor();

    const deactivated = await prisma.subscription.updateMany({
      where: { active: true },
      data: {
        active: false,
        lastError:
          "Stellar network was reset — this subscription no longer exists on-chain. " +
          "Re-subscribe from the creator's page after the contracts are redeployed.",
      },
    });

    await networkReset.clearAfterResync();

    // Resume against the redeployed contracts. A worker that cannot start
    // (e.g. the env wasn't updated/restarted) is logged rather than failing the
    // resync, so the state is still cleared and the operator can retry.
    try {
      sorobanEventListener.start();
      subscriptionExecutor.start();
    } catch (error) {
      log("error", "Network resync could not restart background workers", {
        error: (error as Error).message,
      });
    }

    await recordAdminActionSafely(req, {
      action: "admin.network.resync",
      targetType: "network",
      targetId: "soroban",
      after: { deactivatedSubscriptions: deactivated.count },
    });

    return res.json({
      ok: true,
      deactivatedSubscriptions: deactivated.count,
    });
  })
);

export default router;
