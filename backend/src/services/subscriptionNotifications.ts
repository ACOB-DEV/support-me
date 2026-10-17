import { Subscription } from "@prisma/client";
import prisma from "../prisma";
import { sendEmail } from "./email/mailer";
import {
  classifyFailure,
  subscriptionPaymentFailedEmail,
  subscriptionRenewedEmail,
} from "./email/templates";
import { toAmount } from "../lib/money";

const manageUrl = (): string =>
  `${(process.env.APP_URL || "https://localhost:3000").replace(/\/$/, "")}/app/subscriptions`;

/**
 * Resolves who to email about a subscription and how to name its creator.
 * Returns null when the supporter hasn't given us an email address — wallet
 * sign-in doesn't require one, so that's the common case, not an error.
 */
async function lookupRecipient(subscription: Subscription) {
  const [supporter, creator] = await Promise.all([
    prisma.user.findUnique({ where: { walletAddress: subscription.supporterAddress } }),
    prisma.creator.findUnique({ where: { id: subscription.creatorId } }),
  ]);
  if (!supporter?.email) return null;

  return {
    email: supporter.email,
    creatorName: creator?.displayName || creator?.username || "a creator",
  };
}

/** Emails the supporter a receipt for a successful recurring charge. */
export async function notifySubscriptionRenewed(
  subscription: Subscription,
  txHash: string,
  nextChargeAt: Date
): Promise<boolean> {
  const recipient = await lookupRecipient(subscription);
  if (!recipient) return false;

  await sendEmail({
    to: recipient.email,
    ...subscriptionRenewedEmail({
      creatorName: recipient.creatorName,
      amount: toAmount(subscription.amount),
      token: subscription.token,
      intervalSecs: subscription.intervalSecs,
      manageUrl: manageUrl(),
      txHash,
      nextChargeAt,
    }),
  });
  return true;
}

/**
 * Emails the supporter that a recurring charge failed and how to fix it.
 * Returns whether an email was actually sent, so the caller only marks the
 * failure as notified when the supporter really heard about it. Failures on
 * our side ("operational") are never sent — the supporter can't fix them.
 */
export async function notifySubscriptionPaymentFailed(
  subscription: Subscription,
  error: string
): Promise<boolean> {
  if (classifyFailure(error) === "operational") return false;

  const recipient = await lookupRecipient(subscription);
  if (!recipient) return false;

  await sendEmail({
    to: recipient.email,
    ...subscriptionPaymentFailedEmail({
      creatorName: recipient.creatorName,
      amount: toAmount(subscription.amount),
      token: subscription.token,
      intervalSecs: subscription.intervalSecs,
      manageUrl: manageUrl(),
      error,
    }),
  });
  return true;
}
