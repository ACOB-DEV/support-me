import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DonationHistorySkeleton } from '@/components/DonationHistorySkeleton';

describe('DonationHistorySkeleton', () => {
  it('renders default number of skeleton donation rows', () => {
    render(<DonationHistorySkeleton />);
    const list = screen.getByTestId('donation-history-skeleton');
    expect(list).toBeInTheDocument();
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(4);
  });

  it('renders custom number of rows when specified', () => {
    render(<DonationHistorySkeleton rows={6} />);
    const list = screen.getByTestId('donation-history-skeleton');
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(6);
  });

  it('contains pulsing placeholder elements for each row', () => {
    const { container } = render(<DonationHistorySkeleton rows={2} />);
    const pulsing = container.querySelectorAll('.motion-safe\\:animate-pulse');
    expect(pulsing.length).toBeGreaterThanOrEqual(8);
  });

  it('applies custom className', () => {
    render(<DonationHistorySkeleton className="custom-class" />);
    const list = screen.getByTestId('donation-history-skeleton');
    expect(list.className).toContain('custom-class');
  });
});
