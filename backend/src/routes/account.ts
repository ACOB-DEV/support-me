import { Router } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { deleteAccountSchema } from "../schemas/account";
import { UnauthorizedError } from "../errors/AppError";

const router = Router();

router.get(
  "/export",
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) {
      throw new UnauthorizedError("User not authenticated");
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { creator: true },
    });
    if (!user) {
      throw new UnauthorizedError("User not found");
    }

    // A wallet-less account (magic-link/OAuth sign-in) owns no wallet-linked
    // records; the empty string matches no address rows.
    const walletAddress = user.walletAddress ?? "";
    const [donationsSent, subscriptionsAsSupporter] = await Promise.all([
      prisma.donation.findMany({
        where: { senderAddress: walletAddress },
        orderBy: { createdAt: "desc" },
      }),
      prisma.subscription.findMany({
        where: { supporterAddress: walletAddress },
        orderBy: { createdAt: "desc" },
        include: {
          creator: { select: { username: true, displayName: true, walletAddress: true } },
        },
      }),
    ]);

    let donationsReceived: unknown[] = [];
    let subscriptionsToCreator: unknown[] = [];
    let withdrawals: unknown[] = [];
    if (user.creator) {
      [donationsReceived, subscriptionsToCreator, withdrawals] = await Promise.all([
        prisma.donation.findMany({
          where: { creatorId: user.creator.id },
          orderBy: { createdAt: "desc" },
        }),
        prisma.subscription.findMany({
          where: { creatorId: user.creator.id },
          orderBy: { createdAt: "desc" },
          include: {
            creator: { select: { username: true, displayName: true, walletAddress: true } },
          },
        }),
        prisma.withdrawal.findMany({
          where: { creatorId: user.creator.id },
          orderBy: { createdAt: "desc" },
        }),
      ]);
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        deletedAt: user.deletedAt,
      },
      creator: user.creator,
      donations: { sent: donationsSent, received: donationsReceived },
      subscriptions: {
        asSupporter: subscriptionsAsSupporter,
        asCreator: subscriptionsToCreator,
      },
      withdrawals,
    };

    const filename = `supportme-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(payload, null, 2));
  })
);

router.post(
  "/delete",
  authMiddleware,
  validate({ body: deleteAccountSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) {
      throw new UnauthorizedError("User not authenticated");
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { creator: true },
    });
    if (!user) {
      throw new UnauthorizedError("User not found");
    }

    if (user.deletedAt) {
      return res.json({
        deleted: true,
        deletedAt: user.deletedAt,
        alreadyDeleted: true,
        anonymized: [],
        preserved: [],
      });
    }

    // A wallet-less account (magic-link/OAuth sign-in) owns no wallet-linked
    // records; the empty string matches no address rows.
    const walletAddress = user.walletAddress ?? "";
    const creator = user.creator;

    const operations: Prisma.PrismaPromise<unknown>[] = [
      prisma.user.update({
        where: { id: user.id },
        data: { email: null, deletedAt: new Date() },
      }),
      // Memos the holder wrote on their own donations are personal content;
      // the amounts and transaction hashes stay (they're on-chain referenced).
      prisma.donation.updateMany({
        where: { senderAddress: walletAddress, message: { not: null } },
        data: { message: null },
      }),
      // Stop the executor charging subscriptions the holder started. The rows
      // themselves (on-chain ids, tx hashes, addresses) are preserved.
      prisma.subscription.updateMany({
        where: { supporterAddress: walletAddress, active: true },
        data: { active: false },
      }),
    ];

    if (creator) {
      operations.push(
        prisma.creator.update({
          where: { id: creator.id },
          data: { displayName: null, bio: null, avatarUrl: null, socialLinks: Prisma.DbNull },
        })
      );
    }

    const results = await prisma.$transaction(operations);
    const updatedUser = results[0] as { deletedAt: Date | null };

    return res.json({
      deleted: true,
      deletedAt: updatedUser.deletedAt,
      anonymized: [
        "email",
        "profile.displayName",
        "profile.bio",
        "profile.avatarUrl",
        "profile.socialLinks",
        "donationMessages.sent",
        "activeSubscriptions.deactivated",
      ],
      preserved: [
        "walletAddress",
        "onChainDonationRecords",
        "onChainSubscriptionRecords",
        "withdrawalRecords",
        "creator.username",
      ],
    });
  })
);

export default router;
