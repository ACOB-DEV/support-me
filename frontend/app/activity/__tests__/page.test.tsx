import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ActivityPage from '@/app/activity/page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/activity',
}));

// AppNav renders WalletMenu, which pulls in wallet/kit internals we don't need
// under test. Stub it to a marker so the nav renders without that machinery.
vi.mock('@/components/AppNav', () => ({
  AppNav: () => <nav data-testid="app-nav" />,
}));

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body } as Response;
}

const emptyOverview = {
  totalSignups: 0,
  totalCreators: 0,
  earningsByCurrency: {},
  users: [],
  pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
};

const populatedOverview = {
  totalSignups: 2,
  totalCreators: 1,
  earningsByCurrency: { XLM: 42 },
  users: [
    {
      id: 1,
      walletAddress: 'GALICE1234567890',
      joinedAt: '2026-01-01T00:00:00.000Z',
      username: 'alice',
      displayName: 'Alice',
      earningsByCurrency: { XLM: 42 },
    },
  ],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
};

describe('ActivityPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows a skeleton while the overview is loading', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {})); // never resolves

    const { container } = render(<ActivityPage />);

    expect(container.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows a friendly empty state with a CTA when nothing has happened yet', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(emptyOverview));

    render(<ActivityPage />);

    await waitFor(() => expect(screen.getByText('No activity yet')).toBeInTheDocument());

    // No zeroed stat cards or an empty table — just the encouraging copy and CTA.
    expect(screen.queryByText('Sign-ups')).not.toBeInTheDocument();
    expect(screen.queryByText('No users yet.')).not.toBeInTheDocument();

    const cta = screen.getByRole('link', { name: /create your page/i });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/auth/username');
  });

  it('renders headline stats and the users table once there is real activity', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(populatedOverview));

    render(<ActivityPage />);

    await waitFor(() => expect(screen.getByText('Sign-ups')).toBeInTheDocument());

    expect(screen.getByText('Users (1)')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument();
  });
});
