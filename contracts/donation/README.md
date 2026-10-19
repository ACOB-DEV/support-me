# SupportMe Donation Smart Contract

A Soroban smart contract for handling creator donations and profiles on the Stellar blockchain.

## Overview

The `DonationContract` enables creators to register public profiles and receive donations from supporters. All donations are recorded immutably on the blockchain, creating a transparent donation history.

## Key Features

- **Creator Registration**: Creators can register profiles with usernames
- **Donation Tracking**: Donations are recorded with donor, amount, memo, and timestamp
- **Creator Statistics**: Track total donations and donation count per creator
- **Event Logging**: All actions emit events for monitoring and indexing
- **Auth Integration**: Uses Soroban's native auth for secure operations

## Contract Structure

### Data Types

#### `DonationRecord`
Records individual donations:
```rust
pub struct DonationRecord {
    pub donor: Address,           // Who sent the donation
    pub creator: Address,         // Who received it
    pub amount: i128,            // Donation amount (in stroops)
    pub memo: String,            // Optional message
    pub timestamp: u64,          // When it happened
}
```

#### `CreatorProfile`
Creator account information:
```rust
pub struct CreatorProfile {
    pub address: Address,         // Creator's wallet address
    pub username: String,         // Public username
    pub total_donations: i128,    // Total XLM received
    pub donation_count: u32,      // Number of donations
    pub created_at: u64,         // Registration timestamp
}
```

### Methods

#### `register_creator(env, creator, username) -> CreatorProfile`
Register a new creator profile.

**Parameters:**
- `creator`: Creator's address (must sign transaction)
- `username`: Unique username for the creator: 1-32 bytes of `a-z`, `0-9`, `_`
  or `-`. The registry rejects empty, oversized, invalid and already-taken
  usernames with distinct `RegistryError`s (`EmptyUsername`,
  `UsernameTooLong`, `InvalidUsernameChars`, `UsernameTaken`).

**Returns:** `CreatorProfile` object

**Events:** Emits `created` event

**Example:**
```rust
DonationContract::register_creator(
    env.clone(),
    creator_address,
    String::from_bytes(&env, b"awesome_dev")
);
```

#### `donate(env, donor, creator, amount, memo) -> DonationRecord`
Send a donation to a creator.

**Parameters:**
- `donor`: Donor's address (must sign transaction)
- `creator`: Target creator's address
- `amount`: Donation amount in stroops (must be > 0)
- `memo`: Optional message with the donation

**Returns:** `DonationRecord` object

**Events:** Emits `donated` event

**Example:**
```rust
DonationContract::donate(
    env.clone(),
    donor_address,
    creator_address,
    5000,  // stroops (0.0005 XLM)
    String::from_bytes(&env, b"Great work!")
);
```

#### `get_creator(env, creator) -> Option<CreatorProfile>`
Retrieve a creator's profile.

**Parameters:**
- `creator`: Creator's address

**Returns:** `Option<CreatorProfile>` - Some if creator exists, None otherwise

#### `get_creator_stats(env, creator) -> Option<CreatorProfile>`
Get donation statistics for a creator.

**Parameters:**
- `creator`: Creator's address

**Returns:** Complete `CreatorProfile` with stats

#### `get_total_donations_count(env) -> u32`
Get approximate total donation count across all creators.

**Returns:** Approximate number of donations made

#### `verify_donation(env, donor, creator, amount) -> bool`
Verify if a donor has made donations to a creator.

**Parameters:**
- `donor`: Donor's address (must sign)
- `creator`: Creator's address
- `amount`: Minimum amount to verify

**Returns:** `bool` - true if donation history exists

## Usage Flow

### For Creators

1. **Register Profile:**
   ```
   Call register_creator with your address and desired username
   ```

2. **Check Stats:**
   ```
   Call get_creator_stats to see total donations and count
   ```

3. **Share Profile:**
   ```
   Share your creator address or username with supporters
   ```

### For Supporters

1. **Find Creator:**
   ```
   Look up creator's address
   ```

2. **Send Donation:**
   ```
   Call donate with creator address and amount
   Add optional memo message
   ```

3. **Verify:**
   ```
   Call verify_donation to confirm transaction
   ```

## Storage Model

- **Permanent Storage**: Creator profiles (persistent across ledger resets)
- **Persistent Storage**: Donation records with counter-based indexing
- **Key Format**: Donations stored as "don{counter}" for efficient retrieval

## Events

### Created Event
```
Emitted when creator profile is created
Data: (creator_address, username)
```

### Donated Event
```
Emitted when donation or subscription charge is made
Data: DonatedEvent {
    donor: Address,
    creator: Address,
    token: Address,
    amount: i128,
    memo: String,
    timestamp: u64,
    donation_id: u32,
    fee_amount: i128,
    subscription_id: Option<u64>,
}
```

## Error Codes

The contracts use typed, discriminant-backed errors instead of untyped panics:

### `ChargeError` (`contracts/donation`)
| Code | Error Variant | Description |
|---|---|---|
| 1 | `InsufficientAllowance` | Spender allowance insufficient to complete subscription charge |
| 2 | `InsufficientBalance` | Supporter balance insufficient to complete subscription charge |

### `DonationError` (`contracts/donation`)
| Code | Error Variant | Description |
|---|---|---|
| 3 | `NotInitialized` | Contract has not been initialized |
| 4 | `AlreadyInitialized` | Contract already initialized |
| 5 | `Paused` | Contract is currently paused |
| 6 | `Unauthorized` | Caller lacks authorization for operation |
| 7 | `TokenNotAllowed` | Token is not in allowlist |
| 8 | `MemoTooLong` | Memo exceeds maximum allowed length |
| 9 | `AmountTooLow` | Donation amount is below configured minimum |
| 10 | `AmountTooHigh` | Donation amount exceeds configured maximum |
| 11 | `NotDue` | Subscription is not yet due for charge |
| 12 | `SubscriptionNotActive` | Subscription is cancelled or inactive |
| 13 | `SubscriptionNotFound` | Subscription ID does not exist |
| 14 | `InvalidAmount` | Amount must be positive |
| 15 | `InvalidInterval` | Interval must be positive |
| 16 | `InvalidThreshold` | Multi-sig threshold is invalid |
| 17 | `EmptyAdminList` | Admin list cannot be empty |
| 18 | `ProposalNotFound` | Multi-sig proposal does not exist |
| 19 | `ProposalAlreadyExecuted` | Multi-sig proposal already executed |
| 20 | `AlreadyApproved` | Admin already approved proposal |
| 21 | `TimelockNotElapsed` | Multi-sig timelock has not passed |
| 22 | `ThresholdExceedsAdmins` | Multi-sig threshold exceeds admin count |
| 23 | `CannotRemoveAllAdmins` | Removal would leave zero admins |
| 24 | `MultiSigRequired` | Action requires multi-sig proposal |
| 25 | `ExecutorNotSet` | Contract executor is not set |
| 26 | `Overflow` | Numeric overflow or underflow |
| 27 | `InvalidGoal` | Invalid creator goal amount |

### `RegistryError` (`contracts/creator-registry`)
| Code | Error Variant | Description |
|---|---|---|
| 1 | `NotInitialized` | Registry is not initialized |
| 2 | `AlreadyInitialized` | Registry already initialized |
| 3 | `Unauthorized` | Caller lacks authorization |
| 4 | `AlreadyRegistered` | Creator is already registered |
| 5 | `InvalidAmount` | Invalid amount |
| 6 | `InvalidThreshold` | Multi-sig threshold is invalid |
| 7 | `EmptyAdminList` | Admin list cannot be empty |
| 8 | `ProposalNotFound` | Multi-sig proposal does not exist |
| 9 | `ProposalAlreadyExecuted` | Multi-sig proposal already executed |
| 10 | `AlreadyApproved` | Admin already approved proposal |
| 11 | `TimelockNotElapsed` | Multi-sig timelock has not passed |
| 12 | `ThresholdExceedsAdmins` | Multi-sig threshold exceeds admin count |
| 13 | `CannotRemoveAllAdmins` | Removal would leave zero admins |
| 14 | `MultiSigRequired` | Action requires multi-sig proposal |
| 15 | `CallerNotAuthorized` | Caller not authorized for registry action |
| 16 | `InvalidGoal` | Invalid goal amount |
| 17 | `Overflow` | Arithmetic overflow |

## Security Considerations

1. **Authentication**: All state-changing operations require auth
2. **Validation**: Amounts must be positive
3. **Creator Flexibility**: Creators don't need to pre-register to receive donations
4. **Immutability**: All donation records are immutable once recorded

## Deployment and initialization

The contract has no `initialize` entry point. It is configured by its
constructor, which runs inside the deploy transaction, so nobody can front-run
the deployer to claim the admin set:

```rust
pub fn __constructor(
    env: Env,
    admins: Vec<Address>,   // first entry is the primary admin
    threshold: u32,         // 1..=admins.len()
    timelock_delay: u64,    // seconds
    registry: Address,      // CreatorRegistry contract ID
)
```

The creator-registry contract takes the same arguments, with
`donation_contract` in place of `registry`. Since each contract needs the
other's ID, `make deploy` derives the registry ID from a salt, deploys this
contract with it, then deploys the registry at that salt:

```bash
make deploy SOURCE=<deployer-key-alias> ADMINS='["<ADMIN_ADDRESS>"]'
# multi-admin:
make deploy SOURCE=<deployer-key-alias> \
  ADMINS='["<ADMIN_1>","<ADMIN_2>","<ADMIN_3>"]' THRESHOLD=2 TIMELOCK_DELAY=86400
```

`NETWORK` defaults to `testnet`; pass `SALT=<64 hex chars>` to reuse a recorded
salt. See [`docs/contract-deploy-workflow.md`](../../docs/contract-deploy-workflow.md)
for the manual CLI steps and verification.

## Keeping the contract live

Admins, threshold, registry, executor, the pause flag and the token allowlist
live in instance storage. Every state-changing call extends the instance TTL
to ~30 days whenever less than ~29 days remain (`INSTANCE_BUMP_AMOUNT` /
`INSTANCE_LIFETIME_THRESHOLD` in the `common` crate). During quiet periods,
call the permissionless `bump()` on both contracts on a schedule so they are
not archived.

## Building

```bash
make build
```

## Testing

```bash
make test
```

## Future Enhancements

- Batch donations
- Donation search/filtering
- Creator tiers and perks
- Donation escrow with milestone-based release
- Integration with payment channels
- Multi-token support
- Creator rankings and leaderboards
