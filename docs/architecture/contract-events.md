# Soroban Contract Events Specification

This document defines the schema, topic indexing strategy, and backend consumption patterns for all smart contract events emitted by SupportMe's Soroban contracts (`donation` and `creator-registry`).

---

## 1. Overview & Architecture

Historically, off-chain backend systems had to periodically poll contract state via RPCs to track donation arrivals, subscription cancellations, or profile updates. 

SupportMe contracts now emit self-contained events for all key on-chain state mutations. Every event payload carries sufficient contextual data (including involved parties, token asset address, amounts, and schedule timestamps) so that indexers, listeners, and backend services can reconcile off-chain database state without making follow-up RPC queries.

```
+---------------------+           +------------------------+
|   Stellar Network   |           |  SorobanEventListener  |
|  (Soroban Contracts)|           |    (Express Backend)   |
+----------+----------+           +-----------+------------+
           |                                  |
           | emit #[contractevent]            |
           +--------------------------------->| poll getEvents (cursor-based)
                                              |
                                              +----+ Reconcile DB (Prisma)
                                              |    | (e.g. sub cancelled, goal updated)
                                              |
                                              v
                                         eventBus (Node.js)
                                              |
                                              v
                                      GET /api/events (SSE)
                                              |
                                              v
                                     Connected Dashboards
```

---

## 2. Event Schemas & Payload Shapes

### 2.1. `DonatedEvent`
Emitted by `DonationContract::donate` and `DonationContract::charge_subscription` whenever tokens move from donor/supporter to creator.

- **Topic Schema**: `["donated", donor: Address, creator: Address]`
- **Value Schema**:
  ```rust
  pub struct DonatedEvent {
      pub donor: Address,      // [topic]
      pub creator: Address,    // [topic]
      pub token: Address,      // SAC address of donated token (e.g. native XLM or USDC)
      pub amount: i128,        // Amount transferred in atomic units / stroops
      pub memo: String,        // Donor memo or "recurring"
      pub timestamp: u64,      // Ledger timestamp
  }
  ```
- **Indexing & Filtering**:
  Indexed by `donor` and `creator`. Allows querying all donations received by a creator or all donations sent by a supporter without scanning unrelated ledger traffic.

---

### 2.2. `SubscribedEvent`
Emitted by `DonationContract::subscribe` when a supporter sets up a recurring donation schedule.

- **Topic Schema**: `["subscribed", supporter: Address, creator: Address]`
- **Value Schema**:
  ```rust
  pub struct SubscribedEvent {
      pub supporter: Address,       // [topic] Supporter wallet address
      pub creator: Address,         // [topic] Creator wallet address
      pub subscription_id: u64,     // Globally unique counter ID
      pub token: Address,           // SAC address to draw allowance from
      pub amount: i128,             // Amount charged per interval
      pub interval_secs: u64,       // Interval in seconds (e.g. 2,592,000 for monthly)
      pub next_charge_at: u64,      // Timestamp when first recurrence becomes due
  }
  ```
- **Indexing & Filtering**:
  Indexed by `supporter` and `creator`. Contains full interval and asset metadata, allowing the backend to register the subscription and schedule without extra RPC queries.

---

### 2.3. `SubscriptionCancelledEvent`
Emitted by `DonationContract::cancel_subscription` when a supporter cancels their recurring donation and zeroes out allowance.

- **Topic Schema**: `["sub_cancelled", supporter: Address, creator: Address]`
- **Value Schema**:
  ```rust
  pub struct SubscriptionCancelledEvent {
      pub supporter: Address,       // [topic] Supporter wallet address
      pub creator: Address,         // [topic] Creator wallet address
      pub subscription_id: u64,     // ID of the cancelled subscription
  }
  ```
- **Indexing & Filtering**:
  Indexed by both `supporter` and `creator`. Enables the backend to immediately reconcile database state (`active = false`) upon event ingestion without polling.

---

### 2.4. `GoalUpdatedEvent`
Emitted by `CreatorRegistryContract::set_goal` and `DonationContract::set_goal` whenever a creator sets or updates their target funding goal.

- **Topic Schema**: `["goal_upd", creator: Address]`
- **Value Schema**:
  ```rust
  pub struct GoalUpdatedEvent {
      pub creator: Address,         // [topic] Creator wallet address
      pub goal_amount: i128,        // Target funding goal in atomic units (0 clears goal)
      pub updated_at: u64,          // Ledger timestamp of the update
  }
  ```
- **Indexing & Filtering**:
  Indexed by `creator`. The backend automatically syncs `Creator.donationGoal` in PostgreSQL upon receiving this event.

---

### 2.5. `DonationRecordedEvent`
Emitted by `CreatorRegistryContract::record_donation` when lifetime totals are updated following a successful donation.

- **Topic Schema**: `["don_rec", creator: Address]`
- **Value Schema**:
  ```rust
  pub struct DonationRecordedEvent {
      pub creator: Address,         // [topic] Creator wallet address
      pub amount: i128,             // Incremental donation amount
      pub total_donations: i128,    // New cumulative lifetime total donations
      pub donation_count: u32,      // New cumulative lifetime donation count
  }
  ```
- **Indexing & Filtering**:
  Carries current cumulative statistics directly so indexers can maintain up-to-date creator leaderboards without calculating rollups or querying storage.

---

### 2.6. `CreatedEvent`
Emitted by `CreatorRegistryContract::register_creator` when a creator signs up.

- **Topic Schema**: `["created", creator: Address]`
- **Value Schema**:
  ```rust
  pub struct CreatedEvent {
      pub creator: Address,         // [topic] Creator wallet address
      pub username: String,         // Registered unique username
  }
  ```

---

## 3. Backend Event Consumption & Reconciliation

The backend's `SorobanEventListener` (`backend/src/services/sorobanEventListener.ts`) consumes these events using Soroban RPC cursor pagination.

### 3.1. Reconciling Subscriptions Without Polling
When a supporter cancels a subscription directly through contract interaction, the listener receives `SubscriptionCancelledEvent`:

```typescript
case "sub_cancelled": {
  const subId = Number(value.subscription_id);
  eventBus.emit(SUBSCRIPTION_CANCELLED_EVENT, payload);

  // Automatically deactivates subscription in DB:
  await prisma.subscription.updateMany({
    where: { onChainId: subId },
    data: { active: false },
  });
}
```

This eliminates the need for periodic RPC polling passes to check whether each subscription is still active.

### 3.2. Reconciling Creator Goals
When a creator updates their goal on-chain, `GoalUpdatedEvent` is ingested and updates the creator model:

```typescript
case "goal_upd": {
  await prisma.creator.updateMany({
    where: { walletAddress: creatorAddress },
    data: { donationGoal: Number(value.goal_amount) },
  });
}
```

### 3.3. Reconciling Donations Without Polling
A `DonatedEvent` is the authoritative record of a one-off donation. When the listener ingests one it resolves the creator by the event's creator wallet (skipping, with a log line, events for unknown creators), converts the stroop amount to whole units, and writes or updates the matching `Donation` row setting `verified: true`.

Rows may exist in two states:

- A hash-bearing `POST /api/donations` report is stored provisionally with `verified: false`. Such a report never touches goal progress or sends email — otherwise an unauthenticated caller could inflate a creator's goals and use the endpoint as a spam relay.
- The listener is the only writer allowed to flip a row to `verified: true`. It matches the row by `rpcEventId` (`evt.id`) or the `(transactionHash, operationIndex, eventIndex)` identity, backfills the authoritative `amount`/`currency`/`senderAddress`/`creatorId`, applies the donation to the creator's active same-currency goals, and sends the donation and goal-reached notifications.

The verification flip is a conditional `updateMany({ where: { verified: false } })`, so a replayed lookback after a restart — or a concurrent client report — is a no-op rather than a double-count. Donations made entirely on-chain (with no client report) are created directly in the verified state.

### 3.4. Real-Time Dashboard Updates (SSE)
All processed events are published onto `eventBus` and broadcast via Server-Sent Events at `GET /api/events` to any open creator dashboards or activity monitors.
