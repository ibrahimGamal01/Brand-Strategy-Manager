"use client";

import { SlackChannelCard } from "@/components/integrations/slack-channel-card";
import { SlackSetupStepState } from "@/types/chat";
import { createDefaultChannelForm, useSlackIntegrationData } from "@/components/integrations/use-slack-integration-data";

function stepBadge(state: SlackSetupStepState) {
  if (state === "done") {
    return { label: "Done", style: { borderColor: "#b8e2c9", background: "#f0fbf4", color: "#166534" } };
  }
  if (state === "in_progress") {
    return { label: "In progress", style: { borderColor: "#7db5f8", background: "#eef5ff", color: "#1f3c72" } };
  }
  if (state === "locked") {
    return { label: "Locked", style: { borderColor: "#d1d5db", background: "#f8fafc", color: "#6b7280" } };
  }
  return { label: "To do", style: { borderColor: "#f5d08b", background: "#fff8eb", color: "#7a4a00" } };
}

type StepCardProps = {
  number: number;
  title: string;
  detail: string;
  state: SlackSetupStepState;
  locked?: boolean;
  children: React.ReactNode;
};

function StepCard({ number, title, detail, state, locked = false, children }: StepCardProps) {
  const badge = stepBadge(state);
  return (
    <article
      className="rounded-2xl border p-4"
      style={{
        borderColor: "var(--bat-border)",
        background: "var(--bat-surface)",
        opacity: locked ? 0.65 : 1,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Step {number}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            {detail}
          </p>
        </div>
        <span className="rounded-full border px-2 py-0.5 text-xs" style={badge.style}>
          {badge.label}
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </article>
  );
}

export function SlackSetupWizard() {
  const {
    loading,
    connecting,
    syncingChannels,
    syncingUsers,
    savingSettings,
    error,
    statusMessage,
    installations,
    selectedTeamId,
    setSelectedTeamId,
    preflight,
    manifestYaml,
    channels,
    slackUsers,
    workspaces,
    channelForms,
    setChannelForm,
    settingsDraft,
    setSettingsDraft,
    defaultNotifyChannelId,
    setDefaultNotifyChannelId,
    mappedCurrentSlackUser,
    groups,
    connectSlack,
    copyManifest,
    downloadManifest,
    refreshInstallations,
    refreshChannels,
    syncSlackUsers,
    linkChannelToWorkspace,
    assignOwners,
    runBackfill,
    saveSettings,
  } = useSlackIntegrationData();

  const hasConnectedTeam = installations.length > 0 && Boolean(selectedTeamId);
  const usersStepState: SlackSetupStepState = !hasConnectedTeam
    ? "locked"
    : slackUsers.length > 0
      ? "done"
      : "in_progress";
  const channelsStepDone =
    hasConnectedTeam &&
    channels.length > 0 &&
    groups.needsLink.length === 0 &&
    groups.needsOwners.length === 0 &&
    groups.needsBackfill.length === 0;
  const channelsStepState: SlackSetupStepState = !hasConnectedTeam
    ? "locked"
    : channelsStepDone
      ? "done"
      : "in_progress";
  const connectStepState: SlackSetupStepState = hasConnectedTeam ? "done" : "in_progress";
  const settingsStepState: SlackSetupStepState = !hasConnectedTeam ? "locked" : "todo";

  const renderChannelList = (title: string, items: typeof channels) => {
    if (!items.length) return null;
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {items.map((channel) => {
          const form = channelForms[channel.slackChannelId] || createDefaultChannelForm(channel);
          return (
            <SlackChannelCard
              key={channel.id}
              channel={channel}
              form={form}
              workspaces={workspaces}
              slackUsers={slackUsers}
              mappedCurrentSlackUser={mappedCurrentSlackUser}
              onFormPatch={(patch) => setChannelForm(channel.slackChannelId, patch)}
              onLinkChannel={() => linkChannelToWorkspace(channel)}
              onSaveOwners={() => assignOwners(channel)}
              onRunBackfill={() => runBackfill(channel)}
            />
          );
        })}
      </div>
    );
  };

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Guided Setup</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Slack integration wizard</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Follow the steps in order. BAT keeps all Slack data until manually purged, and reply drafts always require owner approval.
        </p>
      </div>

      {statusMessage ? (
        <article className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#b8e2c9", background: "#f0fbf4", color: "#166534" }}>
          {statusMessage}
        </article>
      ) : null}

      {error ? (
        <article className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
          {error} Try refresh, sync users again, or check Slack preflight values.
        </article>
      ) : null}

      <StepCard
        number={1}
        title="Prepare + connect Slack"
        detail="Confirm preflight readiness, copy your manifest, and connect your Slack workspace."
        state={connectStepState}
      >
        <div className="space-y-3">
          <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Preflight:{" "}
            {preflight?.configured
              ? "Ready"
              : `Missing env vars (${preflight?.missingEnv.join(", ") || "unknown"}). Fix these first.`}
          </p>
          <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
            OAuth callback: {preflight?.callbackUrl || "BACKEND_PUBLIC_ORIGIN not set"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void connectSlack()}
              disabled={connecting}
              className="rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
              style={{ background: "var(--bat-accent)", color: "white" }}
            >
              {connecting ? "Redirecting..." : installations.length ? "Reconnect Slack" : "Connect Slack"}
            </button>
            <button
              type="button"
              onClick={() => void refreshInstallations(false)}
              className="rounded-full border px-4 py-2 text-sm"
              style={{ borderColor: "var(--bat-border)" }}
            >
              Refresh status
            </button>
            <button
              type="button"
              onClick={() => void copyManifest()}
              className="rounded-full border px-4 py-2 text-sm"
              style={{ borderColor: "var(--bat-border)" }}
            >
              Copy manifest
            </button>
            <button
              type="button"
              onClick={downloadManifest}
              className="rounded-full border px-4 py-2 text-sm"
              style={{ borderColor: "var(--bat-border)" }}
            >
              Download YAML
            </button>
            <a
              href="https://api.slack.com/apps?new_app=1"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border px-4 py-2 text-sm"
              style={{ borderColor: "var(--bat-border)" }}
            >
              Open Slack App Setup
            </a>
          </div>
          <textarea
            readOnly
            value={manifestYaml}
            className="min-h-28 w-full rounded-xl border px-3 py-2 font-mono text-xs"
            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
          />
        </div>
      </StepCard>

      <StepCard
        number={2}
        title="Pick team + sync users"
        detail="Select your Slack team and pull user directory data for owner mapping."
        state={usersStepState}
        locked={!hasConnectedTeam}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              Slack team
              <select
                value={selectedTeamId}
                onChange={(event) => setSelectedTeamId(event.target.value)}
                disabled={!hasConnectedTeam}
                className="ml-2 rounded-xl border px-3 py-2 text-sm disabled:cursor-not-allowed"
                style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
              >
                {!installations.length ? <option value="">No connected team</option> : null}
                {installations.map((installation) => (
                  <option key={installation.slackTeamId} value={installation.slackTeamId}>
                    {installation.teamName || installation.slackTeamId}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void syncSlackUsers(selectedTeamId, { sync: true })}
              disabled={!selectedTeamId || syncingUsers}
              className="rounded-full border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
              style={{ borderColor: "var(--bat-border)" }}
            >
              {syncingUsers ? "Syncing..." : "Sync Slack users"}
            </button>
            <span className="rounded-full border px-3 py-2 text-xs" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
              {slackUsers.length} users cached
            </span>
          </div>
        </div>
      </StepCard>

      <StepCard
        number={3}
        title="Link channels + owners + backfill"
        detail="Each channel must be linked to a workspace, have at least one owner, and complete backfill."
        state={channelsStepState}
        locked={!hasConnectedTeam}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refreshChannels(selectedTeamId)}
              disabled={!selectedTeamId || syncingChannels}
              className="rounded-full border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-70"
              style={{ borderColor: "var(--bat-border)" }}
            >
              {syncingChannels ? "Syncing channels..." : "Refresh channels"}
            </button>
            <span className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
              {channels.length} channels visible
            </span>
          </div>

          {loading ? (
            <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
              Loading channels...
            </p>
          ) : null}

          {!loading && !channels.length ? (
            <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
              No channels are visible yet. Invite the bot to channels, then refresh.
            </p>
          ) : null}

          {renderChannelList("Needs workspace link", groups.needsLink)}
          {renderChannelList("Needs owners", groups.needsOwners)}
          {renderChannelList("Needs backfill", groups.needsBackfill)}
          {renderChannelList("Configured", groups.ready)}
        </div>
      </StepCard>

      <StepCard
        number={4}
        title="Save notifications + ingestion settings"
        detail="Configure owner delivery defaults and ingestion toggles."
        state={settingsStepState}
        locked={!hasConnectedTeam}
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              Default notify channel
              <input
                value={defaultNotifyChannelId}
                onChange={(event) => setDefaultNotifyChannelId(event.target.value)}
                placeholder="C1234567890"
                className="mt-1 w-full rounded-xl border px-3 py-2"
                style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
              />
            </label>
            <label className="text-sm">
              Owner delivery mode
              <select
                value={settingsDraft.ownerDeliveryMode}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    ownerDeliveryMode: event.target.value as typeof current.ownerDeliveryMode,
                  }))
                }
                className="mt-1 w-full rounded-xl border px-3 py-2"
                style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
              >
                <option value="dm">Slack DM</option>
                <option value="channel">Slack channel</option>
                <option value="both">DM + channel</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settingsDraft.notifyInSlack}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    notifyInSlack: event.target.checked,
                  }))
                }
              />
              Notify in Slack
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settingsDraft.notifyInBat}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    notifyInBat: event.target.checked,
                  }))
                }
              />
              Notify in BAT
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settingsDraft.dmIngestionEnabled}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    dmIngestionEnabled: event.target.checked,
                  }))
                }
              />
              Ingest DMs
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settingsDraft.mpimIngestionEnabled}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    mpimIngestionEnabled: event.target.checked,
                  }))
                }
              />
              Ingest MPIMs
            </label>
          </div>

          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={savingSettings || !selectedTeamId}
            className="rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            {savingSettings ? "Saving..." : "Save Slack settings"}
          </button>
        </div>
      </StepCard>
    </section>
  );
}

