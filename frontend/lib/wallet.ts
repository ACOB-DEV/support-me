import { StellarWalletsKit, Networks } from '@creit.tech/stellar-wallets-kit';
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter';
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull';
import { AlbedoModule } from '@creit.tech/stellar-wallets-kit/modules/albedo';
import { RabetModule } from '@creit.tech/stellar-wallets-kit/modules/rabet';
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr';

const NETWORK_PASSPHRASE = Networks.TESTNET;

let initialized = false;

export interface WalletConnectionErrorOptions {
  code?: string | number;
  raw?: unknown;
}

// Normalized error thrown by every wallet operation in this module. The kit
// and individual wallets reject with plain objects (e.g. `{ code, message }`)
// or loosely-typed messages, so we wrap them in a real Error carrying the
// original `code` for downstream categorization.
export class WalletConnectionError extends Error {
  code?: string | number;
  details?: unknown;

  constructor(message: string, options: WalletConnectionErrorOptions = {}) {
    super(message);
    this.name = 'WalletConnectionError';
    this.code = options.code;
    this.details = options.raw;
  }
}

/** Shape of the loosely-typed rejections the kit and individual wallets throw. */
interface RawWalletError {
  message?: string;
  code?: string | number;
  error?: { message?: string; code?: string | number };
}

const toWalletError = (err: unknown): WalletConnectionError => {
  if (err instanceof WalletConnectionError) return err;
  const raw = (err ?? {}) as RawWalletError;
  const message = raw.message || raw.error?.message || 'Could not connect to your wallet.';
  return new WalletConnectionError(message, {
    code: raw.error?.code ?? raw.code,
    raw: err,
  });
};

const ensureInit = (): void => {
  if (initialized) return;

  StellarWalletsKit.init({
    network: NETWORK_PASSPHRASE,
    modules: [
      new FreighterModule(),
      new xBullModule(),
      new AlbedoModule(),
      new RabetModule(),
      new LobstrModule(),
    ],
  });

  initialized = true;
};

interface MockWallet {
  connectWallet?: () => Promise<string | null>;
  disconnectWallet?: () => Promise<void>;
  signTransaction?: (
    xdr: string,
    address: string
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  signMessage?: (message: string, address: string) => Promise<string>;
}

declare global {
  interface Window {
    __SUPPORTME_MOCK_WALLET__?: MockWallet;
  }
}

// Opens the built-in wallet picker modal (Freighter, xBull, Albedo, Rabet, Lobstr)
// and returns the connected public address.
export const connectWallet = async (): Promise<string | null> => {
  if (typeof window !== 'undefined' && window.__SUPPORTME_MOCK_WALLET__?.connectWallet) {
    return window.__SUPPORTME_MOCK_WALLET__.connectWallet();
  }
  ensureInit();
  try {
    const res = await StellarWalletsKit.authModal();
    return res?.address || null;
  } catch (err) {
    const message = (err as RawWalletError)?.message?.toLowerCase() ?? '';
    if (
      message.includes('closed') ||
      message.includes('rejected') ||
      message.includes('canceled') ||
      message.includes('cancelled')
    ) {
      return null;
    }
    throw err;
  }
};

export const disconnectWallet = async (): Promise<void> => {
  if (typeof window !== 'undefined' && window.__SUPPORTME_MOCK_WALLET__?.disconnectWallet) {
    return window.__SUPPORTME_MOCK_WALLET__.disconnectWallet();
  }
  if (!initialized) return;
  await StellarWalletsKit.disconnect();
};

// Signs an XDR transaction using whichever wallet the user picked in the modal.
export const signTransaction = async (
  xdr: string,
  address: string
): Promise<{ signedTxXdr: string; signerAddress?: string }> => {
  if (typeof window !== 'undefined' && window.__SUPPORTME_MOCK_WALLET__?.signTransaction) {
    return window.__SUPPORTME_MOCK_WALLET__.signTransaction(xdr, address);
  }
  ensureInit();
  try {
    return await StellarWalletsKit.signTransaction(xdr, {
      address,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
  } catch (err) {
    throw toWalletError(err);
  }
};

// Signs an arbitrary text message (used for the wallet sign-in challenge).
// Returns the base64-encoded signed message.
export const signMessage = async (message: string, address: string): Promise<string> => {
  if (typeof window !== 'undefined' && window.__SUPPORTME_MOCK_WALLET__?.signMessage) {
    return window.__SUPPORTME_MOCK_WALLET__.signMessage(message, address);
  }
  ensureInit();
  try {
    const { signedMessage } = await StellarWalletsKit.signMessage(message, {
      address,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    return signedMessage;
  } catch (err) {
    throw toWalletError(err);
  }
};
