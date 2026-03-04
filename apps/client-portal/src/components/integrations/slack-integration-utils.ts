"use client";

import {
  SlackChannelActionState,
  SlackChannelSummary,
  SlackInstallationSettings,
  SlackUserSummary,
} from "@/types/chat";
import { ChannelFormState } from "@/components/integrations/slack-integration-types";

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

