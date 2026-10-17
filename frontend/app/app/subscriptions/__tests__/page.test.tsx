import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubscriptionsPage from '@/app/app/subscriptions/page';
import { cancelSubscription } from '@/lib/contract';
import { fetchWithRetry } from '@/lib/network';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, walletAddress: 'GSUPPORTER' }, token: 'tok' }),
}));
vi.mock('@/components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/AppNav', () => ({ AppNav: () => null }));
vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/contract', () => ({ cancelSubscription: vi.fn() }));
vi.mock('@/lib/network', () => ({
  fetchWithRetry: vi.fn(),
  isNetworkError: () => false,
}));

const subscription = {
  id: 3,
  onChainId: 42,
  amount: '5',
  token: 'XLM',
  intervalSecs: 7 * 86400,
  nextChargeAt: '2026-11-01T00:00:00.000Z',
  active: true,
  lastError: null,
  creator: { username: 'alice', displayName: 'Alice' },
};

describe('SubscriptionsPage cancel confirmation', () => {
  beforeEach(() => {
    vi.mocked(cancelSubscription).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(fetchWithRetry).mockReset().mockImplementation(async (url) =>
      String(url).includes('/cancel')
        ? new Response('{}', { status: 200 })
        : new Response(JSON.stringify([subscription]), { status: 200 })
    );
  });

  it('asks before cancelling and does nothing when the supporter keeps it', async () => {
    const user = userEvent.setup();
    render(<SubscriptionsPage />);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Cancel your donation to Alice?' });
    expect(dialog).toHaveAccessibleDescription(/stop sending 5 XLM weekly/i);

    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it('cancels on-chain once confirmed', async () => {
    const user = userEvent.setup();
    render(<SubscriptionsPage />);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Cancel donation' }));

    await waitFor(() =>
      expect(cancelSubscription).toHaveBeenCalledWith({ supporterAddress: 'GSUPPORTER', subscriptionId: 42 })
    );
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });
});
