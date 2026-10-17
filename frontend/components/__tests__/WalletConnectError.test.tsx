import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WalletConnectError } from '@/components/WalletConnectError';
import { categorizeWalletError } from '@/lib/walletErrors';
import { troubleshootingUrl } from '@/lib/docs';

describe('WalletConnectError', () => {
  it('links to the matching troubleshooting section when the error has a docsUrl', () => {
    render(<WalletConnectError error={categorizeWalletError(new Error('wrong network'))} onRetry={vi.fn()} />);

    const link = screen.getByRole('link', { name: /learn more/i });
    expect(link).toHaveAttribute('href', troubleshootingUrl('Wrong network'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('omits the link for errors without a docsUrl (e.g. auth flow errors)', () => {
    render(
      <WalletConnectError
        error={{ title: 'Link expired', message: 'This sign-in link has expired.' }}
        onRetry={vi.fn()}
      />
    );

    expect(screen.queryByRole('link', { name: /learn more/i })).not.toBeInTheDocument();
  });
});
