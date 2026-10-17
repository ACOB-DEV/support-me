import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import CreatorProfilePage from '@/app/[username]/page';
import { fetchCreatorSummary } from '@/app/[username]/creator-summary';

vi.mock('@/app/[username]/creator-summary', () => ({
  fetchCreatorSummary: vi.fn(),
}));

vi.mock('@/app/[username]/CreatorProfileClient', () => ({
  default: ({ initialLocale }: { initialLocale?: string }) => (
    <div data-testid="creator-profile-client" data-initial-locale={initialLocale} />
  ),
}));

let localeCookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'supportme_locale' && localeCookie !== undefined ? { name, value: localeCookie } : undefined,
  }),
}));

const mockFetchCreatorSummary = vi.mocked(fetchCreatorSummary);

function getJsonLd(container: HTMLElement) {
  const script = container.querySelector('script[type="application/ld+json"]');
  return script ? JSON.parse(script.innerHTML) : null;
}

describe('CreatorProfilePage JSON-LD', () => {
  beforeEach(() => {
    mockFetchCreatorSummary.mockReset();
    localeCookie = undefined;
  });

  it('emits a ProfilePage/Person JSON-LD block with name, image, and description', async () => {
    mockFetchCreatorSummary.mockResolvedValue({
      username: 'awesome_dev',
      displayName: 'Awesome Dev',
      bio: 'Building cool things on Stellar.',
      avatarUrl: 'https://cdn.example.com/avatar.png',
      donationGoal: null,
    });

    const page = await CreatorProfilePage({ params: Promise.resolve({ username: 'awesome_dev' }) });
    const { container } = render(page);

    const jsonLd = getJsonLd(container);
    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      mainEntity: {
        '@type': 'Person',
        name: 'Awesome Dev',
        description: 'Building cool things on Stellar.',
        image: 'https://cdn.example.com/avatar.png',
      },
    });
    expect(jsonLd.mainEntity.url).toContain('/awesome_dev');
  });

  it('falls back to username and a default description when displayName/bio are missing', async () => {
    mockFetchCreatorSummary.mockResolvedValue({
      username: 'plain_creator',
      displayName: null,
      bio: null,
      avatarUrl: null,
      donationGoal: null,
    });

    const page = await CreatorProfilePage({ params: Promise.resolve({ username: 'plain_creator' }) });
    const { container } = render(page);

    const jsonLd = getJsonLd(container);
    expect(jsonLd.mainEntity.name).toBe('plain_creator');
    expect(jsonLd.mainEntity.description).toContain('plain_creator');
    expect(jsonLd.mainEntity.image).toBeUndefined();
  });

  it('omits the JSON-LD block entirely when the creator cannot be found', async () => {
    mockFetchCreatorSummary.mockResolvedValue(null);

    const page = await CreatorProfilePage({ params: Promise.resolve({ username: 'missing' }) });
    const { container } = render(page);

    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
  });
});

describe('CreatorProfilePage locale', () => {
  beforeEach(() => {
    mockFetchCreatorSummary.mockResolvedValue(null);
    localeCookie = undefined;
  });

  const renderPage = async () => {
    const page = await CreatorProfilePage({ params: Promise.resolve({ username: 'alice' }) });
    return render(page).container;
  };

  const langScript = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('script:not([type])')).find((s) =>
      s.innerHTML.includes('documentElement.lang'),
    );

  it('passes the cookie locale to the client and patches <html lang> before first paint', async () => {
    localeCookie = 'es';
    const container = await renderPage();

    expect(container.querySelector('[data-testid="creator-profile-client"]')).toHaveAttribute(
      'data-initial-locale',
      'es',
    );
    expect(langScript(container)?.innerHTML).toBe('document.documentElement.lang="es";');
  });

  it.each([undefined, 'fr', '"><script>'])('falls back to English for cookie %j', async (value) => {
    localeCookie = value;
    const container = await renderPage();

    expect(container.querySelector('[data-testid="creator-profile-client"]')).toHaveAttribute(
      'data-initial-locale',
      'en',
    );
    expect(langScript(container)).toBeUndefined();
  });
});
