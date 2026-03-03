import { ProcessEventLevel, ProcessEventType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { renderDocumentMarkdown } from './document-render';
import { saveDocumentBuffer } from './document-storage';
import { markdownToRichHtml } from './markdown-renderer';
import { renderPdfFromHtml } from './pdf-renderer';
import type {
  DocFamily,
  DocType,
  DocumentCoverage,
  DocumentDataPayload,
  DocumentPlan,
  GeneratedDocument,
  TopPostRow,
} from './document-spec';
import { canonicalDocFamily } from './document-spec';
import { emitWorkspaceDocumentRuntimeEvent } from './ingestion/ingestion-orchestrator';
import { upsertGeneratedRuntimeDocument } from './workspace-document-service';
import { buildDocumentSpecV1 } from './spec-builder';
import { draftDocumentSections } from './section-drafter';
import { persistDocumentQualityMemory } from '../chat/runtime/workspace-memory';

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

type LaneFilterStats = {
  kept: number;
  dropped: number;
  collisionRejected: number;
  meanScore: number;
  reasons: string[];
};

type RelevanceAnchors = {
  brandTokens: string[];
  competitorTokens: string[];
  workspaceHosts: string[];
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

const DOC_TYPE_SET = new Set<DocType>([
  'SWOT',
  'BUSINESS_STRATEGY',
  'PLAYBOOK',
  'COMPETITOR_AUDIT',
  'CONTENT_CALENDAR',
  'GO_TO_MARKET',
  'STRATEGY_BRIEF',
  'SWOT_ANALYSIS',
  'CONTENT_CALENDAR_LEGACY',
  'GTM_PLAN',
]);

const RELEVANCE_MIN_SCORE = {
  webSnapshots: 0.5,
  news: 0.55,
  community: 0.55,
} as const;

const STRICT_RELEVANCE_GATE_ENABLED = String(process.env.DOCUMENT_STRICT_RELEVANCE_GATE || 'true')
  .trim()
  .toLowerCase() !== 'false';
const STRUCTURE_QUALITY_GATE_ENABLED = String(process.env.DOCUMENT_STRUCTURE_QUALITY_GATE || 'true')
  .trim()
  .toLowerCase() !== 'false';
const ENTITY_COLLISION_GUARD_ENABLED = String(process.env.DOCUMENT_ENTITY_COLLISION_GUARD || 'true')
  .trim()
  .toLowerCase() !== 'false';

const DOC_TYPE_INTENT_MAP: Record<DocType, string> = {
  SWOT: 'swot_analysis',
  BUSINESS_STRATEGY: 'business_strategy',
  PLAYBOOK: 'playbook',
  COMPETITOR_AUDIT: 'competitor_audit',
  CONTENT_CALENDAR: 'content_calendar',
  GO_TO_MARKET: 'go_to_market',
  STRATEGY_BRIEF: 'strategy_brief',
  SWOT_ANALYSIS: 'swot_analysis',
  CONTENT_CALENDAR_LEGACY: 'content_calendar',
  GTM_PLAN: 'go_to_market',
};

const MIN_STRUCTURE_REQUIREMENTS: Record<DocType, Record<'short' | 'standard' | 'deep', { minSections: number; minEvidenceRows: number }>> = {
  SWOT: {
    short: { minSections: 7, minEvidenceRows: 10 },
    standard: { minSections: 9, minEvidenceRows: 14 },
    deep: { minSections: 10, minEvidenceRows: 18 },
  },
  BUSINESS_STRATEGY: {
    short: { minSections: 8, minEvidenceRows: 10 },
    standard: { minSections: 10, minEvidenceRows: 16 },
    deep: { minSections: 12, minEvidenceRows: 24 },
  },
  PLAYBOOK: {
    short: { minSections: 6, minEvidenceRows: 7 },
    standard: { minSections: 7, minEvidenceRows: 10 },
    deep: { minSections: 8, minEvidenceRows: 14 },
  },
  COMPETITOR_AUDIT: {
    short: { minSections: 8, minEvidenceRows: 10 },
    standard: { minSections: 9, minEvidenceRows: 14 },
    deep: { minSections: 10, minEvidenceRows: 18 },
  },
  CONTENT_CALENDAR: {
    short: { minSections: 6, minEvidenceRows: 8 },
    standard: { minSections: 7, minEvidenceRows: 11 },
    deep: { minSections: 8, minEvidenceRows: 14 },
  },
  GO_TO_MARKET: {
    short: { minSections: 9, minEvidenceRows: 10 },
    standard: { minSections: 10, minEvidenceRows: 14 },
    deep: { minSections: 11, minEvidenceRows: 18 },
  },
  STRATEGY_BRIEF: {
    short: { minSections: 8, minEvidenceRows: 10 },
    standard: { minSections: 10, minEvidenceRows: 16 },
    deep: { minSections: 12, minEvidenceRows: 24 },
  },
  SWOT_ANALYSIS: {
    short: { minSections: 7, minEvidenceRows: 10 },
    standard: { minSections: 9, minEvidenceRows: 14 },
    deep: { minSections: 10, minEvidenceRows: 18 },
  },
  CONTENT_CALENDAR_LEGACY: {
    short: { minSections: 6, minEvidenceRows: 8 },
    standard: { minSections: 7, minEvidenceRows: 11 },
    deep: { minSections: 8, minEvidenceRows: 14 },
  },
  GTM_PLAN: {
    short: { minSections: 9, minEvidenceRows: 10 },
    standard: { minSections: 10, minEvidenceRows: 14 },
    deep: { minSections: 11, minEvidenceRows: 18 },
  },
};

function normalizeToken(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function uniqueTokens(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((entry) => normalizeToken(entry))
        .filter((entry) => entry.length >= 3)
    )
  );
}

function parseHostname(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return String(new URL(url).hostname || '').trim().toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function splitWords(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3);
}

function normalizeIntent(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function inferDocTypeFromIntent(intent: string): DocType | null {
  const normalized = normalizeIntent(intent);
  if (!normalized) return null;
  if (normalized.includes('swot')) return 'SWOT';
  if (normalized.includes('go_to_market') || normalized.includes('gtm') || normalized.includes('launch')) return 'GO_TO_MARKET';
  if (normalized.includes('content_calendar') || normalized.includes('editorial_calendar')) return 'CONTENT_CALENDAR';
  if (normalized.includes('playbook') || normalized.includes('cadence')) return 'PLAYBOOK';
  if (normalized.includes('competitor') && normalized.includes('audit')) return 'COMPETITOR_AUDIT';
  if (normalized.includes('strategy')) return 'BUSINESS_STRATEGY';
  return null;
}

function intentForDocType(docType: DocType): string {
  return DOC_TYPE_INTENT_MAP[docType] || 'strategy_document';
}

function buildRelevanceAnchors(input: {
  clientName: string;
  websiteDomain: string;
  workspaceWebsites: string[];
  competitorHandles: string[];
}): RelevanceAnchors {
  const workspaceHosts = Array.from(
    new Set(
      input.workspaceWebsites
        .map((entry) => parseHostname(entry))
        .filter(Boolean)
    )
  );
  const workspaceHostWords = workspaceHosts.flatMap((host) => host.split('.')).filter((entry) => entry.length >= 4);
  const brandTokens = uniqueTokens([
    ...splitWords(input.clientName),
    ...splitWords(input.websiteDomain),
    ...workspaceHostWords,
  ]).filter((token) => token.length >= 4);

  const competitorTokens = uniqueTokens(
    input.competitorHandles.map((entry) => String(entry || '').replace(/^@+/, '').split(/[./]/)[0] || '')
  ).filter((token) => token.length >= 3);

  return {
    brandTokens,
    competitorTokens,
    workspaceHosts,
  };
}

function boundedLevenshteinDistance(left: string, right: string, maxDistance: number): number {
  if (left === right) return 0;
  const leftLen = left.length;
  const rightLen = right.length;
  if (!leftLen) return rightLen;
  if (!rightLen) return leftLen;
  if (Math.abs(leftLen - rightLen) > maxDistance) return maxDistance + 1;

  const prev = new Array(rightLen + 1);
  const next = new Array(rightLen + 1);
  for (let j = 0; j <= rightLen; j += 1) prev[j] = j;

  for (let i = 1; i <= leftLen; i += 1) {
    next[0] = i;
    let rowMin = next[0];
    for (let j = 1; j <= rightLen; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const insertion = next[j - 1] + 1;
      const deletion = prev[j] + 1;
      const substitution = prev[j - 1] + cost;
      const value = Math.min(insertion, deletion, substitution);
      next[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= rightLen; j += 1) prev[j] = next[j];
  }

  return prev[rightLen];
}

function looksAmbiguousBrandToken(candidate: string, brandTokens: string[]): boolean {
  if (!candidate || brandTokens.length === 0) return false;
  for (const brand of brandTokens) {
    if (!brand || candidate === brand) continue;
    const maxDistance = Math.max(candidate.length, brand.length) >= 6 ? 2 : 1;
    const distance = boundedLevenshteinDistance(candidate, brand, maxDistance);
    if (distance <= maxDistance) return true;
  }
  return false;
}

function scoreSourceRelevance(input: {
  text: string;
  url: string;
  anchors: RelevanceAnchors;
}): {
  score: number;
  ambiguous: boolean;
  hardRejected: boolean;
  signals: {
    hasHostAnchor: boolean;
    hasBrandToken: boolean;
    hasCompetitorToken: boolean;
  };
} {
  const lowerText = String(input.text || '').toLowerCase();
  const host = parseHostname(input.url);
  const normalizedWords = uniqueTokens(splitWords(lowerText));

  const hasHostAnchor = Boolean(
    host &&
      input.anchors.workspaceHosts.some((workspaceHost) => host === workspaceHost || host.endsWith(`.${workspaceHost}`))
  );
  const hasBrandToken = input.anchors.brandTokens.some((token) => normalizedWords.includes(token));
  const hasCompetitorToken = input.anchors.competitorTokens.some((token) => normalizedWords.includes(token));
  const hasAmbiguousBrand = !hasBrandToken && normalizedWords.some((word) => looksAmbiguousBrandToken(word, input.anchors.brandTokens));
  const hardRejected = ENTITY_COLLISION_GUARD_ENABLED && hasAmbiguousBrand && !hasHostAnchor && !hasBrandToken;

  let score = 0;
  if (hasHostAnchor) score += 0.58;
  if (hasBrandToken) score += 0.5;
  if (hasCompetitorToken) score += 0.18;
  if (host && input.anchors.brandTokens.some((token) => host.includes(token))) score += 0.2;
  if (hasAmbiguousBrand) score -= ENTITY_COLLISION_GUARD_ENABLED ? 0.5 : 0.2;
  if (hardRejected) score = 0;

  return {
    score: Math.max(0, Math.min(1, score)),
    ambiguous: hasAmbiguousBrand,
    hardRejected,
    signals: {
      hasHostAnchor,
      hasBrandToken,
      hasCompetitorToken,
    },
  };
}

function dedupeBySignature<T>(rows: T[], signature: (entry: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    const key = signature(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function normalizeSnippetForSignature(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .trim()
    .slice(0, 140);
}

function normalizeDepth(value: DocumentPlan['depth'] | undefined): 'short' | 'standard' | 'deep' {
  if (value === 'short' || value === 'deep') return value;
  return 'deep';
}

function normalizeDocType(value: unknown): DocType {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'SWOT_ANALYSIS' || raw === 'SWOT') return 'SWOT';
  if (raw === 'CONTENT_CALENDAR_LEGACY') return 'CONTENT_CALENDAR';
  if (raw === 'PLAYBOOK') return 'PLAYBOOK';
  if (raw === 'CONTENT_CALENDAR') return 'CONTENT_CALENDAR';
  if (raw === 'COMPETITOR_AUDIT') return 'COMPETITOR_AUDIT';
  if (raw === 'GO_TO_MARKET' || raw === 'GTM_PLAN') return 'GO_TO_MARKET';
  if (raw === 'STRATEGY_BRIEF' || raw === 'BUSINESS_STRATEGY') {
    return 'BUSINESS_STRATEGY';
  }
  if (DOC_TYPE_SET.has(raw as DocType)) return raw as DocType;
  return 'BUSINESS_STRATEGY';
}

function normalizePlan(plan: Partial<DocumentPlan> = {}): DocumentPlan {
  const requestedIntentRaw =
    typeof plan.requestedIntent === 'string' && plan.requestedIntent.trim()
      ? normalizeIntent(plan.requestedIntent)
      : '';
  const requestedDocType = requestedIntentRaw ? inferDocTypeFromIntent(requestedIntentRaw) : null;
  const explicitDocType = normalizeDocType(plan.docType);
  const docType = requestedDocType || explicitDocType;
  return {
    docType,
    title: typeof plan.title === 'string' && plan.title.trim() ? plan.title.trim() : undefined,
    audience: typeof plan.audience === 'string' && plan.audience.trim() ? plan.audience.trim() : 'Marketing team',
    timeframeDays: Number.isFinite(Number(plan.timeframeDays)) ? Math.max(7, Math.min(365, Number(plan.timeframeDays))) : 90,
    depth: normalizeDepth(plan.depth),
    includeCompetitors: plan.includeCompetitors ?? true,
    includeEvidenceLinks: plan.includeEvidenceLinks ?? true,
    requestedIntent: (requestedIntentRaw || intentForDocType(docType)).slice(0, 120),
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
  laneStats: {
    webSnapshots: LaneFilterStats;
    news: LaneFilterStats;
    community: LaneFilterStats;
  };
  explicitReasons?: string[];
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

  const nowMs = Date.now();
  const evidenceMs = input.latestEvidenceAt ? Date.parse(input.latestEvidenceAt) : NaN;
  const freshnessHours =
    Number.isFinite(evidenceMs) && evidenceMs > 0
      ? Math.max(0, (nowMs - evidenceMs) / (60 * 60 * 1000))
      : null;

  const quantityScore = clampScore(rawScore * 100);

  const relevanceBySignal = {
    competitors: input.counts.competitors > 0 ? 1 : 0.4,
    posts: input.counts.posts > 0 ? 1 : 0.4,
    webSnapshots: Math.max(0, Math.min(1, Number(input.laneStats.webSnapshots.meanScore || 0))),
    news: Math.max(0, Math.min(1, Number(input.laneStats.news.meanScore || 0))),
    community: Math.max(0, Math.min(1, Number(input.laneStats.community.meanScore || 0))),
  } as const;
  const relevanceRaw =
    relevanceBySignal.competitors * weights.competitors +
    relevanceBySignal.posts * weights.posts +
    relevanceBySignal.webSnapshots * weights.webSnapshots +
    relevanceBySignal.news * weights.news +
    relevanceBySignal.community * weights.community;
  const relevanceScore = clampScore(relevanceRaw * 100);

  const freshnessScore = clampScore(
    freshnessHours === null
      ? 40
      : freshnessHours <= 24
        ? 100
        : freshnessHours <= 72
          ? 90
          : freshnessHours <= 168
            ? 75
            : freshnessHours <= 336
              ? 60
              : freshnessHours <= 720
                ? 40
                : 20
  );

  const overallScore = clampScore(quantityScore * 0.5 + relevanceScore * 0.35 + freshnessScore * 0.15);

  const partialReasons: string[] = [];
  const blockingReasons: string[] = [];
  for (const key of Object.keys(input.targets) as Array<keyof typeof input.targets>) {
    const target = input.targets[key];
    const count = input.counts[key];
    if (target <= 0) continue;
    if (count >= target) continue;
    partialReasons.push(`Low ${key} coverage (${count}/${target}) for deep-confidence synthesis.`);
  }
  if (freshnessHours !== null && freshnessHours > 336) {
    partialReasons.push(`Newest evidence is older than ${Math.round(freshnessHours / 24)} days.`);
  }
  if (input.laneStats.webSnapshots.kept === 0 && input.laneStats.webSnapshots.dropped > 0) {
    blockingReasons.push('Web evidence failed relevance validation for this brand context.');
  }
  if (input.laneStats.news.kept === 0 && input.laneStats.news.dropped > 0) {
    partialReasons.push('News evidence failed relevance validation and was excluded.');
  }
  if (input.laneStats.community.kept === 0 && input.laneStats.community.dropped > 0) {
    partialReasons.push('Community evidence failed relevance validation and was excluded.');
  }
  if (input.laneStats.webSnapshots.dropped > 0) {
    partialReasons.push(`Filtered ${input.laneStats.webSnapshots.dropped} low-relevance web snapshot(s).`);
  }
  if (input.laneStats.webSnapshots.collisionRejected > 0) {
    partialReasons.push(`Rejected ${input.laneStats.webSnapshots.collisionRejected} web snapshot(s) due to likely entity collision.`);
  }
  if (input.laneStats.news.dropped > 0) {
    partialReasons.push(`Filtered ${input.laneStats.news.dropped} low-relevance news item(s).`);
  }
  if (input.laneStats.news.collisionRejected > 0) {
    partialReasons.push(`Rejected ${input.laneStats.news.collisionRejected} news item(s) due to likely entity collision.`);
  }
  if (input.laneStats.community.dropped > 0) {
    partialReasons.push(`Filtered ${input.laneStats.community.dropped} low-relevance community insight(s).`);
  }
  if (input.laneStats.community.collisionRejected > 0) {
    partialReasons.push(`Rejected ${input.laneStats.community.collisionRejected} community insight(s) due to likely entity collision.`);
  }

  if (Array.isArray(input.explicitReasons)) {
    for (const reason of input.explicitReasons) {
      const normalized = String(reason || '').trim();
      if (!normalized) continue;
      partialReasons.push(normalized);
    }
  }

  const band: DocumentCoverage['band'] = overallScore >= 80 ? 'strong' : overallScore >= 55 ? 'moderate' : 'thin';
  const partialThreshold = input.depth === 'deep' ? 80 : input.depth === 'standard' ? 65 : 50;
  const reasons = Array.from(new Set([...blockingReasons, ...partialReasons]));
  const normalizedReasons = reasons.length ? reasons : ['Coverage meets current depth and relevance targets.'];

  return {
    score: overallScore,
    quantityScore,
    relevanceScore,
    freshnessScore,
    overallScore,
    band,
    counts: input.counts,
    targets: input.targets,
    relevance: {
      webSnapshots: clampScore(input.laneStats.webSnapshots.meanScore * 100),
      news: clampScore(input.laneStats.news.meanScore * 100),
      community: clampScore(input.laneStats.community.meanScore * 100),
      overall: relevanceScore,
      dropped: {
        webSnapshots: input.laneStats.webSnapshots.dropped,
        news: input.laneStats.news.dropped,
        community: input.laneStats.community.dropped,
      },
    },
    freshnessHours: freshnessHours === null ? null : Number(freshnessHours.toFixed(1)),
    blockingReasons,
    partialReasons,
    reasons: normalizedReasons,
    enriched: Boolean(input.enriched),
    partial: overallScore < partialThreshold || blockingReasons.length > 0,
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

function filterLaneByRelevance<T, TWithScore extends T>(input: {
  rows: T[];
  anchors: RelevanceAnchors;
  minScore: number;
  strictGateEnabled: boolean;
  laneLabel: string;
  text: (row: T) => string;
  url: (row: T) => string;
  withScore: (row: T, score: number) => TWithScore;
}): { rows: TWithScore[]; stats: LaneFilterStats; reasons: string[] } {
  if (!input.rows.length) {
    return {
      rows: [],
      stats: { kept: 0, dropped: 0, collisionRejected: 0, meanScore: 0, reasons: [] },
      reasons: [],
    };
  }

  const scored = input.rows.map((row) => {
    const relevance = scoreSourceRelevance({
      text: input.text(row),
      url: input.url(row),
      anchors: input.anchors,
    });
    return {
      row,
      score: relevance.score,
      ambiguous: relevance.ambiguous,
      hardRejected: relevance.hardRejected,
    };
  });

  const kept = scored
    .filter((entry) => {
      if (!input.strictGateEnabled) return true;
      if (entry.hardRejected) return false;
      return entry.score >= input.minScore;
    })
    .map((entry) => input.withScore(entry.row, entry.score));
  const collisionRejected = scored.filter((entry) => entry.hardRejected).length;
  const dropped = input.strictGateEnabled ? scored.length - kept.length : 0;
  const meanScore = kept.length ? kept.reduce((sum, entry) => sum + Number((entry as any).relevanceScore || 0), 0) / kept.length : 0;
  const ambiguousCount = scored.filter((entry) => entry.ambiguous).length;
  const reasons: string[] = [];
  if (!input.strictGateEnabled) {
    reasons.push(`${input.laneLabel}: strict relevance gate disabled by feature flag.`);
  } else {
    if (collisionRejected > 0) {
      reasons.push(`${input.laneLabel}: rejected ${collisionRejected} probable entity-collision row(s).`);
    }
    if (dropped > 0) reasons.push(`${input.laneLabel}: dropped ${dropped} low-relevance item(s).`);
    if (ambiguousCount > 0) reasons.push(`${input.laneLabel}: flagged ${ambiguousCount} potentially ambiguous brand-match item(s).`);
    if (kept.length === 0) reasons.push(`${input.laneLabel}: no rows passed relevance threshold.`);
  }

  return {
    rows: kept,
    stats: {
      kept: kept.length,
      dropped,
      collisionRejected,
      meanScore,
      reasons,
    },
    reasons,
  };
}

function evaluateStructureThresholds(plan: DocumentPlan, payload: DocumentDataPayload, markdown: string): string[] {
  const depth = normalizeDepth(plan.depth);
  const docType = normalizeDocType(plan.docType);
  const thresholds = MIN_STRUCTURE_REQUIREMENTS[docType][depth];
  const sectionCount = String(markdown || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^##\s+/.test(line)).length;
  const evidenceRows =
    payload.topPosts.length + payload.competitors.length + payload.webSnapshots.length + payload.news.length + payload.communityInsights.length;
  const reasons: string[] = [];
  if (sectionCount < thresholds.minSections) {
    reasons.push(`Document structure is shallow (${sectionCount}/${thresholds.minSections} sections).`);
  }
  if (evidenceRows < thresholds.minEvidenceRows) {
    reasons.push(`Evidence density is thin (${evidenceRows}/${thresholds.minEvidenceRows} rows).`);
  }
  return reasons;
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

  const workspaceWebsites = [
    String(job.client.brainProfile?.websiteDomain || ''),
    String((job.inputData as Record<string, unknown> | null)?.website || ''),
    ...(((job.inputData as Record<string, unknown> | null)?.websites as unknown[]) || []).map((entry) => String(entry || '')),
  ].filter(Boolean);
  const anchors = buildRelevanceAnchors({
    clientName: job.client.name,
    websiteDomain: String(job.client.brainProfile?.websiteDomain || ''),
    workspaceWebsites,
    competitorHandles: competitorsRaw.map((row) => row.handle),
  });

  const webSnapshotsCandidate = dedupeBySignature(
    webSnapshotsRaw
      .map((entry) => ({
        finalUrl: String(entry.finalUrl || '').trim(),
        statusCode: entry.statusCode,
        fetchedAt: entry.fetchedAt.toISOString(),
        snippet: String(entry.cleanText || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      }))
      .filter((entry) => Boolean(entry.finalUrl)),
    (entry) => `${parseHostname(entry.finalUrl)}:${normalizeSnippetForSignature(entry.snippet)}`
  );

  const newsCandidate = dedupeBySignature(
    newsRaw
      .map((entry) => ({
        title: String(entry.title || '').trim(),
        url: String(entry.url || '').trim(),
        source: String(entry.source || 'news').trim() || 'news',
        publishedAt: String(entry.publishedAt || '').trim() || entry.createdAt.toISOString(),
        snippet: String(entry.body || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      }))
      .filter((entry) => Boolean(entry.title) && Boolean(entry.url)),
    (entry) => `${parseHostname(entry.url)}:${normalizeSnippetForSignature(entry.title)}`
  );

  const communityCandidate = dedupeBySignature(
    communityRaw
      .map((entry) => ({
        source: String(entry.source || 'community').trim() || 'community',
        url: String(entry.url || '').trim(),
        summary: String(entry.content || '').replace(/\s+/g, ' ').trim().slice(0, 260),
        createdAt: entry.createdAt.toISOString(),
      }))
      .filter((entry) => Boolean(entry.summary)),
    (entry) => `${parseHostname(entry.url)}:${normalizeSnippetForSignature(entry.summary)}`
  );

  const webFiltered = filterLaneByRelevance({
    rows: webSnapshotsCandidate,
    anchors,
    minScore: RELEVANCE_MIN_SCORE.webSnapshots,
    strictGateEnabled: STRICT_RELEVANCE_GATE_ENABLED,
    laneLabel: 'Web evidence',
    text: (row) => `${row.finalUrl} ${row.snippet}`,
    url: (row) => row.finalUrl,
    withScore: (row, score) => ({ ...row, relevanceScore: Number(score.toFixed(3)) }),
  });
  const newsFiltered = filterLaneByRelevance({
    rows: newsCandidate,
    anchors,
    minScore: RELEVANCE_MIN_SCORE.news,
    strictGateEnabled: STRICT_RELEVANCE_GATE_ENABLED,
    laneLabel: 'News evidence',
    text: (row) => `${row.title} ${row.snippet}`,
    url: (row) => row.url,
    withScore: (row, score) => ({ ...row, relevanceScore: Number(score.toFixed(3)) }),
  });
  const communityFiltered = filterLaneByRelevance({
    rows: communityCandidate,
    anchors,
    minScore: RELEVANCE_MIN_SCORE.community,
    strictGateEnabled: STRICT_RELEVANCE_GATE_ENABLED,
    laneLabel: 'Community evidence',
    text: (row) => `${row.source} ${row.summary}`,
    url: (row) => row.url,
    withScore: (row, score) => ({ ...row, relevanceScore: Number(score.toFixed(3)) }),
  });

  const webSnapshots = webFiltered.rows
    .map((entry) => ({
      finalUrl: String(entry.finalUrl || '').trim(),
      statusCode: entry.statusCode,
      fetchedAt: String(entry.fetchedAt || '').trim(),
      snippet: String(entry.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      relevanceScore: Number(entry.relevanceScore || 0),
    }))
    .filter((entry) => Boolean(entry.finalUrl));

  const news = newsFiltered.rows
    .map((entry) => ({
      title: String(entry.title || '').trim(),
      url: String(entry.url || '').trim(),
      source: String(entry.source || 'news').trim() || 'news',
      publishedAt: String(entry.publishedAt || '').trim(),
      snippet: String(entry.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      relevanceScore: Number(entry.relevanceScore || 0),
    }))
    .filter((entry) => Boolean(entry.title) && Boolean(entry.url));

  const communityInsights = communityFiltered.rows
    .map((entry) => ({
      source: String(entry.source || 'community').trim() || 'community',
      url: String(entry.url || '').trim(),
      summary: String(entry.summary || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      createdAt: String(entry.createdAt || '').trim(),
      relevanceScore: Number(entry.relevanceScore || 0),
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
    laneStats: {
      webSnapshots: webFiltered.stats,
      news: newsFiltered.stats,
      community: communityFiltered.stats,
    },
    explicitReasons: [...webFiltered.reasons, ...newsFiltered.reasons, ...communityFiltered.reasons],
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
    requestedIntent: plan.requestedIntent || intentForDocType(plan.docType),
    renderedIntent: intentForDocType(plan.docType),
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
  const family = canonicalDocFamily(plan.docType);
  if (family === 'SWOT') return `${clientName} SWOT Analysis`;
  if (family === 'COMPETITOR_AUDIT') return `${clientName} Competitor Audit`;
  if (family === 'CONTENT_CALENDAR') return `${clientName} Content Calendar`;
  if (family === 'GO_TO_MARKET') return `${clientName} Go-To-Market Plan`;
  if (family === 'PLAYBOOK') return `${clientName} Playbook`;
  return `${clientName} Business Strategy`;
}

async function persistWorkLedgerVersionSafe(input: {
  researchJobId: string;
  runId?: string;
  documentId?: string;
  versionId?: string;
  stage: string;
  payload: Record<string, unknown>;
}) {
  try {
    const model = (prisma as any).workLedgerVersion;
    if (!model || typeof model.create !== 'function') return;
    await model.create({
      data: {
        researchJobId: input.researchJobId,
        runId: input.runId || null,
        documentId: input.documentId || null,
        versionId: input.versionId || null,
        stage: String(input.stage || '').slice(0, 80) || 'unknown',
        payloadJson: input.payload,
      },
    });
  } catch (error) {
    console.warn('[DocumentService] Failed to persist WorkLedgerVersion:', (error as Error).message);
  }
}

async function persistDocumentSpecVersionSafe(input: {
  researchJobId: string;
  runId?: string;
  documentId?: string;
  versionId?: string;
  spec: Record<string, unknown>;
  repaired: boolean;
  validationErrors: string[];
}) {
  try {
    const model = (prisma as any).documentSpecVersion;
    if (!model || typeof model.create !== 'function') return;
    await model.create({
      data: {
        researchJobId: input.researchJobId,
        runId: input.runId || null,
        documentId: input.documentId || null,
        versionId: input.versionId || null,
        schemaVersion: 'v1',
        specJson: input.spec,
        repaired: input.repaired,
        validationErrorsJson: input.validationErrors,
      },
    });
  } catch (error) {
    console.warn('[DocumentService] Failed to persist DocumentSpecVersion:', (error as Error).message);
  }
}

async function persistDocumentSectionDraftsSafe(input: {
  researchJobId: string;
  runId?: string;
  documentId?: string;
  versionId?: string;
  sectionDrafts: Array<{
    id: string;
    title: string;
    kind: string;
    contentMd: string;
    evidenceRefIds: string[];
    status: string;
    partialReason?: string;
  }>;
}) {
  try {
    const model = (prisma as any).documentSectionDraft;
    if (!model || typeof model.createMany !== 'function') return;
    if (!input.sectionDrafts.length) return;
    await model.createMany({
      data: input.sectionDrafts.map((section, index) => ({
        researchJobId: input.researchJobId,
        runId: input.runId || null,
        documentId: input.documentId || null,
        versionId: input.versionId || null,
        sectionId: String(section.id || '').slice(0, 120) || `section-${index + 1}`,
        sectionKind: String(section.kind || '').slice(0, 80) || 'section',
        title: String(section.title || '').slice(0, 200) || `Section ${index + 1}`,
        contentMd: String(section.contentMd || ''),
        evidenceRefIdsJson: section.evidenceRefIds || [],
        status: String(section.status || 'insufficient_evidence').slice(0, 40),
        partialReason: section.partialReason || null,
      })),
      skipDuplicates: false,
    });
  } catch (error) {
    console.warn('[DocumentService] Failed to persist DocumentSectionDraft:', (error as Error).message);
  }
}

export async function generateDocumentForResearchJob(
  researchJobId: string,
  planInput: Partial<DocumentPlan>,
  options?: {
    branchId?: string;
    userId?: string;
    runId?: string;
    enrichmentPerformed?: boolean;
  },
): Promise<GeneratedDocument> {
  const plan = normalizePlan(planInput);
  const { payload, clientId } = await buildPayload(researchJobId, plan, {
    enriched: Boolean(options?.enrichmentPerformed),
  });
  const title = resolveTitle(plan, payload.clientName);
  const docFamily: DocFamily = canonicalDocFamily(plan.docType);
  const specBuild = buildDocumentSpecV1({
    plan,
    payload,
    title,
    docFamily,
  });
  const sectionDrafting = draftDocumentSections({
    spec: specBuild.spec,
    payload,
  });

  const branchId = String(options?.branchId || '').trim();
  const runtimeUserId = String(options?.userId || '').trim() || 'runtime-tool';
  const runtimeRunId = String(options?.runId || '').trim() || undefined;

  await persistWorkLedgerVersionSafe({
    researchJobId,
    runId: runtimeRunId,
    stage: 'intent_routed',
    payload: {
      requestedIntent: payload.requestedIntent,
      renderedIntent: payload.renderedIntent,
      requestedDocType: plan.docType,
      docFamily,
    },
  });
  await persistDocumentSpecVersionSafe({
    researchJobId,
    runId: runtimeRunId,
    spec: specBuild.spec as unknown as Record<string, unknown>,
    repaired: specBuild.repaired,
    validationErrors: specBuild.validationErrors,
  });
  await persistDocumentSectionDraftsSafe({
    researchJobId,
    runId: runtimeRunId,
    sectionDrafts: sectionDrafting.sections,
  });

  if (branchId) {
    await emitWorkspaceDocumentRuntimeEvent({
      branchId,
      processType: ProcessEventType.PROCESS_LOG,
      eventName: 'document.intent_routed',
      message: `Intent routed to ${docFamily}.`,
      payload: {
        stage: 'intent',
        docFamily,
        requestedIntent: payload.requestedIntent,
        renderedIntent: payload.renderedIntent,
        requestedDocType: plan.docType,
      },
      toolName: 'document.generate',
    });

    await emitWorkspaceDocumentRuntimeEvent({
      branchId,
      processType: ProcessEventType.PROCESS_LOG,
      eventName: 'document.spec_built',
      message: `Document spec built (${specBuild.spec.sections.length} sections).`,
      payload: {
        stage: 'doc_spec',
        docFamily,
        sectionCount: specBuild.spec.sections.length,
        repaired: specBuild.repaired,
        validationErrors: specBuild.validationErrors,
      },
      toolName: 'document.generate',
    });

    await emitWorkspaceDocumentRuntimeEvent({
      branchId,
      processType: ProcessEventType.PROCESS_LOG,
      eventName: 'document.section_draft_started',
      message: 'Section drafting started.',
      payload: {
        stage: 'section_drafts',
        sectionCount: specBuild.spec.sections.length,
        docFamily,
      },
      toolName: 'document.generate',
    });

    await emitWorkspaceDocumentRuntimeEvent({
      branchId,
      processType: ProcessEventType.PROCESS_RESULT,
      eventName: 'document.section_draft_completed',
      message: `Section drafting completed (${sectionDrafting.sections.length} sections).`,
      payload: {
        stage: 'section_drafts',
        sectionCount: sectionDrafting.sections.length,
        insufficientEvidenceSections: sectionDrafting.sections.filter((row) => row.status === 'insufficient_evidence')
          .length,
        partialReasons: sectionDrafting.partialReasons,
      },
      toolName: 'document.generate',
    });

    await emitWorkspaceDocumentRuntimeEvent({
      branchId,
      processType: ProcessEventType.PROCESS_LOG,
      eventName: 'document.preflight',
      message: `Document preflight complete (${payload.coverage.score}/100, ${payload.coverage.band}).`,
      payload: {
        stage: 'preflight',
        coverageScore: payload.coverage.score,
        overallScore: payload.coverage.overallScore,
        quantityScore: payload.coverage.quantityScore,
        relevanceScore: payload.coverage.relevanceScore,
        freshnessScore: payload.coverage.freshnessScore,
        coverageBand: payload.coverage.band,
        partial: payload.coverage.partial,
        counts: payload.coverage.counts,
        targets: payload.coverage.targets,
        blockingReasons: payload.coverage.blockingReasons,
        partialReasons: payload.coverage.partialReasons,
        reasons: payload.coverage.reasons,
        docType: plan.docType,
        requestedIntent: payload.requestedIntent,
        renderedIntent: payload.renderedIntent,
      },
      toolName: 'document.generate',
    });
  }

  const markdown = renderDocumentMarkdown(plan, payload, title);
  const structureReasons = STRUCTURE_QUALITY_GATE_ENABLED ? evaluateStructureThresholds(plan, payload, markdown) : [];
  if (structureReasons.length) {
    const partialReasons = Array.from(new Set([...payload.coverage.partialReasons, ...structureReasons]));
    const allReasons = Array.from(new Set([...payload.coverage.blockingReasons, ...partialReasons]));
    const penalty = Math.min(20, structureReasons.length * 7);
    const adjustedOverall = clampScore(payload.coverage.overallScore - penalty);
    const adjustedBand: DocumentCoverage['band'] =
      adjustedOverall >= 80 ? 'strong' : adjustedOverall >= 55 ? 'moderate' : 'thin';
    payload.coverage = {
      ...payload.coverage,
      score: adjustedOverall,
      overallScore: adjustedOverall,
      band: adjustedBand,
      partial: true,
      partialReasons,
      reasons: allReasons,
    };
  }

  if (branchId) {
    await emitWorkspaceDocumentRuntimeEvent({
      branchId,
      processType: ProcessEventType.PROCESS_RESULT,
      eventName: 'document.validation_completed',
      message: payload.coverage.partial
        ? 'Validation completed with partial-depth constraints.'
        : 'Validation completed successfully.',
      payload: {
        stage: 'validation',
        partial: payload.coverage.partial,
        partialReasons: payload.coverage.partialReasons,
        blockingReasons: payload.coverage.blockingReasons,
        coverageScore: payload.coverage.score,
      },
      toolName: 'document.generate',
    });
  }
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
      generatedMeta: {
        docFamily,
        coverageScore: payload.coverage.score,
        coverageBand: payload.coverage.band,
        partial: payload.coverage.partial,
        partialReasons: payload.coverage.partialReasons,
      },
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
        stage: 'draft',
        docId: stored.id,
        title,
        docType: plan.docType,
        storagePath: stored.storagePath,
        coverageScore: payload.coverage.score,
        overallScore: payload.coverage.overallScore,
        coverageBand: payload.coverage.band,
        partial: payload.coverage.partial,
        partialReasons: payload.coverage.partialReasons,
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
          stage: 'partial',
          coverageScore: payload.coverage.score,
          overallScore: payload.coverage.overallScore,
          coverageBand: payload.coverage.band,
          partialReasons: payload.coverage.partialReasons,
          reasons: payload.coverage.reasons,
          docType: plan.docType,
          documentId: runtimeDocumentId || null,
          versionId: runtimeVersionId || null,
        },
        toolName: 'document.generate',
      });
    }

    await emitWorkspaceDocumentRuntimeEvent({
      branchId,
      processType: ProcessEventType.PROCESS_RESULT,
      eventName: 'document.artifact_rendered',
      message: 'Document artifact rendered and stored.',
      payload: {
        stage: 'artifact',
        docId: stored.id,
        storagePath: stored.storagePath,
        sizeBytes: stored.sizeBytes,
        mimeType: 'application/pdf',
        documentId: runtimeDocumentId || null,
        versionId: runtimeVersionId || null,
      },
      toolName: 'document.generate',
    });
  }

  await persistDocumentQualityMemory({
    researchJobId,
    branchId: branchId || null,
    sourceRunId: runtimeRunId || null,
    docFamily,
    coverageScore: payload.coverage.score,
    coverageBand: payload.coverage.band,
    partial: payload.coverage.partial,
    partialReasons: payload.coverage.partialReasons,
  }).catch(() => {
    // Memory persistence is best-effort; do not block document delivery.
  });

  return {
    docId: stored.id,
    title,
    docType: plan.docType,
    requestedIntent: payload.requestedIntent,
    renderedIntent: payload.renderedIntent,
    mimeType: 'application/pdf',
    storagePath: stored.storagePath,
    sizeBytes: stored.sizeBytes,
    createdAt: clientDocument.uploadedAt.toISOString(),
    clientDocumentId: clientDocument.id,
    ...(runtimeDocumentId ? { documentId: runtimeDocumentId } : {}),
    ...(runtimeVersionId ? { versionId: runtimeVersionId } : {}),
    coverageScore: payload.coverage.score,
    coverageBand: payload.coverage.band,
    overallScore: payload.coverage.overallScore,
    enrichmentPerformed: payload.coverage.enriched,
    partial: payload.coverage.partial,
    partialReasons: payload.coverage.partialReasons,
    iterationsUsed: 1,
    depthApplied: plan.depth,
    sectionCoverage: sectionDrafting.sections.map((section) => ({
      sectionId: section.id,
      status: section.status,
      evidenceRefCount: Array.isArray(section.evidenceRefIds) ? section.evidenceRefIds.length : 0,
    })),
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
      OR: [
        { filePath: { contains: `/docs/${researchJobId}/` } }, // legacy path
        { filePath: { contains: `/documents/${researchJobId}/generated/` } }, // current path
      ],
    },
    orderBy: { uploadedAt: 'desc' },
    take: 50,
  });
}

export async function getGeneratedDocumentById(researchJobId: string, documentId: string) {
  const documents = await listGeneratedDocuments(researchJobId);
  return documents.find((doc) => doc.id === documentId) || null;
}

export const __documentServiceInternals = {
  normalizePlan,
  buildRelevanceAnchors,
  scoreSourceRelevance,
  inferDocTypeFromIntent,
  intentForDocType,
};
