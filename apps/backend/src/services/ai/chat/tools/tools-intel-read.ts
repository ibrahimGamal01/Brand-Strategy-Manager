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
const MAX_SUMMARY_EXAMPLES = 3;
const MAX_EVIDENCE_ITEMS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNoisyEvidenceUrl(value: unknown): boolean {
  const raw = String(value || '').trim();
  if (!raw) return true;
  if (/,https?:\/\//i.test(raw)) return true;

  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (!host || /[, ]/.test(host)) return true;
    if (path === '/,' || path.endsWith(',') || path.includes(',https')) return true;

    const isGoogleHost = host === 'google.com' || host.endsWith('.google.com');
    if (isGoogleHost && (path.startsWith('/search') || path.startsWith('/httpservice/retry'))) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function compactText(value: unknown, max = 140): string {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function toEvidenceUrl(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw || isNoisyEvidenceUrl(raw)) return null;
  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function detectRowUrl(row: Record<string, unknown>): string | null {
  const candidates = [row.url, row.finalUrl, row.profileUrl, row.href, row.sourceUrl, row.permalink];
  for (const candidate of candidates) {
    const next = toEvidenceUrl(candidate);
    if (next) return next;
  }
  return null;
}

function detectRowTitle(row: Record<string, unknown>): string {
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const candidates = [
    row.title,
    row.headline,
    row.handle,
    row.canonicalName,
    row.domain,
    row.query,
    row.source,
    metadata.title,
    row.url,
    row.finalUrl,
    row.profileUrl,
    row.content,
    row.body,
    row.summary,
  ];
  for (const candidate of candidates) {
    const next = compactText(candidate, 140);
    if (next) return next;
  }
  return '';
}

function buildRowLabel(section: string, row: Record<string, unknown>): string {
  if (section === 'competitors') {
    const platform = compactText(row.platform, 20);
    const handle = compactText(row.handle, 60);
    const state = compactText(row.selectionState || row.status, 24);
    const score = Number(row.relevanceScore);
    const scorePart = Number.isFinite(score) ? `score ${Math.max(0, Math.round(score))}` : '';
    const identity = handle ? `@${handle}${platform ? ` (${platform})` : ''}` : detectRowTitle(row);
    return [identity, state, scorePart].filter(Boolean).join(' • ');
  }

  if (section === 'web_snapshots') {
    const title = detectRowTitle(row);
    const statusCode = Number(row.statusCode);
    const status = Number.isFinite(statusCode) ? `HTTP ${Math.floor(statusCode)}` : '';
    return [title, status].filter(Boolean).join(' • ');
  }

  if (section === 'web_sources') {
    const title = compactText(row.domain || row.url, 120) || detectRowTitle(row);
    const type = compactText(row.sourceType || row.discoveredBy, 32);
    return [title, type].filter(Boolean).join(' • ');
  }

  return detectRowTitle(row);
}

function buildRowEvidence(section: string, rowRaw: unknown, index: number) {
  if (!isRecord(rowRaw)) return null;
  const label = buildRowLabel(section, rowRaw);
  if (!label) return null;
  const url = detectRowUrl(rowRaw);
  return {
    kind: 'record',
    label: `${index + 1}. ${label}`,
    ...(url ? { url } : {}),
  };
}

function buildSectionSummary(section: string, rows: unknown[]): string {
  if (!rows.length) {
    return `No active records found in ${section}.`;
  }
  const examples = rows
    .map((row) => (isRecord(row) ? buildRowLabel(section, row) : ''))
    .filter(Boolean)
    .slice(0, MAX_SUMMARY_EXAMPLES);
  const base = `Loaded ${rows.length} record(s) from ${section}.`;
  if (!examples.length) return base;
  return `${base} Examples: ${examples.join('; ')}.`;
}

function qualityFilterRows(section: string, rows: any[]): any[] {
  if (section === 'web_sources') {
    return rows.filter((row) => !isNoisyEvidenceUrl(row?.url));
  }
  if (section === 'web_snapshots') {
    return rows.filter((row) => !isNoisyEvidenceUrl(row?.finalUrl || row?.url));
  }
  return rows;
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
  const shouldQualityFilter = section === 'web_sources' || section === 'web_snapshots';
  const queryTake = shouldQualityFilter ? Math.min(MAX_LIST_LIMIT, limit * 3) : limit;
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

  const rowsRaw = await delegate.findMany({
    where,
    take: queryTake,
    orderBy: config.orderBy
      ? {
          [config.orderBy.field]: config.orderBy.direction,
        }
      : { updatedAt: 'desc' },
  });
  const rows = qualityFilterRows(section, rowsRaw).slice(0, limit);

  const deepLink = context.links.moduleLink('intelligence', { intelSection: section });
  const rowEvidence = rows
    .map((row, index) => buildRowEvidence(section, row, index))
    .filter((item): item is { kind: string; label: string; url?: string } => Boolean(item))
    .slice(0, MAX_EVIDENCE_ITEMS);
  const filteredOutCount = Math.max(0, rowsRaw.length - rows.length);

  return {
    section,
    count: rows.length,
    items: rows,
    data: rows,
    summary:
      filteredOutCount > 0
        ? `${buildSectionSummary(section, rows)} Filtered ${filteredOutCount} noisy record(s).`
        : buildSectionSummary(section, rows),
    evidence: [
      {
        kind: 'internal',
        label: `Open ${section} in Intelligence`,
        url: deepLink,
      },
      ...rowEvidence,
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
