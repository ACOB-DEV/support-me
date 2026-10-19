# Soroban Contract Deploy and Promotion Workflow

This runbook covers a fresh deployment of `contracts/donation` and
`contracts/creator-registry` to Stellar Testnet, verification, and promotion of
the live demo. SupportMe uses new addresses for contract upgrades; an existing
contract is not replaced in place. Read
[`contract-upgrade-migration.md`](contract-upgrade-migration.md) before a
deployment that changes contracts holding live state.

## Before you deploy

- Review the contract changes and run the Rust checks below.
- Install Rust 1.84 or newer, the `wasm32v1-none` target, and the current Stellar
  CLI (`stellar`). Keep the CLI version recorded with the release notes.
- Use a funded Testnet deployer account. For production promotion, use the
  approved admin/multisig process; do not use a developer's personal wallet.
- Decide the admin addresses, threshold, timelock, and subscription executor
  before deploying either contract; they are fixed by the constructor. The executor key must be funded for
  fees and its public key must be set on the donation contract.
- Keep secret keys in the Stellar CLI's local key store or the hosting
  provider's secret store. Do not put secrets in shell history, this document,
  or committed environment files.

## Build and test

From the repository root:

```bash
rustup target add wasm32v1-none
cargo fmt --all -- --check
cargo test --workspace
cargo build --manifest-path contracts/creator-registry/Cargo.toml \
  --target wasm32v1-none --release
cargo build --manifest-path contracts/donation/Cargo.toml \
  --target wasm32v1-none --release
```

Confirm both deployable files exist before proceeding:

```bash
test -s target/wasm32v1-none/release/creator_registry.wasm
test -s target/wasm32v1-none/release/donation.wasm
```

The contract manifests build both a Wasm `cdylib` and an `rlib`; the latter is
used by the Rust workspace tests. Do not deploy a stale artifact from a prior
build.

## Deploy to Testnet

Both contracts are initialized by their constructor as part of the deploy
transaction, so there is no separate `initialize` call that someone watching
the network could front-run. Constructor arguments are passed after `--`:

| Argument | Donation | Registry |
| --- | --- | --- |
| `--admins` | JSON array of admin addresses; the first is the primary admin | same |
| `--threshold` | approvals required for admin proposals (`1` ≤ threshold ≤ admin count) | same |
| `--timelock_delay` | seconds between proposal and execution | same |
| other contract | `--registry <REGISTRY_ID>` | `--donation_contract <DONATION_ID>` |

Each contract needs the other's address at construction time. Derive the
registry ID up front from a deploy salt, deploy the donation contract pointing
at it, then deploy the registry with that same salt. Use the Stellar CLI
account alias configured for your deployer in place of `<DEPLOYER_KEY>`:

```bash
SALT=$(openssl rand -hex 32)   # record this with the release notes

REGISTRY_ID=$(stellar contract id wasm --salt "$SALT" \
  --source-account <DEPLOYER_KEY> --network testnet)

DONATION_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/donation.wasm \
  --source-account <DEPLOYER_KEY> --network testnet -- \
  --admins '["<ADMIN_ADDRESS>"]' --threshold 1 --timelock_delay 0 \
  --registry "$REGISTRY_ID")

stellar contract deploy \
  --wasm target/wasm32v1-none/release/creator_registry.wasm \
  --salt "$SALT" \
  --source-account <DEPLOYER_KEY> --network testnet -- \
  --admins '["<ADMIN_ADDRESS>"]' --threshold 1 --timelock_delay 0 \
  --donation_contract "$DONATION_ID"
```

The registry deploy must print the same ID as `$REGISTRY_ID`; if it does not
(different deployer account, network, or salt), the donation contract points
at the wrong registry and both must be redeployed. Record both contract IDs
and deployment transaction hashes.

The example above is a single-admin test deployment. For a multi-admin
deployment, pass the agreed admin list, threshold and timelock delay instead,
e.g. `--admins '["<ADMIN_1>","<ADMIN_2>","<ADMIN_3>"]' --threshold 2
--timelock_delay 86400`, using the same values for both contracts. Admins do
not sign the deploy; the deployer sets the admin set atomically. Follow
[`admin-multisig-timelock.md`](admin-multisig-timelock.md) for
multi-signature administration. With a threshold greater than one, configure
the executor through the `SetExecutor` proposal flow; the direct `set_executor`
call is only available for a 1-of-1 contract.

Both contracts extend their instance TTL on every state-changing call. During
long idle periods, schedule a permissionless `bump` call on each contract
(e.g. from the backend executor) so neither is archived:

```bash
stellar contract invoke --id <DONATION_ID> \
  --source-account <EXECUTOR_KEY> --network testnet -- bump
stellar contract invoke --id <REGISTRY_ID> \
  --source-account <EXECUTOR_KEY> --network testnet -- bump
```

## Verify the deployment

1. Confirm the IDs and transaction hashes are for Testnet and match the CLI
   output. Inspect each contract interface through the CLI:

   ```bash
   stellar contract info interface --id <DONATION_ID> --network testnet
   stellar contract info interface --id <REGISTRY_ID> --network testnet
   ```

2. Open each contract on [stellar.expert Testnet](https://stellar.expert/explorer/testnet)
   using `/contract/<CONTRACT_ID>`. Confirm the address, deployment transaction,
   and contract/Wasm details are present. Compare the displayed Wasm hash with
   the artifact built for this release when the explorer exposes that value.
   Explorer visibility verifies the on-chain deployment; it is not a substitute
   for an independent source-code audit.
3. Confirm both deploys succeeded, `is_admin` returns `true` for each intended
   admin, and the donation contract references the intended registry. For the single-admin test setup, configure the executor
   and verify it before using recurring donations:

   ```bash
   stellar contract invoke --id <DONATION_ID> \
     --source-account <ADMIN_KEY> --network testnet -- \
     set_executor --executor <EXECUTOR_ADDRESS>
   ```

4. Exercise a test donation and, if this release changes recurring donations,
   a subscription through a non-production frontend. Check the transaction on
   stellar.expert and confirm the backend event listener indexes it.

## Automated Deployment Scripts & Token Allowlist Setup

SupportMe includes helper scripts and targets to automate contract builds, deployment, cross-initialization, and token allowlist configuration:

### 1. Deploying Contracts to Testnet
Use `scripts/deploy-testnet.sh` (or `make deploy-testnet`):

```bash
# Deploys wasm contracts, initializes them with cross-references, registers executor,
# and updates deployments/testnet.json:
make deploy-testnet

# Or generate fresh keys and deploy:
bash scripts/deploy-testnet.sh --fresh-keys
```

This updates `deployments/testnet.json` with the deployed contract IDs, wasm hashes, network parameters, and admin/executor addresses.

### 2. Token Allowlist Configuration
Use `scripts/testnet-setup-tokens.sh` (or `make setup-tokens`):

```bash
make setup-tokens
```

This deploys or resolves the Stellar Asset Contract (SAC) for native XLM and configured USDC (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA`), adds them to the donation contract's allowlist via `add_allowed_token`, and verifies them using `is_token_allowed`.

To verify token allowlist consistency against `frontend/lib/assets.js`:
```bash
make check-tokens
```

## Update repository addresses

After verification, update these records in the same release change:

- Add the new version and both explorer-linked IDs to the **Smart Contracts**
  table in the root `README.md`. Keep prior versions and their addresses for
  history; label the new entries with the release/version and note any interface
  or state-migration caveats.
- Replace the Testnet sample values for `NEXT_PUBLIC_DONATION_CONTRACT_ID`
  and `NEXT_PUBLIC_CREATOR_REGISTRY_CONTRACT_ID` in `frontend/.env.example`,
  and for `DONATION_CONTRACT_ID` (backend-scoped; see #302) in
  `backend/.env.example`, with the newly deployed IDs. Never add a real
  private key to the example file.
- Update the corresponding values in local `frontend/.env.local` and
  `backend/.env` files as needed; these files are not deployment configuration
  and must remain untracked.
- Update any contract address examples or deployment/migration notes that claim
  a specific version is current.

## Promote the live demo

Keep production promotion deliberate and schedule it after the Testnet checks
and approvals pass. Apply the same new pair of contract IDs together:

- **Vercel**: update `NEXT_PUBLIC_DONATION_CONTRACT_ID` and
  `NEXT_PUBLIC_CREATOR_REGISTRY_CONTRACT_ID` for the live project's Production
  environment. Confirm Preview/Staging values separately rather than copying
  production IDs into every environment by default. Redeploy the frontend so
  the public client is built with the new IDs.
- **Railway**: update `DONATION_CONTRACT_ID` and
  `NEXT_PUBLIC_CREATOR_REGISTRY_CONTRACT_ID` on the backend service. Set or
  retain `EXECUTOR_SECRET_KEY` only if recurring donations are enabled; its
  public key must match the executor registered on the new donation contract.
  Confirm the Soroban RPC settings target the same network, then restart or
  redeploy the service.
- **Smoke test**: check the frontend deployment, backend `/health` and
  `/health/executor`, make a small test donation, and verify its event appears
  in the dashboard. If recurring donations are enabled, confirm executor health
  and a controlled charge before announcing the release.
- **Rollback readiness**: retain the previous IDs and deployment details. If
  checks fail, restore both old IDs in Vercel and Railway and redeploy/restart
  both services. New contracts have independent state; switching addresses does
  not migrate creator profiles, donation records, or active subscriptions.

The backend's full environment-variable reference is
[`backend/docs/CONFIGURATION.md`](../backend/docs/CONFIGURATION.md).