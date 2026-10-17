import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivitySkeleton } from '@/components/ActivitySkeleton';

vi.mock('next/navigation', () => ({
  usePathname: () => '/activity',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    token: null,
    loading: false,
    loginWithWallet: vi.fn(),
    logout: vi.fn(),
  }),
}));

describe('ActivitySkeleton', () => {
  it('renders the activity skeleton structure matching headline stats and users table', () => {
    const { container } = render(<ActivitySkeleton />);
    expect(screen.getByTestId('activity-skeleton')).toBeInTheDocument();

    // 3 headline stat cards
    const statsGrid = container.querySelector('.grid.md\\:grid-cols-3');
    expect(statsGrid).toBeInTheDocument();

    // Users table skeleton
    const tableCard = container.querySelectorAll('.card-brutal');
    expect(tableCard.length).toBeGreaterThanOrEqual(4);

    const pulsingElements = container.querySelectorAll('.motion-safe\\:animate-pulse');
    expect(pulsingElements.length).toBeGreaterThan(15);
  });

  it('can omit navigation when showNav is false', () => {
    const { container } = render(<ActivitySkeleton showNav={false} />);
    expect(container.querySelector('nav')).not.toBeInTheDocument();
  });
});
