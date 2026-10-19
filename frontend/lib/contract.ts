import * as StellarSdk from '@stellar/stellar-sdk';
import { signTransaction as signWithWallet } from './wallet';
import { sacContractId } from './assets';
import { reportRetry, withRetry } from './retry';

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.NEXT_PUBLIC_DONATION_CONTRACT_ID;
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
// Stellar's network targets a ~5s ledger close time; used only to translate
// a subscription's charge interval into an approval expiration window.
const APPROX_SECONDS_PER_LEDGER = 5;
// Soroban enforces a network-wide max ledger-entry TTL of 3,110,400 ledgers —
// an approve() call's live_until_ledger can never be set further out than
// that from the current ledger, no matter how many periods we'd like to
// pre-approve. At ~5s/ledger that's 180 days; a single charge interval can
// never exceed this either, since even one period's allowance must fit.
export const MAX_TTL_LEDGERS = 3_110_400;
export const MAX_MEMO_LENGTH = 140;
export const MAX_CHARGE_INTERVAL_DAYS = Math.floor(
  (MAX_TTL_LEDGERS * APPROX_SECONDS_PER_LEDGER) / 86400
);

const server = new StellarSdk.rpc.Server(RPC_URL);

// How long to keep polling for a submitted transaction to be included in a
// ledger. Soroban targets a ~5s ledger close, so this allows several misses
// before giving up.
const CONFIRMATION_WINDOW_MS = 30_000;
const CONFIRMATION_POLL_MS = 1_500;

/** Status callback stage fired at each step of the build -> simulate -> sign -> submit -> poll pipeline. */
export type ContractCallStatus =
  | 'building'
  | 'simulating'
  | 'awaiting-signature'
  | 'submitting'
  | 'pending'
  | 'success';

export type OnStatus = (status: ContractCallStatus) => void;

// Error types the UI can distinguish between:
// - 'wallet'     wallet not connected / user rejected or failed to sign
// - 'simulation' bad input, insufficient balance, contract precondition failure
// - 'network'    RPC/network unreachable, submission or confirmation failure
// - 'unfunded'   account does not exist on the ledger (needs Friendbot on testnet)
export type DonationErrorType = 'wallet' | 'simulation' | 'network' | 'unfunded' | 'reset';

export class DonationError extends Error {
  type: DonationErrorType;
  cause?: unknown;

  constructor(type: DonationErrorType, message: string, cause?: unknown) {
    super(message);
    this.type = type;
    this.cause = cause;
  }
}

/**
 * Converts a whole-unit amount (e.g. "5.5") to stroops (1e7 per unit),
 * throwing a typed DonationError instead of producing NaN/Infinity that
 * later blows up as an opaque "Cannot convert NaN to a BigInt" from BigInt().
 *
 * @param multiplier extra factor, e.g. periodsToApprove
 */
function toStroops(amount: string | number, multiplier = 1): bigint {
  const value = parseFloat(String(amount));
  if (!Number.isFinite(value) || value <= 0) {
    throw new DonationError('simulation', 'Enter a valid amount greater than 0.');
  }
  return BigInt(Math.round(value * multiplier * 1e7));
}

interface CallContractParams {
  /** Defaults to the donation contract. */
  contractId?: string;
  method: string;
  /** Pre-built ScVal arguments. */
  args: StellarSdk.xdr.ScVal[];
  signerAddress: string;
  onStatus?: OnStatus;
}

interface CallContractResult {
  hash: string;
  returnValue: unknown;
}

/**
 * Shared build → simulate → sign → submit → poll pipeline for a single
 * contract invocation, used by every function below. Centralizes the
 * status-callback stages and error typing so `sendDonation`, `subscribe`,
 * `approveAllowance`, and `cancelSubscription` all fail the same way.
 */
async function callContract({
  contractId = CONTRACT_ID,
  method,
  args,
  signerAddress,
  onStatus,
}: CallContractParams): Promise<CallContractResult> {
  if (!contractId) {
    throw new DonationError(
      'simulation',
      'Donation contract is not configured (missing NEXT_PUBLIC_DONATION_CONTRACT_ID).'
    );
  }

  onStatus?.('building');

  let account: StellarSdk.Account;
  try {
    account = await server.getAccount(signerAddress);
  } catch (err) {
    // Detect 404 / not found errors which indicate an unfunded account
    const message = (err as Error)?.message || '';
    if (/not found|404|account does not exist/i.test(message)) {
      throw new DonationError(
        'unfunded',
        'Your wallet is not funded on the network yet. Use Friendbot to fund it on Testnet.',
        err
      );
    }
    throw new DonationError(
      'network',
      'Could not load your account from the Stellar network. Check your connection and try again.',
      err
    );
  }

  const contract = new StellarSdk.Contract(contractId);

  let tx: StellarSdk.Transaction;
  try {
    tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();
  } catch (err) {
    throw new DonationError('simulation', `Failed to build the ${method} transaction.`, err);
  }

  onStatus?.('simulating');

  let prepared: StellarSdk.Transaction;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (err) {
    const message = (err as Error)?.message || '';
    // Detect missing contract or entry errors (testnet reset)
    if (/not found|no such contract|entry not found|missing contract/i.test(message)) {
      throw new DonationError(
        'reset',
        'The Testnet was reset. This demo is being redeployed. Please try again later.',
        err
      );
    }
    const simMessage = /insufficient|underfunded/i.test(message)
      ? 'Insufficient balance or allowance to complete this action.'
      : message || 'The transaction could not be simulated. Check the amount and try again.';
    throw new DonationError('simulation', simMessage, err);
  }

  onStatus?.('awaiting-signature');

  let signedResult: { signedTxXdr: string; signerAddress?: string };
  try {
    signedResult = await signWithWallet(prepared.toXDR(), signerAddress);
  } catch (err) {
    throw new DonationError(
      'wallet',
      'Signing was cancelled or failed. Please approve the transaction in your wallet.',
      err
    );
  }

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedResult.signedTxXdr,
    NETWORK_PASSPHRASE
  ) as StellarSdk.Transaction;

  onStatus?.('submitting');

  let sendResponse: StellarSdk.rpc.Api.SendTransactionResponse;
  try {
    // Retried on transient failures only. Re-submitting is safe here: the
    // transaction is already signed and has a fixed hash, so a retry is a
    // no-op on any node that accepted the first attempt, and a genuine
    // recovery on a node that dropped it. A contract revert is not retried.
    sendResponse = await withRetry('sendTransaction', () => server.sendTransaction(signedTx), {
      onRetry: reportRetry,
    });
  } catch (err) {
    throw new DonationError('network', 'Failed to submit the transaction to the network.', err);
  }

  if (sendResponse.status === 'ERROR') {
    throw new DonationError('network', 'The network rejected the transaction.', sendResponse);
  }

  onStatus?.('pending');

  const hash = sendResponse.hash;
  const readTransaction = (): Promise<StellarSdk.rpc.Api.GetTransactionResponse> =>
    withRetry('getTransaction', () => server.getTransaction(hash), { onRetry: reportRetry });

  let getResponse = await readTransaction();
  const start = Date.now();
  while (getResponse.status === 'NOT_FOUND' && Date.now() - start < CONFIRMATION_WINDOW_MS) {
    await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_POLL_MS));
    getResponse = await readTransaction();
  }

  if (getResponse.status === 'SUCCESS') {
    onStatus?.('success');
    const returnValue = getResponse.returnValue
      ? StellarSdk.scValToNative(getResponse.returnValue)
      : undefined;
    return { hash, returnValue };
  }

  if (getResponse.status === 'NOT_FOUND') {
    throw new DonationError(
      'network',
      'Timed out waiting for confirmation. Check Stellar Explorer for the latest status.',
      { hash }
    );
  }

  throw new DonationError('network', 'Transaction failed on the network.', getResponse);
}

interface MockContract {
  sendDonation?: (params: SendDonationParams) => Promise<{ hash: string }>;
  approveAllowance?: (
    params: ApproveAllowanceParams
  ) => Promise<{ hash: string; periodsApproved: number }>;
  subscribe?: (params: SubscribeParams) => Promise<{ hash: string; subscriptionId?: number }>;
  cancelSubscription?: (
    params: CancelSubscriptionParams
  ) => Promise<{ hash: string }>;
}

declare global {
  interface Window {
    __SUPPORTME_MOCK_CONTRACT__?: MockContract;
  }
}

export interface SendDonationParams {
  donorAddress: string;
  creatorAddress: string;
  /** Amount in whole units of the asset. */
  amount: string | number;
  /** 'XLM' (default) or 'USDC'. */
  assetCode?: string;
  memo: string;
  onStatus?: OnStatus;
}

/**
 * Calls the deployed `donate` Soroban contract, which both transfers the
 * donated XLM from donor to creator and records the donation on-chain.
 */
export async function sendDonation({
  donorAddress,
  creatorAddress,
  amount,
  assetCode = 'XLM',
  memo,
  onStatus,
}: SendDonationParams): Promise<{ hash: string }> {
  if (typeof window !== 'undefined' && window.__SUPPORTME_MOCK_CONTRACT__?.sendDonation) {
    return window.__SUPPORTME_MOCK_CONTRACT__.sendDonation({
      donorAddress,
      creatorAddress,
      amount,
      assetCode,
      memo,
      onStatus,
    });
  }
  const memoValue = memo || '';
  if (new TextEncoder().encode(memoValue).length > MAX_MEMO_LENGTH) {
    throw new DonationError('simulation', `Message must be ${MAX_MEMO_LENGTH} bytes or fewer.`);
  }
  let tokenId: string;
  try {
    tokenId = sacContractId(assetCode);
  } catch (err) {
    throw new DonationError('simulation', (err as Error).message, err);
  }
  const amountStroops = toStroops(amount);

  const { hash } = await callContract({
    method: 'donate',
    signerAddress: donorAddress,
    args: [
      StellarSdk.nativeToScVal(donorAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(creatorAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(tokenId, { type: 'address' }),
      StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
      StellarSdk.nativeToScVal(memoValue, { type: 'string' }),
    ],
    onStatus,
  });

  return { hash };
}

export interface ApproveAllowanceParams {
  supporterAddress: string;
  /** Amount charged per interval, in whole units. */
  amount: string | number;
  /** 'XLM' (default) or 'USDC'. */
  assetCode?: string;
  /** Seconds between charges. */
  intervalSecs: number;
  /** How many charges' worth of allowance to aim for (default 12, may be reduced to fit the network's max TTL). */
  periodsToApprove?: number;
  onStatus?: OnStatus;
}

/**
 * Grants the donation contract a SAC allowance so `charge_subscription` can
 * later draw `amount` per interval via `transfer_from`, without a fresh
 * wallet signature for every charge. Approves enough for up to
 * `periodsToApprove` charges at once (default 12), but never sets the
 * allowance's expiration further out than Soroban's network-wide max TTL
 * (`MAX_TTL_LEDGERS`) — for long intervals (e.g. monthly) that means fewer
 * than `periodsToApprove` periods get pre-approved; once it runs low the
 * supporter can approve again from the Subscriptions page.
 */
export async function approveAllowance({
  supporterAddress,
  amount,
  assetCode = 'XLM',
  intervalSecs,
  periodsToApprove = 12,
  onStatus,
}: ApproveAllowanceParams): Promise<{ hash: string; periodsApproved: number }> {
  if (typeof window !== 'undefined' && window.__SUPPORTME_MOCK_CONTRACT__?.approveAllowance) {
    return window.__SUPPORTME_MOCK_CONTRACT__.approveAllowance({
      supporterAddress,
      amount,
      assetCode,
      intervalSecs,
      periodsToApprove,
      onStatus,
    });
  }
  let tokenId: string;
  try {
    tokenId = sacContractId(assetCode);
  } catch (err) {
    throw new DonationError('simulation', (err as Error).message, err);
  }
  if (!CONTRACT_ID) {
    throw new DonationError(
      'simulation',
      'Donation contract is not configured (missing NEXT_PUBLIC_DONATION_CONTRACT_ID).'
    );
  }

  const maxTtlSeconds = MAX_TTL_LEDGERS * APPROX_SECONDS_PER_LEDGER;
  if (intervalSecs > maxTtlSeconds) {
    throw new DonationError(
      'simulation',
      `The charge interval is too long — Stellar allows at most ${MAX_CHARGE_INTERVAL_DAYS} days between charges.`
    );
  }

  let latestLedger: number;
  try {
    ({ sequence: latestLedger } = await withRetry(
      'getLatestLedger',
      () => server.getLatestLedger(),
      { onRetry: reportRetry }
    ));
  } catch (err) {
    throw new DonationError('network', 'Could not read the current ledger from the network.', err);
  }

  // Never pre-approve further out than the network's max TTL, even if that
  // means fewer than `periodsToApprove` periods' worth of runway.
  const maxPeriods = Math.floor(maxTtlSeconds / intervalSecs);
  const periodsApproved = Math.max(1, Math.min(periodsToApprove, maxPeriods));

  const expirationLedger =
    latestLedger + Math.ceil((intervalSecs * periodsApproved) / APPROX_SECONDS_PER_LEDGER);
  const amountStroops = toStroops(amount, periodsApproved);

  const { hash } = await callContract({
    contractId: tokenId,
    method: 'approve',
    signerAddress: supporterAddress,
    args: [
      StellarSdk.nativeToScVal(supporterAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(CONTRACT_ID, { type: 'address' }),
      StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
      StellarSdk.nativeToScVal(expirationLedger, { type: 'u32' }),
    ],
    onStatus,
  });

  return { hash, periodsApproved };
}

export interface SubscribeParams {
  supporterAddress: string;
  creatorAddress: string;
  /** Amount charged per interval, in whole units. */
  amount: string | number;
  /** 'XLM' (default) or 'USDC'. */
  assetCode?: string;
  /** Seconds between charges. */
  intervalSecs: number;
  onStatus?: OnStatus;
}

/**
 * Starts a recurring donation by calling the donation contract's
 * `subscribe`. Must be called after `approveAllowance` has granted a
 * sufficient allowance — `subscribe` only records the schedule, it does
 * not move funds.
 */
export async function subscribe({
  supporterAddress,
  creatorAddress,
  amount,
  assetCode = 'XLM',
  intervalSecs,
  onStatus,
}: SubscribeParams): Promise<{ hash: string; subscriptionId: number | undefined }> {
  if (typeof window !== 'undefined' && window.__SUPPORTME_MOCK_CONTRACT__?.subscribe) {
    const result = await window.__SUPPORTME_MOCK_CONTRACT__.subscribe({
      supporterAddress,
      creatorAddress,
      amount,
      assetCode,
      intervalSecs,
      onStatus,
    });
    return { hash: result.hash, subscriptionId: result.subscriptionId };
  }
  let tokenId: string;
  try {
    tokenId = sacContractId(assetCode);
  } catch (err) {
    throw new DonationError('simulation', (err as Error).message, err);
  }
  const amountStroops = toStroops(amount);

  const { hash, returnValue } = await callContract({
    method: 'subscribe',
    signerAddress: supporterAddress,
    args: [
      StellarSdk.nativeToScVal(supporterAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(creatorAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(tokenId, { type: 'address' }),
      StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
      StellarSdk.nativeToScVal(BigInt(intervalSecs), { type: 'u64' }),
    ],
    onStatus,
  });

  return { hash, subscriptionId: returnValue != null ? Number(returnValue) : undefined };
}

export interface CancelSubscriptionParams {
  supporterAddress: string;
  subscriptionId: number;
  onStatus?: OnStatus;
}

/**
 * Cancels a recurring donation via the donation contract's
 * `cancel_subscription`, which also zeroes the remaining on-chain
 * allowance in the same transaction.
 */
export async function cancelSubscription({
  supporterAddress,
  subscriptionId,
  onStatus,
}: CancelSubscriptionParams): Promise<{ hash: string }> {
  if (typeof window !== 'undefined' && window.__SUPPORTME_MOCK_CONTRACT__?.cancelSubscription) {
    return window.__SUPPORTME_MOCK_CONTRACT__.cancelSubscription({
      supporterAddress,
      subscriptionId,
      onStatus,
    });
  }
  const { hash } = await callContract({
    method: 'cancel_subscription',
    signerAddress: supporterAddress,
    args: [
      StellarSdk.nativeToScVal(supporterAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(BigInt(subscriptionId), { type: 'u64' }),
    ],
    onStatus,
  });

  return { hash };
}

/**
 * Funds a wallet address on Testnet using Friendbot. Only works on Testnet.
 * Throws an error if the network is not Testnet or if the request fails.
 */
export async function fundWithFriendbot(address: string): Promise<void> {
  if (NETWORK_PASSPHRASE !== StellarSdk.Networks.TESTNET) {
    throw new DonationError('network', 'Friendbot is only available on Testnet.');
  }

  try {
    const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Friendbot request failed: ${text}`);
    }
  } catch (err) {
    throw new DonationError('network', 'Failed to fund wallet with Friendbot. Please try again.', err);
  }
}
