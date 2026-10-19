'use client';

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { TwitterIcon, Mail01Icon } from '@hugeicons/core-free-icons';
import { useAuth } from '@/context/AuthContext';
import { WalletConnectError, WalletConnectErrorData } from '@/components/WalletConnectError';
import { categorizeWalletError } from '@/lib/walletErrors';
import { describeTwitterAuthError, describeMagicLinkRequestError } from '@/lib/authErrors';

/**
 * The three sign-in methods (#10 Twitter, #11 magic link, and the existing
 * wallet flow) side by side, sharing one error-card component
 * (WalletConnectError) since all three ultimately resolve to the same
 * {title, message, action?, retryLabel?} shape. Used by ProtectedRoute's
 * unauthenticated state - the one place in the app that gates on sign-in.
 */
export function AuthMethods() {
  const { loginWithWallet, getTwitterRedirectUrl, requestMagicLink } = useAuth();

  const [connectingWallet, setConnectingWallet] = useState(false);
  const [walletError, setWalletError] = useState<WalletConnectErrorData | null>(null);

  const [connectingTwitter, setConnectingTwitter] = useState(false);
  const [twitterError, setTwitterError] = useState<WalletConnectErrorData | null>(null);

  const [email, setEmail] = useState('');
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [magicLinkError, setMagicLinkError] = useState<WalletConnectErrorData | null>(null);

  const handleWalletConnect = async () => {
    setConnectingWallet(true);
    setWalletError(null);
    try {
      await loginWithWallet();
    } catch (err) {
      setWalletError(categorizeWalletError(err));
    } finally {
      setConnectingWallet(false);
    }
  };

  const handleTwitterConnect = async () => {
    setConnectingTwitter(true);
    setTwitterError(null);
    try {
      const redirectUrl = await getTwitterRedirectUrl();
      window.location.href = redirectUrl;
      // Intentionally no setConnectingTwitter(false) on success: the page is
      // navigating away, and leaving the button in its loading state avoids
      // a flash of the enabled button during that navigation.
    } catch (err) {
      setTwitterError(describeTwitterAuthError(err));
      setConnectingTwitter(false);
    }
  };

  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setMagicLinkError({ title: 'Enter a valid email', message: 'Please enter a valid email address to continue.' });
      return;
    }

    setSendingLink(true);
    setMagicLinkError(null);
    try {
      await requestMagicLink(trimmed);
      setLinkSent(true);
    } catch (err) {
      setMagicLinkError(describeMagicLinkRequestError(err));
    } finally {
      setSendingLink(false);
    }
  };

  return (
    <div className="space-y-4">
      {walletError && <WalletConnectError error={walletError} onRetry={handleWalletConnect} className="mb-2" />}
      <button
        onClick={handleWalletConnect}
        disabled={connectingWallet}
        className="btn-brutal btn-brutal-primary w-full"
      >
        {connectingWallet ? 'Connecting...' : 'Connect Wallet'}
      </button>

      <div className="flex items-center gap-3 text-xs font-bold text-muted">
        <span className="h-px flex-1 bg-ink/15" />
        OR
        <span className="h-px flex-1 bg-ink/15" />
      </div>

      {twitterError && <WalletConnectError error={twitterError} onRetry={handleTwitterConnect} className="mb-2" />}
      <button
        onClick={handleTwitterConnect}
        disabled={connectingTwitter}
        className="btn-brutal btn-brutal-white w-full"
      >
        <HugeiconsIcon icon={TwitterIcon} size={18} strokeWidth={2} />
        {connectingTwitter ? 'Redirecting...' : 'Sign in with Twitter'}
      </button>

      {linkSent ? (
        <div className="card-brutal bg-brand-lime p-4 text-left" role="status">
          <p className="font-extrabold text-ink">Check your email</p>
          <p className="mt-1 text-sm font-medium text-ink/85">
            We sent a sign-in link to <span className="font-bold">{email}</span>. It expires in 15 minutes and
            works once.
          </p>
          <button
            type="button"
            onClick={() => setLinkSent(false)}
            className="mt-3 text-xs font-bold text-ink underline"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={handleMagicLinkSubmit} className="space-y-2 text-left">
          {magicLinkError && (
            <WalletConnectError
              error={magicLinkError}
              onRetry={() => setMagicLinkError(null)}
              className="mb-2"
            />
          )}
          <label htmlFor="magic-link-email" className="sr-only">
            Email address
          </label>
          <input
            id="magic-link-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            disabled={sendingLink}
            className="input-brutal"
          />
          <button type="submit" disabled={sendingLink} className="btn-brutal btn-brutal-white w-full">
            <HugeiconsIcon icon={Mail01Icon} size={18} strokeWidth={2} />
            {sendingLink ? 'Sending...' : 'Email me a sign-in link'}
          </button>
        </form>
      )}
    </div>
  );
}
