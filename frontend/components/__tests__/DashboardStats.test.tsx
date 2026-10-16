import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DashboardStats, totalEarningsUsd, type CreatorStats } from '@/components/DashboardStats';

const stats: CreatorStats = {
  donationCount: 5,
  uniqueSupporters: 3,
  currencies: [
    { currency: 'USDC', total: 12, donationCount: 2, uniqueSupporters: 1, average: 6, largest: 10 },
    { currency: 'XLM', total: 300, donationCount: 3, uniqueSupporters: 2, average: 100, largest: 250 },
  ],
};

describe('DashboardStats (#224)', () => {
  it('shows the five PRD metrics', () => {
    render(<DashboardStats stats={stats} prices={{ XLM: 0.1, USDC: 1 }} />);

    expect(within(screen.getByTestId('stat-donation-count')).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-unique-supporters')).getByText('3')).toBeInTheDocument();

    const total = screen.getByTestId('stat-total-earnings');
    // 300 XLM * 0.1 + 12 USDC * 1 = $42.00
    expect(within(total).getByText('≈ $42.00')).toBeInTheDocument();
    expect(total).toHaveTextContent('300 XLM');
    expect(total).toHaveTextContent('12 USDC');

    expect(screen.getByTestId('stat-average-tip')).toHaveTextContent('100 XLM');
    expect(screen.getByTestId('stat-average-tip')).toHaveTextContent('6 USDC');
    expect(screen.getByTestId('stat-largest-tip')).toHaveTextContent('250 XLM');
    expect(screen.getByTestId('stat-largest-tip')).toHaveTextContent('10 USDC');
  });

  it('hides the USD total when a currency has no price', () => {
    render(
      <DashboardStats
        stats={{
          ...stats,
          currencies: [
            ...stats.currencies,
            { currency: 'MYTOKEN', total: 7, donationCount: 1, uniqueSupporters: 1, average: 7, largest: 7 },
          ],
        }}
        prices={{ XLM: 0.1, USDC: 1 }}
      />
    );
    const total = screen.getByTestId('stat-total-earnings');
    expect(total).not.toHaveTextContent('$');
    expect(total).toHaveTextContent('7 MYTOKEN');
  });
});

describe('totalEarningsUsd', () => {
  it('sums priced currencies', () => {
    expect(totalEarningsUsd(stats.currencies, { XLM: 0.1, USDC: 1 })).toBeCloseTo(42);
  });

  it('returns null when any price is missing or prices are unavailable', () => {
    expect(totalEarningsUsd(stats.currencies, { XLM: 0.1 })).toBeNull();
    expect(totalEarningsUsd(stats.currencies, null)).toBeNull();
  });

  it('is zero with no donations', () => {
    expect(totalEarningsUsd([], null)).toBe(0);
  });
});
