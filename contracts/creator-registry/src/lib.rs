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
    extend_instance_ttl, validate_admin_set, AdminAction, AdminProposal, CreatorProfile,
};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, panic_with_error, symbol_short,
    Address, Env, String, Symbol, Vec,
};

const ADMIN_KEY: Symbol = symbol_short!("admin");
const ADMINS_KEY: Symbol = symbol_short!("admins");
const THRESHOLD_KEY: Symbol = symbol_short!("thresh");
const TIMELOCK_DELAY_KEY: Symbol = symbol_short!("delay");
const PROPOSAL_COUNTER_KEY: Symbol = symbol_short!("prop_ctr");
const PROPOSAL_KEY: Symbol = symbol_short!("proposal");
const APPROVAL_KEY: Symbol = symbol_short!("approval");
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
        env.storage().instance().set(&TIMELOCK_DELAY_KEY, &timelock_delay);
        env.storage().instance().set(&DONATION_KEY, &donation_contract);
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

    /// Retrieves an admin proposal by ID.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<AdminProposal> {
        env.storage().persistent().get(&(PROPOSAL_KEY, proposal_id))
    }

    /// Proposes a multi-signature administrative action.
    pub fn propose_admin_action(env: Env, proposer: Address, action: AdminAction) -> u64 {
        proposer.require_auth();
        assert!(Self::is_admin(env.clone(), proposer.clone()), "proposer is not an admin");
        if !Self::is_supported_action(&action) {
            panic_with_error!(&env, RegistryError::UnsupportedAction);
        }
        extend_instance_ttl(&env);

        let prop_id: u64 = env.storage().persistent().get(&PROPOSAL_COUNTER_KEY).unwrap_or(0);
        let timelock: u64 = env.storage().instance().get(&TIMELOCK_DELAY_KEY).unwrap_or(0);
        let now = env.ledger().timestamp();
        let eta = now.checked_add(timelock).expect("proposal eta overflow");

        let proposal = AdminProposal {
            id: prop_id,
            action,
            proposer: proposer.clone(),
            approvals_count: 1,
            created_at: now,
            eta,
            executed: false,
        };

        env.storage().persistent().set(&(PROPOSAL_KEY, prop_id), &proposal);
        env.storage().persistent().set(&(APPROVAL_KEY, prop_id, proposer.clone()), &true);
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
        assert!(Self::is_admin(env.clone(), admin.clone()), "caller is not an admin");

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

        env.storage().persistent().set(&(APPROVAL_KEY, proposal_id, admin.clone()), &true);
        proposal.approvals_count = proposal
            .approvals_count
            .checked_add(1)
            .expect("approvals count overflow");
        env.storage().persistent().set(&(PROPOSAL_KEY, proposal_id), &proposal);

        ProposalApprovedEvent {
            proposal_id,
            admin,
            approvals_count: proposal.approvals_count,
        }
        .publish(&env);
    }

    /// Executes an administrative proposal once signature threshold & timelock criteria are met.
    pub fn execute_admin_action(env: Env, executor: Address, proposal_id: u64) {
        executor.require_auth();
        assert!(Self::is_admin(env.clone(), executor.clone()), "caller is not an admin");

        let mut proposal: AdminProposal = env
            .storage()
            .persistent()
            .get(&(PROPOSAL_KEY, proposal_id))
            .expect("proposal not found");
        assert!(!proposal.executed, "proposal already executed");

        let threshold: u32 = env.storage().instance().get(&THRESHOLD_KEY).expect("threshold not set");
        assert!(
            proposal.approvals_count >= threshold,
            "insufficient signatures to execute proposal"
        );

        let now = env.ledger().timestamp();
        assert!(now >= proposal.eta, "proposal timelock delay has not elapsed");
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
                assert!(new_admins.len() > 0, "cannot remove all admins");
                let threshold: u32 = env.storage().instance().get(&THRESHOLD_KEY).unwrap();
                assert!(threshold <= new_admins.len(), "threshold exceeds remaining admin count");
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
        env.storage().persistent().set(&(PROPOSAL_KEY, proposal_id), &proposal);

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
            env.storage().instance().set(&DONATION_KEY, &donation_contract);
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

        let profile = if let Some(p) = env.storage().persistent().get::<_, CreatorProfile>(&creator) {
            // If the profile exists, it must be a placeholder created by record_donation
            assert!(
                p.username.len() == 0,
                "creator already registered"
            );
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
        CreatedEvent { creator, username }.publish(&env);

        profile
    }

    /// Read a creator's profile, if one exists.
    pub fn get_creator(env: Env, creator: Address) -> Option<CreatorProfile> {
        let profile = env.storage().persistent().get::<_, CreatorProfile>(&creator);
        if let Some(p) = profile {
            if p.username.len() > 0 {
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

        env.storage().persistent().set(&(GOAL_KEY, creator.clone()), &goal_amount);

        GoalUpdatedEvent {
            creator,
            goal_amount,
            updated_at: env.ledger().timestamp(),
        }
        .publish(&env);
    }

    /// Reads a creator's funding goal, if set.
    pub fn get_goal(env: Env, creator: Address) -> Option<i128> {
        env.storage().persistent().get(&(GOAL_KEY, creator))
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
    use common::{INSTANCE_BUMP_AMOUNT, INSTANCE_LIFETIME_THRESHOLD};
    use soroban_sdk::testutils::{storage::Instance as _, Address as _, Ledger};
    use soroban_sdk::{vec, IntoVal, Val};

    /// Deploys a 1-of-1 registry whose authorized donation contract is a
    /// generated address. Returns (client, admin, donation_contract).
    fn setup(env: &Env) -> (CreatorRegistryContractClient<'_>, Address, Address) {
        let admin = Address::generate(env);
        let donation_contract = Address::generate(env);
        let contract_id = env.register(
            CreatorRegistryContract,
            (vec![env, admin.clone()], 1u32, 0u64, donation_contract.clone()),
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
            client.get_creator_by_username(&s(&env, "alice")).unwrap().address,
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
            (vec![&env, admin.clone(), admin], 2u32, 0u64, Address::generate(&env)),
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
            ("initialize", (attacker.clone(), attacker_donation.clone()).into_val(&env)),
            (
                "initialize_multisig",
                (attacker_admins.clone(), 1u32, 0u64, attacker_donation.clone()).into_val(&env),
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
            (vec![&env, admin1.clone(), admin2.clone()], 2u32, 50u64, initial_donation),
        );
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let prop_id = client.propose_admin_action(
            &admin1,
            &AdminAction::SetDonationContract(new_donation.clone()),
        );

        let prop = client.get_proposal(&prop_id).unwrap();
        assert_eq!(prop.approvals_count, 1);
        assert_eq!(prop.executed, false);

        client.approve_admin_action(&admin2, &prop_id);

        // Advance ledger past timelock
        env.ledger().with_mut(|li| li.timestamp = 60);

        client.execute_admin_action(&admin1, &prop_id);

        let prop_after = client.get_proposal(&prop_id).unwrap();
        assert_eq!(prop_after.executed, true);

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
                executed: false,
            };
            env.storage().persistent().set(&(PROPOSAL_KEY, 0u64), &proposal);
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
}
