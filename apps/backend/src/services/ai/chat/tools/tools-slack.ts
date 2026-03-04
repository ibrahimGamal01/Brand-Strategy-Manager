import { prisma } from '../../../../lib/prisma';
import type { ToolDefinition } from './tool-types';

function compactText(value: unknown, max = 240): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function escapeSearchInput(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

function tsToIso(ts: Date | null | undefined): string | null {
  if (!ts) return null;
  return ts.toISOString();
}

export const slackTools: ToolDefinition<Record<string, unknown>, Record<string, unknown>>[] = [
  {
    name: 'slack.search_messages',
    description:
      'Search stored Slack messages for this workspace. Returns excerpts, thread ids, and message metadata.',
    argsSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        channelId: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 80 },
        includeDeleted: { type: 'boolean' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        items: { type: 'array' },
        summary: { type: 'string' },
      },
      required: ['items', 'summary'],
      additionalProperties: true,
    },
    mutate: false,
    execute: async (context, args) => {
      const query = String(args.query || '').trim();
      if (!query) {
        return { items: [], summary: 'slack.search_messages requires a non-empty query.' };
      }
      const limit = Math.max(1, Math.min(Number(args.limit || 20), 80));
      const channelId = String(args.channelId || '').trim();
      const includeDeleted = Boolean(args.includeDeleted);
      const escaped = escapeSearchInput(query);
      const rows = await prisma.slackMessage.findMany({
        where: {
          researchJobId: context.researchJobId,
          ...(channelId ? { slackChannelId: channelId } : {}),
          ...(includeDeleted ? {} : { deletedAt: null }),
          text: {
            contains: escaped,
            mode: 'insensitive',
          },
        },
        orderBy: { messageCreatedAt: 'desc' },
        take: limit,
      });

      const items = rows.map((row) => ({
        id: row.id,
        teamId: row.slackTeamId,
        channelId: row.slackChannelId,
        messageTs: row.slackTs,
        threadTs: row.threadTs,
        textSnippet: compactText(row.text, 280),
        permalink: row.permalink || null,
        messageCreatedAt: tsToIso(row.messageCreatedAt),
        slackUserId: row.slackUserId || null,
        deleted: Boolean(row.deletedAt),
      }));

      return {
        items,
        summary: `Found ${items.length} Slack message(s) for "${query}" in this workspace.`,
        evidence: items.slice(0, 10).map((item) => ({
          kind: 'slack_message',
          label: `${item.channelId} · ${item.textSnippet}`,
          ...(item.permalink ? { url: item.permalink } : {}),
          refId: item.id,
        })),
      };
    },
  },
  {
    name: 'slack.get_thread',
    description:
      'Load all stored messages for a Slack thread inside this workspace (channel + thread_ts).',
    argsSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        threadTs: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 120 },
      },
      required: ['channelId', 'threadTs'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        items: { type: 'array' },
        summary: { type: 'string' },
      },
      required: ['items', 'summary'],
      additionalProperties: true,
    },
    mutate: false,
    execute: async (context, args) => {
      const channelId = String(args.channelId || '').trim();
      const threadTs = String(args.threadTs || '').trim();
      if (!channelId || !threadTs) {
        return { items: [], summary: 'slack.get_thread requires channelId and threadTs.' };
      }
      const limit = Math.max(1, Math.min(Number(args.limit || 80), 120));
      const rows = await prisma.slackMessage.findMany({
        where: {
          researchJobId: context.researchJobId,
          slackChannelId: channelId,
          threadTs,
        },
        orderBy: { messageCreatedAt: 'asc' },
        take: limit,
      });

      const items = rows.map((row) => ({
        id: row.id,
        messageTs: row.slackTs,
        slackUserId: row.slackUserId || null,
        text: row.text,
        textSnippet: compactText(row.text, 260),
        permalink: row.permalink || null,
        messageCreatedAt: tsToIso(row.messageCreatedAt),
      }));

      return {
        items,
        summary: `Loaded ${items.length} stored Slack message(s) for thread ${threadTs}.`,
        evidence: items.slice(0, 10).map((item) => ({
          kind: 'slack_thread_message',
          label: item.textSnippet,
          ...(item.permalink ? { url: item.permalink } : {}),
          refId: item.id,
        })),
      };
    },
  },
];
