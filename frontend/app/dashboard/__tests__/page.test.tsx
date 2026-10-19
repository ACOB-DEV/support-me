import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { forwardRef } from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import DashboardPage from '@/app/dashboard/page';
import { useAuth } from '@/context/AuthContext';
import { useCreator } from '@/context/CreatorContext';
import { toast } from 'sonner';

// jsdom has no real <canvas> implementation. The empty-state CTA opens the
// real ShareModal (rather than a mock), which renders QrCodeCard, so stub
// qrcode.react the same way ShareModal's/QrCodeCard's own tests do.
vi.mock('qrcode.react', () => {
  const MockQRCodeCanvas = forwardRef<HTMLCanvasElement>((_props, ref) => (
    <canvas
      ref={(el) => {
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      data-testid="qr-canvas"
    />
  ));
  MockQRCodeCanvas.displayName = 'MockQRCodeCanvas';

  return {
    QRCodeCanvas: MockQRCodeCanvas,
    QRCodeSVG: ({ id, value }: { id: string; value: string }) => (
      <svg id={id} data-testid="qr-svg" data-value={value} />
    ),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/context/CreatorContext', () => ({
  useCreator: vi.fn(),
}));

const mockUseCreator = vi.mocked(useCreator);

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

// AppNav renders WalletMenu, which pulls in wallet/kit internals we don't need
// under test. Stub it to a marker so the nav renders without that machinery.
vi.mock('@/components/AppNav', () => ({
  AppNav: () => <nav data-testid="app-nav" />,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  private listeners: Record<string, Array<(event: MessageEvent) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (event: MessageEvent) => void) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(cb);
  }

  removeEventListener(type: string, cb: (event: MessageEvent) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter((l) => l !== cb);
  }

  close() {}

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    (this.listeners[type] || []).forEach((cb) => cb(event));
  }
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  elements = new Set<Element>();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
  }

  triggerIntersect(isIntersecting = true) {
    const entries = Array.from(this.elements).map(
      (target) =>
        ({
          isIntersecting,
          target,
          intersectionRatio: isIntersecting ? 1 : 0,
        } as unknown as IntersectionObserverEntry)
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

const mockUseAuth = vi.mocked(useAuth);

const creator = {
  id: 1,
  userId: 42,
  username: 'alice',
  displayName: 'Alice',
  walletAddress: 'GALICE',
  avatarUrl: null,
  donationGoal: null,
  acceptsXlm: true,
  acceptsUsdc: true,
  acceptsUsdt: false,
  socialLinks: null,
};

const donation = {
  id: 1,
  senderAddress: 'GDONOR',
  amount: 5,
  currency: 'XLM',
  message: 'nice work',
  transactionHash: 'tx1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const withdrawal = {
  id: 1,
  amountIn: 12,
  amountOut: 11.5,
  fee: 0.5,
  currency: 'USDC',
  anchorTxId: 'anchor-1',
  stellarTxId: 'stellar-1',
  status: 'completed',
  createdAt: '2026-01-02T00:00:00.000Z',
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body } as Response;
}

// Route fetch by URL rather than call order. The dashboard now also fires
// `fetch('/api/prices')` (via usePrices), so an ordered mock queue would be
// consumed by the prices call. Any unmatched URL (including /api/prices)
// resolves to an empty-ish payload.
function mockFetchByUrl({
  creator,
  creatorNotFound = false,
  donations,
  withdrawals,
  stats,
}: {
  creator?: unknown;
  creatorNotFound?: boolean;
  donations?: unknown | ((url: string) => Response | Promise<Response>);
  withdrawals?: unknown;
  stats?: unknown;
}) {
  if (creatorNotFound) {
    mockUseCreator.mockReturnValue({ creator: null, loading: false, invalidate: vi.fn() });
  } else if (creator !== undefined) {
    mockUseCreator.mockReturnValue({
      creator: creator as ReturnType<typeof useCreator>['creator'],
      loading: false,
      invalidate: vi.fn(),
    });
  }

  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    // Check withdrawals before creators: both contain no overlapping substring,
    // but keep the donations/withdrawals checks ahead of the bare /api/creators.
    if (url.includes('/api/withdrawals')) return Promise.resolve(jsonResponse(withdrawals ?? []));
    if (url.includes('/api/creators/me/stats')) {
      return Promise.resolve(
        jsonResponse(stats ?? { donationCount: 0, uniqueSupporters: 0, currencies: [] })
      );
    }
    if (url.includes('/api/creators/me')) {
      if (creatorNotFound) {
        return Promise.resolve(jsonResponse({ error: 'Creator not found' }, false, 404));
      }
      return Promise.resolve(jsonResponse(creator ?? null));
    }
    if (url.includes('/api/donations')) {
      if (typeof donations === 'function') {
        return Promise.resolve(donations(url));
      }
      if (donations && typeof donations === 'object' && 'ok' in (donations as Record<string, unknown>)) {
        return Promise.resolve(donations as Response);
      }
      return Promise.resolve(jsonResponse(donations ?? []));
    }
    return Promise.resolve(jsonResponse({ prices: {} }));
  });
}

describe('DashboardPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 42, walletAddress: 'GALICE' },
      token: 'jwt-token',
      loading: false,
      loginWithWallet: vi.fn(),
      getTwitterRedirectUrl: vi.fn(),
      completeTwitterLogin: vi.fn(),
      requestMagicLink: vi.fn(),
      verifyMagicLink: vi.fn(),
      logout: vi.fn(),
    });
    mockUseCreator.mockReturnValue({
      creator,
      loading: false,
      invalidate: vi.fn(),
    });
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows a skeleton while the dashboard data is loading', () => {
    mockUseCreator.mockReturnValue({ creator: null, loading: true, invalidate: vi.fn() });
    vi.mocked(fetch).mockReturnValue(new Promise(() => {})); // never resolves

    const { container } = render(<DashboardPage />);

    expect(container.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders volume split and recent donations once data has loaded', async () => {
    // Volume cards read from the server-side aggregate (#245), not the loaded
    // page, so the mock provides the same 5 XLM the aggregate would report.
    mockFetchByUrl({
      creator,
      donations: [donation],
      stats: {
        donationCount: 1,
        uniqueSupporters: 1,
        currencies: [{ currency: 'XLM', total: 5, donationCount: 1, uniqueSupporters: 1, average: 5, largest: 5 }],
      },
    });

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());

    // The single 5 XLM donation shows up as XLM volume, with USDC at zero.
    await waitFor(() =>
      expect(screen.getByText('XLM Volume').nextElementSibling).toHaveTextContent('5 XLM')
    );
    expect(screen.getByText('USDC Volume').nextElementSibling).toHaveTextContent('0 USDC');
    expect(screen.getByText('nice work')).toBeInTheDocument();

    // The creator loads, so the SSE effect subscribes. Wait for it here so the
    // effect runs while EventSource is still stubbed — otherwise it flushes
    // after afterEach tears the stub down and throws "EventSource is not defined".
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
  });

  it('shows a volume card per received currency, including USDT, from the full-history aggregate (#245)', async () => {
    const currencyStat = (currency: string, total: number) => ({
      currency,
      total,
      donationCount: 1,
      uniqueSupporters: 1,
      average: total,
      largest: total,
    });

    mockFetchByUrl({
      creator,
      // The aggregate covers the whole history, including USDT, which is absent
      // from the loaded page.
      stats: {
        donationCount: 3,
        uniqueSupporters: 2,
        currencies: [currencyStat('XLM', 5), currencyStat('USDT', 25)],
      },
      donations: (url: string) => {
        if (url.includes('page=2')) {
          return jsonResponse({
            items: [{ ...donation, id: 2, amount: 5, message: 'older tip', transactionHash: 'tx2' }],
            pagination: { page: 2, limit: 20, total: 2, totalPages: 2 },
          });
        }
        return jsonResponse({
          items: [donation],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 2 },
        });
      },
    });

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('nice work')).toBeInTheDocument());

    // USDT received shows up even though no USDT row is on the loaded page.
    await waitFor(() =>
      expect(screen.getByText('USDT Volume').nextElementSibling).toHaveTextContent('25 USDT')
    );
    expect(screen.getByText('XLM Volume').nextElementSibling).toHaveTextContent('5 XLM');

    // Loading older donations does not change the headline totals.
    const loadMoreBtn = screen.getByRole('button', { name: /load older donations/i });
    act(() => {
      loadMoreBtn.click();
    });
    await waitFor(() => expect(screen.getByText('older tip')).toBeInTheDocument());
    expect(screen.getByText('XLM Volume').nextElementSibling).toHaveTextContent('5 XLM');

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
  });

  it('renders withdrawals in the activity feed and the withdrawn total', async () => {
    mockFetchByUrl({ creator, donations: [donation], withdrawals: [withdrawal] });

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());

    // The cash-out row shows a signed, negative amount and a "Withdraw" label.
    expect(screen.getByText('−12 USDC')).toBeInTheDocument();
    expect(screen.getByText('Withdraw')).toBeInTheDocument();

    // The Withdrawn card sums amountIn by asset.
    expect(screen.getByText('Withdrawn').parentElement).toHaveTextContent('12 USDC');

    // The tip still renders alongside it.
    expect(screen.getByText('nice work')).toBeInTheDocument();

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
  });

  it('prompts profile creation when the user has no creator profile yet', async () => {
    mockFetchByUrl({ creatorNotFound: true });

    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getByText('Complete Your Profile')).toBeInTheDocument()
    );
  });

  it('prepends a new donation received over SSE and shows a toast', async () => {
    mockFetchByUrl({ creator, donations: [donation] });

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));

    act(() => {
      FakeEventSource.instances[0].emit('donation', {
        donor: 'GNEWDONOR',
        creator: 'GALICE',
        amount: '30000000',
        memo: 'live tip',
        timestamp: 1700000000,
        txHash: 'tx-live',
      });
    });

    await waitFor(() => expect(screen.getByText('live tip')).toBeInTheDocument());
    expect(toast.success).toHaveBeenCalledWith(
      'New donation received!',
      expect.objectContaining({ icon: expect.anything() })
    );
  });

  it('loads donations incrementally with pagination and displays count', async () => {
    const donation1 = { ...donation, id: 1, message: 'first page donation', transactionHash: 'tx1' };
    const donation2 = { ...donation, id: 2, message: 'second page donation', transactionHash: 'tx2' };

    mockFetchByUrl({
      creator,
      donations: (url: string) => {
        if (url.includes('page=2')) {
          return jsonResponse({
            items: [donation2],
            pagination: { page: 2, limit: 20, total: 2, totalPages: 2 },
          });
        }
        return jsonResponse({
          items: [donation1],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 2 },
        });
      },
    });

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('first page donation')).toBeInTheDocument());
    expect(screen.getByText('1 of 2 tips')).toBeInTheDocument();
    expect(screen.queryByText('second page donation')).not.toBeInTheDocument();

    const loadMoreBtn = screen.getByRole('button', { name: /load older donations/i });
    expect(loadMoreBtn).toBeInTheDocument();

    act(() => {
      loadMoreBtn.click();
    });

    await waitFor(() => expect(screen.getByText('second page donation')).toBeInTheDocument());
    expect(screen.getByText('first page donation')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 tips')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load older donations/i })).not.toBeInTheDocument();
  });

  it('shows a loading indicator while fetching the next page', async () => {
    let resolvePage2: (value: Response) => void;
    const page2Promise = new Promise<Response>((resolve) => {
      resolvePage2 = resolve;
    });

    mockFetchByUrl({
      creator,
      donations: (url: string) => {
        if (url.includes('page=2')) {
          return page2Promise;
        }
        return jsonResponse({
          items: [donation],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 2 },
        });
      },
    });

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('nice work')).toBeInTheDocument());

    const loadMoreBtn = screen.getByRole('button', { name: /load older donations/i });
    act(() => {
      loadMoreBtn.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('donations-loading-indicator')).toBeInTheDocument();
      expect(screen.getByText('Loading older donations…')).toBeInTheDocument();
    });

    await act(async () => {
      resolvePage2!(
        jsonResponse({
          items: [{ ...donation, id: 2, message: 'next donation', transactionHash: 'tx2' }],
          pagination: { page: 2, limit: 20, total: 2, totalPages: 2 },
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId('donations-loading-indicator')).not.toBeInTheDocument();
      expect(screen.getByText('next donation')).toBeInTheDocument();
    });
  });

  it('triggers next page fetch via infinite scroll when sentinel intersects', async () => {
    const donation1 = { ...donation, id: 1, message: 'page 1 tip', transactionHash: 'tx1' };
    const donation2 = { ...donation, id: 2, message: 'infinite scroll tip', transactionHash: 'tx2' };

    mockFetchByUrl({
      creator,
      donations: (url: string) => {
        if (url.includes('page=2')) {
          return jsonResponse({
            items: [donation2],
            pagination: { page: 2, limit: 20, total: 2, totalPages: 2 },
          });
        }
        return jsonResponse({
          items: [donation1],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 2 },
        });
      },
    });

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('page 1 tip')).toBeInTheDocument());

    expect(FakeIntersectionObserver.instances.length).toBeGreaterThan(0);
    const observer = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];

    act(() => {
      observer.triggerIntersect(true);
    });

    await waitFor(() => expect(screen.getByText('infinite scroll tip')).toBeInTheDocument());
  });

  it('preserves scroll position when older donations are loaded', async () => {
    const scrollToSpy = vi.fn();
    vi.stubGlobal('scrollTo', scrollToSpy);
    window.scrollTo = scrollToSpy;
    Object.defineProperty(window, 'scrollY', { value: 600, writable: true, configurable: true });

    mockFetchByUrl({
      creator,
      donations: (url: string) => {
        if (url.includes('page=2')) {
          return jsonResponse({
            items: [{ ...donation, id: 2, message: 'scrolled item', transactionHash: 'tx2' }],
            pagination: { page: 2, limit: 20, total: 2, totalPages: 2 },
          });
        }
        return jsonResponse({
          items: [donation],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 2 },
        });
      },
    });

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('nice work')).toBeInTheDocument());

    const loadMoreBtn = screen.getByRole('button', { name: /load older donations/i });
    act(() => {
      loadMoreBtn.click();
    });

    await waitFor(() => expect(screen.getByText('scrolled item')).toBeInTheDocument());
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 600, behavior: 'instant' });
  });

  it('shows a friendly empty state with a share CTA when there are no donations yet', async () => {
    mockFetchByUrl({ creator, donations: [] });

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());

    // Encouraging copy instead of zeroed stat cards.
    expect(screen.getByText('Waiting for your first supporter')).toBeInTheDocument();
    expect(screen.queryByText('XLM Volume')).not.toBeInTheDocument();
    expect(screen.queryByText('USDC Volume')).not.toBeInTheDocument();

    // The activity feed also reads as an empty state rather than a blank list.
    expect(
      screen.getByText('No activity yet. Share your page above to start receiving tips.')
    ).toBeInTheDocument();

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
  });

  it('opens the share modal from the empty-state CTA so the creator can share their page', async () => {
    mockFetchByUrl({ creator, donations: [] });

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument());

    const ctaBtn = screen.getByRole('button', { name: /share your page/i });
    fireEvent.click(ctaBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // The link section builds the URL from the creator's username, the same
      // convention used by ShareModal/QrCodeCard elsewhere in the app.
      expect(
        (screen.getByLabelText('Profile link input') as HTMLInputElement).value
      ).toContain('/alice');
    });

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
  });

  it('displays error and allows retrying if loading next page fails', async () => {
    let failPage2 = true;
    mockFetchByUrl({
      creator,
      donations: (url: string) => {
        if (url.includes('page=2')) {
          if (failPage2) {
            return jsonResponse({ error: 'Database timeout' }, false, 500);
          }
          return jsonResponse({
            items: [{ ...donation, id: 2, message: 'recovered donation', transactionHash: 'tx2' }],
            pagination: { page: 2, limit: 20, total: 2, totalPages: 2 },
          });
        }
        return jsonResponse({
          items: [donation],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 2 },
        });
      },
    });

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('nice work')).toBeInTheDocument());

    const loadMoreBtn = screen.getByRole('button', { name: /load older donations/i });
    act(() => {
      loadMoreBtn.click();
    });

    await waitFor(() => {
      expect(screen.getByText('The server returned an error. Please try again.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    failPage2 = false;
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    act(() => {
      retryBtn.click();
    });

    await waitFor(() => {
      expect(screen.getByText('recovered donation')).toBeInTheDocument();
      expect(screen.queryByText('The server returned an error. Please try again.')).not.toBeInTheDocument();
    });
  });
});
