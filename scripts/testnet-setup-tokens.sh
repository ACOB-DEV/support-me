#!/usr/bin/env bash
set -euo pipefail

# SupportMe Testnet Token Allowlist Setup Script
# Deploys/resolves Stellar Asset Contracts (SACs) for native XLM and configured USDC/USDT issuers,
# then calls add_allowed_token on the donation contract.

NETWORK="${NETWORK:-testnet}"
ADMIN_KEY="${ADMIN_KEY:-admin}"
DEPLOYMENTS_FILE="deployments/testnet.json"

if [ ! -f "$DEPLOYMENTS_FILE" ]; then
  echo "Error: $DEPLOYMENTS_FILE not found. Run deploy-testnet.sh first."
  exit 1
fi

DONATION_ID=$(node -e "const d=require('./$DEPLOYMENTS_FILE'); console.log(d.contracts?.donation?.id || '');")
if [ -z "$DONATION_ID" ]; then
  echo "Error: donation contract id not found in $DEPLOYMENTS_FILE"
  exit 1
fi

echo "=== Setting Up Allowed Tokens for Donation Contract ($DONATION_ID) ==="

# 1. Native XLM SAC (deploy-asset resolves or deploys SAC)
echo "Deploying/resolving native XLM SAC..."
XLM_SAC=$(stellar contract asset deploy --asset native --source-account "$ADMIN_KEY" --network "$NETWORK" 2>/dev/null || echo "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC")
echo "Native XLM SAC ID: $XLM_SAC"

echo "Adding XLM SAC to donation allowlist..."
stellar contract invoke --id "$DONATION_ID" \
  --source-account "$ADMIN_KEY" --network "$NETWORK" -- \
  add_allowed_token --token "$XLM_SAC" || true

# 2. Testnet USDC
USDC_ISSUER="${USDC_ISSUER:-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA}"
if [ -n "$USDC_ISSUER" ]; then
  echo "Deploying/resolving USDC SAC (issuer: $USDC_ISSUER)..."
  USDC_SAC=$(stellar contract asset deploy --asset "USDC:$USDC_ISSUER" --source-account "$ADMIN_KEY" --network "$NETWORK" 2>/dev/null || echo "")
  if [ -n "$USDC_SAC" ]; then
    echo "USDC SAC ID: $USDC_SAC"
    echo "Adding USDC SAC to donation allowlist..."
    stellar contract invoke --id "$DONATION_ID" \
      --source-account "$ADMIN_KEY" --network "$NETWORK" -- \
      add_allowed_token --token "$USDC_SAC" || true
  fi
fi

echo "=== Verifying Allowlist ==="
stellar contract invoke --id "$DONATION_ID" \
  --source-account "$ADMIN_KEY" --network "$NETWORK" -- \
  is_token_allowed --token "$XLM_SAC"

echo "Token setup completed successfully!"
