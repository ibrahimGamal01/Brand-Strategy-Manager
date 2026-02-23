import { prisma } from '../../../../lib/prisma';
import type { ToolDefinition } from './tool-types';
import {
  MAX_EVIDENCE_LIMIT,
  clampLimit,
  compactSnippet,
  getPostPermalink,
  normalizeHandle,
  normalizePlatform,
  resolveTimeRange,
  resolveProfileFilters,
  type EvidenceFeedArgs,
  type EvidenceFeedResult,
  type EvidencePostItem,
  type EvidencePostsArgs,
  type EvidencePostsResult,
} from './tools-evidence-helpers';

async function runEvidencePosts(
  context: Parameters<ToolDefinition<Record<string, unknown>, Record<string, unknown>>['execute']>[0],
  rawArgs: EvidencePostsArgs
): Promise<EvidencePostsResult> {
  const args = rawArgs || {};
  const limit = clampLimit(args.limit);
  const filters = await resolveProfileFilters(context, args);
  const timeRange = resolveTimeRange(args);

  const posts = await prisma.socialPost.findMany({
    where: {
      socialProfile: {
        researchJobId: context.researchJobId,
      },
    },
    include: {
      socialProfile: {
        select: { handle: true, platform: true },
      },
    },
    take: 300,
  });

  const filtered = posts.filter((post) => {
    const handle = normalizeHandle(post.socialProfile.handle);
    const platform = normalizePlatform(post.socialProfile.platform);
    const postTimestamp = post.postedAt?.getTime() || post.scrapedAt.getTime();

    if (filters.handleSet && !filters.handleSet.has(handle)) return false;
    if (filters.platform && platform !== filters.platform) return false;
    if (timeRange.startMs && postTimestamp < timeRange.startMs) return false;
    if (timeRange.endMs && postTimestamp > timeRange.endMs) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if ((args.sort || 'engagement') === 'recent') {
      const aTime = a.postedAt?.getTime() || a.scrapedAt.getTime();
      const bTime = b.postedAt?.getTime() || b.scrapedAt.getTime();
      return bTime - aTime;
    }

    const aScore = (a.likesCount || 0) + (a.commentsCount || 0) + (a.sharesCount || 0) + (a.viewsCount || 0) + (a.playsCount || 0);
    const bScore = (b.likesCount || 0) + (b.commentsCount || 0) + (b.sharesCount || 0) + (b.viewsCount || 0) + (b.playsCount || 0);
    return bScore - aScore;
  });

  const items: EvidencePostItem[] = sorted.slice(0, limit).map((post) => {
    const permalink = getPostPermalink(post);
    const platform = normalizePlatform(post.socialProfile.platform);
    const handle = normalizeHandle(post.socialProfile.handle);

    return {
      postId: post.id,
      platform,
      handle,
      captionSnippet: compactSnippet(post.caption, 220),
      postedAt: post.postedAt ? post.postedAt.toISOString() : null,
      metrics: {
        likesCount: post.likesCount || 0,
        commentsCount: post.commentsCount || 0,
        sharesCount: post.sharesCount || 0,
        viewsCount: post.viewsCount || 0,
        playsCount: post.playsCount || 0,
        engagementScore: (post.likesCount || 0) + (post.commentsCount || 0) + (post.sharesCount || 0),
      },
      permalink,
      internalLink: context.links.moduleLink('intelligence', {
        intelSection: 'media_assets',
        focusKind: 'social_post',
        focusId: post.id,
        platform,
        handle,
      }),
    };
  });

  if (!items.length) {
    const rangeHint = args.lastNDays
      ? ` for the last ${Math.max(1, Math.round(args.lastNDays))} day(s)`
      : args.startDateIso || args.endDateIso
        ? ' for the requested timeframe'
        : '';
    return {
      items,
      reason: `No social posts match the requested filters${rangeHint} in this research workspace yet.`,
    };
  }

  return { items };
}

async function runEvidenceVideos(
  context: Parameters<ToolDefinition<Record<string, unknown>, Record<string, unknown>>['execute']>[0],
  rawArgs: EvidenceFeedArgs
): Promise<EvidenceFeedResult> {
  const limit = clampLimit(rawArgs.limit);
  const query = String(rawArgs.query || '').trim().toLowerCase();

  const rows = await prisma.ddgVideoResult.findMany({
    where: {
      researchJobId: context.researchJobId,
      ...(query
        ? {
            OR: [
              { query: { contains: query, mode: 'insensitive' } },
              { title: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const items = rows.map((row) => ({
    title: row.title,
    url: row.url,
    source: row.publisher || row.uploader || 'video',
    snippet: compactSnippet(row.description, 220),
    publishedAt: row.publishedAt || null,
    internalLink: context.links.moduleLink('intelligence', {
      intelSection: 'videos',
      focusKind: 'video',
      focusId: row.id,
    }),
  }));

  return {
    items,
    ...(items.length ? {} : { reason: 'No stored DDG video results match this query yet.' }),
  };
}

async function runEvidenceNews(
  context: Parameters<ToolDefinition<Record<string, unknown>, Record<string, unknown>>['execute']>[0],
  rawArgs: EvidenceFeedArgs
): Promise<EvidenceFeedResult> {
  const limit = clampLimit(rawArgs.limit);
  const query = String(rawArgs.query || '').trim().toLowerCase();

  const rows = await prisma.ddgNewsResult.findMany({
    where: {
      researchJobId: context.researchJobId,
      ...(query
        ? {
            OR: [
              { query: { contains: query, mode: 'insensitive' } },
              { title: { contains: query, mode: 'insensitive' } },
              { body: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const items = rows.map((row) => ({
    title: row.title,
    url: row.url,
    source: row.source || 'news',
    snippet: compactSnippet(row.body, 220),
    publishedAt: row.publishedAt || null,
    internalLink: context.links.moduleLink('intelligence', {
      intelSection: 'news',
      focusKind: 'news',
      focusId: row.id,
    }),
  }));

  return {
    items,
    ...(items.length ? {} : { reason: 'No stored DDG news results match this query yet.' }),
  };
}

export const evidenceTools: ToolDefinition<Record<string, unknown>, Record<string, unknown>>[] = [
  {
    name: 'evidence.posts',
    description: 'Return linkable social post evidence from this research workspace.',
    argsSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['instagram', 'tiktok', 'any'] },
        handles: { type: 'array', items: { type: 'string' } },
        sort: { type: 'string', enum: ['engagement', 'recent'] },
        limit: { type: 'number', minimum: 1, maximum: MAX_EVIDENCE_LIMIT },
        includeCompetitors: { type: 'boolean' },
        includeClient: { type: 'boolean' },
        startDateIso: { type: 'string' },
        endDateIso: { type: 'string' },
        lastNDays: { type: 'number', minimum: 1, maximum: 365 },
      },
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: { items: { type: 'array' }, reason: { type: 'string' } },
      required: ['items'],
      additionalProperties: false,
    },
    mutate: false,
    execute: async (context, args) => runEvidencePosts(context, args as EvidencePostsArgs) as unknown as Record<string, unknown>,
  },
  {
    name: 'evidence.videos',
    description: 'Return linkable video evidence from stored DDG video results.',
    argsSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: MAX_EVIDENCE_LIMIT },
      },
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: { items: { type: 'array' }, reason: { type: 'string' } },
      required: ['items'],
      additionalProperties: false,
    },
    mutate: false,
    execute: async (context, args) => runEvidenceVideos(context, args as EvidenceFeedArgs) as unknown as Record<string, unknown>,
  },
  {
    name: 'evidence.news',
    description: 'Return linkable news evidence from stored DDG news results.',
    argsSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: MAX_EVIDENCE_LIMIT },
      },
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: { items: { type: 'array' }, reason: { type: 'string' } },
      required: ['items'],
      additionalProperties: false,
    },
    mutate: false,
    execute: async (context, args) => runEvidenceNews(context, args as EvidenceFeedArgs) as unknown as Record<string, unknown>,
  },
];
