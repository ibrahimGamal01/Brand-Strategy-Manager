"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPortalNotifications,
  markAllPortalNotificationsRead,
  markPortalNotificationRead,
} from "@/lib/runtime-api";
import { RuntimeNotification } from "@/types/chat";

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString();
}

function severityStyle(value: RuntimeNotification["severity"]) {
  if (value === "URGENT") return { borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" };
  if (value === "WARN") return { borderColor: "#f5d08b", background: "#fff8eb", color: "#7a4a00" };
  return { borderColor: "#b8e2c9", background: "#f0fbf4", color: "#166534" };
}

export function NotificationList() {
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState<string>("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [notifications, setNotifications] = useState<RuntimeNotification[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchPortalNotifications({
        unreadOnly,
        limit: 120,
      });
      setNotifications(Array.isArray(payload.notifications) ? payload.notifications : []);
    } catch (nextError: any) {
      setError(String(nextError?.message || "Failed to load notifications."));
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.readAt).length,
    [notifications]
  );

  const onMarkRead = async (notificationId: string) => {
    try {
      await markPortalNotificationRead(notificationId);
      setNotifications((current) =>
        current.map((item) =>
          item.id === notificationId ? { ...item, readAt: new Date().toISOString() } : item
        )
      );
    } catch (nextError: any) {
      setError(String(nextError?.message || "Failed to mark notification as read."));
    }
  };

  const onMarkAllRead = async () => {
    if (markingAll) return;
    setMarkingAll(true);
    setError("");
    try {
      await markAllPortalNotificationsRead();
      const nowIso = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          readAt: item.readAt || nowIso,
        }))
      );
    } catch (nextError: any) {
      setError(String(nextError?.message || "Failed to mark all notifications as read."));
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <section className="space-y-4">
      <div
        className="rounded-3xl border p-5 md:p-6"
        style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
      >
        <p className="bat-chip">Notification Center</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Owner Alerts</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Slack attention items, pending replies, and BAT waiting-input reminders.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setUnreadOnly((value) => !value)}
            className="rounded-full border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--bat-border)", background: unreadOnly ? "var(--bat-accent-soft)" : "var(--bat-surface-muted)" }}
          >
            {unreadOnly ? "Showing unread only" : "Showing all"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void onMarkAllRead()}
            disabled={markingAll || unreadCount === 0}
            className="rounded-full px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            {markingAll ? "Marking..." : `Mark all read${unreadCount ? ` (${unreadCount})` : ""}`}
          </button>
        </div>
      </div>

      {loading ? (
        <article className="bat-surface p-5">
          <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Loading notifications...
          </p>
        </article>
      ) : null}

      {error ? (
        <article className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
          {error}
        </article>
      ) : null}

      {!loading && !error && notifications.length === 0 ? (
        <article className="bat-surface p-5">
          <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
            No notifications yet.
          </p>
        </article>
      ) : null}

      {!loading && !error ? (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const workspaceId =
              notification.researchJobId ||
              (typeof notification.metadataJson?.researchJobId === "string"
                ? notification.metadataJson.researchJobId
                : "");
            return (
              <article key={notification.id} className="bat-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="bat-chip">{notification.kind.toLowerCase()}</span>
                      <span className="rounded-full border px-2 py-0.5 text-[11px]" style={severityStyle(notification.severity)}>
                        {notification.severity}
                      </span>
                      {!notification.readAt ? (
                        <span className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: "#7db5f8", background: "#eef5ff", color: "#1f3c72" }}>
                          unread
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-2 text-base font-semibold">{notification.title}</h2>
                    <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
                      {notification.body}
                    </p>
                    <p className="mt-2 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                      {formatRelativeTime(notification.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {workspaceId ? (
                      <Link
                        href={`/app/w/${workspaceId}`}
                        className="rounded-full border px-3 py-1.5 text-xs"
                        style={{ borderColor: "var(--bat-border)" }}
                      >
                        Open Workspace
                      </Link>
                    ) : null}
                    {!notification.readAt ? (
                      <button
                        type="button"
                        onClick={() => void onMarkRead(notification.id)}
                        className="rounded-full border px-3 py-1.5 text-xs"
                        style={{ borderColor: "var(--bat-border)" }}
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
