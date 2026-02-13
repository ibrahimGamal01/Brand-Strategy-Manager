import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';
import { downloadSnapshotMedia } from '../media/downloader';

export interface MediaGaps {
  missingDownloads: number;
  failedDownloads: number;
  clientSnapshotIds: string[];
  competitorSnapshotIds: string[];
}

/**
 * Find snapshots with posts that have no MediaAssets
 */
export async function checkMediaGaps(researchJobId: string): Promise<MediaGaps> {
  const [clientSnapshotsWithGaps, competitorSnapshotsWithGaps] = await Promise.all([
    findClientSnapshotsWithMissingMedia(researchJobId),
    findCompetitorSnapshotsWithMissingMedia(researchJobId),
  ]);

  const clientSnapshotIds = clientSnapshotsWithGaps.map((s) => s.id);
  const competitorSnapshotIds = competitorSnapshotsWithGaps.map((s) => s.id);
  const totalMissing = clientSnapshotIds.length + competitorSnapshotIds.length;

  return {
    missingDownloads: totalMissing,
    failedDownloads: 0, // Could be extended to track failed downloads
    clientSnapshotIds,
    competitorSnapshotIds,
  };
}

async function findClientSnapshotsWithMissingMedia(
  researchJobId: string
): Promise<{ id: string }[]> {
  const snapshots = await prisma.clientProfileSnapshot.findMany({
    where: {
      researchJobId,
      posts: {
        some: {
          mediaAssets: { none: {} },
        },
      },
    },
    select: { id: true },
    orderBy: { scrapedAt: 'desc' },
    take: 20,
  });

  return snapshots;
}

async function findCompetitorSnapshotsWithMissingMedia(
  researchJobId: string
): Promise<{ id: string }[]> {
  const snapshots = await prisma.competitorProfileSnapshot.findMany({
    where: {
      researchJobId,
      posts: {
        some: {
          mediaAssets: { none: {} },
        },
      },
    },
    select: { id: true },
    orderBy: { scrapedAt: 'desc' },
    take: 30,
  });

  return snapshots;
}

/**
 * Queue media download tasks for snapshots with missing media
 */
export async function queueMediaDownloadTasks(
  researchJobId: string,
  gaps: MediaGaps
): Promise<number> {
  let queuedCount = 0;

  for (const snapshotId of gaps.clientSnapshotIds) {
    downloadSnapshotMedia('client', snapshotId)
      .then((downloaded) => {
        if (downloaded > 0) {
          emitResearchJobEvent({
            researchJobId,
            source: 'media-completeness',
            code: 'media.download.client.completed',
            level: 'info',
            message: `Client snapshot media: ${downloaded} files downloaded`,
            metadata: { snapshotId, downloaded },
          });
        }
      })
      .catch((err) => {
        console.error(`[MediaCompleteness] Client snapshot ${snapshotId} download failed:`, err);
        emitResearchJobEvent({
          researchJobId,
          source: 'media-completeness',
          code: 'media.download.client.failed',
          level: 'error',
          message: `Client snapshot media download failed: ${(err as Error).message}`,
          metadata: { snapshotId, error: (err as Error).message },
        });
      });
    queuedCount++;
  }

  for (const snapshotId of gaps.competitorSnapshotIds) {
    downloadSnapshotMedia('competitor', snapshotId)
      .then((downloaded) => {
        if (downloaded > 0) {
          emitResearchJobEvent({
            researchJobId,
            source: 'media-completeness',
            code: 'media.download.competitor.completed',
            level: 'info',
            message: `Competitor snapshot media: ${downloaded} files downloaded`,
            metadata: { snapshotId, downloaded },
          });
        }
      })
      .catch((err) => {
        console.error(
          `[MediaCompleteness] Competitor snapshot ${snapshotId} download failed:`,
          err
        );
        emitResearchJobEvent({
          researchJobId,
          source: 'media-completeness',
          code: 'media.download.competitor.failed',
          level: 'error',
          message: `Competitor snapshot media download failed: ${(err as Error).message}`,
          metadata: { snapshotId, error: (err as Error).message },
        });
      });
    queuedCount++;
  }

  if (queuedCount > 0) {
    console.log(
      `[MediaCompleteness] Queued ${queuedCount} media download tasks (${gaps.clientSnapshotIds.length} client, ${gaps.competitorSnapshotIds.length} competitor)`
    );
  }

  return queuedCount;
}
