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
//! timelock delay before execution.

use common::{AdminAction, AdminProposal, CreatorProfile};
use soroban_sdk::{
    contract, contractevent, contractimpl, symbol_short, Address, Env, String, Symbol,
    Vec,
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
    /// One-time setup. `donation_contract` is the only address that will be
    /// permitted to call `record_donation`.
    pub fn initialize(env: Env, admin: Address, donation_contract: Address) {
        admin.require_auth();
        assert!(
            !env.storage().instance().has(&ADMIN_KEY) && !env.storage().instance().has(&ADMINS_KEY),
            "registry already initialized"
        );

        let mut admins = Vec::new(&env);
        admins.push_back(admin.clone());

        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().instance().set(&ADMINS_KEY, &admins);
        env.storage().instance().set(&THRESHOLD_KEY, &1u32);
        env.storage().instance().set(&TIMELOCK_DELAY_KEY, &0u64);
        env.storage().instance().set(&DONATION_KEY, &donation_contract);
    }

    /// One-time multi-sig setup: configures admin list, threshold, and timelock delay.
    pub fn initialize_multisig(
        env: Env,
        admins: Vec<Address>,
        threshold: u32,
        timelock_delay: u64,
        donation_contract: Address,
    ) {
        assert!(
            !env.storage().instance().has(&ADMIN_KEY) && !env.storage().instance().has(&ADMINS_KEY),
            "registry already initialized"
        );
        assert!(admins.len() > 0, "admin list cannot be empty");
        assert!(threshold > 0 && threshold <= admins.len(), "invalid signature threshold");

        for i in 0..admins.len() {
            admins.get(i).unwrap().require_auth();
        }

        let primary_admin = admins.get(0).unwrap();
        env.storage().instance().set(&ADMIN_KEY, &primary_admin);
        env.storage().instance().set(&ADMINS_KEY, &admins);
        env.storage().instance().set(&THRESHOLD_KEY, &threshold);
        env.storage().instance().set(&TIMELOCK_DELAY_KEY, &timelock_delay);
        env.storage().instance().set(&DONATION_KEY, &donation_contract);
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
            _ => {}
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
        } else {
            panic!("multi-sig required: use propose_admin_action to set donation contract");
        }
    }

    /// Register a new creator profile. Must be signed by the creator.
    pub fn register_creator(env: Env, creator: Address, username: String) -> CreatorProfile {
        creator.require_auth();
        
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
    use soroban_sdk::testutils::{Address as _, Ledger};

    #[test]
    fn test_register_creator() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CreatorRegistryContract, ());
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        env.ledger().with_mut(|li| li.sequence_number = 100);

        let profile = client.register_creator(&creator, &String::from_bytes(&env, b"awesome_dev"));

        assert_eq!(profile.donation_count, 0);
        assert_eq!(profile.total_donations, 0);
    }

    #[test]
    #[should_panic(expected = "creator already registered")]
    fn test_register_creator_twice_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CreatorRegistryContract, ());
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let username = String::from_bytes(&env, b"awesome_dev");
        client.register_creator(&creator, &username);
        client.register_creator(&creator, &username);
    }

    #[test]
    fn test_record_donation_updates_stats() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CreatorRegistryContract, ());
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let donation_contract = Address::generate(&env);
        let creator = Address::generate(&env);

        client.initialize(&admin, &donation_contract);
        client.record_donation(&donation_contract, &creator, &1000);
        client.record_donation(&donation_contract, &creator, &500);

        assert!(client.get_creator(&creator).is_none());

        client.register_creator(&creator, &String::from_bytes(&env, b"dev"));
        let profile = client.get_creator(&creator).unwrap();
        assert_eq!(profile.total_donations, 1500);
        assert_eq!(profile.donation_count, 2);
    }

    #[test]
    #[should_panic(expected = "caller is not the authorized donation contract")]
    fn test_record_donation_rejects_unauthorized_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CreatorRegistryContract, ());
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let donation_contract = Address::generate(&env);
        let impostor = Address::generate(&env);
        let creator = Address::generate(&env);

        client.initialize(&admin, &donation_contract);
        client.record_donation(&impostor, &creator, &1000);
    }

    #[test]
    #[should_panic(expected = "registry already initialized")]
    fn test_initialize_twice_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CreatorRegistryContract, ());
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let donation_contract = Address::generate(&env);

        client.initialize(&admin, &donation_contract);
        client.initialize(&admin, &donation_contract);
    }

    #[test]
    fn test_registry_multisig_set_donation_contract() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(CreatorRegistryContract, ());
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let mut admins = Vec::new(&env);
        admins.push_back(admin1.clone());
        admins.push_back(admin2.clone());

        let initial_donation = Address::generate(&env);
        let new_donation = Address::generate(&env);

        client.initialize_multisig(&admins, &2, &50, &initial_donation);

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
    }

    #[test]
    fn test_register_creator_after_donation() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CreatorRegistryContract, ());
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let donation_contract = Address::generate(&env);
        let creator = Address::generate(&env);

        client.initialize(&admin, &donation_contract);
        
        // Donation comes first, creating a placeholder profile
        client.record_donation(&donation_contract, &creator, &1000);

        assert!(client.get_creator(&creator).is_none());

        // Now the creator registers
        let profile = client.register_creator(&creator, &String::from_bytes(&env, b"late_dev"));

        assert_eq!(profile.username, String::from_bytes(&env, b"late_dev"));
        assert_eq!(profile.total_donations, 1000);
        assert_eq!(profile.donation_count, 1);
        
        let fetched = client.get_creator(&creator).unwrap();
        assert_eq!(fetched.username, String::from_bytes(&env, b"late_dev"));
        assert_eq!(fetched.total_donations, 1000);
    }

    #[test]
    #[should_panic(expected = "total donations overflow")]
    fn test_record_donation_total_overflow_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(CreatorRegistryContract, ());
        let client = CreatorRegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let donation_contract = Address::generate(&env);
        let creator = Address::generate(&env);

        client.initialize(&admin, &donation_contract);
        client.record_donation(&donation_contract, &creator, &i128::MAX);
        client.record_donation(&donation_contract, &creator, &1);
    }
}
