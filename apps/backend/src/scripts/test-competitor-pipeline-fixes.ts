import {
  normalizeHandleFromUrlOrHandle,
  validateHandleForPlatform,
} from '../services/handles/platform-handle';
import {
  CandidateProfileView,
  classifyPipelineStage,
} from '../services/discovery/competitor-materializer';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makeProfile(overrides: Partial<CandidateProfileView>): CandidateProfileView {
  return {
    id: 'candidate-1',
    platform: 'instagram',
    handle: 'example',
    normalizedHandle: 'example',
    profileUrl: 'https://instagram.com/example',
    availabilityStatus: 'UNVERIFIED',
    availabilityReason: null,
    resolverConfidence: null,
    state: 'DISCOVERED',
    stateReason: null,
    competitorType: null,
    typeConfidence: null,
    entityFlags: [],
    relevanceScore: null,
    scoreBreakdown: null,
    evidence: null,
    sources: [],
    discoveredCompetitorId: null,
    discoveredStatus: null,
    sourceType: 'orchestrated',
    scrapeEligible: false,
    blockerReasonCode: null,
    blockerSeverity: 'none',
    readinessStatus: null,
    lastStateTransitionAt: new Date().toISOString(),
    pipelineStage: 'DISCOVERED_CANDIDATES',
    ...overrides,
  };
}

function runHandleChecks(): void {
  const normalized = normalizeHandleFromUrlOrHandle(
    'https://www.instagram.com/quantum__manifestation/?hl=en',
    'instagram'
  );
  assert(normalized === 'quantum__manifestation', 'Expected IG URL normalization to keep double underscores');

  const validDoubleUnderscore = validateHandleForPlatform('instagram', 'quantum__manifestation');
  assert(validDoubleUnderscore.allowed, 'Expected double underscore IG handle to be valid');

  const invalidDoubleDot = validateHandleForPlatform('instagram', 'bad..handle');
  assert(!invalidDoubleDot.allowed, 'Expected double-dot IG handle to remain invalid');
}

function runPipelineStageChecks(): void {
  const scrapedWithBlocker = makeProfile({
    discoveredStatus: 'SCRAPED',
    blockerReasonCode: 'INVALID_HANDLE',
    readinessStatus: 'BLOCKED',
  });
  const stage = classifyPipelineStage(scrapedWithBlocker);
  assert(
    stage === 'SCRAPED_READY',
    `Expected scraped profile to classify as SCRAPED_READY, received ${stage}`
  );

  const blockedUnscraped = makeProfile({
    discoveredStatus: 'SUGGESTED',
    blockerReasonCode: 'INVALID_HANDLE',
    readinessStatus: 'BLOCKED',
  });
  const blockedStage = classifyPipelineStage(blockedUnscraped);
  assert(blockedStage === 'BLOCKED', `Expected blocked unspraped profile to stay BLOCKED`);

  const softBlocked = makeProfile({
    discoveredStatus: 'SUGGESTED',
    blockerReasonCode: 'UNSUPPORTED_SCRAPE_PLATFORM',
    blockerSeverity: 'soft',
    readinessStatus: null,
  });
  const softStage = classifyPipelineStage(softBlocked);
  assert(
    softStage !== 'BLOCKED',
    `Expected soft blocker to avoid BLOCKED stage, received ${softStage}`
  );
}

async function main(): Promise<void> {
  runHandleChecks();
  runPipelineStageChecks();
  console.log('competitor-pipeline-fixes tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
