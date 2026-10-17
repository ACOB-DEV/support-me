import {
  sorobanEventListener,
  RawEvent,
} from "../../services/sorobanEventListener";
import {
  eventBus,
  DONATION_EVENT,
  SUBSCRIPTION_CREATED_EVENT,
  SUBSCRIPTION_CANCELLED_EVENT,
  GOAL_UPDATED_EVENT,
  DONATION_RECORDED_EVENT,
} from "../../services/eventBus";
import prisma from "../../prisma";
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

jest.mock("../../prisma", () => ({
  __esModule: true,
  default: {
    subscription: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    creator: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

function toBase64Xdr(val: unknown): string {
  return nativeToScVal(val).toXDR("base64");
}

describe("SorobanEventListener event processing & reconciliation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("processes 'donated' event with token and emits DONATION_EVENT", async () => {
    const emittedEvents: any[] = [];
    const handler = (evt: any) => emittedEvents.push(evt);
    eventBus.on(DONATION_EVENT, handler);

    const rawEvent: RawEvent = {
      type: "contract",
      ledger: 1050,
      id: "0000000000001050-00000",
      txHash: "tx_hash_donated_123",
      topic: [
        toBase64Xdr("donated"),
        toBase64Xdr("GDONOR123"),
        toBase64Xdr("GCREATOR456"),
      ],
      value: toBase64Xdr({
        amount: 1500000000n,
        memo: "Coffee for dev",
        timestamp: 1713182400n,
        token: "CUSDC...",
        donation_id: 10n,
        fee_amount: 0n,
        subscription_id: null,
      }),
    };

    const handled = await sorobanEventListener.processEvent(rawEvent);

    expect(handled).toBe(true);
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0]).toMatchObject({
      donor: "GDONOR123",
      creator: "GCREATOR456",
      token: "CUSDC...",
      amount: "1500000000",
      memo: "Coffee for dev",
      timestamp: 1713182400,
      ledger: 1050,
      txHash: "tx_hash_donated_123",
      donationId: 10,
      feeAmount: "0",
    });

    eventBus.off(DONATION_EVENT, handler);
  });

  it("processes recurring 'donated' event with subscription_id and reconciles subscription state", async () => {
    const emittedEvents: any[] = [];
    const handler = (evt: any) => emittedEvents.push(evt);
    eventBus.on(DONATION_EVENT, handler);

    const rawEvent: RawEvent = {
      type: "contract",
      ledger: 1055,
      id: "0000000000001055-00000",
      txHash: "tx_hash_donated_sub_123",
      topic: [
        toBase64Xdr("donated"),
        toBase64Xdr("GSUPPORTER"),
        toBase64Xdr("GCREATOR"),
      ],
      value: toBase64Xdr({
        amount: 500000000n,
        memo: "",
        timestamp: 1713182500n,
        token: "CUSDC...",
        donation_id: 11n,
        fee_amount: 0n,
        subscription_id: 42n,
      }),
    };

    const handled = await sorobanEventListener.processEvent(rawEvent);

    expect(handled).toBe(true);
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0]).toMatchObject({
      donor: "GSUPPORTER",
      creator: "GCREATOR",
      amount: "500000000",
      donationId: 11,
      subscriptionId: 42,
    });

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { onChainId: 42 },
      data: {
        lastChargeTxHash: "tx_hash_donated_sub_123",
        lastChargedAt: new Date(1713182500 * 1000),
        lastError: null,
        failureCount: 0,
      },
    });

    eventBus.off(DONATION_EVENT, handler);
  });

  it("processes 'subscribed' event with schedule details and emits SUBSCRIPTION_CREATED_EVENT", async () => {
    const emittedEvents: any[] = [];
    const handler = (evt: any) => emittedEvents.push(evt);
    eventBus.on(SUBSCRIPTION_CREATED_EVENT, handler);

    const rawEvent: RawEvent = {
      type: "contract",
      ledger: 1060,
      id: "0000000000001060-00000",
      txHash: "tx_hash_sub_123",
      topic: [
        toBase64Xdr("subscribed"),
        toBase64Xdr("GSUPPORTER"),
        toBase64Xdr("GCREATOR"),
      ],
      value: toBase64Xdr({
        subscription_id: 42n,
        token: "USDC",
        amount: 100000000n,
        interval_secs: 2592000n,
        next_charge_at: 1715774400n,
      }),
    };

    const handled = await sorobanEventListener.processEvent(rawEvent);

    expect(handled).toBe(true);
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0]).toMatchObject({
      supporter: "GSUPPORTER",
      creator: "GCREATOR",
      subscriptionId: 42,
      token: "USDC",
      amount: "100000000",
      intervalSecs: 2592000,
      nextChargeAt: 1715774400,
    });

    eventBus.off(SUBSCRIPTION_CREATED_EVENT, handler);
  });

  it("processes 'sub_cancelled' event and reconciles database subscription state without polling", async () => {
    const emittedEvents: any[] = [];
    const handler = (evt: any) => emittedEvents.push(evt);
    eventBus.on(SUBSCRIPTION_CANCELLED_EVENT, handler);

    const rawEvent: RawEvent = {
      type: "contract",
      ledger: 1070,
      id: "0000000000001070-00000",
      txHash: "tx_hash_cancel_123",
      topic: [
        toBase64Xdr("sub_cancelled"),
        toBase64Xdr("GSUPPORTER"),
        toBase64Xdr("GCREATOR"),
      ],
      value: toBase64Xdr({
        subscription_id: 42n,
      }),
    };

    const handled = await sorobanEventListener.processEvent(rawEvent);

    expect(handled).toBe(true);
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0]).toMatchObject({
      supporter: "GSUPPORTER",
      creator: "GCREATOR",
      subscriptionId: 42,
    });

    // Verify event-driven reconciliation was triggered in Prisma
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { onChainId: 42 },
      data: { active: false },
    });

    eventBus.off(SUBSCRIPTION_CANCELLED_EVENT, handler);
  });

  it("processes 'goal_upd' event and reconciles creator donation goal in database", async () => {
    const emittedEvents: any[] = [];
    const handler = (evt: any) => emittedEvents.push(evt);
    eventBus.on(GOAL_UPDATED_EVENT, handler);

    const rawEvent: RawEvent = {
      type: "contract",
      ledger: 1080,
      id: "0000000000001080-00000",
      txHash: "tx_hash_goal_123",
      topic: [toBase64Xdr("goal_upd"), toBase64Xdr("GCREATOR_WALLET")],
      value: toBase64Xdr({
        goal_amount: 5000n,
        updated_at: 1713183000n,
      }),
    };

    const handled = await sorobanEventListener.processEvent(rawEvent);

    expect(handled).toBe(true);
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0]).toMatchObject({
      creator: "GCREATOR_WALLET",
      goalAmount: "5000",
      updatedAt: 1713183000,
    });

    // Verify creator goal was reconciled in database
    expect(prisma.creator.updateMany).toHaveBeenCalledWith({
      where: { walletAddress: "GCREATOR_WALLET" },
      data: { donationGoal: 5000 },
    });

    eventBus.off(GOAL_UPDATED_EVENT, handler);
  });

  it("processes 'don_rec' event and emits DONATION_RECORDED_EVENT", async () => {
    const emittedEvents: any[] = [];
    const handler = (evt: any) => emittedEvents.push(evt);
    eventBus.on(DONATION_RECORDED_EVENT, handler);

    const rawEvent: RawEvent = {
      type: "contract",
      ledger: 1090,
      id: "0000000000001090-00000",
      txHash: "tx_hash_don_rec_123",
      topic: [toBase64Xdr("don_rec"), toBase64Xdr("GCREATOR_WALLET")],
      value: toBase64Xdr({
        amount: 250000000n,
        total_donations: 7500000000n,
        donation_count: 15,
      }),
    };

    const handled = await sorobanEventListener.processEvent(rawEvent);

    expect(handled).toBe(true);
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0]).toMatchObject({
      creator: "GCREATOR_WALLET",
      amount: "250000000",
      totalDonations: "7500000000",
      donationCount: 15,
    });

    eventBus.off(DONATION_RECORDED_EVENT, handler);
  });
});
