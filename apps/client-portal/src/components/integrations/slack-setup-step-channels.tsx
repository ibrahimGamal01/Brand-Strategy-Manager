"use client";

import { SlackChannelCard } from "@/components/integrations/slack-channel-card";
import { SlackSetupStepState } from "@/types/chat";
import {
  createDefaultChannelForm,
  SlackIntegrationData,
} from "@/components/integrations/use-slack-integration-data";
import { SlackSetupStepCard } from "@/components/integrations/slack-setup-step-card";

type SlackSetupStepChannelsProps = {
  data: SlackIntegrationData;
  state: SlackSetupStepState;
  locked: boolean;
};

function renderChannelList(
  data: SlackIntegrationData,
  title: string,
  channels: SlackIntegrationData["channels"]
) {
  if (!channels.length) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {channels.map((channel) => {
        const form = data.channelForms[channel.slackChannelId] || createDefaultChannelForm(channel);
        return (
          <SlackChannelCard
            key={channel.id}
            channel={channel}
            form={form}
            workspaces={data.workspaces}
            slackUsers={data.slackUsers}
            mappedCurrentSlackUser={data.mappedCurrentSlackUser}
            onFormPatch={(patch) => data.setChannelForm(channel.slackChannelId, patch)}
            onLinkChannel={() => data.linkChannelToWorkspace(channel)}
            onSaveOwners={() => data.assignOwners(channel)}
            onRunBackfill={() => data.runBackfill(channel)}
          />
        );
      })}
    </div>
  );
}

export function SlackSetupStepChannels({ data, state, locked }: SlackSetupStepChannelsProps) {
  return (
    <SlackSetupStepCard
      number={3}
      title="Link channels + owners + backfill"
      detail="Each channel must be linked to a workspace, have at least one owner, and complete backfill."
      state={state}
      locked={locked}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void data.refreshChannels(data.selectedTeamId)}
            disabled={!data.selectedTeamId || data.syncingChannels}
            className="rounded-full border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            style={{ borderColor: "var(--bat-border)" }}
          >
            {data.syncingChannels ? "Syncing channels..." : "Refresh channels"}
          </button>
          <span className="rounded-full border px-3 py-1.5 text-xs" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
            {data.channels.length} channels visible
          </span>
        </div>

        {data.loading ? (
          <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Loading channels...
          </p>
        ) : null}

        {!data.loading && !data.channels.length ? (
          <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
            No channels are visible yet. Invite the bot to channels, then refresh.
          </p>
        ) : null}

        {renderChannelList(data, "Needs workspace link", data.groups.needsLink)}
        {renderChannelList(data, "Needs owners", data.groups.needsOwners)}
        {renderChannelList(data, "Needs backfill", data.groups.needsBackfill)}
        {renderChannelList(data, "Configured", data.groups.ready)}
      </div>
    </SlackSetupStepCard>
  );
}
