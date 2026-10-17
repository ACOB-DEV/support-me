#!/usr/bin/env bash
set -euo pipefail

# SupportMe Testnet Deployment Script
# Automates building contracts, deploying to testnet, cross-initialization,
# executor registration, and updating deployments/testnet.json.

NETWORK="${NETWORK:-testnet}"
RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
ADMIN_KEY="${ADMIN_KEY:-admin}"
DEPLOYMENTS_FILE="deployments/testnet.json"

FRESH_KEYS=false
for arg in "$@"; do
  case $arg in
    --fresh-keys)
      FRESH_KEYS=true
      shift
      ;;
  esac
done

echo "=== SupportMe Testnet Deployer ==="
echo "Network: $NETWORK"
echo "RPC URL: $RPC_URL"

if [ "$FRESH_KEYS" = true ]; then
  echo "Generating fresh keys for deployer and executor..."
  stellar keys generate deployer --network "$NETWORK" || true
  stellar keys generate executor --network "$NETWORK" || true
  ADMIN_KEY="deployer"
  EXECUTOR_KEY="executor"
else
  EXECUTOR_KEY="${EXECUTOR_KEY:-executor}"
fi

ADMIN_ADDRESS=$(stellar keys address "$ADMIN_KEY" 2>/dev/null || echo "")
EXECUTOR_ADDRESS=$(stellar keys address "$EXECUTOR_KEY" 2>/dev/null || echo "")

echo "Admin address: ${ADMIN_ADDRESS:-<not-set>}"
echo "Executor address: ${EXECUTOR_ADDRESS:-<not-set>}"

echo "Step 1: Building Wasm artifacts..."
cargo build --manifest-path contracts/creator-registry/Cargo.toml --target wasm32v1-none --release
cargo build --manifest-path contracts/donation/Cargo.toml --target wasm32v1-none --release

REGISTRY_WASM="target/wasm32v1-none/release/creator_registry.wasm"
DONATION_WASM="target/wasm32v1-none/release/donation.wasm"

if [ ! -f "$REGISTRY_WASM" ] || [ ! -f "$DONATION_WASM" ]; then
  echo "Error: Contract Wasm artifacts not found!"
  exit 1
fi

echo "Step 2: Deploying contracts to $NETWORK..."
REGISTRY_DEPLOY=$(stellar contract deploy --wasm "$REGISTRY_WASM" --source-account "$ADMIN_KEY" --network "$NETWORK")
REGISTRY_ID=$(echo "$REGISTRY_DEPLOY" | tail -n 1 | tr -d '\r')

DONATION_DEPLOY=$(stellar contract deploy --wasm "$DONATION_WASM" --source-account "$ADMIN_KEY" --network "$NETWORK")
DONATION_ID=$(echo "$DONATION_DEPLOY" | tail -n 1 | tr -d '\r')

echo "Deployed Creator Registry ID: $REGISTRY_ID"
echo "Deployed Donation Contract ID: $DONATION_ID"

echo "Step 3: Initializing contracts with cross-references..."
# Initialize Donation with Registry ID
stellar contract invoke --id "$DONATION_ID" \
  --source-account "$ADMIN_KEY" --network "$NETWORK" -- \
  initialize --admin "$ADMIN_ADDRESS" --registry "$REGISTRY_ID"

# Initialize Registry with Donation ID
stellar contract invoke --id "$REGISTRY_ID" \
  --source-account "$ADMIN_KEY" --network "$NETWORK" -- \
  initialize --admin "$ADMIN_ADDRESS" --donation_contract "$DONATION_ID"

if [ -n "$EXECUTOR_ADDRESS" ]; then
  echo "Step 4: Configuring executor on donation contract..."
  stellar contract invoke --id "$DONATION_ID" \
    --source-account "$ADMIN_KEY" --network "$NETWORK" -- \
    set_executor --executor "$EXECUTOR_ADDRESS"
fi

echo "Step 5: Verifying deployment..."
stellar contract info interface --id "$DONATION_ID" --network "$NETWORK"
stellar contract info interface --id "$REGISTRY_ID" --network "$NETWORK"

echo "=== Deployment Successful ==="
echo ""
echo "Update your environment with:"
echo "NEXT_PUBLIC_DONATION_CONTRACT_ID=$DONATION_ID"
echo "NEXT_PUBLIC_CREATOR_REGISTRY_CONTRACT_ID=$REGISTRY_ID"
echo ""

# Write to deployments/testnet.json
mkdir -p deployments
cat <<EOF > "$DEPLOYMENTS_FILE"
{
  "network": "$NETWORK",
  "rpcUrl": "$RPC_URL",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "admin": "$ADMIN_ADDRESS",
  "executor": "$EXECUTOR_ADDRESS",
  "contracts": {
    "donation": {
      "id": "$DONATION_ID"
    },
    "creatorRegistry": {
      "id": "$REGISTRY_ID"
    }
  }
}
EOF
echo "Saved deployment details to $DEPLOYMENTS_FILE"
