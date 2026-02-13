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
}

interface SecondPhaseValidationResult {
  totalReviewed: number;
  promoted: number;
  keptFiltered: number;
  details: FilteredCompetitorReviewResult[];
}

/**
 * Review criteria for promoting filtered competitors
 */
function shouldPromoteFilteredCompetitor(competitor: {
  relevanceScore: number;
  availabilityStatus: string;
  selectionState: string;
  platform: string;
  handle: string;
  selectionReason?: string | null;
}): { shouldPromote: boolean; reason: string } {
  // Criteria 1: High relevance score (>0.5) with verified availability
  if (
    competitor.relevanceScore > 0.5 &&
    competitor.availabilityStatus === 'VERIFIED'
  ) {
    return {
      shouldPromote: true,
      reason: 'High relevance score (>0.5) with verified profile availability',
    };
  }

  // Criteria 2: Very high score (>0.6) even without verification
  if (competitor.relevanceScore > 0.6) {
    return {
      shouldPromote: true,
      reason: 'Very high relevance score (>0.6) indicates strong match',
    };
  }

  // Criteria 3: Check if filtering reason seems incorrect
  const filterReason = (competitor.selectionReason || '').toLowerCase();
  if (
    competitor.availabilityStatus === 'VERIFIED' &&
    filterReason.includes('availability')
  ) {
    return {
      shouldPromote: true,
      reason: 'Filtered for availability but profile is now verified',
    };
  }

  // Keep filtered
  return {
    shouldPromote: false,
    reason: 'Does not meet promotion criteria',
  };
}

/**
 * Perform second-phase validation of filtered competitors
 * This reviews competitors that were filtered out by the AI to catch false positives
 */
export async function reviewFilteredCompetitors(
  researchJobId: string,
  runId?: string
): Promise<SecondPhaseValidationResult> {
  console.log('[SecondPhaseValidator] Starting review of filtered competitors...');

  const result: SecondPhaseValidationResult = {
    totalReviewed: 0,
    promoted: 0,
    keptFiltered: 0,
    details: [],
  };

  try {
    // Get all filtered competitors for this job
    const filteredCompetitors = await prisma.discoveredCompetitor.findMany({
      where: {
        researchJobId,
        selectionState: 'FILTERED_OUT',
      },
      orderBy: {
        relevanceScore: 'desc',
      },
    });

    console.log(`[SecondPhaseValidator] Found ${filteredCompetitors.length} filtered competitors to review`);

    result.totalReviewed = filteredCompetitors.length;

    for (const competitor of filteredCompetitors) {
      const review = shouldPromoteFilteredCompetitor({
        relevanceScore: Number(competitor.relevanceScore) || 0,
        availabilityStatus: competitor.availabilityStatus || 'UNKNOWN',
        selectionState: competitor.selectionState || 'FILTERED_OUT',
        platform: competitor.platform,
        handle: competitor.handle,
        selectionReason: competitor.selectionReason,
      });

      if (review.shouldPromote) {
        // Promote to SHORTLISTED
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

        result.promoted++;
        result.details.push({
          competitorId: competitor.id,
          handle: competitor.handle,
          platform: competitor.platform,
          action: 'PROMOTED',
          reason: review.reason,
          originalScore: Number(competitor.relevanceScore) || 0,
          originalState: 'FILTERED_OUT',
        });

        // Emit event
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
          },
        });

        console.log(
          `[SecondPhaseValidator] ✓ Promoted @${competitor.handle} (${competitor.platform}) - ${review.reason}`
        );
      } else {
        result.keptFiltered++;
        result.details.push({
          competitorId: competitor.id,
          handle: competitor.handle,
          platform: competitor.platform,
          action: 'KEPT_FILTERED',
          reason: review.reason,
          originalScore: Number(competitor.relevanceScore) || 0,
          originalState: 'FILTERED_OUT',
        });
      }
    }

    // Emit summary event
    if (result.promoted > 0) {
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
      });
    }

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
 * If a competitor exists on multiple platforms, they're likely legitimate
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
