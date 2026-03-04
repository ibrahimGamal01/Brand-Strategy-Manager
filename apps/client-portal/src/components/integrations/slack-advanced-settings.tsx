"use client";

import { SlackChannelCard } from "@/components/integrations/slack-channel-card";
import { createDefaultChannelForm, useSlackIntegrationData } from "@/components/integrations/use-slack-integration-data";

export function SlackAdvancedSettings() {
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
    channels,
    slackUsers,
    workspaces,
    channelForms,
    setChannelForm,
    settingsDraft,
    setSettingsDraft,
    defaultNotifyChannelId,
    setDefaultNotifyChannelId,
    selectedInstallation,
    mappedCurrentSlackUser,
    connectSlack,
    refreshInstallations,
    refreshChannels,
    syncSlackUsers,
    saveSettings,
    linkChannelToWorkspace,
    assignOwners,
    runBackfill,
    purgeChannel,
  } = useSlackIntegrationData();

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Advanced</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Slack advanced settings</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Full channel controls, owner mapping, backfill actions, and manual purge options. Messages are retained until manually purged.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
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
        </div>
        {statusMessage ? (
          <p className="mt-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
            {statusMessage}
          </p>
        ) : null}
        {preflight ? (
          <p className="mt-3 text-xs" style={{ color: "var(--bat-text-muted)" }}>
            Preflight: {preflight.configured ? "Ready" : `Missing ${preflight.missingEnv.join(", ") || "env vars"}`}
          </p>
        ) : null}
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
          {error}
        </article>
      ) : null}

      {!loading && installations.length === 0 ? (
        <article className="bat-surface p-5">
          <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Slack is not connected yet.
          </p>
        </article>
      ) : null}

      {selectedInstallation ? (
        <article className="bat-surface p-5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">
              Slack Team
              <select
                value={selectedTeamId}
                onChange={(event) => setSelectedTeamId(event.target.value)}
                className="ml-2 rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
              >
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
              disabled={syncingUsers || !selectedTeamId}
              className="rounded-full border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-70"
              style={{ borderColor: "var(--bat-border)" }}
            >
              {syncingUsers ? "Syncing users..." : "Sync Slack Users"}
            </button>
            <span className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
              {slackUsers.length} users cached
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
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

          <div className="mt-4 flex flex-wrap gap-3 text-sm">
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

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={savingSettings}
              className="rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
              style={{ background: "var(--bat-accent)", color: "white" }}
            >
              {savingSettings ? "Saving..." : "Save Slack Settings"}
            </button>
            <button
              type="button"
              onClick={() => void refreshChannels(selectedTeamId)}
              disabled={syncingChannels}
              className="rounded-full border px-4 py-2 text-sm"
              style={{ borderColor: "var(--bat-border)" }}
            >
              {syncingChannels ? "Syncing..." : "Refresh Channels"}
            </button>
          </div>
        </article>
      ) : null}

      {selectedInstallation ? (
        <div className="space-y-3">
          {channels.length === 0 ? (
            <article className="bat-surface p-5">
              <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
                No accessible channels are synced yet.
              </p>
            </article>
          ) : null}
          {channels.map((channel) => {
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
                onPurgeChannel={() => purgeChannel(channel)}
                showPurge
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

