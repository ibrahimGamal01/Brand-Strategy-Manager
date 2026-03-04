"use client";

import { SlackSetupStepState } from "@/types/chat";
import { SlackIntegrationData } from "@/components/integrations/use-slack-integration-data";
import { SlackSetupStepCard } from "@/components/integrations/slack-setup-step-card";

type SlackSetupStepUsersProps = {
  data: SlackIntegrationData;
  state: SlackSetupStepState;
  locked: boolean;
};

export function SlackSetupStepUsers({ data, state, locked }: SlackSetupStepUsersProps) {
  return (
    <SlackSetupStepCard
      number={2}
      title="Pick team + sync users"
      detail="Select your Slack team and pull user directory data for owner mapping."
      state={state}
      locked={locked}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Slack team
            <select
              value={data.selectedTeamId}
              onChange={(event) => data.setSelectedTeamId(event.target.value)}
              disabled={locked}
              className="ml-2 rounded-xl border px-3 py-2 text-sm disabled:cursor-not-allowed"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            >
              {!data.installations.length ? <option value="">No connected team</option> : null}
              {data.installations.map((installation) => (
                <option key={installation.slackTeamId} value={installation.slackTeamId}>
                  {installation.teamName || installation.slackTeamId}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void data.syncSlackUsers(data.selectedTeamId, { sync: true })}
            disabled={!data.selectedTeamId || data.syncingUsers}
            className="rounded-full border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            style={{ borderColor: "var(--bat-border)" }}
          >
            {data.syncingUsers ? "Syncing..." : "Sync Slack users"}
          </button>
          <span className="rounded-full border px-3 py-2 text-xs" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
            {data.slackUsers.length} users cached
          </span>
        </div>
      </div>
    </SlackSetupStepCard>
  );
}

