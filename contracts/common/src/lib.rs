#![no_std]

//! Shared data types for the SupportMe contracts. Kept in their own crate so
//! that `donation` and `creator-registry` agree on a single, canonical
//! definition and can exchange values across contract calls.
//!
//! # Instance TTL
//!
//! Both contracts keep their critical configuration (admin set, threshold,
//! timelock, registry / donation contract address, executor, pause flag and
//! token allowlist) in instance storage. Instance storage shares a single TTL
//! with the contract instance, and extending it also extends the contract's
//! Wasm code entry. If that TTL lapses during a quiet period the contract is
//! archived and every call fails until someone submits a restore operation.
//!
//! To prevent that, every state-changing entry point calls
//! [`extend_instance_ttl`], and each contract exposes a permissionless
//! `bump()` that an off-chain scheduler (e.g. the backend executor) can call
//! during long idle periods:
//!
//! - [`INSTANCE_BUMP_AMOUNT`]: the TTL (in ledgers) the instance is extended
//!   to, ~30 days at 5s/ledger.
//! - [`INSTANCE_LIFETIME_THRESHOLD`]: the extension is only written once the
//!   remaining TTL falls below this (~29 days), so normal usage does not pay
//!   for a rent bump on every call.

use soroban_sdk::{contracttype, Address, Env, String, Vec};

/// Approximate number of ledgers per day (5 second close time).
pub const DAY_IN_LEDGERS: u32 = 17_280;
/// TTL, in ledgers, that the contract instance is extended to (~30 days).
pub const INSTANCE_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
/// Remaining TTL, in ledgers, below which the instance is re-extended.
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Extends the TTL of the current contract's instance storage (and Wasm code)
/// to [`INSTANCE_BUMP_AMOUNT`] when it has fallen below
/// [`INSTANCE_LIFETIME_THRESHOLD`].
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct DonationRecord {
    pub donor: Address,
    pub creator: Address,
    /// Gross amount the donor sent. The creator receives `amount -
    /// fee_amount`; the platform fee address receives `fee_amount`.
    pub amount: i128,
    /// Portion of `amount` routed to the platform fee address. Zero when no
    /// platform fee is configured.
    pub fee_amount: i128,
    pub memo: String,
    pub timestamp: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct CreatorProfile {
    pub address: Address,
    pub username: String,
    pub total_donations: i128,
    pub donation_count: u32,
    pub created_at: u64,
}

/// A recurring donation. The supporter grants the donation contract a SAC
/// allowance (via the token contract's own `approve`) covering `amount` per
/// `interval_secs`; the donation contract then draws on that allowance via
/// `transfer_from` once per interval, on or after `next_charge_at`.
#[derive(Clone)]
#[contracttype]
pub struct Subscription {
    pub supporter: Address,
    pub creator: Address,
    pub token: Address,
    pub amount: i128,
    pub interval_secs: u64,
    pub next_charge_at: u64,
    pub active: bool,
}

/// Validates the initial admin set passed to a contract constructor: the list
/// must be non-empty and free of duplicates, and `threshold` must be between 1
/// and the number of admins.
pub fn validate_admin_set(admins: &Vec<Address>, threshold: u32) {
    assert!(admins.len() > 0, "admin list cannot be empty");
    assert!(
        threshold > 0 && threshold <= admins.len(),
        "invalid signature threshold"
    );
    for i in 0..admins.len() {
        let admin = admins.get(i).unwrap();
        for j in (i + 1)..admins.len() {
            assert!(
                admins.get(j).unwrap() != admin,
                "duplicate admin in admin list"
            );
        }
    }
}

/// Administrative actions that require multi-signature approval and timelock.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum AdminAction {
    SetExecutor(Address),
    SetDonationContract(Address),
    AddAdmin(Address),
    RemoveAdmin(Address),
    SetThreshold(u32),
    Pause,
    Unpause,
}

/// Proposal for sensitive multi-signature administrative changes.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct AdminProposal {
    pub id: u64,
    pub action: AdminAction,
    pub proposer: Address,
    pub approvals_count: u32,
    pub created_at: u64,
    pub eta: u64,
    pub executed: bool,
}
