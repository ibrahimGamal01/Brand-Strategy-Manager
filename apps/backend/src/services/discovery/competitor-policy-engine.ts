import { uniqueSurfaces, parseQ13Answer, inferPolicy, buildSelectedSurfaces, sortByPriority, clamp01 } from './competitor-policy-utils';
import {
  CompetitorDiscoveryPolicy,
  CompetitorPolicyEngineInput,
  PolicySource,
  DiscoveryFocus,
  DiscoveryMethod,
  WebsitePolicy,
  CompetitorDiscoveryMethodAnswerJson,
} from './competitor-policy-types';

export type {
  CompetitorDiscoveryPolicy,
  CompetitorPolicyEngineInput,
  PolicySource,
  DiscoveryFocus,
  DiscoveryMethod,
  WebsitePolicy,
  CompetitorDiscoveryMethodAnswerJson,
};

export function buildCompetitorDiscoveryPolicy(input: CompetitorPolicyEngineInput): CompetitorDiscoveryPolicy {
  const requested = uniqueSurfaces(input.requestedSurfaces || []);
  const parsedQ13 = parseQ13Answer(input.q13AnswerJson);
  const socialHandleCount = input.clientAccounts
    .map((account) => String(account.handle || '').trim())
    .filter(Boolean).length;

  let policy: CompetitorDiscoveryPolicy;
  let source: PolicySource;

  if (parsedQ13) {
    source = 'ai_q13';
    policy = {
      selectedSurfaces: parsedQ13.surfacePriority,
      surfacePriority: parsedQ13.surfacePriority,
      websitePolicy: parsedQ13.websitePolicy,
      shortlistConstraints: {
        minimumSocialForShortlist:
          parsedQ13.discoveryFocus === 'social_first'
            ? 1
            : Math.max(0, Math.min(2, Math.floor(parsedQ13.minimumSocialForShortlist || socialHandleCount || 1))),
        websiteFallbackOnlyWhenSocialBelowMinimum: parsedQ13.websitePolicy === 'fallback_only',
      },
      policySource: source,
      discoveryFocus: parsedQ13.discoveryFocus,
      method: parsedQ13.method,
      confidence: clamp01(parsedQ13.confidence),
      rationale: parsedQ13.rationale || 'Applied AI strategic question #13 policy.',
    };
  } else {
    policy = inferPolicy(input);
    source = policy.policySource;
  }

  if (requested.length > 0) {
    source = 'requested_override';
  }

  const selectedSurfaces = buildSelectedSurfaces(input, policy, source);
  const surfacePriority = sortByPriority(
    uniqueSurfaces([...selectedSurfaces, ...policy.surfacePriority]),
    policy.surfacePriority
  );

  return {
    ...policy,
    policySource: source,
    selectedSurfaces,
    surfacePriority,
  };
}
