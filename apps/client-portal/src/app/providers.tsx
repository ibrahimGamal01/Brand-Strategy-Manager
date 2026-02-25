"use client";

import { PropsWithChildren, useEffect, useState } from "react";

export function Providers({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("bat-theme", theme);
  }, [theme]);

  return (
    <div data-theme={theme}>
      {children}
      <button
        type="button"
        onClick={() => {
          const nextTheme = theme === "light" ? "dark" : "light";
          setTheme(nextTheme);
        }}
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm"
        style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
      >
        Theme: {theme === "light" ? "Light" : "Dark"}
      </button>
    </div>
  );
}
