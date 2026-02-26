import {
  crawlAndPersistWebSources,
  extractFromWebSnapshot,
  fetchAndPersistWebSnapshot,
} from '../../../scraping/web-intelligence-service';
import { prisma } from '../../../../lib/prisma';
import type { ToolDefinition } from './tool-types';

function normalizeMode(raw: unknown): 'AUTO' | 'HTTP' | 'DYNAMIC' | 'STEALTH' {
  const value = String(raw || 'AUTO').trim().toUpperCase();
  if (value === 'HTTP' || value === 'DYNAMIC' || value === 'STEALTH') return value;
  return 'AUTO';
}

function toIso(value: unknown): string {
  if (!value) return new Date(0).toISOString();
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return new Date(0).toISOString();
  return parsed.toISOString();
}

function compactSnippet(value: unknown, maxChars = 220): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export const scraplingTools: ToolDefinition<Record<string, unknown>, Record<string, unknown>>[] = [
  {
    name: 'web.fetch',
    description: 'Fetch and persist a web page snapshot for this workspace with guard-checked URL validation.',
    argsSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        mode: { type: 'string', enum: ['AUTO', 'HTTP', 'DYNAMIC', 'STEALTH'] },
        sourceType: {
          type: 'string',
          enum: ['CLIENT_SITE', 'COMPETITOR_SITE', 'ARTICLE', 'REVIEW', 'FORUM', 'DOC', 'OTHER'],
        },
        discoveredBy: { type: 'string', enum: ['DDG', 'USER', 'SCRAPLING_CRAWL', 'CHAT_TOOL', 'IMPORT'] },
        allowExternal: { type: 'boolean' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string' },
        snapshotId: { type: 'string' },
        finalUrl: { type: 'string' },
        statusCode: { type: 'number' },
        fetcherUsed: { type: 'string' },
        blockedSuspected: { type: 'boolean' },
        cleanTextSnippet: { type: 'string' },
        internalLink: { type: 'string' },
        fallbackReason: { type: 'string' },
      },
      required: ['sourceId', 'snapshotId', 'finalUrl', 'fetcherUsed', 'blockedSuspected', 'cleanTextSnippet'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const result = await fetchAndPersistWebSnapshot({
        researchJobId: context.researchJobId,
        url: String(args.url || ''),
        mode: normalizeMode(args.mode),
        sourceType: typeof args.sourceType === 'string' ? args.sourceType : 'OTHER',
        discoveredBy: typeof args.discoveredBy === 'string' ? args.discoveredBy : 'CHAT_TOOL',
        allowExternal: Boolean(args.allowExternal),
      });
      const internalLink = context.links.moduleLink('intelligence', {
        intelSection: 'web_snapshots',
        focusKind: 'web_snapshot',
        focusId: result.snapshotId,
      });
      return {
        ...result,
        summaryText: `web.fetch saved snapshot ${result.snapshotId} from ${result.finalUrl}${
          Number.isFinite(Number(result.statusCode)) ? ` (status ${Number(result.statusCode)})` : ''
        }.`,
        evidence: [
          { kind: 'internal', label: `Open snapshot ${result.snapshotId.slice(0, 8)}`, url: internalLink },
          { kind: 'url', label: `Fetched page ${result.finalUrl}`, url: result.finalUrl },
        ],
        internalLink,
      };
    },
  },
  {
    name: 'web.crawl',
    description: 'Crawl one or more start URLs and persist discovered page snapshots for the workspace.',
    argsSchema: {
      type: 'object',
      properties: {
        startUrls: { type: 'array', items: { type: 'string' } },
        maxPages: { type: 'number', minimum: 1, maximum: 200 },
        maxDepth: { type: 'number', minimum: 0, maximum: 5 },
        mode: { type: 'string', enum: ['AUTO', 'HTTP', 'DYNAMIC', 'STEALTH'] },
        allowExternal: { type: 'boolean' },
      },
      required: ['startUrls'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        persisted: { type: 'number' },
        summary: { type: 'object' },
        failures: { type: 'array' },
        fallbackReason: { type: 'string' },
        internalLink: { type: 'string' },
      },
      required: ['runId', 'persisted', 'summary', 'failures'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const startUrls = Array.isArray(args.startUrls)
        ? args.startUrls.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      const result = await crawlAndPersistWebSources({
        researchJobId: context.researchJobId,
        startUrls,
        maxPages: Number.isFinite(Number(args.maxPages)) ? Number(args.maxPages) : undefined,
        maxDepth: Number.isFinite(Number(args.maxDepth)) ? Number(args.maxDepth) : undefined,
        mode: normalizeMode(args.mode),
        allowExternal: Boolean(args.allowExternal),
      });
      const internalLink = context.links.moduleLink('intelligence', {
        intelSection: 'web_sources',
        focusKind: 'crawl_run',
        focusId: result.runId,
      });
      return {
        ...result,
        summaryText: `Crawl run ${result.runId} persisted ${result.persisted} page snapshot(s).`,
        evidence: [
          { kind: 'internal', label: `Open crawl run ${result.runId.slice(0, 8)}`, url: internalLink },
          ...startUrls.slice(0, 4).map((url) => ({ kind: 'url', label: `Crawl start URL: ${url}`, url })),
        ],
        internalLink,
      };
    },
  },
  {
    name: 'web.extract',
    description: 'Run a structured extraction recipe against a saved web snapshot.',
    argsSchema: {
      type: 'object',
      properties: {
        snapshotId: { type: 'string' },
        recipeId: { type: 'string' },
        recipeSchema: { type: 'object' },
        adaptiveNamespace: { type: 'string' },
      },
      required: ['snapshotId'],
      additionalProperties: true,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        extracted: { type: 'object' },
        confidence: { type: 'number' },
        warnings: { type: 'array' },
        extractionRunId: { type: 'string' },
        fallbackReason: { type: 'string' },
        internalLink: { type: 'string' },
      },
      required: ['extracted', 'confidence', 'warnings'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const result = await extractFromWebSnapshot({
        researchJobId: context.researchJobId,
        snapshotId: String(args.snapshotId || ''),
        recipeId: typeof args.recipeId === 'string' ? args.recipeId : undefined,
        recipeSchema:
          args.recipeSchema && typeof args.recipeSchema === 'object'
            ? (args.recipeSchema as Record<string, unknown>)
            : undefined,
        adaptiveNamespace: typeof args.adaptiveNamespace === 'string' ? args.adaptiveNamespace : undefined,
      });
      const internalLink = context.links.moduleLink('intelligence', {
        intelSection: 'web_extraction_runs',
        focusKind: 'web_extraction',
        focusId: result.extractionRunId || String(args.snapshotId || ''),
      });
      return {
        ...result,
        summaryText: `Extraction completed for snapshot ${String(args.snapshotId || '').trim()}.`,
        evidence: [
          {
            kind: 'internal',
            label: `Open extraction ${String((result.extractionRunId || args.snapshotId || '')).slice(0, 8)}`,
            url: internalLink,
          },
        ],
        internalLink,
      };
    },
  },
  {
    name: 'web.crawl.get_run',
    description: 'Fetch crawl run metadata by run id and include sample pages from saved snapshots.',
    argsSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        persisted: { type: 'number' },
        summary: { type: 'object' },
        items: { type: 'array' },
        evidence: { type: 'array' },
        summaryText: { type: 'string' },
        internalLink: { type: 'string' },
      },
      required: ['runId', 'persisted', 'summary', 'items', 'evidence', 'summaryText', 'internalLink'],
      additionalProperties: true,
    },
    mutate: false,
    execute: async (context, args) => {
      const runId = String(args.runId || '').trim().toLowerCase();
      if (!runId) {
        throw new Error('runId is required.');
      }

      const snapshots = await prisma.webPageSnapshot.findMany({
        where: {
          researchJobId: context.researchJobId,
          metadata: {
            path: ['crawlRunId'],
            equals: runId,
          },
        },
        include: {
          webSource: {
            select: {
              domain: true,
              url: true,
            },
          },
        },
        orderBy: { fetchedAt: 'desc' },
        take: 120,
      });

      const domains = Array.from(
        new Set(snapshots.map((row) => String(row.webSource.domain || '').trim()).filter(Boolean))
      );
      const persisted = snapshots.length;
      const items = snapshots.slice(0, 20).map((row) => ({
        snapshotId: row.id,
        finalUrl: row.finalUrl || row.webSource.url,
        statusCode: row.statusCode || null,
        fetchedAt: toIso(row.fetchedAt),
        cleanTextSnippet: compactSnippet(row.cleanText, 260),
      }));
      const internalLink = context.links.moduleLink('intelligence', {
        intelSection: 'web_sources',
        focusKind: 'crawl_run',
        focusId: runId,
      });

      return {
        runId,
        persisted,
        summary: {
          domains,
          latestSnapshotAt: snapshots[0]?.fetchedAt ? toIso(snapshots[0].fetchedAt) : null,
        },
        items,
        summaryText: `Crawl run ${runId} has ${persisted} persisted snapshot(s) across ${domains.length || 1} domain(s).`,
        evidence: [
          { kind: 'internal', label: `Open crawl run ${runId.slice(0, 8)}`, url: internalLink },
          ...items.slice(0, 6).map((item) => ({
            kind: 'url',
            label: `Snapshot ${item.snapshotId.slice(0, 8)}`,
            url: item.finalUrl,
          })),
        ],
        internalLink,
      };
    },
  },
  {
    name: 'web.crawl.list_snapshots',
    description: 'List page snapshots captured by a specific crawl run id.',
    argsSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 120 },
      },
      required: ['runId'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        count: { type: 'number' },
        items: { type: 'array' },
        summaryText: { type: 'string' },
        evidence: { type: 'array' },
        internalLink: { type: 'string' },
      },
      required: ['runId', 'count', 'items', 'summaryText', 'evidence', 'internalLink'],
      additionalProperties: true,
    },
    mutate: false,
    execute: async (context, args) => {
      const runId = String(args.runId || '').trim().toLowerCase();
      if (!runId) {
        throw new Error('runId is required.');
      }
      const limitRaw = Number(args.limit);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(120, Math.floor(limitRaw))) : 40;

      const snapshots = await prisma.webPageSnapshot.findMany({
        where: {
          researchJobId: context.researchJobId,
          metadata: {
            path: ['crawlRunId'],
            equals: runId,
          },
        },
        include: {
          webSource: {
            select: {
              url: true,
            },
          },
        },
        orderBy: { fetchedAt: 'desc' },
        take: limit,
      });

      const items = snapshots.map((row) => ({
        snapshotId: row.id,
        finalUrl: row.finalUrl || row.webSource.url,
        statusCode: row.statusCode || null,
        fetchedAt: toIso(row.fetchedAt),
        cleanTextSnippet: compactSnippet(row.cleanText, 260),
      }));
      const internalLink = context.links.moduleLink('intelligence', {
        intelSection: 'web_sources',
        focusKind: 'crawl_run',
        focusId: runId,
      });

      return {
        runId,
        count: items.length,
        items,
        summaryText: `Listed ${items.length} snapshot(s) for crawl run ${runId}.`,
        evidence: [
          { kind: 'internal', label: `Open crawl run ${runId.slice(0, 8)}`, url: internalLink },
          ...items.slice(0, 8).map((item) => ({
            kind: 'url',
            label: `Snapshot ${item.snapshotId.slice(0, 8)}`,
            url: item.finalUrl,
          })),
        ],
        internalLink,
      };
    },
  },
];
