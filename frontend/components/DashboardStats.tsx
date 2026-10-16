import { formatUsd } from '@/lib/prices';

/** Per-currency dashboard metrics, as returned by GET /api/creators/me/stats. */
export interface CurrencyStats {
  currency: string;
  total: number;
  donationCount: number;
  uniqueSupporters: number;
  average: number;
  largest: number;
}

export interface CreatorStats {
  donationCount: number;
  uniqueSupporters: number;
  currencies: CurrencyStats[];
}

interface DashboardStatsProps {
  stats: CreatorStats;
  prices?: Record<string, number> | null;
}

const formatAmount = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Sum of every currency's total converted to USD, or null if any currency has
 * no known price (a partial sum would understate earnings).
 */
export function totalEarningsUsd(
  currencies: CurrencyStats[],
  prices?: Record<string, number> | null
): number | null {
  if (currencies.length === 0) return 0;
  let sum = 0;
  for (const c of currencies) {
    const price = prices?.[c.currency];
    if (price == null) return null;
    sum += c.total * price;
  }
  return sum;
}

function PerCurrency({
  currencies,
  pick,
  prices,
}: {
  currencies: CurrencyStats[];
  pick: (c: CurrencyStats) => number;
  prices?: Record<string, number> | null;
}) {
  return (
    <div className="mt-2 space-y-1">
      {currencies.map((c) => (
        <p key={c.currency} className="text-xl sm:text-2xl font-extrabold text-ink tabular-nums">
          {formatAmount(pick(c))} <span className="text-base">{c.currency}</span>
          {prices && formatUsd(pick(c), c.currency, prices) && (
            <span className="block text-sm font-bold text-ink/70">
              {formatUsd(pick(c), c.currency, prices)}
            </span>
          )}
        </p>
      ))}
    </div>
  );
}

/** Headline metrics from PRD v2 section 6.6 (#224). */
export function DashboardStats({ stats, prices }: DashboardStatsProps) {
  const usd = totalEarningsUsd(stats.currencies, prices);

  return (
    <section aria-label="Dashboard metrics" className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
      <div className="card-brutal bg-card p-5" data-testid="stat-total-earnings">
        <p className="text-ink text-sm font-bold uppercase tracking-wide">Total earnings</p>
        {usd !== null && (
          <p className="text-2xl sm:text-3xl font-extrabold text-ink mt-2 tabular-nums">
            ≈ ${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        )}
        <PerCurrency currencies={stats.currencies} pick={(c) => c.total} />
      </div>
      <div className="card-brutal bg-card p-5" data-testid="stat-donation-count">
        <p className="text-ink text-sm font-bold uppercase tracking-wide">Donations</p>
        <p className="text-2xl sm:text-3xl font-extrabold text-ink mt-2 tabular-nums">
          {stats.donationCount.toLocaleString()}
        </p>
      </div>
      <div className="card-brutal bg-card p-5" data-testid="stat-unique-supporters">
        <p className="text-ink text-sm font-bold uppercase tracking-wide">Unique supporters</p>
        <p className="text-2xl sm:text-3xl font-extrabold text-ink mt-2 tabular-nums">
          {stats.uniqueSupporters.toLocaleString()}
        </p>
      </div>
      <div className="card-brutal bg-card p-5" data-testid="stat-average-tip">
        <p className="text-ink text-sm font-bold uppercase tracking-wide">Average tip</p>
        <PerCurrency currencies={stats.currencies} pick={(c) => c.average} prices={prices} />
      </div>
      <div className="card-brutal bg-card p-5" data-testid="stat-largest-tip">
        <p className="text-ink text-sm font-bold uppercase tracking-wide">Largest tip</p>
        <PerCurrency currencies={stats.currencies} pick={(c) => c.largest} prices={prices} />
      </div>
    </section>
  );
}
