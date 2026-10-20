import { Router } from "express";
import { Donation, Goal, Prisma } from "@prisma/client";
import prisma from "../prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { createDonationSchema, listDonationsQuerySchema } from "../schemas/donations";
import {
  notifyDonationConfirmation,
  notifyDonationReceived,
  notifyGoalsReached,
} from "../services/donationNotifications";
import { applyDonationToGoals } from "../services/goalService";
import { BadRequestError, NotFoundError } from "../errors/AppError";
import { RateLimiter } from "../services/rateLimiter";
import { clientIp, rateLimit } from "../middleware/rateLimit";
import { getRateLimitConfig } from "../config";

const router = Router();
const rateLimits = getRateLimitConfig();

// Donation creation does at least one database query per request, so it is
// limited per IP and per sender wallet before any of that work happens.
//
// Each limiter self-sweeps idle keys (#271); see routes/auth.ts for why.
export const donationIpLimiter = new RateLimiter(
  rateLimits.donation.ipMax,
  rateLimits.donation.windowMs
);
donationIpLimiter.startSweeping();
export const donationSenderLimiter = new RateLimiter(
  rateLimits.donation.accountMax,
  rateLimits.donation.windowMs
);
donationSenderLimiter.startSweeping();

router.get(
  "/",
  validate({ query: listDonationsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { creatorUsername, page, limit } = req.query as unknown as {
      creatorUsername?: string;
      page: number;
      limit: number;
    };
    const where = {
      ...(creatorUsername ? { creator: { username: creatorUsername } } : {}),
      verified: true,
    };

    const [items, total] = await Promise.all([
      prisma.donation.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        where,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.donation.count({ where }),
    ]);

    const responseItems = items.map((item) => {
      const eventId =
        item.rpcEventId ||
        item.onChainEventId ||
        (item.transactionHash ? `${item.transactionHash}:0:0` : undefined);
      return eventId ? { ...item, eventId } : item;
    });

    return res.json({
      items: responseItems,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.post(
  "/",
  rateLimit(donationIpLimiter, clientIp, "donation"),
  validate({ body: createDonationSchema }),
  rateLimit(donationSenderLimiter, (req) => req.body.senderAddress, "donation"),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.header("Idempotency-Key")?.trim();
    if (!idempotencyKey) throw new BadRequestError("Idempotency-Key header is required");

    const {
      creatorUsername,
      senderAddress,
      amount,
      currency,
      message,
      transactionHash,
    } = req.body;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // A browser donation transaction currently contains one DonatedEvent, so
    // the client-facing report uses the canonical operation/event indices 0.
    // The Soroban listener owns the authoritative index and can reconcile the
    // row using its RPC-provided event identity.
    const operationIndex = 0;
    const eventIndex = 0;
    const onChainEventId = `${transactionHash}:${operationIndex}:${eventIndex}`;
    // Client reports are never trusted as verified (issue #258): only the
    // server-side verification paths (the event listener / subscription
    // executor) may set verified: true. A reported donation is stored
    // provisional and excluded from verified-only aggregates until it is
    // corroborated on-chain.
    const verified = false;

    // Tracks whether this request is the one that actually inserted the
    // donation row, as opposed to an idempotent replay returning the
    // original. Notifications must only fire once, on the real insert —
    // not on every retry a client makes with the same Idempotency-Key.
    let isNewDonation = false;
    let reachedGoals: Goal[] = [];

    const record = async (client: Prisma.TransactionClient): Promise<Donation> => {
      // Cap per-request cleanup to a small batch size to avoid unbounded write load/lock contention
      const expiredKeys = await client.donationIdempotencyKey.findMany({
        where: { expiresAt: { lt: new Date() } },
        select: { key: true },
        take: 10,
      });
      if (expiredKeys.length > 0) {
        await client.donationIdempotencyKey.deleteMany({
          where: { key: { in: expiredKeys.map((k) => k.key) } },
        });
      }
      const existing = await client.donationIdempotencyKey.findUnique({
        where: { key: idempotencyKey },
        include: { donation: true },
      });
      if (existing && existing.expiresAt > new Date()) return existing.donation;
      if (existing) await client.donationIdempotencyKey.delete({ where: { key: idempotencyKey } });

      const creator = await client.creator.findUnique({ where: { username: creatorUsername } });
      if (!creator) throw new NotFoundError("Creator not found");

      const donation = await client.donation.upsert({
        where: {
          transactionHash_operationIndex_eventIndex: {
            transactionHash,
            operationIndex,
            eventIndex,
          },
        },
        update: {},
        create: {
          creatorId: creator.id,
          senderAddress,
          amount,
          currency,
          message,
          transactionHash,
          onChainEventId,
          operationIndex,
          eventIndex,
          verified,
        },
      });
      await client.donationIdempotencyKey.create({
        data: { key: idempotencyKey, donationId: donation.id, expiresAt },
      });
      // Only a client-reported row that is already verified (no transaction
      // hash — see the `verified` computation above) may touch goal progress.
      // A hash-bearing report is provisional (#260): the Soroban listener is
      // the only writer allowed to verify it and, in doing so, apply it to
      // goals and send notifications exactly once. Applying here would let an
      // unauthenticated caller inflate goal progress and trigger emails.
      if (verified) {
        reachedGoals = await applyDonationToGoals(client, creator.id, currency, amount);
        isNewDonation = true;
      }
      return donation;
    };

    let donation: Donation;
    try {
      donation = await prisma.$transaction(record);
    } catch (error) {
      // A concurrent retry can win the unique key constraint after both
      // transactions read the key as absent. Return that winner's donation.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.donationIdempotencyKey.findUnique({
          where: { key: idempotencyKey },
          include: { donation: true },
        });
        if (existing && existing.expiresAt > new Date()) donation = existing.donation;
        else {
          // The event listener may have won the unique on-chain identity race
          // while this request was being processed. Its row is the canonical
          // result, so return it rather than surfacing a spurious 500.
          const onChainDonation = await prisma.donation.findUnique({
            where: {
              transactionHash_operationIndex_eventIndex: {
                transactionHash,
                operationIndex,
                eventIndex,
              },
            },
          });
          if (!onChainDonation) throw error;
          donation = onChainDonation;
        }
      } else {
        throw error;
      }
    }

    // The donation is already committed; an email-provider outage must
    // never make the request fail or look like the donation didn't go
    // through. Each notification is independent (allSettled, not
    // Promise.all) so the creator's email failing doesn't skip the
    // supporter's, and each failure is logged individually.
    // Run notifications in the background so response time doesn't depend on email provider (#275)
    if (isNewDonation) {
      setImmediate(async () => {
        const [creatorResult, supporterResult] = await Promise.allSettled([
          notifyDonationReceived(donation),
          notifyDonationConfirmation(donation),
        ]);
        if (creatorResult.status === "rejected") {
          console.error(
            `Donation-received email failed for donation ${donation.id}:`,
            (creatorResult.reason as Error).message
          );
        }
        if (supporterResult.status === "rejected") {
          console.error(
            `Donation-confirmation email failed for donation ${donation.id}:`,
            (supporterResult.reason as Error).message
          );
        }
        try {
          await notifyGoalsReached(reachedGoals);
        } catch (error) {
          console.error(
            `Goals-reached notification failed for donation ${donation.id}:`,
            (error as Error).message
          );
        }
      });
    }

    return res.status(201).json(donation);
  })
);

export default router;
