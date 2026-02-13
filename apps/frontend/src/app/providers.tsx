'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getPreferredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const stored = window.localStorage.getItem('bat-theme');
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }

  return 'dark';
}

function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Use a stable default for SSR + first client render, then sync preference in an effect.
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const preferred = getPreferredTheme();
    setThemeState(preferred);

    const root = document.documentElement;
    root.setAttribute('data-theme', preferred);
    window.localStorage.setItem('bat-theme', preferred);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    const root = document.documentElement;
    root.setAttribute('data-theme', next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('bat-theme', next);
    }
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
