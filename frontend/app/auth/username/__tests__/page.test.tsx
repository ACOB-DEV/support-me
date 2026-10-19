import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuth } from '@/context/AuthContext';

const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/api', () => ({
  API_URL: 'http://api.test',
}));

const mockUseAuth = vi.mocked(useAuth);

let CreateUsernamePage: React.ComponentType;

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://example.com');
  CreateUsernamePage = (await import('@/app/auth/username/page')).default;
});

function authMock() {
  return {
    user: { walletAddress: 'GABC' },
    token: 'jwt',
    loading: false,
  } as unknown as ReturnType<typeof useAuth>;
}

function mockFetch(ok: boolean, body: unknown = {}) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
  }) as Response);
}

describe('CreateUsernamePage', () => {
  beforeEach(() => {
    push.mockClear();
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(authMock());
    vi.stubGlobal('fetch', mockFetch(true));
  });

  it('associates both labels with their inputs', () => {
    render(<CreateUsernamePage />);

    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
  });

  it('describes the username field with its hint', () => {
    render(<CreateUsernamePage />);

    const input = screen.getByLabelText('Username');
    const hint = screen.getByText(/letters, numbers, underscores/i);
    expect(input).toHaveAttribute('aria-describedby', hint.id);
  });

  it('caps the username input at 30 characters', async () => {
    const user = userEvent.setup();
    render(<CreateUsernamePage />);

    const input = screen.getByLabelText('Username');
    expect(input).toHaveAttribute('maxLength', '30');

    await user.type(input, 'abcdefghijklmnopqrstuvwxyz01234');
    expect(input).toHaveValue('abcdefghijklmnopqrstuvwxyz0123');
  });

  it('rejects usernames longer than 30 characters before submit', async () => {
    const user = userEvent.setup();
    render(<CreateUsernamePage />);

    // Bypass the browser's maxLength cap to exercise the validation guard itself.
    const input = screen.getByLabelText('Username');
    fireEvent.change(input, { target: { value: 'a'.repeat(31) } });
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Username must be 30 characters or fewer'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects usernames shorter than 3 characters before submit', async () => {
    const user = userEvent.setup();
    render(<CreateUsernamePage />);

    await user.type(screen.getByLabelText('Username'), 'ab');
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Username must be at least 3 characters'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid characters before submit', async () => {
    const user = userEvent.setup();
    render(<CreateUsernamePage />);

    await user.type(screen.getByLabelText('Username'), 'bad name!');
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Username can only contain letters, numbers, underscores, and hyphens'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks the username input as invalid when an error is shown', async () => {
    const user = userEvent.setup();
    render(<CreateUsernamePage />);

    await user.click(screen.getByRole('button', { name: /create profile/i }));
    await screen.findByRole('alert');

    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
  });

  it('builds the URL prefix from NEXT_PUBLIC_SITE_URL', () => {
    render(<CreateUsernamePage />);

    expect(screen.getByText('https://example.com/')).toBeInTheDocument();
  });

  it('creates the username and routes to /app on success', async () => {
    const user = userEvent.setup();
    render(<CreateUsernamePage />);

    await user.type(screen.getByLabelText('Username'), 'creator');
    await user.type(screen.getByLabelText(/display name/i), 'Creator Name');
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/app'));
    expect(fetch).toHaveBeenCalledWith(
      'http://api.test/api/creators/creator/create',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
