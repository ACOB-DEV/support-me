'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { AbstractIntlMessages } from 'next-intl';
import en from '@/messages/en.json';
import es from '@/messages/es.json';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isSupportedLocale,
  type Locale,
} from '@/lib/locale';

export { SUPPORTED_LOCALES, DEFAULT_LOCALE, isSupportedLocale, type Locale } from '@/lib/locale';

// Minimal, client-only i18n wiring for next-intl. This intentionally does
// NOT use next-intl's routing/middleware integration (no `[locale]` segment,
// no URL-based locale) — the rest of the app router tree is untouched. A
// locale is instead picked client-side (localStorage, mirrored to a cookie
// so the server can seed the first render, see app/[username]/page.tsx) and
// messages are provided via `NextIntlClientProvider` scoped to whichever page
// opts in, e.g. `app/[username]/CreatorProfileClient.tsx`.

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

const LOCALE_STORAGE_KEY = 'supportme-locale';
const LOCALE_COOKIE_MAX_AGE_DAYS = 365;

const MESSAGES: Record<Locale, AbstractIntlMessages> = { en, es };

/** Returns the bundled message tree for a locale, falling back to the default locale. */
export function getMessages(locale: Locale): AbstractIntlMessages {
  return MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
}

function readCookieLocale(): Locale | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_NAME}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : null;
  return isSupportedLocale(value) ? value : null;
}

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(stored)) return stored;
  } catch {
    // localStorage can throw (private browsing, disabled storage) — fall through to the cookie.
  }
  return readCookieLocale() ?? DEFAULT_LOCALE;
}

// Listeners notified whenever `persistLocale` changes the active locale from
// this tab, so every `useLocalePreference()` instance on the page re-syncs
// immediately (the native `storage` event alone only fires in *other*
// tabs/windows, never the one that made the change).
const listeners = new Set<() => void>();

function persistLocale(locale: Locale): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore write failures (private browsing, storage quota, etc.)
    }
  }
  if (typeof document !== 'undefined') {
    const maxAge = LOCALE_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
    document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${maxAge}; SameSite=Lax`;
  }
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', callback);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', callback);
    }
  };
}

/**
 * Tracks the active UI locale via `useSyncExternalStore` (same pattern as
 * `useOnlineStatus` above). The server snapshot is `initialLocale` — the
 * `supportme_locale` cookie read on the request, or DEFAULT_LOCALE — and it
 * is reused for the first client render, so hydration always agrees and a
 * returning Spanish reader gets Spanish on first paint. React then re-reads
 * the real localStorage/cookie value right after. `setLocale` persists the
 * choice and notifies subscribers so every instance of this hook on the page
 * (and, via the `storage` event, other tabs) updates too.
 */
export function useLocalePreference(
  initialLocale: Locale = DEFAULT_LOCALE,
): [Locale, (locale: Locale) => void] {
  const getServerSnapshot = useCallback(() => initialLocale, [initialLocale]);
  const locale = useSyncExternalStore(subscribe, readStoredLocale, getServerSnapshot);

  const setLocale = useCallback((next: Locale) => {
    persistLocale(next);
  }, []);

  return [locale, setLocale];
}

/**
 * Mirrors the active locale onto `<html lang>` (WCAG 3.1.1) so screen
 * readers and browser translation pick the right language for a page
 * rendered via `NextIntlClientProvider`. Resets to DEFAULT_LOCALE — what
 * app/layout.tsx renders — on unmount, since the rest of the app is
 * untranslated.
 */
export function useDocumentLang(locale: Locale): void {
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    return () => {
      root.lang = DEFAULT_LOCALE;
    };
  }, [locale]);
}
