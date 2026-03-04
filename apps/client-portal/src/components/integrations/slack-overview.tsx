"use client";

import Link from "next/link";
import { useSlackIntegrationData } from "@/components/integrations/use-slack-integration-data";

export function SlackOverview() {
  const {
    loading,
    connecting,
    error,
    statusMessage,
    preflight,
    manifestYaml,
    installations,
    selectedInstallation,
    channels,
    slackUsers,
    installationsCount,
    linkedChannelsCount,
    ownersAssignedCount,
    backfillDoneCount,
    channelsNeedingActionCount,
    connectSlack,
    copyManifest,
    downloadManifest,
    refreshInstallations,
  } = useSlackIntegrationData();

  const blockedByPreflight = Boolean(preflight && !preflight.configured);

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Slack Integration</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Plug-and-use setup</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Connect Slack, sync channels, assign owners, and go live with guided steps designed for first-time Slack users.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href="/app/integrations/slack/setup"
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            Start Guided Setup
          </Link>
          <button
            type="button"
            onClick={() => void connectSlack()}
            disabled={connecting || blockedByPreflight}
            className="rounded-full border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            style={{ borderColor: "var(--bat-border)" }}
          >
            {connecting
              ? "Redirecting..."
              : blockedByPreflight
                ? "Set env vars first"
                : installations.length
                  ? "Reconnect Slack"
                  : "Connect Slack"}
          </button>
          <button
            type="button"
            onClick={() => void refreshInstallations(false)}
            className="rounded-full border px-4 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Refresh Status
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "#b8e2c9", background: "#f0fbf4", color: "#166534" }}>
            Messages are retained until manually purged.
          </span>
          <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "#d3d9f4", background: "#f3f5ff", color: "#243b7d" }}>
            Draft replies require explicit owner approval.
          </span>
        </div>
        {statusMessage ? (
          <p className="mt-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
            {statusMessage}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article className="bat-surface p-4">
          <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Installations
          </p>
          <p className="mt-2 text-2xl font-semibold">{installationsCount}</p>
        </article>
        <article className="bat-surface p-4">
          <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Linked channels
          </p>
          <p className="mt-2 text-2xl font-semibold">
            {linkedChannelsCount} / {channels.length}
          </p>
        </article>
        <article className="bat-surface p-4">
          <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Owners mapped
          </p>
          <p className="mt-2 text-2xl font-semibold">
            {ownersAssignedCount} / {channels.length}
          </p>
        </article>
        <article className="bat-surface p-4">
          <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Backfill done
          </p>
          <p className="mt-2 text-2xl font-semibold">
            {backfillDoneCount} / {channels.length}
          </p>
        </article>
        <article className="bat-surface p-4">
          <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Channels needing action
          </p>
          <p className="mt-2 text-2xl font-semibold">{channelsNeedingActionCount}</p>
        </article>
        <article className="bat-surface p-4">
          <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Synced Slack users
          </p>
          <p className="mt-2 text-2xl font-semibold">{slackUsers.length}</p>
        </article>
      </div>

      {loading ? (
        <article className="bat-surface p-5">
          <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Loading Slack integration status...
          </p>
        </article>
      ) : null}

      {error ? (
        <article className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
          {error} Try refreshing status or checking Slack preflight configuration.
        </article>
      ) : null}

      <article className="bat-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Setup readiness</p>
          {preflight?.configured ? (
            <span className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: "#b8e2c9", background: "#f0fbf4", color: "#166534" }}>
              Ready
            </span>
          ) : (
            <span className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: "#f5d08b", background: "#fff8eb", color: "#7a4a00" }}>
              Needs attention
            </span>
          )}
        </div>
        {preflight?.configured ? (
          <p className="mt-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Backend Slack configuration is ready.
          </p>
        ) : (
          <p className="mt-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Missing environment variables: {preflight?.missingEnv.join(", ") || "Unknown"}.
          </p>
        )}
        <p className="mt-2 text-xs" style={{ color: "var(--bat-text-muted)" }}>
          OAuth callback: {preflight?.callbackUrl || "BACKEND_PUBLIC_ORIGIN not set"}
        </p>
      </article>

      <article className="bat-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Slack App Manifest</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyManifest()}
              className="rounded-full border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--bat-border)" }}
            >
              Copy
            </button>
            <button
              type="button"
              onClick={downloadManifest}
              className="rounded-full border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--bat-border)" }}
            >
              Download YAML
            </button>
            <a
              href="https://api.slack.com/apps?new_app=1"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--bat-border)" }}
            >
              Open Slack App Setup
            </a>
          </div>
        </div>
        <textarea
          readOnly
          value={manifestYaml}
          className="mt-2 min-h-32 w-full rounded-xl border px-3 py-2 font-mono text-xs"
          style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
        />
      </article>

      {selectedInstallation ? (
        <article className="bat-surface p-5">
          <p className="text-sm font-semibold">Current team</p>
          <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            {selectedInstallation.teamName || selectedInstallation.slackTeamId}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/app/integrations/slack/setup"
              className="rounded-full px-3 py-1.5 text-sm font-semibold"
              style={{ background: "var(--bat-accent)", color: "white" }}
            >
              Continue setup
            </Link>
            <Link
              href="/app/integrations/slack/verify"
              className="rounded-full border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--bat-border)" }}
            >
              Go live checks
            </Link>
            <Link
              href="/app/integrations/slack/advanced"
              className="rounded-full border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--bat-border)" }}
            >
              Advanced settings
            </Link>
          </div>
        </article>
      ) : null}
    </section>
  );
}
