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
};

const populatedOverview = {
  totalSignups: 2,
  totalCreators: 1,
  earningsByCurrency: { XLM: 42 },
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

    // No zeroed stat cards — just the encouraging copy and CTA.
    expect(screen.queryByText('Sign-ups')).not.toBeInTheDocument();

    const cta = screen.getByRole('link', { name: /create your page/i });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/auth/username');
  });

  it('states what the page is for and what the numbers mean', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(populatedOverview));

    render(<ActivityPage />);

    await waitFor(() => expect(screen.getByText('Sign-ups')).toBeInTheDocument());

    expect(screen.getByRole('heading', { name: 'Community Activity' })).toBeInTheDocument();
    expect(screen.getByText(/aggregated across all accounts/i)).toBeInTheDocument();
    expect(screen.getByText(/never listed here/i)).toBeInTheDocument();
    expect(screen.getByText('Accounts created on SupportMe')).toBeInTheDocument();
    expect(screen.getByText('Accounts with a creator page')).toBeInTheDocument();
  });

  it('renders aggregate headline stats only', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(populatedOverview));

    render(<ActivityPage />);

    await waitFor(() => expect(screen.getByText('Sign-ups')).toBeInTheDocument());

    expect(await screen.findByText('42.00')).toBeInTheDocument();
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument();
  });

  it('never renders per-user rows, names, wallets or earnings, even if the API returns them', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ...populatedOverview,
        // A stale or misbehaving API must not make the page expose people.
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
      }),
    );

    const { container } = render(<ActivityPage />);

    await waitFor(() => expect(screen.getByText('Sign-ups')).toBeInTheDocument());

    expect(container.querySelector('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.queryByText(/GALICE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Users \(/)).not.toBeInTheDocument();
  });

  it('requests the overview without a pagination parameter', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(populatedOverview));

    render(<ActivityPage />);

    await waitFor(() => expect(screen.getByText('Sign-ups')).toBeInTheDocument());
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toMatch(/\/api\/activity\/overview$/);
  });
});
