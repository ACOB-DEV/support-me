'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';

interface LanguageSwitcherProps {
  locale: Locale;
  onChange: (locale: Locale) => void;
  className?: string;
}

/**
 * Lets the viewer pick which language the page's translated strings render
 * in. Purely client-side: the caller owns the active locale (see
 * `useLocalePreference` in `lib/i18n.ts`) and this just renders the picker.
 * Language names are shown in their own language (not translated) — the
 * usual convention for a language switcher. Only the creator profile and
 * donate form are translated, so a short note under the picker says so
 * rather than letting readers expect the receipt or leaderboard to follow.
 */
export function LanguageSwitcher({ locale, onChange, className }: LanguageSwitcherProps) {
  const t = useTranslations('languageSwitcher');
  const noteId = useId();

  return (
    <div className={`inline-flex flex-col items-center gap-1 ${className ?? ''}`}>
      <label className="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
        <span className="sr-only">{t('label')}</span>
        <select
          value={locale}
          onChange={(e) => onChange(e.target.value as Locale)}
          aria-label={t('label')}
          aria-describedby={noteId}
          className="input-brutal text-sm py-1.5 w-auto"
        >
          {SUPPORTED_LOCALES.map((code) => (
            // Each language name is in its own language, so tag it for screen readers.
            <option key={code} value={code} lang={code}>
              {LOCALE_LABELS[code]}
            </option>
          ))}
        </select>
      </label>
      <p id={noteId} className="text-xs text-ink/70 text-center max-w-xs">
        {t('scopeNote')}
      </p>
    </div>
  );
}
