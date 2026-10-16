import prisma from "../prisma";
import { MoneyValue, toAmount } from "../lib/money";

/** Dashboard metrics for one currency (#224). */
export interface CurrencyStats {
  currency: string;
  total: number;
  donationCount: number;
  uniqueSupporters: number;
  average: number;
  largest: number;
}

/**
 * Dashboard metrics for a creator, PRD v2 section 6.6.
 *
 * Amounts in different assets can't be added together without a price, so
 * earnings, average and largest tip are reported per currency. Donation count
 * and unique supporters are currency-agnostic and reported overall too.
 */
export interface CreatorStats {
  donationCount: number;
  uniqueSupporters: number;
  currencies: CurrencyStats[];
}

interface CurrencyAggregate {
  currency: string;
  _count: { _all: number };
  _sum: { amount: MoneyValue | null };
  _avg: { amount: MoneyValue | null };
  _max: { amount: MoneyValue | null };
}

interface SupporterGroup {
  currency: string;
  senderAddress: string;
}

/** Combines the two grouped queries into the response shape. Pure, so it's easy to test. */
export function buildCreatorStats(
  byCurrency: CurrencyAggregate[],
  bySupporter: SupporterGroup[]
): CreatorStats {
  const supportersByCurrency = new Map<string, Set<string>>();
  const allSupporters = new Set<string>();
  for (const row of bySupporter) {
    allSupporters.add(row.senderAddress);
    const set = supportersByCurrency.get(row.currency) ?? new Set<string>();
    set.add(row.senderAddress);
    supportersByCurrency.set(row.currency, set);
  }

  const currencies = byCurrency
    .map((row) => ({
      currency: row.currency,
      total: toAmount(row._sum.amount),
      donationCount: row._count._all,
      uniqueSupporters: supportersByCurrency.get(row.currency)?.size ?? 0,
      average: toAmount(row._avg.amount),
      largest: toAmount(row._max.amount),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    donationCount: currencies.reduce((sum, c) => sum + c.donationCount, 0),
    uniqueSupporters: allSupporters.size,
    currencies,
  };
}

/** Loads dashboard metrics for a creator from verified donations only. */
export async function getCreatorStats(creatorId: number): Promise<CreatorStats> {
  const where = { creatorId, verified: true };
  const [byCurrency, bySupporter] = await Promise.all([
    prisma.donation.groupBy({
      by: ["currency"],
      where,
      _count: { _all: true },
      _sum: { amount: true },
      _avg: { amount: true },
      _max: { amount: true },
    }),
    prisma.donation.groupBy({
      by: ["currency", "senderAddress"],
      where,
    }),
  ]);

  return buildCreatorStats(
    byCurrency as unknown as CurrencyAggregate[],
    bySupporter as unknown as SupporterGroup[]
  );
}
