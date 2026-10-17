import { Keypair } from "@stellar/stellar-sdk";
import { config } from "../config";
import { log } from "../lib/logger";
import {
  formatSorobanRpcEndpoint,
  getSorobanRpcTimeoutMs,
  getSorobanRpcUrls,
} from "./sorobanRpc";
import { contractInstanceExists } from "./sorobanContracts";
import { getNetworkPassphrase, getStellarNetworkName } from "./stellarNetwork";

/**
 * Boot-time validation of the Stellar configuration (#281).
 *
 * The four failures this catches before any traffic is served:
 *   1. An RPC endpoint whose network passphrase disagrees with STELLAR_NETWORK
 *      (e.g. a mainnet endpoint left in a testnet deployment).
 *   2. A configured contract ID that does not exist on the queried network
 *      (usually the contracts were redeployed — the trigger for #278 resets).
 *   3. An EXECUTOR_SECRET_KEY that is not a parseable Stellar secret.
 *   4. A creator-registry contract ID that does not exist.
 *
 * Every check is injectable so tests can drive matching, mismatched and
 * missing-contract scenarios without touching the network.
 */

export interface StellarSetupProbes {
  /** Passphrase reported by one RPC endpoint. Defaults to a live getNetwork call. */
  getNetworkPassphraseAt?: (endpoint: string) => Promise<string>;
  /** Whether a contract instance exists on-chain. Defaults to a getLedgerEntries probe. */
  contractExists?: (contractId: string) => Promise<boolean>;
}

export interface StellarSetupSummary {
  network: string;
  networkPassphrase: string;
  rpcEndpoints: string[];
  donationContractId: string | null;
  creatorRegistryContractId: string | null;
  executorPublicKey: string | null;
}

export interface StellarSetupValidationResult {
  /** True when nothing fatal was found. Warnings do not clear this flag. */
  ok: boolean;
  problems: string[];
  warnings: string[];
  summary: StellarSetupSummary;
}

async function fetchPassphraseAtEndpoint(endpoint: string): Promise<string> {
  const timeoutMs = getSorobanRpcTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getNetwork", params: {} }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    const body = (await response.json()) as {
      result?: { passphrase?: string };
      error?: { message?: string };
    };
    if (body.error) {
      throw new Error(body.error.message || "JSON-RPC error");
    }
    const passphrase = body.result?.passphrase;
    if (!passphrase) {
      throw new Error("getNetwork response did not include a passphrase");
    }
    return passphrase;
  } finally {
    clearTimeout(timer);
  }
}

export async function validateStellarSetup(
  probes: StellarSetupProbes = {}
): Promise<StellarSetupValidationResult> {
  const networkName = getStellarNetworkName();
  const expectedPassphrase = getNetworkPassphrase();
  const endpoints = getSorobanRpcUrls();
  const donationContractId = config.donationContractId || null;
  const creatorRegistryContractId = config.creatorRegistryContractId || null;

  const problems: string[] = [];
  const warnings: string[] = [];
  let executorPublicKey: string | null = null;

  // 1. Every RPC endpoint must agree with the configured network.
  for (const endpoint of endpoints) {
    try {
      const passphrase =
        (await (probes.getNetworkPassphraseAt ?? fetchPassphraseAtEndpoint)(endpoint));
      if (passphrase !== expectedPassphrase) {
        problems.push(
          `RPC endpoint ${formatSorobanRpcEndpoint(endpoint)} reports passphrase "${passphrase}" ` +
            `but STELLAR_NETWORK=${networkName} expects "${expectedPassphrase}"`
        );
      }
    } catch (error) {
      // An unreachable endpoint at boot is recoverable (failover), unlike a
      // confirmed mismatch, so it warns rather than failing the process.
      warnings.push(
        `RPC endpoint ${formatSorobanRpcEndpoint(endpoint)} could not be validated: ${(error as Error).message}`
      );
    }
  }

  // 2. Each configured contract must exist on the network the RPC serves.
  const contractExists = probes.contractExists ?? contractInstanceExists;
  for (const [label, contractId] of [
    ["NEXT_PUBLIC_DONATION_CONTRACT_ID", donationContractId],
    ["NEXT_PUBLIC_CREATOR_REGISTRY_CONTRACT_ID", creatorRegistryContractId],
  ] as const) {
    if (!contractId) continue;
    try {
      const exists = await contractExists(contractId);
      if (!exists) {
        problems.push(
          `${label} (${contractId}) does not exist on ${networkName} — ` +
            "the contract may have been redeployed or the deployment is on the wrong network"
        );
      }
    } catch (error) {
      warnings.push(
        `${label} (${contractId}) could not be verified: ${(error as Error).message}`
      );
    }
  }

  // 3. The executor key must parse; a garbage secret would only fail later,
  // inside a charge attempt.
  const executorSecretKey = config.executorSecretKey;
  if (executorSecretKey) {
    try {
      executorPublicKey = Keypair.fromSecret(executorSecretKey).publicKey();
    } catch {
      problems.push("EXECUTOR_SECRET_KEY is not a valid Stellar secret key");
    }
  }

  const summary: StellarSetupSummary = {
    network: networkName,
    networkPassphrase: expectedPassphrase,
    rpcEndpoints: endpoints.map(formatSorobanRpcEndpoint),
    donationContractId,
    creatorRegistryContractId,
    executorPublicKey,
  };

  // Single structured summary line, matching the issue's acceptance criteria.
  log("info", "Stellar network configuration validated", {
    ...summary,
    ...(problems.length > 0 ? { problems } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  });

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    summary,
  };
}

/**
 * Server-entrypoint wrapper: production fails fast on a fatal mismatch,
 * development logs the same problems as warnings so local work isn't blocked
 * by a half-configured environment (mirrors validateConfig's policy).
 */
export async function validateStellarNetworkSetup(
  probes: StellarSetupProbes = {}
): Promise<void> {
  const result = await validateStellarSetup(probes);
  if (result.ok) return;

  const msg = `STARTUP CONFIGURATION: ${result.problems.join("; ")}`;
  log("error", msg);
  if (process.env.NODE_ENV === "production") {
    throw new Error(msg);
  }
}
