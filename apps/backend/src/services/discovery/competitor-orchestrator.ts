import OpenAI from 'openai';
import {
  CompetitorSelectionState,
  DiscoveredCompetitorStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { isOpenAiConfiguredForRealMode } from '../../lib/runtime-preflight';
import { suggestCompetitorsMultiPlatform } from '../ai/competitor-discovery';
import { resolveModelForTask } from '../ai/model-router';
import {
  performDirectCompetitorSearch,
  performDirectCompetitorSearchForPlatform,
  inferCompetitorDiscoveryIntent,
  searchCompetitorsDDG,
  validateHandleDDG,
  HandleValidationResult,
} from './duckduckgo-search';
import { buildCompetitorDiscoveryPlan } from './competitor-query-planner';
import { validateCompetitorBatch, ValidationResult } from './instagram-validator';
import { emitResearchJobEvent } from '../social/research-job-events';
import { scrapeCompetitorsIncremental } from './competitor-scraper';
import {
  normalizeHandleFromUrlOrHandle,
  validateHandleForPlatform,
} from '../handles/platform-handle';

type SupportedPlatform = 'instagram' | 'tiktok';
type CandidateSource = 'algorithmic' | 'direct' | 'ai';
type OrchestrationMode = 'append' | 'replace';

type CandidateAggregate = {
  key: string;
  handle: string;
  platform: SupportedPlatform;
  initialScore: number;
  sources: Set<CandidateSource>;
  reasons: string[];
  titles: string[];
};

type RankingComponentScores = {
  offerOverlap: number;
  audienceOverlap: number;
  nicheSemanticMatch: number;
  activityRecency: number;
  sizeSimilarity: number;
  sourceConfidence: number;
};

type PersistableCandidate = {
  handle: string;
  platform: SupportedPlatform;
  relevanceScore: number; // 0..1
  totalScore: number; // 0..100
  selectionState: CompetitorSelectionState;
  selectionReason: string;
  discoveryReason: string;
  evidence: Prisma.InputJsonValue;
  scoreBreakdown: Prisma.InputJsonValue;
};

type CandidateEvaluation = PersistableCandidate & {
  peerOverlapScore: number;
  ragAffinityScore: number;
  sourceCount: number;
  aiSemanticScore: number;
  hardRejected: boolean;
  shortlistEligible: boolean;
  shortlistGateReason: string;
};

type AiRankingScores = {
  offerOverlap: number;
  audienceOverlap: number;
  nicheSemanticMatch: number;
  explanation: string;
};

export type CompetitorOrchestrationInput = {
  mode?: OrchestrationMode;
  platforms?: SupportedPlatform[];
  targetCount?: number;
  sources?: CandidateSource[];
};

export type CompetitorOrchestrationSummary = {
  candidatesDiscovered: number;
  candidatesFiltered: number;
  shortlisted: number;
  topPicks: number;
};

export type CompetitorShortlistResponse = {
  runId: string | null;
  summary: CompetitorOrchestrationSummary;
  topPicks: any[];
  shortlist: any[];
  filteredOut: any[];
};

type OrchestrationErrorCode =
  | 'ORCHESTRATION_ALREADY_RUNNING'
  | 'ORCHESTRATION_RUN_NOT_FOUND'
  | 'INVALID_INPUT';

type OrchestrationServiceError = Error & {
  code?: OrchestrationErrorCode;
  statusCode?: number;
};

function readStaleThresholdMs(): number {
  const raw = Number(process.env.COMPETITOR_ORCHESTRATION_STALE_MINUTES || 10);
  const minutes = Number.isFinite(raw) ? Math.max(2, raw) : 10;
  return Math.floor(minutes * 60 * 1000);
}

const ORCHESTRATION_RUNNING_STALE_MS = readStaleThresholdMs();

const SCORE_WEIGHTS = {
  offerOverlap: 30,
  audienceOverlap: 25,
  nicheSemanticMatch: 20,
  activityRecency: 10,
  sizeSimilarity: 10,
  sourceConfidence: 5,
} as const;

const SOURCE_BASE_SCORES: Record<CandidateSource, number> = {
  algorithmic: 0.58,
  direct: 0.52,
  ai: 0.74,
};

const UNIVERSAL_BLACKLIST_TERMS = [
  'coupon',
  'giveaway',
  'discount code',
  'promo code',
  'meme',
  'fanpage',
  'fan page',
  'daily motivation',
  'quotes',
  'follow for follow',
  'f4f',
];

const CONTEXTUAL_BLACKLIST_TERMS = [
  {
    terms: ['crypto signals', 'signal group'],
    allowIf: /(crypto|web3|blockchain|defi|trading|onchain)/i,
  },
  {
    terms: ['stock alerts', 'swing trade alerts'],
    allowIf: /(stock|equity|finance|investment|trading)/i,
  },
  {
    terms: ['travel blog', 'travel vlogs'],
    allowIf: /(travel|tourism|hospitality)/i,
  },
  {
    terms: ['fashion blog', 'beauty tips'],
    allowIf: /(fashion|beauty|cosmetics|apparel|style)/i,
  },
];

const GENERIC_HANDLE_BLOCKLIST = new Set([
  'google',
  'ibm',
  'nike',
  'netflix',
  'entrepreneur',
  'creators',
  'business',
  'marketing',
  'startup',
  'viral',
  'motivation',
  'success',
  'quotes',
  'inspiration',
  'garyvee',
  'elonmusk',
  'richardbranson',
  'grantcardone',
  'simonsinek',
  'brenebrown',
  'codiesanchez',
  'imangadzhi',
]);

const LOW_SIGNAL_HANDLE_TOKENS = [
  'coupon',
  'deal',
  'deals',
  'discount',
  'giveaway',
  'quote',
  'quotes',
  'meme',
  'memes',
  'fanpage',
  'fan_page',
  'fanclub',
  'follow4follow',
  'f4f',
];

const FILTERED_RETENTION_MIN_SCORE = Number(process.env.COMPETITOR_FILTERED_MIN_SCORE || 45);
const FILTERED_RETENTION_MAX = Math.max(
  5,
  Math.min(40, Number(process.env.COMPETITOR_MAX_FILTERED_PER_RUN || 15))
);

const PEER_CONTEXT_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'your',
  'their',
  'they',
  'them',
  'brand',
  'business',
  'creator',
  'creators',
  'content',
  'official',
  'community',
  'social',
  'media',
  'account',
  'accounts',
  'instagram',
  'tiktok',
  'about',
  'https',
  'www',
  'com',
]);

const TOP_PICK_SCORE_THRESHOLD = Number(process.env.COMPETITOR_TOP_PICK_SCORE || 78);
const SHORTLIST_SCORE_THRESHOLD = Number(process.env.COMPETITOR_SHORTLIST_SCORE || 65);
const PROMOTION_SCORE_THRESHOLD = Number(process.env.COMPETITOR_PROMOTION_SCORE || 55);
const MIN_REVIEW_TARGET = Math.max(
  5,
  Math.min(10, Number(process.env.COMPETITOR_MIN_REVIEW_TARGET || 5))
);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeHandle(raw: string, platform?: SupportedPlatform): string {
  return normalizeHandleFromUrlOrHandle(raw, platform);
}

function validateCandidateHandle(
  handle: string,
  platform: SupportedPlatform = 'instagram'
): { allowed: boolean; reason?: string } {
  if (!handle) return { allowed: false, reason: 'empty' };
  const platformValidation = validateHandleForPlatform(platform, handle, {
    requireLetters: true,
    rejectNumericIds: true,
  });
  if (!platformValidation.allowed) {
    return {
      allowed: false,
      reason: platformValidation.reason || 'invalid_platform_handle',
    };
  }
  if (GENERIC_HANDLE_BLOCKLIST.has(handle)) return { allowed: false, reason: 'generic_handle' };
  const tokenized = handle.replace(/[._]+/g, ' ');
  if (LOW_SIGNAL_HANDLE_TOKENS.some((token) => tokenized.includes(token))) {
    return { allowed: false, reason: 'low_signal_handle' };
  }
  return { allowed: true };
}

function normalizeCompetitorKey(
  platformRaw: string,
  handleRaw: string
): `${SupportedPlatform}:${string}` | null {
  const platform =
    platformRaw === 'tiktok'
      ? 'tiktok'
      : platformRaw === 'instagram'
        ? 'instagram'
        : null;
  if (!platform) return null;

  const handle = normalizeHandle(handleRaw, platform);
  if (!handle) return null;
  const validation = validateCandidateHandle(handle, platform);
  if (!validation.allowed) return null;
  return `${platform}:${handle}`;
}

function inferPlatform(raw: string, fallback: SupportedPlatform = 'instagram'): SupportedPlatform {
  const value = String(raw || '').toLowerCase();
  if (value.includes('tiktok')) return 'tiktok';
  if (value.includes('instagram')) return 'instagram';
  return fallback;
}

function tokenizePeerContext(text: string): string[] {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !PEER_CONTEXT_STOPWORDS.has(token));
}

function buildPeerKeywordSet(values: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const token of tokenizePeerContext(value)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }

  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([token]) => token);

  return new Set(sorted);
}

type SearchResultSnippet = {
  title?: string | null;
  body?: string | null;
  href?: string | null;
  query?: string | null;
};

function extractHandlesFromSearchRows(
  rows: SearchResultSnippet[],
  platform: SupportedPlatform,
  maxCount: number = 20
): string[] {
  const handles = new Set<string>();
  const urlRegex =
    platform === 'instagram'
      ? /instagram\.com\/([a-z0-9._]{2,30})/gi
      : /tiktok\.com\/@([a-z0-9._]{2,30})/gi;
  const mentionRegex = /@([a-z0-9._]{2,30})/gi;

  for (const row of rows || []) {
    const href = String(row.href || '');
    const text = `${row.title || ''} ${row.body || ''} ${row.query || ''}`.toLowerCase();
    const scanTargets = [href, text];

    for (const target of scanTargets) {
      for (const match of target.matchAll(urlRegex)) {
        const handle = normalizeHandle(match[1] || '', platform);
        const validation = validateCandidateHandle(handle, platform);
        if (!validation.allowed) continue;
        handles.add(handle);
        if (handles.size >= maxCount) return Array.from(handles);
      }
    }

    const platformSignal =
      text.includes(platform) ||
      href.toLowerCase().includes(platform) ||
      text.includes(`site:${platform}.com`);
    if (!platformSignal) continue;

    for (const match of text.matchAll(mentionRegex)) {
      const handle = normalizeHandle(match[1] || '', platform);
      const validation = validateCandidateHandle(handle, platform);
      if (!validation.allowed) continue;
      handles.add(handle);
      if (handles.size >= maxCount) return Array.from(handles);
    }
  }

  return Array.from(handles);
}

function buildSeedHandleHints(seedHandle: string): string[] {
  const handle = String(seedHandle || '').toLowerCase();
  if (!handle) return [];

  const hints: string[] = [];
  if (handle.includes('ummah')) hints.push('muslim entrepreneurs', 'muslim business community');
  if (handle.includes('halal')) hints.push('halal business', 'muslim audience');
  if (handle.includes('islam')) hints.push('islamic business', 'muslim audience');
  if (handle.includes('coach')) hints.push('coaching', 'consulting');
  if (handle.includes('agency')) hints.push('agency services');
  if (handle.includes('saas') || handle.includes('app') || handle.includes('crm')) {
    hints.push('software business', 'saas');
  }
  if (handle.includes('shop') || handle.includes('store')) {
    hints.push('ecommerce', 'product brand');
  }

  return Array.from(new Set(hints));
}

function inferDiscoveryNiche(
  rawNiche: string,
  context: {
    seedHandle: string;
    seedHandleHints: string[];
    clientBios: string[];
    businessSignals: string[];
    audienceSignals: string[];
  }
): string {
  const normalizedNiche = String(rawNiche || '').trim();
  const normalizedLower = normalizedNiche.toLowerCase();
  const genericNiches = new Set(['', 'business', 'general', 'creator', 'marketing', 'startup']);

  if (!genericNiches.has(normalizedLower)) {
    return normalizedNiche;
  }

  const inferredKeywords = Array.from(
    buildPeerKeywordSet([
      context.seedHandle,
      ...context.seedHandleHints,
      ...context.clientBios,
      ...context.businessSignals,
      ...context.audienceSignals,
    ])
  ).slice(0, 4);

  if (inferredKeywords.length >= 2) {
    return inferredKeywords.slice(0, 3).join(' ');
  }
  if (inferredKeywords.length === 1) {
    return inferredKeywords[0];
  }
  return normalizedNiche || 'business';
}

function buildContextualBlacklistTerms(
  niche: string,
  businessSignals: string[],
  audienceSignals: string[]
): string[] {
  const contextText = [niche, ...businessSignals, ...audienceSignals].join(' ').toLowerCase();
  const terms = new Set<string>(UNIVERSAL_BLACKLIST_TERMS);

  for (const rule of CONTEXTUAL_BLACKLIST_TERMS) {
    if (!rule.allowIf.test(contextText)) {
      for (const term of rule.terms) {
        terms.add(term);
      }
    }
  }

  return Array.from(terms);
}

function compareEvaluatedCandidates(a: CandidateEvaluation, b: CandidateEvaluation): number {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  if (b.peerOverlapScore !== a.peerOverlapScore) return b.peerOverlapScore - a.peerOverlapScore;
  if (b.ragAffinityScore !== a.ragAffinityScore) return b.ragAffinityScore - a.ragAffinityScore;
  if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount;
  return b.aiSemanticScore - a.aiSemanticScore;
}

function computePeerOverlap(
  candidate: CandidateAggregate,
  validation: ValidationResult | undefined,
  tiktokValidation: HandleValidationResult | undefined,
  aiScores: AiRankingScores | undefined,
  peerKeywords: Set<string>
): { score: number; matchedKeywords: string[] } {
  if (peerKeywords.size === 0) {
    return { score: 0.5, matchedKeywords: [] };
  }

  const candidateText = [
    candidate.handle,
    candidate.titles.join(' '),
    validation?.bio || '',
    validation?.reason || '',
    tiktokValidation?.reason || '',
    aiScores?.explanation || '',
  ]
    .join(' ')
    .toLowerCase();

  const matchedKeywords: string[] = [];
  for (const keyword of peerKeywords) {
    if (candidateText.includes(keyword)) {
      matchedKeywords.push(keyword);
    }
  }

  const coverageBase = Math.min(6, Math.max(1, peerKeywords.size));
  const coverage = matchedKeywords.length / coverageBase;
  const sourceBoost =
    candidate.sources.size >= 2
      ? 0.15
      : candidate.sources.has('direct')
        ? 0.1
        : candidate.sources.has('algorithmic')
          ? 0.07
          : 0;

  return {
    score: clamp01(coverage + sourceBoost),
    matchedKeywords: matchedKeywords.slice(0, 8),
  };
}

function computeKeywordAffinity(
  candidate: CandidateAggregate,
  validation: ValidationResult | undefined,
  tiktokValidation: HandleValidationResult | undefined,
  aiScores: AiRankingScores | undefined,
  businessKeywords: Set<string>,
  audienceKeywords: Set<string>
): {
  score: number;
  matchedBusinessKeywords: string[];
  matchedAudienceKeywords: string[];
} {
  const candidateText = [
    candidate.handle,
    candidate.titles.join(' '),
    validation?.bio || '',
    validation?.reason || '',
    tiktokValidation?.reason || '',
    aiScores?.explanation || '',
  ]
    .join(' ')
    .toLowerCase();

  const matchedBusinessKeywords: string[] = [];
  for (const keyword of businessKeywords) {
    if (candidateText.includes(keyword)) matchedBusinessKeywords.push(keyword);
  }

  const matchedAudienceKeywords: string[] = [];
  for (const keyword of audienceKeywords) {
    if (candidateText.includes(keyword)) matchedAudienceKeywords.push(keyword);
  }

  const businessCoverageBase = Math.max(1, Math.min(6, businessKeywords.size));
  const audienceCoverageBase = Math.max(1, Math.min(4, audienceKeywords.size || 1));
  const businessCoverage = matchedBusinessKeywords.length / businessCoverageBase;
  const audienceCoverage = matchedAudienceKeywords.length / audienceCoverageBase;
  const sourceBoost =
    candidate.sources.size >= 2
      ? 0.12
      : candidate.sources.has('direct')
        ? 0.08
        : candidate.sources.has('algorithmic')
          ? 0.05
          : 0;

  return {
    score: clamp01(businessCoverage * 0.7 + audienceCoverage * 0.3 + sourceBoost),
    matchedBusinessKeywords: matchedBusinessKeywords.slice(0, 8),
    matchedAudienceKeywords: matchedAudienceKeywords.slice(0, 6),
  };
}

function toInputJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function computeFollowerSimilarity(
  platform: SupportedPlatform,
  validation: ValidationResult | undefined,
  tiktokValidation: HandleValidationResult | undefined,
  clientFollowersByPlatform: Record<SupportedPlatform, number | null>
): number {
  const clientFollowers = clientFollowersByPlatform[platform];
  if (!clientFollowers || clientFollowers <= 0) {
    return 0.55;
  }

  let estimatedCandidateFollowers: number | null = null;
  if (platform === 'instagram' && validation?.followerEstimate) {
    const estimate = validation.followerEstimate;
    if (estimate === '1K-10K') estimatedCandidateFollowers = 6000;
    else if (estimate === '10K-50K') estimatedCandidateFollowers = 30000;
    else if (estimate === '50K-100K') estimatedCandidateFollowers = 75000;
    else if (estimate === '100K-500K') estimatedCandidateFollowers = 250000;
    else if (estimate === '500K-1M') estimatedCandidateFollowers = 750000;
    else if (estimate === '1M-5M') estimatedCandidateFollowers = 2500000;
    else if (estimate === '5M+') estimatedCandidateFollowers = 6000000;
  }

  if (platform === 'tiktok' && tiktokValidation?.confidence) {
    // We only have confidence from DDG validation for TikTok; use it as a weak proxy.
    estimatedCandidateFollowers = Math.round(clientFollowers * (0.6 + clamp01(tiktokValidation.confidence)));
  }

  if (!estimatedCandidateFollowers || estimatedCandidateFollowers <= 0) {
    return 0.5;
  }

  const ratio = estimatedCandidateFollowers / clientFollowers;
  if (ratio >= 0.4 && ratio <= 2.5) return 1;
  if (ratio >= 0.2 && ratio <= 5) return 0.75;
  if (ratio >= 0.1 && ratio <= 8) return 0.55;
  return 0.3;
}

function computeShortlistEligibility(
  platform: SupportedPlatform,
  totalScore: number,
  sourceCount: number,
  aiSemanticScore: number,
  peerOverlapScore: number,
  ragAffinityScore: number,
  validation: ValidationResult | undefined,
  tiktokValidation: HandleValidationResult | undefined
): { eligible: boolean; reason: string } {
  const strongOverlap = peerOverlapScore >= 0.18 || ragAffinityScore >= 0.2;
  const moderateOverlap = peerOverlapScore >= 0.12 || ragAffinityScore >= 0.14;
  const strongSemantic = aiSemanticScore >= 0.8;
  const veryStrongSemantic = aiSemanticScore >= 0.86;
  const crossSource = sourceCount >= 2;
  const instagramRelevant =
    platform === 'instagram' &&
    Boolean(validation?.isRelevant && (validation?.confidenceScore ?? 0) >= 0.45);
  const tiktokRelevant =
    platform === 'tiktok' &&
    Boolean((tiktokValidation?.is_valid ?? false) && (tiktokValidation?.confidence ?? 0) >= 0.56);
  const profileRelevant = instagramRelevant || tiktokRelevant;
  const validationUnavailable =
    (platform === 'instagram' && !validation) ||
    (platform === 'tiktok' && !tiktokValidation);

  if (strongOverlap && (strongSemantic || profileRelevant || crossSource)) {
    return { eligible: true, reason: 'Strong overlap and relevance evidence' };
  }

  if (profileRelevant && moderateOverlap && aiSemanticScore >= 0.7) {
    return { eligible: true, reason: 'Validated profile with niche overlap' };
  }

  if (crossSource && moderateOverlap && aiSemanticScore >= 0.74 && totalScore >= SHORTLIST_SCORE_THRESHOLD) {
    return { eligible: true, reason: 'Cross-source evidence supports direct peer match' };
  }

  if (veryStrongSemantic && moderateOverlap && totalScore >= SHORTLIST_SCORE_THRESHOLD - 2) {
    return { eligible: true, reason: 'Very strong semantic and overlap evidence' };
  }

  if (validationUnavailable && crossSource && aiSemanticScore >= 0.72 && moderateOverlap) {
    return { eligible: true, reason: 'Validation unavailable, accepted via multi-source overlap evidence' };
  }

  return {
    eligible: false,
    reason: 'Insufficient direct-peer evidence for shortlist',
  };
}

function computeHardReject(
  candidate: CandidateAggregate,
  clientHandles: Set<string>,
  validation: ValidationResult | undefined,
  tiktokValidation: HandleValidationResult | undefined,
  peerOverlapScore: number,
  ragAffinityScore: number,
  aiScores: AiRankingScores | undefined,
  blacklistTerms: string[]
): { rejected: boolean; reason: string } {
  const isValidationInfrastructureFailure = (...values: Array<string | undefined | null>) => {
    const combined = values.filter(Boolean).join(' ').toLowerCase();
    if (!combined) return false;
    return /(certificate verify failed|self-signed|broken pipe|connection error|validation incomplete|timed out|sendrequest)/i.test(
      combined
    );
  };

  const handleQuality = validateCandidateHandle(candidate.handle, candidate.platform);
  if (!handleQuality.allowed) {
    return { rejected: true, reason: `Low-quality handle (${handleQuality.reason})` };
  }

  if (clientHandles.has(candidate.handle)) {
    return { rejected: true, reason: 'Self account' };
  }

  for (const clientHandle of clientHandles) {
    if (!clientHandle || clientHandle.length < 4) continue;
    if (candidate.handle === clientHandle) continue;
    if (candidate.handle.includes(clientHandle) || clientHandle.includes(candidate.handle)) {
      return { rejected: true, reason: 'Brand-adjacent account (likely owned or affiliated)' };
    }
  }

  const sourceText = `${candidate.handle} ${candidate.reasons.join(' ')} ${candidate.titles.join(' ')}`.toLowerCase();
  if (blacklistTerms.some((term) => sourceText.includes(term))) {
    return { rejected: true, reason: 'Irrelevant category signals' };
  }

  const aiSemantic = clamp01(aiScores?.nicheSemanticMatch ?? candidate.initialScore);
  if (
    peerOverlapScore < 0.12 &&
    ragAffinityScore < 0.12 &&
    aiSemantic < 0.66 &&
    candidate.sources.size < 2
  ) {
    return { rejected: true, reason: 'Insufficient direct-peer evidence overlap' };
  }

  if (
    candidate.sources.size === 1 &&
    candidate.sources.has('ai') &&
    peerOverlapScore < 0.16 &&
    ragAffinityScore < 0.16 &&
    aiSemantic < 0.74
  ) {
    return { rejected: true, reason: 'AI-only candidate lacks corroborating evidence' };
  }

  if (candidate.platform === 'instagram') {
    const instagramValidationDegraded = isValidationInfrastructureFailure(
      validation?.reason,
      validation?.bio
    );
    if (!validation || !validation.isValid || !validation.exists) {
      const allowUnverifiedAiCandidate =
        candidate.sources.has('ai') &&
        aiSemantic >= 0.84 &&
        (peerOverlapScore >= 0.18 || ragAffinityScore >= 0.2);
      const allowDegradedValidationCandidate =
        instagramValidationDegraded &&
        candidate.sources.size >= 2 &&
        (peerOverlapScore >= 0.16 || ragAffinityScore >= 0.18 || aiSemantic >= 0.7);
      if (!allowUnverifiedAiCandidate && !allowDegradedValidationCandidate) {
        return { rejected: true, reason: 'Invalid or non-existent Instagram handle' };
      }
    }

    if (validation && !validation.isActive) {
      return { rejected: true, reason: 'No activity signals' };
    }

    if (
      validation &&
      !validation.isRelevant &&
      validation.confidenceScore < 0.45 &&
      peerOverlapScore < 0.18 &&
      ragAffinityScore < 0.18 &&
      aiSemantic < 0.72 &&
      !isValidationInfrastructureFailure(validation.reason, validation.bio)
    ) {
      return { rejected: true, reason: 'Low niche relevance confidence' };
    }
  } else {
    const tiktokValidationDegraded = isValidationInfrastructureFailure(
      tiktokValidation?.reason,
      tiktokValidation?.error
    );
    if (!tiktokValidation?.is_valid) {
      const allowUnverifiedAiCandidate =
        candidate.sources.has('ai') &&
        aiSemantic >= 0.86 &&
        (peerOverlapScore >= 0.2 || ragAffinityScore >= 0.22);
      const allowDegradedValidationCandidate =
        tiktokValidationDegraded &&
        candidate.sources.size >= 2 &&
        (peerOverlapScore >= 0.18 || ragAffinityScore >= 0.2 || aiSemantic >= 0.72);
      if (!allowUnverifiedAiCandidate && !allowDegradedValidationCandidate) {
        return { rejected: true, reason: 'Invalid or non-existent TikTok handle' };
      }
    }

    if (
      tiktokValidation &&
      tiktokValidation.confidence < 0.48 &&
      peerOverlapScore < 0.2 &&
      ragAffinityScore < 0.2 &&
      aiSemantic < 0.7 &&
      !tiktokValidationDegraded
    ) {
      return { rejected: true, reason: 'Insufficient activity/relevance confidence' };
    }
  }

  return { rejected: false, reason: '' };
}

function computeFallbackComponents(
  candidate: CandidateAggregate,
  validation: ValidationResult | undefined,
  tiktokValidation: HandleValidationResult | undefined,
  aiScores: AiRankingScores | undefined,
  clientFollowersByPlatform: Record<SupportedPlatform, number | null>,
  peerOverlapScore: number,
  ragAffinityScore: number
): RankingComponentScores {
  const validationConfidence =
    candidate.platform === 'instagram'
      ? clamp01(validation?.confidenceScore ?? 0.45)
      : clamp01(tiktokValidation?.confidence ?? 0.45);
  const sourceConfidence = clamp01((candidate.sources.size / 3) * 0.65 + validationConfidence * 0.35);

  const nicheSemanticMatch = clamp01(
    aiScores?.nicheSemanticMatch ??
      (candidate.platform === 'instagram'
        ? validation?.isRelevant
          ? 0.9
          : validationConfidence
        : validationConfidence)
  );
  const blendedNicheSemanticMatch = clamp01(
    nicheSemanticMatch * 0.55 + peerOverlapScore * 0.25 + ragAffinityScore * 0.2
  );

  const activityRecency = clamp01(
    candidate.platform === 'instagram'
      ? validation?.isActive
        ? 0.95
        : 0.2
      : tiktokValidation?.confidence
        ? clamp01(tiktokValidation.confidence)
        : 0.35
  );

  const sizeSimilarity = clamp01(
    computeFollowerSimilarity(candidate.platform, validation, tiktokValidation, clientFollowersByPlatform)
  );

  const offerOverlap = clamp01(
    (aiScores?.offerOverlap ?? (candidate.initialScore * 0.45 + blendedNicheSemanticMatch * 0.55)) *
      0.8 +
      ragAffinityScore * 0.2
  );
  const audienceOverlap = clamp01(
    (aiScores?.audienceOverlap ?? (validationConfidence * 0.5 + blendedNicheSemanticMatch * 0.5)) *
      0.8 +
      ragAffinityScore * 0.2
  );

  return {
    offerOverlap,
    audienceOverlap,
    nicheSemanticMatch: blendedNicheSemanticMatch,
    activityRecency,
    sizeSimilarity,
    sourceConfidence,
  };
}

function computeTotalScore(components: RankingComponentScores): number {
  return (
    components.offerOverlap * SCORE_WEIGHTS.offerOverlap +
    components.audienceOverlap * SCORE_WEIGHTS.audienceOverlap +
    components.nicheSemanticMatch * SCORE_WEIGHTS.nicheSemanticMatch +
    components.activityRecency * SCORE_WEIGHTS.activityRecency +
    components.sizeSimilarity * SCORE_WEIGHTS.sizeSimilarity +
    components.sourceConfidence * SCORE_WEIGHTS.sourceConfidence
  );
}

async function runAiRanking(
  brandName: string,
  niche: string,
  candidates: Array<{
    key: string;
    handle: string;
    platform: SupportedPlatform;
    evidence: string;
  }>
): Promise<Map<string, AiRankingScores>> {
  const scores = new Map<string, AiRankingScores>();
  if (!isOpenAiConfiguredForRealMode() || candidates.length === 0) {
    return scores;
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `
You are a competitor-quality ranker for direct peers only.
Brand: ${brandName}
Niche: ${niche}

Instructions:
1) Use only the provided evidence.
2) Return strict JSON object with key "scores" (array).
3) For each candidate return:
   - key
   - offerOverlap (0..1)
   - audienceOverlap (0..1)
   - nicheSemanticMatch (0..1)
   - explanation (one short sentence)
4) Penalize broad/generic/non-peer accounts.
5) Do not invent facts.

Candidates:
${JSON.stringify(candidates, null, 2)}
`;

    const completion = await openai.chat.completions.create({
      model: resolveModelForTask('competitor_discovery'),
      messages: [
        { role: 'system', content: 'Return JSON only.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 1000,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return scores;
    const parsed = JSON.parse(raw) as {
      scores?: Array<{
        key?: string;
        offerOverlap?: number;
        audienceOverlap?: number;
        nicheSemanticMatch?: number;
        explanation?: string;
      }>;
    };

    for (const item of parsed.scores || []) {
      if (!item?.key) continue;
      scores.set(item.key, {
        offerOverlap: clamp01(item.offerOverlap ?? 0),
        audienceOverlap: clamp01(item.audienceOverlap ?? 0),
        nicheSemanticMatch: clamp01(item.nicheSemanticMatch ?? 0),
        explanation: String(item.explanation || '').slice(0, 240),
      });
    }
  } catch (error: any) {
    console.warn(`[CompetitorOrchestrator] AI ranking skipped: ${error?.message || error}`);
  }

  return scores;
}

function clampTargetCount(value: number | undefined): number {
  if (!Number.isFinite(value as number)) return 10;
  return Math.max(5, Math.min(10, Math.floor(value as number)));
}

function sanitizePlatforms(input: SupportedPlatform[] | undefined): SupportedPlatform[] {
  const requested = (input || ['instagram', 'tiktok']).filter(
    (platform): platform is SupportedPlatform => platform === 'instagram' || platform === 'tiktok'
  );
  return requested.length > 0 ? Array.from(new Set(requested)) : ['instagram', 'tiktok'];
}

function sanitizeSources(input: CandidateSource[] | undefined): CandidateSource[] {
  const requested = (input || ['algorithmic', 'direct', 'ai']).filter(
    (source): source is CandidateSource =>
      source === 'algorithmic' || source === 'direct' || source === 'ai'
  );
  return requested.length > 0 ? Array.from(new Set(requested)) : ['algorithmic', 'direct', 'ai'];
}

function selectStatusForCandidate(
  selectionState: CompetitorSelectionState,
  existingStatus?: DiscoveredCompetitorStatus
): DiscoveredCompetitorStatus {
  if (
    existingStatus === 'SCRAPED' ||
    existingStatus === 'SCRAPING' ||
    existingStatus === 'CONFIRMED'
  ) {
    return existingStatus;
  }

  if (selectionState === 'FILTERED_OUT' || selectionState === 'REJECTED') {
    return 'REJECTED';
  }
  return existingStatus === 'FAILED' ? 'FAILED' : 'SUGGESTED';
}

function createOrchestrationError(
  code: OrchestrationErrorCode,
  message: string,
  statusCode: number
): OrchestrationServiceError {
  const error = new Error(message) as OrchestrationServiceError;
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export async function orchestrateCompetitorsForJob(
  researchJobId: string,
  input: CompetitorOrchestrationInput = {}
): Promise<{ runId: string; summary: CompetitorOrchestrationSummary }> {
  const mode: OrchestrationMode = input.mode === 'replace' ? 'replace' : 'append';
  const platforms = sanitizePlatforms(input.platforms);
  const sources = sanitizeSources(input.sources);
  const targetCount = clampTargetCount(input.targetCount);

  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: {
          clientAccounts: {
            select: {
              platform: true,
              handle: true,
              followerCount: true,
              bio: true,
            },
          },
        },
      },
      rawSearchResults: {
        select: {
          query: true,
          title: true,
          body: true,
          href: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 80,
      },
      discoveredCompetitors: {
        select: {
          handle: true,
          platform: true,
          selectionState: true,
          status: true,
          relevanceScore: true,
        },
        where: {
          OR: [
            {
              selectionState: {
                in: ['TOP_PICK', 'APPROVED'],
              },
            },
            {
              status: { in: ['SCRAPED', 'CONFIRMED'] },
              relevanceScore: { gte: 0.58 },
            },
          ],
        },
        orderBy: [{ relevanceScore: 'desc' }, { discoveredAt: 'desc' }],
        take: 30,
      },
    },
  });

  if (!job) {
    throw new Error('Research job not found');
  }

  const inputData = (job.inputData || {}) as Record<string, any>;
  const brandName = String(inputData.brandName || job.client?.name || '').trim();
  const fallbackHandle = String(inputData.handle || '').trim();
  const rawNiche = String(inputData.niche || '').trim();

  const instagramClientAccount = job.client?.clientAccounts?.find((account) => account.platform === 'instagram');
  const seedHandle = normalizeHandle(
    fallbackHandle ||
      String(inputData.handles?.instagram || instagramClientAccount?.handle || brandName)
  );
  const seedHandleHints = buildSeedHandleHints(seedHandle);
  const clientBios = (job.client?.clientAccounts || [])
    .map((account) => String(account.bio || '').trim())
    .filter(Boolean);

  const clientHandles = new Set<string>();
  for (const account of job.client?.clientAccounts || []) {
    if (account.handle) clientHandles.add(normalizeHandle(account.handle));
  }
  if (fallbackHandle) clientHandles.add(normalizeHandle(fallbackHandle));
  if (inputData.handles && typeof inputData.handles === 'object') {
    for (const raw of Object.values(inputData.handles)) {
      if (typeof raw === 'string' && raw.trim()) {
        clientHandles.add(normalizeHandle(raw));
      }
    }
  }

  const clientFollowersByPlatform: Record<SupportedPlatform, number | null> = {
    instagram:
      job.client?.clientAccounts?.find((account) => account.platform === 'instagram')?.followerCount ??
      null,
    tiktok:
      job.client?.clientAccounts?.find((account) => account.platform === 'tiktok')?.followerCount ?? null,
  };

  const businessSignalsRaw = [
    String(inputData.description || ''),
    String(inputData.businessOverview || ''),
    String(inputData.valueProposition || ''),
    ...(Array.isArray(inputData.contentPillars) ? inputData.contentPillars.map((item: any) => String(item)) : []),
    ...(Array.isArray(inputData.keyDifferentiators)
      ? inputData.keyDifferentiators.map((item: any) => String(item))
      : []),
    ...seedHandleHints,
  ];

  const audienceSignalsRaw = [
    String(inputData.targetAudience || ''),
    String(inputData.targetDemographic || ''),
    String(inputData.painPoints || ''),
  ];

  const businessSignals = Array.from(
    new Set(
      [...businessSignalsRaw, ...clientBios.slice(0, 4)]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );

  const audienceBioHints = clientBios
    .filter((bio) => /(for|helping|serving|community|support|built for)/i.test(bio))
    .slice(0, 3);
  const audienceSignals = Array.from(
    new Set(
      [...audienceSignalsRaw, ...audienceBioHints]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );

  const niche = inferDiscoveryNiche(rawNiche, {
    seedHandle,
    seedHandleHints,
    clientBios,
    businessSignals,
    audienceSignals,
  });

  const historicalHighConfidenceCompetitors = await prisma.discoveredCompetitor.findMany({
    where: {
      researchJob: {
        clientId: job.clientId,
      },
      platform: { in: platforms },
      OR: [
        {
          selectionState: { in: ['TOP_PICK', 'APPROVED'] },
        },
        {
          status: { in: ['SCRAPED', 'CONFIRMED'] },
          relevanceScore: { gte: 0.58 },
        },
      ],
    },
    select: {
      handle: true,
      platform: true,
    },
    orderBy: [{ discoveredAt: 'desc' }],
    take: 40,
  });

  const historicalSearchRows = await prisma.rawSearchResult.findMany({
    where: {
      researchJob: {
        clientId: job.clientId,
      },
    },
    select: {
      title: true,
      body: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 120,
  });

  const contextualBlacklistTerms = buildContextualBlacklistTerms(
    niche,
    businessSignals,
    audienceSignals
  );

  const recentSearchSnippets = historicalSearchRows
    .slice(0, 60)
    .map((row) => `${row.title || ''} ${row.body || ''}`.trim())
    .filter((value) => value.length > 0);

  const ragSearchRows: SearchResultSnippet[] = [
    ...((job.rawSearchResults || []).map((row) => ({
      title: row.title,
      body: row.body,
      href: row.href,
      query: row.query,
    })) as SearchResultSnippet[]),
    ...historicalSearchRows.map((row) => ({
      title: row.title,
      body: row.body,
      href: null,
      query: null,
    })),
  ];

  const previousTopCompetitorSet = new Set<string>();
  for (const row of job.discoveredCompetitors || []) {
    const key = normalizeCompetitorKey(String(row.platform || ''), String(row.handle || ''));
    if (!key) continue;
    previousTopCompetitorSet.add(key);
    if (previousTopCompetitorSet.size >= 40) break;
  }
  if (previousTopCompetitorSet.size < 40) {
    for (const row of historicalHighConfidenceCompetitors) {
      const key = normalizeCompetitorKey(String(row.platform || ''), String(row.handle || ''));
      if (!key) continue;
      previousTopCompetitorSet.add(key);
      if (previousTopCompetitorSet.size >= 40) break;
    }
  }
  const previousTopCompetitors = Array.from(previousTopCompetitorSet);

  const businessKeywordSet = new Set(
    buildPeerKeywordSet([niche, ...businessSignals, ...recentSearchSnippets])
  );
  const audienceKeywordSet = new Set(
    buildPeerKeywordSet([niche, ...audienceSignals, ...recentSearchSnippets])
  );
  const peerKeywordSet = buildPeerKeywordSet([
    brandName,
    niche,
    String(inputData.description || ''),
    String(inputData.businessOverview || ''),
    String(inputData.valueProposition || ''),
    ...clientBios,
    ...((job.client?.clientAccounts || []).map((account) => account.handle || '') as string[]),
    ...recentSearchSnippets,
    ...previousTopCompetitors,
  ]);

  const orchestrationInit = await (async () => {
    try {
      return await prisma.$transaction(
        async (tx) => {
          let staleRunReplaced:
            | {
                id: string;
                startedAt: Date;
              }
            | null = null;
          const runningRun = await tx.competitorOrchestrationRun.findFirst({
            where: { researchJobId, status: 'RUNNING' },
            orderBy: { startedAt: 'desc' },
          });

          if (runningRun) {
            const ageMs = Date.now() - runningRun.startedAt.getTime();
            if (ageMs < ORCHESTRATION_RUNNING_STALE_MS) {
              throw createOrchestrationError(
                'ORCHESTRATION_ALREADY_RUNNING',
                'A competitor orchestration run is already in progress for this job',
                409
              );
            }

            staleRunReplaced = {
              id: runningRun.id,
              startedAt: runningRun.startedAt,
            };
            await tx.competitorOrchestrationRun.update({
              where: { id: runningRun.id },
              data: {
                status: 'FAILED',
                completedAt: new Date(),
                summary: toInputJson({
                  reason: 'Marked stale and replaced by a new run',
                }),
              },
            });
          }

          const run = await tx.competitorOrchestrationRun.create({
            data: {
              researchJobId,
              mode,
              platforms: toInputJson(platforms),
              targetCount,
              status: 'RUNNING',
              summary: toInputJson({
                candidatesDiscovered: 0,
                candidatesFiltered: 0,
                shortlisted: 0,
                topPicks: 0,
              }),
            },
          });

          return { run, staleRunReplaced };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    } catch (error: any) {
      if (error?.code === 'ORCHESTRATION_ALREADY_RUNNING') {
        emitResearchJobEvent({
          researchJobId,
          source: 'competitor-orchestrator',
          code: 'competitor.orchestration.failed',
          level: 'warn',
          message: error.message,
          metrics: {
            reason: 'ORCHESTRATION_ALREADY_RUNNING',
          },
        });
      }
      throw error;
    }
  })();

  const orchestrationRun = orchestrationInit.run;
  const staleRunReplaced = orchestrationInit.staleRunReplaced;

  if (staleRunReplaced) {
    emitResearchJobEvent({
      researchJobId,
      runId: staleRunReplaced.id,
      source: 'competitor-orchestrator',
      code: 'competitor.orchestration.failed',
      level: 'warn',
      message: 'Stale orchestration run was replaced by a new run',
      metrics: {
        staleRunStartedAt: staleRunReplaced.startedAt.toISOString(),
      },
    });
  }

  emitResearchJobEvent({
    researchJobId,
    runId: orchestrationRun.id,
    source: 'competitor-orchestrator',
    code: 'competitor.orchestration.started',
    level: 'info',
    message: 'Competitor orchestration started',
    metrics: {
      mode,
      platforms,
      targetCount,
      sources,
    },
  });

  const discoveryPlan = await buildCompetitorDiscoveryPlan(
    {
      brandName: brandName || seedHandle,
      seedHandle,
      niche,
      description: String(inputData.description || inputData.businessOverview || ''),
      businessSignals,
      audienceSignals,
      clientBios,
      previousTopCompetitors,
      recentSearchSnippets,
    },
    {
      platforms,
      targetCount,
    }
  );

  emitResearchJobEvent({
    researchJobId,
    runId: orchestrationRun.id,
    source: 'competitor-orchestrator',
    code: 'competitor.orchestration.plan.generated',
    level: 'info',
    message: `Discovery plan generated (${discoveryPlan.planner})`,
    metrics: {
      planner: discoveryPlan.planner,
      algorithmicNiches: discoveryPlan.algorithmicNiches.length,
      instagramQueries: discoveryPlan.instagramQueries.length,
      tiktokQueries: discoveryPlan.tiktokQueries.length,
      seedCompetitors: discoveryPlan.seedCompetitors.length,
      previousTopCompetitors: previousTopCompetitors.length,
      ragSearchSnippets: recentSearchSnippets.length,
      businessKeywordCount: businessKeywordSet.size,
      audienceKeywordCount: audienceKeywordSet.size,
    },
    metadata: {
      rationale: discoveryPlan.rationale,
    },
  });

  try {
    const aggregateMap = new Map<string, CandidateAggregate>();
    const skippedCandidatesByReason: Record<string, number> = {};
    const trackSkippedCandidate = (reason: string) => {
      skippedCandidatesByReason[reason] = (skippedCandidatesByReason[reason] || 0) + 1;
    };

  const pushCandidate = (
    rawHandle: string,
    platformInput: SupportedPlatform | null,
    source: CandidateSource,
    reason: string,
    title?: string,
    explicitScore?: number
  ) => {
    const platform = platformInput ?? inferPlatform(rawHandle);
    if (!platforms.includes(platform)) return;
    const handle = normalizeHandle(rawHandle, platform);
    if (!handle || handle.length < 2) return;
    const handleValidation = validateCandidateHandle(handle, platform);
    if (!handleValidation.allowed) {
      trackSkippedCandidate(handleValidation.reason || 'invalid_handle');
      return;
    }

    const key = `${platform}:${handle}`;
    const existing = aggregateMap.get(key);
    if (existing) {
      existing.sources.add(source);
      existing.reasons.push(reason);
      if (title) existing.titles.push(title);
      existing.initialScore = Math.max(existing.initialScore, explicitScore ?? SOURCE_BASE_SCORES[source]);
      return;
    }

    aggregateMap.set(key, {
      key,
      handle,
      platform,
      initialScore: clamp01(explicitScore ?? SOURCE_BASE_SCORES[source]),
      sources: new Set([source]),
      reasons: [reason],
      titles: title ? [title] : [],
    });
  };

  if (sources.includes('direct')) {
    if (platforms.includes('instagram')) {
      const extracted = extractHandlesFromSearchRows(ragSearchRows, 'instagram', 24);
      for (const handle of extracted) {
        pushCandidate(
          handle,
          'instagram',
          'direct',
          'RAG handle extraction from search evidence',
          undefined,
          0.62
        );
      }
    }

    if (platforms.includes('tiktok')) {
      const extracted = extractHandlesFromSearchRows(ragSearchRows, 'tiktok', 20);
      for (const handle of extracted) {
        pushCandidate(
          handle,
          'tiktok',
          'direct',
          'RAG handle extraction from search evidence',
          undefined,
          0.6
        );
      }
    }
  }

  if (discoveryPlan.seedCompetitors.length > 0) {
    for (const seed of discoveryPlan.seedCompetitors) {
      pushCandidate(
        seed.handle,
        seed.platform,
        'ai',
        `AI-planned seed (${seed.reason})`,
        undefined,
        seed.confidence
      );
    }
  }

  if (previousTopCompetitors.length > 0) {
    for (const value of previousTopCompetitors) {
      const [platformRaw, rawHandle] = String(value).split(':');
      const normalizedPlatform =
        platformRaw === 'tiktok'
          ? 'tiktok'
          : platformRaw === 'instagram'
            ? 'instagram'
            : null;
      if (!normalizedPlatform) continue;
      pushCandidate(
        rawHandle || '',
        normalizedPlatform,
        'direct',
        'Historical high-confidence competitor for this client',
        undefined,
        0.9
      );
    }
  }

  if (sources.includes('algorithmic') && platforms.includes('instagram') && (seedHandle || brandName)) {
    emitResearchJobEvent({
      researchJobId,
      runId: orchestrationRun.id,
      source: 'competitor-orchestrator',
      code: 'competitor.orchestration.source.started',
      level: 'info',
      message: 'Algorithmic source started',
      metrics: { source: 'algorithmic' },
    });
    try {
      const algorithmicSeed = seedHandle || normalizeHandle(brandName) || brandName;
      const algorithmicIntent = inferCompetitorDiscoveryIntent({
        businessType: String((inputData as Record<string, unknown>).businessType || ''),
        offerModel: String((inputData as Record<string, unknown>).offerModel || ''),
        targetMarket: String((inputData as Record<string, unknown>).targetAudience || ''),
        niche,
        description: String(
          (inputData as Record<string, unknown>).description ||
            (inputData as Record<string, unknown>).businessOverview ||
            ''
        ),
      });
      const algorithmicNiches = Array.from(
        new Set(
          [
            niche,
            ...discoveryPlan.algorithmicNiches,
          ].map((item) => String(item || '').trim()).filter(Boolean)
        )
      ).slice(0, 6);

      let discovered = 0;
      let failedQueries = 0;
      for (const nicheHint of algorithmicNiches) {
        try {
          const handles = await searchCompetitorsDDG(
            algorithmicSeed,
            nicheHint,
            24,
            researchJobId,
            algorithmicIntent
          );
          for (const handle of handles) {
            pushCandidate(
              handle,
              'instagram',
              'algorithmic',
              `Algorithmic search candidate (${nicheHint})`
            );
          }
          discovered += handles.length;
        } catch (queryError: any) {
          failedQueries += 1;
          console.warn(
            `[CompetitorOrchestrator] Algorithmic query failed for niche "${nicheHint}": ${queryError?.message || queryError}`
          );
        }
      }

      emitResearchJobEvent({
        researchJobId,
        runId: orchestrationRun.id,
        source: 'competitor-orchestrator',
        code: 'competitor.orchestration.source.completed',
        level: failedQueries > 0 ? 'warn' : 'info',
        message:
          failedQueries > 0
            ? `Algorithmic source finished with partial failures (${discovered} raw candidates)`
            : `Algorithmic source finished (${discovered} raw candidates)`,
        metrics: {
          source: 'algorithmic',
          discovered,
          failedQueries,
          queryCount: algorithmicNiches.length,
        },
      });
    } catch (error: any) {
      emitResearchJobEvent({
        researchJobId,
        runId: orchestrationRun.id,
        source: 'competitor-orchestrator',
        code: 'competitor.orchestration.source.completed',
        level: 'warn',
        message: `Algorithmic source failed: ${error?.message || error}`,
        metrics: { source: 'algorithmic', discovered: 0 },
      });
    }
  }

  if (sources.includes('direct') && (brandName || seedHandle)) {
    emitResearchJobEvent({
      researchJobId,
      runId: orchestrationRun.id,
      source: 'competitor-orchestrator',
      code: 'competitor.orchestration.source.started',
      level: 'info',
      message: 'Direct source started',
      metrics: { source: 'direct' },
    });
    try {
      const querySeed = brandName || seedHandle;
      const platformQueries: Record<SupportedPlatform, string[]> = {
        instagram: discoveryPlan.instagramQueries.length
          ? discoveryPlan.instagramQueries.slice(0, 8)
          : [`${querySeed} direct competitors instagram`, `${querySeed} alternatives instagram`],
        tiktok: discoveryPlan.tiktokQueries.length
          ? discoveryPlan.tiktokQueries.slice(0, 8)
          : [`${querySeed} direct competitors tiktok`, `${querySeed} alternatives tiktok`],
      };
      const directTasks: Array<
        Promise<{
          label: string;
          platform: SupportedPlatform;
          reason: string;
          handles: string[];
        }>
      > = [];

      if (platforms.includes('instagram')) {
        for (const [index, query] of platformQueries.instagram.entries()) {
          directTasks.push(
            performDirectCompetitorSearchForPlatform(query, 'instagram', 14).then((handles) => ({
              label: `direct-instagram-${index + 1}`,
              platform: 'instagram' as const,
              reason: `Direct query candidate (Instagram): ${query}`.slice(0, 220),
              handles,
            }))
          );
        }

        if (platformQueries.instagram.length < 2) {
          directTasks.push(
            performDirectCompetitorSearch(`${querySeed} competitors instagram`).then((handles) => ({
              label: 'direct-instagram-fallback',
              platform: 'instagram' as const,
              reason: 'Direct query fallback candidate',
              handles,
            }))
          );
        }
      }

      if (platforms.includes('tiktok')) {
        for (const [index, query] of platformQueries.tiktok.entries()) {
          directTasks.push(
            performDirectCompetitorSearchForPlatform(query, 'tiktok', 14).then((handles) => ({
              label: `direct-tiktok-${index + 1}`,
              platform: 'tiktok' as const,
              reason: `Direct query candidate (TikTok): ${query}`.slice(0, 220),
              handles,
            }))
          );
        }
      }

      const directResults = await Promise.allSettled(directTasks);
      let discovered = 0;
      let failedTasks = 0;
      let supplementalDiscovered = 0;
      for (const taskResult of directResults) {
        if (taskResult.status === 'fulfilled') {
          const { handles, platform, reason } = taskResult.value;
          for (const handle of handles) {
            pushCandidate(handle, platform, 'direct', reason);
          }
          discovered += handles.length;
          continue;
        }
        failedTasks += 1;
      }

      if (discovered < 8) {
        const supplementalQueries: Array<{ platform: SupportedPlatform; query: string }> = [];
        if (platforms.includes('instagram')) {
          supplementalQueries.push(
            { platform: 'instagram', query: `${querySeed} competitors instagram` },
            { platform: 'instagram', query: `${niche} instagram competitors` },
            { platform: 'instagram', query: `${querySeed} alternatives instagram` }
          );
        }
        if (platforms.includes('tiktok')) {
          supplementalQueries.push(
            { platform: 'tiktok', query: `${querySeed} competitors tiktok` },
            { platform: 'tiktok', query: `${niche} tiktok competitors` },
            { platform: 'tiktok', query: `${querySeed} alternatives tiktok` }
          );
        }

        for (const entry of supplementalQueries) {
          try {
            const handles = await performDirectCompetitorSearchForPlatform(
              entry.query,
              entry.platform,
              12
            );
            for (const handle of handles) {
              pushCandidate(
                handle,
                entry.platform,
                'direct',
                `Direct supplemental query (${entry.platform}): ${entry.query}`.slice(0, 220)
              );
            }
            supplementalDiscovered += handles.length;
          } catch (supplementalError: any) {
            failedTasks += 1;
            console.warn(
              `[CompetitorOrchestrator] Supplemental direct query failed (${entry.platform}): ${supplementalError?.message || supplementalError}`
            );
          }
        }
      }

      emitResearchJobEvent({
        researchJobId,
        runId: orchestrationRun.id,
        source: 'competitor-orchestrator',
        code: 'competitor.orchestration.source.completed',
        level: failedTasks > 0 ? 'warn' : 'info',
        message:
          failedTasks > 0
            ? `Direct source finished with partial failures (${discovered} raw candidates)`
            : `Direct source finished (${discovered} raw candidates)`,
        metrics: {
          source: 'direct',
          discovered: discovered + supplementalDiscovered,
          supplementalDiscovered,
          failedTasks,
          instagramQueries: platformQueries.instagram.length,
          tiktokQueries: platformQueries.tiktok.length,
        },
      });
    } catch (error: any) {
      emitResearchJobEvent({
        researchJobId,
        runId: orchestrationRun.id,
        source: 'competitor-orchestrator',
        code: 'competitor.orchestration.source.completed',
        level: 'warn',
        message: `Direct source failed: ${error?.message || error}`,
        metrics: { source: 'direct', discovered: 0 },
      });
    }
  }

  if (sources.includes('ai') && (brandName || seedHandle)) {
    emitResearchJobEvent({
      researchJobId,
      runId: orchestrationRun.id,
      source: 'competitor-orchestrator',
      code: 'competitor.orchestration.source.started',
      level: 'info',
      message: 'AI source started',
      metrics: { source: 'ai' },
    });
    try {
      const aiCandidates = await suggestCompetitorsMultiPlatform(
        brandName || seedHandle,
        niche,
        inputData.description || inputData.businessOverview || undefined,
        {
          searchInstructions: [
            ...discoveryPlan.instagramQueries.slice(0, 8),
            ...discoveryPlan.tiktokQueries.slice(0, 8),
          ],
          nicheKeywords: discoveryPlan.algorithmicNiches,
          excludeHandles: Array.from(clientHandles),
          priorCompetitors: previousTopCompetitors,
          audienceSummary: audienceSignals.join(' | '),
          maxPerPlatform: targetCount,
        }
      );
      for (const candidate of aiCandidates) {
        const normalizedPlatform = candidate.platform === 'tiktok' ? 'tiktok' : 'instagram';
        pushCandidate(
          candidate.handle,
          normalizedPlatform,
          'ai',
          candidate.reasoning || 'AI candidate',
          candidate.name,
          candidate.relevanceScore
        );
      }

      emitResearchJobEvent({
        researchJobId,
        runId: orchestrationRun.id,
        source: 'competitor-orchestrator',
        code: 'competitor.orchestration.source.completed',
        level: 'info',
        message: `AI source finished (${aiCandidates.length} raw candidates)`,
        metrics: { source: 'ai', discovered: aiCandidates.length },
      });
    } catch (error: any) {
      emitResearchJobEvent({
        researchJobId,
        runId: orchestrationRun.id,
        source: 'competitor-orchestrator',
        code: 'competitor.orchestration.source.completed',
        level: 'warn',
        message: `AI source failed: ${error?.message || error}`,
        metrics: { source: 'ai', discovered: 0 },
      });
    }
  }

  const allAggregates = Array.from(aggregateMap.values());
  const candidatesDiscovered = allAggregates.length;

  const maxPrevalidationPerPlatform = Math.max(
    12,
    Math.min(60, Number(process.env.COMPETITOR_PREVALIDATION_CAP_PER_PLATFORM || 20))
  );

  const aggregates = (['instagram', 'tiktok'] as SupportedPlatform[])
    .flatMap((platform) =>
      allAggregates
        .filter((candidate) => candidate.platform === platform)
        .sort((a, b) => {
          const sourceDiff = b.sources.size - a.sources.size;
          if (sourceDiff !== 0) return sourceDiff;
          return b.initialScore - a.initialScore;
        })
        .slice(0, maxPrevalidationPerPlatform)
    );
  const droppedBeforeValidation = Math.max(0, allAggregates.length - aggregates.length);

  const instagramCandidates = aggregates.filter((item) => item.platform === 'instagram');
  const tiktokCandidates = aggregates.filter((item) => item.platform === 'tiktok');

  const instagramValidation = new Map<string, ValidationResult>();
  if (instagramCandidates.length > 0) {
    try {
      const validated = await validateCompetitorBatch(
        instagramCandidates.map((item) => ({ handle: item.handle })),
        niche,
        seedHandle
      );
      for (const [handle, result] of validated.entries()) {
        instagramValidation.set(`instagram:${normalizeHandle(handle)}`, result);
      }
    } catch (error: any) {
      console.warn(`[CompetitorOrchestrator] Instagram validation failed: ${error?.message || error}`);
    }
  }

  const tiktokValidation = new Map<string, HandleValidationResult>();
  if (tiktokCandidates.length > 0) {
    const validations = await Promise.all(
      tiktokCandidates.map(async (candidate) => {
        try {
          const result = await validateHandleDDG(candidate.handle, 'tiktok');
          return { key: candidate.key, result };
        } catch (error: any) {
          return {
            key: candidate.key,
            result: {
              handle: candidate.handle,
              platform: 'tiktok',
              is_valid: false,
              confidence: 0,
              reason: error?.message || 'Validation failed',
              found_urls: [],
              raw_results: [],
              error: error?.message || 'Validation failed',
            } satisfies HandleValidationResult,
          };
        }
      })
    );

    for (const item of validations) {
      tiktokValidation.set(item.key, item.result);
    }
  }

  const aiRankingInput = aggregates.map((candidate) => {
    const validation =
      candidate.platform === 'instagram'
        ? instagramValidation.get(candidate.key)
        : undefined;
    const tiktok =
      candidate.platform === 'tiktok'
        ? tiktokValidation.get(candidate.key)
        : undefined;
    const evidenceParts = [
      `sources=${Array.from(candidate.sources).join(',')}`,
      candidate.titles.length > 0 ? `titleHints=${candidate.titles.slice(0, 2).join(' | ')}` : '',
      validation
        ? `instagramValidation(valid=${validation.isValid},exists=${validation.exists},active=${validation.isActive},relevant=${validation.isRelevant},confidence=${validation.confidenceScore.toFixed(2)})`
        : '',
      tiktok
        ? `tiktokValidation(valid=${tiktok.is_valid},confidence=${Number(tiktok.confidence || 0).toFixed(2)})`
        : '',
    ].filter(Boolean);

    return {
      key: candidate.key,
      handle: candidate.handle,
      platform: candidate.platform,
      evidence: evidenceParts.join('; '),
    };
  });

  const aiScores = await runAiRanking(brandName || seedHandle, niche, aiRankingInput);

  const evaluatedCandidates: CandidateEvaluation[] = [];

  for (const candidate of aggregates) {
    const validation =
      candidate.platform === 'instagram'
        ? instagramValidation.get(candidate.key)
        : undefined;
    const tiktok =
      candidate.platform === 'tiktok'
        ? tiktokValidation.get(candidate.key)
        : undefined;
    const aiScore = aiScores.get(candidate.key);
    const peerOverlap = computePeerOverlap(
      candidate,
      validation,
      tiktok,
      aiScore,
      peerKeywordSet
    );
    const ragAffinity = computeKeywordAffinity(
      candidate,
      validation,
      tiktok,
      aiScore,
      businessKeywordSet,
      audienceKeywordSet
    );

    const hardReject = computeHardReject(
      candidate,
      clientHandles,
      validation,
      tiktok,
      peerOverlap.score,
      ragAffinity.score,
      aiScore,
      contextualBlacklistTerms
    );
    const components = computeFallbackComponents(
      candidate,
      validation,
      tiktok,
      aiScore,
      clientFollowersByPlatform,
      peerOverlap.score,
      ragAffinity.score
    );
    const totalScore = Number.parseFloat(computeTotalScore(components).toFixed(2));

    const reasons = candidate.reasons.slice(0, 3).join(' | ');
    const aiExplanation = aiScore?.explanation ? ` AI: ${aiScore.explanation}` : '';
    const sourceSummary = Array.from(candidate.sources).join(', ');
    const aiSemanticScore = clamp01(aiScore?.nicheSemanticMatch ?? candidate.initialScore);
    const shortlistGate = computeShortlistEligibility(
      candidate.platform,
      totalScore,
      candidate.sources.size,
      aiSemanticScore,
      peerOverlap.score,
      ragAffinity.score,
      validation,
      tiktok
    );

    let selectionState: CompetitorSelectionState;
    let selectionReason: string;

    if (hardReject.rejected) {
      selectionState = 'FILTERED_OUT';
      selectionReason = hardReject.reason;
    } else if (!shortlistGate.eligible && totalScore >= PROMOTION_SCORE_THRESHOLD) {
      selectionState = 'FILTERED_OUT';
      selectionReason = shortlistGate.reason;
    } else if (totalScore >= TOP_PICK_SCORE_THRESHOLD) {
      selectionState = 'TOP_PICK';
      selectionReason = `High-confidence direct peer (${totalScore.toFixed(1)})`;
    } else if (totalScore >= SHORTLIST_SCORE_THRESHOLD) {
      selectionState = 'SHORTLISTED';
      selectionReason = `Promising match (${totalScore.toFixed(1)})`;
    } else {
      selectionState = 'FILTERED_OUT';
      selectionReason = `Score below threshold (${totalScore.toFixed(1)})`;
    }

    const payload: PersistableCandidate = {
      handle: candidate.handle,
      platform: candidate.platform,
      relevanceScore: clamp01(totalScore / 100),
      totalScore,
      selectionState,
      selectionReason,
      discoveryReason: `sources=${sourceSummary}; ${reasons}${aiExplanation}`.slice(0, 500),
      evidence: toInputJson({
        platform: candidate.platform,
        sources: Array.from(candidate.sources),
        reasons: candidate.reasons.slice(0, 5),
        peerKeywordMatches: peerOverlap.matchedKeywords,
        peerOverlapScore: peerOverlap.score,
        matchedBusinessKeywords: ragAffinity.matchedBusinessKeywords,
        matchedAudienceKeywords: ragAffinity.matchedAudienceKeywords,
        ragAffinityScore: ragAffinity.score,
        validation:
          candidate.platform === 'instagram'
            ? validation || null
            : tiktok || null,
      }),
      scoreBreakdown: toInputJson({
        ...components,
        peerOverlapScore: peerOverlap.score,
        peerKeywordMatches: peerOverlap.matchedKeywords,
        ragAffinityScore: ragAffinity.score,
        matchedBusinessKeywords: ragAffinity.matchedBusinessKeywords,
        matchedAudienceKeywords: ragAffinity.matchedAudienceKeywords,
        totalScore,
        sourceCount: candidate.sources.size,
        aiSemanticScore,
        aiExplanation: aiScore?.explanation || null,
        shortlistEligible: shortlistGate.eligible,
        shortlistGateReason: shortlistGate.reason,
      }),
    };

    evaluatedCandidates.push({
      ...payload,
      peerOverlapScore: peerOverlap.score,
      ragAffinityScore: ragAffinity.score,
      sourceCount: candidate.sources.size,
      aiSemanticScore,
      hardRejected: hardReject.rejected,
      shortlistEligible: shortlistGate.eligible,
      shortlistGateReason: shortlistGate.reason,
    });
  }

  const hardRejectedCandidates = evaluatedCandidates.filter((item) => item.hardRejected);
  const lowEvidenceCandidates = evaluatedCandidates
    .filter((item) => !item.hardRejected && !item.shortlistEligible)
    .map((item) => ({
      ...item,
      selectionState: 'FILTERED_OUT' as CompetitorSelectionState,
      selectionReason: item.shortlistGateReason || 'Insufficient direct-peer evidence for shortlist',
    }));
  const reviewPool = evaluatedCandidates
    .filter((item) => !item.hardRejected && item.shortlistEligible)
    .sort(compareEvaluatedCandidates);

  const maxTotalSelected = Math.max(1, Math.min(10, targetCount));
  const minReviewCount = Math.min(maxTotalSelected, Math.max(1, MIN_REVIEW_TARGET));
  const topPickLimit = Math.min(6, maxTotalSelected);

  const topPickCandidates = reviewPool.filter(
      (item) =>
        item.totalScore >= TOP_PICK_SCORE_THRESHOLD &&
        (item.peerOverlapScore >= 0.14 ||
          item.ragAffinityScore >= 0.18 ||
          item.aiSemanticScore >= 0.72 ||
        item.sourceCount >= 2)
  );
  const selectedTopPicks = topPickCandidates.slice(0, topPickLimit);
  const selectedTopPickKeys = new Set(
    selectedTopPicks.map((item) => `${item.platform}:${item.handle}`)
  );

  const remainingPool = reviewPool.filter(
    (item) => !selectedTopPickKeys.has(`${item.platform}:${item.handle}`)
  );
  const shortlistCapacity = Math.max(0, maxTotalSelected - selectedTopPicks.length);
  const selectedShortlist = remainingPool
    .filter(
      (item) =>
        (item.totalScore >= SHORTLIST_SCORE_THRESHOLD &&
          (item.peerOverlapScore >= 0.14 ||
            item.ragAffinityScore >= 0.16 ||
            item.aiSemanticScore >= 0.72 ||
            item.sourceCount >= 2)) ||
        (item.totalScore >= SHORTLIST_SCORE_THRESHOLD - 4 &&
          (item.peerOverlapScore >= 0.18 ||
            item.ragAffinityScore >= 0.2 ||
            item.aiSemanticScore >= 0.76 ||
            item.sourceCount >= 2))
    )
    .slice(0, shortlistCapacity);

  const selectedKeys = new Set<string>(
    [...selectedTopPicks, ...selectedShortlist].map((item) => `${item.platform}:${item.handle}`)
  );

  const promotedCandidates: CandidateEvaluation[] = [];
  if (selectedKeys.size < minReviewCount) {
    const needed = Math.max(0, minReviewCount - selectedKeys.size);
    const promotionCandidates = remainingPool
      .filter(
      (item) =>
        !selectedKeys.has(`${item.platform}:${item.handle}`) &&
        item.totalScore >= PROMOTION_SCORE_THRESHOLD &&
        (item.peerOverlapScore >= 0.14 ||
          item.ragAffinityScore >= 0.16 ||
            item.aiSemanticScore >= 0.72 ||
            item.sourceCount >= 2)
      )
      .sort(compareEvaluatedCandidates)
      .slice(0, needed);

    for (const promoted of promotionCandidates) {
      promotedCandidates.push(promoted);
      selectedShortlist.push(promoted);
      selectedKeys.add(`${promoted.platform}:${promoted.handle}`);
    }
  }

  const promotedKeys = new Set(
    promotedCandidates.map((item) => `${item.platform}:${item.handle}`)
  );

  const exploratoryFallbackCandidates: CandidateEvaluation[] = [];
  if (selectedKeys.size === 0) {
    const fallbackPool = evaluatedCandidates
      .filter(
        (item) =>
          !item.hardRejected &&
          item.totalScore >= PROMOTION_SCORE_THRESHOLD - 10 &&
          (item.aiSemanticScore >= 0.55 ||
            item.sourceCount >= 2 ||
            item.peerOverlapScore >= 0.1 ||
            item.ragAffinityScore >= 0.12)
      )
      .sort(compareEvaluatedCandidates)
      .slice(0, Math.min(3, maxTotalSelected));

    for (const fallback of fallbackPool) {
      const key = `${fallback.platform}:${fallback.handle}`;
      if (selectedKeys.has(key)) continue;
      exploratoryFallbackCandidates.push(fallback);
      selectedShortlist.push(fallback);
      selectedKeys.add(key);
    }
  }

  const exploratoryFallbackKeys = new Set(
    exploratoryFallbackCandidates.map((item) => `${item.platform}:${item.handle}`)
  );

  const filteredCandidates = [
    ...hardRejectedCandidates,
    ...lowEvidenceCandidates,
    ...reviewPool
      .filter((item) => !selectedKeys.has(`${item.platform}:${item.handle}`))
      .map((item) => {
        const shortlistedButOutranked = item.totalScore >= SHORTLIST_SCORE_THRESHOLD;
        return {
          ...item,
          selectionState: 'FILTERED_OUT' as CompetitorSelectionState,
          selectionReason: shortlistedButOutranked
            ? `Good candidate but outside top ${maxTotalSelected} for this run`
            : item.selectionReason,
        };
      }),
  ];

  const retainedFiltered = filteredCandidates
    .sort(compareEvaluatedCandidates)
    .filter(
      (item) =>
        item.totalScore >= FILTERED_RETENTION_MIN_SCORE ||
        item.selectionReason.includes('Self account') ||
        item.selectionReason.includes('Insufficient direct-peer evidence overlap')
    )
    .slice(0, FILTERED_RETENTION_MAX);
  const droppedLowSignalFilteredCount = Math.max(
    0,
    filteredCandidates.length - retainedFiltered.length
  );

  const persistedCandidates: PersistableCandidate[] = [];
  const persistedCandidateByKey = new Map<string, CandidateEvaluation>();
  for (const candidate of [...selectedTopPicks, ...selectedShortlist, ...retainedFiltered]) {
    persistedCandidateByKey.set(`${candidate.platform}:${candidate.handle}`, candidate);
  }

  for (const candidate of persistedCandidateByKey.values()) {
    const key = `${candidate.platform}:${candidate.handle}`;
    let nextState = candidate.selectionState;

    if (selectedKeys.has(key)) {
      if (selectedTopPickKeys.has(key)) {
        nextState = 'TOP_PICK';
      } else {
        nextState = 'SHORTLISTED';
      }
    } else if (nextState !== 'FILTERED_OUT') {
      nextState = 'FILTERED_OUT';
    }

    persistedCandidates.push({
      ...candidate,
      selectionState: nextState,
        selectionReason:
        nextState === 'TOP_PICK'
          ? `Top pick (${candidate.totalScore.toFixed(1)})`
          : nextState === 'SHORTLISTED'
            ? exploratoryFallbackKeys.has(key)
              ? `Exploratory shortlist (${candidate.totalScore.toFixed(1)})`
              : promotedKeys.has(key)
              ? `Coverage shortlist (${candidate.totalScore.toFixed(1)})`
              : `Shortlisted (${candidate.totalScore.toFixed(1)})`
            : candidate.selectionReason,
    });
  }

  if (mode === 'replace') {
    await prisma.discoveredCompetitor.updateMany({
      where: { researchJobId },
      data: {
        selectionState: 'REJECTED',
      },
    });
  }

  const persistedDiscoveredIds: string[] = [];
  for (const candidate of persistedCandidates) {
    const competitor = await prisma.competitor.upsert({
      where: {
        clientId_platform_handle: {
          clientId: job.clientId,
          platform: candidate.platform,
          handle: candidate.handle,
        },
      },
      update: {},
      create: {
        clientId: job.clientId,
        handle: candidate.handle,
        platform: candidate.platform,
      },
    });

    const existing = await prisma.discoveredCompetitor.findUnique({
      where: {
        researchJobId_platform_handle: {
          researchJobId,
          platform: candidate.platform,
          handle: candidate.handle,
        },
      },
      select: {
        status: true,
        selectionState: true,
        selectionReason: true,
      },
    });

    const mergedSelectionState =
      mode === 'append' && existing?.selectionState === 'APPROVED'
        ? 'APPROVED'
        : candidate.selectionState;
    const mergedSelectionReason =
      mergedSelectionState === 'APPROVED'
        ? existing?.selectionReason || 'Approved for scraping'
        : candidate.selectionReason;

    const status = selectStatusForCandidate(
      mergedSelectionState,
      existing?.status as DiscoveredCompetitorStatus | undefined
    );

    const persisted = await prisma.discoveredCompetitor.upsert({
      where: {
        researchJobId_platform_handle: {
          researchJobId,
          platform: candidate.platform,
          handle: candidate.handle,
        },
      },
      update: {
        competitorId: competitor.id,
        orchestrationRunId: orchestrationRun.id,
        relevanceScore: candidate.relevanceScore,
        discoveryReason: candidate.discoveryReason,
        evidence: candidate.evidence,
        scoreBreakdown: candidate.scoreBreakdown,
        selectionState: mergedSelectionState,
        selectionReason: mergedSelectionReason,
        status,
      },
      create: {
        researchJobId,
        competitorId: competitor.id,
        orchestrationRunId: orchestrationRun.id,
        handle: candidate.handle,
        platform: candidate.platform,
        relevanceScore: candidate.relevanceScore,
        discoveryReason: candidate.discoveryReason,
        evidence: candidate.evidence,
        scoreBreakdown: candidate.scoreBreakdown,
        selectionState: mergedSelectionState,
        selectionReason: mergedSelectionReason,
        status,
      },
    });
    persistedDiscoveredIds.push(persisted.id);
  }

    const staleCandidates = await prisma.discoveredCompetitor.findMany({
      where: {
        researchJobId,
        ...(persistedDiscoveredIds.length > 0 ? { id: { notIn: persistedDiscoveredIds } } : {}),
        selectionState: { not: 'APPROVED' },
      },
      select: {
        id: true,
        status: true,
      },
    });

    for (const stale of staleCandidates) {
      const existingStatus = stale.status as DiscoveredCompetitorStatus;
      const keepStatus = existingStatus === 'SCRAPED' || existingStatus === 'CONFIRMED' || existingStatus === 'SCRAPING';
      await prisma.discoveredCompetitor.update({
        where: { id: stale.id },
        data: {
          selectionState: 'FILTERED_OUT',
          selectionReason: 'Excluded by latest orchestration run',
          status: keepStatus ? existingStatus : 'REJECTED',
        },
      });
    }

    const topPicks = persistedCandidates.filter((item) => item.selectionState === 'TOP_PICK').length;
    const shortlisted = persistedCandidates.filter((item) =>
      ['TOP_PICK', 'SHORTLISTED', 'APPROVED'].includes(item.selectionState)
    ).length;
    const candidatesFiltered = Math.max(0, candidatesDiscovered - shortlisted);

    const summary: CompetitorOrchestrationSummary = {
      candidatesDiscovered,
      candidatesFiltered,
      shortlisted,
      topPicks,
    };

    await prisma.competitorOrchestrationRun.update({
      where: { id: orchestrationRun.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        summary: toInputJson(summary),
      },
    });

    emitResearchJobEvent({
      researchJobId,
      runId: orchestrationRun.id,
      source: 'competitor-orchestrator',
      code: 'competitor.orchestration.filtered',
      level: 'info',
      message: `Filtered ${candidatesFiltered} candidates`,
      metrics: {
        candidatesDiscovered,
        candidatesFiltered,
        retainedFiltered: retainedFiltered.length,
        droppedLowSignalFiltered: droppedLowSignalFilteredCount,
        promotedForCoverage: promotedCandidates.length,
        exploratoryFallbackCount: exploratoryFallbackCandidates.length,
        minReviewTarget: minReviewCount,
        droppedBeforeValidation,
        maxPrevalidationPerPlatform,
        contextualBlacklistTerms: contextualBlacklistTerms.length,
        staleCandidatesReset: staleCandidates.length,
        skippedSourceCandidates: skippedCandidatesByReason,
      },
    });
    emitResearchJobEvent({
      researchJobId,
      runId: orchestrationRun.id,
      source: 'competitor-orchestrator',
      code: 'competitor.orchestration.shortlist.generated',
      level: 'info',
      message: `Generated shortlist (${shortlisted}), top picks (${topPicks})`,
      metrics: summary,
    });

    return { runId: orchestrationRun.id, summary };
  } catch (error: any) {
    const summary = {
      error: error?.message || 'Competitor orchestration failed',
    };

    await prisma.competitorOrchestrationRun.update({
      where: { id: orchestrationRun.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        summary: toInputJson(summary),
      },
    });

    emitResearchJobEvent({
      researchJobId,
      runId: orchestrationRun.id,
      source: 'competitor-orchestrator',
      code: 'competitor.orchestration.failed',
      level: 'error',
      message: `Competitor orchestration failed: ${error?.message || error}`,
    });

    throw error;
  }
}

export async function getCompetitorShortlist(
  researchJobId: string,
  runId?: string
): Promise<CompetitorShortlistResponse> {
  const run = runId
    ? await prisma.competitorOrchestrationRun.findFirst({
        where: { id: runId, researchJobId },
      })
    : await prisma.competitorOrchestrationRun.findFirst({
        where: { researchJobId },
        orderBy: { createdAt: 'desc' },
      });

  if (!run) {
    return {
      runId: null,
      summary: {
        candidatesDiscovered: 0,
        candidatesFiltered: 0,
        shortlisted: 0,
        topPicks: 0,
      },
      topPicks: [],
      shortlist: [],
      filteredOut: [],
    };
  }

  const items = await prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId,
      orchestrationRunId: run.id,
    },
    include: {
      competitor: true,
    },
    orderBy: [{ relevanceScore: 'desc' }, { discoveredAt: 'asc' }],
  });

  const topPicks = items.filter((item) => item.selectionState === 'TOP_PICK');
  const shortlist = items.filter(
    (item) => item.selectionState === 'SHORTLISTED' || item.selectionState === 'APPROVED'
  );
  const filteredOut = items.filter(
    (item) => item.selectionState === 'FILTERED_OUT' || item.selectionState === 'REJECTED'
  );

  const rawSummary = (run.summary || {}) as Record<string, unknown>;
  const summary: CompetitorOrchestrationSummary = {
    candidatesDiscovered: Number(rawSummary.candidatesDiscovered || items.length || 0),
    candidatesFiltered: Number(rawSummary.candidatesFiltered || filteredOut.length || 0),
    shortlisted: Number(rawSummary.shortlisted || topPicks.length + shortlist.length || 0),
    topPicks: Number(rawSummary.topPicks || topPicks.length || 0),
  };

  return {
    runId: run.id,
    summary,
    topPicks,
    shortlist,
    filteredOut,
  };
}

export async function approveAndScrapeCompetitors(
  researchJobId: string,
  runId: string,
  competitorIds: string[]
): Promise<{
  approvedCount: number;
  rejectedCount: number;
  queuedCount: number;
  skippedCount: number;
}> {
  const normalizedIds = Array.from(new Set(competitorIds.map((id) => String(id).trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return { approvedCount: 0, rejectedCount: 0, queuedCount: 0, skippedCount: 0 };
  }

  const run = await prisma.competitorOrchestrationRun.findFirst({
    where: { id: runId, researchJobId },
  });

  if (!run) {
    throw createOrchestrationError(
      'ORCHESTRATION_RUN_NOT_FOUND',
      'Orchestration run not found',
      404
    );
  }

  const candidates = await prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId,
      orchestrationRunId: runId,
      id: { in: normalizedIds },
    },
    select: {
      id: true,
      handle: true,
      platform: true,
      status: true,
      selectionState: true,
    },
  });

  if (candidates.length === 0) {
    return { approvedCount: 0, rejectedCount: 0, queuedCount: 0, skippedCount: normalizedIds.length };
  }

  const approvedIds = candidates.map((candidate) => candidate.id);
  const queueableStatuses: DiscoveredCompetitorStatus[] = ['SUGGESTED', 'FAILED', 'REJECTED'];
  const queuedCandidates = candidates.filter((candidate) =>
    queueableStatuses.includes(candidate.status as DiscoveredCompetitorStatus)
  );
  const skippedCount = candidates.length - queuedCandidates.length;

  await prisma.discoveredCompetitor.updateMany({
    where: { id: { in: approvedIds } },
    data: {
      selectionState: 'APPROVED',
      selectionReason: 'Approved for scraping',
    },
  });

  await prisma.discoveredCompetitor.updateMany({
    where: {
      id: { in: approvedIds },
      status: 'REJECTED',
    },
    data: {
      status: 'SUGGESTED',
    },
  });

  const rejected = await prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId,
      orchestrationRunId: runId,
      id: { notIn: approvedIds },
      selectionState: { in: ['TOP_PICK', 'SHORTLISTED', 'APPROVED'] },
    },
    select: { id: true, status: true },
  });

  for (const row of rejected) {
    await prisma.discoveredCompetitor.update({
      where: { id: row.id },
      data: {
        selectionState: 'REJECTED',
        selectionReason: 'Rejected during review',
        status: row.status === 'SCRAPED' || row.status === 'CONFIRMED' ? row.status : 'REJECTED',
      },
    });
  }

  if (queuedCandidates.length > 0) {
    await prisma.discoveredCompetitor.updateMany({
      where: {
        id: { in: queuedCandidates.map((candidate) => candidate.id) },
        status: { in: ['FAILED', 'REJECTED'] },
      },
      data: {
        status: 'SUGGESTED',
      },
    });
  }

  for (const candidate of candidates) {
    emitResearchJobEvent({
      researchJobId,
      runId,
      source: 'competitor-orchestrator',
      code: 'competitor.selection.approved',
      level: 'info',
      message: `Approved ${candidate.platform} @${candidate.handle} for scraping`,
      platform: candidate.platform,
      handle: candidate.handle,
      entityType: 'competitor',
      entityId: candidate.id,
    });
  }

  for (const candidate of queuedCandidates) {
    emitResearchJobEvent({
      researchJobId,
      runId,
      source: 'competitor-orchestrator',
      code: 'competitor.scrape.queued',
      level: 'info',
      message: `Queued scrape for ${candidate.platform} @${candidate.handle}`,
      platform: candidate.platform,
      handle: candidate.handle,
      entityType: 'competitor',
      entityId: candidate.id,
    });
  }

  if (rejected.length > 0) {
    emitResearchJobEvent({
      researchJobId,
      runId,
      source: 'competitor-orchestrator',
      code: 'competitor.selection.rejected',
      level: 'info',
      message: `Rejected ${rejected.length} candidates during review`,
      metrics: {
        rejectedCount: rejected.length,
      },
    });
  }

  if (skippedCount > 0) {
    emitResearchJobEvent({
      researchJobId,
      runId,
      source: 'competitor-orchestrator',
      code: 'competitor.scrape.queued',
      level: 'warn',
      message: `Skipped ${skippedCount} selected competitors because they are already scraping/scraped`,
      metrics: {
        skippedCount,
      },
    });
  }

  // Fire-and-forget scraping so API returns quickly.
  if (queuedCandidates.length > 0) {
    void scrapeCompetitorsIncremental(
      researchJobId,
      queuedCandidates.map((candidate) => ({
        id: candidate.id,
        handle: candidate.handle,
        platform: candidate.platform,
      })),
      { runId, source: 'orchestration-approval' }
    ).catch((error: any) => {
      console.error(`[CompetitorOrchestrator] Bulk approve scrape failed: ${error?.message || error}`);
    });
  }

  return {
    approvedCount: candidates.length,
    rejectedCount: rejected.length,
    queuedCount: queuedCandidates.length,
    skippedCount,
  };
}

export async function continueCompetitorScrape(
  researchJobId: string,
  input: {
    competitorIds?: string[];
    onlyPending?: boolean;
    runId?: string;
  } = {}
): Promise<{ queuedCount: number; skippedCount: number }> {
  const onlyPending = Boolean(input.onlyPending);
  const requestedIds = Array.from(
    new Set((input.competitorIds || []).map((id) => String(id).trim()).filter(Boolean))
  );

  const where: Prisma.DiscoveredCompetitorWhereInput = {
    researchJobId,
    platform: { in: ['instagram', 'tiktok'] },
    selectionState: { notIn: ['FILTERED_OUT', 'REJECTED'] },
  };

  if (requestedIds.length > 0) {
    where.id = { in: requestedIds };
  }

  if (onlyPending) {
    where.status = { in: ['SUGGESTED', 'FAILED'] };
  }

  const targets = await prisma.discoveredCompetitor.findMany({
    where,
    select: {
      id: true,
      handle: true,
      platform: true,
      status: true,
    },
    orderBy: [{ relevanceScore: 'desc' }, { discoveredAt: 'asc' }],
    take: 50,
  });

  const queueableStatuses: DiscoveredCompetitorStatus[] =
    requestedIds.length > 0
      ? ['SUGGESTED', 'FAILED', 'REJECTED', 'SCRAPED']
      : ['SUGGESTED', 'FAILED'];
  const queueableTargets = targets.filter((target) =>
    queueableStatuses.includes(target.status as DiscoveredCompetitorStatus)
  );
  const missingRequestedCount =
    requestedIds.length > 0 ? Math.max(0, requestedIds.length - targets.length) : 0;
  const skippedCount =
    targets.length - queueableTargets.length + missingRequestedCount;

  if (queueableTargets.length === 0) {
    return { queuedCount: 0, skippedCount };
  }

  for (const target of queueableTargets) {
    emitResearchJobEvent({
      researchJobId,
      runId: input.runId ?? null,
      source: 'competitor-orchestrator',
      code: 'competitor.scrape.queued',
      level: 'info',
      message: `Queued scrape for ${target.platform} @${target.handle}`,
      platform: target.platform,
      handle: target.handle,
      entityType: 'competitor',
      entityId: target.id,
    });
  }

  if (skippedCount > 0) {
    emitResearchJobEvent({
      researchJobId,
      runId: input.runId ?? null,
      source: 'competitor-orchestrator',
      code: 'competitor.scrape.queued',
      level: 'warn',
      message: `Skipped ${skippedCount} competitors not eligible for queued scrape`,
      metrics: { skippedCount },
    });
  }

  void scrapeCompetitorsIncremental(
    researchJobId,
    queueableTargets.map((target) => ({
      id: target.id,
      handle: target.handle,
      platform: target.platform,
    })),
    {
      runId: input.runId,
      source: 'orchestration-continue',
    }
  ).catch((error: any) => {
    console.error(`[CompetitorOrchestrator] Continue scrape failed: ${error?.message || error}`);
  });

  return { queuedCount: queueableTargets.length, skippedCount };
}
