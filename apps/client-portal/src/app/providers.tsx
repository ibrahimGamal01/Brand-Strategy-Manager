"use client";

import { PropsWithChildren, useEffect, useMemo, useState } from "react";

type ThemeMode = "light" | "dark";

function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("bat-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function Providers({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<ThemeMode>(resolveInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("bat-theme", theme);
  }, [theme]);

  const label = useMemo(() => (theme === "light" ? "Switch to dark" : "Switch to light"), [theme]);

  return (
    <div data-theme={theme}>
      {children}
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => {
          setTheme((current) => (current === "light" ? "dark" : "light"));
        }}
        className="bat-button bat-button-secondary fixed right-4 bottom-4 z-50 border backdrop-blur-sm"
        style={{ borderColor: "var(--bat-border)", background: "color-mix(in srgb, var(--bat-surface) 82%, transparent)" }}
      >
        {theme === "light" ? "Light" : "Dark"}
      </button>
    </div>
  );
}
