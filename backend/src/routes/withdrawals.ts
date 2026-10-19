import { Router } from "express";
import prisma from "../prisma";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { createWithdrawalSchema, listWithdrawalsQuerySchema } from "../schemas/withdrawals";
import { NotFoundError, UnauthorizedError } from "../errors/AppError";

const router = Router();

router.get(
  "/",
  authMiddleware,
  validate({ query: listWithdrawalsQuerySchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const { creatorUsername } = req.query as { creatorUsername?: string };

    if (!req.user) {
      throw new UnauthorizedError("User not authenticated");
    }

    const withdrawals = await prisma.withdrawal.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        creator: {
          userId: req.user.id,
          ...(creatorUsername ? { username: creatorUsername } : {}),
        },
      },
    });

    return res.json(withdrawals);
  })
);

router.post(
  "/",
  authMiddleware,
  validate({ body: createWithdrawalSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const { creatorUsername, amountIn, amountOut, fee, currency, anchorTxId, stellarTxId, status } =
      req.body;

    if (!req.user) {
      throw new UnauthorizedError("User not authenticated");
    }

    const creator = await prisma.creator.findUnique({ where: { username: creatorUsername } });
    if (!creator) {
      throw new NotFoundError("Creator not found");
    }

    // Withdrawals are self-reported by the account holder after a cash-out, so
    // only the owner may record one against their own history.
    if (creator.userId !== req.user.id) {
      throw new UnauthorizedError("You can only record withdrawals for your own profile");
    }

    // Idempotent on the anchor transaction id: the completion path can fire more
    // than once, but a given cash-out should appear exactly once in the feed.
    const existing = await prisma.withdrawal.findUnique({
      where: { creatorId_anchorTxId: { creatorId: creator.id, anchorTxId } },
    });
    if (existing) {
      return res.status(200).json(existing);
    }

    const withdrawal = await prisma.withdrawal.create({
      data: {
        creatorId: creator.id,
        amountIn,
        amountOut,
        fee,
        currency,
        anchorTxId,
        stellarTxId,
        status,
      },
    });

    return res.status(201).json(withdrawal);
  })
);

export default router;
