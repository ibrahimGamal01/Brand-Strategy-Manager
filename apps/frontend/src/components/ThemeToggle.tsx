'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/app/providers';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';

  const nextTheme = isDark ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card/70 px-3 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-card"
    >
      <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-muted">
        <Sun
          className={`h-3.5 w-3.5 transition-opacity ${isDark ? 'opacity-40' : 'opacity-100'}`}
        />
        <Moon
          className={`absolute h-3.5 w-3.5 transition-opacity ${
            isDark ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </span>
      <span className="hidden sm:inline">
        {isDark ? 'Dark' : 'Light'}
      </span>
    </button>
  );
}

