'use client';

import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Sun01Icon, Moon01Icon } from '@hugeicons/core-free-icons';
import { useTheme } from '@/context/ThemeContext';

// Cycles system → light → dark so the toggle is one tap from any state; the
// current mode is visible on the icon, and the label carries the state for
// screen readers.
const NEXT = { system: 'light', light: 'dark', dark: 'system' } as const;

const LABEL = {
  system: 'Switch to light mode (currently following your system)',
  light: 'Switch to dark mode (currently light)',
  dark: 'Switch to system theme (currently dark)',
} as const;

/**
 * Neobrutalist theme switch. Renders a placeholder until mounted so server
 * and client markup always agree (the pre-paint script may already have put
 * the page in dark mode before React hydrates).
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional hydration gate: the icon must not render until mounted, because the pre-paint script may have set dark mode before React hydrates.
    () => setMounted(true),
    []
  );

  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[theme])}
      aria-label={mounted ? LABEL[theme] : 'Toggle theme'}
      title={mounted ? LABEL[theme] : 'Toggle theme'}
      className={`btn-brutal btn-brutal-white !px-3 !py-2 text-sm ${className}`}
    >
      {mounted && resolvedTheme === 'dark' ? (
        <HugeiconsIcon icon={Moon01Icon} size={18} strokeWidth={2} />
      ) : (
        <HugeiconsIcon icon={Sun01Icon} size={18} strokeWidth={2} />
      )}
    </button>
  );
}
