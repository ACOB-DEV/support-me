// Live fiat prices for the assets the platform supports. The browser calls our
// own /api/prices route (which holds the CoinGecko key server-side) rather than
// CoinGecko directly, so the key never ships in the client bundle. Prices are
// best-effort: on failure the UI simply omits the USD hint.

/**
 * Fetch USD prices for the supported assets from our server route. Returns a
 * map like `{ XLM: 0.1123, USDC: 1 }`. Never throws — returns `{}` on failure.
 */
export async function fetchUsdPrices(): Promise<Record<string, number>> {
  try {
    const res = await fetch('/api/prices', { headers: { accept: 'application/json' } });
    if (!res.ok) return {};
    const json = await res.json();
    return json.prices || {};
  } catch {
    return {};
  }
}

/**
 * Format a crypto amount as its USD equivalent, e.g. `≈ $1.23`. Returns null if
 * we have no price for that asset, so callers can conditionally render.
 */
export function formatUsd(
  amount: number,
  code: string,
  prices: Record<string, number> | null | undefined
): string | null {
  const price = prices?.[code];
  if (price == null || !Number.isFinite(amount)) return null;
  const usd = amount * price;
  if (usd === 0) return '$0.00';
  // Show more precision for sub-cent values so tiny tips aren't all "$0.00".
  const digits = usd < 0.01 ? 4 : 2;
  return `≈ $${usd.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
