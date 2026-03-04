"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app/integrations/slack", label: "Overview", exact: true },
  { href: "/app/integrations/slack/setup", label: "Guided Setup" },
  { href: "/app/integrations/slack/verify", label: "Go Live" },
  { href: "/app/integrations/slack/advanced", label: "Advanced" },
];

export function SlackIntegrationTabs() {
  const pathname = usePathname();
  return (
    <nav className="bat-surface flex flex-wrap items-center gap-2 p-3">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="rounded-full px-3 py-1.5 text-sm"
            style={{
              background: active ? "var(--bat-accent-soft)" : "var(--bat-surface-muted)",
              fontWeight: active ? 700 : 500,
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

