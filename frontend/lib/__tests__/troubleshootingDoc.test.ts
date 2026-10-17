import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { WALLET_ERROR_TITLES, categorizeWalletError } from '@/lib/walletErrors';
import { FAILURE_TITLES, describeDonationFailure } from '@/lib/failures';
import { DonationError } from '@/lib/contract';
import { headingAnchor, troubleshootingUrl, TROUBLESHOOTING_DOC } from '@/lib/docs';

// lib/contract (imported by lib/failures) pulls in lib/wallet, which loads
// @stellar/freighter-api — its CJS named exports don't survive vitest's ESM
// interop, and nothing here exercises wallet signing.
vi.mock('@/lib/wallet', () => ({
  connectWallet: vi.fn(),
  disconnectWallet: vi.fn(),
  signMessage: vi.fn(),
  signTransaction: vi.fn(),
}));

// The in-app "Learn more" links point at headings in this doc, so every
// user-facing error title must have a heading with exactly that text.
const docPath = path.resolve(__dirname, '../../../docs', TROUBLESHOOTING_DOC);
const doc = readFileSync(docPath, 'utf8');
const headings = doc
  .split('\n')
  .map((line) => line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1])
  .filter((heading): heading is string => Boolean(heading));
const anchors = new Set(headings.map(headingAnchor));

const titles = [...WALLET_ERROR_TITLES, ...Object.values(FAILURE_TITLES)];

describe('docs/testnet-troubleshooting.md', () => {
  it('collects the titles from walletErrors.js and failures.ts', () => {
    expect(WALLET_ERROR_TITLES.length).toBeGreaterThan(0);
    expect(Object.values(FAILURE_TITLES).length).toBeGreaterThan(0);
  });

  it.each(titles)('has a heading for "%s"', (title) => {
    expect(headings).toContain(title);
  });

  it.each(titles)('links "%s" to an anchor that exists in the doc', (title) => {
    const url = troubleshootingUrl(title);
    expect(url).toContain(`/${TROUBLESHOOTING_DOC}#`);
    expect(anchors.has(url.split('#')[1])).toBe(true);
  });
});

describe('headingAnchor', () => {
  it('follows GitHub heading slug rules', () => {
    expect(headingAnchor("Couldn't start subscription")).toBe('couldnt-start-subscription');
    expect(headingAnchor('Cash-out (SEP-24 anchor) errors')).toBe('cash-out-sep-24-anchor-errors');
    expect(headingAnchor('How do I see my transaction on stellar.expert?')).toBe(
      'how-do-i-see-my-transaction-on-stellarexpert'
    );
  });
});

describe('docsUrl on error results', () => {
  it('is set by categorizeWalletError for matched and fallback errors', () => {
    expect(categorizeWalletError(new Error('User declined access')).docsUrl).toBe(
      troubleshootingUrl('Wallet connection cancelled')
    );
    expect(categorizeWalletError(new Error('something odd')).docsUrl).toBe(
      troubleshootingUrl('Could not connect your wallet')
    );
  });

  it('is set by describeDonationFailure', () => {
    const failure = describeDonationFailure(
      new DonationError('simulation', 'Insufficient balance or allowance to complete this action.', undefined),
      'donate'
    );
    expect(failure.docsUrl).toBe(troubleshootingUrl('Not enough balance'));
    expect(describeDonationFailure(new Error('boom'), 'subscribe').docsUrl).toBe(
      troubleshootingUrl("Couldn't start subscription")
    );
  });
});
