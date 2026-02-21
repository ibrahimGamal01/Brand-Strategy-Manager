import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';
import { checkClientCompleteness, queueClientTasks, type DataGaps } from './client-completeness';
import { checkCompetitorCompleteness, queueCompetitorTasks } from './competitor-completeness';
import { checkMediaGaps, queueMediaDownloadTasks, type MediaGaps } from './media-completeness';
import { runAiAnalysisForJob } from './run-job-media-analysis';
import { ensureCreativeAndDesignCoverage } from './creative-design-coverage';
import { isOpenAiConfiguredForRealMode } from '../../lib/runtime-preflight';
import { applyBrainCommand } from '../brain/apply-brain-command';

const AI_ANALYSIS_PER_CYCLE_LIMIT = 10;

export interface OrchestrationResult {
  researchJobId: string;
  gaps: DataGaps;
  tasksQueued: {
    client: number;
    competitors: number;
    secondPhase: number;
    media: number;
    aiAnalysis: number;
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
    // Step 0: Apply pending brain commands (user messages top priority)
    const pendingCommands = await prisma.brainCommand.findMany({
      where: { researchJobId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (pendingCommands.length > 0) {
      console.log(`[ContinuousOrchestrator] Applying ${pendingCommands.length} pending brain command(s)...`);
      for (const cmd of pendingCommands) {
        const result = await applyBrainCommand(researchJobId, cmd.id);
        if (!result.success) {
          console.warn(`[ContinuousOrchestrator] Brain command ${cmd.id} apply failed:`, result.error);
        }
      }
    }

    // Step 1: Check client completeness
    console.log('[ContinuousOrchestrator] Checking client completeness...');
    const clientGaps = await checkClientCompleteness(researchJobId);
    console.log(
      `[ContinuousOrchestrator] Client gaps: missingTikTok=${clientGaps.missingTikTok} staleFollowerCounts=${clientGaps.staleFollowerCounts.length} incompleteInstagram=${clientGaps.incompleteInstagramMetadata}`
    );

    // Step 2: Check competitor completeness
    console.log('[ContinuousOrchestrator] Checking competitor completeness...');
    const competitorGaps = await checkCompetitorCompleteness(researchJobId);
    console.log(
      `[ContinuousOrchestrator] Competitor gaps: unscraped=${competitorGaps.unscrapedProfiles.length} stale=${competitorGaps.staleProfiles.length} missingPosts=${competitorGaps.missingPosts.length}`
    );

    // Step 3: Check for filtered competitors to review (second-phase validation)
    console.log('[ContinuousOrchestrator] Checking filtered competitors...');
    const filteredCount = await prisma.discoveredCompetitor.count({
      where: {
        researchJobId,
        selectionState: 'FILTERED_OUT',
      },
    });
    console.log(`[ContinuousOrchestrator] Second-phase: filteredToReview=${filteredCount}`);

    // Step 4: Check media downloads
    console.log('[ContinuousOrchestrator] Checking media completeness...');
    const mediaGaps: MediaGaps = await checkMediaGaps(researchJobId);
    console.log(
      `[ContinuousOrchestrator] Media gaps: missingDownloads=${mediaGaps.missingDownloads} (client=${mediaGaps.clientSnapshotIds.length} competitor=${mediaGaps.competitorSnapshotIds.length})`
    );

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
      aiAnalysis: 0,
    };

    const hasClientGaps =
      clientGaps.missingTikTok ||
      clientGaps.staleFollowerCounts.length > 0 ||
      clientGaps.incompleteInstagramMetadata;
    if (controlMode === 'auto' && hasClientGaps) {
      const reasons: string[] = [];
      if (clientGaps.missingTikTok) reasons.push('missingTikTok');
      if (clientGaps.staleFollowerCounts.length > 0) reasons.push('staleFollowers');
      if (clientGaps.incompleteInstagramMetadata) reasons.push('incompleteInstagram');
      console.log(`[ContinuousOrchestrator] Queueing client tasks: reason=${reasons.join('|')}`);
      await queueClientTasks(researchJobId, clientGaps);
      tasksQueued.client =
        (clientGaps.missingTikTok ? 1 : 0) +
        clientGaps.staleFollowerCounts.length +
        (clientGaps.incompleteInstagramMetadata ? 1 : 0);
    } else {
      console.log(
        `[ContinuousOrchestrator] Skipping client tasks: ${controlMode !== 'auto' ? 'controlMode=manual' : 'no gaps'}`
      );
    }

    const hasCompetitorGaps =
      competitorGaps.unscrapedProfiles.length > 0 ||
      competitorGaps.staleProfiles.length > 0 ||
      competitorGaps.missingPosts.length > 0;
    if (controlMode === 'auto' && hasCompetitorGaps) {
      console.log(
        `[ContinuousOrchestrator] Queueing competitor tasks: ${competitorGaps.unscrapedProfiles.length + competitorGaps.staleProfiles.length + competitorGaps.missingPosts.length} profiles (unscraped|stale|missingPosts)`
      );
      await queueCompetitorTasks(researchJobId, competitorGaps);
      tasksQueued.competitors =
        competitorGaps.unscrapedProfiles.length +
        competitorGaps.staleProfiles.length +
        competitorGaps.missingPosts.length;
    } else {
      console.log(
        `[ContinuousOrchestrator] Skipping competitor tasks: ${controlMode !== 'auto' ? 'controlMode=manual' : 'no gaps'}`
      );
    }

    if (controlMode === 'auto' && filteredCount > 0) {
      console.log('[ContinuousOrchestrator] Running second-phase validation...');
      const { reviewFilteredCompetitors } = await import('../discovery/second-phase-validator');
      const validationResult = await reviewFilteredCompetitors(researchJobId);
      tasksQueued.secondPhase = validationResult.promoted;
    } else if (filteredCount === 0) {
      console.log('[ContinuousOrchestrator] Skipping second-phase: no filtered to review');
    }

    if (controlMode === 'auto' && mediaGaps.missingDownloads > 0) {
      console.log(
        `[ContinuousOrchestrator] Queueing media downloads: ${mediaGaps.clientSnapshotIds.length + mediaGaps.competitorSnapshotIds.length} snapshots`
      );
      tasksQueued.media = await queueMediaDownloadTasks(researchJobId, mediaGaps);
    } else {
      console.log(
        `[ContinuousOrchestrator] Skipping media downloads: ${controlMode !== 'auto' ? 'controlMode=manual' : 'no missing downloads'}`
      );
    }

    // Step 5a: Brain enrichment every cycle (fast, no extra API) – fill/suggest from AI answers so BAT Brain tab shows data quickly
    if (isOpenAiConfiguredForRealMode()) {
      try {
        const { runBrainEnrichment } = await import('../brain/brain-enrichment');
        const enrichResult = await runBrainEnrichment(researchJobId);
        if (!enrichResult.skipped && (enrichResult.autoFilled.length > 0 || enrichResult.suggestionsCreated > 0)) {
          console.log(
            `[ContinuousOrchestrator] Brain enrichment: autoFilled=${enrichResult.autoFilled.length} suggestions=${enrichResult.suggestionsCreated}`
          );
          await prisma.brainCommand.create({
            data: {
              researchJobId,
              section: 'brain',
              commandType: 'UPDATE_CONTEXT',
              instruction: `BAT: Enriched brain from research. ${enrichResult.autoFilled.length} field(s) auto-filled, ${enrichResult.suggestionsCreated} suggestion(s) created. Review in BAT Brain tab.`,
              status: 'APPLIED',
              createdBy: 'orchestrator',
            },
          });
        }
      } catch (enrichErr: any) {
        console.warn('[ContinuousOrchestrator] Brain enrichment failed:', enrichErr?.message);
      }
    }

    // Step 5b: AI analysis for downloaded media (posts with metrics) – costly API; only runs when unanalyzed assets exist
    let aiResult: Awaited<ReturnType<typeof runAiAnalysisForJob>> | undefined;
    if (controlMode === 'auto' && isOpenAiConfiguredForRealMode()) {
      aiResult = await runAiAnalysisForJob(researchJobId, {
        limit: AI_ANALYSIS_PER_CYCLE_LIMIT,
      });
      tasksQueued.aiAnalysis = aiResult.ran;
      if (aiResult.skipped) {
        console.log(
          `[ContinuousOrchestrator] AI analysis: skipped (${aiResult.reason ?? 'no unanalyzed media'})`
        );
      } else {
        console.log(
          `[ContinuousOrchestrator] AI analysis: ran ${aiResult.ran} (succeeded ${aiResult.succeeded}, failed ${aiResult.failed})`
        );
      }
    } else {
      console.log(
        `[ContinuousOrchestrator] AI analysis: skipped (${controlMode !== 'auto' ? 'controlMode=manual' : 'no OpenAI'})`
      );
    }

    // Step 5c: Top-level AI orchestrator – ensure analysis covers creative/design metrics (API cost: only when we just ran analysis)
    if (
      controlMode === 'auto' &&
      isOpenAiConfiguredForRealMode() &&
      aiResult &&
      aiResult.ran > 0 &&
      aiResult.processedAssetIds &&
      aiResult.processedAssetIds.length > 0
    ) {
      const creativeResult = await ensureCreativeAndDesignCoverage(researchJobId, {
        limit: 5,
        onlyAssetIds: aiResult.processedAssetIds,
      });
      if (creativeResult.checked > 0) {
        console.log(
          `[ContinuousOrchestrator] Creative/design coverage: checked ${creativeResult.checked}, enriched ${creativeResult.enriched}, skipped ${creativeResult.skipped}`
        );
      }
    } else if (controlMode === 'auto' && isOpenAiConfiguredForRealMode() && tasksQueued.aiAnalysis === 0) {
      console.log('[ContinuousOrchestrator] Creative/design coverage: skipped (no API run this cycle; cost control)');
    }

    const duration = Date.now() - startTime;
    const totalGaps =
      (clientGaps.missingTikTok ? 1 : 0) +
      clientGaps.staleFollowerCounts.length +
      (clientGaps.missingRecentPosts ? 1 : 0) +
      (clientGaps.incompleteInstagramMetadata ? 1 : 0) +
      competitorGaps.unscrapedProfiles.length +
      competitorGaps.staleProfiles.length +
      competitorGaps.missingPosts.length +
      filteredCount +
      mediaGaps.missingDownloads;

    const totalQueued =
      tasksQueued.client +
      tasksQueued.competitors +
      tasksQueued.secondPhase +
      tasksQueued.media;
    const totalAiRan = tasksQueued.aiAnalysis;
    const isIdle = totalGaps === 0 && totalQueued === 0 && totalAiRan === 0;

    if (isIdle) {
      console.log(
        '[ContinuousOrchestrator] Idle: no gaps, no tasks queued, no AI analysis run. Running idle action.'
      );
      emitResearchJobEvent({
        researchJobId,
        source: 'continuous-orchestrator',
        code: 'orchestration.idle',
        level: 'info',
        message: 'No gaps and no tasks; running idle enhancement.',
      });
      try {
        if (isOpenAiConfiguredForRealMode()) {
          const jobWithClient = await prisma.researchJob.findUnique({
            where: { id: researchJobId },
            include: {
              client: {
                include: {
                  clientAccounts: { select: { platform: true, handle: true, bio: true } },
                },
              },
            },
          });
          const answered = await prisma.aiQuestion.findMany({
            where: { researchJobId, isAnswered: true },
            select: { questionType: true },
          });
          const answeredSet = new Set(answered.map((q) => q.questionType));
          const allTypes = [
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
            'COMPETITOR_DISCOVERY_METHOD',
          ] as const;
          const oneUnanswered = allTypes.find((t) => !answeredSet.has(t));
          if (oneUnanswered && jobWithClient?.client) {
            const input = (jobWithClient.inputData as Record<string, unknown>) || {};
            const accs = jobWithClient.client.clientAccounts;
            const ig = accs.find((a) => a.platform === 'instagram');
            const first = accs[0];
            const handle = String(
              input.handle ?? (input.handles as Record<string, string>)?.instagram ?? ig?.handle ?? first?.handle ?? ''
            ).trim();
            const brandName = String(
              input.brandName ?? jobWithClient.client.name ?? handle
            ).trim();
            const { askDeepQuestion } = await import('../ai/deep-questions');
            const result = await askDeepQuestion(
              researchJobId,
              oneUnanswered,
              {
                brandName: brandName || 'Brand',
                handle: handle || undefined,
                bio: ig?.bio ?? first?.bio ?? undefined,
                niche: 'business',
              }
            );
            console.log(
              `[ContinuousOrchestrator] Idle: asked 1 question (${oneUnanswered})`
            );
            emitResearchJobEvent({
              researchJobId,
              source: 'continuous-orchestrator',
              code: 'orchestration.idle.asked_question',
              level: 'info',
              message: `Idle: asked 1 question (${oneUnanswered})`,
              metadata: { questionType: oneUnanswered },
            });
          } else {
            console.log(
              '[ContinuousOrchestrator] Idle: all questions answered or no client; no question to ask'
            );
            emitResearchJobEvent({
              researchJobId,
              source: 'continuous-orchestrator',
              code: 'orchestration.idle.skipped',
              level: 'info',
              message: 'Idle: no unanswered question or no client',
              metadata: { reason: !oneUnanswered ? 'all_answered' : 'no_client' },
            });
          }
          // When we took an idle action (asked a question), post to Brain Workspace chat
          if (oneUnanswered && jobWithClient?.client) {
            await prisma.brainCommand.create({
              data: {
                researchJobId,
                section: 'brain',
                commandType: 'UPDATE_CONTEXT',
                instruction: `BAT: Asked a deep question (${oneUnanswered}). Check research for the new answer.`,
                status: 'APPLIED',
                createdBy: 'orchestrator',
              },
            });
          }
        } else {
          console.log(
            '[ContinuousOrchestrator] Idle: skipped ask question (OpenAI not configured)'
          );
          emitResearchJobEvent({
            researchJobId,
            source: 'continuous-orchestrator',
            code: 'orchestration.idle.skipped',
            level: 'info',
            message: 'Idle: OpenAI not configured',
            metadata: { reason: 'openai_not_configured' },
          });
        }
      } catch (idleError: any) {
        console.error('[ContinuousOrchestrator] Idle action failed:', idleError?.message ?? idleError);
        emitResearchJobEvent({
          researchJobId,
          source: 'continuous-orchestrator',
          code: 'orchestration.idle.failed',
          level: 'warn',
          message: `Idle action failed: ${idleError?.message ?? 'Unknown error'}`,
          metadata: { error: idleError?.message },
        });
      }
    }

    emitResearchJobEvent({
      researchJobId,
      source: 'continuous-orchestrator',
      code: 'orchestration.cycle.completed',
      level: 'info',
      message: `Orchestration cycle complete: ${totalGaps} gaps, ${totalQueued} tasks queued, ${totalAiRan} media analyzed`,
      metrics: {
        duration,
        gaps: totalGaps,
        tasksQueued: totalQueued,
        aiAnalysisRan: totalAiRan,
        clientGaps: {
          missingTikTok: clientGaps.missingTikTok,
          staleFollowerCounts: clientGaps.staleFollowerCounts,
          missingRecentPosts: clientGaps.missingRecentPosts,
          incompleteInstagramMetadata: clientGaps.incompleteInstagramMetadata,
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
      `[ContinuousOrchestrator] Cycle complete (${duration}ms): ${totalGaps} gaps, ${totalQueued} tasks queued, ${totalAiRan} media analyzed`
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
