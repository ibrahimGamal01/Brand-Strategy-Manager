import { prisma } from '../../lib/prisma';
import { resolveWorkspaceForSlackChannel, upsertSlackChannel } from './slack-channel-service';

const SENSITIVE_PATTERN =
  /(xox[baprs]-[A-Za-z0-9-]+|sk-[A-Za-z0-9\-_]{20,}|bearer\s+[A-Za-z0-9\-_]+|api[_-]?key[:=]\s*\S+)/gi;

function tsToDate(value: string | null | undefined): Date {
  const ts = String(value || '').trim();
  if (!ts) return new Date();
  const [seconds, micros = '0'] = ts.split('.');
  const ms = Number(seconds) * 1000 + Math.floor(Number(`0.${micros}`) * 1000);
  if (!Number.isFinite(ms)) return new Date();
  return new Date(ms);
}

function sanitizeSlackText(value: unknown): string {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.replace(SENSITIVE_PATTERN, '[redacted]');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export type UpsertSlackMessageInput = {
  slackTeamId: string;
  slackChannelId: string;
  slackTs: string;
  threadTs?: string | null;
  slackUserId?: string | null;
  text?: string | null;
  permalink?: string | null;
  messageCreatedAt?: Date;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  rawJson?: Record<string, unknown> | null;
  forceWorkspaceId?: string | null;
};

export async function upsertSlackMessage(input: UpsertSlackMessageInput) {
  const researchJobId =
    typeof input.forceWorkspaceId === 'string'
      ? input.forceWorkspaceId || null
      : await resolveWorkspaceForSlackChannel({
          slackTeamId: input.slackTeamId,
          slackChannelId: input.slackChannelId,
        });

  const text = sanitizeSlackText(input.text || '');
  const messageCreatedAt = input.messageCreatedAt || tsToDate(input.slackTs);
  const record = await prisma.slackMessage.upsert({
    where: {
      slackTeamId_slackChannelId_slackTs: {
        slackTeamId: input.slackTeamId,
        slackChannelId: input.slackChannelId,
        slackTs: input.slackTs,
      },
    },
    create: {
      slackTeamId: input.slackTeamId,
      slackChannelId: input.slackChannelId,
      slackTs: input.slackTs,
      threadTs: input.threadTs || null,
      researchJobId,
      slackUserId: input.slackUserId || null,
      text,
      rawJson: (input.rawJson || null) as any,
      permalink: input.permalink || null,
      messageCreatedAt,
      editedAt: input.editedAt || null,
      deletedAt: input.deletedAt || null,
    },
    update: {
      threadTs: input.threadTs || null,
      researchJobId,
      slackUserId: input.slackUserId || null,
      text,
      rawJson: (input.rawJson || null) as any,
      ...(typeof input.permalink !== 'undefined' ? { permalink: input.permalink || null } : {}),
      messageCreatedAt,
      editedAt: input.editedAt || null,
      ...(typeof input.deletedAt !== 'undefined' ? { deletedAt: input.deletedAt || null } : {}),
    },
  });

  return record;
}

function deriveMessagePayload(rawEvent: Record<string, unknown>) {
  const subtype = String(rawEvent.subtype || '').trim().toLowerCase();
  if (subtype === 'message_deleted') {
    return {
      subtype,
      channelId: String(rawEvent.channel || '').trim(),
      messageTs: String(rawEvent.deleted_ts || '').trim(),
      userId: null as string | null,
      text: '',
      threadTs: null as string | null,
      editedAt: null as Date | null,
      deletedAt: new Date(),
      raw: rawEvent,
    };
  }

  if (subtype === 'message_changed') {
    const changed = asRecord(rawEvent.message);
    const messageTs = String(changed.ts || rawEvent.ts || '').trim();
    return {
      subtype,
      channelId: String(rawEvent.channel || '').trim(),
      messageTs,
      userId: String(changed.user || rawEvent.user || '').trim() || null,
      text: String(changed.text || '').trim(),
      threadTs: String(changed.thread_ts || changed.ts || '').trim() || null,
      editedAt: changed.edited ? tsToDate(String((changed.edited as any).ts || messageTs)) : new Date(),
      deletedAt: null as Date | null,
      raw: rawEvent,
    };
  }

  return {
    subtype,
    channelId: String(rawEvent.channel || '').trim(),
    messageTs: String(rawEvent.ts || '').trim(),
    userId: String(rawEvent.user || '').trim() || null,
    text: String(rawEvent.text || '').trim(),
    threadTs: String(rawEvent.thread_ts || rawEvent.ts || '').trim() || null,
    editedAt: null as Date | null,
    deletedAt: null as Date | null,
    raw: rawEvent,
  };
}

export async function ingestSlackMessageEvent(input: {
  slackTeamId: string;
  rawEvent: Record<string, unknown>;
}) {
  const payload = deriveMessagePayload(input.rawEvent);
  if (!payload.channelId || !payload.messageTs) {
    return { message: null, shouldTriage: false };
  }

  await upsertSlackChannel({
    slackTeamId: input.slackTeamId,
    slackChannelId: payload.channelId,
    name: payload.channelId,
    conversationType: String(input.rawEvent.channel_type || '').trim() || undefined,
    isMember: true,
  });

  const message = await upsertSlackMessage({
    slackTeamId: input.slackTeamId,
    slackChannelId: payload.channelId,
    slackTs: payload.messageTs,
    threadTs: payload.threadTs,
    slackUserId: payload.userId,
    text: payload.text,
    editedAt: payload.editedAt,
    deletedAt: payload.deletedAt,
    rawJson: payload.raw,
    messageCreatedAt: tsToDate(payload.messageTs),
  });

  const shouldTriage =
    !payload.subtype ||
    payload.subtype === 'message_changed' ||
    payload.subtype === 'thread_broadcast' ||
    payload.subtype === 'file_share';

  return { message, shouldTriage };
}

export async function ingestSlackHistoryMessage(input: {
  slackTeamId: string;
  slackChannelId: string;
  rawMessage: Record<string, unknown>;
  forceWorkspaceId?: string | null;
}) {
  const ts = String(input.rawMessage.ts || '').trim();
  if (!ts) return null;

  const subtype = String(input.rawMessage.subtype || '').trim().toLowerCase();
  const isDeleted = subtype === 'message_deleted';
  const message = await upsertSlackMessage({
    slackTeamId: input.slackTeamId,
    slackChannelId: input.slackChannelId,
    slackTs: ts,
    threadTs: String(input.rawMessage.thread_ts || ts).trim() || null,
    slackUserId: String(input.rawMessage.user || '').trim() || null,
    text: String(input.rawMessage.text || '').trim(),
    editedAt: input.rawMessage.edited ? tsToDate(String((input.rawMessage.edited as any).ts || ts)) : null,
    deletedAt: isDeleted ? new Date() : null,
    rawJson: input.rawMessage,
    messageCreatedAt: tsToDate(ts),
    forceWorkspaceId: input.forceWorkspaceId || null,
  });
  return message;
}
