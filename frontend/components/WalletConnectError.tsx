'use client';

import { WALLET_INSTALL_LINKS } from '@/lib/walletErrors';

export interface WalletConnectErrorData {
  // Optional: unused by this component itself, kept for callers (e.g.
  // categorizeWalletError) that tag their own error variants by type.
  type?: string;
  title: string;
  message: string;
  action?: string;
  retryLabel?: string;
  showInstallLinks?: boolean;
  rawMessage?: string;
  // Optional link to the matching docs/testnet-troubleshooting.md section;
  // set by categorizeWalletError, absent for errors not covered there.
  docsUrl?: string;
}

/**
 * Actionable wallet-connection error message. Shows the specific failure case
 * (no wallet installed, user rejected, wrong network, or unknown), a retry
 * button that re-runs the connect handler without reloading the page, and
 * wallet install links when no wallet is detected, plus a "Learn more" link
 * to the troubleshooting guide when the error carries a `docsUrl`.
 */
export function WalletConnectError({
  error,
  onRetry,
  className = '',
}: {
  error: WalletConnectErrorData;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div className={`card-brutal bg-brand-pink p-4 text-left ${className}`} role="alert">
      <p className="font-extrabold text-ink">{error.title}</p>
      <p className="mt-1 text-sm font-medium text-ink/85">{error.message}</p>

      {error.showInstallLinks && (
        <ul className="mt-3 space-y-1 text-sm">
          {WALLET_INSTALL_LINKS.map((wallet) => (
            <li key={wallet.name}>
              <a
                href={wallet.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-ink underline"
              >
                {wallet.name}
              </a>
              <span className="font-medium text-ink/70"> — {wallet.description}</span>
            </li>
          ))}
        </ul>
      )}

      {error.action && <p className="mt-3 text-xs font-bold text-ink/90">{error.action}</p>}

      {error.docsUrl && (
        <p className="mt-2 text-xs">
          <a
            href={error.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-ink underline"
          >
            Learn more<span className="sr-only"> about this error (opens in a new tab)</span>
          </a>
        </p>
      )}

      <button
        type="button"
        onClick={onRetry}
        className="btn-brutal btn-brutal-primary mt-4 inline-block text-sm"
      >
        {error.retryLabel || 'Try again'}
      </button>
    </div>
  );
}