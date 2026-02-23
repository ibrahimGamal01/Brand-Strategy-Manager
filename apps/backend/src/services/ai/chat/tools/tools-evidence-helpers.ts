import { prisma } from '../../../../lib/prisma';
import type { AgentContext } from '../agent-context';

export type EvidencePostsArgs = {
  platform?: 'instagram' | 'tiktok' | 'any';
  handles?: string[];
  sort?: 'engagement' | 'recent';
  limit?: number;
  includeCompetitors?: boolean;
  includeClient?: boolean;
  startDateIso?: string;
  endDateIso?: string;
  lastNDays?: number;
};

export type EvidencePostItem = {
  postId: string;
  platform: string;
  handle: string;
  captionSnippet: string;
  postedAt: string | null;
  metrics: {
    likesCount: number;
    commentsCount: number;
    sharesCount: number;
    viewsCount: number;
    playsCount: number;
    engagementScore: number;
  };
  permalink: string | null;
  internalLink: string;
};

export type EvidencePostsResult = {
  items: EvidencePostItem[];
  reason?: string;
};

export type EvidenceFeedArgs = {
  query?: string;
  limit?: number;
};

export type EvidenceFeedItem = {
  title: string;
  url: string;
  source: string;
  snippet: string;
  publishedAt: string | null;
  internalLink: string;
};

export type EvidenceFeedResult = {
  items: EvidenceFeedItem[];
  reason?: string;
};

export const MAX_EVIDENCE_LIMIT = 50;
export const DEFAULT_EVIDENCE_LIMIT = 10;
const MS_IN_DAY = 24 * 60 * 60 * 1000;

export function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_EVIDENCE_LIMIT;
  return Math.max(1, Math.min(MAX_EVIDENCE_LIMIT, Number(limit)));
}

function parseDate(value: unknown): number | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveTimeRange(args: EvidencePostsArgs): { startMs: number | null; endMs: number | null } {
  const lastNDays = typeof args.lastNDays === 'number' && Number.isFinite(args.lastNDays)
    ? Math.max(1, Math.min(365, Math.round(args.lastNDays)))
    : null;

  const derivedStart = lastNDays ? Date.now() - (lastNDays * MS_IN_DAY) : null;
  const startMs = parseDate(args.startDateIso) ?? derivedStart;
  const endMs = parseDate(args.endDateIso);

  if (startMs && endMs && endMs < startMs) {
    return { startMs, endMs: startMs + MS_IN_DAY };
  }

  return { startMs, endMs };
}

export function compactSnippet(value: unknown, max = 180): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export function normalizeHandle(handle: unknown): string {
  return String(handle || '').trim().replace(/^@/, '').toLowerCase();
}

export function normalizePlatform(platform: unknown): string {
  return String(platform || '').trim().toLowerCase();
}

export function getPostPermalink(post: {
  url: string | null;
  metadata: unknown;
  externalId: string;
  socialProfile: { platform: string; handle: string };
}): string | null {
  if (post.url) return post.url;

  const metadata = post.metadata as Record<string, unknown> | null;
  const permalinkFromMeta =
    typeof metadata?.permalink === 'string'
      ? metadata.permalink
      : typeof metadata?.url === 'string'
        ? metadata.url
        : null;
  if (permalinkFromMeta) return permalinkFromMeta;

  const platform = normalizePlatform(post.socialProfile.platform);
  const handle = normalizeHandle(post.socialProfile.handle);
  if (platform === 'instagram' && handle && post.externalId) {
    return `https://www.instagram.com/${handle}/p/${post.externalId}`;
  }
  if (platform === 'tiktok' && handle && post.externalId) {
    return `https://www.tiktok.com/@${handle}/video/${post.externalId}`;
  }

  return null;
}

export async function resolveProfileFilters(
  context: AgentContext,
  args: EvidencePostsArgs
): Promise<{ handleSet: Set<string> | null; platform: string | null }> {
  const handles = Array.isArray(args.handles)
    ? args.handles.map((entry) => normalizeHandle(entry)).filter(Boolean)
    : [];

  const includeCompetitors = args.includeCompetitors ?? true;
  const includeClient = args.includeClient ?? true;
  const filterHandles = new Set<string>(handles);

  if (!includeCompetitors || !includeClient) {
    const [job, discovered] = await Promise.all([
      prisma.researchJob.findUnique({ where: { id: context.researchJobId }, select: { clientId: true } }),
      prisma.discoveredCompetitor.findMany({
        where: { researchJobId: context.researchJobId },
        select: { handle: true },
      }),
    ]);

    const competitorHandles = new Set(discovered.map((row) => normalizeHandle(row.handle)).filter(Boolean));
    let clientHandles = new Set<string>();

    if (job?.clientId) {
      const accounts = await prisma.clientAccount.findMany({
        where: { clientId: job.clientId },
        select: { handle: true },
      });
      clientHandles = new Set(accounts.map((row) => normalizeHandle(row.handle)).filter(Boolean));
    }

    if (!includeCompetitors && includeClient) {
      clientHandles.forEach((value) => filterHandles.add(value));
    } else if (includeCompetitors && !includeClient) {
      competitorHandles.forEach((value) => filterHandles.add(value));
    } else if (!includeCompetitors && !includeClient) {
      return { handleSet: new Set<string>(), platform: null };
    }
  }

  const platform = normalizePlatform(args.platform || 'any');
  return {
    handleSet: filterHandles.size ? filterHandles : null,
    platform: platform === 'any' ? null : platform,
  };
}
