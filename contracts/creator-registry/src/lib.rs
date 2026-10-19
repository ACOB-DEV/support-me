#![no_std]

//! CreatorRegistry: owns creator profile state (username, lifetime totals).
//!
//! The `donation` contract is the only party allowed to call
//! `record_donation` — it does so via a cross-contract call after it moves
//! funds from a donor to a creator, so this registry's stats always stay in
//! sync with real on-chain transfers.
//!
//! Multi-signature and timelock governance:
//! High-risk administrative actions (repointing the donation contract,
//! rotating admins, modifying threshold) require multi-signature approval and
//! timelock delay before execution. Only `SetDonationContract`, `AddAdmin`,
//! `RemoveAdmin` and `SetThreshold` apply to the registry; any other action is
//! rejected at proposal time with [`RegistryError::UnsupportedAction`].
//!
//! Initialization happens atomically at deploy time through `__constructor`;
//! there is no separate public initializer that could be front-run.
//!
//! Usernames are 1-[`MAX_USERNAME_LENGTH`] bytes of `a-z`, `0-9`, `_` or `-`
//! and are unique: a `(USERNAME_KEY, username) -> Address` index backs
//! `get_creator_by_username`.
//!
//! Instance TTL is extended on every state-changing call; see the `common`
//! crate docs for the TTL constants.

use common::{
    extend_instance_ttl, extend_persistent_ttl, validate_admin_set, AdminAction, AdminProposal,
    CreatorProfile, ADMIN_PROPOSAL_TTL_SECONDS,
};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, panic_with_error, symbol_short, Address,
    Env, String, Symbol, Vec,
};

const ADMIN_KEY: Symbol = symbol_short!("admin");
const ADMINS_KEY: Symbol = symbol_short!("admins");
const THRESHOLD_KEY: Symbol = symbol_short!("thresh");
const TIMELOCK_DELAY_KEY: Symbol = symbol_short!("delay");
const PROPOSAL_COUNTER_KEY: Symbol = symbol_short!("prop_ctr");
const PROPOSAL_KEY: Symbol = symbol_short!("proposal");
const APPROVAL_KEY: Symbol = symbol_short!("approval");
const CANCEL_KEY: Symbol = symbol_short!("cancel");
const DONATION_KEY: Symbol = symbol_short!("don_ctr");
const GOAL_KEY: Symbol = symbol_short!("goal");
const USERNAME_KEY: Symbol = symbol_short!("uname");

/// Maximum username length, in bytes.
pub const MAX_USERNAME_LENGTH: u32 = 32;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    EmptyUsername = 1,
    UsernameTooLong = 2,
    InvalidUsernameChars = 3,
    UsernameTaken = 4,
    UnsupportedAction = 5,
}

/// Emitted whenever a new creator profile is registered.
#[contractevent(topics = ["created"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreatedEvent {
    #[topic]
    pub creator: Address,
    pub username: String,
}

/// Emitted when an admin proposal is created.
#[contractevent(topics = ["prop_created"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCreatedEvent {
    pub proposal_id: u64,
    #[topic]
    pub proposer: Address,
    pub eta: u64,
}

/// Emitted when an admin proposal receives an approval.
#[contractevent(topics = ["prop_approved"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalApprovedEvent {
    pub proposal_id: u64,
    #[topic]
    pub admin: Address,
    pub approvals_count: u32,
}

/// Emitted when an admin proposal is executed.
#[contractevent(topics = ["prop_exec"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalExecutedEvent {
    pub proposal_id: u64,
    #[topic]
    pub executor: Address,
}

/// Emitted when an admin proposal is cancelled — either unilaterally by its
/// proposer or after `threshold` current admins requested the cancellation.
#[contractevent(topics = ["prop_cancelled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCancelledEvent {
    pub proposal_id: u64,
    #[topic]
    pub cancelled_by: Address,
}

#[contractevent(topics = ["goal_upd"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GoalUpdatedEvent {
    #[topic]
    pub creator: Address,
    pub goal_amount: i128,
    pub updated_at: u64,
}

#[contractevent(topics = ["don_rec"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DonationRecordedEvent {
    #[topic]
    pub creator: Address,
    pub amount: i128,
    pub total_donations: i128,
    pub donation_count: u32,
}

#[contract]
pub struct CreatorRegistryContract;

#[contractimpl]
impl CreatorRegistryContract {
    /// Runs atomically as part of deployment, so no one can race the deployer
    /// to claim the admin set. `donation_contract` is the only address that
    /// will be permitted to call `record_donation`; `admins[0]` is the primary
    /// admin used by the 1-of-1 `set_donation_contract` shortcut.
    pub fn __constructor(
        env: Env,
        admins: Vec<Address>,
        threshold: u32,
        timelock_delay: u64,
        donation_contract: Address,
    ) {
        validate_admin_set(&admins, threshold);

        let primary_admin = admins.get(0).unwrap();
        env.storage().instance().set(&ADMIN_KEY, &primary_admin);
        env.storage().instance().set(&ADMINS_KEY, &admins);
        env.storage().instance().set(&THRESHOLD_KEY, &threshold);
        env.storage()
            .instance()
            .set(&TIMELOCK_DELAY_KEY, &timelock_delay);
        env.storage()
            .instance()
            .set(&DONATION_KEY, &donation_contract);
        extend_instance_ttl(&env);
    }

    /// Permissionless keep-alive: extends the instance TTL so the registry is
    /// not archived during long periods without other state-changing calls.
    pub fn bump(env: Env) {
        extend_instance_ttl(&env);
    }

    /// Returns whether a given address is an authorized contract admin.
    pub fn is_admin(env: Env, address: Address) -> bool {
        let admins: Vec<Address> = env
            .storage()
            .instance()
            .get(&ADMINS_KEY)
            .unwrap_or_else(|| Vec::new(&env));
        Self::contains_address(&admins, &address)
    }

    /// Recounts `key` votes for `proposal_id` against the *current* admin set
    /// (`ADMINS_KEY`), so approvals (or cancellation requests) cast by an
    /// admin who has since been removed no longer count toward the threshold.
    /// Used at execution instead of trusting the cached `approvals_count`.
    fn count_current_admin_votes(env: &Env, key: Symbol, proposal_id: u64) -> u32 {
        let admins: Vec<Address> = env
            .storage()
            .instance()
            .get(&ADMINS_KEY)
            .unwrap_or_else(|| Vec::new(env));
        let mut votes: u32 = 0;
        for i in 0..admins.len() {
            let admin = admins.get(i).unwrap();
            let voted: bool = env
                .storage()
                .persistent()
                .get(&(key.clone(), proposal_id, admin))
                .unwrap_or(false);
            if voted {
                votes = votes.checked_add(1).expect("vote count overflow");
            }
        }
        votes
    }

    /// Retrieves an admin proposal by ID.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<AdminProposal> {
        env.storage().persistent().get(&(PROPOSAL_KEY, proposal_id))
    }

    /// Proposes a multi-signature administrative action.
    pub fn propose_admin_action(env: Env, proposer: Address, action: AdminAction) -> u64 {
        proposer.require_auth();
        assert!(
            Self::is_admin(env.clone(), proposer.clone()),
            "proposer is not an admin"
        );
        if !Self::is_supported_action(&action) {
            panic_with_error!(&env, RegistryError::UnsupportedAction);
        }
        extend_instance_ttl(&env);

        let prop_id: u64 = env
            .storage()
            .persistent()
            .get(&PROPOSAL_COUNTER_KEY)
            .unwrap_or(0);
        let timelock: u64 = env
            .storage()
            .instance()
            .get(&TIMELOCK_DELAY_KEY)
            .unwrap_or(0);
        let now = env.ledger().timestamp();
        let eta = now.checked_add(timelock).expect("proposal eta overflow");
        let expires_at = now
            .checked_add(ADMIN_PROPOSAL_TTL_SECONDS)
            .expect("proposal expiry overflow");

        let proposal = AdminProposal {
            id: prop_id,
            action,
            proposer: proposer.clone(),
            approvals_count: 1,
            created_at: now,
            eta,
            expires_at,
            executed: false,
            cancelled: false,
        };

        env.storage()
            .persistent()
            .set(&(PROPOSAL_KEY, prop_id), &proposal);
        env.storage()
            .persistent()
            .set(&(APPROVAL_KEY, prop_id, proposer.clone()), &true);
        env.storage().persistent().set(
            &PROPOSAL_COUNTER_KEY,
            &prop_id.checked_add(1).expect("proposal counter overflow"),
        );

        ProposalCreatedEvent {
            proposal_id: prop_id,
            proposer,
            eta,
        }
        .publish(&env);

        prop_id
    }

    /// Approves an existing administrative proposal.
    pub fn approve_admin_action(env: Env, admin: Address, proposal_id: u64) {
        admin.require_auth();
        assert!(
            Self::is_admin(env.clone(), admin.clone()),
            "caller is not an admin"
        );

        let mut proposal: AdminProposal = env
            .storage()
            .persistent()
            .get(&(PROPOSAL_KEY, proposal_id))
            .expect("proposal not found");
        assert!(!proposal.executed, "proposal already executed");

        let has_approved: bool = env
            .storage()
            .persistent()
            .get(&(APPROVAL_KEY, proposal_id, admin.clone()))
            .unwrap_or(false);
        assert!(!has_approved, "admin has already approved this proposal");
        extend_instance_ttl(&env);

        env.storage()
            .persistent()
            .set(&(APPROVAL_KEY, proposal_id, admin.clone()), &true);
        proposal.approvals_count = proposal
            .approvals_count
            .checked_add(1)
            .expect("approvals count overflow");
        env.storage()
            .persistent()
            .set(&(PROPOSAL_KEY, proposal_id), &proposal);

        ProposalApprovedEvent {
            proposal_id,
            admin,
            approvals_count: proposal.approvals_count,
        }
        .publish(&env);
    }

    /// Cancels an administrative proposal before it is executed. The proposer
    /// can cancel their own proposal unilaterally. Any other caller must be a
    /// current admin: each such admin records a cancellation request, counted
    /// against the *current* admin set exactly like approvals (requests from
    /// since-removed admins do not count), and the proposal is marked
    /// cancelled once `threshold` requests have been reached. Emits
    /// [`ProposalCancelledEvent`] when the proposal is marked cancelled.
    pub fn cancel_admin_action(env: Env, caller: Address, proposal_id: u64) {
        caller.require_auth();
        let mut proposal: AdminProposal = env
            .storage()
            .persistent()
            .get(&(PROPOSAL_KEY, proposal_id))
            .expect("proposal not found");
        assert!(!proposal.executed, "proposal already executed");
        assert!(!proposal.cancelled, "proposal already cancelled");
        extend_instance_ttl(&env);

        if caller != proposal.proposer {
            assert!(
                Self::is_admin(env.clone(), caller.clone()),
                "only the proposer or an admin can cancel a proposal"
            );
            let already_requested: bool = env
                .storage()
                .persistent()
                .get(&(CANCEL_KEY, proposal_id, caller.clone()))
                .unwrap_or(false);
            assert!(
                !already_requested,
                "admin has already requested cancellation"
            );
            env.storage()
                .persistent()
                .set(&(CANCEL_KEY, proposal_id, caller.clone()), &true);

            let requests = Self::count_current_admin_votes(&env, CANCEL_KEY, proposal_id);
            let threshold: u32 = env
                .storage()
                .instance()
                .get(&THRESHOLD_KEY)
                .expect("threshold not set");
            if requests < threshold {
                return;
            }
        }

        proposal.cancelled = true;
        env.storage()
            .persistent()
            .set(&(PROPOSAL_KEY, proposal_id), &proposal);

        ProposalCancelledEvent {
            proposal_id,
            cancelled_by: caller,
        }
        .publish(&env);
    }

    /// Executes an administrative proposal once signature threshold & timelock criteria are met.
    pub fn execute_admin_action(env: Env, executor: Address, proposal_id: u64) {
        executor.require_auth();
        assert!(
            Self::is_admin(env.clone(), executor.clone()),
            "caller is not an admin"
        );

        let mut proposal: AdminProposal = env
            .storage()
            .persistent()
            .get(&(PROPOSAL_KEY, proposal_id))
            .expect("proposal not found");
        assert!(!proposal.executed, "proposal already executed");
        assert!(!proposal.cancelled, "proposal has been cancelled");

        let threshold: u32 = env
            .storage()
            .instance()
            .get(&THRESHOLD_KEY)
            .expect("threshold not set");
        // Recount approvals from the current admin set: the cached
        // `approvals_count` may include votes from an admin who has since
        // been removed (e.g. after a key compromise), and those must not
        // tip the proposal over the threshold.
        let approvals = Self::count_current_admin_votes(&env, APPROVAL_KEY, proposal_id);
        assert!(
            approvals >= threshold,
            "insufficient signatures to execute proposal"
        );

        let now = env.ledger().timestamp();
        assert!(
            now >= proposal.eta,
            "proposal timelock delay has not elapsed"
        );
        assert!(now <= proposal.expires_at, "proposal has expired");
        extend_instance_ttl(&env);

        match proposal.action.clone() {
            AdminAction::SetDonationContract(target) => {
                env.storage().instance().set(&DONATION_KEY, &target);
            }
            AdminAction::AddAdmin(new_admin) => {
                let mut admins: Vec<Address> = env.storage().instance().get(&ADMINS_KEY).unwrap();
                if !Self::contains_address(&admins, &new_admin) {
                    admins.push_back(new_admin);
                    env.storage().instance().set(&ADMINS_KEY, &admins);
                }
            }
            AdminAction::RemoveAdmin(old_admin) => {
                let admins: Vec<Address> = env.storage().instance().get(&ADMINS_KEY).unwrap();
                let mut new_admins = Vec::new(&env);
                for i in 0..admins.len() {
                    let a = admins.get(i).unwrap();
                    if a != old_admin {
                        new_admins.push_back(a);
                    }
                }
                assert!(!new_admins.is_empty(), "cannot remove all admins");
                let threshold: u32 = env.storage().instance().get(&THRESHOLD_KEY).unwrap();
                assert!(
                    threshold <= new_admins.len(),
                    "threshold exceeds remaining admin count"
                );
                env.storage().instance().set(&ADMINS_KEY, &new_admins);
            }
            AdminAction::SetThreshold(new_threshold) => {
                let admins: Vec<Address> = env.storage().instance().get(&ADMINS_KEY).unwrap();
                assert!(
                    new_threshold > 0 && new_threshold <= admins.len(),
                    "invalid new threshold"
                );
                env.storage().instance().set(&THRESHOLD_KEY, &new_threshold);
            }
            // Rejected in `propose_admin_action`; refuse to mark them executed
            // in case one was stored before that check existed.
            AdminAction::SetExecutor(_) | AdminAction::Pause | AdminAction::Unpause => {
                panic_with_error!(&env, RegistryError::UnsupportedAction);
            }
        }

        proposal.executed = true;
        env.storage()
            .persistent()
            .set(&(PROPOSAL_KEY, proposal_id), &proposal);

        ProposalExecutedEvent {
            proposal_id,
            executor,
        }
        .publish(&env);
    }

    /// Point the registry at a new donation contract (e.g. after a
    /// redeployment). Enforces multi-sig when threshold > 1.
    pub fn set_donation_contract(env: Env, donation_contract: Address) {
        let threshold: u32 = env.storage().instance().get(&THRESHOLD_KEY).unwrap_or(1);
        if threshold == 1 {
            let admin: Address = env
                .storage()
                .instance()
                .get(&ADMIN_KEY)
                .expect("registry not initialized");
            admin.require_auth();
            env.storage()
                .instance()
                .set(&DONATION_KEY, &donation_contract);
            extend_instance_ttl(&env);
        } else {
            panic!("multi-sig required: use propose_admin_action to set donation contract");
        }
    }

    /// Register a new creator profile. Must be signed by the creator.
    /// `username` must be 1-`MAX_USERNAME_LENGTH` bytes of `a-z`, `0-9`, `_`
    /// or `-`, and not already taken by another creator.
    pub fn register_creator(env: Env, creator: Address, username: String) -> CreatorProfile {
        creator.require_auth();
        Self::validate_username(&env, &username);
        let username_key = (USERNAME_KEY, username.clone());
        if env.storage().persistent().has(&username_key) {
            panic_with_error!(&env, RegistryError::UsernameTaken);
        }
        extend_instance_ttl(&env);

        let profile = if let Some(p) = env
            .storage()
            .persistent()
            .get::<_, CreatorProfile>(&creator)
        {
            // If the profile exists, it must be a placeholder created by record_donation
            assert!(p.username.is_empty(), "creator already registered");
            CreatorProfile {
                address: creator.clone(),
                username: username.clone(),
                total_donations: p.total_donations,
                donation_count: p.donation_count,
                created_at: p.created_at,
            }
        } else {
            CreatorProfile {
                address: creator.clone(),
                username: username.clone(),
                total_donations: 0,
                donation_count: 0,
                created_at: env.ledger().timestamp(),
            }
        };

        env.storage().persistent().set(&creator, &profile);
        env.storage().persistent().set(&username_key, &creator);
        extend_persistent_ttl(&env, &creator);
        extend_persistent_ttl(&env, &username_key);
        CreatedEvent { creator, username }.publish(&env);

        profile
    }

    /// Read a creator's profile, if one exists.
    pub fn get_creator(env: Env, creator: Address) -> Option<CreatorProfile> {
        let profile = env
            .storage()
            .persistent()
            .get::<_, CreatorProfile>(&creator);
        if let Some(p) = profile {
            if !p.username.is_empty() {
                return Some(p);
            }
        }
        None
    }

    /// Look up a registered creator's profile by username.
    pub fn get_creator_by_username(env: Env, username: String) -> Option<CreatorProfile> {
        let creator: Address = env.storage().persistent().get(&(USERNAME_KEY, username))?;
        Self::get_creator(env, creator)
    }

    /// Cross-contract entry point: only the authorized donation contract may
    /// call this, and only to report a donation it just settled on-chain.
    pub fn record_donation(env: Env, caller: Address, creator: Address, amount: i128) {
        caller.require_auth();

        let authorized_donation_contract: Address = env
            .storage()
            .instance()
            .get(&DONATION_KEY)
            .expect("registry not initialized");
        assert_eq!(
            caller, authorized_donation_contract,
            "caller is not the authorized donation contract"
        );
        assert!(amount > 0, "amount must be positive");
        extend_instance_ttl(&env);

        let mut profile = env
            .storage()
            .persistent()
            .get::<_, CreatorProfile>(&creator)
            .unwrap_or_else(|| CreatorProfile {
                address: creator.clone(),
                username: String::from_bytes(&env, &[]),
                total_donations: 0,
                donation_count: 0,
                created_at: env.ledger().timestamp(),
            });

        profile.total_donations = profile
            .total_donations
            .checked_add(amount)
            .expect("total donations overflow");
        profile.donation_count = profile
            .donation_count
            .checked_add(1)
            .expect("donation count overflow");

        env.storage().persistent().set(&creator, &profile);
        // The profile is the sole on-chain source of a creator's lifetime
        // totals: renew it (and the username index and goal that belong to
        // it) on every read-modify-write so an inactive creator's history is
        // never silently reset to a fresh placeholder.
        Self::extend_creator_entries(&env, &creator, &profile);

        // Emit event with full payload so downstream backends/indexers can
        // reconcile lifetime statistics without extra RPC calls.
        DonationRecordedEvent {
            creator,
            amount,
            total_donations: profile.total_donations,
            donation_count: profile.donation_count,
        }
        .publish(&env);
    }

    /// Sets or updates a creator's funding goal. Must be authenticated by the creator.
    pub fn set_goal(env: Env, creator: Address, goal_amount: i128) {
        creator.require_auth();
        assert!(goal_amount >= 0, "Goal amount cannot be negative");
        extend_instance_ttl(&env);

        env.storage()
            .persistent()
            .set(&(GOAL_KEY, creator.clone()), &goal_amount);
        extend_persistent_ttl(&env, &(GOAL_KEY, creator.clone()));

        GoalUpdatedEvent {
            creator,
            goal_amount,
            updated_at: env.ledger().timestamp(),
        }
        .publish(&env);
    }

    /// Permissionless keep-alive for a creator's persistent entries (profile,
    /// username index and goal). Intended to be called on a schedule by the
    /// backend for creators with no recent activity. It only extends TTLs, and
    /// only once they drop below the threshold, so repeated calls are cheap
    /// and cannot be used to grief the contract. A no-op for unknown creators.
    pub fn bump_creator(env: Env, creator: Address) {
        extend_instance_ttl(&env);
        if let Some(profile) = env
            .storage()
            .persistent()
            .get::<_, CreatorProfile>(&creator)
        {
            Self::extend_creator_entries(&env, &creator, &profile);
        }
    }

    /// Reads a creator's funding goal, if set.
    pub fn get_goal(env: Env, creator: Address) -> Option<i128> {
        env.storage().persistent().get(&(GOAL_KEY, creator))
    }

    /// Extends the TTL of a creator's profile, its username index entry (when
    /// registered) and its goal (when set).
    fn extend_creator_entries(env: &Env, creator: &Address, profile: &CreatorProfile) {
        extend_persistent_ttl(env, creator);
        if !profile.username.is_empty() {
            extend_persistent_ttl(env, &(USERNAME_KEY, profile.username.clone()));
        }
        let goal_key = (GOAL_KEY, creator.clone());
        if env.storage().persistent().has(&goal_key) {
            extend_persistent_ttl(env, &goal_key);
        }
    }

    /// Whether `action` has an effect on the registry. Exhaustive on purpose:
    /// adding an `AdminAction` variant must force a decision here.
    fn is_supported_action(action: &AdminAction) -> bool {
        match action {
            AdminAction::SetDonationContract(_)
            | AdminAction::AddAdmin(_)
            | AdminAction::RemoveAdmin(_)
            | AdminAction::SetThreshold(_) => true,
            AdminAction::SetExecutor(_) | AdminAction::Pause | AdminAction::Unpause => false,
        }
    }

    fn validate_username(env: &Env, username: &String) {
        let len = username.len();
        if len == 0 {
            panic_with_error!(env, RegistryError::EmptyUsername);
        }
        if len > MAX_USERNAME_LENGTH {
            panic_with_error!(env, RegistryError::UsernameTooLong);
        }
        let mut buf = [0u8; MAX_USERNAME_LENGTH as usize];
        let bytes = &mut buf[..len as usize];
        username.copy_into_slice(bytes);
        for b in bytes.iter() {
            if !matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-') {
                panic_with_error!(env, RegistryError::InvalidUsernameChars);
            }
        }
    }

    fn contains_address(vec: &Vec<Address>, target: &Address) -> bool {
        for i in 0..vec.len() {
            if vec.get(i).unwrap() == *target {
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use common::{
        INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD, PERSISTENT_BUMP_AMOUNT,
        PERSISTENT_LIFETIME_THRESHOLD,
    };
    use soroban_sdk::testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Ledger,
    };
    use soroban_sdk::{vec, IntoVal, Val};

    /// Deploys a 1-of-1 registry whose authorized donation contract is a
    /// generated address. Returns (client, admin, donation_contract).
    fn setup(env: &Env) -> (CreatorRegistryContractClient<'_>, Address, Address) {
        let admin = Address::generate(env);
        let donation_contract = Address::generate(env);
        let contract_id = env.register(
            CreatorRegistryContract,
            (
                vec![env, admin.clone()],
                1u32,
                0u64,
                donation_contract.clone(),
            ),
        );
        (
            CreatorRegistryContractClient::new(env, &contract_id),
            admin,
            donation_contract,
        )
    }

    fn s(env: &Env, value: &str) -> String {
        String::from_str(env, value)
    }

    #[test]
    fn test_register_creator() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);

        let creator = Address::generate(&env);
        env.ledger().with_mut(|li| li.sequence_number = 100);

        let profile = client.register_creator(&creator, &s(&env, "awesome_dev"));

        assert_eq!(profile.donation_count, 0);
        assert_eq!(profile.total_donations, 0);
    }

    #[test]
    #[should_panic(expected = "creator already registered")]
    fn test_register_creator_twice_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);

        let creator = Address::generate(&env);
        client.register_creator(&creator, &s(&env, "awesome_dev"));
        client.register_creator(&creator, &s(&env, "another_name"));
    }

    #[test]
    fn test_register_creator_rejects_empty_username() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);

        let creator = Address::generate(&env);
        assert_eq!(
            client.try_register_creator(&creator, &s(&env, "")),
            Err(Ok(RegistryError::EmptyUsername.into()))
        );
        assert!(client.get_creator(&creator).is_none());
    }

    #[test]
    fn test_register_creator_rejects_too_long_username() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);

        let creator = Address::generate(&env);
        let max = s(&env, "abcdefghijklmnopqrstuvwxyz012345");
        let too_long = s(&env, "abcdefghijklmnopqrstuvwxyz0123456");
        assert_eq!(max.len(), MAX_USERNAME_LENGTH);

        assert_eq!(
            client.try_register_creator(&creator, &too_long),
            Err(Ok(RegistryError::UsernameTooLong.into()))
        );
        client.register_creator(&creator, &max);
    }

    #[test]
    fn test_register_creator_rejects_invalid_charset() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);

        let creator = Address::generate(&env);
        for bad in ["Alice", "a b", "dev!", "dev.eth", "émile", "a/b"] {
            assert_eq!(
                client.try_register_creator(&creator, &s(&env, bad)),
                Err(Ok(RegistryError::InvalidUsernameChars.into())),
                "{bad} should be rejected"
            );
        }
        client.register_creator(&creator, &s(&env, "dev_2-ok"));
    }

    #[test]
    fn test_register_creator_rejects_duplicate_username() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);

        let alice = Address::generate(&env);
        let mallory = Address::generate(&env);
        client.register_creator(&alice, &s(&env, "alice"));

        assert_eq!(
            client.try_register_creator(&mallory, &s(&env, "alice")),
            Err(Ok(RegistryError::UsernameTaken.into()))
        );
        assert!(client.get_creator(&mallory).is_none());
        assert_eq!(
            client
                .get_creator_by_username(&s(&env, "alice"))
                .unwrap()
                .address,
            alice
        );
    }

    #[test]
    fn test_get_creator_by_username() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);

        let creator = Address::generate(&env);
        assert!(client.get_creator_by_username(&s(&env, "dev")).is_none());

        client.register_creator(&creator, &s(&env, "dev"));
        let profile = client.get_creator_by_username(&s(&env, "dev")).unwrap();
        assert_eq!(profile.address, creator);
        assert_eq!(profile.username, s(&env, "dev"));
    }

    #[test]
    fn test_record_donation_updates_stats() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, donation_contract) = setup(&env);
        let creator = Address::generate(&env);

        client.record_donation(&donation_contract, &creator, &1000);
        client.record_donation(&donation_contract, &creator, &500);

        assert!(client.get_creator(&creator).is_none());

        client.register_creator(&creator, &s(&env, "dev"));
        let profile = client.get_creator(&creator).unwrap();
        assert_eq!(profile.total_donations, 1500);
        assert_eq!(profile.donation_count, 2);
    }

    #[test]
    #[should_panic(expected = "caller is not the authorized donation contract")]
    fn test_record_donation_rejects_unauthorized_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);

        let impostor = Address::generate(&env);
        let creator = Address::generate(&env);
        client.record_donation(&impostor, &creator, &1000);
    }

    #[test]
    fn test_constructor_sets_admins_atomically() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);
        assert!(client.is_admin(&admin));
        assert!(!client.is_admin(&Address::generate(&env)));
    }

    #[test]
    #[should_panic(expected = "invalid signature threshold")]
    fn test_constructor_rejects_threshold_above_admin_count() {
        let env = Env::default();
        let admin = Address::generate(&env);
        env.register(
            CreatorRegistryContract,
            (vec![&env, admin], 2u32, 0u64, Address::generate(&env)),
        );
    }

    #[test]
    #[should_panic(expected = "duplicate admin in admin list")]
    fn test_constructor_rejects_duplicate_admins() {
        let env = Env::default();
        let admin = Address::generate(&env);
        env.register(
            CreatorRegistryContract,
            (
                vec![&env, admin.clone(), admin],
                2u32,
                0u64,
                Address::generate(&env),
            ),
        );
    }

    #[test]
    fn test_no_init_entry_point_callable_after_deploy() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _) = setup(&env);

        let attacker = Address::generate(&env);
        let attacker_donation = Address::generate(&env);
        let attacker_admins = vec![&env, attacker.clone()];

        let attempts: [(&str, Vec<Val>); 3] = [
            (
                "initialize",
                (attacker.clone(), attacker_donation.clone()).into_val(&env),
            ),
            (
                "initialize_multisig",
                (
                    attacker_admins.clone(),
                    1u32,
                    0u64,
                    attacker_donation.clone(),
                )
                    .into_val(&env),
            ),
            (
                "__constructor",
                (attacker_admins, 1u32, 0u64, attacker_donation.clone()).into_val(&env),
            ),
        ];
        for (name, args) in attempts {
            let res = env.try_invoke_contract::<Val, soroban_sdk::Error>(
                &client.address,
                &Symbol::new(&env, name),
                args,
            );
            assert!(res.is_err(), "{name} must not be callable after deploy");
        }

        assert!(client.is_admin(&admin));
        assert!(!client.is_admin(&attacker));
    }

    #[test]
    fn test_registry_multisig_set_donation_contract() {
        let env = Env::default();
        env.mock_all_auths();

        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let initial_donation = Address::generate(&env);
        let new_donation = Address::generate(&env);

        let contract_id = env.register(
            CreatorRegistryContract,
            (
                vec![&env, admin1.clone(), admin2.clone()],
                2u32,
                50u64,
                initial_donation,
            ),
        );
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let prop_id = client.propose_admin_action(
            &admin1,
            &AdminAction::SetDonationContract(new_donation.clone()),
        );

        let prop = client.get_proposal(&prop_id).unwrap();
        assert_eq!(prop.approvals_count, 1);
        assert!(!prop.executed);

        client.approve_admin_action(&admin2, &prop_id);

        // Advance ledger past timelock
        env.ledger().with_mut(|li| li.timestamp = 60);

        client.execute_admin_action(&admin1, &prop_id);

        let prop_after = client.get_proposal(&prop_id).unwrap();
        assert!(prop_after.executed);

        // The new donation contract is now the only authorized recorder.
        client.record_donation(&new_donation, &Address::generate(&env), &10);
    }

    #[test]
    fn test_propose_unsupported_actions_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _) = setup(&env);

        for action in [
            AdminAction::Pause,
            AdminAction::Unpause,
            AdminAction::SetExecutor(Address::generate(&env)),
        ] {
            assert_eq!(
                client.try_propose_admin_action(&admin, &action),
                Err(Ok(RegistryError::UnsupportedAction.into()))
            );
        }
        assert!(client.get_proposal(&0).is_none());
    }

    #[test]
    fn test_execute_refuses_stored_unsupported_action() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _) = setup(&env);

        // Simulate a Pause proposal persisted before proposal-time validation
        // existed: execution must fail instead of marking it executed.
        env.as_contract(&client.address, || {
            let proposal = AdminProposal {
                id: 0,
                action: AdminAction::Pause,
                proposer: admin.clone(),
                approvals_count: 1,
                created_at: 0,
                eta: 0,
                expires_at: 0,
                executed: false,
                cancelled: false,
            };
            env.storage()
                .persistent()
                .set(&(PROPOSAL_KEY, 0u64), &proposal);
            // Execution recounts approvals from storage instead of trusting
            // `approvals_count`, so the fixture also needs the proposer's
            // approval entry — as `propose_admin_action` would have written.
            env.storage()
                .persistent()
                .set(&(APPROVAL_KEY, 0u64, admin.clone()), &true);
        });

        assert_eq!(
            client.try_execute_admin_action(&admin, &0),
            Err(Ok(RegistryError::UnsupportedAction.into()))
        );
        assert!(!client.get_proposal(&0).unwrap().executed);
    }

    #[test]
    fn test_register_creator_after_donation() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, donation_contract) = setup(&env);
        let creator = Address::generate(&env);

        // Donation comes first, creating a placeholder profile
        client.record_donation(&donation_contract, &creator, &1000);

        assert!(client.get_creator(&creator).is_none());

        // Now the creator registers
        let profile = client.register_creator(&creator, &s(&env, "late_dev"));

        assert_eq!(profile.username, s(&env, "late_dev"));
        assert_eq!(profile.total_donations, 1000);
        assert_eq!(profile.donation_count, 1);

        let fetched = client.get_creator(&creator).unwrap();
        assert_eq!(fetched.username, s(&env, "late_dev"));
        assert_eq!(fetched.total_donations, 1000);
    }

    #[test]
    #[should_panic(expected = "total donations overflow")]
    fn test_record_donation_total_overflow_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, donation_contract) = setup(&env);
        let creator = Address::generate(&env);

        client.record_donation(&donation_contract, &creator, &i128::MAX);
        client.record_donation(&donation_contract, &creator, &1);
    }

    fn instance_ttl(env: &Env, contract: &Address) -> u32 {
        env.as_contract(contract, || env.storage().instance().get_ttl())
    }

    #[test]
    fn test_instance_ttl_survives_past_default_ttl_with_usage() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, donation_contract) = setup(&env);
        let creator = Address::generate(&env);

        assert!(instance_ttl(&env, &client.address) >= INSTANCE_LIFETIME_THRESHOLD);

        // Advance well beyond the default instance TTL (and two full bump
        // periods) in steps, using the contract in between. The test host does
        // not reject reads of archived entries, so liveness is asserted via the
        // remaining TTL after each step.
        let default_ttl = env.ledger().get().min_persistent_entry_ttl;
        let step = default_ttl.max(INSTANCE_BUMP_AMOUNT - INSTANCE_LIFETIME_THRESHOLD + 1);
        for _ in 0..(2 * INSTANCE_BUMP_AMOUNT / step + 1) {
            env.ledger().with_mut(|li| li.sequence_number += step);
            client.record_donation(&donation_contract, &creator, &1);
            assert!(instance_ttl(&env, &client.address) >= INSTANCE_LIFETIME_THRESHOLD);
        }

        // Instance (and its config) is still live and readable.
        client.register_creator(&creator, &s(&env, "still_live"));
        assert!(client.get_creator(&creator).unwrap().donation_count > 1);
    }

    #[test]
    fn test_bump_extends_instance_ttl() {
        let env = Env::default();
        let (client, admin, _) = setup(&env);

        env.ledger()
            .with_mut(|li| li.sequence_number += INSTANCE_BUMP_AMOUNT - 2 * common::DAY_IN_LEDGERS);
        assert!(instance_ttl(&env, &client.address) < INSTANCE_LIFETIME_THRESHOLD);

        client.bump();
        assert_eq!(instance_ttl(&env, &client.address), INSTANCE_BUMP_AMOUNT);
        assert!(client.is_admin(&admin));
    }

    // ------------------------------------------------------------------
    // Persistent entry TTLs (#215)
    // ------------------------------------------------------------------

    fn persistent_ttl<K: IntoVal<Env, Val>>(env: &Env, contract: &Address, key: &K) -> u32 {
        env.as_contract(contract, || env.storage().persistent().get_ttl(key))
    }

    /// Ledgers to advance so a freshly extended persistent entry drops just
    /// below the extension threshold.
    const DECAY: u32 = PERSISTENT_BUMP_AMOUNT - PERSISTENT_LIFETIME_THRESHOLD + 1;

    #[test]
    fn test_register_creator_extends_profile_and_username_ttl() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);
        let creator = Address::generate(&env);

        client.register_creator(&creator, &s(&env, "ttl_user"));

        let username_key = (USERNAME_KEY, s(&env, "ttl_user"));
        assert_eq!(
            persistent_ttl(&env, &client.address, &creator),
            PERSISTENT_BUMP_AMOUNT
        );
        assert_eq!(
            persistent_ttl(&env, &client.address, &username_key),
            PERSISTENT_BUMP_AMOUNT
        );
    }

    #[test]
    fn test_record_donation_keeps_profile_history_alive_past_original_ttl() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, donation_contract) = setup(&env);
        let creator = Address::generate(&env);
        client.register_creator(&creator, &s(&env, "long_lived"));
        let username_key = (USERNAME_KEY, s(&env, "long_lived"));

        // Active just often enough to need a renewal each time, for far longer
        // than the original TTL. The test host does not reject reads of
        // archived entries, so liveness is asserted via the remaining TTL.
        let rounds = 2 * PERSISTENT_BUMP_AMOUNT / DECAY + 1;
        for _ in 0..rounds {
            env.ledger().with_mut(|li| li.sequence_number += DECAY);
            assert!(
                persistent_ttl(&env, &client.address, &creator) < PERSISTENT_LIFETIME_THRESHOLD
            );
            client.record_donation(&donation_contract, &creator, &10);
            assert_eq!(
                persistent_ttl(&env, &client.address, &creator),
                PERSISTENT_BUMP_AMOUNT
            );
            assert_eq!(
                persistent_ttl(&env, &client.address, &username_key),
                PERSISTENT_BUMP_AMOUNT
            );
        }

        // Total elapsed time is well past the original TTL, and nothing was reset.
        assert!(rounds * DECAY > PERSISTENT_BUMP_AMOUNT);
        let profile = client.get_creator(&creator).unwrap();
        assert_eq!(profile.username, s(&env, "long_lived"));
        assert_eq!(profile.donation_count, rounds);
        assert_eq!(profile.total_donations, 10 * rounds as i128);
        assert_eq!(
            client.get_creator_by_username(&s(&env, "long_lived")),
            Some(profile)
        );
    }

    #[test]
    fn test_record_donation_extends_placeholder_profile() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, donation_contract) = setup(&env);
        let creator = Address::generate(&env);

        client.record_donation(&donation_contract, &creator, &5);

        assert_eq!(
            persistent_ttl(&env, &client.address, &creator),
            PERSISTENT_BUMP_AMOUNT
        );
    }

    #[test]
    fn test_record_donation_also_renews_goal() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, donation_contract) = setup(&env);
        let creator = Address::generate(&env);
        client.set_goal(&creator, &1_000);
        let goal_key = (GOAL_KEY, creator.clone());
        assert_eq!(
            persistent_ttl(&env, &client.address, &goal_key),
            PERSISTENT_BUMP_AMOUNT
        );

        env.ledger().with_mut(|li| li.sequence_number += DECAY);
        assert!(persistent_ttl(&env, &client.address, &goal_key) < PERSISTENT_LIFETIME_THRESHOLD);
        client.record_donation(&donation_contract, &creator, &5);

        assert_eq!(
            persistent_ttl(&env, &client.address, &goal_key),
            PERSISTENT_BUMP_AMOUNT
        );
        assert_eq!(client.get_goal(&creator), Some(1_000));
    }

    #[test]
    fn test_set_goal_extends_goal_ttl() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);
        let creator = Address::generate(&env);
        let goal_key = (GOAL_KEY, creator.clone());

        client.set_goal(&creator, &500);
        env.ledger().with_mut(|li| li.sequence_number += DECAY);
        assert!(persistent_ttl(&env, &client.address, &goal_key) < PERSISTENT_LIFETIME_THRESHOLD);

        client.set_goal(&creator, &750);
        assert_eq!(
            persistent_ttl(&env, &client.address, &goal_key),
            PERSISTENT_BUMP_AMOUNT
        );
    }

    #[test]
    fn test_bump_creator_extends_idle_profile_without_changing_it() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, donation_contract) = setup(&env);
        let creator = Address::generate(&env);
        client.register_creator(&creator, &s(&env, "idle"));
        client.record_donation(&donation_contract, &creator, &42);
        client.set_goal(&creator, &9_000);
        let before = client.get_creator(&creator).unwrap();

        env.ledger().with_mut(|li| li.sequence_number += DECAY);
        let username_key = (USERNAME_KEY, s(&env, "idle"));
        let goal_key = (GOAL_KEY, creator.clone());
        assert!(persistent_ttl(&env, &client.address, &creator) < PERSISTENT_LIFETIME_THRESHOLD);

        // Permissionless: no auth is mocked for the keeper.
        client.bump_creator(&creator);

        assert_eq!(
            persistent_ttl(&env, &client.address, &creator),
            PERSISTENT_BUMP_AMOUNT
        );
        assert_eq!(
            persistent_ttl(&env, &client.address, &username_key),
            PERSISTENT_BUMP_AMOUNT
        );
        assert_eq!(
            persistent_ttl(&env, &client.address, &goal_key),
            PERSISTENT_BUMP_AMOUNT
        );
        assert_eq!(client.get_creator(&creator).unwrap(), before);
        assert_eq!(client.get_goal(&creator), Some(9_000));
    }

    #[test]
    fn test_bump_creator_is_a_noop_for_unknown_creators() {
        let env = Env::default();
        let (client, _, _) = setup(&env);
        let stranger = Address::generate(&env);

        client.bump_creator(&stranger);

        assert_eq!(client.get_creator(&stranger), None);
    }

    #[test]
    fn test_expired_proposal_cannot_execute() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _) = setup(&env);

        let target = Address::generate(&env);
        let prop_id =
            client.propose_admin_action(&admin, &AdminAction::SetDonationContract(target));

        let prop = client.get_proposal(&prop_id).unwrap();
        assert_eq!(prop.created_at, 0);
        assert_eq!(prop.expires_at, ADMIN_PROPOSAL_TTL_SECONDS);
        assert!(!prop.executed);

        // Well past the proposal's 7-day lifetime. The timelock (0) is long
        // satisfied, so expiry is the only gate that can refuse execution.
        env.ledger()
            .with_mut(|li| li.timestamp = ADMIN_PROPOSAL_TTL_SECONDS + 1);

        assert!(client.try_execute_admin_action(&admin, &prop_id).is_err());
        assert!(!client.get_proposal(&prop_id).unwrap().executed);
    }

    #[test]
    fn test_cancelled_proposal_cannot_execute() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _) = setup(&env);

        let target = Address::generate(&env);
        let prop_id =
            client.propose_admin_action(&admin, &AdminAction::SetDonationContract(target));

        client.cancel_admin_action(&admin, &prop_id);

        let prop = client.get_proposal(&prop_id).unwrap();
        assert!(prop.cancelled);
        assert!(!prop.executed);

        // Even after the timelock passes, a cancelled proposal must never execute.
        env.ledger().with_mut(|li| li.timestamp = 10);
        assert!(client.try_execute_admin_action(&admin, &prop_id).is_err());
        let prop_after = client.get_proposal(&prop_id).unwrap();
        assert!(prop_after.cancelled);
        assert!(!prop_after.executed);
    }

    #[test]
    fn test_cancel_requires_threshold_of_non_proposer_admins() {
        let env = Env::default();
        env.mock_all_auths();

        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let admin3 = Address::generate(&env);
        let contract_id = env.register(
            CreatorRegistryContract,
            (
                vec![&env, admin1.clone(), admin2.clone(), admin3.clone()],
                2u32,
                0u64,
                Address::generate(&env),
            ),
        );
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let target = Address::generate(&env);
        let prop_id =
            client.propose_admin_action(&admin1, &AdminAction::SetDonationContract(target));

        // A single non-proposer request (1 < threshold 2) is recorded only.
        client.cancel_admin_action(&admin2, &prop_id);
        assert!(!client.get_proposal(&prop_id).unwrap().cancelled);

        // The second request reaches the threshold: the proposal is cancelled.
        client.cancel_admin_action(&admin3, &prop_id);
        let prop = client.get_proposal(&prop_id).unwrap();
        assert!(prop.cancelled);
        assert!(!prop.executed);
    }

    #[test]
    fn test_approval_from_removed_admin_does_not_count() {
        let env = Env::default();
        env.mock_all_auths();

        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let admin3 = Address::generate(&env);

        let contract_id = env.register(
            CreatorRegistryContract,
            (
                vec![&env, admin1.clone(), admin2.clone(), admin3.clone()],
                2u32,
                10u64,
                Address::generate(&env),
            ),
        );
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        // Proposal 0 collects approvals from admin1 and admin3, so the cached
        // count already equals the threshold.
        let new_donation = Address::generate(&env);
        let prop0 = client.propose_admin_action(
            &admin1,
            &AdminAction::SetDonationContract(new_donation.clone()),
        );
        client.approve_admin_action(&admin3, &prop0);
        assert_eq!(client.get_proposal(&prop0).unwrap().approvals_count, 2);

        // Proposal 1 removes admin3 and is approved by admin1 + admin2.
        let prop1 = client.propose_admin_action(&admin1, &AdminAction::RemoveAdmin(admin3.clone()));
        client.approve_admin_action(&admin2, &prop1);

        env.ledger().with_mut(|li| li.timestamp = 20);
        client.execute_admin_action(&admin1, &prop1);
        assert!(!client.is_admin(&admin3));

        // admin3's stale approval on proposal 0 no longer counts: the recount
        // sees only admin1, which is below the 2-of-3 threshold, so execution
        // is refused even though `approvals_count` says 2.
        assert!(client.try_execute_admin_action(&admin1, &prop0).is_err());
        let prop0_after = client.get_proposal(&prop0).unwrap();
        assert!(!prop0_after.executed);
        assert_eq!(prop0_after.approvals_count, 2);

        // A current admin's approval lifts the recount to the threshold.
        client.approve_admin_action(&admin2, &prop0);
        client.execute_admin_action(&admin1, &prop0);
        assert!(client.get_proposal(&prop0).unwrap().executed);
    }
}
