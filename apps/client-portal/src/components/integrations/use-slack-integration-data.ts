"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getPortalMe } from "@/lib/auth-api";
import {
  fetchSlackChannels,
  fetchSlackInstallUrl,
  fetchSlackManifest,
  fetchSlackPreflight,
  fetchSlackStatus,
  fetchSlackUsers,
  linkSlackChannel,
  purgeSlackChannelData,
  queueSlackChannelBackfill,
  updateSlackChannelOwners,
  updateSlackSettings,
} from "@/lib/runtime-api";
import {
  SlackChannelActionState,
  SlackChannelSummary,
  SlackInstallationSettings,
  SlackInstallationSummary,
  SlackPreflightReport,
  SlackUserSummary,
} from "@/types/chat";

export type WorkspaceOption = {
  id: string;
  name: string;
};

export type ChannelFormState = {
  workspaceId: string;
  ownerSlackIds: string;
  ownerPickerSlackUserId: string;
  working: boolean;
  message: string;
  isError: boolean;
};

export function normalizeSettings(value: SlackInstallationSettings): SlackInstallationSettings {
  return {
    dmIngestionEnabled: Boolean(value.dmIngestionEnabled),
    mpimIngestionEnabled: Boolean(value.mpimIngestionEnabled),
    notifyInSlack: value.notifyInSlack !== false,
    notifyInBat: value.notifyInBat !== false,
    ownerDeliveryMode:
      value.ownerDeliveryMode === "channel" || value.ownerDeliveryMode === "both"
        ? value.ownerDeliveryMode
        : "dm",
  };
}

export function formatChannelType(value: SlackChannelSummary["conversationType"]): string {
  if (value === "CHANNEL") return "public";
  if (value === "GROUP") return "private";
  if (value === "IM") return "dm";
  return "mpim";
}

export function parseOwnerSlackIds(value: string): string[] {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\s,;|]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ).slice(0, 20);
}

export function stringifyOwnerSlackIds(ids: string[]): string {
  return ids.join(", ");
}

export function addSlackOwnerId(currentValue: string, nextSlackUserId: string): string {
  const cleaned = parseOwnerSlackIds(currentValue);
  if (!cleaned.includes(nextSlackUserId)) cleaned.push(nextSlackUserId);
  return stringifyOwnerSlackIds(cleaned.slice(0, 20));
}

export function removeSlackOwnerId(currentValue: string, slackUserId: string): string {
  return stringifyOwnerSlackIds(parseOwnerSlackIds(currentValue).filter((entry) => entry !== slackUserId));
}

export function formatSlackUserOption(user: SlackUserSummary): string {
  const displayName = String(user.displayName || "").trim();
  const email = String(user.email || "").trim();
  if (displayName && email) return `${displayName} (${email})`;
  if (displayName) return displayName;
  if (email) return email;
  return user.slackUserId;
}

function getPrimaryLink(channel: SlackChannelSummary) {
  return channel.links[0] || null;
}

export function getSlackChannelActionState(channel: SlackChannelSummary): SlackChannelActionState {
  const link = getPrimaryLink(channel);
  if (!link?.researchJobId) return "needs_link";
  if (!channel.owners.length) return "needs_owners";
  if (link.backfillState !== "DONE") return "needs_backfill";
  return "ready";
}

export function createDefaultChannelForm(channel: SlackChannelSummary): ChannelFormState {
  return {
    workspaceId: channel.links[0]?.researchJobId || "",
    ownerSlackIds: channel.owners.map((owner) => owner.slackUserId).join(", "),
    ownerPickerSlackUserId: "",
    working: false,
    message: "",
    isError: false,
  };
}

export function useSlackIntegrationData() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [syncingChannels, setSyncingChannels] = useState(false);
  const [syncingUsers, setSyncingUsers] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [portalUserId, setPortalUserId] = useState("");
  const [portalUserEmail, setPortalUserEmail] = useState("");
  const [installations, setInstallations] = useState<SlackInstallationSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [preflight, setPreflight] = useState<SlackPreflightReport | null>(null);
  const [manifestYaml, setManifestYaml] = useState("");
  const [channels, setChannels] = useState<SlackChannelSummary[]>([]);
  const [slackUsers, setSlackUsers] = useState<SlackUserSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [channelForms, setChannelForms] = useState<Record<string, ChannelFormState>>({});
  const [settingsDraft, setSettingsDraft] = useState<SlackInstallationSettings>({
    dmIngestionEnabled: false,
    mpimIngestionEnabled: false,
    notifyInSlack: true,
    notifyInBat: true,
    ownerDeliveryMode: "dm",
  });
  const [defaultNotifyChannelId, setDefaultNotifyChannelId] = useState("");

  const selectedInstallation = useMemo(
    () => installations.find((item) => item.slackTeamId === selectedTeamId) || null,
    [installations, selectedTeamId]
  );

  const mappedCurrentSlackUser = useMemo(() => {
    return (
      slackUsers.find((user) => String(user.portalUserId || "").trim() === portalUserId) ||
      slackUsers.find(
        (user) =>
          portalUserEmail &&
          String(user.email || "")
            .trim()
            .toLowerCase() === portalUserEmail
      ) ||
      null
    );
  }, [portalUserEmail, portalUserId, slackUsers]);

  const setChannelForm = useCallback((channelId: string, patch: Partial<ChannelFormState>) => {
    setChannelForms((current) => {
      const existing = current[channelId] || {
        workspaceId: "",
        ownerSlackIds: "",
        ownerPickerSlackUserId: "",
        working: false,
        message: "",
        isError: false,
      };
      return {
        ...current,
        [channelId]: {
          ...existing,
          ...patch,
        },
      };
    });
  }, []);

  const readInstallations = useCallback(async (withLoading = true) => {
    if (withLoading) setLoading(true);
    setError("");
    try {
      const [me, statusPayload, preflightPayload, manifestPayload] = await Promise.all([
        getPortalMe(),
        fetchSlackStatus(),
        fetchSlackPreflight(),
        fetchSlackManifest(),
      ]);
      setPortalUserId(me.user.id);
      setPortalUserEmail(String(me.user.email || "").trim().toLowerCase());
      setPreflight(preflightPayload);
      setManifestYaml(String(manifestPayload.yaml || "").trim());
      const rows = Array.isArray(statusPayload.installations) ? statusPayload.installations : [];
      setInstallations(rows);
      setSelectedTeamId((current) => {
        if (current && rows.some((row) => row.slackTeamId === current)) return current;
        return rows[0]?.slackTeamId || "";
      });
    } catch (nextError: any) {
      setError(String(nextError?.message || "Failed to load Slack installation status."));
      setPreflight(null);
      setManifestYaml("");
      setInstallations([]);
      setSelectedTeamId("");
    } finally {
      if (withLoading) setLoading(false);
    }
  }, []);

  const readChannels = useCallback(async (teamId: string) => {
    if (!teamId) {
      setChannels([]);
      setWorkspaces([]);
      setChannelForms({});
      return;
    }
    setSyncingChannels(true);
    setError("");
    try {
      const payload = await fetchSlackChannels(teamId);
      const nextChannels = Array.isArray(payload.channels) ? payload.channels : [];
      const nextWorkspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
      setChannels(nextChannels);
      setWorkspaces(nextWorkspaces);
      setChannelForms((current) => {
        const next: Record<string, ChannelFormState> = {};
        for (const channel of nextChannels) {
          const currentState = current[channel.slackChannelId];
          const linkedWorkspaceId = channel.links[0]?.researchJobId || "";
          const ownerSlackIds = channel.owners.map((owner) => owner.slackUserId).join(", ");
          next[channel.slackChannelId] = currentState
            ? { ...currentState, workspaceId: currentState.workspaceId || linkedWorkspaceId }
            : {
                workspaceId: linkedWorkspaceId,
                ownerSlackIds,
                ownerPickerSlackUserId: "",
                working: false,
                message: "",
                isError: false,
              };
        }
        return next;
      });
    } catch (nextError: any) {
      setError(String(nextError?.message || "Failed to load Slack channels."));
      setChannels([]);
      setWorkspaces([]);
      setChannelForms({});
    } finally {
      setSyncingChannels(false);
    }
  }, []);

  const readSlackUsers = useCallback(async (teamId: string, options?: { sync?: boolean }) => {
    if (!teamId) {
      setSlackUsers([]);
      return;
    }
    if (options?.sync) setSyncingUsers(true);
    setError("");
    try {
      const payload = await fetchSlackUsers({
        slackTeamId: teamId,
        sync: options?.sync,
      });
      setSlackUsers(Array.isArray(payload.users) ? payload.users : []);
      if (options?.sync) {
        setStatusMessage("Slack user directory synced.");
      }
    } catch (nextError: any) {
      setError(String(nextError?.message || "Failed to load Slack users."));
      setSlackUsers([]);
    } finally {
      if (options?.sync) setSyncingUsers(false);
    }
  }, []);

  useEffect(() => {
    const status = String(searchParams.get("status") || "").trim().toLowerCase();
    const reason = String(searchParams.get("reason") || "").trim();
    if (status === "connected") {
      setStatusMessage("Slack connected successfully. You can now sync channels and link workspaces.");
    } else if (status === "error") {
      setStatusMessage(reason ? `Slack connection failed: ${reason}` : "Slack connection failed.");
    }
  }, [searchParams]);

  useEffect(() => {
    void readInstallations(true);
  }, [readInstallations]);

  useEffect(() => {
    if (!selectedInstallation) return;
    setSettingsDraft(normalizeSettings(selectedInstallation.settings));
    setDefaultNotifyChannelId(selectedInstallation.defaultNotifyChannelId || "");
  }, [selectedInstallation]);

  useEffect(() => {
    if (!selectedTeamId) {
      setChannels([]);
      setSlackUsers([]);
      setWorkspaces([]);
      setChannelForms({});
      return;
    }
    void readChannels(selectedTeamId);
    void readSlackUsers(selectedTeamId);
  }, [readChannels, readSlackUsers, selectedTeamId]);

  const connectSlack = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    setError("");
    try {
      const payload = await fetchSlackInstallUrl();
      if (!payload.installUrl) throw new Error("Slack install URL is unavailable.");
      window.location.href = payload.installUrl;
    } catch (nextError: any) {
      setError(String(nextError?.message || "Failed to start Slack OAuth flow."));
      setConnecting(false);
    }
  }, [connecting]);

  const copyManifest = useCallback(async () => {
    if (!manifestYaml) return;
    try {
      await navigator.clipboard.writeText(manifestYaml);
      setStatusMessage("Slack manifest copied to clipboard.");
    } catch {
      setError("Could not copy manifest. Select and copy manually.");
    }
  }, [manifestYaml]);

  const downloadManifest = useCallback(() => {
    if (!manifestYaml) return;
    try {
      const blob = new Blob([manifestYaml], { type: "text/yaml;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "bat-slack-manifest.yaml";
      anchor.click();
      URL.revokeObjectURL(href);
      setStatusMessage("Manifest downloaded.");
    } catch {
      setError("Could not download manifest.");
    }
  }, [manifestYaml]);

  const saveSettings = useCallback(async () => {
    if (!selectedTeamId || savingSettings) return;
    setSavingSettings(true);
    setError("");
    try {
      await updateSlackSettings({
        slackTeamId: selectedTeamId,
        defaultNotifyChannelId: defaultNotifyChannelId || null,
        settings: settingsDraft,
      });
      setStatusMessage("Slack settings saved.");
      await readInstallations(false);
      await readChannels(selectedTeamId);
    } catch (nextError: any) {
      setError(String(nextError?.message || "Failed to save Slack settings."));
    } finally {
      setSavingSettings(false);
    }
  }, [defaultNotifyChannelId, readChannels, readInstallations, savingSettings, selectedTeamId, settingsDraft]);

  const linkChannelToWorkspace = useCallback(
    async (channel: SlackChannelSummary) => {
      const form = channelForms[channel.slackChannelId];
      const workspaceId = String(form?.workspaceId || "").trim();
      if (!workspaceId || !selectedTeamId) {
        setChannelForm(channel.slackChannelId, {
          message: "Select a workspace first.",
          isError: true,
        });
        return;
      }
      setChannelForm(channel.slackChannelId, { working: true, message: "", isError: false });
      try {
        await linkSlackChannel({
          slackTeamId: selectedTeamId,
          channelId: channel.slackChannelId,
          workspaceId,
          enabled: true,
        });
        await readChannels(selectedTeamId);
        setChannelForm(channel.slackChannelId, {
          working: false,
          message: "Linked and backfill queued.",
          isError: false,
        });
      } catch (nextError: any) {
        setChannelForm(channel.slackChannelId, {
          working: false,
          message: String(nextError?.message || "Failed to link channel."),
          isError: true,
        });
      }
    },
    [channelForms, readChannels, selectedTeamId, setChannelForm]
  );

  const assignOwners = useCallback(
    async (channel: SlackChannelSummary) => {
      const form = channelForms[channel.slackChannelId];
      const slackUserIds = parseOwnerSlackIds(form?.ownerSlackIds || "");
      if (!selectedTeamId) return;
      if (!slackUserIds.length) {
        setChannelForm(channel.slackChannelId, {
          message: "Add at least one Slack user ID.",
          isError: true,
        });
        return;
      }

      setChannelForm(channel.slackChannelId, { working: true, message: "", isError: false });
      try {
        const userPortalLookup = new Map(
          slackUsers.map((user) => [user.slackUserId, String(user.portalUserId || "").trim() || null])
        );
        await updateSlackChannelOwners({
          slackTeamId: selectedTeamId,
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
        await readChannels(selectedTeamId);
        await readSlackUsers(selectedTeamId);
        setChannelForm(channel.slackChannelId, {
          working: false,
          message: "Owners updated.",
          isError: false,
        });
      } catch (nextError: any) {
        setChannelForm(channel.slackChannelId, {
          working: false,
          message: String(nextError?.message || "Failed to assign owners."),
          isError: true,
        });
      }
    },
    [channelForms, readChannels, readSlackUsers, selectedTeamId, setChannelForm, slackUsers]
  );

  const runBackfill = useCallback(
    async (channel: SlackChannelSummary) => {
      if (!selectedTeamId) return;
      setChannelForm(channel.slackChannelId, { working: true, message: "", isError: false });
      try {
        await queueSlackChannelBackfill({
          slackTeamId: selectedTeamId,
          channelId: channel.slackChannelId,
        });
        await readChannels(selectedTeamId);
        setChannelForm(channel.slackChannelId, {
          working: false,
          message: "Backfill queued.",
          isError: false,
        });
      } catch (nextError: any) {
        setChannelForm(channel.slackChannelId, {
          working: false,
          message: String(nextError?.message || "Failed to queue backfill."),
          isError: true,
        });
      }
    },
    [readChannels, selectedTeamId, setChannelForm]
  );

  const purgeChannel = useCallback(
    async (channel: SlackChannelSummary) => {
      if (!selectedTeamId) return;
      const confirmed = window.confirm(
        `Permanently purge stored Slack messages and attention items for #${channel.name}? This cannot be undone.`
      );
      if (!confirmed) return;
      setChannelForm(channel.slackChannelId, { working: true, message: "", isError: false });
      try {
        const result = await purgeSlackChannelData({
          slackTeamId: selectedTeamId,
          slackChannelId: channel.slackChannelId,
        });
        await readChannels(selectedTeamId);
        setChannelForm(channel.slackChannelId, {
          working: false,
          message: `Purged ${result.purged.messages} messages and ${result.purged.attentionItems} attention items.`,
          isError: false,
        });
      } catch (nextError: any) {
        setChannelForm(channel.slackChannelId, {
          working: false,
          message: String(nextError?.message || "Failed to purge channel data."),
          isError: true,
        });
      }
    },
    [readChannels, selectedTeamId, setChannelForm]
  );

  const derived = useMemo(() => {
    const channelsWithLink = channels.filter((channel) => Boolean(getPrimaryLink(channel)?.researchJobId));
    const channelsWithOwners = channels.filter((channel) => channel.owners.length > 0);
    const channelsWithBackfillDone = channels.filter((channel) => getPrimaryLink(channel)?.backfillState === "DONE");
    const channelsNeedingAction = channels.filter((channel) => getSlackChannelActionState(channel) !== "ready");

    const groups = {
      needsLink: channels.filter((channel) => getSlackChannelActionState(channel) === "needs_link"),
      needsOwners: channels.filter((channel) => getSlackChannelActionState(channel) === "needs_owners"),
      needsBackfill: channels.filter((channel) => getSlackChannelActionState(channel) === "needs_backfill"),
      ready: channels.filter((channel) => getSlackChannelActionState(channel) === "ready"),
    };

    return {
      isConfigured: Boolean(preflight?.configured),
      installationsCount: installations.length,
      linkedChannelsCount: channelsWithLink.length,
      ownersAssignedCount: channelsWithOwners.length,
      backfillDoneCount: channelsWithBackfillDone.length,
      channelsNeedingActionCount: channelsNeedingAction.length,
      groups,
    };
  }, [channels, installations.length, preflight?.configured]);

  return {
    loading,
    connecting,
    savingSettings,
    syncingChannels,
    syncingUsers,
    error,
    statusMessage,
    portalUserId,
    portalUserEmail,
    installations,
    selectedTeamId,
    setSelectedTeamId,
    preflight,
    manifestYaml,
    channels,
    slackUsers,
    workspaces,
    channelForms,
    settingsDraft,
    setSettingsDraft,
    defaultNotifyChannelId,
    setDefaultNotifyChannelId,
    selectedInstallation,
    mappedCurrentSlackUser,
    setChannelForm,
    connectSlack,
    copyManifest,
    downloadManifest,
    saveSettings,
    linkChannelToWorkspace,
    assignOwners,
    runBackfill,
    purgeChannel,
    refreshInstallations: readInstallations,
    refreshChannels: readChannels,
    syncSlackUsers: readSlackUsers,
    ...derived,
  };
}

