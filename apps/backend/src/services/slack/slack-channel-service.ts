import type { WebClient } from '@slack/web-api';
import { SlackConversationType } from '@prisma/client';
import { prisma } from '../../lib/prisma';

function normalizeConversationType(value: unknown): SlackConversationType {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'group' || raw === 'private_channel') return SlackConversationType.GROUP;
  if (raw === 'im') return SlackConversationType.IM;
  if (raw === 'mpim') return SlackConversationType.MPIM;
  return SlackConversationType.CHANNEL;
}

function safeChannelName(value: unknown, fallback: string): string {
  const name = String(value || '').trim();
  if (!name) return fallback;
  return name.slice(0, 180);
}

export async function upsertSlackChannel(input: {
  slackTeamId: string;
  slackChannelId: string;
  name?: string;
  conversationType?: SlackConversationType | string;
  isPrivate?: boolean;
  isArchived?: boolean;
  isMember?: boolean;
}) {
  const channelName = safeChannelName(input.name, input.slackChannelId);
  return prisma.slackChannel.upsert({
    where: {
      slackTeamId_slackChannelId: {
        slackTeamId: input.slackTeamId,
        slackChannelId: input.slackChannelId,
      },
    },
    create: {
      slackTeamId: input.slackTeamId,
      slackChannelId: input.slackChannelId,
      name: channelName,
      conversationType: normalizeConversationType(input.conversationType),
      isPrivate: Boolean(input.isPrivate),
      isArchived: Boolean(input.isArchived),
      isMember: input.isMember !== false,
      lastSeenAt: new Date(),
    },
    update: {
      name: channelName,
      conversationType: normalizeConversationType(input.conversationType),
      ...(typeof input.isPrivate === 'boolean' ? { isPrivate: input.isPrivate } : {}),
      ...(typeof input.isArchived === 'boolean' ? { isArchived: input.isArchived } : {}),
      ...(typeof input.isMember === 'boolean' ? { isMember: input.isMember } : {}),
      lastSeenAt: new Date(),
    },
  });
}

export async function resolveWorkspaceForSlackChannel(input: {
  slackTeamId: string;
  slackChannelId: string;
}): Promise<string | null> {
  const link = await prisma.slackChannelLink.findUnique({
    where: {
      slackTeamId_slackChannelId: {
        slackTeamId: input.slackTeamId,
        slackChannelId: input.slackChannelId,
      },
    },
    select: { researchJobId: true, enabled: true },
  });
  if (!link?.enabled) return null;
  return link.researchJobId;
}

export async function linkSlackChannelToWorkspace(input: {
  slackTeamId: string;
  slackChannelId: string;
  researchJobId: string;
  createdByPortalUserId?: string | null;
  enabled?: boolean;
}) {
  const workspace = await prisma.researchJob.findUnique({
    where: { id: input.researchJobId },
    select: { id: true },
  });
  if (!workspace) {
    throw new Error(`Workspace ${input.researchJobId} was not found.`);
  }

  return prisma.slackChannelLink.upsert({
    where: {
      slackTeamId_slackChannelId: {
        slackTeamId: input.slackTeamId,
        slackChannelId: input.slackChannelId,
      },
    },
    create: {
      slackTeamId: input.slackTeamId,
      slackChannelId: input.slackChannelId,
      researchJobId: input.researchJobId,
      enabled: input.enabled !== false,
      backfillState: 'PENDING',
      createdByPortalUserId: input.createdByPortalUserId || null,
    },
    update: {
      researchJobId: input.researchJobId,
      enabled: input.enabled !== false,
      backfillState: 'PENDING',
      backfillCursor: null,
      backfillError: null,
      ...(typeof input.createdByPortalUserId !== 'undefined'
        ? { createdByPortalUserId: input.createdByPortalUserId || null }
        : {}),
    },
  });
}

export async function setSlackChannelOwners(input: {
  slackTeamId: string;
  slackChannelId: string;
  owners: Array<{ slackUserId: string; portalUserId?: string | null }>;
}) {
  const owners = input.owners
    .map((owner) => ({
      slackUserId: String(owner.slackUserId || '').trim(),
      portalUserId: owner.portalUserId ? String(owner.portalUserId).trim() : null,
    }))
    .filter((owner) => owner.slackUserId)
    .slice(0, 30);

  await prisma.$transaction(async (tx) => {
    await tx.slackChannelOwner.deleteMany({
      where: {
        slackTeamId: input.slackTeamId,
        slackChannelId: input.slackChannelId,
      },
    });
    if (!owners.length) return;
    await tx.slackChannelOwner.createMany({
      data: owners.map((owner) => ({
        slackTeamId: input.slackTeamId,
        slackChannelId: input.slackChannelId,
        slackUserId: owner.slackUserId,
        portalUserId: owner.portalUserId,
      })),
      skipDuplicates: true,
    });
  });
}

export async function listSlackChannelsForTeam(slackTeamId: string) {
  return prisma.slackChannel.findMany({
    where: { slackTeamId },
    include: {
      links: {
        include: {
          researchJob: {
            select: {
              id: true,
              client: { select: { name: true } },
            },
          },
        },
      },
      owners: {
        include: {
          portalUser: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
        },
      },
    },
    orderBy: [{ isMember: 'desc' }, { updatedAt: 'desc' }],
  });
}

function toSlackTypeFilter(input: SlackConversationType): 'public_channel' | 'private_channel' | 'im' | 'mpim' {
  if (input === SlackConversationType.GROUP) return 'private_channel';
  if (input === SlackConversationType.IM) return 'im';
  if (input === SlackConversationType.MPIM) return 'mpim';
  return 'public_channel';
}

export async function syncSlackChannelsFromApi(input: {
  slackTeamId: string;
  client: WebClient;
  includeDirectMessages?: boolean;
}) {
  const normalizedTypes: SlackConversationType[] = input.includeDirectMessages
    ? [SlackConversationType.CHANNEL, SlackConversationType.GROUP, SlackConversationType.IM, SlackConversationType.MPIM]
    : [SlackConversationType.CHANNEL, SlackConversationType.GROUP];

  let synced = 0;
  for (const type of normalizedTypes) {
    let cursor: string | undefined;
    while (true) {
      const result = await input.client.conversations.list({
        types: toSlackTypeFilter(type),
        limit: 200,
        cursor,
        exclude_archived: false,
      });
      const channels = Array.isArray(result.channels) ? result.channels : [];
      for (const channel of channels) {
        const slackChannelId = String(channel.id || '').trim();
        if (!slackChannelId) continue;
        await upsertSlackChannel({
          slackTeamId: input.slackTeamId,
          slackChannelId,
          name: safeChannelName(channel.name, slackChannelId),
          conversationType: type,
          isPrivate: Boolean(channel.is_private),
          isArchived: Boolean(channel.is_archived),
          isMember: channel.is_member !== false,
        });
        synced += 1;
      }
      cursor = String(result.response_metadata?.next_cursor || '').trim() || undefined;
      if (!cursor) break;
    }
  }

  return { synced };
}
