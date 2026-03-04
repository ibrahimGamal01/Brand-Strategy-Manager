"use client";

import { useSearchParams } from "next/navigation";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getPortalMe } from "@/lib/auth-api";
import {
  fetchSlackChannels,
  fetchSlackManifest,
  fetchSlackPreflight,
  fetchSlackStatus,
  fetchSlackUsers,
} from "@/lib/runtime-api";
import {
  SlackChannelSummary,
  SlackInstallationSettings,
  SlackInstallationSummary,
  SlackPreflightReport,
  SlackUserSummary,
} from "@/types/chat";
import { ChannelFormState, WorkspaceOption } from "@/components/integrations/slack-integration-types";
import { normalizeSettings } from "@/components/integrations/slack-integration-utils";

type SyncUsersOptions = { sync?: boolean };

export type SlackIntegrationState = {
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  connecting: boolean;
  setConnecting: Dispatch<SetStateAction<boolean>>;
  savingSettings: boolean;
  setSavingSettings: Dispatch<SetStateAction<boolean>>;
  syncingChannels: boolean;
  setSyncingChannels: Dispatch<SetStateAction<boolean>>;
  syncingUsers: boolean;
  setSyncingUsers: Dispatch<SetStateAction<boolean>>;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
  statusMessage: string;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  isAdminView: boolean;
  portalUserId: string;
  portalUserEmail: string;
  installations: SlackInstallationSummary[];
  selectedTeamId: string;
  setSelectedTeamId: React.Dispatch<React.SetStateAction<string>>;
  preflight: SlackPreflightReport | null;
  manifestYaml: string;
  channels: SlackChannelSummary[];
  slackUsers: SlackUserSummary[];
  workspaces: WorkspaceOption[];
  channelForms: Record<string, ChannelFormState>;
  settingsDraft: SlackInstallationSettings;
  setSettingsDraft: Dispatch<SetStateAction<SlackInstallationSettings>>;
  defaultNotifyChannelId: string;
  setDefaultNotifyChannelId: Dispatch<SetStateAction<string>>;
  selectedInstallation: SlackInstallationSummary | null;
  mappedCurrentSlackUser: SlackUserSummary | null;
  setChannelForm: (channelId: string, patch: Partial<ChannelFormState>) => void;
  refreshInstallations: (withLoading?: boolean) => Promise<void>;
  refreshChannels: (teamId: string) => Promise<void>;
  syncSlackUsers: (teamId: string, options?: SyncUsersOptions) => Promise<void>;
};

export function useSlackIntegrationState(): SlackIntegrationState {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [syncingChannels, setSyncingChannels] = useState(false);
  const [syncingUsers, setSyncingUsers] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isAdminView, setIsAdminView] = useState(false);
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

  const refreshInstallations = useCallback(async (withLoading = true) => {
    if (withLoading) setLoading(true);
    setError("");
    try {
      const me = await getPortalMe();
      const adminView = Boolean(me.user.isAdmin);
      const [statusPayload, preflightPayload, manifestPayload] = await Promise.all([
        fetchSlackStatus(),
        fetchSlackPreflight(),
        adminView ? fetchSlackManifest() : Promise.resolve(null),
      ]);
      setIsAdminView(adminView);
      setPortalUserId(me.user.id);
      setPortalUserEmail(String(me.user.email || "").trim().toLowerCase());
      setPreflight(preflightPayload);
      setManifestYaml(adminView ? String(manifestPayload?.yaml || "").trim() : "");
      const rows = Array.isArray(statusPayload.installations) ? statusPayload.installations : [];
      setInstallations(rows);
      setSelectedTeamId((current) => {
        if (current && rows.some((row) => row.slackTeamId === current)) return current;
        return rows[0]?.slackTeamId || "";
      });
    } catch (nextError: any) {
      setError(String(nextError?.message || "Failed to load Slack installation status."));
      setIsAdminView(false);
      setPreflight(null);
      setManifestYaml("");
      setInstallations([]);
      setSelectedTeamId("");
    } finally {
      if (withLoading) setLoading(false);
    }
  }, []);

  const refreshChannels = useCallback(async (teamId: string) => {
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

  const syncSlackUsers = useCallback(async (teamId: string, options?: SyncUsersOptions) => {
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
    void refreshInstallations(true);
  }, [refreshInstallations]);

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
    void refreshChannels(selectedTeamId);
    void syncSlackUsers(selectedTeamId);
  }, [refreshChannels, selectedTeamId, syncSlackUsers]);

  return {
    loading,
    setLoading,
    connecting,
    setConnecting,
    savingSettings,
    setSavingSettings,
    syncingChannels,
    setSyncingChannels,
    syncingUsers,
    setSyncingUsers,
    error,
    setError,
    statusMessage,
    setStatusMessage,
    isAdminView,
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
    refreshInstallations,
    refreshChannels,
    syncSlackUsers,
  };
}
