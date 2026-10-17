import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
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

describe('DashboardSkeleton', () => {
  it('renders the dashboard skeleton structure matching metric cards and chart', () => {
    const { container } = render(<DashboardSkeleton />);
    expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();

    // 3 metric cards grid
    const cardsGrid = container.querySelector('.grid.md\\:grid-cols-3');
    expect(cardsGrid).toBeInTheDocument();

    // Donation history skeleton inside recent activity card
    expect(screen.getByTestId('donation-history-skeleton')).toBeInTheDocument();

    // Multiple pulsing skeleton elements
    const pulsingElements = container.querySelectorAll('.motion-safe\\:animate-pulse');
    expect(pulsingElements.length).toBeGreaterThan(20);
  });

  it('can omit navigation when showNav is false', () => {
    const { container } = render(<DashboardSkeleton showNav={false} />);
    expect(container.querySelector('nav')).not.toBeInTheDocument();
  });
});
