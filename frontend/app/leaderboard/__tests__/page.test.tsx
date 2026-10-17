import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ImageProps } from 'next/image';
import LeaderboardPage from '../page';

vi.mock('next/image', () => ({
  default: ({ src, alt, unoptimized, ...rest }: ImageProps) => {
    // Accepted but intentionally unused: next/image's own prop, irrelevant to this plain-<img> stub.
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element -- test stub standing in for next/image, not a real <img>
    return <img src={typeof src === 'string' ? src : undefined} alt={alt} {...rest} />;
  },
}));

vi.mock('@hugeicons/react', () => ({
  HugeiconsIcon: () => <span data-testid="hugeicon" />,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
  }),
}));

vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <button data-testid="theme-toggle">Theme</button>,
}));

vi.mock('@/components/WalletMenu', () => ({
  WalletMenu: () => <div data-testid="wallet-menu">Wallet</div>,
}));

const mockCreatorsData = {
  items: [
    {
      rank: 1,
      total: 1500.5,
      donationCount: 25,
      creator: {
        id: 1,
        username: 'alice',
        displayName: 'Alice In Chains',
        avatarUrl: 'https://example.com/alice.png',
      },
    },
    {
      rank: 2,
      total: 850.0,
      donationCount: 14,
      creator: {
        id: 2,
        username: 'bob',
        displayName: 'Bob The Builder',
        avatarUrl: null,
      },
    },
    {
      rank: 3,
      total: 420.0,
      donationCount: 8,
      creator: {
        id: 3,
        username: 'charlie',
        displayName: null,
        avatarUrl: null,
      },
    },
    {
      rank: 4,
      total: 210.0,
      donationCount: 4,
      creator: {
        id: 4,
        username: 'dave',
        displayName: 'Dave',
        avatarUrl: null,
      },
    },
  ],
  currency: 'XLM',
  pagination: { page: 1, limit: 50, total: 4, totalPages: 1 },
};

const mockSupportersData = {
  items: [
    {
      rank: 1,
      total: 3000.0,
      donationCount: 42,
      senderAddress: 'GBWHALE12345678901234567890123456789012345678901234567890',
    },
    {
      rank: 2,
      total: 1200.0,
      donationCount: 15,
      senderAddress: 'GCSUPPORTER9876543210987654321098765432109876543210987654',
    },
  ],
  currency: 'XLM',
  pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
};

describe('LeaderboardPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('type=supporters')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockSupportersData),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockCreatorsData),
        });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders page header and navigation', async () => {
    render(<LeaderboardPage />);

    expect(screen.getByRole('heading', { level: 1, name: /platform leaderboard/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /top creators/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /top supporters/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('Alice In Chains').length).toBeGreaterThan(0);
    });
  });

  it('renders top creators with podium and profile links', async () => {
    render(<LeaderboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Alice In Chains').length).toBeGreaterThan(0);
    });

    // Check podium ranks
    expect(screen.getByText(/rank #1/i)).toBeInTheDocument();
    expect(screen.getByText(/rank #2/i)).toBeInTheDocument();
    expect(screen.getByText(/rank #3/i)).toBeInTheDocument();

    // Check links to profile
    const aliceLinks = screen.getAllByRole('link', { name: /alice in chains/i });
    expect(aliceLinks[0]).toHaveAttribute('href', '/alice');

    // Check rank 4 in table
    expect(screen.getAllByText('#4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dave').length).toBeGreaterThan(0);
  });

  it('switches to top supporters tab and fetches supporter rankings', async () => {
    render(<LeaderboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Alice In Chains').length).toBeGreaterThan(0);
    });

    const supportersTab = screen.getByRole('tab', { name: /top supporters/i });
    fireEvent.click(supportersTab);

    await waitFor(() => {
      expect(screen.getAllByText('GBWHAL…7890').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText(/3,000\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/42 tips/).length).toBeGreaterThan(0);
  });

  it('switches currency filter and refetches', async () => {
    render(<LeaderboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Alice In Chains').length).toBeGreaterThan(0);
    });

    const usdcButton = screen.getByRole('button', { name: 'USDC' });
    fireEvent.click(usdcButton);

    expect(usdcButton).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('currency=USDC')
      );
    });
  });

  it('renders empty state when no items are returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [], currency: 'XLM', pagination: { total: 0 } }),
      })
    );

    render(<LeaderboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('leaderboard-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/no leaderboard entries yet/i)).toBeInTheDocument();
  });

  it('renders error state and retries on failure', async () => {
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        if (fail) {
          return Promise.reject(new Error('Network disconnected'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockCreatorsData),
        });
      })
    );

    render(<LeaderboardPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/unable to load leaderboard/i)).toBeInTheDocument();
    expect(screen.getByText(/network disconnected/i)).toBeInTheDocument();

    fail = false;
    const retryButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getAllByText('Alice In Chains').length).toBeGreaterThan(0);
    });
  });
});
