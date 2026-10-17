import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountDataSection } from '@/components/AccountDataSection';
import { fetchWithRetry } from '@/lib/network';

const logout = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: 'tok', logout }),
}));
vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/network', () => ({
  fetchWithRetry: vi.fn(),
  isNetworkError: () => false,
}));

describe('AccountDataSection deletion', () => {
  beforeEach(() => {
    logout.mockReset();
    vi.mocked(fetchWithRetry).mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  });

  it('requires typing DELETE in the confirmation dialog before deleting', async () => {
    const user = userEvent.setup();
    render(<AccountDataSection />);

    await user.click(screen.getByRole('button', { name: 'Delete account…' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete your account?' });
    const confirm = within(dialog).getByRole('button', { name: 'Permanently delete my data' });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/to confirm/i), 'DELETE');
    await user.click(confirm);

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining('/api/account/delete'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) })
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('clears the typed confirmation when cancelled', async () => {
    const user = userEvent.setup();
    render(<AccountDataSection />);

    await user.click(screen.getByRole('button', { name: 'Delete account…' }));
    await user.type(screen.getByLabelText(/to confirm/i), 'DEL');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete account…' }));

    expect(screen.getByLabelText(/to confirm/i)).toHaveValue('');
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });
});
