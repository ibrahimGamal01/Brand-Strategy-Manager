import { CompetitorType } from '@prisma/client';
import { ResolvedCandidate } from './competitor-resolver';

export type CompetitorEntityFlag =
  | 'fan_account'
  | 'news_media'
  | 'founder_personal'
  | 'finance_ticker'
  | 'aggregator_directory'
  | 'marketplace_listing'
  | 'community_forum'
  | 'influencer_persona'
  | 'dealer_reseller';

export interface CandidateClassificationInput {
  candidate: ResolvedCandidate;
  scoreBreakdown: {
    offerOverlap: number;
    audienceOverlap: number;
    nicheSemanticMatch: number;
    ragAlignment: number;
  };
  precision: 'high' | 'balanced';
}

export interface CandidateClassificationResult {
  competitorType: CompetitorType;
  typeConfidence: number;
  entityFlags: CompetitorEntityFlag[];
  rationale: string;
  excludedByPolicy: boolean;
}

const FLAG_PATTERNS: Array<{ flag: CompetitorEntityFlag; pattern: RegExp }> = [
  { flag: 'fan_account', pattern: /\b(fan|fanpage|fans?|stan|club|army|tribute|unofficial)\b/i },
  { flag: 'news_media', pattern: /\b(news|magazine|journal|press|daily|times|report|headline|blog)\b/i },
  { flag: 'founder_personal', pattern: /\b(founder|ceo|my journey|personal account|entrepreneur life)\b/i },
  { flag: 'finance_ticker', pattern: /\b(stock|stocks|ticker|nasdaq|nyse|share price|earnings|investor)\b/i },
  { flag: 'aggregator_directory', pattern: /\b(top\s*\d+|directory|listing|compare|comparison|best\s+of)\b/i },
  { flag: 'marketplace_listing', pattern: /\b(marketplace|shop|storefront|deals?|discount|coupon)\b/i },
  { flag: 'community_forum', pattern: /\b(community|forum|subreddit|reddit|discord|group)\b/i },
  { flag: 'influencer_persona', pattern: /\b(influencer|creator|ugc|lifestyle|vlogger|content creator)\b/i },
  { flag: 'dealer_reseller', pattern: /\b(dealer|dealership|reseller|resale|affiliate|distributor)\b/i },
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function tokenize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectEvidenceText(candidate: ResolvedCandidate): string {
  const rows = candidate.evidence
    .slice(0, 25)
    .map((row) => `${row.query || ''} ${row.title || ''} ${row.snippet || ''} ${row.url || ''}`)
    .join(' ');

  return tokenize([
    candidate.handle,
    candidate.canonicalName,
    candidate.websiteDomain || '',
    rows,
  ].join(' '));
}

function detectFlags(text: string): CompetitorEntityFlag[] {
  const flags = new Set<CompetitorEntityFlag>();
  for (const item of FLAG_PATTERNS) {
    if (item.pattern.test(text)) flags.add(item.flag);
  }
  return Array.from(flags);
}

function hasAny(flags: CompetitorEntityFlag[], expected: CompetitorEntityFlag[]): boolean {
  return expected.some((flag) => flags.includes(flag));
}

function classifyType(
  flags: CompetitorEntityFlag[],
  overlapScore: number,
  evidenceUrls: number,
  precision: 'high' | 'balanced'
): { competitorType: CompetitorType; rationale: string } {
  if (hasAny(flags, ['news_media'])) {
    return { competitorType: 'MEDIA', rationale: 'Detected news/media publishing signals' };
  }
  if (hasAny(flags, ['community_forum', 'fan_account'])) {
    return { competitorType: 'COMMUNITY', rationale: 'Detected community/fan account signals' };
  }
  if (hasAny(flags, ['influencer_persona', 'founder_personal'])) {
    return { competitorType: 'INFLUENCER', rationale: 'Detected personal creator/influencer signals' };
  }
  if (hasAny(flags, ['aggregator_directory', 'marketplace_listing', 'dealer_reseller'])) {
    return { competitorType: 'MARKETPLACE', rationale: 'Detected marketplace/dealer/aggregator signals' };
  }

  const directThreshold = precision === 'high' ? 0.6 : 0.55;
  const indirectThreshold = precision === 'high' ? 0.4 : 0.34;
  const evidenceBoost = evidenceUrls >= 2 ? 0.04 : 0;

  if (overlapScore + evidenceBoost >= directThreshold) {
    return { competitorType: 'DIRECT', rationale: 'High category and audience overlap with strong evidence' };
  }

  if (overlapScore + evidenceBoost >= indirectThreshold) {
    return { competitorType: 'INDIRECT', rationale: 'Moderate overlap suggests indirect competition' };
  }

  return { competitorType: 'ADJACENT', rationale: 'Low overlap; adjacent player worth optional tracking' };
}

function computeConfidence(
  competitorType: CompetitorType,
  overlapScore: number,
  flags: CompetitorEntityFlag[],
  evidenceCount: number,
  sourceCount: number
): number {
  const evidenceSignal = clamp01((Math.min(evidenceCount, 5) / 5) * 0.5 + (Math.min(sourceCount, 4) / 4) * 0.5);

  if (competitorType === 'DIRECT' || competitorType === 'INDIRECT' || competitorType === 'ADJACENT') {
    return clamp01(0.42 + overlapScore * 0.42 + evidenceSignal * 0.16);
  }

  const flagSignal = Math.min(flags.length, 3) / 3;
  return clamp01(0.55 + flagSignal * 0.25 + evidenceSignal * 0.2);
}

function shouldExcludeByPolicy(competitorType: CompetitorType, flags: CompetitorEntityFlag[]): boolean {
  if (competitorType === 'MEDIA' || competitorType === 'COMMUNITY') return true;
  if (competitorType === 'INFLUENCER') return true;
  if (hasAny(flags, ['fan_account', 'finance_ticker', 'founder_personal'])) return true;
  return false;
}

export function classifyCompetitorCandidate(
  input: CandidateClassificationInput
): CandidateClassificationResult {
  const text = collectEvidenceText(input.candidate);
  const flags = detectFlags(text);
  const overlapScore = clamp01(
    input.scoreBreakdown.offerOverlap * 0.4 +
      input.scoreBreakdown.audienceOverlap * 0.3 +
      input.scoreBreakdown.nicheSemanticMatch * 0.2 +
      input.scoreBreakdown.ragAlignment * 0.1
  );

  const evidenceUrls = input.candidate.evidence.filter((row) => Boolean(row.url)).length;
  const classified = classifyType(flags, overlapScore, evidenceUrls, input.precision);
  const confidence = computeConfidence(
    classified.competitorType,
    overlapScore,
    flags,
    input.candidate.evidence.length,
    input.candidate.sources.length
  );

  const excludedByPolicy = shouldExcludeByPolicy(classified.competitorType, flags);

  return {
    competitorType: classified.competitorType,
    typeConfidence: confidence,
    entityFlags: flags,
    rationale: classified.rationale,
    excludedByPolicy,
  };
}
