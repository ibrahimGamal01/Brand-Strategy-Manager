import { prisma } from '../../lib/prisma';
import { decryptSlackSecret, encryptSlackSecret } from './slack-crypto';

export type SlackInstallationSettings = {
  dmIngestionEnabled: boolean;
  mpimIngestionEnabled: boolean;
  notifyInSlack: boolean;
  notifyInBat: boolean;
  ownerDeliveryMode: 'dm' | 'channel' | 'both';
};

const DEFAULT_SETTINGS: SlackInstallationSettings = {
  dmIngestionEnabled: false,
  mpimIngestionEnabled: false,
  notifyInSlack: true,
  notifyInBat: true,
  ownerDeliveryMode: 'dm',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

export function parseSlackInstallationSettings(raw: unknown): SlackInstallationSettings {
  const value = isRecord(raw) ? raw : {};
  const ownerDeliveryModeRaw = String(value.ownerDeliveryMode || '').trim().toLowerCase();
  const ownerDeliveryMode: SlackInstallationSettings['ownerDeliveryMode'] =
    ownerDeliveryModeRaw === 'channel' || ownerDeliveryModeRaw === 'both'
      ? ownerDeliveryModeRaw
      : DEFAULT_SETTINGS.ownerDeliveryMode;
  return {
    dmIngestionEnabled: parseBool(value.dmIngestionEnabled, DEFAULT_SETTINGS.dmIngestionEnabled),
    mpimIngestionEnabled: parseBool(value.mpimIngestionEnabled, DEFAULT_SETTINGS.mpimIngestionEnabled),
    notifyInSlack: parseBool(value.notifyInSlack, DEFAULT_SETTINGS.notifyInSlack),
    notifyInBat: parseBool(value.notifyInBat, DEFAULT_SETTINGS.notifyInBat),
    ownerDeliveryMode,
  };
}

export async function upsertSlackInstallationFromOAuth(input: {
  slackTeamId: string;
  enterpriseId?: string | null;
  teamName?: string | null;
  botUserId: string;
  botToken: string;
  botScopes?: string[];
  installedBySlackUserId: string;
  installedByPortalUserId?: string | null;
}) {
  const botScopes = Array.isArray(input.botScopes)
    ? Array.from(
        new Set(
          input.botScopes
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
        )
      ).slice(0, 80)
    : [];

  const encrypted = encryptSlackSecret(input.botToken);
  return prisma.slackInstallation.upsert({
    where: { slackTeamId: input.slackTeamId },
    create: {
      slackTeamId: input.slackTeamId,
      enterpriseId: input.enterpriseId || null,
      teamName: input.teamName || null,
      botUserId: input.botUserId,
      botTokenEnc: encrypted,
      botScopes,
      installedBySlackUserId: input.installedBySlackUserId,
      installedByPortalUserId: input.installedByPortalUserId || null,
      status: 'ACTIVE',
      settingsJson: DEFAULT_SETTINGS as any,
    },
    update: {
      enterpriseId: input.enterpriseId || null,
      teamName: input.teamName || null,
      botUserId: input.botUserId,
      botTokenEnc: encrypted,
      botScopes,
      installedBySlackUserId: input.installedBySlackUserId,
      installedByPortalUserId: input.installedByPortalUserId || null,
      status: 'ACTIVE',
    },
  });
}

export async function getSlackInstallationByTeam(slackTeamId: string) {
  const value = String(slackTeamId || '').trim();
  if (!value) return null;
  return prisma.slackInstallation.findUnique({ where: { slackTeamId: value } });
}

export async function listActiveSlackInstallations() {
  return prisma.slackInstallation.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getDecryptedSlackBotToken(slackTeamId: string): Promise<string | null> {
  const installation = await getSlackInstallationByTeam(slackTeamId);
  if (!installation || installation.status !== 'ACTIVE') return null;
  return decryptSlackSecret(installation.botTokenEnc);
}

export async function patchSlackInstallationSettings(input: {
  slackTeamId: string;
  defaultNotifyChannelId?: string | null;
  settingsPatch?: Partial<SlackInstallationSettings>;
}) {
  const installation = await getSlackInstallationByTeam(input.slackTeamId);
  if (!installation) {
    throw new Error(`Slack installation not found for team ${input.slackTeamId}`);
  }

  const current = parseSlackInstallationSettings(installation.settingsJson);
  const next: SlackInstallationSettings = {
    ...current,
    ...(input.settingsPatch || {}),
  };

  return prisma.slackInstallation.update({
    where: { slackTeamId: input.slackTeamId },
    data: {
      ...(typeof input.defaultNotifyChannelId !== 'undefined'
        ? { defaultNotifyChannelId: input.defaultNotifyChannelId || null }
        : {}),
      settingsJson: next as any,
    },
  });
}

export async function upsertSlackUserLink(input: {
  slackTeamId: string;
  slackUserId: string;
  portalUserId?: string | null;
  email?: string | null;
  displayName?: string | null;
}) {
  return prisma.slackUserLink.upsert({
    where: {
      slackTeamId_slackUserId: {
        slackTeamId: input.slackTeamId,
        slackUserId: input.slackUserId,
      },
    },
    create: {
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
      portalUserId: input.portalUserId || null,
      email: input.email || null,
      displayName: input.displayName || null,
    },
    update: {
      ...(typeof input.portalUserId !== 'undefined' ? { portalUserId: input.portalUserId || null } : {}),
      ...(typeof input.email !== 'undefined' ? { email: input.email || null } : {}),
      ...(typeof input.displayName !== 'undefined' ? { displayName: input.displayName || null } : {}),
    },
  });
}

export async function findPortalUserBySlackUser(input: {
  slackTeamId: string;
  slackUserId: string;
}): Promise<string | null> {
  const row = await prisma.slackUserLink.findUnique({
    where: {
      slackTeamId_slackUserId: {
        slackTeamId: input.slackTeamId,
        slackUserId: input.slackUserId,
      },
    },
    select: { portalUserId: true },
  });
  return row?.portalUserId || null;
}
