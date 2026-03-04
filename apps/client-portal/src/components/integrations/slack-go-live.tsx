"use client";

import Link from "next/link";
import { useSlackIntegrationData } from "@/components/integrations/use-slack-integration-data";

function CheckRow({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }}>
      <p className="text-sm">{label}</p>
      <span
        className="rounded-full border px-2 py-0.5 text-xs"
        style={
          passed
            ? { borderColor: "#b8e2c9", background: "#f0fbf4", color: "#166534" }
            : { borderColor: "#f5d08b", background: "#fff8eb", color: "#7a4a00" }
        }
      >
        {passed ? "Pass" : "Pending"}
      </span>
    </div>
  );
}

export function SlackGoLive() {
  const {
    statusMessage,
    error,
    selectedTeamId,
    channels,
    linkedChannelsCount,
    ownersAssignedCount,
    backfillDoneCount,
    channelsNeedingActionCount,
    refreshInstallations,
    refreshChannels,
  } = useSlackIntegrationData();

  const hasTeam = Boolean(selectedTeamId);
  const hasLinkedChannel = linkedChannelsCount > 0;
  const hasOwners = ownersAssignedCount > 0;
  const hasBackfill = backfillDoneCount > 0;
  const hasNoBlockingActions = channels.length > 0 && channelsNeedingActionCount === 0;

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Go Live</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Slack production verification</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Use this checklist exactly as a first-time operator to validate setup end-to-end before production cutover.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refreshInstallations(false)}
            className="rounded-full border px-4 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Refresh installation
          </button>
          <button
            type="button"
            onClick={() => void refreshChannels(selectedTeamId)}
            disabled={!selectedTeamId}
            className="rounded-full border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Refresh channels
          </button>
          <Link
            href="/app/integrations/slack/setup"
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            Return to Guided Setup
          </Link>
        </div>
      </div>

      {statusMessage ? (
        <article className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#b8e2c9", background: "#f0fbf4", color: "#166534" }}>
          {statusMessage}
        </article>
      ) : null}

      {error ? (
        <article className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
          {error}
        </article>
      ) : null}

      <article className="bat-surface p-5">
        <h2 className="text-lg font-semibold">Readiness counters</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
            <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              Team selected
            </p>
            <p className="mt-1 text-xl font-semibold">{hasTeam ? "Yes" : "No"}</p>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
            <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              Linked channels
            </p>
            <p className="mt-1 text-xl font-semibold">{linkedChannelsCount}</p>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
            <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              Owners assigned
            </p>
            <p className="mt-1 text-xl font-semibold">{ownersAssignedCount}</p>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
            <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              Backfill done
            </p>
            <p className="mt-1 text-xl font-semibold">{backfillDoneCount}</p>
          </div>
        </div>
      </article>

      <article className="bat-surface p-5">
        <h2 className="text-lg font-semibold">Verification checklist</h2>
        <div className="mt-3 space-y-2">
          <CheckRow label="Slack team connected and selected in BAT" passed={hasTeam} />
          <CheckRow label="At least one channel linked to workspace" passed={hasLinkedChannel} />
          <CheckRow label="At least one owner assigned" passed={hasOwners} />
          <CheckRow label="At least one channel backfill reached DONE" passed={hasBackfill} />
          <CheckRow label="No channels left in needs-action state" passed={hasNoBlockingActions} />
        </div>
      </article>

      <article className="bat-surface p-5">
        <h2 className="text-lg font-semibold">Manual end-to-end test script</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          <li>
            In Slack, invite BAT to one channel using <code>/invite @BAT</code>.
          </li>
          <li>
            Run <code>/bat link &lt;workspace-id&gt;</code> or link via BAT setup page.
          </li>
          <li>Run full backfill for that channel and wait until status is DONE.</li>
          <li>Send a message that includes a deadline or explicit feedback request.</li>
          <li>Confirm BAT notification appears in Notification Center.</li>
          <li>Confirm Slack owner notification arrives with approval actions.</li>
          <li>Approve draft reply and verify BAT posts in correct thread.</li>
        </ol>
      </article>
    </section>
  );
}

