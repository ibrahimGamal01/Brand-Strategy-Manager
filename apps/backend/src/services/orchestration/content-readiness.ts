import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';

export type SnapshotReadinessStatus = 'READY' | 'DEGRADED' | 'BLOCKED';

export interface SnapshotReadinessScore {
  snapshotId: string;
  score: number;
  status: SnapshotReadinessStatus;
  reasons: string[];
  metrics: {
    postsScraped: number;
    postsWithMedia: number;
    mediaCoverage: number;
    postsWithLikesOrViews: number;
    metricsCompleteness: number;
    uniqueCaptionRatio: number;
    medianPostAgeDays: number | null;
  };
}

export interface JobSnapshotReadinessSummary {
  client: SnapshotReadinessScore[];
  competitor: SnapshotReadinessScore[];
}

export interface EligibleSnapshotSets {
  clientSnapshotIds: Set<string>;
  competitorSnapshotIds: Set<string>;
  summary: JobSnapshotReadinessSummary;
}

interface PostLikeShape {
  caption: string | null;
  postedAt: Date | null;
  likesCount?: number | null;
  viewsCount?: number | null;
  playsCount?: number | null;
  mediaAssets: Array<{ id: string }>;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function computeReadiness(snapshotId: string, posts: PostLikeShape[]): SnapshotReadinessScore {
  const now = Date.now();
  const postsScraped = posts.length;
  const postsWithMedia = posts.filter((post) => post.mediaAssets.length > 0).length;
  const mediaCoverage = postsScraped > 0 ? postsWithMedia / postsScraped : 0;

  const postsWithLikesOrViews = posts.filter((post) => {
    const likes = Number(post.likesCount || 0);
    const views = Number(post.viewsCount || post.playsCount || 0);
    return likes > 0 || views > 0;
  }).length;
  const metricsCompleteness = postsScraped > 0 ? postsWithLikesOrViews / postsScraped : 0;

  const normalizedCaptions = posts
    .map((post) => String(post.caption || '').trim().toLowerCase())
    .filter(Boolean);
  const uniqueCaptionRatio =
    postsScraped > 0 ? new Set(normalizedCaptions).size / postsScraped : 0;

  const postAgeDays = posts
    .map((post) => {
      if (!post.postedAt) return null;
      const diffMs = now - new Date(post.postedAt).getTime();
      if (!Number.isFinite(diffMs) || diffMs < 0) return null;
      return diffMs / (1000 * 60 * 60 * 24);
    })
    .filter((value): value is number => value != null);

  const medianPostAgeDays = median(postAgeDays);
  const postCountScore = Math.min(postsScraped / 12, 1) * 30;
  const mediaCoverageScore = mediaCoverage * 30;
  const metricsCompletenessScore = metricsCompleteness * 25;
  const uniquenessScore = Math.max(0, Math.min(uniqueCaptionRatio, 1)) * 10;
  const freshnessScore = medianPostAgeDays != null && medianPostAgeDays <= 45 ? 5 : 0;

  const score = round2(
    postCountScore + mediaCoverageScore + metricsCompletenessScore + uniquenessScore + freshnessScore
  );

  const reasons: string[] = [];
  const criticalNoPosts = postsScraped === 0;
  const criticalLowMediaCoverage = postsScraped > 0 && mediaCoverage < 0.2;

  if (criticalNoPosts) reasons.push('NO_POSTS_SCRAPED');
  if (criticalLowMediaCoverage) reasons.push('LOW_MEDIA_COVERAGE_CRITICAL');
  if (postsScraped > 0 && postsScraped < 6) reasons.push('LOW_POST_COUNT');
  if (metricsCompleteness < 0.4) reasons.push('LOW_METRICS_COMPLETENESS');
  if (uniqueCaptionRatio < 0.35) reasons.push('LOW_CAPTION_UNIQUENESS');
  if (medianPostAgeDays != null && medianPostAgeDays > 45) reasons.push('STALE_POSTS');

  let status: SnapshotReadinessStatus;
  if (criticalNoPosts || criticalLowMediaCoverage || score < 50) {
    status = 'BLOCKED';
  } else if (score >= 70 && postsScraped >= 6) {
    status = 'READY';
  } else {
    status = 'DEGRADED';
  }

  return {
    snapshotId,
    score,
    status,
    reasons,
    metrics: {
      postsScraped,
      postsWithMedia,
      mediaCoverage: round2(mediaCoverage),
      postsWithLikesOrViews,
      metricsCompleteness: round2(metricsCompleteness),
      uniqueCaptionRatio: round2(uniqueCaptionRatio),
      medianPostAgeDays: medianPostAgeDays != null ? round2(medianPostAgeDays) : null,
    },
  };
}

async function scoreClientSnapshots(researchJobId: string): Promise<SnapshotReadinessScore[]> {
  const snapshots = await prisma.clientProfileSnapshot.findMany({
    where: { researchJobId },
    include: {
      posts: {
        select: {
          caption: true,
          postedAt: true,
          likesCount: true,
          viewsCount: true,
          playsCount: true,
          mediaAssets: {
            select: { id: true },
          },
        },
      },
    },
  });

  const scored = snapshots.map((snapshot) => computeReadiness(snapshot.id, snapshot.posts));

  await Promise.all(
    scored.map((row) =>
      prisma.clientProfileSnapshot.update({
        where: { id: row.snapshotId },
        data: {
          readinessScore: row.score,
          readinessStatus: row.status,
          readinessReasons: row.reasons,
          lastReadinessAt: new Date(),
        },
      })
    )
  );

  return scored;
}

async function scoreCompetitorSnapshots(researchJobId: string): Promise<SnapshotReadinessScore[]> {
  const snapshots = await prisma.competitorProfileSnapshot.findMany({
    where: { researchJobId },
    include: {
      posts: {
        select: {
          caption: true,
          postedAt: true,
          likesCount: true,
          viewsCount: true,
          playsCount: true,
          mediaAssets: {
            select: { id: true },
          },
        },
      },
    },
  });

  const scored = snapshots.map((snapshot) => computeReadiness(snapshot.id, snapshot.posts));

  await Promise.all(
    scored.map((row) =>
      prisma.competitorProfileSnapshot.update({
        where: { id: row.snapshotId },
        data: {
          readinessScore: row.score,
          readinessStatus: row.status,
          readinessReasons: row.reasons,
          lastReadinessAt: new Date(),
        },
      })
    )
  );

  return scored;
}

export async function scoreAndPersistJobSnapshotReadiness(
  researchJobId: string
): Promise<JobSnapshotReadinessSummary> {
  const [client, competitor] = await Promise.all([
    scoreClientSnapshots(researchJobId),
    scoreCompetitorSnapshots(researchJobId),
  ]);

  const statusCounts = (rows: SnapshotReadinessScore[]) =>
    rows.reduce(
      (acc, row) => {
        acc[row.status] += 1;
        return acc;
      },
      { READY: 0, DEGRADED: 0, BLOCKED: 0 }
    );

  const clientCounts = statusCounts(client);
  const competitorCounts = statusCounts(competitor);

  emitResearchJobEvent({
    researchJobId,
    source: 'content-readiness',
    code: 'snapshot.readiness.scored',
    level: 'info',
    message: 'Snapshot readiness scoring completed',
    metrics: {
      clientReady: clientCounts.READY,
      clientDegraded: clientCounts.DEGRADED,
      clientBlocked: clientCounts.BLOCKED,
      competitorReady: competitorCounts.READY,
      competitorDegraded: competitorCounts.DEGRADED,
      competitorBlocked: competitorCounts.BLOCKED,
    },
  });

  return { client, competitor };
}

export async function getEligibleSnapshotSets(
  researchJobId: string,
  options: {
    allowDegraded?: boolean;
  } = {}
): Promise<EligibleSnapshotSets> {
  const allowDegraded = options.allowDegraded === true;
  const summary = await scoreAndPersistJobSnapshotReadiness(researchJobId);

  const acceptedStatuses = new Set<SnapshotReadinessStatus>(
    allowDegraded ? ['READY', 'DEGRADED'] : ['READY']
  );

  const clientSnapshotIds = new Set(
    summary.client
      .filter((row) => acceptedStatuses.has(row.status))
      .map((row) => row.snapshotId)
  );

  const competitorSnapshotIds = new Set(
    summary.competitor
      .filter((row) => acceptedStatuses.has(row.status))
      .map((row) => row.snapshotId)
  );

  return {
    clientSnapshotIds,
    competitorSnapshotIds,
    summary,
  };
}
