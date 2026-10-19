# Contract Upgrade and Migration Strategy

This document describes the strategy for upgrading or migrating the SupportMe smart contracts on Stellar/Soroban.

## Current Approach

SupportMe uses a **new contract deployment + configuration switch** pattern for contract upgrades. This approach was used for the v1 → v2 migration (adding recurring donations).

### How It Works

1. **Deploy new contract versions**: The new contract(s) are deployed to fresh addresses on the network.
2. **Update configuration**: Environment variables pointing to contract addresses are updated:
   - `NEXT_PUBLIC_DONATION_CONTRACT_ID` (frontend)
   - `NEXT_PUBLIC_CREATOR_REGISTRY_CONTRACT_ID` (frontend)
   - `DONATION_CONTRACT_ID` (backend, if applicable)
   - `CREATOR_REGISTRY_CONTRACT_ID` (backend, if applicable)
3. **Frontend switches**: The frontend immediately uses the new contract addresses for new transactions.
4. **Backend switches**: The backend's event listener and subscription executor begin polling/interacting with the new contract.
5. **Old contracts remain**: The old contracts stay deployed and accessible at their original addresses, but are no longer used by the application.

### Tradeoffs

**Advantages:**
- **Simplicity**: No complex proxy patterns or upgrade mechanisms to implement in Solidity/Rust.
- **Safety**: Old contracts remain immutable and auditable; bugs in new contracts don't affect old deployments.
- **Rollback**: If a new contract has issues, you can switch back to the old addresses by reverting config changes.
- **Independence**: Each contract version can be independently audited and tested before deployment.
- **No state migration**: Since the registry stores creator state on-chain, a new registry can start fresh or be seeded as needed.

**Disadvantages:**
- **State fragmentation**: Creator profiles and lifetime totals live in the old registry; new deployments start from zero unless migrated.
- **Dual contract maintenance**: You may need to maintain multiple contract versions if some users are still using old addresses.
- **Configuration drift**: Need to ensure all environments (dev, staging, production) switch consistently.
- **On-chain identity**: Creator usernames and profile data are tied to specific contract addresses; moving them requires explicit migration or re-registration.

## Migration Runbook

This runbook covers the steps for performing a contract upgrade safely.

### Pre-Migration Checklist

- [ ] New contract code is audited (internal or external)
- [ ] All contract tests pass (`cargo test --workspace`)
- [ ] New contracts are deployed to testnet (or mainnet for production upgrades)
- [ ] Contract addresses are verified via `stellar contract info`
- [ ] Frontend and backend configuration templates are updated with new addresses
- [ ] Migration plan is documented and reviewed
- [ ] Rollback plan is tested in a staging environment

### Migration Steps

1. **Deploy new contracts with constructor args**

   Both contracts are initialized atomically by `__constructor` at deploy
   time; there is no separate `initialize` step. Because each contract needs
   the other's address, derive the registry ID from a salt first (see
   [`contract-deploy-workflow.md`](contract-deploy-workflow.md#deploy-to-testnet)
   for the full procedure and multi-admin arguments):
   ```bash
   SALT=$(openssl rand -hex 32)
   REGISTRY_ID=$(stellar contract id wasm --salt "$SALT" --source-account <admin-key> --network testnet)

   DONATION_ID=$(stellar contract deploy \
     --wasm target/wasm32v1-none/release/donation.wasm \
     --source-account <admin-key> --network testnet -- \
     --admins '["<admin-address>"]' --threshold 1 --timelock_delay 0 \
     --registry "$REGISTRY_ID")

   stellar contract deploy \
     --wasm target/wasm32v1-none/release/creator_registry.wasm --salt "$SALT" \
     --source-account <admin-key> --network testnet -- \
     --admins '["<admin-address>"]' --threshold 1 --timelock_delay 0 \
     --donation_contract "$DONATION_ID"
   ```

2. **Verify the pairing**
   - The registry deploy must print the same ID as `$REGISTRY_ID`.
   - `is_admin` returns `true` for the intended admin(s) on both contracts.

3. **Set executor on new donation contract** (if using recurring donations)
   ```bash
   soroban contract invoke \
     --id <new-donation-contract-id> \
     --source <admin-key> \
     --network testnet \
     set_executor \
     --executor <executor-address>
   ```

4. **Update backend configuration**
   - Update `backend/.env` with new contract addresses
   - Restart backend services to pick up new configuration
   - Verify backend health endpoint reports connection to new contracts

5. **Update frontend configuration**
   - Update `frontend/.env.local` with new contract addresses
   - For production: Update Vercel environment variables
   - Redeploy frontend to propagate new addresses

6. **Verify migration**
   - Test a one-time donation through the new contract
   - Test subscription creation and charging (if applicable)
   - Verify backend event listener picks up events from new contract
   - Check dashboard and profile pages display data correctly

7. **Monitor for issues**
   - Watch for transaction failures or errors in logs
   - Monitor subscription executor health (if applicable)
   - Check that old contract addresses are no longer being called

### Handling In-Flight Data

#### Active Subscriptions

For recurring donations, active subscriptions are stored on-chain in the donation contract. When migrating:

- **Option A: Let subscriptions expire naturally**
  - Supporters cancel subscriptions on the old contract
  - New subscriptions are created on the new contract
  - Pros: Simple, no state migration
  - Cons: Supporters must re-subscribe; interruption in recurring donations

- **Option B: Migrate subscription state**
  - Read active subscriptions from old contract
  - Re-create them on new contract via `subscribe` calls
  - Supporters re-approve allowances for the new contract
  - Pros: Maintains recurring donation continuity
  - Cons: Complex; requires supporter action to re-approve allowances

**Recommendation**: For SupportMe, use Option A (natural expiration) for simplicity. Communicate the migration to creators and supporters with clear timelines.

#### Creator Profiles

Creator profiles (username, lifetime totals) live in the creator-registry contract. When migrating:

> **Username rules:** the current registry only accepts usernames of 1-32
> bytes using `a-z`, `0-9`, `_` and `-`, and each username can belong to one
> address. Registries deployed before this rule may hold usernames that the
> new registry rejects (uppercase, dots, spaces, duplicates); those creators
> must pick a new username when re-registering or being migrated.

- **Option A: Fresh start**
  - New registry starts empty
  - Creators re-register their usernames on the new contract
  - Lifetime totals reset to zero
  - Pros: Simple; no data migration
  - Cons: Loss of historical data; creators must re-register

- **Option B: Profile migration**
  - Read profiles from old registry
  - Re-register creators on new registry with same usernames and totals
  - Requires admin privileges or bulk re-registration
  - Pros: Preserves historical data
  - Cons: Complex; potential for username conflicts

**Recommendation**: For SupportMe, use Option B (profile migration) to preserve creator data. Implement a migration script that:
1. Reads all creator profiles from the old registry
2. Calls `register_creator` on the new registry for each profile
3. Updates lifetime totals via direct storage writes (if admin-accessible) or via synthetic donation events

#### Donation History

Donation history is stored:
- On-chain in the donation contract (append-only log)
- Off-chain in the PostgreSQL database (via backend event listener)

When migrating:
- On-chain history remains in the old contract and is readable
- Off-chain history in PostgreSQL is independent of contract addresses
- No migration needed for database records

### Rollback Plan

If issues arise after migration:

1. **Revert configuration changes**
   - Switch frontend environment variables back to old contract addresses
   - Switch backend configuration back to old contract addresses
   - Restart services

2. **Verify rollback**
   - Test donations flow through old contracts
   - Verify backend event listener connects to old contracts
   - Check dashboard displays correct data

3. **Communicate with users**
   - Notify creators and supporters of the rollback
   - Provide timeline for fix and re-migration

4. **Post-mortem**
   - Document what went wrong
   - Update contracts to fix the issue
   - Re-run migration checklist before next attempt

## Alternative Approaches

### Proxy Pattern

A proxy contract delegates calls to an implementation contract that can be upgraded.

**Pros:**
- Single contract address for users
- State is preserved across upgrades
- No configuration changes needed

**Cons:**
- More complex to implement and audit
- Proxy contract becomes a single point of failure
- Upgrade logic itself can have bugs
- Not supported natively by Soroban (would need custom implementation)

**Recommendation**: Not currently needed for SupportMe. The new-deployment approach is simpler and sufficient for the current scale.

### Admin-Controlled Upgrade

Add an `upgrade` function to contracts that allows an admin to replace the implementation.

**Pros:**
- Single contract address
- Admin-controlled upgrades

**Cons:**
- Centralized control may not align with decentralization goals
- Requires careful access control
- Still complex to implement correctly

**Recommendation**: Not recommended for SupportMe. The new-deployment approach is safer and more transparent.

## Future Considerations

- **State migration tools**: Build scripts to automate profile and subscription migration between contract versions
- **Dual operation period**: Run old and new contracts in parallel for a transition period to ensure stability
- ** Governance**: Consider a DAO or multi-sig for contract upgrade decisions as the project grows
- **Semantic versioning**: Adopt semantic versioning for contracts (e.g., v2.0.0 for breaking changes, v2.1.0 for additions)
- **Deprecation notices**: Add deprecation notices to old contracts to inform users of upcoming migrations

## References

- v1 → v2 migration example: `README.md` contract table
- Soroban contract deployment docs: https://developers.stellar.org/docs/build/smart-contracts/deploying-to-testnet
- Stellar SDK for contract interaction: https://developers.stellar.org/docs/sdk/js
