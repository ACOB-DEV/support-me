'use client';

import { useEffect, useState } from 'react';
import { fetchUsdPrices } from './prices';

// Poll CoinGecko for USD prices of the assets we support and keep them fresh.
// Prices are best-effort: if the fetch fails, `prices` stays null and callers
// simply hide USD values rather than showing a wrong number.
export function usePrices(refreshMs = 60_000): Record<string, number> | null {
  const [prices, setPrices] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let active = true;

    const load = async (): Promise<void> => {
      const p = await fetchUsdPrices();
      if (active && p) setPrices(p);
    };

    load();
    const timer = window.setInterval(load, refreshMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshMs]);

  return prices;
}
