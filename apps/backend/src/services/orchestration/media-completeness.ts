import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';
import { downloadSnapshotMedia } from '../media/downloader';

export interface MediaGaps {
  missingDownloads: number;
  failedDownloads: number;
  clientSnapshotIds: string[];
  competitorSnapshotIds: string[];
}

/** Don't re-queue the same snapshot for media download within this window (avoids hammering cooldown/failing posts every cycle). */
const MEDIA_DOWNLOAD_QUEUE_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Find snapshots with posts that have no MediaAssets and that are not recently queued (throttle re-queue).
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
  const throttleBefore = new Date(Date.now() - MEDIA_DOWNLOAD_QUEUE_THROTTLE_MS);
  const snapshots = await prisma.clientProfileSnapshot.findMany({
    where: {
      researchJobId,
      posts: {
        some: {
          mediaAssets: { none: {} },
        },
      },
      OR: [
        { lastMediaDownloadQueuedAt: null },
        { lastMediaDownloadQueuedAt: { lt: throttleBefore } },
      ],
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
  const throttleBefore = new Date(Date.now() - MEDIA_DOWNLOAD_QUEUE_THROTTLE_MS);
  const snapshots = await prisma.competitorProfileSnapshot.findMany({
    where: {
      researchJobId,
      posts: {
        some: {
          mediaAssets: { none: {} },
        },
      },
      OR: [
        { lastMediaDownloadQueuedAt: null },
        { lastMediaDownloadQueuedAt: { lt: throttleBefore } },
      ],
    },
    select: { id: true },
    orderBy: { scrapedAt: 'desc' },
    take: 30,
  });

  return snapshots;
}

/**
 * Queue media download tasks for snapshots with missing media.
 * Sets lastMediaDownloadQueuedAt so we don't re-queue the same snapshot every cycle (throttle).
 */
export async function queueMediaDownloadTasks(
  researchJobId: string,
  gaps: MediaGaps
): Promise<number> {
  let queuedCount = 0;
  const now = new Date();

  for (const snapshotId of gaps.clientSnapshotIds) {
    await prisma.clientProfileSnapshot.updateMany({
      where: { id: snapshotId },
      data: { lastMediaDownloadQueuedAt: now },
    });
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
    await prisma.competitorProfileSnapshot.updateMany({
      where: { id: snapshotId },
      data: { lastMediaDownloadQueuedAt: now },
    });
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
