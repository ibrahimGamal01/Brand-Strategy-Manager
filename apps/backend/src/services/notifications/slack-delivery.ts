import { WebClient } from '@slack/web-api';
import { NotificationDeliveryDestination, NotificationDeliveryStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getDecryptedSlackBotToken } from '../slack/slack-installation-repo';

async function withSlackClient(slackTeamId: string): Promise<WebClient | null> {
  const token = await getDecryptedSlackBotToken(slackTeamId);
  if (!token) return null;
  return new WebClient(token);
}

async function recordDelivery(input: {
  notificationId: string;
  destination: NotificationDeliveryDestination;
  status: NotificationDeliveryStatus;
  slackTeamId?: string | null;
  slackChannelId?: string | null;
  slackUserId?: string | null;
  slackMessageTs?: string | null;
  error?: string | null;
}) {
  await prisma.notificationDelivery.create({
    data: {
      notificationId: input.notificationId,
      destination: input.destination,
      status: input.status,
      slackTeamId: input.slackTeamId || null,
      slackChannelId: input.slackChannelId || null,
      slackUserId: input.slackUserId || null,
      slackMessageTs: input.slackMessageTs || null,
      error: input.error || null,
      sentAt: input.status === 'SENT' ? new Date() : null,
    },
  });
}

function buildAttentionBlocks(input: {
  title: string;
  body: string;
  attentionItemId?: string;
  dueAtLabel?: string | null;
}) {
  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${input.title}*\n${input.body}`,
      },
    },
  ];
  if (input.dueAtLabel) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Due: ${input.dueAtLabel}` }],
    });
  }
  if (input.attentionItemId) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve & Send' },
          style: 'primary',
          action_id: 'attention_approve',
          value: input.attentionItemId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Edit + Send' },
          action_id: 'attention_edit',
          value: input.attentionItemId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Snooze' },
          action_id: 'attention_snooze',
          value: input.attentionItemId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss' },
          style: 'danger',
          action_id: 'attention_dismiss',
          value: input.attentionItemId,
        },
      ],
    });
  }
  return blocks;
}

export async function deliverNotificationToSlackDm(input: {
  notificationId: string;
  slackTeamId: string;
  slackUserId: string;
  title: string;
  body: string;
  attentionItemId?: string;
  dueAtLabel?: string | null;
}) {
  const client = await withSlackClient(input.slackTeamId);
  if (!client) {
    await recordDelivery({
      notificationId: input.notificationId,
      destination: 'SLACK_DM',
      status: 'FAILED',
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
      error: 'Slack client not configured for team.',
    });
    return;
  }

  try {
    const dm = await client.conversations.open({ users: input.slackUserId });
    const channelId = String(dm.channel?.id || '').trim();
    if (!channelId) throw new Error('Failed to resolve DM channel.');
    const message = await client.chat.postMessage({
      channel: channelId,
      text: `${input.title} - ${input.body}`,
      blocks: buildAttentionBlocks({
        title: input.title,
        body: input.body,
        attentionItemId: input.attentionItemId,
        dueAtLabel: input.dueAtLabel || null,
      }),
    });
    await recordDelivery({
      notificationId: input.notificationId,
      destination: 'SLACK_DM',
      status: 'SENT',
      slackTeamId: input.slackTeamId,
      slackChannelId: channelId,
      slackUserId: input.slackUserId,
      slackMessageTs: String(message.ts || ''),
    });
  } catch (error: any) {
    await recordDelivery({
      notificationId: input.notificationId,
      destination: 'SLACK_DM',
      status: 'FAILED',
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
      error: String(error?.message || error),
    });
  }
}

export async function deliverNotificationToSlackChannel(input: {
  notificationId: string;
  slackTeamId: string;
  slackChannelId: string;
  title: string;
  body: string;
  attentionItemId?: string;
  dueAtLabel?: string | null;
}) {
  const client = await withSlackClient(input.slackTeamId);
  if (!client) {
    await recordDelivery({
      notificationId: input.notificationId,
      destination: 'SLACK_CHANNEL',
      status: 'FAILED',
      slackTeamId: input.slackTeamId,
      slackChannelId: input.slackChannelId,
      error: 'Slack client not configured for team.',
    });
    return;
  }

  try {
    const message = await client.chat.postMessage({
      channel: input.slackChannelId,
      text: `${input.title} - ${input.body}`,
      blocks: buildAttentionBlocks({
        title: input.title,
        body: input.body,
        attentionItemId: input.attentionItemId,
        dueAtLabel: input.dueAtLabel || null,
      }),
    });
    await recordDelivery({
      notificationId: input.notificationId,
      destination: 'SLACK_CHANNEL',
      status: 'SENT',
      slackTeamId: input.slackTeamId,
      slackChannelId: input.slackChannelId,
      slackMessageTs: String(message.ts || ''),
    });
  } catch (error: any) {
    await recordDelivery({
      notificationId: input.notificationId,
      destination: 'SLACK_CHANNEL',
      status: 'FAILED',
      slackTeamId: input.slackTeamId,
      slackChannelId: input.slackChannelId,
      error: String(error?.message || error),
    });
  }
}

export async function postSlackReplyForAttention(input: {
  slackTeamId: string;
  slackChannelId: string;
  messageTs?: string | null;
  threadTs?: string | null;
  text: string;
}) {
  const client = await withSlackClient(input.slackTeamId);
  if (!client) {
    throw new Error('Slack client not configured for team.');
  }

  const threadTs = input.threadTs || input.messageTs || undefined;
  return client.chat.postMessage({
    channel: input.slackChannelId,
    text: input.text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
}
