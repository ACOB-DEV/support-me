'use client';

import * as StellarSdk from '@stellar/stellar-sdk';

const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

interface TestnetBadgeProps {
  className?: string;
}

/**
 * Shows a "Testnet" badge when the app is configured for Testnet.
 * This helps users distinguish between testnet and mainnet environments.
 */
export function TestnetBadge({ className = '' }: TestnetBadgeProps) {
  if (NETWORK_PASSPHRASE !== StellarSdk.Networks.TESTNET) {
    return null;
  }

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-md bg-brand-lime border border-ink/30 font-bold text-ink ${className}`}
      title="This app runs on Stellar Testnet — no real funds are used."
    >
      Testnet
    </span>
  );
}
