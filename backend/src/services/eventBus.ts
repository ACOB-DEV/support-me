import { EventEmitter } from "events";

export interface DonationEvent {
  donor: string;
  creator: string;
  token?: string;
  amount: string;
  memo: string;
  timestamp: number;
  ledger: number;
  txHash: string;
  /** Stable RPC event identity, when supplied by the listener. */
  eventId?: string;
  currency?: string;
  donationId?: number;
  subscriptionId?: number;
  feeAmount?: string;
}

export interface SubscriptionCreatedEvent {
  supporter: string;
  creator: string;
  subscriptionId: number;
  token: string;
  amount: string;
  intervalSecs: number;
  nextChargeAt: number;
  ledger: number;
  txHash: string;
}

export interface SubscriptionCancelledEvent {
  supporter: string;
  creator?: string;
  subscriptionId: number;
  ledger: number;
  txHash: string;
}

export interface GoalUpdatedEvent {
  creator: string;
  goalAmount: string;
  updatedAt: number;
  ledger: number;
  txHash: string;
}

export interface DonationRecordedEvent {
  creator: string;
  amount: string;
  totalDonations: string;
  donationCount: number;
  ledger: number;
  txHash: string;
}

export const DONATION_EVENT = "donation";
export const SUBSCRIPTION_CREATED_EVENT = "subscription_created";
export const SUBSCRIPTION_CANCELLED_EVENT = "subscription_cancelled";
export const GOAL_UPDATED_EVENT = "goal_updated";
export const DONATION_RECORDED_EVENT = "donation_recorded";

/**
 * In-process pub/sub used to fan out on-chain contract events (discovered by
 * `sorobanEventListener`) to any number of connected SSE clients in
 * `routes/events.ts`, and to internal reconciliation services.
 */
class EventBus extends EventEmitter {}

export const eventBus = new EventBus();
// Multiple SSE clients subscribe concurrently; raise the default limit of 10
// so Node doesn't warn about a "possible EventEmitter memory leak".
eventBus.setMaxListeners(100);
