/**
 * Maps a Stellar Asset Contract (SAC) address carried in a Soroban event's
 * `token` field to the asset code stored on Donation/Goal rows.
 *
 * The `donated` event emits the token as a SAC contract address (C...), not an
 * asset code, so the listener cannot store it directly. XLM is the native
 * asset's SAC, and the credit assets (USDC/USDT) are configured per-deployment
 * through environment variables, mirroring the frontend's lib/assets.ts.
 *
 * Resolution order for each non-native asset:
 *   1. An explicit `*_TOKEN_ID` (the SAC contract address), the authoritative
 *      mapping when an operator has set it.
 *   2. A `*_ISSUER`, from which the SAC id is derived deterministically with
 *      the network passphrase (the same computation the frontend does).
 *
 * Anything unrecognized falls back to the raw token string so a nonstandard or
 * newly added asset still round-trips, rather than being dropped.
 */

import { Asset } from "@stellar/stellar-sdk";
import { getNetworkPassphrase } from "../services/stellarNetwork";

interface AssetConfig {
  code: string;
  issuerEnv?: string;
  tokenIdEnv?: string;
}

const CREDIT_ASSETS: AssetConfig[] = [
  { code: "USDC", issuerEnv: "SOROBAN_USDC_ISSUER", tokenIdEnv: "SOROBAN_USDC_TOKEN_ID" },
  { code: "USDT", issuerEnv: "SOROBAN_USDT_ISSUER", tokenIdEnv: "SOROBAN_USDT_TOKEN_ID" },
];

let cachedMapping: Map<string, string> | null = null;

function buildMapping(): Map<string, string> {
  const mapping = new Map<string, string>();
  // Shares the backend's single network source of truth (#281) so the derived
  // SAC ids match the chain the listener and executor actually talk to.
  const passphrase = getNetworkPassphrase();

  // Native XLM SAC id — the same computation for every deployment.
  try {
    mapping.set(Asset.native().contractId(passphrase), "XLM");
  } catch {
    // A malformed/unsupported network passphrase shouldn't stop the listener;
    // XLM just won't be resolvable and events fall back to the raw token.
  }

  for (const { code, issuerEnv, tokenIdEnv } of CREDIT_ASSETS) {
    const tokenId = tokenIdEnv ? process.env[tokenIdEnv]?.trim() : undefined;
    if (tokenId) {
      mapping.set(tokenId, code);
      continue;
    }
    const issuer = issuerEnv ? process.env[issuerEnv]?.trim() : undefined;
    if (issuer) {
      try {
        mapping.set(new Asset(code, issuer).contractId(passphrase), code);
      } catch {
        // Invalid issuer configured — skip rather than crash on startup.
      }
    }
  }

  return mapping;
}

/** Resolves an event token (SAC address or already an asset code) to a currency code. */
export function resolveTokenCurrency(token: string | undefined): string {
  if (!token) return "XLM";
  cachedMapping ??= buildMapping();
  return cachedMapping.get(token) ?? token;
}

/** Test-only: forces the mapping to be rebuilt on the next resolution. */
export function resetAssetMappingCache(): void {
  cachedMapping = null;
}
