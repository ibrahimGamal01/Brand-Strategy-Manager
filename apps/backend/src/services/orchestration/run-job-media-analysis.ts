import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';
import { isOpenAiConfiguredForRealMode } from '../../lib/runtime-preflight';
import { analyzeMediaAsset } from '../ai/media-content-analyzer';
import {
  buildQualifiedContentPool,
  QualifiedContentPost,
} from './content-qualification';
import {
  countDownloadedMediaAssetsForJob,
  createMediaAnalysisRun,
  finalizeMediaAnalysisRun,
  MediaAnalysisScopeCounters,
} from './media-analysis-runs';

const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_ELIGIBLE_ASSETS = 96;
const DEFAULT_MAX_ELIGIBLE_POSTS = 120;
const DEFAULT_CLIENT_POST_SHARE = 0.65;
const DEFAULT_COMPETITOR_PER_HANDLE_CAP = 4;

export interface RunAiAnalysisForJobResult {
  runId?: string;
  ran: number;
  succeeded: number;
  failed: number;
  errors?: Array<{ mediaAssetId: string; error?: string }>;
  skipped: boolean;
  reason?: string;
  analysisScope?: MediaAnalysisScopeCounters;
  /** IDs of assets we actually ran analysis on (for cost control: only validate/enrich these). */
  processedAssetIds?: string[];
}

function postScore(post: QualifiedContentPost): number {
  const likes = Number(post.likesCount || 0);
  const comments = Number(post.commentsCount || 0);
  const views = Number(post.viewsCount || post.playsCount || 0);
  const postedAt = post.postedAt ? new Date(post.postedAt).getTime() : 0;
  const recencyBoost = postedAt > 0 ? postedAt / 1e13 : 0;
  return likes + comments * 2 + views * 0.1 + recencyBoost;
}

function pickPrioritizedPosts(posts: QualifiedContentPost[], maxPosts: number): QualifiedContentPost[] {
  const sortedClient = posts
    .filter((post) => post.source === 'client')
    .sort((a, b) => postScore(b) - postScore(a));
  const sortedCompetitor = posts
    .filter((post) => post.source === 'competitor')
    .sort((a, b) => postScore(b) - postScore(a));

  const clientQuota = Math.max(1, Math.round(maxPosts * DEFAULT_CLIENT_POST_SHARE));
  const competitorQuota = Math.max(0, maxPosts - clientQuota);

  const selected = new Map<string, QualifiedContentPost>();
  for (const post of sortedClient.slice(0, clientQuota)) {
    selected.set(post.postId, post);
  }

  const competitorGroups = new Map<string, QualifiedContentPost[]>();
  for (const post of sortedCompetitor) {
    const key = `${post.platform}:${String(post.handle || '').toLowerCase()}`;
    const list = competitorGroups.get(key) || [];
    list.push(post);
    competitorGroups.set(key, list);
  }
  const groupKeys = Array.from(competitorGroups.keys());
  const groupIndices = new Map<string, number>(groupKeys.map((key) => [key, 0]));
  const pickedPerGroup = new Map<string, number>();

  let competitorPicked = 0;
  while (competitorPicked < competitorQuota && groupKeys.length > 0) {
    let progressed = false;
    for (const key of groupKeys) {
      if (competitorPicked >= competitorQuota) break;
      const list = competitorGroups.get(key) || [];
      const index = groupIndices.get(key) || 0;
      if (index >= list.length) continue;
      const alreadyPicked = pickedPerGroup.get(key) || 0;
      if (alreadyPicked >= DEFAULT_COMPETITOR_PER_HANDLE_CAP) continue;
      const post = list[index];
      groupIndices.set(key, index + 1);
      pickedPerGroup.set(key, alreadyPicked + 1);
      if (selected.has(post.postId)) continue;
      selected.set(post.postId, post);
      competitorPicked += 1;
      progressed = true;
    }
    if (!progressed) break;
  }

  if (selected.size < maxPosts) {
    const remaining = [...posts].sort((a, b) => postScore(b) - postScore(a));
    for (const post of remaining) {
      if (selected.size >= maxPosts) break;
      if (selected.has(post.postId)) continue;
      selected.set(post.postId, post);
    }
  }

  return Array.from(selected.values()).slice(0, maxPosts);
}

function pickPrioritizedMediaAssetIds(
  posts: QualifiedContentPost[],
  maxAssets: number
): string[] {
  const ordered = [...posts].sort((a, b) => postScore(b) - postScore(a));
  const set = new Set<string>();
  for (const post of ordered) {
    for (const assetId of post.mediaAssetIds || []) {
      if (set.size >= maxAssets) break;
      if (!assetId) continue;
      set.add(assetId);
    }
    if (set.size >= maxAssets) break;
  }
  return Array.from(set);
}

function countQualifiedMediaAssetIds(posts: QualifiedContentPost[]): number {
  const ids = new Set<string>();
  for (const post of posts) {
    for (const id of post.mediaAssetIds || []) {
      if (!id) continue;
      ids.add(id);
    }
  }
  return ids.size;
}

function hasAiAnalysis(asset: { aiAnalyses?: unknown[] }): boolean {
  return Array.isArray(asset.aiAnalyses) && asset.aiAnalyses.length > 0;
}

/**
 * Run AI content analysis on downloaded-but-unanalyzed MediaAssets for a research job.
 * Processes "posts with metrics" (downloaded media) only. Same query as POST /api/research-jobs/:id/analyze-media.
 * Capped per cycle to avoid long runs and rate limits.
 */
export async function runAiAnalysisForJob(
  researchJobId: string,
  options: {
    limit?: number;
    allowDegraded?: boolean;
    skipAlreadyAnalyzed?: boolean;
    maxEligibleAssets?: number;
    maxEligiblePosts?: number;
  } = {}
): Promise<RunAiAnalysisForJobResult> {
  const limit = Math.max(1, Math.min(50, options.limit ?? DEFAULT_LIMIT));
  const allowDegraded = options.allowDegraded === true;
  const skipAlreadyAnalyzed = options.skipAlreadyAnalyzed !== false;
  const maxEligibleAssets = Math.max(
    20,
    Math.min(240, Number(options.maxEligibleAssets || DEFAULT_MAX_ELIGIBLE_ASSETS))
  );
  const maxEligiblePosts = Math.max(
    30,
    Math.min(300, Number(options.maxEligiblePosts || DEFAULT_MAX_ELIGIBLE_POSTS))
  );
  const analysisScope: MediaAnalysisScopeCounters = {
    downloadedTotal: await countDownloadedMediaAssetsForJob(researchJobId),
    qualifiedForAi: 0,
    analysisWindow: 0,
    analyzedInWindow: 0,
  };

  let runId: string | undefined;
  try {
    runId = await createMediaAnalysisRun({
      researchJobId,
      allowDegraded,
      skipAlreadyAnalyzed,
      requestedLimit: limit,
      maxEligibleAssets,
      maxEligiblePosts,
      scope: analysisScope,
      diagnostics: {
        stage: 'initialized',
      },
    });
  } catch (error: any) {
    console.warn('[Orchestrator] Failed to persist media analysis run start:', error?.message || error);
  }

  const finalizeRun = async (input: Parameters<typeof finalizeMediaAnalysisRun>[1]) => {
    if (!runId) return;
    try {
      await finalizeMediaAnalysisRun(runId, input);
    } catch (error: any) {
      console.warn('[Orchestrator] Failed to persist media analysis run completion:', error?.message || error);
    }
  };

  try {
    if (!isOpenAiConfiguredForRealMode()) {
      console.log(`[Orchestrator] AI media analysis: skipped (OpenAI not configured)`);
      await finalizeRun({
        status: 'SKIPPED',
        scope: analysisScope,
        attemptedAssets: 0,
        succeeded: 0,
        failed: 0,
        skippedReason: 'openai_not_configured',
        diagnostics: { stage: 'preflight' },
      });
      return {
        runId,
        ran: 0,
        succeeded: 0,
        failed: 0,
        skipped: true,
        reason: 'openai_not_configured',
        analysisScope,
      };
    }

    const qualifiedPool = await buildQualifiedContentPool(researchJobId, {
      allowDegradedSnapshots: allowDegraded,
      requireScopedCompetitors: true,
      maxClientSnapshots: 6,
      maxCompetitorSnapshots: 16,
      maxPostsPerSnapshot: 100,
    });
    analysisScope.qualifiedForAi = countQualifiedMediaAssetIds(qualifiedPool.posts);

    if (qualifiedPool.posts.length === 0) {
      console.log('[Orchestrator] AI media analysis: no readiness-qualified posts in scoped pool');
      emitResearchJobEvent({
        researchJobId,
        source: 'continuous-orchestrator',
        code: 'media.analysis.skipped_not_ready',
        level: 'warn',
        message: 'AI media analysis skipped: no readiness-qualified scoped posts',
        metadata: {
          runId,
          allowDegraded,
          readyClientSnapshots: qualifiedPool.summary.readySnapshotCounts.client,
          readyCompetitorSnapshots: qualifiedPool.summary.readySnapshotCounts.competitor,
          droppedNoMedia: qualifiedPool.summary.droppedNoMedia,
          droppedNoMetrics: qualifiedPool.summary.droppedNoMetrics,
          droppedOutOfScopeCompetitor: qualifiedPool.summary.droppedOutOfScopeCompetitor,
        },
      });
      await finalizeRun({
        status: 'SKIPPED',
        scope: analysisScope,
        attemptedAssets: 0,
        succeeded: 0,
        failed: 0,
        skippedReason: 'no_qualified_scoped_posts',
        diagnostics: {
          readyClientSnapshots: qualifiedPool.summary.readySnapshotCounts.client,
          readyCompetitorSnapshots: qualifiedPool.summary.readySnapshotCounts.competitor,
          droppedNoMedia: qualifiedPool.summary.droppedNoMedia,
          droppedNoMetrics: qualifiedPool.summary.droppedNoMetrics,
          droppedOutOfScopeCompetitor: qualifiedPool.summary.droppedOutOfScopeCompetitor,
        },
      });
      return {
        runId,
        ran: 0,
        succeeded: 0,
        failed: 0,
        skipped: true,
        reason: 'no_qualified_scoped_posts',
        analysisScope,
      };
    }

    const prioritizedPosts = pickPrioritizedPosts(qualifiedPool.posts, maxEligiblePosts);
    const qualifiedMediaAssetIds = pickPrioritizedMediaAssetIds(prioritizedPosts, maxEligibleAssets);
    if (qualifiedMediaAssetIds.length === 0) {
      console.log('[Orchestrator] AI media analysis: qualified posts found but no media assets linked');
      await finalizeRun({
        status: 'SKIPPED',
        scope: analysisScope,
        attemptedAssets: 0,
        succeeded: 0,
        failed: 0,
        skippedReason: 'no_qualified_media_assets',
        diagnostics: {
          qualifiedPosts: qualifiedPool.summary.qualifiedPosts,
          prioritizedPosts: prioritizedPosts.length,
        },
      });
      return {
        runId,
        ran: 0,
        succeeded: 0,
        failed: 0,
        skipped: true,
        reason: 'no_qualified_media_assets',
        analysisScope,
      };
    }

    const job = await prisma.researchJob.findUnique({
      where: { id: researchJobId },
      select: {
        inputData: true,
        client: { select: { name: true } },
      },
    });

    const inputData = (job?.inputData || {}) as Record<string, unknown>;
    const brandName = (inputData.brandName as string) || job?.client?.name || '';
    const niche = (inputData.niche as string) || 'business';
    const platform = (inputData.platform as string) || (inputData.handle ? 'instagram' : '') || '';

    const allAssets = await prisma.mediaAsset.findMany({
      where: {
        id: { in: qualifiedMediaAssetIds },
        isDownloaded: true,
        blobStoragePath: { not: null },
      },
      select: {
        id: true,
        mediaType: true,
        blobStoragePath: true,
        socialPostId: true,
        clientPostSnapshotId: true,
        competitorPostSnapshotId: true,
        aiAnalyses: true,
      },
    });

    analysisScope.analysisWindow = allAssets.length;
    analysisScope.analyzedInWindow = allAssets.filter(hasAiAnalysis).length;

    const candidates = skipAlreadyAnalyzed
      ? allAssets.filter((a) => !hasAiAnalysis(a))
      : allAssets;
    const toProcess = candidates.slice(0, limit);

    if (toProcess.length === 0) {
      if (allAssets.length === 0) {
        console.log(
          `[Orchestrator] AI media analysis: no downloaded assets in qualified scoped pool`
        );
        await finalizeRun({
          status: 'SKIPPED',
          scope: analysisScope,
          attemptedAssets: 0,
          succeeded: 0,
          failed: 0,
          skippedReason: 'no_downloaded_assets',
          diagnostics: {
            qualifiedMediaAssetIds: qualifiedMediaAssetIds.length,
          },
        });
        return {
          runId,
          ran: 0,
          succeeded: 0,
          failed: 0,
          skipped: true,
          reason: 'no_downloaded_assets',
          analysisScope,
        };
      }
      console.log(
        `[Orchestrator] AI media analysis: all ${allAssets.length} readiness-qualified asset(s) already analyzed`
      );
      await finalizeRun({
        status: 'SKIPPED',
        scope: analysisScope,
        attemptedAssets: 0,
        succeeded: 0,
        failed: 0,
        skippedReason: 'no_unanalyzed_media',
        diagnostics: {
          analysisWindow: allAssets.length,
          analyzedInWindow: analysisScope.analyzedInWindow,
        },
      });
      return {
        runId,
        ran: 0,
        succeeded: 0,
        failed: 0,
        skipped: true,
        reason: 'no_unanalyzed_media',
        analysisScope,
      };
    }

    console.log(
      `[Orchestrator] AI media analysis: ${toProcess.length} assets to analyze (cap ${limit}, ${candidates.length} eligible)`
    );

    emitResearchJobEvent({
      researchJobId,
      source: 'continuous-orchestrator',
      code: 'media.ai_analysis.started',
      level: 'info',
      message: `AI media analysis started: ${toProcess.length} asset(s)`,
      metrics: {
        toProcess: toProcess.length,
        cap: limit,
        totalEligible: candidates.length,
        downloadedTotal: analysisScope.downloadedTotal,
        qualifiedForAi: analysisScope.qualifiedForAi,
        analysisWindow: analysisScope.analysisWindow,
        analyzedInWindow: analysisScope.analyzedInWindow,
      },
      metadata: {
        runId,
        allowDegraded,
        readyClientSnapshots: qualifiedPool.summary.readySnapshotCounts.client,
        readyCompetitorSnapshots: qualifiedPool.summary.readySnapshotCounts.competitor,
        qualifiedPosts: qualifiedPool.summary.qualifiedPosts,
        prioritizedPosts: prioritizedPosts.length,
        droppedOutOfScopeCompetitor: qualifiedPool.summary.droppedOutOfScopeCompetitor,
        qualifiedMediaAssetIds: qualifiedMediaAssetIds.length,
        maxEligibleAssets,
        maxEligiblePosts,
      },
    });

    const withJobId = toProcess.map(
      ({ aiAnalyses: _unused, ...a }) => ({
        ...a,
        researchJobId,
      })
    );

    const analysisContext = {
      brandName: brandName || undefined,
      niche: niche || undefined,
      platform: platform || undefined,
    };

    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ mediaAssetId: string; error?: string }> = [];
    const processedAssetIds: string[] = [];

    for (const asset of withJobId) {
      processedAssetIds.push(asset.id);
      const source: 'client' | 'competitor' = asset.competitorPostSnapshotId
        ? 'competitor'
        : 'client';
      const context = { ...analysisContext, source };
      try {
        const result = await analyzeMediaAsset(asset, context);
        if (result.success) {
          succeeded++;
        } else {
          failed++;
          errors.push({ mediaAssetId: asset.id, error: result.error });
          emitResearchJobEvent({
            researchJobId,
            source: 'continuous-orchestrator',
            code: 'media.ai_analysis.asset_failed',
            level: 'warn',
            message: `AI analysis failed for asset ${asset.id}`,
            metadata: { runId, mediaAssetId: asset.id, error: result.error },
          });
        }
      } catch (e: any) {
        failed++;
        const errMsg = e?.message || 'Unknown error';
        errors.push({ mediaAssetId: asset.id, error: errMsg });
        emitResearchJobEvent({
          researchJobId,
          source: 'continuous-orchestrator',
          code: 'media.ai_analysis.asset_failed',
          level: 'warn',
          message: `AI analysis failed for asset ${asset.id}`,
          metadata: { runId, mediaAssetId: asset.id, error: errMsg },
        });
      }
    }

    analysisScope.analyzedInWindow =
      allAssets.length > 0
        ? await prisma.mediaAsset.count({
            where: {
              id: { in: allAssets.map((asset) => asset.id) },
              aiAnalyses: { some: {} },
            },
          })
        : 0;

    console.log(
      `[Orchestrator] AI media analysis complete: succeeded ${succeeded}, failed ${failed}`
    );

    await finalizeRun({
      status: 'COMPLETE',
      scope: analysisScope,
      attemptedAssets: toProcess.length,
      succeeded,
      failed,
      diagnostics: errors.length > 0 ? { errors: errors.slice(0, 10) } : undefined,
    });

    emitResearchJobEvent({
      researchJobId,
      source: 'continuous-orchestrator',
      code: 'media.ai_analysis.completed',
      level: 'info',
      message: `AI media analysis complete: ${succeeded} succeeded, ${failed} failed`,
      metrics: {
        ran: toProcess.length,
        succeeded,
        failed,
        downloadedTotal: analysisScope.downloadedTotal,
        qualifiedForAi: analysisScope.qualifiedForAi,
        analysisWindow: analysisScope.analysisWindow,
        analyzedInWindow: analysisScope.analyzedInWindow,
      },
      metadata: errors.length > 0 ? { runId, errors: errors.slice(0, 10) } : { runId },
    });

    return {
      runId,
      ran: toProcess.length,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      skipped: false,
      analysisScope,
      processedAssetIds,
    };
  } catch (error: any) {
    await finalizeRun({
      status: 'FAILED',
      scope: analysisScope,
      attemptedAssets: 0,
      succeeded: 0,
      failed: 0,
      skippedReason: 'run_failed',
      diagnostics: {
        error: error?.message || String(error),
      },
    });
    throw error;
  }
}
