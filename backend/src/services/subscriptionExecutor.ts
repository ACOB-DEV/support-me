import {
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import prisma from "../prisma";
import { Subscription } from "@prisma/client";
import {
  notifySubscriptionPaymentFailed,
  notifySubscriptionRenewed,
} from "./subscriptionNotifications";
import { withSorobanRpcServer } from "./sorobanRpc";
import { executorHealth } from "./executorHealth";
import { applyDonationToGoals } from "./goalService";
import { notifyGoalsReached } from "./donationNotifications";
import { log } from "../lib/logger";
import * as Sentry from "@sentry/node";

const NETWORK_PASSPHRASE = Networks.TESTNET;

import { config } from "../config";
import { toAmount } from "../lib/money";

const getDonationContractId = (): string | undefined => config.donationContractId || undefined;
const getExecutorSecretKey = (): string | undefined => config.executorSecretKey || undefined;
const getPollIntervalMs = (): number => {
  const configured = Number(process.env.SUBSCRIPTION_EXECUTOR_POLL_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
};

/**
 * Periodically charges due recurring-donation subscriptions by calling the
 * donation contract's `charge_subscription`, signed by this backend's own
 * operational keypair — the "executor" address the contract's admin
 * authorized via `set_executor`. This is the only place the backend signs
 * and submits a Stellar transaction on its own behalf; everywhere else,
 * transactions are built and signed client-side by the end user's wallet.
 *
 * The executor key only pays fees and satisfies the contract's caller
 * check — it never custodies donor funds, since `transfer_from`'s `to` is
 * pinned inside the contract to the subscription's stored creator. A leaked
 * key can at most accelerate/replay already-approved charges, not redirect
 * them.
 *
 * Mirrors `SorobanEventListener`'s start()/stop()/setInterval() shape.
 */
export class SubscriptionExecutor {
  private keypair: Keypair | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    const donationContractId = getDonationContractId();
    const executorSecretKey = getExecutorSecretKey();
    
    if (!donationContractId || !executorSecretKey) {
      const msg = "SubscriptionExecutor cannot start: missing DONATION_CONTRACT_ID or EXECUTOR_SECRET_KEY.";
      log("error", msg);
      throw new Error(msg);
    }
    
    if (this.timer) return;

    this.keypair = Keypair.fromSecret(executorSecretKey);
    const pollIntervalMs = getPollIntervalMs();
    const expectedIntervalMs =
      Number(process.env.SUBSCRIPTION_EXECUTOR_EXPECTED_INTERVAL_MS) || pollIntervalMs * 3;
    executorHealth.markEnabled(expectedIntervalMs);
    this.timer = setInterval(() => {
      void this.tick();
    }, pollIntervalMs);
    void this.tick();
    log("info", "SubscriptionExecutor started", {
      executorAddress: this.keypair.publicKey(),
      pollIntervalMs,
      expectedIntervalMs,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Runs one pass over every due subscription. Public so tests can drive it. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    executorHealth.runStarted();
    let ok = false;
    let runError: string | undefined;
    try {
      const due = await prisma.subscription.findMany({
        where: { active: true, nextChargeAt: { lte: new Date() } },
      });

      log("info", "SubscriptionExecutor tick started", { dueCount: due.length });

      // Use a bounded concurrency (e.g., 5) to process charges concurrently
      // without overloading the RPC or database.
      const CONCURRENCY_LIMIT = 5;
      
      const processSubscription = async (subscription: Subscription) => {
        try {
          await this.charge(subscription);
        } catch (error) {
          const errorMessage = (error as Error).message;
          log("error", "SubscriptionExecutor charge failed", {
            subscriptionId: subscription.id,
            creatorId: subscription.creatorId,
            supporterAddress: subscription.supporterAddress,
            amount: subscription.amount,
            token: subscription.token,
            error: errorMessage,
          });
        }
      };

      const chunks = [];
      for (let i = 0; i < due.length; i += CONCURRENCY_LIMIT) {
        chunks.push(due.slice(i, i + CONCURRENCY_LIMIT));
      }

      for (const chunk of chunks) {
        await Promise.all(chunk.map(processSubscription));
      }

      ok = true;
    } catch (error) {
      runError = (error as Error).message;
      log("error", "SubscriptionExecutor tick failed", { error: runError });
    } finally {
      this.running = false;
      executorHealth.runFinished(ok, runError);
    }
  }

  private async charge(subscription: Subscription): Promise<void> {
    let hash: string;
    try {
      hash = await this.submitCharge(subscription);
    } catch (error) {
      await this.recordFailure(subscription, (error as Error).message);
      return;
    }

    const nextChargeAt = new Date(Date.now() + subscription.intervalSecs * 1000);
    const onChainEventId = `${hash}:0:0`;
    const reachedGoals = await prisma.$transaction(async (client) => {
      await client.donation.upsert({
        where: {
          transactionHash_operationIndex_eventIndex: {
            transactionHash: hash,
            operationIndex: 0,
            eventIndex: 0,
          },
        },
        update: {},
        create: {
          creatorId: subscription.creatorId,
          senderAddress: subscription.supporterAddress,
          amount: subscription.amount,
          currency: subscription.token,
          message: "Recurring donation",
          transactionHash: hash,
          onChainEventId,
          operationIndex: 0,
          eventIndex: 0,
          verified: true,
        },
      });
      await client.subscription.update({
        where: { id: subscription.id },
        data: {
          nextChargeAt,
          lastChargeTxHash: hash,
          lastChargedAt: new Date(),
          lastError: null,
          failureCount: 0,
          failureNotifiedAt: null,
        },
      });
      // A recurring donation applies to goal progress the same way a
      // one-off donation does (see goalService.ts's applyDonationToGoals).
      return applyDonationToGoals(client, subscription.creatorId, subscription.token, toAmount(subscription.amount));
    });
    executorHealth.recordCharge(subscription.id, "success");

    log("info", "SubscriptionExecutor charge succeeded", {
      subscriptionId: subscription.id,
      creatorId: subscription.creatorId,
      supporterAddress: subscription.supporterAddress,
      amount: subscription.amount,
      token: subscription.token,
      transactionHash: hash,
      nextChargeAt: nextChargeAt.toISOString(),
    });

    // The charge already settled on-chain and is recorded; a mail outage
    // must not make it look failed (or get it retried), so just log.
    try {
      await notifySubscriptionRenewed(subscription, hash, nextChargeAt);
    } catch (error) {
      log("error", "SubscriptionExecutor renewal email failed", {
        subscriptionId: subscription.id,
        error: (error as Error).message,
      });
    }
    await notifyGoalsReached(reachedGoals);
  }

  private async recordFailure(subscription: Subscription, message: string): Promise<void> {
    const isPermanent = message.includes("failed on-chain") || message.includes("reverted");
    const currentFailureCount = (subscription as any).failureCount || 0;
    const failureCount = currentFailureCount + 1;
    const maxAttempts = isPermanent ? 3 : 24; // bounded attempts
    const shouldDeactivate = failureCount >= maxAttempts;

    log("error", "SubscriptionExecutor charge failed", {
      subscriptionId: subscription.id,
      creatorId: subscription.creatorId,
      supporterAddress: subscription.supporterAddress,
      amount: subscription.amount,
      token: subscription.token,
      error: message,
      isPermanent,
      failureCount,
      shouldDeactivate,
    });

    // Report to Sentry with full context for debugging
    Sentry.captureException(new Error(`Subscription charge failed: ${message}`), {
      tags: {
        subscriptionId: String(subscription.id),
        creatorId: String(subscription.creatorId),
      },
      extra: {
        supporterAddress: subscription.supporterAddress,
        amount: subscription.amount,
        token: subscription.token,
        intervalSecs: subscription.intervalSecs,
        nextChargeAt: subscription.nextChargeAt?.toISOString(),
      },
    });

    executorHealth.recordCharge(subscription.id, "failure", message);

    // Email once per failure streak: the executor retries every tick, and a
    // supporter shouldn't get a new email each minute for the same problem.
    let notified = false;
    if (!subscription.failureNotifiedAt) {
      try {
        notified = await notifySubscriptionPaymentFailed(subscription, message);
      } catch (error) {
        log("error", "SubscriptionExecutor payment-failure email failed", {
          subscriptionId: subscription.id,
          error: (error as Error).message,
        });
      }
    }

    // Record the failure and increment failureCount. If the streak exceeds
    // maxAttempts, mark active = false so we stop retrying forever.
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { 
        lastError: message, 
        failureCount,
        ...(shouldDeactivate ? { active: false } : {}),
        ...(notified ? { failureNotifiedAt: new Date() } : {}) 
      },
    });
  }

  /**
   * Builds, signs, and submits `charge_subscription` for one subscription,
   * resolving with the confirmed transaction hash.
   */
  protected async submitCharge(subscription: Subscription): Promise<string> {
    const keypair = this.keypair!;
    const contractId = getDonationContractId();
    if (!contractId) {
      throw new Error("Donation contract is not configured");
    }

    const account = await withSorobanRpcServer("getAccount", (server) =>
      server.getAccount(keypair.publicKey())
    );
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "charge_subscription",
          nativeToScVal(keypair.publicKey(), { type: "address" }),
          nativeToScVal(BigInt(subscription.onChainId), { type: "u64" })
        )
      )
      .setTimeout(60)
      .build();

    const prepared = await withSorobanRpcServer("prepareTransaction", (server) =>
      server.prepareTransaction(tx)
    );
    prepared.sign(keypair);

    // The same signed XDR is submitted to each endpoint. A timeout can happen
    // after the network accepted the transaction, so a fallback must never
    // rebuild (and potentially re-sequence) the transaction.
    const transactionHash = prepared.hash().toString("hex");
    try {
      const sendResult = await withSorobanRpcServer("sendTransaction", (server) =>
        server.sendTransaction(prepared)
      );
      return this.confirm(sendResult.hash || transactionHash);
    } catch (error) {
      // All endpoints may have timed out after accepting the transaction. Try
      // the locally computable hash before reporting a failure and retrying the
      // charge on the next executor tick.
      try {
        await this.confirm(transactionHash);
        return transactionHash;
      } catch {
        throw error;
      }
    }
  }

  private async confirm(hash: string): Promise<string> {
    // Soroban RPC calls already retry transient failures internally (see
    // services/retry.ts), so this loop only handles the normal case of a
    // transaction that is submitted but not yet included in a ledger. The
    // poll interval grows between attempts so a slow inclusion doesn't turn
    // into a tight loop against the provider, while the overall confirmation
    // window stays bounded at ~30s.
    const POLL_INTERVAL_MS = 1_000;
    const MAX_POLL_INTERVAL_MS = 8_000;
    const MAX_WAIT_MS = 30_000;
    const startedAt = Date.now();
    let intervalMs = POLL_INTERVAL_MS;

    for (;;) {
      const result = await withSorobanRpcServer("getTransaction", (server) =>
        server.getTransaction(hash)
      );
      if (result.status === "SUCCESS") return hash;
      if (result.status === "FAILED") {
        throw new Error(`Transaction ${hash} failed on-chain`);
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed + intervalMs >= MAX_WAIT_MS) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      intervalMs = Math.min(intervalMs * 2, MAX_POLL_INTERVAL_MS);
    }

    throw new Error(`Transaction ${hash} did not confirm within 30s`);
  }
}

export const subscriptionExecutor = new SubscriptionExecutor();
