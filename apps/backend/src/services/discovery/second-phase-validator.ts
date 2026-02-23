import { CompetitorType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';

interface FilteredCompetitorReviewResult {
  competitorId: string;
  handle: string;
  platform: string;
  action: 'PROMOTED' | 'KEPT_FILTERED';
  reason: string;
  originalScore: number;
  originalState: string;
  competitorType: CompetitorType | null;
  typeConfidence: number;
  evidenceUrlCount: number;
  flags: string[];
}

interface SecondPhaseValidationResult {
  totalReviewed: number;
  promoted: number;
  keptFiltered: number;
  details: FilteredCompetitorReviewResult[];
}

type PromotionInput = {
  relevanceScore: number;
  availabilityStatus: string;
  selectionReason?: string | null;
  competitorType: CompetitorType | null;
  typeConfidence: number;
  evidenceUrlCount: number;
  entityFlags: string[];
};

const EXCLUDED_FLAGS = new Set(['fan_account', 'news_media', 'founder_personal', 'finance_ticker']);
const PROMOTABLE_TYPES = new Set<CompetitorType>(['DIRECT', 'INDIRECT']);

function toFlagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .slice(0, 20);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function countEvidenceUrls(input: {
  evidenceRows: Array<{ url: string | null }>;
  evidence: unknown;
}): number {
  const rowCount = input.evidenceRows.reduce((total, row) => {
    return row.url ? total + 1 : total;
  }, 0);

  if (rowCount > 0) return rowCount;

  if (input.evidence && typeof input.evidence === 'object') {
    const payload = input.evidence as Record<string, unknown>;
    const nestedRows = Array.isArray(payload.rows) ? payload.rows : [];
    const nestedCount = nestedRows.reduce((total, row) => {
      if (row && typeof row === 'object' && typeof (row as Record<string, unknown>).url === 'string') {
        return total + 1;
      }
      return total;
    }, 0);
    if (nestedCount > 0) return nestedCount;
  }

  return 0;
}

function shouldPromoteFilteredCompetitor(input: PromotionInput): {
  shouldPromote: boolean;
  reason: string;
} {
  const score = clamp01(input.relevanceScore);
  const confidence = clamp01(input.typeConfidence);
  const filterReason = String(input.selectionReason || '').toLowerCase();

  if (!input.competitorType || !PROMOTABLE_TYPES.has(input.competitorType)) {
    return {
      shouldPromote: false,
      reason: `Entity type ${String(input.competitorType || 'UNKNOWN').toLowerCase()} is not promotable`,
    };
  }

  const blockedFlag = input.entityFlags.find((flag) => EXCLUDED_FLAGS.has(flag));
  if (blockedFlag) {
    return {
      shouldPromote: false,
      reason: `Flagged as ${blockedFlag.replace(/_/g, ' ')}`,
    };
  }

  if (input.availabilityStatus === 'PROFILE_UNAVAILABLE' || input.availabilityStatus === 'INVALID_HANDLE') {
    return {
      shouldPromote: false,
      reason: `Profile availability is ${input.availabilityStatus.toLowerCase()}`,
    };
  }

  const minEvidenceUrls = input.competitorType === 'DIRECT' ? 2 : 3;
  if (input.evidenceUrlCount < minEvidenceUrls) {
    return {
      shouldPromote: false,
      reason: `Needs at least ${minEvidenceUrls} evidence URLs for ${input.competitorType.toLowerCase()} promotion`,
    };
  }

  const minScore = input.competitorType === 'DIRECT' ? 0.7 : 0.78;
  if (score < minScore) {
    return {
      shouldPromote: false,
      reason: `Relevance score ${score.toFixed(2)} below ${minScore.toFixed(2)} threshold`,
    };
  }

  const minConfidence = input.competitorType === 'DIRECT' ? 0.55 : 0.62;
  if (confidence < minConfidence) {
    return {
      shouldPromote: false,
      reason: `Type confidence ${confidence.toFixed(2)} below ${minConfidence.toFixed(2)}`,
    };
  }

  if (input.availabilityStatus === 'VERIFIED') {
    return {
      shouldPromote: true,
      reason: `Verified ${input.competitorType.toLowerCase()} with strong evidence (${input.evidenceUrlCount} URLs)`,
    };
  }

  if (
    input.availabilityStatus === 'UNVERIFIED' &&
    score >= 0.86 &&
    confidence >= 0.7 &&
    input.evidenceUrlCount >= minEvidenceUrls + 1
  ) {
    return {
      shouldPromote: true,
      reason: `High-confidence ${input.competitorType.toLowerCase()} promoted despite unverified availability`,
    };
  }

  return {
    shouldPromote: false,
    reason:
      filterReason.includes('availability')
        ? 'Availability status is still unresolved for promotion'
        : `Availability status ${input.availabilityStatus.toLowerCase()} not strong enough for promotion`,
  };
}

/**
 * Perform second-phase validation of filtered competitors.
 * Promotion is intentionally strict to avoid reintroducing noisy candidates.
 */
export async function reviewFilteredCompetitors(
  researchJobId: string,
  runId?: string
): Promise<SecondPhaseValidationResult> {
  console.log('[SecondPhaseValidator] Starting strict review of filtered competitors...');

  const result: SecondPhaseValidationResult = {
    totalReviewed: 0,
    promoted: 0,
    keptFiltered: 0,
    details: [],
  };

  try {
    const filteredCompetitors = await prisma.discoveredCompetitor.findMany({
      where: {
        researchJobId,
        selectionState: 'FILTERED_OUT',
        ...(runId ? { orchestrationRunId: runId } : {}),
      },
      include: {
        candidateProfile: {
          select: {
            evidenceRows: {
              select: {
                url: true,
              },
            },
            entityFlags: true,
            competitorType: true,
            typeConfidence: true,
            evidence: true,
          },
        },
      },
      orderBy: {
        relevanceScore: 'desc',
      },
    });

    console.log(`[SecondPhaseValidator] Found ${filteredCompetitors.length} filtered competitors to review`);

    result.totalReviewed = filteredCompetitors.length;

    for (const competitor of filteredCompetitors) {
      const profileFlags = toFlagList(competitor.candidateProfile?.entityFlags);
      const rowFlags = toFlagList(competitor.entityFlags);
      const mergedFlags = Array.from(new Set([...profileFlags, ...rowFlags]));

      const evidenceUrlCount = countEvidenceUrls({
        evidenceRows: competitor.candidateProfile?.evidenceRows || [],
        evidence: competitor.candidateProfile?.evidence || competitor.evidence,
      });

      const review = shouldPromoteFilteredCompetitor({
        relevanceScore: Number(competitor.relevanceScore || 0),
        availabilityStatus: competitor.availabilityStatus || 'UNKNOWN',
        selectionReason: competitor.selectionReason,
        competitorType:
          competitor.competitorType || competitor.candidateProfile?.competitorType || null,
        typeConfidence: Number(
          competitor.typeConfidence ?? competitor.candidateProfile?.typeConfidence ?? 0
        ),
        evidenceUrlCount,
        entityFlags: mergedFlags,
      });

      if (review.shouldPromote) {
        await prisma.discoveredCompetitor.update({
          where: { id: competitor.id },
          data: {
            selectionState: 'SHORTLISTED',
            selectionReason: `Second-phase validation: ${review.reason}`,
            manuallyModified: true,
            lastModifiedAt: new Date(),
            lastModifiedBy: 'system:second-phase-validator',
          },
        });

        result.promoted += 1;
        result.details.push({
          competitorId: competitor.id,
          handle: competitor.handle,
          platform: competitor.platform,
          action: 'PROMOTED',
          reason: review.reason,
          originalScore: Number(competitor.relevanceScore) || 0,
          originalState: 'FILTERED_OUT',
          competitorType: competitor.competitorType || competitor.candidateProfile?.competitorType || null,
          typeConfidence: Number(competitor.typeConfidence ?? competitor.candidateProfile?.typeConfidence ?? 0),
          evidenceUrlCount,
          flags: mergedFlags,
        });

        emitResearchJobEvent({
          researchJobId,
          runId: runId || null,
          source: 'second-phase-validator',
          code: 'competitor.promoted',
          level: 'info',
          message: `Promoted @${competitor.handle} from filtered to shortlisted`,
          platform: competitor.platform,
          handle: competitor.handle,
          entityType: 'discovered_competitor',
          entityId: competitor.id,
          metadata: {
            reason: review.reason,
            relevanceScore: Number(competitor.relevanceScore) || 0,
            availabilityStatus: competitor.availabilityStatus,
            competitorType: competitor.competitorType || competitor.candidateProfile?.competitorType || 'UNKNOWN',
            typeConfidence: Number(competitor.typeConfidence ?? competitor.candidateProfile?.typeConfidence ?? 0),
            evidenceUrlCount,
            entityFlags: mergedFlags,
          },
        });
      } else {
        result.keptFiltered += 1;
        result.details.push({
          competitorId: competitor.id,
          handle: competitor.handle,
          platform: competitor.platform,
          action: 'KEPT_FILTERED',
          reason: review.reason,
          originalScore: Number(competitor.relevanceScore) || 0,
          originalState: 'FILTERED_OUT',
          competitorType: competitor.competitorType || competitor.candidateProfile?.competitorType || null,
          typeConfidence: Number(competitor.typeConfidence ?? competitor.candidateProfile?.typeConfidence ?? 0),
          evidenceUrlCount,
          flags: mergedFlags,
        });
      }
    }

    emitResearchJobEvent({
      researchJobId,
      runId: runId || null,
      source: 'second-phase-validator',
      code: 'validation.second_phase.completed',
      level: 'info',
      message: `Second-phase validation complete: ${result.promoted} promoted, ${result.keptFiltered} kept filtered`,
      metrics: {
        totalReviewed: result.totalReviewed,
        promoted: result.promoted,
        keptFiltered: result.keptFiltered,
      },
      metadata: {
        strictMode: true,
      },
    });

    console.log(
      `[SecondPhaseValidator] Review complete: ${result.promoted} promoted, ${result.keptFiltered} kept filtered`
    );

    return result;
  } catch (error) {
    console.error('[SecondPhaseValidator] Error during review:', error);
    throw error;
  }
}

/**
 * Check for cross-platform presence (advanced validation)
 * If a competitor exists on multiple platforms, they're likely legitimate.
 */
export async function checkCrossPlatformPresence(
  researchJobId: string,
  handle: string
): Promise<{ platforms: string[]; isMultiPlatform: boolean }> {
  const competitors = await prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId,
      handle: {
        equals: handle,
        mode: 'insensitive',
      },
    },
    select: {
      platform: true,
    },
  });

  const platforms = Array.from(new Set(competitors.map((c) => c.platform)));

  return {
    platforms,
    isMultiPlatform: platforms.length > 1,
  };
}
