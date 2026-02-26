import { prisma } from '../../../../lib/prisma';
import { SECTION_CONFIG } from '../../../../routes/intelligence-crud-config';
import type { AgentContext } from '../agent-context';
import type { ToolDefinition } from './tool-types';

type IntelReadArgs = Record<string, unknown> & {
  section?: string;
  limit?: number;
  includeInactive?: boolean;
  where?: Record<string, unknown>;
};

const SECTION_VALUES = Object.keys(SECTION_CONFIG);
const MAX_LIST_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSection(section: unknown): string {
  const normalized = String(section || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-/g, '_');
  if (!SECTION_CONFIG[normalized]) {
    throw new Error(`Unsupported intelligence section "${section}"`);
  }
  return normalized;
}

function sanitizeFilter(
  where: Record<string, unknown> | undefined,
  allowedFields: string[],
): Record<string, unknown> {
  if (!isRecord(where)) return {};
  const sanitized: Record<string, unknown> = {};
  const allowed = new Set(['id', ...allowedFields]);
  for (const [key, value] of Object.entries(where)) {
    if (!allowed.has(key)) continue;
    if (value === undefined) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      sanitized[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.length > 0 && value.length <= 50) {
      const primitiveItems = value.filter((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item));
      if (primitiveItems.length) sanitized[key] = { in: primitiveItems };
    }
  }
  return sanitized;
}

async function resolveScopeWhere(context: AgentContext, section: string): Promise<Record<string, unknown>> {
  const config = SECTION_CONFIG[section];
  if (!config) throw new Error(`Unknown section "${section}"`);

  if (config.scope === 'researchJob') {
    return { researchJobId: context.researchJobId };
  }

  const job = await prisma.researchJob.findUnique({
    where: { id: context.researchJobId },
    select: { clientId: true },
  });
  if (!job?.clientId) {
    throw new Error('Research job does not resolve to a client scope.');
  }
  return { clientId: job.clientId };
}

async function listSection(context: AgentContext, args: IntelReadArgs): Promise<Record<string, unknown>> {
  const section = normalizeSection(args.section);
  const config = SECTION_CONFIG[section];
  const modelKey = String(config.model);
  const delegate = (prisma as Record<string, any>)[modelKey];
  if (!delegate?.findMany) {
    throw new Error(`Section "${section}" is not queryable.`);
  }

  const limitRaw = Number(args.limit ?? 25);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(limitRaw)))
    : 25;
  const includeInactive = Boolean(args.includeInactive);
  const scopeWhere = await resolveScopeWhere(context, section);
  const rawWhere = isRecord(args.where) ? args.where : {};
  const extraWhere = sanitizeFilter(rawWhere, config.allowedFields);
  const where: Record<string, unknown> = { ...scopeWhere, ...extraWhere };

  // Support filtering snapshots by crawl run id stored in metadata.crawlRunId.
  if (section === 'web_snapshots') {
    const crawlRunId = String(rawWhere.crawlRunId || '').trim();
    if (crawlRunId) {
      where.metadata = {
        path: ['crawlRunId'],
        equals: crawlRunId,
      };
    }
  }

  if (config.supportsCuration && !includeInactive) {
    where.isActive = true;
  }

  const rows = await delegate.findMany({
    where,
    take: limit,
    orderBy: config.orderBy
      ? {
          [config.orderBy.field]: config.orderBy.direction,
        }
      : { updatedAt: 'desc' },
  });

  const deepLink = context.links.moduleLink('intelligence', { intelSection: section });

  return {
    section,
    count: rows.length,
    items: rows,
    data: rows,
    summary: `Listed ${rows.length} item(s) from ${section}.`,
    evidence: [
      {
        kind: 'internal',
        label: `Open ${section} in Intelligence`,
        url: deepLink,
      },
    ],
    includeInactive,
    deepLink,
  };
}

async function getSectionItem(context: AgentContext, args: IntelReadArgs): Promise<Record<string, unknown>> {
  const section = normalizeSection(args.section);
  const config = SECTION_CONFIG[section];
  const modelKey = String(config.model);
  const delegate = (prisma as Record<string, any>)[modelKey];
  if (!delegate?.findFirst) {
    throw new Error(`Section "${section}" does not support item fetch.`);
  }

  const scopeWhere = await resolveScopeWhere(context, section);
  const itemId = String(args.id || '').trim();
  const targetWhere = isRecord(args.target) ? sanitizeFilter(args.target, config.allowedFields) : {};

  const where: Record<string, unknown> = { ...scopeWhere };
  if (config.supportsCuration && !Boolean(args.includeInactive)) {
    where.isActive = true;
  }

  if (itemId) where.id = itemId;
  Object.assign(where, targetWhere);

  if (!itemId && !Object.keys(targetWhere).length) {
    throw new Error('intel.get requires id or target fields.');
  }

  const row = await delegate.findFirst({ where });
  const deepLink = context.links.moduleLink('intelligence', { intelSection: section });

  return {
    section,
    item: row || null,
    items: row ? [row] : [],
    summary: row ? `Fetched 1 item from ${section}.` : `No item found in ${section}.`,
    evidence: [
      {
        kind: 'internal',
        label: `Open ${section} in Intelligence`,
        url: deepLink,
      },
    ],
    deepLink,
  };
}

export const intelReadTools: ToolDefinition<Record<string, unknown>, Record<string, unknown>>[] = [
  {
    name: 'intel.list',
    description: 'List rows from an intelligence section with optional filters.',
    argsSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: SECTION_VALUES },
        limit: { type: 'number', minimum: 1, maximum: MAX_LIST_LIMIT },
        includeInactive: { type: 'boolean' },
        where: { type: 'object' },
      },
      required: ['section'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        section: { type: 'string' },
        count: { type: 'number' },
        items: { type: 'array' },
        data: { type: 'array' },
        summary: { type: 'string' },
        evidence: { type: 'array' },
        includeInactive: { type: 'boolean' },
        deepLink: { type: 'string' },
      },
      required: ['section', 'count', 'items', 'data', 'summary', 'evidence', 'includeInactive', 'deepLink'],
      additionalProperties: false,
    },
    mutate: false,
    execute: (context, args) => listSection(context, args as IntelReadArgs),
  },
  {
    name: 'intel.get',
    description: 'Fetch one row from an intelligence section by id or target fields.',
    argsSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: SECTION_VALUES },
        id: { type: 'string' },
        includeInactive: { type: 'boolean' },
        target: { type: 'object' },
      },
      required: ['section'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        section: { type: 'string' },
        item: { type: ['object', 'null'] },
        items: { type: 'array' },
        summary: { type: 'string' },
        evidence: { type: 'array' },
        deepLink: { type: 'string' },
      },
      required: ['section', 'item', 'items', 'summary', 'evidence', 'deepLink'],
      additionalProperties: false,
    },
    mutate: false,
    execute: (context, args) => getSectionItem(context, args as IntelReadArgs),
  },
];
