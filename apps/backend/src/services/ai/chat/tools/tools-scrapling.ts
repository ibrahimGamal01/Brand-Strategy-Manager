import {
  crawlAndPersistWebSources,
  extractFromWebSnapshot,
  fetchAndPersistWebSnapshot,
} from '../../../scraping/web-intelligence-service';
import type { ToolDefinition } from './tool-types';

function normalizeMode(raw: unknown): 'AUTO' | 'HTTP' | 'DYNAMIC' | 'STEALTH' {
  const value = String(raw || 'AUTO').trim().toUpperCase();
  if (value === 'HTTP' || value === 'DYNAMIC' || value === 'STEALTH') return value;
  return 'AUTO';
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
      return {
        ...result,
        internalLink: context.links.moduleLink('intelligence', {
          intelSection: 'web_snapshots',
          focusKind: 'web_snapshot',
          focusId: result.snapshotId,
        }),
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
      return {
        ...result,
        internalLink: context.links.moduleLink('intelligence', {
          intelSection: 'web_sources',
          focusKind: 'crawl_run',
          focusId: result.runId,
        }),
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
      return {
        ...result,
        internalLink: context.links.moduleLink('intelligence', {
          intelSection: 'web_extraction_runs',
          focusKind: 'web_extraction',
          focusId: result.extractionRunId || String(args.snapshotId || ''),
        }),
      };
    },
  },
];
