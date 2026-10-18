import { Address, Keypair, xdr } from "@stellar/stellar-sdk";
import { callSorobanRpc } from "./sorobanRpc";

/**
 * Chain-state probes shared by boot validation (#281) and testnet-reset
 * detection (#278). Kept separate from the RPC transport so both callers use
 * identical ledger-key construction instead of hand-rolling XDR twice.
 */

/**
 * Ledger key for a contract's instance entry. Soroban stores every deployed
 * contract as a persistent contract-data entry keyed by the special
 * "ledger key contract instance" ScVal — an RPC `getLedgerEntries` on this key
 * returns nothing when the contract does not exist on the queried network.
 */
export function contractInstanceLedgerKey(contractId: string): string {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
  return key.toXDR("base64");
}

/**
 * True when the contract instance exists. Throws on RPC failure so a transport
 * outage is never mistaken for a missing contract (a false reset signal).
 */
export async function contractInstanceExists(contractId: string): Promise<boolean> {
  const key = contractInstanceLedgerKey(contractId);
  const result = await callSorobanRpc<{ entries?: Array<unknown> | null }>(
    "getLedgerEntries",
    { keys: [key] },
    { retries: 0 }
  );
  return Array.isArray(result.entries) && result.entries.length > 0;
}

/**
 * Native (XLM) balance of an account, read from the account's ledger entry
 * (stroops / 1e7). Returns null when the account does not exist or the entry
 * is absent — the caller decides whether that means "fund it" or "warn".
 */
export async function getAccountBalanceXlm(address: string): Promise<string | null> {
  const key = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: Keypair.fromPublicKey(address).xdrAccountId(),
    })
  ).toXDR("base64");

  const result = await callSorobanRpc<{
    entries?: Array<{ xdr: string }> | null;
  }>("getLedgerEntries", { keys: [key] }, { retries: 0 });

  const entry = result.entries?.[0];
  if (!entry) return null;

  const data = xdr.LedgerEntryData.fromXDR(entry.xdr, "base64");
  const stroops = data.account().balance();
  return (Number(stroops) / 1e7).toFixed(7);
}
