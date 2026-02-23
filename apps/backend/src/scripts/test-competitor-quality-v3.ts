import { classifyCompetitorCandidate } from '../services/discovery/competitor-classifier';
import { buildPointyCompetitorQueryPlan } from '../services/discovery/competitor-query-composer';
import { ResolvedCandidate } from '../services/discovery/competitor-resolver';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeCandidate(overrides: Partial<ResolvedCandidate>): ResolvedCandidate {
  return {
    platform: 'instagram',
    handle: 'examplebrand',
    normalizedHandle: 'examplebrand',
    profileUrl: 'https://www.instagram.com/examplebrand/',
    canonicalName: 'Example Brand',
    websiteDomain: 'example.com',
    sources: ['ddg_direct_social'],
    evidence: [],
    baseSignal: 0.7,
    availabilityStatus: 'VERIFIED',
    availabilityReason: 'Verified',
    resolverConfidence: 0.8,
    ...overrides,
  };
}

function runClassifierChecks(): void {
  const mediaCandidate = makeCandidate({
    handle: 'evnewsdaily',
    evidence: [
      {
        sourceType: 'ddg_query',
        title: 'Daily EV news and press updates',
        snippet: 'Breaking EV news and investor headlines',
        url: 'https://evnewsdaily.com/latest',
        signalScore: 0.8,
      },
    ],
  });

  const media = classifyCompetitorCandidate({
    candidate: mediaCandidate,
    scoreBreakdown: {
      offerOverlap: 0.4,
      audienceOverlap: 0.2,
      nicheSemanticMatch: 0.3,
      ragAlignment: 0.2,
    },
    precision: 'high',
  });

  assert(media.competitorType === 'MEDIA', 'Expected media candidate to classify as MEDIA');
  assert(media.excludedByPolicy, 'Expected media candidate to be excluded by policy');

  const directCandidate = makeCandidate({
    handle: 'evcoremotors',
    sources: ['ddg_direct_social', 'ddg_query'],
    evidence: [
      {
        sourceType: 'ddg_query',
        title: 'EV Core Motors official',
        snippet: 'Electric vehicle manufacturer and charging network',
        url: 'https://evcoremotors.com',
        signalScore: 0.9,
      },
      {
        sourceType: 'ddg_query',
        title: 'EV Core Motors Instagram',
        snippet: 'Electric vehicle lineup and battery updates',
        url: 'https://www.instagram.com/evcoremotors/',
        signalScore: 0.85,
      },
    ],
  });

  const direct = classifyCompetitorCandidate({
    candidate: directCandidate,
    scoreBreakdown: {
      offerOverlap: 0.82,
      audienceOverlap: 0.75,
      nicheSemanticMatch: 0.8,
      ragAlignment: 0.76,
    },
    precision: 'high',
  });

  assert(direct.competitorType === 'DIRECT', 'Expected direct candidate to classify as DIRECT');
  assert(!direct.excludedByPolicy, 'Expected direct candidate to remain promotable');
}

function runQueryPlanChecks(): void {
  const plan = buildPointyCompetitorQueryPlan({
    brandName: 'Voltline Automotive',
    niche: 'Electric vehicles for premium commuters',
    businessOverview: 'Public automotive manufacturer focused on EV innovation',
    audienceSummary: 'Drivers comparing electric vehicle brands and charging ecosystems',
    platformMatrix: {
      requested: ['instagram', 'website'],
      detected: ['instagram', 'website'],
      fromAccounts: ['instagram'],
      fromInput: ['website'],
      fromContext: ['website'],
      selected: ['instagram', 'website'],
      websiteDomain: 'voltline.com',
    },
    precision: 'high',
  });

  assert(plan.businessType === 'enterprise_brand', 'Expected enterprise archetype inference');
  assert(plan.negatives.includes('stock'), 'Expected enterprise plan to include finance noise negatives');
  assert(
    plan.perSurface.website.some((query) => query.toLowerCase().includes('category leaders')),
    'Expected enterprise website queries to include category leader intent'
  );
}

async function main(): Promise<void> {
  runClassifierChecks();
  runQueryPlanChecks();
  console.log('competitor-quality-v3 tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
