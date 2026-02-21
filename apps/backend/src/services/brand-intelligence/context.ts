import { prisma } from '../../lib/prisma';
import { sanitizeDiscoveryContext } from '../discovery/discovery-context-sanitizer';
import {
  BrandIntelligenceContext,
  BrandIntelligenceModuleKey,
  BrandIntelligenceServiceError,
  createBrandIntelligenceError,
} from './types';

function normalizeList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function normalizeDomain(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return raw.replace(/^www\./i, '').toLowerCase();
  }
}

function scoreKeywords(text: string, keywords: string[]): number {
  const value = text.toLowerCase();
  return keywords.reduce((sum, keyword) => (value.includes(keyword) ? sum + 1 : sum), 0);
}

function extractGoalSignals(text: string): BrandIntelligenceContext['goalSignals'] {
  return {
    sales: scoreKeywords(text, [
      'sale',
      'sales',
      'revenue',
      'lead',
      'conversion',
      'booking',
      'customer',
      'purchase',
      'checkout',
    ]),
    engagement: scoreKeywords(text, [
      'engagement',
      'community',
      'followers',
      'reach',
      'views',
      'awareness',
      'retention',
      'audience',
    ]),
    authority: scoreKeywords(text, [
      'authority',
      'positioning',
      'trust',
      'narrative',
      'thought leadership',
      'credibility',
    ]),
  };
}

export async function loadBrandIntelligenceContext(
  researchJobId: string
): Promise<BrandIntelligenceContext> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: {
          clientAccounts: {
            select: {
              platform: true,
              handle: true,
            },
          },
          brainProfile: {
            include: {
              goals: {
                select: {
                  goalType: true,
                  targetValue: true,
                },
                orderBy: { priority: 'asc' },
              },
            },
          },
        },
      },
      aiQuestions: {
        where: {
          isAnswered: true,
          questionType: {
            in: ['TARGET_AUDIENCE', 'NICHE_POSITION', 'GROWTH_STRATEGY', 'PAIN_POINTS'],
          },
        },
        select: {
          answer: true,
          questionType: true,
        },
      },
    },
  });

  if (!job || !job.client) {
    throw createBrandIntelligenceError('BRAND_INTEL_NOT_FOUND', 'Research job not found', 404);
  }

  const inputData = (job.inputData || {}) as Record<string, unknown>;
  const brainProfile = job.client.brainProfile;

  const handlesByPlatform: Record<string, string> = {};
  for (const account of job.client.clientAccounts) {
    const platform = String(account.platform || '').trim().toLowerCase();
    const handle = String(account.handle || '').trim();
    if (platform && handle && !handlesByPlatform[platform]) {
      handlesByPlatform[platform] = handle;
    }
  }

  if (inputData.handles && typeof inputData.handles === 'object') {
    for (const [platform, handle] of Object.entries(inputData.handles as Record<string, unknown>)) {
      const normalizedPlatform = String(platform || '').trim().toLowerCase();
      const normalizedHandle = String(handle || '').trim();
      if (normalizedPlatform && normalizedHandle && !handlesByPlatform[normalizedPlatform]) {
        handlesByPlatform[normalizedPlatform] = normalizedHandle;
      }
    }
  }

  const brandName =
    String(inputData.brandName || job.client.name || handlesByPlatform.instagram || '').trim() ||
    'brand';

  const sanitizeResult = sanitizeDiscoveryContext({
    businessOverview: String(
      inputData.businessOverview ||
        inputData.description ||
        job.client.businessOverview ||
        ''
    ),
    audienceSummary: String(
      inputData.idealAudience ||
        inputData.targetAudience ||
        brainProfile?.targetMarket ||
        inputData.audience ||
        ''
    ),
    niche: String(inputData.niche || brainProfile?.businessType || 'business'),
  });

  const websiteDomain = normalizeDomain(
    inputData.website || inputData.websiteUrl || brainProfile?.websiteDomain
  );

  const excludedCategories = Array.from(
    new Set([
      ...normalizeList(inputData.excludedCategories),
      ...normalizeList(
        inputData.constraints && typeof inputData.constraints === 'object'
          ? (inputData.constraints as Record<string, unknown>).excludedCategories
          : []
      ),
      ...normalizeList(
        brainProfile?.constraints && typeof brainProfile.constraints === 'object'
          ? (brainProfile.constraints as Record<string, unknown>).excludedCategories
          : []
      ),
      ...normalizeList(inputData.topicsToAvoid),
      ...(inputData.constraints && typeof inputData.constraints === 'object'
        ? normalizeList((inputData.constraints as Record<string, unknown>).topicsToAvoid)
        : []),
    ])
  );

  const goalText = [
    String(inputData.primaryGoal || ''),
    String(inputData.futureGoal || ''),
    String(job.client.goalsKpis || ''),
    String(brainProfile?.primaryGoal || ''),
    ...job.aiQuestions.map((question) => String(question.answer || '')),
    ...(brainProfile?.goals || []).map((goal) => `${goal.goalType}:${goal.targetValue || ''}`),
  ]
    .join(' ')
    .toLowerCase();

  return {
    researchJobId: job.id,
    clientId: job.client.id,
    brandName,
    niche: sanitizeResult.niche || 'business',
    websiteDomain,
    businessOverview: sanitizeResult.businessOverview,
    audienceSummary: sanitizeResult.audienceSummary,
    handlesByPlatform,
    excludedCategories,
    inputData,
    goalSignals: extractGoalSignals(goalText),
  };
}

export function chooseBrandIntelligenceModuleOrder(
  context: BrandIntelligenceContext,
  requested?: BrandIntelligenceModuleKey[]
): BrandIntelligenceModuleKey[] {
  if (requested && requested.length > 0) {
    return requested;
  }

  const hasCommunitySignal =
    context.goalSignals.engagement > context.goalSignals.sales &&
    context.goalSignals.engagement >= context.goalSignals.authority;

  if (hasCommunitySignal) {
    return ['community_insights', 'brand_mentions'];
  }

  return ['brand_mentions', 'community_insights'];
}

export function validateBrandIntelligenceModules(
  modules: unknown
): BrandIntelligenceModuleKey[] | undefined {
  if (modules === undefined || modules === null) return undefined;
  if (!Array.isArray(modules) || modules.length === 0) {
    throw createBrandIntelligenceError(
      'BRAND_INTEL_INVALID_INPUT',
      'modules must be a non-empty array when provided',
      400
    );
  }

  const normalized = Array.from(
    new Set(modules.map((value) => String(value || '').trim().toLowerCase()))
  );

  const allowed = new Set<BrandIntelligenceModuleKey>(['brand_mentions', 'community_insights']);
  if (!normalized.every((value) => allowed.has(value as BrandIntelligenceModuleKey))) {
    throw createBrandIntelligenceError(
      'BRAND_INTEL_INVALID_INPUT',
      'modules must only include brand_mentions and community_insights',
      400
    );
  }

  return normalized as BrandIntelligenceModuleKey[];
}

export function assertSchemaReadyForBrandIntel(isReady: boolean): void {
  if (isReady) return;
  throw createBrandIntelligenceError(
    'BRAND_INTEL_SCHEMA_NOT_READY',
    'Schema is not ready for brand intelligence orchestration',
    503
  );
}
