import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import WithdrawPage from '@/app/app/withdraw/page';
import { useAuth } from '@/context/AuthContext';
import { useCreator } from '@/context/CreatorContext';
import { notify } from '@/lib/notify';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/context/CreatorContext', () => ({
  useCreator: vi.fn(),
}));

vi.mock('@/components/AppNav', () => ({
  AppNav: () => <nav data-testid="app-nav" />,
}));

vi.mock('@/lib/notify', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/useNgnRate', () => ({
  useNgnRate: () => ({
    rate: 1500,
    ageMinutes: 2,
    isStale: false,
    source: 'coingecko',
  }),
}));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: class MockServer {
        loadAccount = vi.fn().mockResolvedValue({
          balances: [
            { asset_type: 'native', balance: '100.5' },
            { asset_code: 'USDC', asset_issuer: 'GBUSDC', balance: '250.0' },
          ],
        });
      },
    },
  };
});

const mockUseAuth = vi.mocked(useAuth);
const mockUseCreator = vi.mocked(useCreator);

describe('WithdrawPage', () => {
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
    presetAmounts: [],
  };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_USDC_ISSUER = 'GBUSDC';

    mockUseAuth.mockReturnValue({
      user: { id: 42, walletAddress: 'GALICE' },
      token: 'test-token',
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

    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders the prominent demo mode disclaimer above the fold', () => {
    render(<WithdrawPage />);

    expect(screen.getByText(/Demo mode/i)).toBeInTheDocument();
    expect(screen.getByText(/Simulated off-ramp/i)).toBeInTheDocument();
    expect(
      screen.getByText(/No real bank transfer occurs and no on-chain funds move/i)
    ).toBeInTheDocument();
  });

  it('renders user balances', async () => {
    render(<WithdrawPage />);

    await waitFor(() => {
      expect(screen.getByText('101')).toBeInTheDocument(); // Math.round(100.5)
      expect(screen.getByText('250')).toBeInTheDocument(); // Math.round(250.0)
    });
  });

  it('validates amount, bank, and account number before submitting', async () => {
    render(<WithdrawPage />);

    // Try submit without amount
    fireEvent.click(screen.getByRole('button', { name: /Simulate withdrawal/i }));
    expect(await screen.findByText('Enter an amount greater than zero.')).toBeInTheDocument();

    // Fill invalid amount exceeding balance (balance is 250)
    fireEvent.change(screen.getByLabelText(/Amount \(USDC\)/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /Simulate withdrawal/i }));
    expect(await screen.findByText('Amount exceeds your available USDC balance.')).toBeInTheDocument();

    // Fill valid amount
    fireEvent.change(screen.getByLabelText(/Amount \(USDC\)/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /Simulate withdrawal/i }));
    expect(await screen.findByText('Enter a valid 10-digit account number.')).toBeInTheDocument();

    // Fill invalid account number
    fireEvent.change(screen.getByLabelText(/Account number/i), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /Simulate withdrawal/i }));
    expect(await screen.findByText('Enter a valid 10-digit account number.')).toBeInTheDocument();

    // Fill valid 10-digit account number but no bank
    fireEvent.change(screen.getByLabelText(/Account number/i), { target: { value: '0123456789' } });
    fireEvent.click(screen.getByRole('button', { name: /Simulate withdrawal/i }));
    expect(await screen.findByText('Select your bank.')).toBeInTheDocument();
  });

  it('verifies bank account number and displays account holder name', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accountName: 'ALICE JANE DOE' }),
    } as Response);

    render(<WithdrawPage />);

    fireEvent.change(screen.getByLabelText(/Bank/i), { target: { value: 'GTBank' } });
    fireEvent.change(screen.getByLabelText(/Account number/i), { target: { value: '0123456789' } });

    await waitFor(() => {
      expect(screen.getByText(/Account holder: ALICE JANE DOE/i)).toBeInTheDocument();
    });
  });

  it('shows required creator profile warning when user has no creator profile', () => {
    mockUseCreator.mockReturnValue({
      creator: null,
      loading: false,
      invalidate: vi.fn(),
    });

    render(<WithdrawPage />);

    expect(screen.getByText('Creator profile required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Simulate withdrawal/i })).toBeDisabled();
  });

  it('submits withdrawal successfully, calls POST /api/withdrawals, and displays reference', async () => {
    // Mock verify-account
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accountName: 'ALICE JANE DOE' }),
    } as Response);

    // Mock POST /api/withdrawals
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: 10,
        creatorUsername: 'alice',
        amountIn: 50,
        amountOut: 75000,
        fee: 0,
        currency: 'USDC',
        anchorTxId: 'PL-TESTREF123',
        status: 'completed',
      }),
    } as Response);

    render(<WithdrawPage />);

    fireEvent.change(screen.getByLabelText(/Amount \(USDC\)/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/Bank/i), { target: { value: 'GTBank' } });
    fireEvent.change(screen.getByLabelText(/Account number/i), { target: { value: '0123456789' } });

    await waitFor(() => {
      expect(screen.getByText(/Account holder: ALICE JANE DOE/i)).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /Simulate withdrawal/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Withdrawal recorded (Demo)')).toBeInTheDocument();
      expect(screen.getByText('PL-TESTREF123')).toBeInTheDocument();
    });

    // Check that POST /api/withdrawals was called with expected headers and body
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/withdrawals'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
        body: expect.stringContaining('"creatorUsername":"alice"'),
      })
    );

    expect(notify.success).toHaveBeenCalledWith('Withdrawal recorded (demo)');
    expect(screen.getByRole('link', { name: /View in Dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );

    // Resetting form
    fireEvent.click(screen.getByRole('button', { name: /Make another withdrawal/i }));
    expect(screen.getByLabelText(/Amount \(USDC\)/i)).toHaveValue('');
  });

  it('displays error message if backend POST /api/withdrawals fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accountName: 'ALICE JANE DOE' }),
    } as Response);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid withdrawal parameters' }),
    } as Response);

    render(<WithdrawPage />);

    fireEvent.change(screen.getByLabelText(/Amount \(USDC\)/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/Bank/i), { target: { value: 'GTBank' } });
    fireEvent.change(screen.getByLabelText(/Account number/i), { target: { value: '0123456789' } });

    await waitFor(() => {
      expect(screen.getByText(/Account holder: ALICE JANE DOE/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Simulate withdrawal/i }));

    expect(await screen.findByText('Invalid withdrawal parameters')).toBeInTheDocument();
  });
});
