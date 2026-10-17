import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import CreatorProfileClient from './CreatorProfileClient';
import { fetchCreatorSummary } from './creator-summary';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isSupportedLocale, type Locale } from '@/lib/locale';

type ParamsPromise = Promise<{ username: string }>;

// Mirrors the fallback in components/ShareCard.tsx: there is no shared
// exported SITE_URL constant (layout.tsx's copy is module-local), and
// schema.org url/image fields need to be absolute.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://support-mee.vercel.app';

export async function generateMetadata({ params }: { params: ParamsPromise }): Promise<Metadata> {
  const { username } = await params;
  const creator = await fetchCreatorSummary(username);

  if (!creator) {
    return {
      title: 'Creator not found — SupportMe',
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const name = creator.displayName || creator.username;
  const description = creator.bio?.trim() || `Support ${name} with a tip on SupportMe.`;
  const title = `Support ${name} (@${creator.username})`;

  // og:image / twitter:image come from the generated opengraph-image.tsx and
  // twitter-image.tsx next to this file (a 1200x630 card with the avatar).
  return {
    title,
    description,
    alternates: {
      canonical: `/${username}`,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title,
      description,
      type: 'profile',
      siteName: 'SupportMe',
      url: `/${creator.username}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function CreatorProfilePage({ params }: { params: ParamsPromise }) {
  const { username } = await params;
  const creator = await fetchCreatorSummary(username);
  const locale = await readLocaleCookie();

  return (
    <>
      {locale !== DEFAULT_LOCALE && (
        // app/layout.tsx renders <html lang="en">. Patch it while the HTML is
        // still being parsed so the first paint already has the reader's
        // language; CreatorProfileClient keeps it in sync after hydration.
        <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang=${JSON.stringify(locale)};` }} />
      )}
      {creator && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildCreatorJsonLd(creator)) }}
        />
      )}
      <CreatorProfileClient params={params} initialLocale={locale} />
    </>
  );
}

async function readLocaleCookie(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE_NAME)?.value;
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

function buildCreatorJsonLd(creator: NonNullable<Awaited<ReturnType<typeof fetchCreatorSummary>>>) {
  const name = creator.displayName || creator.username;
  const description = creator.bio?.trim() || `Support ${name} with a tip on SupportMe.`;
  const url = `${SITE_URL}/${creator.username}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    dateModified: new Date().toISOString(),
    mainEntity: {
      '@type': 'Person',
      name,
      description,
      url,
      ...(creator.avatarUrl ? { image: creator.avatarUrl } : {}),
    },
  };
}
