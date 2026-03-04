"use client";

import { SlackChannelSummary, SlackUserSummary } from "@/types/chat";
import {
  addSlackOwnerId,
  ChannelFormState,
  formatChannelType,
  formatSlackUserOption,
  parseOwnerSlackIds,
  removeSlackOwnerId,
  WorkspaceOption,
} from "@/components/integrations/use-slack-integration-data";

type SlackChannelCardProps = {
  channel: SlackChannelSummary;
  form: ChannelFormState;
  workspaces: WorkspaceOption[];
  slackUsers: SlackUserSummary[];
  mappedCurrentSlackUser: SlackUserSummary | null;
  onFormPatch: (patch: Partial<ChannelFormState>) => void;
  onLinkChannel: () => Promise<void>;
  onSaveOwners: () => Promise<void>;
  onRunBackfill: () => Promise<void>;
  onPurgeChannel?: () => Promise<void>;
  showPurge?: boolean;
};

export function SlackChannelCard({
  channel,
  form,
  workspaces,
  slackUsers,
  mappedCurrentSlackUser,
  onFormPatch,
  onLinkChannel,
  onSaveOwners,
  onRunBackfill,
  onPurgeChannel,
  showPurge = false,
}: SlackChannelCardProps) {
  const selectedOwnerIds = parseOwnerSlackIds(form.ownerSlackIds);
  const selectedOwnerUsers = selectedOwnerIds
    .map((slackUserId) => slackUsers.find((user) => user.slackUserId === slackUserId))
    .filter((user): user is SlackUserSummary => Boolean(user));

  return (
    <article className="bat-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-base font-semibold">
            #{channel.name}{" "}
            <span className="text-xs font-normal text-zinc-500">({formatChannelType(channel.conversationType)})</span>
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
            {channel.slackChannelId} • Backfill {channel.links[0]?.backfillState || "PENDING"}
          </p>
        </div>
        {channel.links[0]?.researchJobId ? <span className="bat-chip">Linked</span> : <span className="bat-chip">Unlinked</span>}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          Workspace link
          <select
            value={form.workspaceId}
            onChange={(event) =>
              onFormPatch({
                workspaceId: event.target.value,
                message: "",
                isError: false,
              })
            }
            className="mt-1 w-full rounded-xl border px-3 py-2"
            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
          >
            <option value="">Select workspace</option>
            {workspaces.map((workspace) => (
              <option key={`${channel.id}-${workspace.id}`} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm md:col-span-2">
          Owner Slack user IDs (comma separated)
          <input
            value={form.ownerSlackIds}
            onChange={(event) =>
              onFormPatch({
                ownerSlackIds: event.target.value,
                message: "",
                isError: false,
              })
            }
            placeholder="U0123ABC, U0456DEF"
            className="mt-1 w-full rounded-xl border px-3 py-2"
            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={form.ownerPickerSlackUserId}
              onChange={(event) => {
                const selectedSlackUserId = event.target.value;
                if (!selectedSlackUserId) return;
                onFormPatch({
                  ownerSlackIds: addSlackOwnerId(form.ownerSlackIds, selectedSlackUserId),
                  ownerPickerSlackUserId: "",
                  message: "",
                  isError: false,
                });
              }}
              className="rounded-xl border px-2 py-1.5 text-xs"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            >
              <option value="">Add owner from synced users...</option>
              {slackUsers.map((user) => (
                <option key={`${channel.id}-${user.slackUserId}`} value={user.slackUserId}>
                  {formatSlackUserOption(user)} — {user.slackUserId}
                </option>
              ))}
            </select>
            {mappedCurrentSlackUser ? (
              <button
                type="button"
                onClick={() =>
                  onFormPatch({
                    ownerSlackIds: addSlackOwnerId(form.ownerSlackIds, mappedCurrentSlackUser.slackUserId),
                    message: "",
                    isError: false,
                  })
                }
                className="rounded-full border px-2.5 py-1 text-xs"
                style={{ borderColor: "var(--bat-border)" }}
              >
                Add me
              </button>
            ) : null}
          </div>
          {selectedOwnerUsers.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedOwnerUsers.map((user) => (
                <span
                  key={`${channel.id}-${user.slackUserId}-pill`}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                  style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
                >
                  {formatSlackUserOption(user)}
                  <button
                    type="button"
                    onClick={() =>
                      onFormPatch({
                        ownerSlackIds: removeSlackOwnerId(form.ownerSlackIds, user.slackUserId),
                        message: "",
                        isError: false,
                      })
                    }
                    className="text-xs"
                    aria-label={`Remove ${user.slackUserId}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void onLinkChannel()}
          disabled={form.working}
          className="rounded-full border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-70"
          style={{ borderColor: "var(--bat-border)" }}
        >
          Link Channel
        </button>
        <button
          type="button"
          onClick={() => void onSaveOwners()}
          disabled={form.working}
          className="rounded-full border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-70"
          style={{ borderColor: "var(--bat-border)" }}
        >
          Save Owners
        </button>
        <button
          type="button"
          onClick={() => void onRunBackfill()}
          disabled={form.working}
          className="rounded-full border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-70"
          style={{ borderColor: "var(--bat-border)" }}
        >
          Run Full Backfill
        </button>
        {showPurge && onPurgeChannel ? (
          <button
            type="button"
            onClick={() => void onPurgeChannel()}
            disabled={form.working}
            className="rounded-full border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-70"
            style={{ borderColor: "#f4b8b4", color: "#9f2317" }}
          >
            Purge Channel Data
          </button>
        ) : null}
      </div>
      {form.message ? (
        <p
          className="mt-2 rounded-xl border px-3 py-2 text-xs"
          style={
            form.isError
              ? { borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }
              : { borderColor: "#b8e2c9", background: "#f0fbf4", color: "#166534" }
          }
        >
          {form.message}
        </p>
      ) : null}
    </article>
  );
}

