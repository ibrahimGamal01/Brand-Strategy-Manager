import { Router } from 'express';
import { prisma } from '../lib/prisma';

type ScopeType = 'researchJob' | 'client';

type SectionConfig = {
  model: keyof typeof prisma;
  scope: ScopeType;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  allowedFields: string[];
  numberFields?: string[];
  booleanFields?: string[];
  dateFields?: string[];
  jsonArrayFields?: string[];
};

const SECTION_CONFIG: Record<string, SectionConfig> = {
  client_profiles: {
    model: 'clientAccount',
    scope: 'client',
    orderBy: { field: 'createdAt', direction: 'desc' },
    allowedFields: ['platform', 'handle', 'profileUrl', 'followerCount', 'followingCount', 'bio', 'profileImageUrl', 'lastScrapedAt'],
    numberFields: ['followerCount', 'followingCount'],
    dateFields: ['lastScrapedAt'],
  },
  competitors: {
    model: 'discoveredCompetitor',
    scope: 'researchJob',
    orderBy: { field: 'discoveredAt', direction: 'desc' },
    allowedFields: [
      'handle',
      'platform',
      'profileUrl',
      'discoveryReason',
      'relevanceScore',
      'status',
      'postsScraped',
      'selectionState',
      'selectionReason',
      'availabilityStatus',
      'availabilityReason',
      'displayOrder',
      'evidence',
      'scoreBreakdown',
    ],
    numberFields: ['relevanceScore', 'postsScraped', 'displayOrder'],
  },
  search_results: {
    model: 'rawSearchResult',
    scope: 'researchJob',
    orderBy: { field: 'createdAt', direction: 'desc' },
    allowedFields: ['query', 'source', 'title', 'href', 'body', 'isProcessed', 'extractedData', 'seenCount', 'lastSeenAt'],
    numberFields: ['seenCount'],
    booleanFields: ['isProcessed'],
    dateFields: ['lastSeenAt'],
  },
  images: {
    model: 'ddgImageResult',
    scope: 'researchJob',
    orderBy: { field: 'createdAt', direction: 'desc' },
    allowedFields: ['query', 'title', 'imageUrl', 'thumbnailUrl', 'sourceUrl', 'width', 'height'],
    numberFields: ['width', 'height'],
  },
  videos: {
    model: 'ddgVideoResult',
    scope: 'researchJob',
    orderBy: { field: 'createdAt', direction: 'desc' },
    allowedFields: [
      'query',
      'title',
      'description',
      'url',
      'embedUrl',
      'duration',
      'publisher',
      'uploader',
      'viewCount',
      'thumbnailUrl',
      'publishedAt',
    ],
    numberFields: ['viewCount'],
  },
  news: {
    model: 'ddgNewsResult',
    scope: 'researchJob',
    orderBy: { field: 'createdAt', direction: 'desc' },
    allowedFields: ['query', 'title', 'body', 'url', 'source', 'imageUrl', 'publishedAt'],
  },
  brand_mentions: {
    model: 'brandMention',
    scope: 'client',
    orderBy: { field: 'scrapedAt', direction: 'desc' },
    allowedFields: [
      'url',
      'title',
      'snippet',
      'fullText',
      'sourceType',
      'availabilityStatus',
      'availabilityReason',
      'resolverConfidence',
      'evidence',
    ],
    numberFields: ['resolverConfidence'],
  },
  media_assets: {
    model: 'mediaAsset',
    scope: 'researchJob',
    orderBy: { field: 'downloadedAt', direction: 'desc' },
    allowedFields: [
      'mediaType',
      'sourceType',
      'sourceId',
      'externalMediaId',
      'originalUrl',
      'blobStoragePath',
      'fileSizeBytes',
      'durationSeconds',
      'width',
      'height',
      'thumbnailPath',
      'isDownloaded',
      'downloadedAt',
      'downloadError',
    ],
    numberFields: ['fileSizeBytes', 'durationSeconds', 'width', 'height'],
    booleanFields: ['isDownloaded'],
    dateFields: ['downloadedAt'],
  },
  search_trends: {
    model: 'searchTrend',
    scope: 'researchJob',
    orderBy: { field: 'createdAt', direction: 'desc' },
    allowedFields: ['keyword', 'region', 'timeframe', 'interestOverTime', 'relatedQueries', 'relatedTopics'],
    jsonArrayFields: ['relatedQueries', 'relatedTopics'],
  },
  community_insights: {
    model: 'communityInsight',
    scope: 'researchJob',
    orderBy: { field: 'createdAt', direction: 'desc' },
    allowedFields: [
      'source',
      'url',
      'content',
      'sentiment',
      'painPoints',
      'desires',
      'marketingHooks',
      'metric',
      'metricValue',
      'sourceQuery',
      'evidence',
    ],
    numberFields: ['metricValue'],
    jsonArrayFields: ['painPoints', 'desires', 'marketingHooks'],
  },
  ai_questions: {
    model: 'aiQuestion',
    scope: 'researchJob',
    orderBy: { field: 'createdAt', direction: 'desc' },
    allowedFields: [
      'questionType',
      'question',
      'answer',
      'answerJson',
      'contextUsed',
      'promptUsed',
      'modelUsed',
      'tokensUsed',
      'durationMs',
      'isAnswered',
      'answeredAt',
    ],
    numberFields: ['tokensUsed', 'durationMs'],
    booleanFields: ['isAnswered'],
    dateFields: ['answeredAt'],
  },
};

const MEDIA_TYPE_VALUES = new Set(['IMAGE', 'VIDEO', 'AUDIO']);
const MEDIA_SOURCE_TYPE_VALUES = new Set(['CLIENT_POST_SNAPSHOT', 'COMPETITOR_POST_SNAPSHOT']);
const AI_QUESTION_TYPE_VALUES = new Set([
  'VALUE_PROPOSITION',
  'TARGET_AUDIENCE',
  'CONTENT_PILLARS',
  'BRAND_VOICE',
  'BRAND_PERSONALITY',
  'COMPETITOR_ANALYSIS',
  'NICHE_POSITION',
  'UNIQUE_STRENGTHS',
  'CONTENT_OPPORTUNITIES',
  'GROWTH_STRATEGY',
  'PAIN_POINTS',
  'KEY_DIFFERENTIATORS',
  'CUSTOM',
  'COMPETITOR_DISCOVERY_METHOD',
]);

const router = Router();

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function parseJsonArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function cleanPayload(section: string, config: SectionConfig, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const key of config.allowedFields) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (value === undefined) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (config.numberFields?.includes(key)) {
      const parsed = parseNumber(value);
      if (parsed !== undefined) out[key] = parsed;
      continue;
    }
    if (config.booleanFields?.includes(key)) {
      const parsed = parseBoolean(value);
      if (parsed !== undefined) out[key] = parsed;
      continue;
    }
    if (config.dateFields?.includes(key)) {
      const parsed = parseDate(value);
      if (parsed) out[key] = parsed;
      continue;
    }
    if (config.jsonArrayFields?.includes(key)) {
      const parsed = parseJsonArray(value);
      if (parsed) out[key] = parsed;
      continue;
    }
    out[key] = value;
  }

  if (section === 'media_assets') {
    if (typeof out.mediaType === 'string') {
      const upper = out.mediaType.toUpperCase();
      out.mediaType = MEDIA_TYPE_VALUES.has(upper) ? upper : 'IMAGE';
    }
    if (typeof out.sourceType === 'string') {
      const upper = out.sourceType.toUpperCase();
      out.sourceType = MEDIA_SOURCE_TYPE_VALUES.has(upper) ? upper : null;
    }
  }

  if (section === 'ai_questions' && typeof out.questionType === 'string') {
    const upper = out.questionType.toUpperCase();
    out.questionType = AI_QUESTION_TYPE_VALUES.has(upper) ? upper : 'CUSTOM';
  }

  return out;
}

async function getJobOrThrow(jobId: string) {
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId },
    select: { id: true, clientId: true },
  });
  if (!job) {
    throw new Error('Research job not found');
  }
  return job;
}

function resolveSection(section: string): { key: string; config: SectionConfig } | null {
  const normalized = String(section || '').trim().toLowerCase();
  const config = SECTION_CONFIG[normalized];
  if (!config) return null;
  return { key: normalized, config };
}

function getDelegate(config: SectionConfig): any {
  return (prisma as any)[config.model];
}

async function scopeWhere(config: SectionConfig, jobId: string, clientId: string): Promise<Record<string, unknown>> {
  if (config.scope === 'client') {
    return { clientId };
  }
  return { researchJobId: jobId };
}

function ensureCreateFallbacks(section: string, payload: Record<string, unknown>) {
  if (section === 'client_profiles') {
    if (!payload.platform) payload.platform = 'instagram';
    if (!payload.handle) payload.handle = `manual_${Date.now()}`;
  }
  if (section === 'competitors') {
    if (!payload.platform) payload.platform = 'instagram';
    if (!payload.handle) payload.handle = `competitor_${Date.now()}`;
  }
  if (section === 'search_results') {
    if (!payload.query) payload.query = 'manual query';
    if (!payload.title) payload.title = 'Manual result';
    if (!payload.body) payload.body = 'Added from chat CRUD';
    if (!payload.href) payload.href = `https://manual.local/search/${Date.now()}`;
    if (!payload.source) payload.source = 'manual';
  }
  if (section === 'images') {
    if (!payload.query) payload.query = 'manual image query';
    if (!payload.title) payload.title = 'Manual image';
    if (!payload.imageUrl) payload.imageUrl = `https://picsum.photos/seed/${Date.now()}/800/800`;
    if (!payload.sourceUrl) payload.sourceUrl = payload.imageUrl;
  }
  if (section === 'videos') {
    if (!payload.query) payload.query = 'manual video query';
    if (!payload.title) payload.title = 'Manual video';
    if (!payload.url) payload.url = `https://manual.local/video/${Date.now()}`;
  }
  if (section === 'news') {
    if (!payload.query) payload.query = 'manual news query';
    if (!payload.title) payload.title = 'Manual article';
    if (!payload.url) payload.url = `https://manual.local/news/${Date.now()}`;
  }
  if (section === 'brand_mentions') {
    if (!payload.url) payload.url = `https://manual.local/mention/${Date.now()}`;
    if (!payload.sourceType) payload.sourceType = 'manual';
  }
  if (section === 'media_assets') {
    if (!payload.mediaType) payload.mediaType = 'IMAGE';
  }
  if (section === 'search_trends') {
    if (!payload.keyword) payload.keyword = `manual-trend-${Date.now()}`;
    if (!payload.region) payload.region = 'US';
    if (!payload.timeframe) payload.timeframe = 'today 12-m';
  }
  if (section === 'community_insights') {
    if (!payload.source) payload.source = 'manual';
    if (!payload.url) payload.url = `https://manual.local/community/${Date.now()}`;
    if (!payload.content) payload.content = 'Manual community insight';
  }
  if (section === 'ai_questions') {
    if (!payload.questionType) payload.questionType = 'CUSTOM';
    if (!payload.question) payload.question = 'Manual strategic question';
  }
}

router.get('/:id/intelligence', async (req, res) => {
  try {
    const { id: jobId } = req.params;
    const job = await getJobOrThrow(jobId);
    const sections = await Promise.all(
      Object.entries(SECTION_CONFIG).map(async ([section, config]) => {
        const delegate = getDelegate(config);
        const where = await scopeWhere(config, job.id, job.clientId);
        const count = await delegate.count({ where });
        return { section, count };
      })
    );
    return res.json({ success: true, sections });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to list intelligence sections', details: error.message });
  }
});

router.get('/:id/intelligence/:section', async (req, res) => {
  try {
    const { id: jobId, section } = req.params;
    const resolved = resolveSection(section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(jobId);
    const delegate = getDelegate(resolved.config);
    const where = await scopeWhere(resolved.config, job.id, job.clientId);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
    const orderBy = resolved.config.orderBy
      ? { [resolved.config.orderBy.field]: resolved.config.orderBy.direction }
      : undefined;
    const data = await delegate.findMany({
      where,
      take: limit,
      ...(orderBy ? { orderBy } : {}),
    });
    return res.json({ success: true, section: resolved.key, data });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch section data', details: error.message });
  }
});

router.post('/:id/intelligence/:section', async (req, res) => {
  try {
    const { id: jobId, section } = req.params;
    const resolved = resolveSection(section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(jobId);
    const delegate = getDelegate(resolved.config);
    const rawData = (req.body?.data || req.body || {}) as Record<string, unknown>;
    const payload = cleanPayload(resolved.key, resolved.config, rawData);
    ensureCreateFallbacks(resolved.key, payload);

    if (resolved.config.scope === 'client') {
      payload.clientId = job.clientId;
    } else {
      payload.researchJobId = job.id;
    }

    const created = await delegate.create({ data: payload });
    return res.json({ success: true, section: resolved.key, data: created });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to create data point', details: error.message });
  }
});

router.patch('/:id/intelligence/:section/:itemId', async (req, res) => {
  try {
    const { id: jobId, section, itemId } = req.params;
    const resolved = resolveSection(section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(jobId);
    const delegate = getDelegate(resolved.config);
    const where = await scopeWhere(resolved.config, job.id, job.clientId);
    const existing = await delegate.findFirst({ where: { ...where, id: itemId } });
    if (!existing) return res.status(404).json({ error: 'Data point not found in this research job' });

    const rawData = (req.body?.data || req.body || {}) as Record<string, unknown>;
    const payload = cleanPayload(resolved.key, resolved.config, rawData);
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updated = await delegate.update({
      where: { id: itemId },
      data: payload,
    });
    return res.json({ success: true, section: resolved.key, data: updated });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to update data point', details: error.message });
  }
});

router.delete('/:id/intelligence/:section/:itemId', async (req, res) => {
  try {
    const { id: jobId, section, itemId } = req.params;
    const resolved = resolveSection(section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(jobId);
    const delegate = getDelegate(resolved.config);
    const where = await scopeWhere(resolved.config, job.id, job.clientId);
    const existing = await delegate.findFirst({ where: { ...where, id: itemId } });
    if (!existing) return res.status(404).json({ error: 'Data point not found in this research job' });

    await delegate.delete({ where: { id: itemId } });
    return res.json({ success: true, section: resolved.key, deletedId: itemId });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to delete data point', details: error.message });
  }
});

router.delete('/:id/intelligence/:section', async (req, res) => {
  try {
    const { id: jobId, section } = req.params;
    const resolved = resolveSection(section);
    if (!resolved) return res.status(400).json({ error: 'Unknown section' });
    const job = await getJobOrThrow(jobId);
    const delegate = getDelegate(resolved.config);
    const where = await scopeWhere(resolved.config, job.id, job.clientId);
    const result = await delegate.deleteMany({ where });
    return res.json({ success: true, section: resolved.key, deletedCount: result.count });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to clear section', details: error.message });
  }
});

export default router;

