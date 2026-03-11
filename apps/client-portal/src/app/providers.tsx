"use client";

import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "bat-theme-mode";
const LEGACY_THEME_STORAGE_KEY = "bat-theme";

type PortalThemeContextValue = {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
};

const PortalThemeContext = createContext<PortalThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function parseThemeMode(value: string | null | undefined): ThemeMode | null {
  if (value === "light" || value === "dark" || value === "system") return value;
  return null;
}

function resolveInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  if (stored) return stored;
  const legacy = parseThemeMode(window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY));
  if (legacy === "light" || legacy === "dark") return legacy;
  return "system";
}

function applyTheme(mode: ThemeMode, resolvedTheme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolvedTheme);
  document.documentElement.setAttribute("data-theme-mode", mode);
  document.documentElement.style.colorScheme = resolvedTheme;
}

export function Providers({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<ThemeMode>(resolveInitialMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());
  const resolvedTheme = mode === "system" ? systemTheme : mode;

  useEffect(() => {
    applyTheme(mode, resolvedTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    if (mode === "system") {
      window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, mode);
    }
  }, [mode, resolvedTheme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateResolvedTheme = () => {
      setSystemTheme(getSystemTheme());
    };
    updateResolvedTheme();
    mediaQuery.addEventListener("change", updateResolvedTheme);
    return () => {
      mediaQuery.removeEventListener("change", updateResolvedTheme);
    };
  }, []);

  const value = useMemo<PortalThemeContextValue>(
    () => ({
      mode,
      resolvedTheme,
      setMode,
    }),
    [mode, resolvedTheme]
  );

  return <PortalThemeContext.Provider value={value}>{children}</PortalThemeContext.Provider>;
}

export function usePortalTheme() {
  const context = useContext(PortalThemeContext);
  if (!context) {
    throw new Error("usePortalTheme must be used within Providers");
  }
  return context;
}
