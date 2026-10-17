#![no_std]

//! Shared data types for the SupportMe contracts. Kept in their own crate so
//! that `donation` and `creator-registry` agree on a single, canonical
//! definition and can exchange values across contract calls.

use soroban_sdk::{contracttype, Address, String};

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
#[derive(Clone, Debug, Eq, PartialEq)]
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
