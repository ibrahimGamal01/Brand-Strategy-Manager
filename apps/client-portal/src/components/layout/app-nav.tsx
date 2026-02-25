"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/layout/brand-mark";
import { getPortalMe, logoutPortal } from "@/lib/auth-api";
import { cn } from "@/lib/cn";

const links = [
  { href: "/app", label: "Workspaces" },
  { href: "/admin", label: "Admin" }
];

export function AppNav() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    let active = true;
    getPortalMe()
      .then((payload) => {
        if (!active) return;
        setEmail(payload.user.email);
      })
      .catch(() => {
        if (!active) return;
        setEmail("");
      });
    return () => {
      active = false;
    };
  }, []);

  const onLogout = () => {
    void logoutPortal()
      .catch(() => undefined)
      .finally(() => {
        window.location.href = "/login";
      });
  };

  return (
    <header className="border-b" style={{ borderColor: "var(--bat-border)", background: "color-mix(in srgb, var(--bat-bg-soft) 86%, transparent)" }}>
      <div className="bat-shell flex items-center justify-between py-3">
        <Link href="/app">
          <BrandMark compact />
        </Link>
        <nav className="flex items-center gap-2">
          {email ? (
            <span className="hidden rounded-full border px-3 py-1.5 text-xs md:inline-flex" style={{ borderColor: "var(--bat-border)" }}>
              {email}
            </span>
          ) : null}
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm transition-colors",
                pathname.startsWith(link.href) ? "font-semibold" : ""
              )}
              style={{
                background: pathname.startsWith(link.href) ? "var(--bat-accent-soft)" : "transparent"
              }}
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={onLogout}
            className="rounded-full border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Log out
          </button>
        </nav>
      </div>
    </header>
  );
}
