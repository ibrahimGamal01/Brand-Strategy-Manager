"use client";

import { SlackSetupStepState } from "@/types/chat";
import { SlackIntegrationData } from "@/components/integrations/use-slack-integration-data";
import { SlackSetupStepCard } from "@/components/integrations/slack-setup-step-card";

type SlackSetupStepSettingsProps = {
  data: SlackIntegrationData;
  state: SlackSetupStepState;
  locked: boolean;
};

export function SlackSetupStepSettings({ data, state, locked }: SlackSetupStepSettingsProps) {
  return (
    <SlackSetupStepCard
      number={4}
      title="Save notifications + ingestion settings"
      detail="Configure owner delivery defaults and ingestion toggles."
      state={state}
      locked={locked}
    >
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Default notify channel
            <input
              value={data.defaultNotifyChannelId}
              onChange={(event) => data.setDefaultNotifyChannelId(event.target.value)}
              placeholder="C1234567890"
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            />
          </label>
          <label className="text-sm">
            Owner delivery mode
            <select
              value={data.settingsDraft.ownerDeliveryMode}
              onChange={(event) =>
                data.setSettingsDraft((current) => ({
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
              checked={data.settingsDraft.notifyInSlack}
              onChange={(event) =>
                data.setSettingsDraft((current) => ({
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
              checked={data.settingsDraft.notifyInBat}
              onChange={(event) =>
                data.setSettingsDraft((current) => ({
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
              checked={data.settingsDraft.dmIngestionEnabled}
              onChange={(event) =>
                data.setSettingsDraft((current) => ({
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
              checked={data.settingsDraft.mpimIngestionEnabled}
              onChange={(event) =>
                data.setSettingsDraft((current) => ({
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
          onClick={() => void data.saveSettings()}
          disabled={data.savingSettings || !data.selectedTeamId || locked}
          className="rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
          style={{ background: "var(--bat-accent)", color: "white" }}
        >
          {data.savingSettings ? "Saving..." : "Save Slack settings"}
        </button>
      </div>
    </SlackSetupStepCard>
  );
}

