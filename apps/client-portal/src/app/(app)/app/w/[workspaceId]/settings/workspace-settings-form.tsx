"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  disconnectLinkedInIntegration,
  getLinkedInIntegrationStatus,
  LinkedInIntegrationStatus,
  startLinkedInConnect,
  syncLinkedInIntegration,
} from "@/lib/auth-api";

type PrimaryKpi = "Lead quality" | "Revenue" | "Audience growth";
type MainChannelFocus = "Mixed" | "Web" | "Social";

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function WorkspaceSettingsForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [primaryKpi, setPrimaryKpi] = useState<PrimaryKpi>("Lead quality");
  const [mainChannelFocus, setMainChannelFocus] = useState<MainChannelFocus>("Mixed");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkedin, setLinkedin] = useState<LinkedInIntegrationStatus | null>(null);
  const [linkedinLoading, setLinkedinLoading] = useState(true);
  const [linkedinBusy, setLinkedinBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [linkedinMessage, setLinkedinMessage] = useState<string | null>(null);

  const linkedinQueryStatus = searchParams.get("linkedin");
  const linkedinQueryError = searchParams.get("linkedinError");

  const refreshLinkedInStatus = useCallback(async () => {
    setLinkedinLoading(true);
    try {
      const status = await getLinkedInIntegrationStatus(workspaceId);
      setLinkedin(status);
    } catch (loadError: unknown) {
      setLinkedin({
        available: false,
        featureEnabled: false,
        configured: false,
        status: "error",
        reasonMessage: String((loadError as Error)?.message || "Failed to load LinkedIn status"),
      });
    } finally {
      setLinkedinLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshLinkedInStatus();
  }, [refreshLinkedInStatus]);

  useEffect(() => {
    if (linkedinQueryStatus === "connected") {
      setLinkedinMessage("LinkedIn connected. We refreshed your profile and started syncing posts.");
      void refreshLinkedInStatus();
      router.replace(`/app/w/${workspaceId}/settings`);
    } else if (linkedinQueryStatus === "error") {
      setLinkedinMessage(linkedinQueryError || "LinkedIn connection failed.");
      void refreshLinkedInStatus();
      router.replace(`/app/w/${workspaceId}/settings`);
    }
  }, [linkedinQueryError, linkedinQueryStatus, refreshLinkedInStatus, router, workspaceId]);

  const linkedinStatusLabel = useMemo(() => {
    switch (linkedin?.status) {
      case "connected":
        return "Connected";
      case "syncing":
        return "Syncing";
      case "action_required":
        return "Action required";
      case "error":
        return "Error";
      case "disconnected":
        return "Disconnected";
      case "unavailable":
        return "Unavailable";
      default:
        return "Not connected";
    }
  }, [linkedin?.status]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    try {
      const storageKey = `bat.runtime.preferences.${workspaceId}`;
      const raw = window.localStorage.getItem(storageKey);
      let existing: Record<string, unknown> = {};
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (isRecord(parsed)) existing = parsed;
        } catch {
          existing = {};
        }
      }

      const sourceScope = isRecord(existing.sourceScope) ? existing.sourceScope : {};
      const nextSourceScope = {
        workspaceData: toBoolean(sourceScope.workspaceData, true),
        libraryPinned: toBoolean(sourceScope.libraryPinned, true),
        uploadedDocs: toBoolean(sourceScope.uploadedDocs, true),
        webSearch: toBoolean(sourceScope.webSearch, true),
        liveWebsiteCrawl: toBoolean(sourceScope.liveWebsiteCrawl, true),
        socialIntel: toBoolean(sourceScope.socialIntel, true),
      };

      if (mainChannelFocus === "Web") {
        nextSourceScope.webSearch = true;
        nextSourceScope.liveWebsiteCrawl = true;
        nextSourceScope.socialIntel = false;
      } else if (mainChannelFocus === "Social") {
        nextSourceScope.webSearch = false;
        nextSourceScope.liveWebsiteCrawl = false;
        nextSourceScope.socialIntel = true;
      } else {
        nextSourceScope.webSearch = true;
        nextSourceScope.liveWebsiteCrawl = true;
        nextSourceScope.socialIntel = true;
      }

      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          ...existing,
          sourceScope: nextSourceScope,
          strategyControls: {
            primaryKpi,
            mainChannelFocus,
            updatedAt: new Date().toISOString(),
          },
        })
      );

      router.push(`/app/w/${workspaceId}`);
      router.refresh();
    } catch (saveError: unknown) {
      setError(String((saveError as Error)?.message || "Failed to save settings"));
      setSaving(false);
    }
  };

  const onLinkedInConnect = async () => {
    setLinkedinBusy("connect");
    setLinkedinMessage(null);
    try {
      const result = await startLinkedInConnect(workspaceId);
      window.location.assign(result.authUrl);
    } catch (connectError: unknown) {
      setLinkedinMessage(String((connectError as Error)?.message || "Failed to start LinkedIn connect flow"));
      setLinkedinBusy(null);
      void refreshLinkedInStatus();
    }
  };

  const onLinkedInSync = async () => {
    setLinkedinBusy("sync");
    setLinkedinMessage(null);
    try {
      const result = await syncLinkedInIntegration(workspaceId);
      setLinkedinMessage(
        `LinkedIn sync finished. ${result.postsUpserted} new posts, ${result.postsUpdated} updated posts, ${result.snapshotsWritten} analytics snapshots.`
      );
      await refreshLinkedInStatus();
    } catch (syncError: unknown) {
      setLinkedinMessage(String((syncError as Error)?.message || "LinkedIn sync failed"));
      await refreshLinkedInStatus();
    } finally {
      setLinkedinBusy(null);
    }
  };

  const onLinkedInDisconnect = async () => {
    setLinkedinBusy("disconnect");
    setLinkedinMessage(null);
    try {
      await disconnectLinkedInIntegration(workspaceId);
      setLinkedinMessage("LinkedIn disconnected. Imported workspace data was kept and future syncs stopped.");
      await refreshLinkedInStatus();
    } catch (disconnectError: unknown) {
      setLinkedinMessage(String((disconnectError as Error)?.message || "LinkedIn disconnect failed"));
      await refreshLinkedInStatus();
    } finally {
      setLinkedinBusy(null);
    }
  };

  const formatTimestamp = (value?: string | null) => {
    if (!value) return "Not yet";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  };

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Workspace Settings</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Configure Strategy Controls</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Update priorities that influence tool planning, evidence ranking, and output style.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/app/w/${workspaceId}`}
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            Back to Chat
          </Link>
          <Link href={`/app/w/${workspaceId}/library`} className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--bat-border)" }}>
            Open Library
          </Link>
        </div>
      </div>

      <form onSubmit={onSubmit} className="bat-surface p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Primary KPI
            <select
              value={primaryKpi}
              onChange={(event) => setPrimaryKpi(event.target.value as PrimaryKpi)}
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            >
              <option>Lead quality</option>
              <option>Revenue</option>
              <option>Audience growth</option>
            </select>
          </label>
          <label className="text-sm">
            Main channel focus
            <select
              value={mainChannelFocus}
              onChange={(event) => setMainChannelFocus(event.target.value as MainChannelFocus)}
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            >
              <option>Mixed</option>
              <option>Web</option>
              <option>Social</option>
            </select>
          </label>
        </div>
        {error ? (
          <p className="mt-3 rounded-xl border border-[#f5b8b3] bg-[#fff5f4] px-3 py-2 text-sm text-[#8a1f17]">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
          style={{ background: "var(--bat-accent)", color: "white" }}
        >
          {saving ? "Saving..." : "Save and Continue in Chat"}
        </button>
      </form>

      <div className="bat-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="bat-chip">LinkedIn Integration</p>
            <h2 className="mt-3 text-xl font-semibold">Connect a user’s LinkedIn account</h2>
            <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
              Pull the connected user’s LinkedIn name, recent post content, and post analytics into this workspace.
            </p>
          </div>
          <span
            className="rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]"
            style={{ borderColor: "var(--bat-border)", color: "var(--bat-text-muted)" }}
          >
            {linkedinLoading ? "Loading" : linkedinStatusLabel}
          </span>
        </div>

        <div
          className="mt-5 rounded-2xl border p-4"
          style={{ borderColor: "var(--bat-border)", background: "color-mix(in srgb, var(--bat-surface) 82%, white 18%)" }}
        >
          {linkedinLoading ? (
            <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
              Checking LinkedIn configuration and connection status...
            </p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
                <div className="space-y-3 text-sm">
                  <p>
                    <strong>Availability:</strong>{" "}
                    {linkedin?.available
                      ? "Enabled and ready to connect."
                      : linkedin?.reasonMessage || "LinkedIn is not available in this environment."}
                  </p>
                  <p>
                    <strong>Profile:</strong>{" "}
                    {linkedin?.profile?.displayName || "No LinkedIn user connected yet"}
                  </p>
                  <p>
                    <strong>Handle:</strong> {linkedin?.profile?.handle || "Not available"}
                  </p>
                  <p>
                    <strong>Last sync:</strong> {formatTimestamp(linkedin?.sync?.lastSyncedAt)}
                  </p>
                  <p>
                    <strong>Next sync:</strong> {formatTimestamp(linkedin?.sync?.nextSyncAt)}
                  </p>
                  <p>
                    <strong>Imported posts:</strong> {linkedin?.sync?.importedPosts ?? 0}
                  </p>
                  {linkedin?.profile?.headline ? (
                    <p>
                      <strong>Headline:</strong> {linkedin.profile.headline}
                    </p>
                  ) : null}
                  {linkedin?.reasonMessage ? (
                    <p className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }}>
                      {linkedin.reasonMessage}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={onLinkedInConnect}
                    disabled={!linkedin?.available || linkedinBusy !== null}
                    className="w-full rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
                    style={{ background: "var(--bat-accent)", color: "white" }}
                  >
                    {linkedinBusy === "connect" ? "Redirecting..." : linkedin?.status === "connected" ? "Reconnect LinkedIn" : "Connect LinkedIn"}
                  </button>

                  <button
                    type="button"
                    onClick={onLinkedInSync}
                    disabled={linkedinBusy !== null || !linkedin || !["connected", "syncing", "action_required", "error"].includes(linkedin.status)}
                    className="w-full rounded-full border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    {linkedinBusy === "sync" ? "Syncing..." : "Run Manual Sync"}
                  </button>

                  <button
                    type="button"
                    onClick={onLinkedInDisconnect}
                    disabled={linkedinBusy !== null || !linkedin || !["connected", "syncing", "action_required", "error"].includes(linkedin.status)}
                    className="w-full rounded-full border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    {linkedinBusy === "disconnect" ? "Disconnecting..." : "Disconnect LinkedIn"}
                  </button>
                </div>
              </div>

              {linkedinMessage ? (
                <p className="mt-4 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--bat-border)" }}>
                  {linkedinMessage}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
