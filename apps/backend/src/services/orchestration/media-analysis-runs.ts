import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export interface MediaAnalysisScopeCounters {
  downloadedTotal: number;
  qualifiedForAi: number;
  analysisWindow: number;
  analyzedInWindow: number;
}

export interface MediaAnalysisRunSummary {
  runId: string;
  status: 'RUNNING' | 'COMPLETE' | 'SKIPPED' | 'FAILED';
  downloadedTotal: number;
  qualifiedForAi: number;
  analysisWindow: number;
  analyzedInWindow: number;
  attemptedAssets: number;
  succeeded: number;
  failed: number;
  skippedReason: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface CreateMediaAnalysisRunInput {
  researchJobId: string;
  allowDegraded: boolean;
  skipAlreadyAnalyzed: boolean;
  requestedLimit: number;
  maxEligibleAssets: number;
  maxEligiblePosts: number;
  scope: MediaAnalysisScopeCounters;
  diagnostics?: Record<string, unknown>;
}

export interface FinalizeMediaAnalysisRunInput {
  status: 'COMPLETE' | 'SKIPPED' | 'FAILED';
  scope: MediaAnalysisScopeCounters;
  attemptedAssets: number;
  succeeded: number;
  failed: number;
  skippedReason?: string;
  diagnostics?: Record<string, unknown>;
}

function toNonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as Prisma.InputJsonValue;
}

export function downloadedMediaWhereForJob(researchJobId: string): Prisma.MediaAssetWhereInput {
  return {
    isDownloaded: true,
    blobStoragePath: { not: null },
    OR: [
      {
        clientPostSnapshot: {
          clientProfileSnapshot: {
            researchJobId,
          },
        },
      },
      {
        competitorPostSnapshot: {
          competitorProfileSnapshot: {
            researchJobId,
          },
        },
      },
      {
        socialPost: {
          is: {
            socialProfile: {
              researchJobId,
            },
          },
        },
      },
    ],
  };
}

export async function countDownloadedMediaAssetsForJob(researchJobId: string): Promise<number> {
  return prisma.mediaAsset.count({
    where: downloadedMediaWhereForJob(researchJobId),
  });
}

export async function createMediaAnalysisRun(input: CreateMediaAnalysisRunInput): Promise<string> {
  const created = await prisma.mediaAnalysisRun.create({
    data: {
      researchJobId: input.researchJobId,
      status: 'RUNNING',
      allowDegraded: Boolean(input.allowDegraded),
      skipAlreadyAnalyzed: Boolean(input.skipAlreadyAnalyzed),
      requestedLimit: toNonNegativeInt(input.requestedLimit),
      maxEligibleAssets: toNonNegativeInt(input.maxEligibleAssets),
      maxEligiblePosts: toNonNegativeInt(input.maxEligiblePosts),
      downloadedTotal: toNonNegativeInt(input.scope.downloadedTotal),
      qualifiedForAi: toNonNegativeInt(input.scope.qualifiedForAi),
      analysisWindow: toNonNegativeInt(input.scope.analysisWindow),
      analyzedInWindow: toNonNegativeInt(input.scope.analyzedInWindow),
      diagnostics: toJson(input.diagnostics),
    },
    select: { id: true },
  });

  return created.id;
}

export async function finalizeMediaAnalysisRun(
  runId: string,
  input: FinalizeMediaAnalysisRunInput
): Promise<void> {
  await prisma.mediaAnalysisRun.update({
    where: { id: runId },
    data: {
      status: input.status,
      downloadedTotal: toNonNegativeInt(input.scope.downloadedTotal),
      qualifiedForAi: toNonNegativeInt(input.scope.qualifiedForAi),
      analysisWindow: toNonNegativeInt(input.scope.analysisWindow),
      analyzedInWindow: toNonNegativeInt(input.scope.analyzedInWindow),
      attemptedAssets: toNonNegativeInt(input.attemptedAssets),
      succeededCount: toNonNegativeInt(input.succeeded),
      failedCount: toNonNegativeInt(input.failed),
      skippedReason: input.skippedReason || null,
      diagnostics: toJson(input.diagnostics),
      completedAt: new Date(),
    },
  });
}

export async function getLatestMediaAnalysisRunSummary(
  researchJobId: string
): Promise<MediaAnalysisRunSummary | null> {
  const latest = await prisma.mediaAnalysisRun.findFirst({
    where: { researchJobId },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      status: true,
      downloadedTotal: true,
      qualifiedForAi: true,
      analysisWindow: true,
      analyzedInWindow: true,
      attemptedAssets: true,
      succeededCount: true,
      failedCount: true,
      skippedReason: true,
      startedAt: true,
      completedAt: true,
    },
  });

  if (!latest) return null;

  return {
    runId: latest.id,
    status: latest.status,
    downloadedTotal: latest.downloadedTotal,
    qualifiedForAi: latest.qualifiedForAi,
    analysisWindow: latest.analysisWindow,
    analyzedInWindow: latest.analyzedInWindow,
    attemptedAssets: latest.attemptedAssets,
    succeeded: latest.succeededCount,
    failed: latest.failedCount,
    skippedReason: latest.skippedReason || null,
    startedAt: latest.startedAt.toISOString(),
    completedAt: latest.completedAt ? latest.completedAt.toISOString() : null,
  };
}
