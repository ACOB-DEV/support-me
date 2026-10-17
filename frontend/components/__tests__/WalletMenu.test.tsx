import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WalletMenu } from '@/components/WalletMenu';

const pathname = vi.hoisted(() => ({ current: '/app' }));
const logout = vi.hoisted(() => vi.fn());
const mockUser = vi.hoisted(() => ({
  current: { walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV' as string | null, email: null as string | null },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser.current,
    logout,
  }),
}));

/** Open the menu and return a scoped query helper for its contents. */
function openMenu() {
  render(<WalletMenu />);
  fireEvent.click(screen.getByRole('button', { expanded: false }));
  return within(screen.getByRole('menu'));
}

beforeEach(() => {
  pathname.current = '/app';
  logout.mockClear();
  mockUser.current = { walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV', email: null };
});

describe('WalletMenu account chip (#10, #11)', () => {
  it('shows a sliced wallet address for a wallet-signed-in user', () => {
    render(<WalletMenu />);
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('GABC…STUV');
  });

  it('shows the email for a magic-link user with no wallet', () => {
    mockUser.current = { walletAddress: null, email: 'you@example.com' };
    render(<WalletMenu />);
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('you@example.com');
  });

  it('falls back to a generic label for a Twitter user with neither', () => {
    mockUser.current = { walletAddress: null, email: null };
    render(<WalletMenu />);
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('Account');
  });
});

describe('WalletMenu secondary destinations (#151)', () => {
  it('renders the three secondary destinations in the menu', () => {
    const menu = openMenu();

    expect(menu.getByRole('menuitem', { name: /subscriptions/i })).toHaveAttribute(
      'href',
      '/app/subscriptions'
    );
    expect(menu.getByRole('menuitem', { name: /activity/i })).toHaveAttribute('href', '/activity');
    expect(menu.getByRole('menuitem', { name: /settings/i })).toHaveAttribute('href', '/settings');
  });

  it('shows the secondary destinations at every breakpoint, not just mobile', () => {
    const menu = openMenu();
    // The block used to be sm:hidden because mobile had no other route to
    // these pages. The desktop top nav no longer does either (#151), so the
    // restriction would strand desktop users.
    const container = menu.getByRole('menuitem', { name: /settings/i }).closest('div');
    expect(container?.className).not.toContain('sm:hidden');
  });

  it('keeps sign out available alongside the new links', () => {
    const menu = openMenu();
    expect(menu.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('closes the menu when a destination is chosen', () => {
    const menu = openMenu();
    fireEvent.click(menu.getByRole('menuitem', { name: /activity/i }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('WalletMenu active destination', () => {
  it.each([
    ['/app/subscriptions', /subscriptions/i, 'Subscriptions'],
    ['/activity', /activity/i, 'Activity'],
    ['/settings', /settings/i, 'Settings'],
  ])('marks %s as the current page', (route, name, label) => {
    pathname.current = route;
    const menu = openMenu();

    const current = menu.getAllByRole('menuitem', { current: 'page' });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(label);
  });

  it('marks nothing active on an unrelated route', () => {
    pathname.current = '/app';
    const menu = openMenu();
    expect(menu.queryAllByRole('menuitem', { current: 'page' })).toHaveLength(0);
  });
});

describe('WalletMenu dismissal', () => {
  it('closes on Escape', () => {
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on an outside click', () => {
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
