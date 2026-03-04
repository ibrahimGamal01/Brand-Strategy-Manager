"use client";

import { useCallback, useMemo } from "react";
import type { RuntimeApiError } from "@/lib/runtime-api";
import {
  fetchSlackInstallUrl,
  linkSlackChannel,
  purgeSlackChannelData,
  queueSlackChannelBackfill,
  updateSlackChannelOwners,
  updateSlackSettings,
} from "@/lib/runtime-api";
import { SlackChannelSummary } from "@/types/chat";
import {
  getSlackChannelActionState,
  parseOwnerSlackIds,
} from "@/components/integrations/slack-integration-utils";
import { SlackIntegrationState } from "@/components/integrations/use-slack-integration-state";

type ChannelGroups = {
  needsLink: SlackChannelSummary[];
  needsOwners: SlackChannelSummary[];
  needsBackfill: SlackChannelSummary[];
  ready: SlackChannelSummary[];
};

export type SlackIntegrationActions = {
  connectSlack: () => Promise<void>;
  copyManifest: () => Promise<void>;
  downloadManifest: () => void;
  saveSettings: () => Promise<void>;
  linkChannelToWorkspace: (channel: SlackChannelSummary) => Promise<void>;
  assignOwners: (channel: SlackChannelSummary) => Promise<void>;
  runBackfill: (channel: SlackChannelSummary) => Promise<void>;
  purgeChannel: (channel: SlackChannelSummary) => Promise<void>;
  isConfigured: boolean;
  installationsCount: number;
  linkedChannelsCount: number;
  ownersAssignedCount: number;
  backfillDoneCount: number;
  channelsNeedingActionCount: number;
  groups: ChannelGroups;
};

function getChannelGroups(channels: SlackChannelSummary[]): ChannelGroups {
  return {
    needsLink: channels.filter((channel) => getSlackChannelActionState(channel) === "needs_link"),
    needsOwners: channels.filter((channel) => getSlackChannelActionState(channel) === "needs_owners"),
    needsBackfill: channels.filter((channel) => getSlackChannelActionState(channel) === "needs_backfill"),
    ready: channels.filter((channel) => getSlackChannelActionState(channel) === "ready"),
  };
}

export function useSlackIntegrationActions(state: SlackIntegrationState): SlackIntegrationActions {
  const connectSlack = useCallback(async () => {
    if (state.connecting) return;
    const platformReady = state.preflight ? (state.preflight.platformReady ?? state.preflight.configured) : true;
    if (!platformReady) {
      if (state.isAdminView) {
        const missing = state.preflight?.missingEnv?.join(", ") || "required Slack environment variables";
        state.setError(`Slack setup is not ready yet. Complete platform config first: ${missing}.`);
      } else {
        state.setError(
          state.preflight?.publicMessage ||
            "BAT Slack is being configured. Contact your BAT admin or support and try again."
        );
      }
      return;
    }
    state.setConnecting(true);
    state.setError("");
    try {
      const payload = await fetchSlackInstallUrl();
      if (!payload.installUrl) throw new Error("Slack install URL is unavailable.");
      window.location.href = payload.installUrl;
    } catch (nextError: any) {
      const runtimeError = nextError as RuntimeApiError;
      if (runtimeError?.code === "SLACK_PLATFORM_NOT_READY") {
        state.setError(
          state.preflight?.publicMessage ||
            runtimeError.details ||
            "BAT Slack is being configured. Contact your BAT admin or support and try again."
        );
      } else {
        state.setError(String(nextError?.message || "Failed to start Slack OAuth flow."));
      }
      state.setConnecting(false);
    }
  }, [state]);

  const copyManifest = useCallback(async () => {
    if (!state.manifestYaml) return;
    try {
      await navigator.clipboard.writeText(state.manifestYaml);
      state.setStatusMessage("Slack manifest copied to clipboard.");
    } catch {
      state.setError("Could not copy manifest. Select and copy manually.");
    }
  }, [state]);

  const downloadManifest = useCallback(() => {
    if (!state.manifestYaml) return;
    try {
      const blob = new Blob([state.manifestYaml], { type: "text/yaml;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "bat-slack-manifest.yaml";
      anchor.click();
      URL.revokeObjectURL(href);
      state.setStatusMessage("Manifest downloaded.");
    } catch {
      state.setError("Could not download manifest.");
    }
  }, [state]);

  const saveSettings = useCallback(async () => {
    if (!state.selectedTeamId || state.savingSettings) return;
    state.setSavingSettings(true);
    state.setError("");
    try {
      await updateSlackSettings({
        slackTeamId: state.selectedTeamId,
        defaultNotifyChannelId: state.defaultNotifyChannelId || null,
        settings: state.settingsDraft,
      });
      state.setStatusMessage("Slack settings saved.");
      await state.refreshInstallations(false);
      await state.refreshChannels(state.selectedTeamId);
    } catch (nextError: any) {
      state.setError(String(nextError?.message || "Failed to save Slack settings."));
    } finally {
      state.setSavingSettings(false);
    }
  }, [state]);

  const linkChannelToWorkspace = useCallback(
    async (channel: SlackChannelSummary) => {
      const form = state.channelForms[channel.slackChannelId];
      const workspaceId = String(form?.workspaceId || "").trim();
      if (!workspaceId || !state.selectedTeamId) {
        state.setChannelForm(channel.slackChannelId, {
          message: "Select a workspace first.",
          isError: true,
        });
        return;
      }
      state.setChannelForm(channel.slackChannelId, { working: true, message: "", isError: false });
      try {
        await linkSlackChannel({
          slackTeamId: state.selectedTeamId,
          channelId: channel.slackChannelId,
          workspaceId,
          enabled: true,
        });
        await state.refreshChannels(state.selectedTeamId);
        state.setChannelForm(channel.slackChannelId, {
          working: false,
          message: "Linked and backfill queued.",
          isError: false,
        });
      } catch (nextError: any) {
        state.setChannelForm(channel.slackChannelId, {
          working: false,
          message: String(nextError?.message || "Failed to link channel."),
          isError: true,
        });
      }
    },
    [state]
  );

  const assignOwners = useCallback(
    async (channel: SlackChannelSummary) => {
      const form = state.channelForms[channel.slackChannelId];
      const slackUserIds = parseOwnerSlackIds(form?.ownerSlackIds || "");
      if (!state.selectedTeamId) return;
      if (!slackUserIds.length) {
        state.setChannelForm(channel.slackChannelId, {
          message: "Add at least one Slack user ID.",
          isError: true,
        });
        return;
      }

      state.setChannelForm(channel.slackChannelId, { working: true, message: "", isError: false });
      try {
        const userPortalLookup = new Map(
          state.slackUsers.map((user) => [user.slackUserId, String(user.portalUserId || "").trim() || null])
        );
        await updateSlackChannelOwners({
          slackTeamId: state.selectedTeamId,
          channelId: channel.slackChannelId,
          owners: slackUserIds.map((slackUserId) => {
            const mappedPortalUserId = userPortalLookup.get(slackUserId);
            return mappedPortalUserId
              ? {
                  slackUserId,
                  portalUserId: mappedPortalUserId,
                }
              : { slackUserId };
          }),
        });
        await state.refreshChannels(state.selectedTeamId);
        await state.syncSlackUsers(state.selectedTeamId);
        state.setChannelForm(channel.slackChannelId, {
          working: false,
          message: "Owners updated.",
          isError: false,
        });
      } catch (nextError: any) {
        state.setChannelForm(channel.slackChannelId, {
          working: false,
          message: String(nextError?.message || "Failed to assign owners."),
          isError: true,
        });
      }
    },
    [state]
  );

  const runBackfill = useCallback(
    async (channel: SlackChannelSummary) => {
      if (!state.selectedTeamId) return;
      state.setChannelForm(channel.slackChannelId, { working: true, message: "", isError: false });
      try {
        await queueSlackChannelBackfill({
          slackTeamId: state.selectedTeamId,
          channelId: channel.slackChannelId,
        });
        await state.refreshChannels(state.selectedTeamId);
        state.setChannelForm(channel.slackChannelId, {
          working: false,
          message: "Backfill queued.",
          isError: false,
        });
      } catch (nextError: any) {
        state.setChannelForm(channel.slackChannelId, {
          working: false,
          message: String(nextError?.message || "Failed to queue backfill."),
          isError: true,
        });
      }
    },
    [state]
  );

  const purgeChannel = useCallback(
    async (channel: SlackChannelSummary) => {
      if (!state.selectedTeamId) return;
      const confirmed = window.confirm(
        `Permanently purge stored Slack messages and attention items for #${channel.name}? This cannot be undone.`
      );
      if (!confirmed) return;
      state.setChannelForm(channel.slackChannelId, { working: true, message: "", isError: false });
      try {
        const result = await purgeSlackChannelData({
          slackTeamId: state.selectedTeamId,
          slackChannelId: channel.slackChannelId,
        });
        await state.refreshChannels(state.selectedTeamId);
        state.setChannelForm(channel.slackChannelId, {
          working: false,
          message: `Purged ${result.purged.messages} messages and ${result.purged.attentionItems} attention items.`,
          isError: false,
        });
      } catch (nextError: any) {
        state.setChannelForm(channel.slackChannelId, {
          working: false,
          message: String(nextError?.message || "Failed to purge channel data."),
          isError: true,
        });
      }
    },
    [state]
  );

  return useMemo(() => {
    const channelsWithLink = state.channels.filter((channel) => Boolean(channel.links[0]?.researchJobId));
    const channelsWithOwners = state.channels.filter((channel) => channel.owners.length > 0);
    const channelsWithBackfillDone = state.channels.filter((channel) => channel.links[0]?.backfillState === "DONE");
    const channelsNeedingAction = state.channels.filter((channel) => getSlackChannelActionState(channel) !== "ready");

    return {
      connectSlack,
      copyManifest,
      downloadManifest,
      saveSettings,
      linkChannelToWorkspace,
      assignOwners,
      runBackfill,
      purgeChannel,
      isConfigured: Boolean(state.preflight?.configured),
      installationsCount: state.installations.length,
      linkedChannelsCount: channelsWithLink.length,
      ownersAssignedCount: channelsWithOwners.length,
      backfillDoneCount: channelsWithBackfillDone.length,
      channelsNeedingActionCount: channelsNeedingAction.length,
      groups: getChannelGroups(state.channels),
    };
  }, [
    assignOwners,
    connectSlack,
    copyManifest,
    downloadManifest,
    linkChannelToWorkspace,
    purgeChannel,
    runBackfill,
    saveSettings,
    state.channels,
    state.installations.length,
    state.preflight?.configured,
  ]);
}
