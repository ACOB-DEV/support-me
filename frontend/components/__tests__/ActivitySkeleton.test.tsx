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
  it('renders the activity skeleton structure matching the intro and headline stats', () => {
    const { container } = render(<ActivitySkeleton />);
    expect(screen.getByTestId('activity-skeleton')).toBeInTheDocument();

    // 3 headline stat cards
    const statsGrid = container.querySelector('.grid.md\\:grid-cols-3');
    expect(statsGrid).toBeInTheDocument();

    // Aggregate-only page: three stat cards and no per-user table.
    expect(container.querySelectorAll('.card-brutal')).toHaveLength(3);
    expect(container.querySelector('table')).not.toBeInTheDocument();

    const pulsingElements = container.querySelectorAll('.motion-safe\\:animate-pulse');
    expect(pulsingElements.length).toBeGreaterThan(8);
  });

  it('can omit navigation when showNav is false', () => {
    const { container } = render(<ActivitySkeleton showNav={false} />);
    expect(container.querySelector('nav')).not.toBeInTheDocument();
  });
});
