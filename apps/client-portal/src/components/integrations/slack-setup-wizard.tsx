"use client";

import { SlackSetupStepState } from "@/types/chat";
import { useSlackIntegrationData } from "@/components/integrations/use-slack-integration-data";
import { SlackSetupStepChannels } from "@/components/integrations/slack-setup-step-channels";
import { SlackSetupStepConnect } from "@/components/integrations/slack-setup-step-connect";
import { SlackSetupStepSettings } from "@/components/integrations/slack-setup-step-settings";
import { SlackSetupStepUsers } from "@/components/integrations/slack-setup-step-users";

function resolveStepStates(data: ReturnType<typeof useSlackIntegrationData>) {
  const hasConnectedTeam = data.installations.length > 0 && Boolean(data.selectedTeamId);

  const usersStepState: SlackSetupStepState = !hasConnectedTeam
    ? "locked"
    : data.slackUsers.length > 0
      ? "done"
      : "in_progress";

  const channelsStepDone =
    hasConnectedTeam &&
    data.channels.length > 0 &&
    data.groups.needsLink.length === 0 &&
    data.groups.needsOwners.length === 0 &&
    data.groups.needsBackfill.length === 0;

  const channelsStepState: SlackSetupStepState = !hasConnectedTeam
    ? "locked"
    : channelsStepDone
      ? "done"
      : "in_progress";

  const connectStepState: SlackSetupStepState = hasConnectedTeam ? "done" : "in_progress";
  const settingsStepState: SlackSetupStepState = !hasConnectedTeam ? "locked" : "todo";

  return {
    hasConnectedTeam,
    connectStepState,
    usersStepState,
    channelsStepState,
    settingsStepState,
  };
}

export function SlackSetupWizard() {
  const data = useSlackIntegrationData();
  const states = resolveStepStates(data);

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Guided Setup</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Slack integration wizard</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Follow the steps in order. BAT keeps all Slack data until manually purged, and reply drafts always require owner approval.
        </p>
      </div>

      {data.statusMessage ? (
        <article className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#b8e2c9", background: "#f0fbf4", color: "#166534" }}>
          {data.statusMessage}
        </article>
      ) : null}

      {data.error ? (
        <article className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
          {data.error} Try refresh, sync users again, or check Slack setup status.
        </article>
      ) : null}

      <SlackSetupStepConnect data={data} state={states.connectStepState} />
      <SlackSetupStepUsers
        data={data}
        state={states.usersStepState}
        locked={!states.hasConnectedTeam}
      />
      <SlackSetupStepChannels
        data={data}
        state={states.channelsStepState}
        locked={!states.hasConnectedTeam}
      />
      <SlackSetupStepSettings
        data={data}
        state={states.settingsStepState}
        locked={!states.hasConnectedTeam}
      />
    </section>
  );
}
