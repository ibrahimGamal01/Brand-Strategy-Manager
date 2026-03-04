import { WebClient } from '@slack/web-api';
import { prisma } from '../../lib/prisma';
import { getDecryptedSlackBotToken } from './slack-installation-repo';
import { ingestSlackHistoryMessage } from './slack-message-ingest';
import { upsertSlackChannel } from './slack-channel-service';

type BackfillJobPayload = {
  slackTeamId: string;
  slackChannelId: string;
  cursor?: string | null;
};

type ThreadBackfillJobPayload = {
  slackTeamId: string;
  slackChannelId: string;
  threadTs: string;
  cursor?: string | null;
};

export type SlackBackfillFollowUp = {
  type: 'SLACK_BACKFILL_CHANNEL' | 'SLACK_BACKFILL_THREAD' | 'SLACK_TRIAGE_MESSAGE';
  payload: Record<string, unknown>;
  runAt?: Date;
};

export class SlackRetryAfterError extends Error {
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'SlackRetryAfterError';
    this.retryAfterMs = retryAfterMs;
  }
}

function extractRetryAfterMs(error: any): number | null {
  const retryAfterRaw =
    Number(error?.data?.retryAfter) ||
    Number(error?.retryAfter) ||
    Number(error?.headers?.['retry-after']) ||
    Number(error?.response?.headers?.['retry-after']);
  if (!Number.isFinite(retryAfterRaw) || retryAfterRaw <= 0) return null;
  return Math.floor(retryAfterRaw * 1000);
}

async function getSlackClient(slackTeamId: string): Promise<WebClient> {
  const token = await getDecryptedSlackBotToken(slackTeamId);
  if (!token) {
    throw new Error(`Slack bot token not found for team ${slackTeamId}`);
  }
  return new WebClient(token);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function processSlackBackfillChannelJob(payload: BackfillJobPayload): Promise<{
  processedMessages: number;
  followUps: SlackBackfillFollowUp[];
}> {
  const link = await prisma.slackChannelLink.findUnique({
    where: {
      slackTeamId_slackChannelId: {
        slackTeamId: payload.slackTeamId,
        slackChannelId: payload.slackChannelId,
      },
    },
    select: {
      researchJobId: true,
      enabled: true,
    },
  });
  if (!link?.enabled) {
    return { processedMessages: 0, followUps: [] };
  }

  await prisma.slackChannelLink.update({
    where: {
      slackTeamId_slackChannelId: {
        slackTeamId: payload.slackTeamId,
        slackChannelId: payload.slackChannelId,
      },
    },
    data: { backfillState: 'RUNNING', backfillError: null },
  });

  const client = await getSlackClient(payload.slackTeamId);
  let history;
  try {
    history = await client.conversations.history({
      channel: payload.slackChannelId,
      limit: 200,
      cursor: payload.cursor || undefined,
      inclusive: true,
    });
  } catch (error: any) {
    const retryAfterMs = extractRetryAfterMs(error);
    if (retryAfterMs) {
      throw new SlackRetryAfterError('Slack rate limit hit while backfilling channel history.', retryAfterMs);
    }
    throw error;
  }

  const messages = Array.isArray(history.messages) ? history.messages : [];
  let processedMessages = 0;
  const followUps: SlackBackfillFollowUp[] = [];

  await upsertSlackChannel({
    slackTeamId: payload.slackTeamId,
    slackChannelId: payload.slackChannelId,
    name: payload.slackChannelId,
    isMember: true,
  });

  for (const row of messages.reverse()) {
    const item = asRecord(row);
    const message = await ingestSlackHistoryMessage({
      slackTeamId: payload.slackTeamId,
      slackChannelId: payload.slackChannelId,
      rawMessage: item,
      forceWorkspaceId: link.researchJobId,
    });
    if (!message) continue;
    processedMessages += 1;
    followUps.push({
      type: 'SLACK_TRIAGE_MESSAGE',
      payload: {
        slackMessageId: message.id,
      },
    });

    const replyCount = Number(item.reply_count || 0);
    const threadTs = String(item.thread_ts || '').trim();
    const ts = String(item.ts || '').trim();
    if (replyCount > 0 && threadTs && threadTs === ts) {
      followUps.push({
        type: 'SLACK_BACKFILL_THREAD',
        payload: {
          slackTeamId: payload.slackTeamId,
          slackChannelId: payload.slackChannelId,
          threadTs,
        },
      });
    }
  }

  const nextCursor = String(history.response_metadata?.next_cursor || '').trim();
  if (nextCursor) {
    followUps.push({
      type: 'SLACK_BACKFILL_CHANNEL',
      payload: {
        slackTeamId: payload.slackTeamId,
        slackChannelId: payload.slackChannelId,
        cursor: nextCursor,
      },
    });
  }

  await prisma.slackChannelLink.update({
    where: {
      slackTeamId_slackChannelId: {
        slackTeamId: payload.slackTeamId,
        slackChannelId: payload.slackChannelId,
      },
    },
    data: {
      backfillState: nextCursor ? 'RUNNING' : 'DONE',
      backfillCursor: nextCursor || null,
      lastBackfillAt: !nextCursor ? new Date() : undefined,
      backfillError: null,
    },
  });

  return { processedMessages, followUps };
}

export async function processSlackBackfillThreadJob(payload: ThreadBackfillJobPayload): Promise<{
  processedMessages: number;
  followUps: SlackBackfillFollowUp[];
}> {
  const link = await prisma.slackChannelLink.findUnique({
    where: {
      slackTeamId_slackChannelId: {
        slackTeamId: payload.slackTeamId,
        slackChannelId: payload.slackChannelId,
      },
    },
    select: { researchJobId: true, enabled: true },
  });
  if (!link?.enabled) return { processedMessages: 0, followUps: [] };

  const client = await getSlackClient(payload.slackTeamId);
  let replies;
  try {
    replies = await client.conversations.replies({
      channel: payload.slackChannelId,
      ts: payload.threadTs,
      cursor: payload.cursor || undefined,
      limit: 200,
      inclusive: true,
    });
  } catch (error: any) {
    const retryAfterMs = extractRetryAfterMs(error);
    if (retryAfterMs) {
      throw new SlackRetryAfterError('Slack rate limit hit while backfilling thread history.', retryAfterMs);
    }
    throw error;
  }

  const messages = Array.isArray(replies.messages) ? replies.messages : [];
  let processedMessages = 0;
  const followUps: SlackBackfillFollowUp[] = [];

  for (const row of messages.reverse()) {
    const item = asRecord(row);
    const message = await ingestSlackHistoryMessage({
      slackTeamId: payload.slackTeamId,
      slackChannelId: payload.slackChannelId,
      rawMessage: item,
      forceWorkspaceId: link.researchJobId,
    });
    if (!message) continue;
    processedMessages += 1;
    followUps.push({
      type: 'SLACK_TRIAGE_MESSAGE',
      payload: {
        slackMessageId: message.id,
      },
    });
  }

  const nextCursor = String(replies.response_metadata?.next_cursor || '').trim();
  if (nextCursor) {
    followUps.push({
      type: 'SLACK_BACKFILL_THREAD',
      payload: {
        slackTeamId: payload.slackTeamId,
        slackChannelId: payload.slackChannelId,
        threadTs: payload.threadTs,
        cursor: nextCursor,
      },
    });
  }

  return { processedMessages, followUps };
}
