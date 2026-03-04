import { WebClient } from '@slack/web-api';
import { prisma } from '../../lib/prisma';
import { getDecryptedSlackBotToken, upsertSlackUserLink } from './slack-installation-repo';

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function safeEmail(value: unknown): string | null {
  const normalized = safeString(value).toLowerCase();
  return normalized || null;
}

function safeDisplayName(value: unknown, fallback: string): string {
  const normalized = safeString(value);
  if (normalized) return normalized.slice(0, 180);
  return fallback.slice(0, 180);
}

async function resolvePortalUserIdByEmail(email: string | null): Promise<string | null> {
  if (!email) return null;
  const user = await prisma.portalUser.findFirst({
    where: {
      email: {
        equals: email,
        mode: 'insensitive',
      },
    },
    select: { id: true },
  });
  return user?.id || null;
}

async function buildSlackClient(slackTeamId: string): Promise<WebClient> {
  const token = await getDecryptedSlackBotToken(slackTeamId);
  if (!token) {
    throw new Error(`Slack token unavailable for team ${slackTeamId}`);
  }
  return new WebClient(token);
}

export async function syncSlackUsersFromApi(input: {
  slackTeamId: string;
  includeBots?: boolean;
  maxUsers?: number;
}) {
  const includeBots = input.includeBots === true;
  const maxUsers = Number.isFinite(Number(input.maxUsers))
    ? Math.max(20, Math.min(5000, Math.floor(Number(input.maxUsers))))
    : 1500;

  const client = await buildSlackClient(input.slackTeamId);
  let cursor: string | undefined;
  let processed = 0;
  let synced = 0;

  while (true) {
    const result = await client.users.list({
      cursor,
      limit: 200,
    });
    const users = Array.isArray(result.members) ? result.members : [];
    for (const user of users) {
      const slackUserId = safeString(user.id);
      if (!slackUserId) continue;
      const isBot = Boolean(user.is_bot || user.is_app_user);
      if (!includeBots && isBot) continue;
      if (Boolean(user.deleted)) continue;

      const email = safeEmail((user as any)?.profile?.email);
      const portalUserId = await resolvePortalUserIdByEmail(email);
      const displayName = safeDisplayName(
        (user as any)?.profile?.display_name ||
          (user as any)?.profile?.real_name ||
          (user as any)?.real_name ||
          (user as any)?.name,
        slackUserId
      );

      await upsertSlackUserLink({
        slackTeamId: input.slackTeamId,
        slackUserId,
        ...(portalUserId ? { portalUserId } : {}),
        ...(email ? { email } : {}),
        displayName,
      });
      synced += 1;
      processed += 1;
      if (processed >= maxUsers) break;
    }

    if (processed >= maxUsers) break;
    cursor = safeString(result.response_metadata?.next_cursor) || undefined;
    if (!cursor) break;
  }

  return {
    synced,
    processed,
    limited: processed >= maxUsers,
  };
}

export async function listSlackUsersForTeam(slackTeamId: string) {
  return prisma.slackUserLink.findMany({
    where: { slackTeamId },
    include: {
      portalUser: {
        select: {
          id: true,
          email: true,
          fullName: true,
        },
      },
    },
    orderBy: [{ displayName: 'asc' }, { slackUserId: 'asc' }],
    take: 2500,
  });
}
