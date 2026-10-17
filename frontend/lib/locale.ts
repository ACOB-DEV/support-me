// Locale constants shared by server and client code. Kept free of
// 'use client' (unlike lib/i18n.ts) so server components such as
// app/[username]/page.tsx can read the locale cookie on the request.

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_COOKIE_NAME = 'supportme_locale';

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
