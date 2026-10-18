import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Suspense } from 'react';
import type { ImageProps } from 'next/image';
import CreatorProfileClient from '@/app/[username]/CreatorProfileClient';
import * as AuthContextModule from '@/context/AuthContext';

vi.mock('@/lib/assets', async () => {
  const actual = await vi.importActual<typeof import('@/lib/assets')>('@/lib/assets');
  return {
    ...actual,
    availableAssetCodes: () => ['XLM', 'USDC'],
  };
});

vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: ImageProps) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stub standing in for next/image, not a real <img>
    <img src={typeof src === 'string' ? src : undefined} alt={alt} {...rest} />
  ),
}));

// Only the network-touching calls are stubbed; the shared constants (message
// length cap, charge interval cap) come from the real module so the component
// and the test can't drift apart on a new export.
vi.mock('@/lib/contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/contract')>();
  return {
    ...actual,
    sendDonation: vi.fn(),
    approveAllowance: vi.fn(),
    subscribe: vi.fn(),
    cancelSubscription: vi.fn(),
  };
});

vi.mock('@/lib/wallet', () => ({
  connectWallet: vi.fn().mockResolvedValue('GBTESTWALLETADDRESS123456789012345678901234567890'),
  disconnectWallet: vi.fn(),
  signTransaction: vi.fn(),
  signMessage: vi.fn(),
}));

const mockCreator = {
  id: 1,
  username: 'elisha',
  displayName: 'Elisha',
  walletAddress: 'GCREATORWALLETADDRESS123456789012345678901234567890',
  bio: 'Building open-source tools',
  avatarUrl: null,
  socialLinks: null,
  acceptsXlm: true,
  acceptsUsdc: true,
  donationGoal: 100,
  donations: [],
};

class MockEventSource {
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  close = vi.fn();
}

describe('Mobile Donation & Subscription Flow', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/creators/')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockCreator,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ balances: [] }),
        });
      })
    );

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 1, walletAddress: 'GUSERWALLETADDRESS123456789012345678901234567890' },
      token: 'jwt-token',
      loading: false,
      loginWithWallet: vi.fn(),
      getTwitterRedirectUrl: vi.fn(),
      completeTwitterLogin: vi.fn(),
      requestMagicLink: vi.fn(),
      verifyMagicLink: vi.fn(),
      logout: vi.fn(),
    });
  });

  const setupTest = async () => {
    const paramsPromise = Promise.resolve({ username: 'elisha' });
    await act(async () => {
      render(
        <Suspense fallback={<div>Loading...</div>}>
          <CreatorProfileClient params={paramsPromise} />
        </Suspense>
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Support Elisha')).toBeInTheDocument();
    });

    const connectBtn = screen.getByRole('button', { name: /connect wallet/i });
    expect(connectBtn).toHaveClass('min-h-[48px]');

    await act(async () => {
      fireEvent.click(connectBtn);
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    });
  };

  it('renders preset amount buttons with touch-compliant heights and updates amount', async () => {
    await setupTest();

    const preset5 = screen.getByRole('button', { name: '5' });
    const preset10 = screen.getByRole('button', { name: '10' });
    const preset20 = screen.getByRole('button', { name: '20' });

    expect(preset5).toHaveClass('min-h-[44px]');
    expect(preset10).toHaveClass('min-h-[44px]');
    expect(preset20).toHaveClass('min-h-[44px]');

    fireEvent.click(preset10);

    const amountInput = screen.getByLabelText(/amount/i);
    expect(amountInput).toHaveValue(10);
  });

  it('toggles between XLM and USDC assets with touch-compliant targets', async () => {
    await setupTest();

    const xlmButton = screen.getByRole('button', { name: /XLM/i });
    const usdcButton = screen.getByRole('button', { name: /USDC/i });

    expect(xlmButton).toHaveClass('min-h-[44px]');
    expect(usdcButton).toHaveClass('min-h-[44px]');

    fireEvent.click(usdcButton);
    expect(usdcButton).toHaveAttribute('aria-pressed', 'true');
    expect(xlmButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles recurring subscription flow with interval selection', async () => {
    await setupTest();

    const recurringCheckbox = screen.getByLabelText(/make it recurring/i);
    expect(recurringCheckbox).not.toBeChecked();
    expect(screen.getByRole('button', { name: /send donation/i })).toBeInTheDocument();

    fireEvent.click(recurringCheckbox);
    expect(recurringCheckbox).toBeChecked();

    expect(screen.getByRole('button', { name: /start recurring donation/i })).toBeInTheDocument();

    const intervalSelect = screen
      .getAllByRole('combobox')
      .find((el) => (el as HTMLSelectElement).querySelector('option[value="7"]'))!;
    expect(intervalSelect).toHaveClass('min-h-[44px]');
    fireEvent.change(intervalSelect, { target: { value: '7' } });
    expect(intervalSelect).toHaveValue('7');
  });
});
