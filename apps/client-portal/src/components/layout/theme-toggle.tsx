"use client";

import { LaptopMinimal, MoonStar, SunMedium } from "lucide-react";
import { ThemeMode, usePortalTheme } from "@/app/providers";

const options: Array<{
  mode: ThemeMode;
  label: string;
  icon: typeof SunMedium;
}> = [
  { mode: "system", label: "System", icon: LaptopMinimal },
  { mode: "light", label: "Light", icon: SunMedium },
  { mode: "dark", label: "Dark", icon: MoonStar },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, resolvedTheme, setMode } = usePortalTheme();

  return (
    <div
      className={compact ? "bat-theme-toggle bat-theme-toggle-compact" : "bat-theme-toggle"}
      role="group"
      aria-label="Theme mode"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            onClick={() => setMode(option.mode)}
            aria-pressed={isActive}
            className={isActive ? "bat-theme-toggle-option is-active" : "bat-theme-toggle-option"}
            title={
              option.mode === "system"
                ? `Follow system preference (${resolvedTheme})`
                : `Switch to ${option.label.toLowerCase()} mode`
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {!compact ? <span>{option.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
