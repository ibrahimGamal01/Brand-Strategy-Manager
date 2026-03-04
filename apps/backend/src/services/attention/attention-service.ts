import { AgentRunStatus, AttentionItemType, NotificationKind, NotificationSeverity } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { runAttentionTriageAi } from './attention-triage-ai';
import { createAttentionNotifications, createWaitingInputNotifications } from '../notifications/notification-service';
import { postSlackReplyForAttention } from '../notifications/slack-delivery';

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toAttentionType(raw: string): AttentionItemType {
  const normalized = String(raw || '').trim().toUpperCase();
  if (normalized === 'DEADLINE') return AttentionItemType.DEADLINE;
  if (normalized === 'FEEDBACK_REQUEST') return AttentionItemType.FEEDBACK_REQUEST;
  return AttentionItemType.NEEDS_REPLY;
}

function toNotificationKind(type: AttentionItemType): NotificationKind {
  if (type === AttentionItemType.DEADLINE) return NotificationKind.DEADLINE_REMINDER;
  if (type === AttentionItemType.FEEDBACK_REQUEST) return NotificationKind.SLACK_ATTENTION;
  return NotificationKind.SLACK_DRAFT_READY;
}

function toNotificationSeverity(raw: string): NotificationSeverity {
  const normalized = String(raw || '').trim().toUpperCase();
  if (normalized === 'URGENT') return NotificationSeverity.URGENT;
  if (normalized === 'WARN') return NotificationSeverity.WARN;
  return NotificationSeverity.INFO;
}

async function resolveDefaultAssignee(input: {
  slackTeamId: string;
  slackChannelId: string;
}): Promise<{ slackUserId?: string | null; portalUserId?: string | null }> {
  const owner = await prisma.slackChannelOwner.findFirst({
    where: {
      slackTeamId: input.slackTeamId,
      slackChannelId: input.slackChannelId,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      slackUserId: true,
      portalUserId: true,
    },
  });
  return {
    slackUserId: owner?.slackUserId || null,
    portalUserId: owner?.portalUserId || null,
  };
}

export async function processSlackMessageForAttention(input: { slackMessageId: string }) {
  const message = await prisma.slackMessage.findUnique({
    where: { id: input.slackMessageId },
    include: {
      channel: true,
      researchJob: {
        select: {
          id: true,
          client: { select: { name: true } },
        },
      },
    },
  });
  if (!message || !message.researchJobId || message.deletedAt) {
    return { created: false, reason: 'Message missing, unlinked, or deleted.' };
  }

  const threadMessages = await prisma.slackMessage.findMany({
    where: {
      slackTeamId: message.slackTeamId,
      slackChannelId: message.slackChannelId,
      threadTs: message.threadTs || message.slackTs,
    },
    orderBy: { messageCreatedAt: 'asc' },
    take: 12,
    select: { text: true },
  });
  const threadContext = threadMessages.map((row) => row.text).filter(Boolean);

  const triage = await runAttentionTriageAi({
    workspaceLabel: message.researchJob?.client?.name || message.researchJobId,
    channelLabel: message.channel.name || message.slackChannelId,
    messageText: message.text,
    threadContext,
  });

  if (!triage.shouldCreate) {
    return { created: false, reason: triage.reason };
  }

  const assignee = await resolveDefaultAssignee({
    slackTeamId: message.slackTeamId,
    slackChannelId: message.slackChannelId,
  });
  const dueAt = toDateOrNull(triage.dueAtIso || null);
  const type = toAttentionType(triage.type);
  const severity = toNotificationSeverity(triage.severity);

  const existing = await prisma.attentionItem.findFirst({
    where: {
      slackMessageId: message.id,
      status: { in: ['OPEN', 'SNOOZED'] },
    },
    select: { id: true },
  });

  const attention = existing?.id
    ? await prisma.attentionItem.update({
        where: { id: existing.id },
        data: {
          type,
          summary: triage.summary,
          dueAt,
          draftReply: triage.draftReply || null,
          status: 'OPEN',
          assignedSlackUserId: assignee.slackUserId || null,
          assignedPortalUserId: assignee.portalUserId || null,
          metadataJson: {
            triageReason: triage.reason,
            confidence: triage.confidence,
            source: 'slack-triage',
          } as any,
        },
      })
    : await prisma.attentionItem.create({
        data: {
          researchJobId: message.researchJobId,
          slackTeamId: message.slackTeamId,
          slackChannelId: message.slackChannelId,
          slackMessageId: message.id,
          slackMessageTs: message.slackTs,
          threadTs: message.threadTs || null,
          type,
          summary: triage.summary,
          dueAt,
          draftReply: triage.draftReply || null,
          assignedSlackUserId: assignee.slackUserId || null,
          assignedPortalUserId: assignee.portalUserId || null,
          metadataJson: {
            triageReason: triage.reason,
            confidence: triage.confidence,
            source: 'slack-triage',
          } as any,
        },
      });

  await createAttentionNotifications({
    attentionItemId: attention.id,
    title: `Slack ${type.toLowerCase().replace(/_/g, ' ')}`,
    body: triage.summary,
    severity,
    kind: toNotificationKind(type),
  });

  return { created: true, attentionId: attention.id };
}

export async function processSlackTriageJob(payload: Record<string, unknown>) {
  const slackMessageId = String(payload.slackMessageId || '').trim();
  if (!slackMessageId) return { ok: false, reason: 'Missing slackMessageId.' };
  const result = await processSlackMessageForAttention({ slackMessageId });
  return { ok: true, ...result };
}

export async function approveAttentionItemAndReply(input: {
  attentionItemId: string;
  actorSlackUserId?: string;
  overrideReplyText?: string | null;
}) {
  const attention = await prisma.attentionItem.findUnique({
    where: { id: input.attentionItemId },
    include: {
      channel: true,
      slackMessage: true,
    },
  });
  if (!attention) {
    throw new Error('Attention item not found.');
  }

  const owners = await prisma.slackChannelOwner.findMany({
    where: {
      slackTeamId: attention.slackTeamId,
      slackChannelId: attention.slackChannelId,
    },
    select: { slackUserId: true },
  });
  const ownerSet = new Set(owners.map((owner) => owner.slackUserId));
  if (ownerSet.size === 0) {
    throw new Error('No channel owners are configured for this Slack channel.');
  }
  if (!input.actorSlackUserId || !ownerSet.has(input.actorSlackUserId)) {
    throw new Error('Only configured channel owners can approve replies.');
  }

  const replyText =
    String(input.overrideReplyText || '').trim() ||
    String(attention.draftReply || '').trim() ||
    'Thanks for the message. We have this in progress and will share an update shortly.';
  const response = await postSlackReplyForAttention({
    slackTeamId: attention.slackTeamId,
    slackChannelId: attention.slackChannelId,
    messageTs: attention.slackMessageTs,
    threadTs: attention.threadTs,
    text: replyText,
  });

  await prisma.attentionItem.update({
    where: { id: attention.id },
    data: {
      status: 'DONE',
      draftReply: replyText,
      metadataJson: {
        ...(attention.metadataJson as any || {}),
        approvedBySlackUserId: input.actorSlackUserId || null,
        approvedAt: new Date().toISOString(),
        postedMessageTs: String(response.ts || ''),
      } as any,
    },
  });

  return { postedMessageTs: String(response.ts || '') };
}

export async function snoozeAttentionItem(input: { attentionItemId: string; hours?: number }) {
  const hours = Number.isFinite(Number(input.hours)) ? Math.max(1, Math.min(72, Number(input.hours))) : 4;
  return prisma.attentionItem.update({
    where: { id: input.attentionItemId },
    data: {
      status: 'SNOOZED',
      dueAt: new Date(Date.now() + hours * 60 * 60 * 1000),
    },
  });
}

export async function dismissAttentionItem(input: { attentionItemId: string }) {
  return prisma.attentionItem.update({
    where: { id: input.attentionItemId },
    data: { status: 'DISMISSED' },
  });
}

export async function runAttentionReminderScan() {
  const now = new Date();
  const dueSoon = new Date(now.getTime() + 60 * 60 * 1000);
  const staleNotifyCutoff = new Date(now.getTime() - 30 * 60 * 1000);
  const items = await prisma.attentionItem.findMany({
    where: {
      status: { in: ['OPEN', 'SNOOZED'] },
      dueAt: { lte: dueSoon },
      OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: staleNotifyCutoff } }],
    },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    take: 80,
  });

  let reminded = 0;
  for (const item of items) {
    await createAttentionNotifications({
      attentionItemId: item.id,
      title: 'Deadline reminder',
      body: item.summary,
      severity: item.type === 'DEADLINE' ? 'URGENT' : 'WARN',
      kind: 'DEADLINE_REMINDER',
    });
    reminded += 1;
  }
  return { reminded };
}

export async function runWaitingInputScan() {
  const staleCutoff = new Date(Date.now() - 45 * 60 * 1000);
  const waitingRuns = await prisma.agentRun.findMany({
    where: {
      status: AgentRunStatus.WAITING_USER,
      createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      branch: { thread: { archivedAt: null } },
    },
    select: {
      id: true,
      branch: {
        select: {
          thread: {
            select: {
              researchJobId: true,
            },
          },
        },
      },
    },
    take: 120,
    orderBy: { createdAt: 'desc' },
  });

  const workspaceIds = Array.from(
    new Set(
      waitingRuns
        .map((run) => run.branch.thread.researchJobId)
        .filter(Boolean)
    )
  );

  let notified = 0;
  for (const workspaceId of workspaceIds) {
    const existing = await prisma.notification.findFirst({
      where: {
        researchJobId: workspaceId,
        kind: 'BAT_WAITING_INPUT',
        createdAt: { gt: staleCutoff },
      },
      select: { id: true },
    });
    if (existing) continue;
    const result = await createWaitingInputNotifications({
      researchJobId: workspaceId,
      title: 'BAT is waiting for your approval',
      body: 'A workspace run is paused for input or approval and needs owner action.',
    });
    notified += result.count;
  }
  return { notified };
}
