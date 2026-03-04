import { NotificationKind, NotificationSeverity } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { deliverNotificationToSlackChannel, deliverNotificationToSlackDm } from './slack-delivery';
import { parseSlackInstallationSettings } from '../slack/slack-installation-repo';

export async function createInAppNotification(input: {
  portalUserId: string;
  researchJobId?: string | null;
  attentionItemId?: string | null;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  metadata?: Record<string, unknown> | null;
  markRead?: boolean;
}) {
  const notification = await prisma.notification.create({
    data: {
      portalUserId: input.portalUserId,
      researchJobId: input.researchJobId || null,
      attentionItemId: input.attentionItemId || null,
      kind: input.kind,
      severity: input.severity,
      title: input.title.slice(0, 220),
      body: input.body.slice(0, 2000),
      metadataJson: (input.metadata || null) as any,
      ...(input.markRead ? { readAt: new Date() } : {}),
    },
  });

  await prisma.notificationDelivery.create({
    data: {
      notificationId: notification.id,
      destination: 'IN_APP',
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  return notification;
}

export async function listPortalUserNotifications(input: {
  portalUserId: string;
  workspaceId?: string;
  unreadOnly?: boolean;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(Number(input.limit || 80), 200));
  return prisma.notification.findMany({
    where: {
      portalUserId: input.portalUserId,
      ...(input.workspaceId ? { researchJobId: input.workspaceId } : {}),
      ...(input.unreadOnly ? { readAt: null } : {}),
    },
    include: {
      deliveries: {
        orderBy: { createdAt: 'desc' },
        take: 6,
      },
      attentionItem: {
        select: {
          id: true,
          type: true,
          status: true,
          dueAt: true,
          summary: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function markNotificationRead(input: { portalUserId: string; notificationId: string }) {
  return prisma.notification.updateMany({
    where: {
      id: input.notificationId,
      portalUserId: input.portalUserId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });
}

export async function markAllNotificationsRead(input: { portalUserId: string; workspaceId?: string }) {
  return prisma.notification.updateMany({
    where: {
      portalUserId: input.portalUserId,
      readAt: null,
      ...(input.workspaceId ? { researchJobId: input.workspaceId } : {}),
    },
    data: {
      readAt: new Date(),
    },
  });
}

export async function createAttentionNotifications(input: {
  attentionItemId: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  kind: NotificationKind;
}) {
  const attention = await prisma.attentionItem.findUnique({
    where: { id: input.attentionItemId },
    include: {
      channel: true,
      installation: true,
      researchJob: {
        select: {
          id: true,
          client: { select: { name: true } },
        },
      },
      notifications: {
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!attention) return { created: 0 };

  const owners = await prisma.slackChannelOwner.findMany({
    where: {
      slackTeamId: attention.slackTeamId,
      slackChannelId: attention.slackChannelId,
    },
    select: {
      slackUserId: true,
      portalUserId: true,
    },
  });

  const settings = parseSlackInstallationSettings(attention.installation.settingsJson);
  const ownerDeliveryMode = settings.ownerDeliveryMode;
  const dueAtLabel = attention.dueAt ? attention.dueAt.toISOString() : null;
  const notifyChannelId =
    ownerDeliveryMode === 'channel' || ownerDeliveryMode === 'both'
      ? attention.installation.defaultNotifyChannelId
      : null;

  let created = 0;
  let channelDeliveryNotificationId: string | null = null;
  for (const owner of owners) {
    if (!owner.portalUserId) continue;
    const notification = await createInAppNotification({
      portalUserId: owner.portalUserId,
      researchJobId: attention.researchJobId,
      attentionItemId: attention.id,
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      body: input.body,
      metadata: {
        attentionItemId: attention.id,
        slackTeamId: attention.slackTeamId,
        slackChannelId: attention.slackChannelId,
      },
      markRead: !settings.notifyInBat,
    });
    if (settings.notifyInBat) created += 1;
    if (!channelDeliveryNotificationId) channelDeliveryNotificationId = notification.id;

    if (settings.notifyInSlack && (ownerDeliveryMode === 'dm' || ownerDeliveryMode === 'both')) {
      await deliverNotificationToSlackDm({
        notificationId: notification.id,
        slackTeamId: attention.slackTeamId,
        slackUserId: owner.slackUserId,
        title: input.title,
        body: input.body,
        attentionItemId: attention.id,
        dueAtLabel,
      });
    }
  }

  if (settings.notifyInSlack && notifyChannelId && channelDeliveryNotificationId) {
    await deliverNotificationToSlackChannel({
      notificationId: channelDeliveryNotificationId,
      slackTeamId: attention.slackTeamId,
      slackChannelId: notifyChannelId,
      title: input.title,
      body: input.body,
      attentionItemId: attention.id,
      dueAtLabel,
    });
  }

  await prisma.attentionItem.update({
    where: { id: attention.id },
    data: { lastNotifiedAt: new Date() },
  });

  return { created };
}

export async function createWaitingInputNotifications(input: {
  researchJobId: string;
  title: string;
  body: string;
}) {
  const links = await prisma.slackChannelLink.findMany({
    where: {
      researchJobId: input.researchJobId,
      enabled: true,
    },
  });

  const ownerPortalIds = new Set<string>();
  for (const link of links) {
    const owners = await prisma.slackChannelOwner.findMany({
      where: {
        slackTeamId: link.slackTeamId,
        slackChannelId: link.slackChannelId,
      },
      select: { portalUserId: true },
    });
    for (const owner of owners) {
      if (owner.portalUserId) ownerPortalIds.add(owner.portalUserId);
    }
  }

  let count = 0;
  for (const portalUserId of ownerPortalIds) {
    await createInAppNotification({
      portalUserId,
      researchJobId: input.researchJobId,
      kind: 'BAT_WAITING_INPUT',
      severity: 'WARN',
      title: input.title,
      body: input.body,
    });
    count += 1;
  }
  return { count };
}
