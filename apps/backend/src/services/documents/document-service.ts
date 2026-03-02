import { ProcessEventLevel, ProcessEventType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { renderDocumentMarkdown } from './document-render';
import { saveDocumentBuffer } from './document-storage';
import { markdownToRichHtml } from './markdown-renderer';
import { renderPdfFromHtml } from './pdf-renderer';
import type {
  DocumentCoverage,
  DocumentDataPayload,
  DocumentPlan,
  GeneratedDocument,
  TopPostRow,
} from './document-spec';
import { emitWorkspaceDocumentRuntimeEvent } from './ingestion/ingestion-orchestrator';
import { upsertGeneratedRuntimeDocument } from './workspace-document-service';

type DepthConfig = {
  competitorsTake: number;
  postsPoolTake: number;
  postsTake: number;
  webSnapshotsTake: number;
  newsTake: number;
  communityTake: number;
  targets: {
    competitors: number;
    posts: number;
    webSnapshots: number;
    news: number;
    community: number;
  };
};

const DEPTH_CONFIG: Record<'short' | 'standard' | 'deep', DepthConfig> = {
  short: {
    competitorsTake: 8,
    postsPoolTake: 80,
    postsTake: 10,
    webSnapshotsTake: 6,
    newsTake: 5,
    communityTake: 4,
    targets: {
      competitors: 4,
      posts: 6,
      webSnapshots: 4,
      news: 3,
      community: 2,
    },
  },
  standard: {
    competitorsTake: 16,
    postsPoolTake: 160,
    postsTake: 16,
    webSnapshotsTake: 12,
    newsTake: 8,
    communityTake: 6,
    targets: {
      competitors: 7,
      posts: 10,
      webSnapshots: 7,
      news: 5,
      community: 4,
    },
  },
  deep: {
    competitorsTake: 28,
    postsPoolTake: 260,
    postsTake: 24,
    webSnapshotsTake: 18,
    newsTake: 12,
    communityTake: 10,
    targets: {
      competitors: 12,
      posts: 18,
      webSnapshots: 10,
      news: 7,
      community: 6,
    },
  },
};

function normalizeDepth(value: DocumentPlan['depth'] | undefined): 'short' | 'standard' | 'deep' {
  if (value === 'short' || value === 'deep') return value;
  return 'standard';
}

function normalizePlan(plan: Partial<DocumentPlan> = {}): DocumentPlan {
  return {
    docType: (plan.docType || 'STRATEGY_BRIEF') as DocumentPlan['docType'],
    title: typeof plan.title === 'string' && plan.title.trim() ? plan.title.trim() : undefined,
    audience: typeof plan.audience === 'string' && plan.audience.trim() ? plan.audience.trim() : 'Marketing team',
    timeframeDays: Number.isFinite(Number(plan.timeframeDays)) ? Math.max(7, Math.min(365, Number(plan.timeframeDays))) : 90,
    depth: (plan.depth || 'deep') as DocumentPlan['depth'],
    includeCompetitors: plan.includeCompetitors ?? true,
    includeEvidenceLinks: plan.includeEvidenceLinks ?? true,
  };
}

function scorePost(post: {
  likesCount: number | null;
  commentsCount: number | null;
  sharesCount: number | null;
  viewsCount: number | null;
}): number {
  return (
    (post.likesCount || 0) +
    (post.commentsCount || 0) +
    (post.sharesCount || 0) +
    Math.round((post.viewsCount || 0) * 0.1)
  );
}

function resolvePostUrl(post: { url: string | null; metadata: unknown }): string | null {
  if (post.url) return post.url;
  const metadata = post.metadata as Record<string, unknown> | null;
  if (typeof metadata?.permalink === 'string') return metadata.permalink;
  if (typeof metadata?.url === 'string') return metadata.url;
  return null;
}

function clampScore(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return 0;
  return Math.max(0, Math.min(100, rounded));
}

function maxIsoDate(values: Array<string | null | undefined>): string | null {
  let max = 0;
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) continue;
    if (parsed > max) max = parsed;
  }
  return max > 0 ? new Date(max).toISOString() : null;
}

function computeCoverage(input: {
  counts: {
    competitors: number;
    posts: number;
    webSnapshots: number;
    news: number;
    community: number;
  };
  targets: {
    competitors: number;
    posts: number;
    webSnapshots: number;
    news: number;
    community: number;
  };
  latestEvidenceAt: string | null;
  enriched: boolean;
  depth: 'short' | 'standard' | 'deep';
}): DocumentCoverage {
  const weights = {
    competitors: 0.25,
    posts: 0.25,
    webSnapshots: 0.2,
    news: 0.15,
    community: 0.15,
  } as const;

  const componentScore = (key: keyof typeof weights): number => {
    const target = Number(input.targets[key] || 0);
    const count = Number(input.counts[key] || 0);
    if (target <= 0) return 1;
    return Math.max(0, Math.min(1, count / target));
  };

  const rawScore =
    componentScore('competitors') * weights.competitors +
    componentScore('posts') * weights.posts +
    componentScore('webSnapshots') * weights.webSnapshots +
    componentScore('news') * weights.news +
    componentScore('community') * weights.community;
  const score = clampScore(rawScore * 100);

  const nowMs = Date.now();
  const evidenceMs = input.latestEvidenceAt ? Date.parse(input.latestEvidenceAt) : NaN;
  const freshnessHours =
    Number.isFinite(evidenceMs) && evidenceMs > 0
      ? Math.max(0, (nowMs - evidenceMs) / (60 * 60 * 1000))
      : null;

  const reasons: string[] = [];
  for (const key of Object.keys(input.targets) as Array<keyof typeof input.targets>) {
    const target = input.targets[key];
    const count = input.counts[key];
    if (target <= 0) continue;
    if (count >= target) continue;
    reasons.push(`Low ${key} coverage (${count}/${target}) for deep-confidence synthesis.`);
  }
  if (freshnessHours !== null && freshnessHours > 336) {
    reasons.push(`Newest evidence is older than ${Math.round(freshnessHours / 24)} days.`);
  }
  if (!reasons.length) {
    reasons.push('Coverage meets current depth targets.');
  }

  const band: DocumentCoverage['band'] = score >= 80 ? 'strong' : score >= 55 ? 'moderate' : 'thin';
  const partialThreshold = input.depth === 'deep' ? 75 : input.depth === 'standard' ? 60 : 45;

  return {
    score,
    band,
    counts: input.counts,
    targets: input.targets,
    freshnessHours: freshnessHours === null ? null : Number(freshnessHours.toFixed(1)),
    reasons,
    enriched: Boolean(input.enriched),
    partial: score < partialThreshold,
  };
}

function buildRecommendations(input: {
  clientName: string;
  topPosts: TopPostRow[];
  competitors: Array<{ handle: string; platform: string; selectionState: string }>;
  coverage: DocumentCoverage;
  timeframeDays: number;
}): DocumentDataPayload['recommendations'] {
  const topPost = input.topPosts[0];
  const secondPost = input.topPosts[1];
  const topCompetitor = input.competitors[0];

  const quickWins = [
    topPost
      ? `Create two content variants around the top signal from @${topPost.handle} (${topPost.platform}) and compare conversion-focused CTA phrasing weekly.`
      : 'Create one conversion-focused post per week with an explicit CTA and measurable KPI.',
    topCompetitor
      ? `Track ${topCompetitor.selectionState.toLowerCase()} competitor @${topCompetitor.handle} on ${topCompetitor.platform} and log format/hook shifts every 7 days.`
      : 'Build a shortlist of top competitors and review their content cadence weekly.',
    `Run a ${Math.max(14, Math.min(45, Math.round(input.timeframeDays / 2)))}-day KPI checkpoint for lead quality, not only reach.`,
  ];

  const days30 = [
    `Finalize messaging angle for ${input.clientName} and map it to 3 measurable campaign hypotheses.`,
    topPost
      ? `Replicate the winning structure pattern from @${topPost.handle} while localizing voice for your audience.`
      : 'Run baseline content tests across 2 formats and capture engagement + conversion deltas.',
  ];

  const days60 = [
    secondPost
      ? `Scale the second-best signal archetype from @${secondPost.handle} into a recurring weekly series.`
      : 'Double down on the highest-performing format-topic pair from month-one tests.',
    'Publish a mid-cycle strategy review with evidence links and KPI movement by content pillar.',
  ];

  const days90 = [
    'Operationalize a weekly evidence sync and monthly strategy refresh in the docs workspace.',
    'Promote the top-performing offer narrative into always-on conversion assets.',
  ];

  const risks = [
    ...(input.coverage.partial
      ? ['Evidence density is below deep target; conclusions should be treated as directional until enrichment completes.']
      : []),
    ...(input.coverage.freshnessHours !== null && input.coverage.freshnessHours > 336
      ? ['Evidence freshness is stale; recrawl or refresh social/news signals before major spend decisions.']
      : []),
    'High engagement does not always equal lead quality; validate with conversion and retention metrics.',
  ];

  return {
    quickWins: Array.from(new Set(quickWins)).slice(0, 5),
    days30: Array.from(new Set(days30)).slice(0, 5),
    days60: Array.from(new Set(days60)).slice(0, 5),
    days90: Array.from(new Set(days90)).slice(0, 5),
    risks: Array.from(new Set(risks)).slice(0, 5),
  };
}

async function buildPayload(
  researchJobId: string,
  plan: DocumentPlan,
  options?: { enriched?: boolean }
): Promise<{ payload: DocumentDataPayload; clientId: string }> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: {
          brainProfile: true,
        },
      },
    },
  });

  if (!job) {
    throw new Error('Research job not found');
  }

  const depth = normalizeDepth(plan.depth);
  const config = DEPTH_CONFIG[depth];
  const includeCompetitors = plan.includeCompetitors !== false;

  const [competitorsRaw, postsRaw, webSnapshotsRaw, newsRaw, communityRaw] = await Promise.all([
    includeCompetitors
      ? prisma.discoveredCompetitor.findMany({
          where: { researchJobId },
          orderBy: [{ displayOrder: 'asc' }, { relevanceScore: 'desc' }, { updatedAt: 'desc' }],
          take: config.competitorsTake,
        })
      : Promise.resolve([]),
    prisma.socialPost.findMany({
      where: {
        socialProfile: {
          researchJobId,
        },
      },
      include: {
        socialProfile: {
          select: { handle: true, platform: true },
        },
      },
      take: config.postsPoolTake,
    }),
    prisma.webPageSnapshot.findMany({
      where: { researchJobId },
      orderBy: { fetchedAt: 'desc' },
      take: config.webSnapshotsTake,
      select: {
        finalUrl: true,
        statusCode: true,
        fetchedAt: true,
        cleanText: true,
      },
    }),
    prisma.ddgNewsResult.findMany({
      where: { researchJobId },
      orderBy: { createdAt: 'desc' },
      take: config.newsTake,
      select: {
        title: true,
        url: true,
        source: true,
        body: true,
        publishedAt: true,
        createdAt: true,
      },
    }),
    prisma.communityInsight.findMany({
      where: { researchJobId },
      orderBy: { createdAt: 'desc' },
      take: config.communityTake,
      select: {
        source: true,
        url: true,
        content: true,
        createdAt: true,
      },
    }),
  ]);

  const topPosts: TopPostRow[] = postsRaw
    .sort((a, b) => scorePost(b) - scorePost(a))
    .slice(0, config.postsTake)
    .map((post) => ({
      handle: post.socialProfile.handle,
      platform: post.socialProfile.platform,
      caption: String(post.caption || '').slice(0, 320),
      postUrl: resolvePostUrl(post),
      postedAt: post.postedAt ? post.postedAt.toISOString() : post.scrapedAt.toISOString(),
      likes: post.likesCount || 0,
      comments: post.commentsCount || 0,
      shares: post.sharesCount || 0,
      views: post.viewsCount || 0,
    }));

  const webSnapshots = webSnapshotsRaw
    .map((entry) => ({
      finalUrl: String(entry.finalUrl || '').trim(),
      statusCode: entry.statusCode,
      fetchedAt: entry.fetchedAt.toISOString(),
      snippet: String(entry.cleanText || '').replace(/\s+/g, ' ').trim().slice(0, 260),
    }))
    .filter((entry) => Boolean(entry.finalUrl));

  const news = newsRaw
    .map((entry) => ({
      title: String(entry.title || '').trim(),
      url: String(entry.url || '').trim(),
      source: String(entry.source || 'news').trim() || 'news',
      publishedAt: String(entry.publishedAt || '').trim() || entry.createdAt.toISOString(),
      snippet: String(entry.body || '').replace(/\s+/g, ' ').trim().slice(0, 260),
    }))
    .filter((entry) => Boolean(entry.title) && Boolean(entry.url));

  const communityInsights = communityRaw
    .map((entry) => ({
      source: String(entry.source || 'community').trim() || 'community',
      url: String(entry.url || '').trim(),
      summary: String(entry.content || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      createdAt: entry.createdAt.toISOString(),
    }))
    .filter((entry) => Boolean(entry.summary));

  const latestEvidenceAt = maxIsoDate([
    ...topPosts.map((entry) => entry.postedAt),
    ...webSnapshots.map((entry) => entry.fetchedAt),
    ...news.map((entry) => entry.publishedAt),
    ...communityInsights.map((entry) => entry.createdAt),
  ]);

  const coverage = computeCoverage({
    counts: {
      competitors: includeCompetitors ? competitorsRaw.length : 0,
      posts: topPosts.length,
      webSnapshots: webSnapshots.length,
      news: news.length,
      community: communityInsights.length,
    },
    targets: {
      competitors: includeCompetitors ? config.targets.competitors : 0,
      posts: config.targets.posts,
      webSnapshots: config.targets.webSnapshots,
      news: config.targets.news,
      community: config.targets.community,
    },
    latestEvidenceAt,
    enriched: Boolean(options?.enriched),
    depth,
  });

  const recommendations = buildRecommendations({
    clientName: job.client.name,
    topPosts,
    competitors: competitorsRaw.map((row) => ({
      handle: row.handle,
      platform: row.platform,
      selectionState: row.selectionState,
    })),
    coverage,
    timeframeDays: plan.timeframeDays || 90,
  });

  const payload: DocumentDataPayload = {
    generatedAt: new Date().toISOString(),
    clientName: job.client.name,
    businessType: job.client.brainProfile?.businessType || 'Not specified',
    primaryGoal: job.client.brainProfile?.primaryGoal || 'Not specified',
    targetMarket: job.client.brainProfile?.targetMarket || 'Not specified',
    websiteDomain: job.client.brainProfile?.websiteDomain || 'Not specified',
    audience: plan.audience || 'Marketing team',
    timeframeDays: plan.timeframeDays || 90,
    competitors: competitorsRaw.map((row) => ({
      handle: row.handle,
      platform: row.platform,
      selectionState: row.selectionState,
      relevanceScore: row.relevanceScore,
      availabilityStatus: row.availabilityStatus,
      profileUrl: row.profileUrl,
      reason: row.selectionReason,
    })),
    topPosts,
    webSnapshots,
    news,
    communityInsights,
    coverage,
    recommendations,
  };

  return { payload, clientId: job.clientId };
}

function resolveTitle(plan: DocumentPlan, clientName: string): string {
  if (plan.title) return plan.title;
  if (plan.docType === 'COMPETITOR_AUDIT') return `${clientName} Competitor Audit`;
  if (plan.docType === 'CONTENT_CALENDAR') return `${clientName} Content Calendar`;
  return `${clientName} Strategy Brief`;
}

export async function generateDocumentForResearchJob(
  researchJobId: string,
  planInput: Partial<DocumentPlan>,
  options?: {
    branchId?: string;
    userId?: string;
    enrichmentPerformed?: boolean;
  },
): Promise<GeneratedDocument> {
  const plan = normalizePlan(planInput);
  const { payload, clientId } = await buildPayload(researchJobId, plan, {
    enriched: Boolean(options?.enrichmentPerformed),
  });
  const title = resolveTitle(plan, payload.clientName);

  const branchId = String(options?.branchId || '').trim();
  const runtimeUserId = String(options?.userId || '').trim() || 'runtime-tool';

  if (branchId) {
    await emitWorkspaceDocumentRuntimeEvent({
      branchId,
      processType: ProcessEventType.PROCESS_LOG,
      eventName: 'document.preflight',
      message: `Document preflight complete (${payload.coverage.score}/100, ${payload.coverage.band}).`,
      payload: {
        coverageScore: payload.coverage.score,
        coverageBand: payload.coverage.band,
        partial: payload.coverage.partial,
        counts: payload.coverage.counts,
        targets: payload.coverage.targets,
        reasons: payload.coverage.reasons,
      },
      toolName: 'document.generate',
    });
  }

  const markdown = renderDocumentMarkdown(plan, payload, title);
  const html = markdownToRichHtml(markdown, { title });
  const pdfBuffer = await renderPdfFromHtml(html);
  const stored = await saveDocumentBuffer(researchJobId, title, pdfBuffer);

  const clientDocument = await prisma.clientDocument.create({
    data: {
      clientId,
      docType: 'OTHER',
      fileName: stored.fileName,
      filePath: stored.storagePath,
      mimeType: 'application/pdf',
      fileSizeBytes: stored.sizeBytes,
      extractedText: null,
      isProcessed: true,
    },
    select: { id: true, uploadedAt: true },
  });

  let runtimeDocumentId = '';
  let runtimeVersionId = '';
  if (branchId && markdown.trim()) {
    const synced = await upsertGeneratedRuntimeDocument({
      researchJobId,
      branchId,
      userId: runtimeUserId,
      title,
      originalFileName: stored.fileName,
      mimeType: 'application/pdf',
      storagePath: stored.storagePath,
      sourceClientDocumentId: clientDocument.id,
      contentMd: markdown,
    });
    runtimeDocumentId = String(synced.documentId || '').trim();
    runtimeVersionId = String(synced.versionId || '').trim();
  }

  if (branchId) {
    await emitWorkspaceDocumentRuntimeEvent({
      branchId,
      processType: ProcessEventType.PROCESS_RESULT,
      eventName: 'document.draft_ready',
      message: payload.coverage.partial
        ? 'Generated document draft is ready with partial-depth coverage.'
        : 'Generated document draft is ready with deep coverage.',
      payload: {
        docId: stored.id,
        title,
        storagePath: stored.storagePath,
        coverageScore: payload.coverage.score,
        coverageBand: payload.coverage.band,
        partial: payload.coverage.partial,
        documentId: runtimeDocumentId || null,
        versionId: runtimeVersionId || null,
      },
      toolName: 'document.generate',
    });

    if (payload.coverage.partial) {
      await emitWorkspaceDocumentRuntimeEvent({
        branchId,
        processType: ProcessEventType.PROCESS_LOG,
        level: ProcessEventLevel.WARN,
        status: 'warn',
        eventName: 'document.partial_returned',
        message: 'Returned best draft because evidence coverage is below deep target.',
        payload: {
          coverageScore: payload.coverage.score,
          coverageBand: payload.coverage.band,
          reasons: payload.coverage.reasons,
          documentId: runtimeDocumentId || null,
          versionId: runtimeVersionId || null,
        },
        toolName: 'document.generate',
      });
    }
  }

  return {
    docId: stored.id,
    title,
    mimeType: 'application/pdf',
    storagePath: stored.storagePath,
    sizeBytes: stored.sizeBytes,
    createdAt: clientDocument.uploadedAt.toISOString(),
    clientDocumentId: clientDocument.id,
    ...(runtimeDocumentId ? { documentId: runtimeDocumentId } : {}),
    ...(runtimeVersionId ? { versionId: runtimeVersionId } : {}),
    coverageScore: payload.coverage.score,
    coverageBand: payload.coverage.band,
    enrichmentPerformed: payload.coverage.enriched,
    partial: payload.coverage.partial,
    ...(runtimeDocumentId ? { resumeDocumentId: runtimeDocumentId } : {}),
  };
}

export async function listGeneratedDocuments(researchJobId: string) {
  const job = await prisma.researchJob.findUnique({ where: { id: researchJobId }, select: { clientId: true } });
  if (!job) throw new Error('Research job not found');

  return prisma.clientDocument.findMany({
    where: {
      clientId: job.clientId,
      mimeType: 'application/pdf',
      filePath: { contains: `/docs/${researchJobId}/` },
    },
    orderBy: { uploadedAt: 'desc' },
    take: 50,
  });
}

export async function getGeneratedDocumentById(researchJobId: string, documentId: string) {
  const documents = await listGeneratedDocuments(researchJobId);
  return documents.find((doc) => doc.id === documentId) || null;
}
