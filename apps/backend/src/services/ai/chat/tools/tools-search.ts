import type { ToolDefinition } from './tool-types';
import { discoverCompetitorsV3 } from '../../../discovery/v3/discover-v3';
import { listSearchProviders, searchWeb, type SearchProviderId } from '../../../search/search-service';
import type { CompetitorDiscoveryLane, DiscoverCompetitorsV3Seed } from '../../../discovery/v3/types';
import { type SearchVertical } from '../../../search/search-provider';

function uniqueStrings(items: string[], max = 20): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = String(item || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeLane(value: unknown): CompetitorDiscoveryLane | null {
  const lane = String(value || '').trim().toLowerCase();
  if (
    lane === 'category' ||
    lane === 'alternatives' ||
    lane === 'directories' ||
    lane === 'social' ||
    lane === 'community' ||
    lane === 'people'
  ) {
    return lane;
  }
  return null;
}

function sanitizeSeedCompetitors(value: unknown): DiscoverCompetitorsV3Seed[] {
  if (!Array.isArray(value)) return [];
  const out: DiscoverCompetitorsV3Seed[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const name = String(record.name || '').trim();
    const url = String(record.url || '').trim();
    const handle = String(record.handle || '').trim().replace(/^@+/, '');
    const candidate: DiscoverCompetitorsV3Seed = {
      ...(name ? { name } : {}),
      ...(url ? { url } : {}),
      ...(handle ? { handle } : {}),
    };
    if (candidate.name || candidate.url || candidate.handle) {
      out.push(candidate);
    }
    if (out.length >= 40) break;
  }
  return out;
}

function sanitizeProvider(value: unknown): SearchProviderId {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'brave') return 'brave';
  if (normalized === 'ddg') return 'ddg';
  return 'auto';
}

function sanitizeVertical(value: unknown): SearchVertical {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'news') return 'news';
  if (normalized === 'videos' || normalized === 'video') return 'videos';
  return 'web';
}

export const searchTools: ToolDefinition<Record<string, unknown>, Record<string, unknown>>[] = [
  {
    name: 'search.web',
    description: 'Search the web (Brave/DDG abstraction) and return normalized ranked results with evidence links.',
    argsSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'number', minimum: 1, maximum: 50 },
        offset: { type: 'number', minimum: 0, maximum: 500 },
        vertical: { type: 'string', enum: ['web', 'news', 'videos'] },
        locale: { type: 'string' },
        freshnessDays: { type: 'number', minimum: 1, maximum: 3650 },
        provider: { type: 'string', enum: ['auto', 'brave', 'ddg'] },
      },
      required: ['query'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        provider: { type: 'string' },
        query: { type: 'string' },
        vertical: { type: 'string' },
        count: { type: 'number' },
        rawTotal: { type: 'number' },
        items: { type: 'array' },
        evidence: { type: 'array' },
        warnings: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'provider', 'query', 'vertical', 'count', 'items', 'evidence'],
      additionalProperties: true,
    },
    mutate: false,
    execute: async (_context, args) => {
      const query = String(args.query || '').trim();
      if (!query) {
        return {
          summary: 'search.web requires a non-empty query.',
          provider: 'auto',
          query,
          vertical: 'web',
          count: 0,
          items: [],
          evidence: [],
          warnings: ['Provide `query` to run search.web.'],
          providers: listSearchProviders(),
        };
      }

      const response = await searchWeb({
        query,
        count: Number(args.count),
        offset: Number(args.offset),
        vertical: sanitizeVertical(args.vertical),
        locale: typeof args.locale === 'string' ? args.locale : undefined,
        freshnessDays: Number(args.freshnessDays),
        provider: sanitizeProvider(args.provider),
      });

      const items = response.items.slice(0, 20).map((item) => ({
        url: item.url,
        title: item.title,
        snippet: item.snippet,
        rank: item.rank,
        ...(item.source ? { source: item.source } : {}),
      }));

      return {
        summary: `search.web returned ${items.length} result(s) for "${query}" using ${response.provider}.`,
        provider: response.provider,
        query: response.query,
        vertical: response.vertical,
        count: items.length,
        ...(typeof response.rawTotal === 'number' ? { rawTotal: response.rawTotal } : {}),
        items,
        evidence: items.slice(0, 10).map((item) => ({
          kind: 'url',
          label: `${item.rank}. ${item.title}`,
          url: item.url,
        })),
        warnings: uniqueStrings(response.warnings || [], 8),
      };
    },
  },
  {
    name: 'competitors.discover_v3',
    description:
      'Run wide multi-lane competitor discovery (search + enrichment + ranking) to produce direct and adjacent competitors.',
    argsSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['wide', 'standard', 'deep'] },
        seedCompetitors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              url: { type: 'string' },
              handle: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        lanes: {
          type: 'array',
          items: { type: 'string', enum: ['category', 'alternatives', 'directories', 'social', 'community', 'people'] },
        },
        maxCandidates: { type: 'number', minimum: 20, maximum: 300 },
        maxEnrich: { type: 'number', minimum: 0, maximum: 40 },
        locales: { type: 'array', items: { type: 'string' } },
        includePeople: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        runId: { type: 'string' },
        mode: { type: 'string' },
        stats: { type: 'object' },
        topCandidates: { type: 'array' },
        laneStats: { type: 'object' },
        artifacts: { type: 'array' },
        evidence: { type: 'array' },
        warnings: { type: 'array', items: { type: 'string' } },
        internalLink: { type: 'string' },
      },
      required: ['summary', 'runId', 'mode', 'stats', 'topCandidates', 'laneStats', 'artifacts', 'evidence', 'internalLink'],
      additionalProperties: true,
    },
    mutate: true,
    execute: async (context, args) => {
      const lanes = Array.isArray(args.lanes)
        ? args.lanes
            .map((lane) => sanitizeLane(lane))
            .filter((lane): lane is CompetitorDiscoveryLane => Boolean(lane))
        : undefined;
      const locales = Array.isArray(args.locales)
        ? uniqueStrings(args.locales.map((locale) => String(locale || '').trim()), 6)
        : undefined;

      const result = await discoverCompetitorsV3(context.researchJobId, {
        mode: String(args.mode || '').trim().toLowerCase() === 'deep'
          ? 'deep'
          : String(args.mode || '').trim().toLowerCase() === 'wide'
            ? 'wide'
            : 'standard',
        ...(lanes && lanes.length ? { lanes } : {}),
        ...(locales && locales.length ? { locales } : {}),
        ...(typeof args.includePeople === 'boolean' ? { includePeople: args.includePeople } : {}),
        ...(Number.isFinite(Number(args.maxCandidates)) ? { maxCandidates: Number(args.maxCandidates) } : {}),
        ...(Number.isFinite(Number(args.maxEnrich)) ? { maxEnrich: Number(args.maxEnrich) } : {}),
        seedCompetitors: sanitizeSeedCompetitors(args.seedCompetitors),
      });

      const internalLink = context.links.moduleLink('intelligence', {
        intelSection: 'competitors',
      });

      return {
        summary: `V3 competitor discovery run ${result.runId} completed: ${result.summary.candidatesPersisted} candidate(s), ${result.summary.topPicks} top pick(s), ${result.summary.shortlisted} shortlisted.`,
        runId: result.runId,
        mode: result.mode,
        stats: result.summary,
        topCandidates: result.topCandidates,
        laneStats: result.laneStats,
        artifacts: result.artifacts,
        evidence: [
          { kind: 'internal', label: 'Open competitors in Intelligence', url: internalLink },
          ...result.evidence.slice(0, 14),
        ],
        warnings: result.warnings,
        internalLink,
        continuations: [
          {
            type: 'auto_continue',
            reason: 'V3 competitor discovery completed; synthesize direct and adjacent landscape with evidence.',
            suggestedNextTools: ['intel.list', 'orchestration.status', 'evidence.posts'],
            suggestedToolCalls: [
              { tool: 'intel.list', args: { section: 'competitors', limit: 20 } },
              { tool: 'orchestration.status', args: {} },
              { tool: 'evidence.posts', args: { platform: 'any', sort: 'engagement', limit: 8 } },
            ],
          },
        ],
      };
    },
  },
];
