import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';
import { checkClientCompleteness, queueClientTasks, type DataGaps } from './client-completeness';
import { checkCompetitorCompleteness, queueCompetitorTasks } from './competitor-completeness';
import { checkMediaGaps, queueMediaDownloadTasks, type MediaGaps } from './media-completeness';

export interface OrchestrationResult {
  researchJobId: string;
  gaps: DataGaps;
  tasksQueued: {
    client: number;
    competitors: number;
    secondPhase: number;
    media: number;
  };
  timestamp: Date;
}

/**
 * Run continuous orchestration for a single research job
 * This is the main entry point called by the scheduler
 */
function getControlMode(researchJobId: string, inputData: unknown): 'auto' | 'manual' {
  const data = inputData as Record<string, unknown> | null;
  const mode = data?.controlMode;
  if (mode === 'manual' || mode === 'auto') return mode;
  return 'auto';
}

export async function runContinuousOrchestration(researchJobId: string): Promise<OrchestrationResult> {
  console.log(`[ContinuousOrchestrator] Starting orchestration for job ${researchJobId}...`);

  const startTime = Date.now();

  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    select: { inputData: true },
  });
  const controlMode = getControlMode(researchJobId, job?.inputData ?? null);
  if (controlMode === 'manual') {
    console.log('[ContinuousOrchestrator] Control mode: manual – skipping automatic task queueing');
  }

  try {
    // Step 1: Check client completeness
    console.log('[ContinuousOrchestrator] Checking client completeness...');
    const clientGaps = await checkClientCompleteness(researchJobId);

    // Step 2: Check competitor completeness
    console.log('[ContinuousOrchestrator] Checking competitor completeness...');
    const competitorGaps = await checkCompetitorCompleteness(researchJobId);

    // Step 3: Check for filtered competitors to review (second-phase validation)
    console.log('[ContinuousOrchestrator] Checking filtered competitors...');
    const filteredCount = await prisma.discoveredCompetitor.count({
      where: {
        researchJobId,
        selectionState: 'FILTERED_OUT',
      },
    });

    // Step 4: Check media downloads
    console.log('[ContinuousOrchestrator] Checking media completeness...');
    const mediaGaps: MediaGaps = await checkMediaGaps(researchJobId);

    const gaps: DataGaps = {
      client: clientGaps,
      competitors: competitorGaps,
      media: {
        missingDownloads: mediaGaps.missingDownloads,
        failedDownloads: mediaGaps.failedDownloads,
        clientSnapshotIds: mediaGaps.clientSnapshotIds,
        competitorSnapshotIds: mediaGaps.competitorSnapshotIds,
      },
      secondPhase: {
        filteredToReview: filteredCount,
      },
    };

    // Step 5: Queue tasks based on gaps
    const tasksQueued = {
      client: 0,
      competitors: 0,
      secondPhase: 0,
      media: 0,
    };

    // Queue client tasks (skip when manual control mode)
    if (controlMode === 'auto' && (clientGaps.missingTikTok || clientGaps.staleFollowerCounts.length > 0)) {
      await queueClientTasks(researchJobId, clientGaps);
      tasksQueued.client = (clientGaps.missingTikTok ? 1 : 0) + clientGaps.staleFollowerCounts.length;
    }

    // Queue competitor tasks (skip when manual control mode)
    if (controlMode === 'auto' && (competitorGaps.unscrapedProfiles.length > 0 || 
        competitorGaps.staleProfiles.length > 0 || 
        competitorGaps.missingPosts.length > 0)) {
      await queueCompetitorTasks(researchJobId, competitorGaps);
      tasksQueued.competitors = 
        competitorGaps.unscrapedProfiles.length + 
        competitorGaps.staleProfiles.length + 
        competitorGaps.missingPosts.length;
    }

    // Run second-phase validation (skip when manual control mode)
    if (controlMode === 'auto' && filteredCount > 0) {
      console.log('[ContinuousOrchestrator] Running second-phase validation...');
      const { reviewFilteredCompetitors } = await import('../discovery/second-phase-validator');
      const validationResult = await reviewFilteredCompetitors(researchJobId);
      tasksQueued.secondPhase = validationResult.promoted;
    }

    // Queue media download tasks (skip when manual control mode)
    if (controlMode === 'auto' && mediaGaps.missingDownloads > 0) {
      tasksQueued.media = await queueMediaDownloadTasks(researchJobId, mediaGaps);
    }

    const duration = Date.now() - startTime;

    // Emit summary event
    const totalGaps = 
      (clientGaps.missingTikTok ? 1 : 0) +
      clientGaps.staleFollowerCounts.length +
      (clientGaps.missingRecentPosts ? 1 : 0) +
      competitorGaps.unscrapedProfiles.length +
      competitorGaps.staleProfiles.length +
      competitorGaps.missingPosts.length +
      filteredCount +
      mediaGaps.missingDownloads;

    emitResearchJobEvent({
      researchJobId,
      source: 'continuous-orchestrator',
      code: 'orchestration.cycle.completed',
      level: totalGaps > 0 ? 'info' : 'info',
      message: `Orchestration cycle complete: ${totalGaps} gaps found, ${tasksQueued.client + tasksQueued.competitors + tasksQueued.secondPhase + tasksQueued.media} tasks queued`,
      metrics: {
        duration,
        gaps: totalGaps,
        tasksQueued: tasksQueued.client + tasksQueued.competitors + tasksQueued.secondPhase + tasksQueued.media,
        clientGaps: {
          missingTikTok: clientGaps.missingTikTok,
          staleFollowerCounts: clientGaps.staleFollowerCounts,
          missingRecentPosts: clientGaps.missingRecentPosts,
        },
        competitorGaps: {
          unscraped: competitorGaps.unscrapedProfiles.length,
          stale: competitorGaps.staleProfiles.length,
          missingPosts: competitorGaps.missingPosts.length,
        },
        secondPhasePromoted: tasksQueued.secondPhase,
        mediaQueued: tasksQueued.media,
      },
    });

    console.log(
      `[ContinuousOrchestrator] Cycle complete (${duration}ms): ` +
      `${totalGaps} gaps, ${tasksQueued.client + tasksQueued.competitors + tasksQueued.secondPhase + tasksQueued.media} tasks queued`
    );

    return {
      researchJobId,
      gaps,
      tasksQueued,
      timestamp: new Date(),
    };
  } catch (error) {
    console.error('[ContinuousOrchestrator] Orchestration failed:', error);

    emitResearchJobEvent({
      researchJobId,
      source: 'continuous-orchestrator',
      code: 'orchestration.cycle.failed',
      level: 'error',
      message: `Orchestration cycle failed: ${(error as Error).message}`,
      metadata: {
        error: (error as Error).message,
      },
    });

    throw error;
  }
}
