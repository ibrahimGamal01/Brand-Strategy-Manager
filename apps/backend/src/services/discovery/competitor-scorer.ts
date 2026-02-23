import { CompetitorCandidateState, CompetitorType } from '@prisma/client';
import { WebsitePolicy } from './competitor-policy-engine';
import { ResolvedCandidate } from './competitor-resolver';
import { classifyCompetitorCandidate } from './competitor-classifier';
import { SCORE_WEIGHTS, clamp01, hasCorroboration, isBlockedHandle, overlapScore, toScoringTokens, toTokenSet } from './competitor-scorer-utils';
export interface ScoredCandidate extends ResolvedCandidate {
  state: CompetitorCandidateState;
  stateReason: string;
  competitorType: CompetitorType;
  typeConfidence: number;
  entityFlags: string[];
  relevanceScore: number;
  totalScore: number;
  scoreBreakdown: {
    offerOverlap: number; audienceOverlap: number; nicheSemanticMatch: number; activityRecency: number; sizeSimilarity: number; sourceConfidence: number; ragAlignment: number; weightedTotal: number;
  };
}

type ScoringPolicy = {
  websitePolicy: WebsitePolicy;
  minimumSocialForShortlist: number;
  websiteFallbackOnlyWhenSocialBelowMinimum: boolean;
};

export interface ScorerInput {
  candidates: ResolvedCandidate[];
  businessKeywords: string[];
  audienceKeywords: string[];
  niche: string;
  targetCount: number;
  precision: 'high' | 'balanced';
  excludeHandles: string[];
  ragKeywords?: string[];
  brandKeywords?: string[];
  policy?: ScoringPolicy;
}

function scoreCandidate(
  candidate: ResolvedCandidate,
  businessSet: Set<string>,
  audienceSet: Set<string>,
  nicheSet: Set<string>,
  ragSet: Set<string>,
  excludeHandles: Set<string>,
  brandSet: Set<string>,
  precision: 'high' | 'balanced',
  policy: ScoringPolicy
): ScoredCandidate {
  const candidateText = [
    candidate.handle,
    candidate.canonicalName,
    candidate.websiteDomain || '',
    ...candidate.evidence.map(
      (row) => `${row.query || ''} ${row.title || ''} ${row.snippet || ''} ${row.url || ''}`
    ),
  ]
    .join(' ')
    .toLowerCase();
  const candidateTokens = toScoringTokens(candidateText);

  const normalizedHandle = String(candidate.normalizedHandle || '').toLowerCase();
  const sourceCount = candidate.sources.length;
  const corroborated = hasCorroboration(candidate, policy.websitePolicy);
  const brandOverlap = brandSet.size > 0 ? Array.from(brandSet).filter((token) => normalizedHandle.includes(token)).length : 0;

  const offerOverlap = overlapScore(businessSet, candidateTokens);
  const audienceOverlap = overlapScore(audienceSet, candidateTokens);
  const nicheSemanticMatch = overlapScore(nicheSet, candidateTokens);
  const ragAlignment = overlapScore(ragSet, candidateTokens);

  const activityRecency =
    candidate.availabilityStatus === 'VERIFIED'
      ? clamp01(0.75 + candidate.resolverConfidence * 0.25)
      : candidate.availabilityStatus === 'UNVERIFIED'
        ? 0.45
        : 0.12;

  const sizeSimilarity = sourceCount >= 2 ? 0.72 : 0.52;
  const sourceConfidence = clamp01(sourceCount / 3) * 0.65 + clamp01(candidate.resolverConfidence) * 0.35;
  const weightedBase = offerOverlap * SCORE_WEIGHTS.offerOverlap + audienceOverlap * SCORE_WEIGHTS.audienceOverlap + nicheSemanticMatch * SCORE_WEIGHTS.nicheSemanticMatch + activityRecency * SCORE_WEIGHTS.activityRecency + sizeSimilarity * SCORE_WEIGHTS.sizeSimilarity + sourceConfidence * SCORE_WEIGHTS.sourceConfidence;
  const classification = classifyCompetitorCandidate({
    candidate,
    scoreBreakdown: {
      offerOverlap,
      audienceOverlap,
      nicheSemanticMatch,
      ragAlignment,
    },
    precision,
  });
  const typePenalty = classification.excludedByPolicy ? 16 : 0;
  const weightedTotal = Math.max(0, Math.min(100, weightedBase + ragAlignment * 8 - typePenalty));

  const minOffer = precision === 'high' ? 0.14 : 0.1;
  const minAudience = precision === 'high' ? 0.1 : 0.08;
  const minNiche = precision === 'high' ? 0.12 : 0.08;
  const minCombined = precision === 'high' ? 0.4 : 0.3;
  const minRag = precision === 'high' ? 0.2 : 0.14;
  const semanticPeak = Math.max(offerOverlap, audienceOverlap, nicheSemanticMatch);

  const directPeerEvidence =
    offerOverlap >= minOffer &&
    audienceOverlap >= minAudience &&
    nicheSemanticMatch >= minNiche &&
    (offerOverlap + audienceOverlap + nicheSemanticMatch >= minCombined ||
      ragAlignment >= minRag ||
      semanticPeak >= (precision === 'high' ? 0.2 : 0.16));
  const blocked = excludeHandles.has(normalizedHandle) || isBlockedHandle(normalizedHandle) || brandOverlap > 0 || candidate.availabilityStatus === 'PROFILE_UNAVAILABLE' || candidate.availabilityStatus === 'INVALID_HANDLE' || classification.excludedByPolicy;

  const socialTopPickThreshold = precision === 'high' ? 70 : 66;
  const socialShortlistThreshold = precision === 'high' ? 56 : 50;
  const websiteTopPickThreshold = precision === 'high' ? (policy.websitePolicy === 'peer_candidate' ? 82 : 80) : (policy.websitePolicy === 'peer_candidate' ? 76 : 72);
  const websiteShortlistThreshold = precision === 'high' ? (policy.websitePolicy === 'peer_candidate' ? 72 : 70) : (policy.websitePolicy === 'peer_candidate' ? 66 : 62);
  const topPickThreshold = candidate.platform === 'website' ? websiteTopPickThreshold : socialTopPickThreshold;
  const shortlistThreshold = candidate.platform === 'website' ? websiteShortlistThreshold : socialShortlistThreshold;

  let state: CompetitorCandidateState = 'FILTERED_OUT';
  let stateReason = 'Insufficient direct-peer evidence';

  if (blocked) {
    stateReason =
      candidate.availabilityStatus === 'PROFILE_UNAVAILABLE'
        ? 'Profile is not available'
        : candidate.availabilityStatus === 'INVALID_HANDLE'
          ? 'Invalid handle/domain'
          : classification.excludedByPolicy
            ? `Excluded by entity type (${classification.competitorType.toLowerCase()})`
          : 'Excluded self/generic handle';
  } else if (!corroborated) {
    stateReason = 'Rejected: no corroboration across sources/evidence';
  } else if (candidate.platform === 'website' && candidate.availabilityStatus !== 'VERIFIED') {
    stateReason = `Website availability not verified (${candidate.availabilityStatus})`;
  } else if (candidate.platform === 'website' && policy.websitePolicy === 'evidence_only') {
    stateReason = 'Website policy set to evidence_only (website cannot be shortlisted directly)';
  } else if (
    weightedTotal >= topPickThreshold &&
    directPeerEvidence &&
    (classification.competitorType === 'DIRECT' || classification.competitorType === 'INDIRECT')
  ) {
    state = 'TOP_PICK';
    stateReason = 'Direct peer with high evidence score';
  } else if (
    weightedTotal >= shortlistThreshold &&
    directPeerEvidence &&
    (classification.competitorType === 'DIRECT' || classification.competitorType === 'INDIRECT')
  ) {
    state = 'SHORTLISTED';
    stateReason = 'Direct peer with moderate evidence score';
  } else if (
    weightedTotal >= shortlistThreshold + 6 &&
    directPeerEvidence &&
    classification.competitorType === 'ADJACENT'
  ) {
    state = 'SHORTLISTED';
    stateReason = 'Adjacent competitor admitted with strong evidence score';
  } else {
    stateReason = 'Below shortlist quality threshold';
  }

  return {
    ...candidate,
    state,
    stateReason,
    competitorType: classification.competitorType,
    typeConfidence: classification.typeConfidence,
    entityFlags: classification.entityFlags,
    relevanceScore: clamp01(weightedTotal / 100),
    totalScore: weightedTotal,
    scoreBreakdown: {
      offerOverlap,
      audienceOverlap,
      nicheSemanticMatch,
      activityRecency,
      sizeSimilarity,
      sourceConfidence,
      ragAlignment,
      weightedTotal,
    },
  };
}

export function scoreCompetitorCandidates(input: ScorerInput): {
  scored: ScoredCandidate[];
  shortlist: ScoredCandidate[];
  filtered: ScoredCandidate[];
} {
  const policy: ScoringPolicy = input.policy || { websitePolicy: 'fallback_only' as WebsitePolicy, minimumSocialForShortlist: 1, websiteFallbackOnlyWhenSocialBelowMinimum: true };

  const businessSet = toTokenSet(input.businessKeywords);
  const audienceSet = toTokenSet(input.audienceKeywords);
  const nicheSet = toTokenSet([input.niche, ...input.businessKeywords, ...input.audienceKeywords]);
  const ragSet = toTokenSet(input.ragKeywords || []);
  const brandSet = toTokenSet(input.brandKeywords || []);
  const excludeHandles = new Set(input.excludeHandles.map((item) => item.toLowerCase()));

  const scored = input.candidates
    .map((candidate) => scoreCandidate(candidate, businessSet, audienceSet, nicheSet, ragSet, excludeHandles, brandSet, input.precision, policy))
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (b.scoreBreakdown.offerOverlap !== a.scoreBreakdown.offerOverlap) {
        return b.scoreBreakdown.offerOverlap - a.scoreBreakdown.offerOverlap;
      }
      return b.scoreBreakdown.audienceOverlap - a.scoreBreakdown.audienceOverlap;
    });

  const topPickLimit = Math.min(6, input.targetCount);
  const shortlistLimit = Math.max(input.targetCount, 10);

  const shortlist: ScoredCandidate[] = [];
  let topPicksUsed = 0;
  for (const candidate of scored) {
    if (candidate.state === 'TOP_PICK') {
      shortlist.push(
        topPicksUsed < topPickLimit
          ? candidate
          : { ...candidate, state: 'SHORTLISTED', stateReason: 'Top-pick cap reached; kept shortlisted' }
      );
      topPicksUsed += 1;
      continue;
    }
    if (candidate.state === 'SHORTLISTED' && shortlist.length < shortlistLimit) shortlist.push(candidate);
  }

  const socialShortlisted = shortlist.filter((candidate) => candidate.platform !== 'website').length;
  const enforceEvidenceOnly = policy.websitePolicy === 'evidence_only';
  const enforceFallbackMinimum =
    policy.websiteFallbackOnlyWhenSocialBelowMinimum &&
    socialShortlisted >= Math.max(0, policy.minimumSocialForShortlist);

  const restrictedWebsiteKeys = new Set<string>();
  if (enforceEvidenceOnly || enforceFallbackMinimum) {
    for (const candidate of shortlist) {
      if (candidate.platform === 'website') {
        restrictedWebsiteKeys.add(`${candidate.platform}:${candidate.normalizedHandle}`);
      }
    }
  }

  const shortlistFiltered = shortlist.filter((candidate) => !restrictedWebsiteKeys.has(`${candidate.platform}:${candidate.normalizedHandle}`));
  const shortlistByKey: Map<string, ScoredCandidate> = new Map(
    shortlistFiltered.map((item) => [`${item.platform}:${item.normalizedHandle}`, item] as const)
  );
  const shortlistKeys: Set<string> = new Set(shortlistByKey.keys());

  const adaptiveMinimum = input.precision === 'balanced' ? Math.min(input.targetCount, 4) : Math.min(input.targetCount, 3);
  const allowAdaptiveFallback = input.precision === 'balanced' || shortlistFiltered.length === 0;
  if (allowAdaptiveFallback && shortlistFiltered.length < adaptiveMinimum) {
    const fallbackNeeded = adaptiveMinimum - shortlistFiltered.length;
    const adaptiveCandidates = scored
      .filter((candidate) => {
        const key = `${candidate.platform}:${candidate.normalizedHandle}`;
        if (shortlistKeys.has(key)) return false;
        if (candidate.platform === 'website') return false;
        if (candidate.availabilityStatus !== 'VERIFIED') return false;
        if (isBlockedHandle(candidate.normalizedHandle)) return false;
        const highMode = input.precision === 'high';
        if (candidate.totalScore < (highMode ? 48 : 60)) return false;
        if (candidate.scoreBreakdown.offerOverlap < (highMode ? 0.1 : 0.14)) return false;
        if (candidate.scoreBreakdown.audienceOverlap < (highMode ? 0.06 : 0.1)) return false;
        if (candidate.scoreBreakdown.nicheSemanticMatch < (highMode ? 0.08 : 0.1)) return false;
        if ((candidate.sources || []).length < 2) return false;
        if (candidate.state !== 'FILTERED_OUT') return false;
        const reason = String(candidate.stateReason || '').toLowerCase();
        if (reason.includes('excluded self/generic')) return false;
        if (reason.includes('profile is not available')) return false;
        if (reason.includes('invalid handle/domain')) return false;
        return true;
      })
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, fallbackNeeded)
      .map((candidate) => ({
        ...candidate,
        state: 'SHORTLISTED' as const,
        stateReason: input.precision === 'high'
          ? 'Adaptive shortlist fallback: promoted for review due sparse direct-peer coverage'
          : 'Adaptive shortlist fallback: promoted for manual review due sparse direct-peer coverage',
      }));

    for (const candidate of adaptiveCandidates) {
      const key = `${candidate.platform}:${candidate.normalizedHandle}`;
      shortlistFiltered.push(candidate);
      shortlistByKey.set(key, candidate);
      shortlistKeys.add(key);
    }
  }

  const topPickCount = shortlistFiltered.filter((candidate) => candidate.state === 'TOP_PICK').length;
  if (topPickCount === 0 && shortlistFiltered.length > 0) {
    shortlistFiltered
      .slice()
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, Math.min(2, shortlistFiltered.length))
      .forEach((candidate) => {
        const key = `${candidate.platform}:${candidate.normalizedHandle}`;
        const promoted = {
          ...candidate,
          state: 'TOP_PICK' as const,
          stateReason: 'Promoted to top pick from strongest shortlist candidates',
        };
        shortlistByKey.set(key, promoted);
      });
  }
  const normalizedScored = scored.map((candidate) => {
    const key = `${candidate.platform}:${candidate.normalizedHandle}`;
    if (shortlistKeys.has(key)) return shortlistByKey.get(key) || candidate;
    if (restrictedWebsiteKeys.has(key)) {
      return {
        ...candidate,
        state: 'FILTERED_OUT' as const,
        stateReason:
          policy.websitePolicy === 'evidence_only'
            ? 'Website candidate filtered by evidence_only policy'
            : 'Website fallback blocked because social shortlist already met policy minimum',
      };
    }
    if (candidate.state === 'FILTERED_OUT' || candidate.state === 'REJECTED') {
      return candidate;
    }
    return {
      ...candidate,
      state: 'FILTERED_OUT' as const,
      stateReason: 'Outside top shortlist set',
    };
  });
  const finalizedShortlist = shortlistFiltered.map(
    (candidate) => shortlistByKey.get(`${candidate.platform}:${candidate.normalizedHandle}`) || candidate
  );
  return {
    scored: normalizedScored,
    shortlist: finalizedShortlist,
    filtered: normalizedScored.filter((candidate) => candidate.state === 'FILTERED_OUT'),
  };
}
