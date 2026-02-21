/**
 * Content Calendar Context Builder
 * Uses readiness-qualified snapshot posts only (client + approved competitors).
 */

import { prisma } from '../../lib/prisma';
import { getBrainProfileContext } from '../ai/rag/brain-profile-context';
import { getContentIntelligence } from '../ai/rag/content-intelligence';
import { buildQualifiedContentPool } from '../orchestration/content-qualification';

const MAX_POSTS_TOTAL = 60;
const CLIENT_IG_TOP = 12;
const CLIENT_TIKTOK_TOP = 12;
const COMPETITOR_TOP = 28;
const CAPTION_MAX_LEN = 700;

export interface ProcessorInputPost {
  postId: string;
  source: 'client' | 'competitor';
  platform: 'instagram' | 'tiktok';
  handle: string;
  postUrl: string;
  format: string;
  caption: string | null;
  likesCount: number | null;
  commentsCount: number | null;
  viewsCount: number | null;
  engagementRate: number | null;
  postedAt: string;
}

export interface ProcessorInput {
  client: {
    clientId: string;
    name: string;
    timezone: string;
    handles: Record<string, string>;
    brain: {
      businessType: string | null;
      primaryGoal: string | null;
      targetMarket: string | null;
      constraints: Record<string, unknown> | null;
      channels: string[];
    };
  };
  planningHorizonDays: number;
  researchSummary: string;
  contentIntelligence: {
    benchmarks: {
      instagramAvgEngagementRate?: number;
      topFormats?: string[];
    };
    opportunities: Array<{
      id: string;
      type: string;
      description: string;
      evidence: string;
      potentialImpact: string;
    }>;
    gaps: Array<{
      id: string;
      area: string;
      description: string;
      recommendation: string;
    }>;
    pillars: Array<{
      id: string;
      name: string;
      rationale: string;
      formatRecommendations: string[];
      exampleTopics: string[];
    }>;
  };
  strategySnippets: {
    contentPillars: Array<{ name: string; purpose: string }>;
    winningFormats: string[];
    hookPatterns: string[];
    dosAndDonts: { dos: string[]; donts: string[] };
  };
  posts: ProcessorInputPost[];
}

export interface BuildContentCalendarContextOptions {
  durationDays?: number;
  allowDegradedSnapshots?: boolean;
}

function normalizePlatform(platform: string): 'instagram' | 'tiktok' {
  return String(platform || '').toLowerCase() === 'tiktok' ? 'tiktok' : 'instagram';
}

function normalizeFormat(type: string | null, platform: string): string {
  const t = String(type || '').toLowerCase();
  if (platform === 'tiktok') return 'video';
  if (t.includes('reel') || t === 'video') return 'reel';
  if (t.includes('carousel') || t === 'sidecar') return 'carousel';
  if (t.includes('story')) return 'story';
  return 'image';
}

function truncateCaption(caption: string | null): string | null {
  if (!caption || typeof caption !== 'string') return null;
  const trimmed = caption.trim();
  if (trimmed.length <= CAPTION_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, CAPTION_MAX_LEN)}…`;
}

function engagementRateFromMetrics(
  likesCount: number | null,
  commentsCount: number | null,
  viewsCount: number | null,
  followers: number | null
): number | null {
  if (!followers || followers <= 0) return null;
  const likes = Number(likesCount || 0);
  const comments = Number(commentsCount || 0);
  const views = Number(viewsCount || 0);
  const raw = (likes + comments + views * 0.1) / followers;
  return Math.round(raw * 10000) / 10000;
}

function postRank(post: ProcessorInputPost): number {
  const likes = Number(post.likesCount || 0);
  const comments = Number(post.commentsCount || 0);
  const views = Number(post.viewsCount || 0);
  return likes + comments * 2 + views * 0.1;
}

function hasMetrics(post: {
  likesCount: number | null;
  commentsCount: number | null;
  viewsCount: number | null;
  playsCount: number | null;
}): boolean {
  return Number(post.likesCount || 0) > 0 || Number(post.viewsCount || post.playsCount || 0) > 0;
}

export async function buildContentCalendarContext(
  researchJobId: string,
  options: BuildContentCalendarContextOptions = {}
): Promise<ProcessorInput> {
  const durationDays = [7, 14, 30, 90].includes(Number(options.durationDays || 14))
    ? Number(options.durationDays || 14)
    : 14;

  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: { client: true },
  });
  if (!job?.client) {
    throw new Error(`Research job ${researchJobId} not found or has no client`);
  }

  const inputData = (job.inputData || {}) as Record<string, unknown>;
  const handles = (inputData.handles as Record<string, string>) || {};
  const clientInstagramHandle = String(handles.instagram || '').toLowerCase().replace(/^@/, '');
  const clientTiktokHandle = String(handles.tiktok || '').toLowerCase().replace(/^@/, '');

  const [brainProfile, contentIntelligence, qualifiedPool] = await Promise.all([
    getBrainProfileContext(researchJobId),
    getContentIntelligence(researchJobId).catch(() => null),
    buildQualifiedContentPool(researchJobId, {
      allowDegradedSnapshots: options.allowDegradedSnapshots === true,
      requireScopedCompetitors: true,
      maxClientSnapshots: 8,
      maxCompetitorSnapshots: 24,
      maxPostsPerSnapshot: 120,
    }),
  ]);

  const allPosts = qualifiedPool.posts.map((post) => {
    const platform = normalizePlatform(post.platform);
    const viewMetric = post.viewsCount ?? post.playsCount ?? null;
    return {
      postId: post.postId,
      source: post.source,
      platform,
      handle: post.handle ? `@${post.handle}` : post.source === 'client' ? '@client' : '@competitor',
      postUrl: post.postUrl,
      format: normalizeFormat(post.format, platform),
      caption: truncateCaption(post.caption),
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      viewsCount: viewMetric,
      engagementRate: post.engagementRate,
      postedAt: post.postedAt ? new Date(post.postedAt).toISOString().slice(0, 10) : '',
    } as ProcessorInputPost;
  });
  if (allPosts.length === 0) {
    const clientStatusCounts = qualifiedPool.readinessSummary.client.reduce(
      (acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    const competitorStatusCounts = qualifiedPool.readinessSummary.competitor.reduce(
      (acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    throw new Error(
      `No readiness-qualified posts with media+metrics were found. Run downloader/readiness first. readyClient=${qualifiedPool.summary.readySnapshotCounts.client}, readyCompetitor=${qualifiedPool.summary.readySnapshotCounts.competitor}, droppedNoMedia=${qualifiedPool.summary.droppedNoMedia}, droppedNoMetrics=${qualifiedPool.summary.droppedNoMetrics}, droppedOutOfScopeCompetitor=${qualifiedPool.summary.droppedOutOfScopeCompetitor}, clientStatus=${JSON.stringify(clientStatusCounts)}, competitorStatus=${JSON.stringify(competitorStatusCounts)}`
    );
  }

  const clientPosts = allPosts.filter((post) => post.source === 'client');
  const competitorPosts = allPosts.filter((post) => post.source === 'competitor');

  const selectedPostIds = new Set<string>();
  const selectedPosts: ProcessorInputPost[] = [];

  const sortedClientIg = clientPosts
    .filter((post) => post.platform === 'instagram')
    .sort((a, b) => postRank(b) - postRank(a));
  const sortedClientTik = clientPosts
    .filter((post) => post.platform === 'tiktok')
    .sort((a, b) => postRank(b) - postRank(a));

  sortedClientIg.slice(0, CLIENT_IG_TOP).forEach((post) => {
    if (selectedPostIds.has(post.postId)) return;
    selectedPostIds.add(post.postId);
    selectedPosts.push(post);
  });

  sortedClientTik.slice(0, CLIENT_TIKTOK_TOP).forEach((post) => {
    if (selectedPostIds.has(post.postId)) return;
    selectedPostIds.add(post.postId);
    selectedPosts.push(post);
  });

  const competitorByHandle = competitorPosts.reduce((acc, post) => {
    const key = `${post.platform}:${post.handle.toLowerCase()}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(post);
    return acc;
  }, {} as Record<string, ProcessorInputPost[]>);

  const perCompetitorLimit = Math.max(
    1,
    Math.floor(COMPETITOR_TOP / Math.max(1, Object.keys(competitorByHandle).length))
  );

  Object.values(competitorByHandle).forEach((list) => {
    list
      .sort((a, b) => postRank(b) - postRank(a))
      .slice(0, perCompetitorLimit)
      .forEach((post) => {
        if (selectedPostIds.has(post.postId)) return;
        selectedPostIds.add(post.postId);
        selectedPosts.push(post);
      });
  });

  allPosts
    .sort((a, b) => postRank(b) - postRank(a))
    .forEach((post) => {
      if (selectedPosts.length >= MAX_POSTS_TOTAL) return;
      if (selectedPostIds.has(post.postId)) return;
      selectedPostIds.add(post.postId);
      selectedPosts.push(post);
    });

  if (selectedPosts.length === 0) {
    throw new Error('No eligible posts remained after readiness evidence filtering.');
  }

  const analyses = await prisma.aiAnalysis.findMany({
    where: {
      researchJobId,
      topic: {
        in: [
          'content_pillars',
          'format_recommendations',
          'content_analysis',
          'business_understanding',
        ],
      },
      OR: [{ documentStatus: 'FINAL' }, { documentStatus: null }],
    },
    orderBy: { analyzedAt: 'desc' },
  });

  const getSection = (topic: string): string => {
    const section = analyses.find((analysis) => analysis.topic === topic);
    if (!section?.fullResponse) return '';
    return typeof section.fullResponse === 'string'
      ? section.fullResponse
      : JSON.stringify(section.fullResponse);
  };

  const ci = contentIntelligence;
  const opportunities = (ci?.insights?.topOpportunities || []).slice(0, 10).map((o: any, i: number) => ({
    id: `opp_${i + 1}`,
    type: o.type || 'format',
    description: o.description || '',
    evidence: o.evidence || '',
    potentialImpact: o.potentialImpact || 'medium',
  }));
  const gaps = (ci?.insights?.contentGaps || []).slice(0, 10).map((g: any, i: number) => ({
    id: `gap_${i + 1}`,
    area: g.area || g.theme || 'content',
    description: g.description || '',
    recommendation: g.recommendation || '',
  }));
  const pillars = (ci?.insights?.recommendedPillars || []).slice(0, 7).map((p: any, i: number) => ({
    id: `pillar_${i + 1}`,
    name: p.name || p.pillar || '',
    rationale: p.rationale || '',
    formatRecommendations: Array.isArray(p.formats) ? p.formats : ['reel', 'carousel'],
    exampleTopics: Array.isArray(p.exampleTopics) ? p.exampleTopics : [],
  }));

  const contentPillarsSection = getSection('content_pillars');
  const contentPillarsSnippets: Array<{ name: string; purpose: string }> = [];
  if (contentPillarsSection) {
    const headings = contentPillarsSection.match(/(?:^|\n)#+\s*([^\n]+)/g);
    headings?.slice(0, 7).forEach((heading) => {
      contentPillarsSnippets.push({
        name: heading.replace(/^#+\s*/, '').trim(),
        purpose: '',
      });
    });
  }

  const timezone = (inputData.timezone as string) || 'Africa/Cairo';
  const researchSummary =
    getSection('business_understanding').slice(0, 600) ||
    `${job.client.name} research context based on readiness-qualified client and competitor posts.`;

  return {
    client: {
      clientId: job.client.id,
      name: job.client.name || 'Client',
      timezone,
      handles: {
        instagram: clientInstagramHandle ? `@${clientInstagramHandle}` : '',
        tiktok: clientTiktokHandle ? `@${clientTiktokHandle}` : '',
      },
      brain: {
        businessType: brainProfile.businessType,
        primaryGoal: brainProfile.primaryGoal,
        targetMarket: brainProfile.targetMarket,
        constraints: brainProfile.constraints,
        channels: brainProfile.channels.map((channel) => channel.platform),
      },
    },
    planningHorizonDays: durationDays,
    researchSummary,
    contentIntelligence: {
      benchmarks: {
        instagramAvgEngagementRate: ci?.benchmarks?.avgEngagementRate,
        topFormats: ci?.benchmarks?.topFormats?.map((row: any) => row.format || row) || [],
      },
      opportunities,
      gaps,
      pillars,
    },
    strategySnippets: {
      contentPillars: contentPillarsSnippets.length
        ? contentPillarsSnippets
        : pillars.map((pillar) => ({ name: pillar.name, purpose: pillar.rationale })),
      winningFormats:
        ci?.benchmarks?.topFormats?.map((row: any) => row.format || row) || ['reel', 'carousel'],
      hookPatterns: [],
      dosAndDonts: { dos: [], donts: [] },
    },
    posts: selectedPosts.slice(0, MAX_POSTS_TOTAL),
  };
}
