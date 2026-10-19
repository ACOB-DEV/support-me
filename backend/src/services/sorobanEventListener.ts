import { xdr, scValToNative } from "@stellar/stellar-sdk";
import prisma from "../prisma";
import { networkReset } from "./networkReset";
import * as Sentry from "@sentry/node";
import {
  DONATION_EVENT,
  SUBSCRIPTION_CREATED_EVENT,
  SUBSCRIPTION_CANCELLED_EVENT,
  GOAL_UPDATED_EVENT,
  DONATION_RECORDED_EVENT,
  DonationEvent,
  SubscriptionCreatedEvent,
  SubscriptionCancelledEvent,
  GoalUpdatedEvent,
  DonationRecordedEvent,
  eventBus,
} from "./eventBus";

const RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
// DONATION_CONTRACT_ID is the backend-scoped name (#302), with a fallback to
// the old NEXT_PUBLIC_-prefixed name for backward compat with deployments
// that still only have that one set. Remove the fallback once deployed
// backends are confirmed migrated to the new name.
const DONATION_CONTRACT_ID =
  process.env.DONATION_CONTRACT_ID?.trim() || process.env.NEXT_PUBLIC_DONATION_CONTRACT_ID;
const CREATOR_REGISTRY_CONTRACT_ID = process.env.NEXT_PUBLIC_CREATOR_REGISTRY_CONTRACT_ID;
const POLL_INTERVAL_MS = Number(process.env.SOROBAN_EVENTS_POLL_INTERVAL_MS) || 5000;
// How far back to look for events the first time the listener starts, so a
// freshly-restarted backend still surfaces recent events instead of only
// ones that happen after this exact moment.
const LOOKBACK_LEDGERS = Number(process.env.SOROBAN_EVENTS_LOOKBACK_LEDGERS) || 100;

export interface RawEvent {
  type: string;
  ledger: number;
  id: string;
  txHash: string;
  topic: string[];
  value: string;
}

export function decodeScVal(base64Xdr: string): unknown {
  return scValToNative(xdr.ScVal.fromXDR(base64Xdr, "base64"));
}

async function rpcCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) {
    throw new Error(`Soroban RPC ${method} failed: ${body.error.message}`);
  }
  return body.result as T;
}

/**
 * Polls the Soroban RPC's `getEvents` for events emitted by the SupportMe
 * smart contracts (`donated`, `subscribed`, `sub_cancelled`, `goal_upd`, `don_rec`).
 *
 * Emits events to `eventBus` for real-time SSE streaming, and executes
 * event-driven reconciliation (e.g. deactivating cancelled subscriptions,
 * updating creator goals) without requiring constant polling of contract RPCs.
 */
export class SorobanEventListener {
  private cursor: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  start(): void {
    if (!DONATION_CONTRACT_ID) {
      console.warn(
        "SorobanEventListener: DONATION_CONTRACT_ID is not set, skipping event polling."
      );
      return;
    }
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
    void this.poll();
    console.log(
      `SorobanEventListener: polling ${RPC_URL} for contracts [${DONATION_CONTRACT_ID}${
        CREATOR_REGISTRY_CONTRACT_ID ? `, ${CREATOR_REGISTRY_CONTRACT_ID}` : ""
      }] every ${POLL_INTERVAL_MS}ms`
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Drops the stored event cursor so the next poll re-derives its start ledger
   * from the current chain head. Used by the post-reset resync (#278): the old
   * cursor points into a ledger sequence that no longer exists.
   */
  resetCursor(): void {
    this.cursor = null;
  }

  /**
   * Processes a single raw contract event, parses its payload, emits on `eventBus`,
   * and triggers backend database reconciliation where applicable.
   * Public for deterministic testing without external RPC.
   */
  async processEvent(evt: RawEvent): Promise<boolean> {
    if (evt.type !== "contract") return false;

    const topics = evt.topic.map(decodeScVal);
    const eventType = topics[0] as string;

    switch (eventType) {
      case "donated": {
        const value = decodeScVal(evt.value) as {
          amount: bigint;
          memo: string;
          timestamp: bigint;
          token?: string;
        };

        const payload: DonationEvent = {
          donor: topics[1] as string,
          creator: topics[2] as string,
          token: value.token ? String(value.token) : undefined,
          amount: value.amount.toString(),
          memo: value.memo,
          timestamp: Number(value.timestamp),
          ledger: evt.ledger,
          txHash: evt.txHash,
        };

        eventBus.emit(DONATION_EVENT, payload);
        return true;
      }

      case "subscribed": {
        const value = decodeScVal(evt.value) as {
          subscription_id: bigint | number;
          token?: string;
          amount: bigint;
          interval_secs: bigint | number;
          next_charge_at?: bigint | number;
        };

        const payload: SubscriptionCreatedEvent = {
          supporter: topics[1] as string,
          creator: topics[2] as string,
          subscriptionId: Number(value.subscription_id),
          token: value.token ? String(value.token) : "XLM",
          amount: value.amount.toString(),
          intervalSecs: Number(value.interval_secs),
          nextChargeAt: value.next_charge_at ? Number(value.next_charge_at) : 0,
          ledger: evt.ledger,
          txHash: evt.txHash,
        };

        eventBus.emit(SUBSCRIPTION_CREATED_EVENT, payload);
        return true;
      }

      case "sub_cancelled": {
        const value = decodeScVal(evt.value) as {
          subscription_id: bigint | number;
        };

        const subId = Number(value.subscription_id);
        const payload: SubscriptionCancelledEvent = {
          supporter: topics[1] as string,
          creator: topics[2] ? (topics[2] as string) : undefined,
          subscriptionId: subId,
          ledger: evt.ledger,
          txHash: evt.txHash,
        };

        eventBus.emit(SUBSCRIPTION_CANCELLED_EVENT, payload);

        // State Reconciliation Flow:
        // Backend relies on events to mark subscription cancelled in DB
        // without requiring scheduled RPC polling for status checks.
        try {
          await prisma.subscription.updateMany({
            where: { onChainId: subId },
            data: { active: false },
          });
        } catch (err) {
          console.error(
            `SorobanEventListener: error reconciling cancelled subscription #${subId}:`,
            (err as Error).message
          );
        }
        return true;
      }

      case "goal_upd": {
        const value = decodeScVal(evt.value) as {
          goal_amount: bigint | number;
          updated_at: bigint | number;
        };

        const creatorAddress = topics[1] as string;
        const goalAmount = Number(value.goal_amount);

        const payload: GoalUpdatedEvent = {
          creator: creatorAddress,
          goalAmount: value.goal_amount.toString(),
          updatedAt: Number(value.updated_at),
          ledger: evt.ledger,
          txHash: evt.txHash,
        };

        eventBus.emit(GOAL_UPDATED_EVENT, payload);

        // State Reconciliation Flow:
        // Update creator donation goal in database when updated on-chain
        try {
          await prisma.creator.updateMany({
            where: { walletAddress: creatorAddress },
            data: { donationGoal: goalAmount },
          });
        } catch (err) {
          console.error(
            `SorobanEventListener: error reconciling creator goal for ${creatorAddress}:`,
            (err as Error).message
          );
        }
        return true;
      }

      case "don_rec": {
        const value = decodeScVal(evt.value) as {
          amount: bigint;
          total_donations: bigint;
          donation_count: number;
        };

        const payload: DonationRecordedEvent = {
          creator: topics[1] as string,
          amount: value.amount.toString(),
          totalDonations: value.total_donations.toString(),
          donationCount: Number(value.donation_count),
          ledger: evt.ledger,
          txHash: evt.txHash,
        };

        eventBus.emit(DONATION_RECORDED_EVENT, payload);
        return true;
      }

      default:
        return false;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    // #278: once a reset is detected the listener is stopped, but a poll in
    // flight must not replay events from the dead network. Checking here too
    // keeps the guarantee local to the polling loop.
    if (networkReset.getState().status === "reset_detected") return;
    this.polling = true;
    try {
      // Run detection on the poll cadence as well: the executor only ticks
      // once a minute, so this is what makes a reset visible "within one poll
      // interval". check() is cheap and short-circuits once detected.
      if (await networkReset.check()) return;

      const contractIds = [DONATION_CONTRACT_ID!];
      if (CREATOR_REGISTRY_CONTRACT_ID) {
        contractIds.push(CREATOR_REGISTRY_CONTRACT_ID);
      }

      const params: Record<string, unknown> = {
        filters: [{ type: "contract", contractIds }],
        pagination: { limit: 50 },
      };

      if (this.cursor) {
        (params.pagination as Record<string, unknown>).cursor = this.cursor;
      } else {
        const { sequence: latestLedger } = await rpcCall<{ sequence: number }>(
          "getLatestLedger",
          {}
        );
        params.startLedger = Math.max(latestLedger - LOOKBACK_LEDGERS, 1);
      }

      const result = await rpcCall<{ events: RawEvent[] }>("getEvents", params);

      for (const evt of result.events) {
        await this.processEvent(evt);
      }

      if (result.events.length > 0) {
        this.cursor = result.events[result.events.length - 1].id;
      }
    } catch (error) {
      console.error("SorobanEventListener: poll failed:", (error as Error).message);
      Sentry.captureException(error, {
        tags: { component: "SorobanEventListener" },
      });
    } finally {
      this.polling = false;
    }
  }
}

export const sorobanEventListener = new SorobanEventListener();
