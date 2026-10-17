import { Donation, Goal } from "@prisma/client";
import prisma from "../prisma";
import { sendEmail } from "./email/mailer";
import { donationConfirmationEmail, goalReachedEmail } from "./email/templates";
import { emailService } from "./email/emailService";
import { toAmount } from "../lib/money";

const dashboardUrl = (): string =>
  `${(process.env.APP_URL || "https://localhost:3000").replace(/\/$/, "")}/app/dashboard`;

/**
 * Emails the creator that they received a one-time donation. Returns
 * whether an email was actually sent, mirroring notifySubscriptionRenewed's
 * shape: false (not an error) when the creator hasn't given us an email
 * address, since wallet sign-in never requires one.
 */
export async function notifyDonationReceived(donation: Donation): Promise<boolean> {
  try {
    const creator = await prisma.creator.findUnique({
      where: { id: donation.creatorId },
      include: { user: true },
    });
    if (!creator?.user.email) return false;

    let donorName: string | null = null;
    if (donation.senderAddress && donation.senderAddress.toLowerCase() !== "anonymous") {
      const senderCreator = await prisma.creator.findFirst({
        where: { walletAddress: donation.senderAddress },
      });
      if (senderCreator) donorName = senderCreator.displayName || `@${senderCreator.username}`;
    }

    await emailService.sendDonationReceipt(creator.user.email, {
      creatorName: creator.displayName || creator.username,
      donorName,
      donorAddress: donation.senderAddress,
      amount: toAmount(donation.amount),
      currency: donation.currency,
      message: donation.message,
      timestamp: donation.createdAt,
      transactionHash: donation.transactionHash,
      dashboardUrl: `${dashboardUrl()}`,
    });
    return true;
  } catch (error) {
    console.error(
      `notifyDonationReceived: failed to send receipt for donation ${donation.id}:`,
      (error as Error).message
    );
    return false;
  }
}

/**
 * Optionally confirms the donation to the supporter, when their wallet
 * address matches a known account with an email on file. Most donations
 * come from wallet-only supporters with no account at all, so returning
 * false here is the common case, not an error.
 */
export async function notifyDonationConfirmation(donation: Donation): Promise<boolean> {
  const [supporter, creator] = await Promise.all([
    prisma.user.findUnique({ where: { walletAddress: donation.senderAddress } }),
    prisma.creator.findUnique({ where: { id: donation.creatorId } }),
  ]);
  if (!supporter?.email) return false;

  await sendEmail({
    to: supporter.email,
    ...donationConfirmationEmail({
      creatorName: creator?.displayName || creator?.username || "a creator",
      amount: toAmount(donation.amount),
      currency: donation.currency,
      transactionHash: donation.transactionHash,
    }),
  });
  return true;
}

/**
 * Emails the creator about each goal a donation just carried to its target
 * (the goals applyDonationToGoals returns). Never throws: like the other
 * donation notices, a mail failure must not make a recorded donation look
 * failed, so each goal's failure is logged individually instead.
 */
export async function notifyGoalsReached(goals: Goal[]): Promise<void> {
  await Promise.all(
    goals.map(async (goal) => {
      try {
        const creator = await prisma.creator.findUnique({
          where: { id: goal.creatorId },
          include: { user: true },
        });
        if (!creator?.user.email) return;

        await sendEmail({
          to: creator.user.email,
          ...goalReachedEmail({
            goalTitle: goal.title,
            targetAmount: goal.targetAmount,
            currency: goal.currency,
            dashboardUrl: dashboardUrl(),
          }),
        });
      } catch (error) {
        console.error(
          `notifyGoalsReached: failed to send notice for goal ${goal.id}:`,
          (error as Error).message
        );
      }
    })
  );
}
