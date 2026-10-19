import { Networks } from "@stellar/stellar-sdk";

/**
 * Single source of truth for which Stellar network the backend is talking to
 * (#281). The executor used to hardcode `Networks.TESTNET`, so a deployment
 * pointed at mainnet would sign transactions for the wrong chain. Reading the
 * passphrase from configuration means boot validation, the executor, and any
 * future signer all agree.
 */

export type StellarNetworkName = "testnet" | "mainnet" | "futurenet";

export function getStellarNetworkName(): StellarNetworkName {
  const raw = (
    process.env.STELLAR_NETWORK ||
    process.env.NEXT_PUBLIC_STELLAR_NETWORK ||
    "testnet"
  )
    .trim()
    .toLowerCase();

  if (raw === "mainnet" || raw === "public") return "mainnet";
  if (raw === "futurenet") return "futurenet";
  return "testnet";
}

const PASSPHRASES: Record<StellarNetworkName, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
  futurenet: Networks.FUTURENET,
};

export function getNetworkPassphrase(): string {
  return PASSPHRASES[getStellarNetworkName()];
}

/**
 * Testnet and Futurenet are both freely funded networks with a Friendbot, so
 * auto-funding the executor is safe on either. Mainnet is excluded: a
 * Friendbot call there must never happen, and it signals a misconfiguration
 * rather than something the backend should paper over.
 */
export function isTestnetLike(): boolean {
  const name = getStellarNetworkName();
  return name === "testnet" || name === "futurenet";
}

export function getFriendbotUrl(): string {
  const configured = process.env.FRIENDBOT_URL?.trim();
  const url = configured || "https://friendbot.stellar.org";
  return url.replace(/\/+$/, "");
}

/**
 * XLM balance below which `/health/executor` reports lowBalance and the
 * executor logs a warning. Defaults to 0.5 XLM — a few thousand fee-slots.
 */
export function getExecutorLowBalanceXlm(): number {
  const configured = Number(process.env.EXECUTOR_LOW_BALANCE_XLM);
  return Number.isFinite(configured) && configured >= 0 ? configured : 0.5;
}
