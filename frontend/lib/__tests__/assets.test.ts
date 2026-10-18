import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BalanceLine } from '@/lib/assets';

// USDC_ISSUER/USDT_ISSUER are read from process.env at module load time, so
// each test resets the module registry and re-imports after setting env vars
// — a static top-level import would only ever see whatever was set first.
const ORIGINAL_ENV = { ...process.env };

async function loadAssets() {
  const mod = await import('@/lib/assets');
  return mod;
}

/**
 * A minimal-but-complete credit-asset balance line for balanceMatcher tests,
 * which only read asset_code/asset_issuer/asset_type. The other fields are
 * required by Horizon's real BalanceLineAsset shape but irrelevant here.
 */
function creditBalance(assetCode: string, assetIssuer: string | undefined): BalanceLine {
  return {
    asset_type: 'credit_alphanum4',
    asset_code: assetCode,
    asset_issuer: assetIssuer ?? '',
    balance: '0',
    limit: '0',
    buying_liabilities: '0',
    selling_liabilities: '0',
    last_modified_ledger: 0,
    is_authorized: true,
    is_authorized_to_maintain_liabilities: true,
    is_clawback_enabled: false,
  };
}

describe('lib/assets', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_USDC_ISSUER;
    delete process.env.NEXT_PUBLIC_USDT_ISSUER;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('only offers XLM when no USDC/USDT issuer is configured', async () => {
    const { availableAssetCodes } = await loadAssets();
    expect(availableAssetCodes()).toEqual(['XLM']);
  });

  it('adds USDC once its issuer env is set, without requiring USDT', async () => {
    process.env.NEXT_PUBLIC_USDC_ISSUER = 'GUSDCISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const { availableAssetCodes, ASSETS } = await loadAssets();
    expect(availableAssetCodes()).toEqual(['XLM', 'USDC']);
    expect(ASSETS.USDT).toBeUndefined();
  });

  it('adds USDT once its issuer env is set (issue #18), mirroring the USDC entry shape', async () => {
    process.env.NEXT_PUBLIC_USDT_ISSUER = 'GUSDTISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const { availableAssetCodes, ASSETS } = await loadAssets();

    expect(availableAssetCodes()).toEqual(['XLM', 'USDT']);
    expect(ASSETS.USDT).toMatchObject({
      code: 'USDT',
      label: 'USDT',
      issuer: process.env.NEXT_PUBLIC_USDT_ISSUER,
    });
    expect(typeof ASSETS.USDT!.asset).toBe('function');
    expect(typeof ASSETS.USDT!.balanceMatcher).toBe('function');
  });

  it('offers both USDC and USDT when both issuers are configured', async () => {
    process.env.NEXT_PUBLIC_USDC_ISSUER = 'GUSDCISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    process.env.NEXT_PUBLIC_USDT_ISSUER = 'GUSDTISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const { availableAssetCodes } = await loadAssets();
    expect(availableAssetCodes()).toEqual(['XLM', 'USDC', 'USDT']);
  });

  it("USDT's balanceMatcher only matches balances for its own asset code and issuer", async () => {
    process.env.NEXT_PUBLIC_USDT_ISSUER = 'GUSDTISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const { ASSETS } = await loadAssets();

    expect(
      ASSETS.USDT!.balanceMatcher(creditBalance('USDT', process.env.NEXT_PUBLIC_USDT_ISSUER))
    ).toBe(true);
    expect(ASSETS.USDT!.balanceMatcher(creditBalance('USDT', 'GSOMEOTHERISSUER'))).toBe(false);
    expect(
      ASSETS.USDT!.balanceMatcher(creditBalance('USDC', process.env.NEXT_PUBLIC_USDT_ISSUER))
    ).toBe(false);
  });

  it('getAsset falls back to XLM for an unconfigured code', async () => {
    const { getAsset, ASSETS } = await loadAssets();
    expect(getAsset('USDT')).toBe(ASSETS.XLM);
  });

  it('getAsset resolves USDT once configured', async () => {
    process.env.NEXT_PUBLIC_USDT_ISSUER = 'GUSDTISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const { getAsset } = await loadAssets();
    expect(getAsset('USDT').code).toBe('USDT');
  });

  it('sacContractId throws a clear error for USDT when not configured on this deployment', async () => {
    const { sacContractId } = await loadAssets();
    expect(() => sacContractId('USDT')).toThrow(/USDT is not configured for donations/);
  });
});
