"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/layout/brand-mark";
import { getPortalMe, logoutPortal } from "@/lib/auth-api";
import { fetchPortalNotifications } from "@/lib/runtime-api";
import { cn } from "@/lib/cn";

export function AppNav() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      getPortalMe(),
      fetchPortalNotifications({ unreadOnly: true, limit: 60 }).catch(() => ({ ok: true, notifications: [] })),
    ])
      .then(([payload, notificationsPayload]) => {
        if (!active) return;
        setEmail(payload.user.email);
        setIsAdmin(Boolean(payload.user.isAdmin));
        const unread = Array.isArray(notificationsPayload.notifications)
          ? notificationsPayload.notifications.length
          : 0;
        setUnreadCount(unread);
      })
      .catch(() => {
        if (!active) return;
        setEmail("");
        setIsAdmin(false);
        setUnreadCount(0);
      });
    return () => {
      active = false;
    };
  }, []);

  const links = [
    { href: "/app", label: "Workspaces" },
    { href: "/app/notifications", label: "Notifications", badge: unreadCount > 0 ? unreadCount : 0 },
    { href: "/app/integrations/slack", label: "Slack" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  const onLogout = () => {
    void logoutPortal()
      .catch(() => undefined)
      .finally(() => {
        window.location.href = "/login";
      });
  };

  return (
    <header className="border-b" style={{ borderColor: "var(--bat-border)", background: "color-mix(in srgb, var(--bat-bg-soft) 86%, transparent)" }}>
      <div className="bat-shell-app flex flex-wrap items-center justify-between gap-2 py-3">
        <Link href="/app">
          <BrandMark compact />
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-2">
          {email ? (
            <span className="hidden rounded-full border px-3 py-1.5 text-xs md:inline-flex" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
              {email}
            </span>
          ) : null}
          {links.map((link) => {
            const isActive = link.href === "/app" ? pathname === "/app" : pathname.startsWith(link.href);
            const badge = "badge" in link && typeof link.badge === "number" ? link.badge : 0;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm transition-colors",
                  isActive ? "font-semibold" : ""
                )}
                style={{
                  background: isActive ? "var(--bat-accent-soft)" : "var(--bat-surface)"
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  {link.label}
                  {badge > 0 ? (
                    <span
                      className="rounded-full border px-1.5 py-0.5 text-[10px] leading-none"
                      style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </span>
              </Link>
            );
          })}
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
