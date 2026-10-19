import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthMethods } from '@/components/AuthMethods';
import { useAuth } from '@/context/AuthContext';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuth);

function authMock(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  return {
    user: null,
    token: null,
    loading: false,
    loginWithWallet: vi.fn(),
    getTwitterRedirectUrl: vi.fn(),
    completeTwitterLogin: vi.fn(),
    requestMagicLink: vi.fn(),
    verifyMagicLink: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

describe('AuthMethods', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    mockUseAuth.mockReset();
    // getTwitterRedirectUrl success navigates via window.location.href;
    // jsdom doesn't implement real navigation, so stub it to observe the call.
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, href: '' },
      writable: true,
      configurable: true,
    });
  });

  it('calls loginWithWallet when Connect Wallet is clicked', async () => {
    const loginWithWallet = vi.fn().mockResolvedValue({});
    mockUseAuth.mockReturnValue(authMock({ loginWithWallet }));

    render(<AuthMethods />);
    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    await waitFor(() => expect(loginWithWallet).toHaveBeenCalledTimes(1));
  });

  it('shows the wallet error card when loginWithWallet rejects', async () => {
    const loginWithWallet = vi.fn().mockRejectedValue(new Error('user rejected the request'));
    mockUseAuth.mockReturnValue(authMock({ loginWithWallet }));

    render(<AuthMethods />);
    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('redirects the page when Sign in with Twitter succeeds', async () => {
    const getTwitterRedirectUrl = vi.fn().mockResolvedValue('https://twitter.com/i/oauth2/authorize?state=abc');
    mockUseAuth.mockReturnValue(authMock({ getTwitterRedirectUrl }));

    render(<AuthMethods />);
    fireEvent.click(screen.getByRole('button', { name: /sign in with twitter/i }));

    await waitFor(() => expect(getTwitterRedirectUrl).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.href).toBe('https://twitter.com/i/oauth2/authorize?state=abc'));
  });

  it('shows a specific error when Twitter sign-in is not configured', async () => {
    const getTwitterRedirectUrl = vi.fn().mockRejectedValue(new Error('Twitter sign-in is not configured'));
    mockUseAuth.mockReturnValue(authMock({ getTwitterRedirectUrl }));

    render(<AuthMethods />);
    fireEvent.click(screen.getByRole('button', { name: /sign in with twitter/i }));

    await waitFor(() => expect(screen.getByText('Twitter sign-in unavailable')).toBeInTheDocument());
  });

  it('rejects an empty/invalid email before calling requestMagicLink', async () => {
    const requestMagicLink = vi.fn();
    mockUseAuth.mockReturnValue(authMock({ requestMagicLink }));

    render(<AuthMethods />);
    fireEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    await waitFor(() => expect(screen.getByText('Enter a valid email')).toBeInTheDocument());
    expect(requestMagicLink).not.toHaveBeenCalled();
  });

  it('requests a magic link and shows the "check your email" confirmation', async () => {
    const requestMagicLink = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue(authMock({ requestMagicLink }));

    render(<AuthMethods />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'you@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    await waitFor(() => expect(requestMagicLink).toHaveBeenCalledWith('you@example.com'));
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(screen.getByText('you@example.com')).toBeInTheDocument();
  });

  it('shows a rate-limit-specific error when the magic link request is throttled', async () => {
    const requestMagicLink = vi.fn().mockRejectedValue(new Error('Too many requests, please try again later'));
    mockUseAuth.mockReturnValue(authMock({ requestMagicLink }));

    render(<AuthMethods />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'you@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    await waitFor(() => expect(screen.getByText('Too many requests')).toBeInTheDocument());
  });

  it('lets the user switch back to a different email after a link was sent', async () => {
    const requestMagicLink = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue(authMock({ requestMagicLink }));

    render(<AuthMethods />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'you@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));
    await screen.findByText('Check your email');

    fireEvent.click(screen.getByRole('button', { name: /use a different email/i }));

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });
});
