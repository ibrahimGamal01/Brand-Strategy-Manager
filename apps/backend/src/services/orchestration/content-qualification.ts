import { prisma } from '../../lib/prisma';
import {
  getEligibleSnapshotSets,
  JobSnapshotReadinessSummary,
} from './content-readiness';

export type QualifiedContentSource = 'client' | 'competitor';
export type QualifiedContentPlatform = 'instagram' | 'tiktok';

export interface QualifiedContentPost {
  postId: string;
  externalPostId: string;
  source: QualifiedContentSource;
  platform: QualifiedContentPlatform;
  handle: string;
  postUrl: string;
  format: string | null;
  caption: string | null;
  likesCount: number | null;
  commentsCount: number | null;
  viewsCount: number | null;
  playsCount: number | null;
  engagementRate: number | null;
  postedAt: Date | null;
  snapshotId: string;
  mediaAssetIds: string[];
}

export interface ContentQualificationSummary {
  rawPostsSeen: number;
  qualifiedPosts: number;
  qualifiedBySource: {
    client: number;
    competitor: number;
  };
  droppedNoMedia: number;
  droppedNoMetrics: number;
  droppedUnsupportedPlatform: number;
  droppedOutOfScopeCompetitor: number;
  duplicatesDropped: number;
  readySnapshotCounts: {
    client: number;
    competitor: number;
  };
}

export interface QualifiedContentPool {
  posts: QualifiedContentPost[];
  summary: ContentQualificationSummary;
  readinessSummary: JobSnapshotReadinessSummary;
}

export interface BuildQualifiedContentPoolOptions {
  allowDegradedSnapshots?: boolean;
  requireScopedCompetitors?: boolean;
  maxClientSnapshots?: number;
  maxCompetitorSnapshots?: number;
  maxPostsPerSnapshot?: number;
}

function normalizeHandle(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function normalizePlatform(value: string | null | undefined): QualifiedContentPlatform | null {
  const platform = String(value || '').trim().toLowerCase();
  if (platform === 'instagram') return 'instagram';
  if (platform === 'tiktok') return 'tiktok';
  return null;
}

function hasMetrics(input: {
  likesCount?: number | null;
  viewsCount?: number | null;
  playsCount?: number | null;
}): boolean {
  const likes = Number(input.likesCount || 0);
  const views = Number(input.viewsCount || input.playsCount || 0);
  return likes > 0 || views > 0;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function postIdentityKey(input: {
  source: QualifiedContentSource;
  platform: QualifiedContentPlatform;
  handle: string;
  externalPostId: string;
  postId: string;
}): string {
  const handle = normalizeHandle(input.handle);
  const external = String(input.externalPostId || '').trim().toLowerCase();
  if (external) return `${input.source}:${input.platform}:${handle}:${external}`;
  return `${input.source}:${input.platform}:${handle}:${input.postId}`;
}

export function filterInspirationIdsAgainstQualifiedPool(
  inspirationIds: string[],
  pool: QualifiedContentPool
): {
  validIds: string[];
  invalidIds: string[];
} {
  const validSet = new Set(pool.posts.map((row) => row.postId));
  const validIds: string[] = [];
  const invalidIds: string[] = [];
  for (const id of dedupe(inspirationIds.map((value) => String(value || '').trim()))) {
    if (validSet.has(id)) validIds.push(id);
    else invalidIds.push(id);
  }
  return { validIds, invalidIds };
}

export async function buildQualifiedContentPool(
  researchJobId: string,
  options: BuildQualifiedContentPoolOptions = {}
): Promise<QualifiedContentPool> {
  const allowDegradedSnapshots = options.allowDegradedSnapshots === true;
  const requireScopedCompetitors = options.requireScopedCompetitors !== false;
  const maxClientSnapshots = Math.max(1, Math.min(20, Number(options.maxClientSnapshots || 8)));
  const maxCompetitorSnapshots = Math.max(
    1,
    Math.min(60, Number(options.maxCompetitorSnapshots || 24))
  );
  const maxPostsPerSnapshot = Math.max(
    10,
    Math.min(240, Number(options.maxPostsPerSnapshot || 120))
  );

  const readiness = await getEligibleSnapshotSets(researchJobId, {
    allowDegraded: allowDegradedSnapshots,
  });

  const readyClientSnapshotIds = Array.from(readiness.clientSnapshotIds);
  const readyCompetitorSnapshotIds = Array.from(readiness.competitorSnapshotIds);

  const scopedCompetitorSet = new Set<string>();
  if (requireScopedCompetitors) {
    const scoped = await prisma.discoveredCompetitor.findMany({
      where: {
        researchJobId,
        selectionState: { in: ['TOP_PICK', 'APPROVED', 'SHORTLISTED'] },
      },
      select: { platform: true, handle: true },
    });
    for (const row of scoped) {
      const platform = normalizePlatform(row.platform);
      const handle = normalizeHandle(row.handle);
      if (!platform || !handle) continue;
      scopedCompetitorSet.add(`${platform}:${handle}`);
    }
  }

  const [clientSnapshots, competitorSnapshots] = await Promise.all([
    readyClientSnapshotIds.length > 0
      ? prisma.clientProfileSnapshot.findMany({
          where: { id: { in: readyClientSnapshotIds } },
          include: {
            clientProfile: {
              select: { platform: true, handle: true },
            },
            posts: {
              orderBy: { postedAt: 'desc' },
              take: maxPostsPerSnapshot,
              include: {
                mediaAssets: { select: { id: true } },
              },
            },
          },
          orderBy: { scrapedAt: 'desc' },
          take: maxClientSnapshots,
        })
      : [],
    readyCompetitorSnapshotIds.length > 0
      ? prisma.competitorProfileSnapshot.findMany({
          where: { id: { in: readyCompetitorSnapshotIds } },
          include: {
            competitorProfile: {
              select: { platform: true, handle: true },
            },
            posts: {
              orderBy: { postedAt: 'desc' },
              take: maxPostsPerSnapshot,
              include: {
                mediaAssets: { select: { id: true } },
              },
            },
          },
          orderBy: { scrapedAt: 'desc' },
          take: maxCompetitorSnapshots,
        })
      : [],
  ]);

  const summary: ContentQualificationSummary = {
    rawPostsSeen: 0,
    qualifiedPosts: 0,
    qualifiedBySource: { client: 0, competitor: 0 },
    droppedNoMedia: 0,
    droppedNoMetrics: 0,
    droppedUnsupportedPlatform: 0,
    droppedOutOfScopeCompetitor: 0,
    duplicatesDropped: 0,
    readySnapshotCounts: {
      client: readyClientSnapshotIds.length,
      competitor: readyCompetitorSnapshotIds.length,
    },
  };

  const dedupeSet = new Set<string>();
  const qualified: QualifiedContentPost[] = [];

  for (const snapshot of clientSnapshots) {
    const platform = normalizePlatform(snapshot.clientProfile?.platform);
    const handle = normalizeHandle(snapshot.clientProfile?.handle);
    if (!platform || !handle) {
      summary.droppedUnsupportedPlatform += snapshot.posts.length;
      continue;
    }

    for (const post of snapshot.posts) {
      summary.rawPostsSeen += 1;
      if (!post.mediaAssets.length) {
        summary.droppedNoMedia += 1;
        continue;
      }
      if (!hasMetrics(post)) {
        summary.droppedNoMetrics += 1;
        continue;
      }

      const dedupeKey = postIdentityKey({
        source: 'client',
        platform,
        handle,
        externalPostId: post.externalPostId,
        postId: post.id,
      });
      if (dedupeSet.has(dedupeKey)) {
        summary.duplicatesDropped += 1;
        continue;
      }
      dedupeSet.add(dedupeKey);

      qualified.push({
        postId: post.id,
        externalPostId: post.externalPostId,
        source: 'client',
        platform,
        handle,
        postUrl:
          post.postUrl ||
          (platform === 'tiktok'
            ? `https://www.tiktok.com/@${handle}/video/${post.externalPostId}`
            : `https://www.instagram.com/p/${post.externalPostId}`),
        format: post.format || null,
        caption: post.caption || null,
        likesCount: post.likesCount ?? null,
        commentsCount: post.commentsCount ?? null,
        viewsCount: post.viewsCount ?? null,
        playsCount: post.playsCount ?? null,
        engagementRate: post.engagementRate ?? null,
        postedAt: post.postedAt ?? null,
        snapshotId: snapshot.id,
        mediaAssetIds: dedupe(post.mediaAssets.map((asset) => asset.id)),
      });
      summary.qualifiedPosts += 1;
      summary.qualifiedBySource.client += 1;
    }
  }

  for (const snapshot of competitorSnapshots) {
    const platform = normalizePlatform(snapshot.competitorProfile?.platform);
    const handle = normalizeHandle(snapshot.competitorProfile?.handle);
    if (!platform || !handle) {
      summary.droppedUnsupportedPlatform += snapshot.posts.length;
      continue;
    }

    const competitorScopeKey = `${platform}:${handle}`;
    const inScope = !requireScopedCompetitors || scopedCompetitorSet.has(competitorScopeKey);

    for (const post of snapshot.posts) {
      summary.rawPostsSeen += 1;
      if (!inScope) {
        summary.droppedOutOfScopeCompetitor += 1;
        continue;
      }
      if (!post.mediaAssets.length) {
        summary.droppedNoMedia += 1;
        continue;
      }
      if (!hasMetrics(post)) {
        summary.droppedNoMetrics += 1;
        continue;
      }

      const dedupeKey = postIdentityKey({
        source: 'competitor',
        platform,
        handle,
        externalPostId: post.externalPostId,
        postId: post.id,
      });
      if (dedupeSet.has(dedupeKey)) {
        summary.duplicatesDropped += 1;
        continue;
      }
      dedupeSet.add(dedupeKey);

      qualified.push({
        postId: post.id,
        externalPostId: post.externalPostId,
        source: 'competitor',
        platform,
        handle,
        postUrl:
          post.postUrl ||
          (platform === 'tiktok'
            ? `https://www.tiktok.com/@${handle}/video/${post.externalPostId}`
            : `https://www.instagram.com/p/${post.externalPostId}`),
        format: post.format || null,
        caption: post.caption || null,
        likesCount: post.likesCount ?? null,
        commentsCount: post.commentsCount ?? null,
        viewsCount: post.viewsCount ?? null,
        playsCount: post.playsCount ?? null,
        engagementRate: post.engagementRate ?? null,
        postedAt: post.postedAt ?? null,
        snapshotId: snapshot.id,
        mediaAssetIds: dedupe(post.mediaAssets.map((asset) => asset.id)),
      });
      summary.qualifiedPosts += 1;
      summary.qualifiedBySource.competitor += 1;
    }
  }

  return {
    posts: qualified,
    summary,
    readinessSummary: readiness.summary,
  };
}

