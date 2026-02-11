import { prisma } from '../../lib/prisma';
import { analyzeSearchTrends } from './google-trends';

export interface TrendKeywordContext {
  researchJobId: string;
  brandName?: string;
  handle?: string;
  niche?: string;
  bio?: string;
  businessOverview?: string;
  maxBatches?: number;
}

export interface TrendKeywordProvider {
  name: string;
  buildKeywordBatches(context: TrendKeywordContext): Promise<string[][]>;
}

export interface TrendsOrchestratorResult {
  provider: string;
  attemptedBatches: string[][];
  attemptedKeywords: string[];
  insertedCount: number;
  totalCount: number;
  stoppedEarly: boolean;
}

const STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'that',
  'this',
  'your',
  'you',
  'our',
  'are',
  'was',
  'were',
  'can',
  'will',
  'how',
  'what',
  'when',
  'where',
  'have',
  'has',
  'about',
  'into',
  'over',
  'under',
  'help',
  'tips',
]);

function normalizeTerm(value: string): string | null {
  const normalized = value
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized || normalized.length < 2) {
    return null;
  }

  return normalized;
}

function splitWords(value?: string | null, maxWords: number = 12): string[] {
  if (!value) {
    return [];
  }

  const normalized = normalizeTerm(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(' ')
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, maxWords);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

class DefaultTrendKeywordProvider implements TrendKeywordProvider {
  name = 'heuristic-default';

  async buildKeywordBatches(context: TrendKeywordContext): Promise<string[][]> {
    const handle = normalizeTerm(context.handle || '') || '';
    const brandName = normalizeTerm(context.brandName || '') || '';
    const niche = normalizeTerm(context.niche || '') || '';

    const bioTokens = splitWords(context.bio, 10);
    const overviewTokens = splitWords(context.businessOverview, 10);
    const nicheTokens = splitWords(niche, 8);

    const candidates = new Set<string>();

    if (brandName) {
      candidates.add(brandName);
      candidates.add(`${brandName} trends`);
    }

    if (handle) {
      candidates.add(handle);
      candidates.add(`${handle} brand`);
    }

    if (niche) {
      candidates.add(niche);
      candidates.add(`${niche} trends`);
      candidates.add(`${niche} market`);
      candidates.add(`${niche} growth`);
      candidates.add(`${niche} audience`);
    }

    for (const token of [...nicheTokens, ...bioTokens, ...overviewTokens]) {
      if (token.length < 3) {
        continue;
      }

      candidates.add(token);

      if (niche) {
        candidates.add(`${token} ${niche}`);
      }

      if (brandName) {
        candidates.add(`${token} ${brandName}`);
      }
    }

    const fallbackBase = brandName || handle || niche;
    if (fallbackBase) {
      candidates.add(`${fallbackBase} insights`);
      candidates.add(`${fallbackBase} community`);
      candidates.add(`${fallbackBase} strategy`);
    }

    const ordered = Array.from(candidates)
      .map((term) => normalizeTerm(term))
      .filter((term): term is string => Boolean(term))
      .filter((term) => term.length >= 2)
      .slice(0, 30);

    const batches = chunk(ordered, 5);
    const maxBatches = Math.max(1, context.maxBatches || 4);
    return batches.slice(0, maxBatches);
  }
}

const defaultProvider = new DefaultTrendKeywordProvider();

export async function runTrendOrchestrator(
  context: TrendKeywordContext,
  provider: TrendKeywordProvider = defaultProvider
): Promise<TrendsOrchestratorResult> {
  const batches = await provider.buildKeywordBatches(context);
  const attemptedBatches: string[][] = [];

  let insertedCount = 0;
  const beforeTotal = await prisma.searchTrend.count({
    where: { researchJobId: context.researchJobId },
  });

  for (const batch of batches) {
    if (!batch.length) {
      continue;
    }

    attemptedBatches.push(batch);

    const beforeBatch = await prisma.searchTrend.count({
      where: { researchJobId: context.researchJobId },
    });

    await analyzeSearchTrends(context.researchJobId, batch);

    const afterBatch = await prisma.searchTrend.count({
      where: { researchJobId: context.researchJobId },
    });

    const batchInserted = Math.max(0, afterBatch - beforeBatch);
    insertedCount += batchInserted;

    // Missing-only strategy: stop as soon as we insert any trend records.
    if (batchInserted > 0) {
      break;
    }
  }

  const afterTotal = await prisma.searchTrend.count({
    where: { researchJobId: context.researchJobId },
  });

  const attemptedKeywords = Array.from(new Set(attemptedBatches.flat()));

  try {
    const job = await prisma.researchJob.findUnique({
      where: { id: context.researchJobId },
      select: { inputData: true },
    });

    const inputData = (job?.inputData || {}) as Record<string, unknown>;
    await prisma.researchJob.update({
      where: { id: context.researchJobId },
      data: {
        inputData: {
          ...inputData,
          trendDebug: {
            attemptedAt: new Date().toISOString(),
            provider: provider.name,
            attemptedKeywords,
            insertedCount,
            totalCount: afterTotal,
          },
        },
      },
    });
  } catch (error) {
    console.warn('[TrendsOrchestrator] Failed to persist trend debug metadata:', (error as Error).message);
  }

  return {
    provider: provider.name,
    attemptedBatches,
    attemptedKeywords,
    insertedCount,
    totalCount: afterTotal,
    stoppedEarly: insertedCount > 0 && attemptedBatches.length < batches.length,
  };
}
