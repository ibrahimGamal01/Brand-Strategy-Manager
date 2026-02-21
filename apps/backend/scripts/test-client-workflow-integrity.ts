import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AiQuestionType, CalendarSlotStatus, Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { parseCompetitorInspirationInputs } from '../src/services/intake/brain-intake-utils';
import { deriveCandidateEligibility, isScrapePlatform } from '../src/services/discovery/competitor-pipeline-rules';
import { seedTopPicksFromInspirationLinks } from '../src/services/discovery/seed-intake-competitors';
import { continueCompetitorScrape } from '../src/services/discovery/competitor-orchestrator-v2';
import { scoreAndPersistJobSnapshotReadiness } from '../src/services/orchestration/content-readiness';
import { buildQualifiedContentPool } from '../src/services/orchestration/content-qualification';

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

type CheckResult = {
  id: string;
  area: string;
  title: string;
  severity: Severity;
  passed: boolean;
  details: string[];
  recommendation?: string;
};

type Args = {
  jobId: string | null;
  outPath: string | null;
  includeUmmah: boolean;
  strict: boolean;
  fixCompetitorPipeline: boolean;
};

const REQUIRED_QUESTION_TYPES: AiQuestionType[] = [
  'VALUE_PROPOSITION',
  'TARGET_AUDIENCE',
  'CONTENT_PILLARS',
  'BRAND_VOICE',
  'BRAND_PERSONALITY',
  'COMPETITOR_ANALYSIS',
  'NICHE_POSITION',
  'UNIQUE_STRENGTHS',
  'CONTENT_OPPORTUNITIES',
  'GROWTH_STRATEGY',
  'PAIN_POINTS',
  'KEY_DIFFERENTIATORS',
  'COMPETITOR_DISCOVERY_METHOD',
];

const REQUIRED_DOCUMENT_TOPICS = [
  'business_understanding',
  'target_audience',
  'industry_overview',
  'priority_competitor',
  'content_analysis',
  'content_pillars',
  'format_recommendations',
  'buyer_journey',
  'platform_strategy',
] as const;

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /@handle\d+/gi,
  /@competitor\d+/gi,
  /@example/gi,
  /\[handle\]/gi,
  /\[competitor\]/gi,
  /\[platform\]/gi,
  /not found in research/gi,
  /not available in data/gi,
  /data not available/gi,
  /\[x\]/gi,
  /\[y\]/gi,
];

const DOC_EVIDENCE_SIGNAL = /(content gap|opportunit|hook|engagement|likes|views|comments|@\w+|benchmark|verified)/i;

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const jobArg = args.find((arg) => arg.startsWith('--job='));
  const outArg = args.find((arg) => arg.startsWith('--out='));

  return {
    jobId: jobArg ? jobArg.replace('--job=', '').trim() : null,
    outPath: outArg ? outArg.replace('--out=', '').trim() : null,
    includeUmmah: args.includes('--include-ummah'),
    strict: !args.includes('--non-strict'),
    fixCompetitorPipeline: args.includes('--fix-competitor-pipeline'),
  };
}

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function defaultOutputPath(jobId: string): string {
  const fileName = `workflow-integrity-${jobId}.md`;
  return path.resolve(resolveRepoRoot(), 'docs', 'baselines', fileName);
}

function normalizeHandle(value: unknown): string {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function normalizeKey(platform: unknown, handle: unknown): string {
  return `${String(platform || '').trim().toLowerCase()}:${normalizeHandle(handle)}`;
}

function toText(value: Prisma.JsonValue | null | undefined): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasPlaceholderOrDisclaimer(text: string): boolean {
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

function hasContentEvidenceSignals(text: string): boolean {
  return DOC_EVIDENCE_SIGNAL.test(text);
}

function addCheck(
  checks: CheckResult[],
  input: Omit<CheckResult, 'details'> & { details?: string[] }
) {
  checks.push({
    ...input,
    details: input.details || [],
  });
}

async function resolveTargetJob(jobId: string | null, includeUmmah: boolean) {
  if (jobId) {
    const byId = await prisma.researchJob.findUnique({
      where: { id: jobId },
      include: { client: { select: { id: true, name: true } } },
    });
    if (!byId) {
      throw new Error(`Research job not found: ${jobId}`);
    }
    return byId;
  }

  const jobs = await prisma.researchJob.findMany({
    include: { client: { select: { id: true, name: true } } },
    orderBy: [{ startedAt: 'desc' }],
  });
  if (jobs.length === 0) {
    throw new Error('No research jobs found');
  }

  const selected = includeUmmah
    ? jobs[0]
    : jobs.find((job) => !/ummah/i.test(String(job.client?.name || '')));

  return selected || jobs[0];
}

async function maybeApplyCompetitorFixes(job: {
  id: string;
  inputData: Prisma.JsonValue | null;
}): Promise<string[]> {
  const logs: string[] = [];
  const inputData = (job.inputData || {}) as Record<string, unknown>;
  const links = Array.isArray(inputData.competitorInspirationLinks)
    ? (inputData.competitorInspirationLinks as unknown[])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    : [];

  if (links.length > 0) {
    const reseed = await seedTopPicksFromInspirationLinks(job.id, links);
    logs.push(`Reseeded client inspiration competitors: ${reseed.topPicks}`);
  } else {
    logs.push('Skipped reseed (no competitorInspirationLinks in job inputData)');
  }

  const queueResult = await continueCompetitorScrape(job.id, {
    onlyPending: true,
    forceUnavailable: true,
    forceMaterialize: true,
  });
  logs.push(`Queued competitors for scrape: queued=${queueResult.queuedCount}, skipped=${queueResult.skippedCount}`);

  const readiness = await scoreAndPersistJobSnapshotReadiness(job.id);
  logs.push(
    `Re-scored readiness: client READY=${readiness.client.filter((r) => r.status === 'READY').length}, competitor READY=${readiness.competitor.filter((r) => r.status === 'READY').length}`
  );

  return logs;
}

function validateQuestion13(value: Prisma.JsonValue | null): { ok: boolean; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'answerJson is missing or not an object' };
  }

  const row = value as Record<string, unknown>;
  const discoveryFocus = String(row.discoveryFocus || '');
  const method = String(row.method || '');
  const websitePolicy = String(row.websitePolicy || '');
  const surfacePriority = Array.isArray(row.surfacePriority)
    ? row.surfacePriority.map((item) => String(item || '').toLowerCase()).filter(Boolean)
    : [];

  const allowedFocus = new Set(['social_first', 'hybrid', 'web_first']);
  const allowedMethod = new Set(['handle_led', 'niche_led', 'account_led', 'mixed']);
  const allowedWebsitePolicy = new Set(['evidence_only', 'fallback_only', 'peer_candidate']);
  const allowedSurface = new Set([
    'instagram',
    'tiktok',
    'youtube',
    'linkedin',
    'x',
    'facebook',
    'website',
  ]);

  if (!allowedFocus.has(discoveryFocus)) {
    return { ok: false, reason: `invalid discoveryFocus: ${discoveryFocus || '(empty)'}` };
  }
  if (!allowedMethod.has(method)) {
    return { ok: false, reason: `invalid method: ${method || '(empty)'}` };
  }
  if (!allowedWebsitePolicy.has(websitePolicy)) {
    return { ok: false, reason: `invalid websitePolicy: ${websitePolicy || '(empty)'}` };
  }
  if (surfacePriority.length === 0 || surfacePriority.some((entry) => !allowedSurface.has(entry))) {
    return {
      ok: false,
      reason: `surfacePriority invalid: ${surfacePriority.length > 0 ? surfacePriority.join(', ') : '(empty)'}`,
    };
  }

  return { ok: true, reason: 'ok' };
}

async function runChecks(job: {
  id: string;
  status: string;
  startedAt: Date | null;
  inputData: Prisma.JsonValue | null;
  client: { id: string; name: string } | null;
}): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const jobId = job.id;
  const inputData = (job.inputData || {}) as Record<string, unknown>;

  const [
    questions,
    docs,
    candidates,
    discovered,
    competitorSnapshots,
    latestCalendarRun,
    readyClientSnapshots,
    readyCompetitorSnapshots,
    promptFiles,
    mediaAnalysisCounts,
    latestMediaAnalysisRun,
  ] = await Promise.all([
    prisma.aiQuestion.findMany({
      where: { researchJobId: jobId },
      select: {
        id: true,
        questionType: true,
        isAnswered: true,
        answer: true,
        answerJson: true,
        answeredAt: true,
      },
    }),
    prisma.aiAnalysis.findMany({
      where: {
        researchJobId: jobId,
        analysisType: 'DOCUMENT',
      },
      orderBy: { analyzedAt: 'desc' },
      select: {
        id: true,
        topic: true,
        documentStatus: true,
        fullResponse: true,
        groundingReport: true,
        analyzedAt: true,
      },
    }),
    prisma.competitorCandidateProfile.findMany({
      where: { researchJobId: jobId },
      select: {
        id: true,
        platform: true,
        handle: true,
        normalizedHandle: true,
        source: true,
        inputType: true,
        scrapeEligible: true,
        blockerReasonCode: true,
        state: true,
        availabilityStatus: true,
        discoveredCompetitors: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    }),
    prisma.discoveredCompetitor.findMany({
      where: { researchJobId: jobId },
      select: {
        id: true,
        platform: true,
        handle: true,
        candidateProfileId: true,
        status: true,
        selectionState: true,
      },
    }),
    prisma.competitorProfileSnapshot.findMany({
      where: { researchJobId: jobId },
      select: {
        id: true,
        readinessStatus: true,
        competitorProfile: {
          select: {
            platform: true,
            handle: true,
          },
        },
      },
    }),
    prisma.contentCalendarRun.findFirst({
      where: { researchJobId: jobId },
      orderBy: { createdAt: 'desc' },
      include: {
        slots: {
          orderBy: { slotIndex: 'asc' },
        },
      },
    }),
    prisma.clientProfileSnapshot.findMany({
      where: { researchJobId: jobId, readinessStatus: 'READY' },
      select: { id: true },
    }),
    prisma.competitorProfileSnapshot.findMany({
      where: { researchJobId: jobId, readinessStatus: 'READY' },
      select: { id: true },
    }),
    Promise.all([
      readFile(
        path.resolve(resolveRepoRoot(), 'apps', 'backend', 'src', 'services', 'ai', 'prompts', 'content-calendar-prompts.ts'),
        'utf8'
      ),
      readFile(
        path.resolve(resolveRepoRoot(), 'apps', 'backend', 'src', 'services', 'ai', 'generators', 'base-generator.ts'),
        'utf8'
      ),
      readFile(
        path.resolve(resolveRepoRoot(), 'apps', 'backend', 'src', 'services', 'ai', 'prompts', 'system-prompts.ts'),
        'utf8'
      ),
      readFile(
        path.resolve(resolveRepoRoot(), 'apps', 'backend', 'src', 'routes', 'content-calendar.ts'),
        'utf8'
      ),
      readFile(
        path.resolve(
          resolveRepoRoot(),
          'apps',
          'backend',
          'src',
          'services',
          'orchestration',
          'run-job-media-analysis.ts'
        ),
        'utf8'
      ),
      readFile(
        path.resolve(
          resolveRepoRoot(),
          'apps',
          'backend',
          'src',
          'services',
          'calendar',
          'content-calendar-context.ts'
        ),
        'utf8'
      ),
    ]),
    prisma.aiAnalysis.groupBy({
      by: ['analysisType'],
      where: {
        researchJobId: jobId,
        mediaAssetId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.mediaAnalysisRun.findFirst({
      where: { researchJobId: jobId },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        status: true,
        downloadedTotal: true,
        qualifiedForAi: true,
        analysisWindow: true,
        analyzedInWindow: true,
        attemptedAssets: true,
        succeededCount: true,
        failedCount: true,
        skippedReason: true,
      },
    }),
  ]);

  const qualifiedPool = await buildQualifiedContentPool(jobId, {
    allowDegradedSnapshots: false,
    requireScopedCompetitors: true,
    maxClientSnapshots: 8,
    maxCompetitorSnapshots: 24,
    maxPostsPerSnapshot: 120,
  });
  const qualifiedMediaAssetIds = new Set(
    qualifiedPool.posts.flatMap((post) => post.mediaAssetIds)
  );
  const mediaAnalysisRows = await prisma.aiAnalysis.findMany({
    where: {
      researchJobId: jobId,
      mediaAssetId: { not: null },
    },
    select: {
      id: true,
      mediaAssetId: true,
    },
  });
  const scopedMediaAnalysisRows = mediaAnalysisRows.filter((row) =>
    qualifiedMediaAssetIds.has(String(row.mediaAssetId || '').trim())
  );
  const unscopedMediaAnalysisRows = mediaAnalysisRows.filter(
    (row) => !qualifiedMediaAssetIds.has(String(row.mediaAssetId || '').trim())
  );

  // -----------------------------------------------------------------------
  // Competitors (client-given + discovered + eligibility + queue linkage)
  // -----------------------------------------------------------------------
  const inspirationLinks = Array.isArray(inputData.competitorInspirationLinks)
    ? (inputData.competitorInspirationLinks as unknown[])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    : [];
  const parsedInspiration = parseCompetitorInspirationInputs(inspirationLinks);

  const candidateKeyToRow = new Map<string, (typeof candidates)[number]>();
  for (const row of candidates) {
    const key = normalizeKey(row.platform, row.normalizedHandle || row.handle);
    candidateKeyToRow.set(key, row);
  }

  const parsedKeys = parsedInspiration.map((row) => {
    if (row.inputType === 'website') {
      return `website:${row.domain.toLowerCase()}`;
    }
    return `${row.inputType}:${row.handle.toLowerCase()}`;
  });

  const missingInputCompetitors = parsedKeys.filter((key) => !candidateKeyToRow.has(key));
  addCheck(checks, {
    id: 'competitors.client_input_linkage',
    area: 'Competitors',
    title: 'Client-provided competitor links materialize into candidate profiles',
    severity: 'CRITICAL',
    passed: missingInputCompetitors.length === 0,
    details:
      missingInputCompetitors.length === 0
        ? [`all ${parsedKeys.length} intake competitors were materialized`]
        : missingInputCompetitors.map((key) => `missing candidate for intake key: ${key}`),
    recommendation:
      missingInputCompetitors.length > 0
        ? 'Run intake reseed and enforce deterministic parse + upsert for competitorInspirationLinks.'
        : undefined,
  });

  const linkedInputCandidates = parsedKeys
    .map((key) => candidateKeyToRow.get(key))
    .filter((row): row is (typeof candidates)[number] => Boolean(row));

  const wrongInputSource = linkedInputCandidates.filter((row) => row.source !== 'client_inspiration');
  addCheck(checks, {
    id: 'competitors.client_input_source',
    area: 'Competitors',
    title: 'Client-provided competitors keep source=client_inspiration',
    severity: 'HIGH',
    passed: wrongInputSource.length === 0,
    details:
      wrongInputSource.length === 0
        ? ['all linked intake competitors keep client_inspiration source']
        : wrongInputSource.map((row) => `${row.platform}:${row.handle} source=${row.source}`),
  });

  const eligibilityMismatches = linkedInputCandidates.filter((row) => {
    const expected = deriveCandidateEligibility({
      platformOrInputType: row.inputType || row.platform,
      availabilityStatus: row.availabilityStatus,
    });
    const sameInputType = (row.inputType || null) === (expected.inputType || null);
    const sameEligible = Boolean(row.scrapeEligible) === expected.scrapeEligible;
    const sameBlocker = (row.blockerReasonCode || null) === (expected.blockerReasonCode || null);
    return !sameInputType || !sameEligible || !sameBlocker;
  });

  addCheck(checks, {
    id: 'competitors.eligibility_flags',
    area: 'Competitors',
    title: 'Candidate eligibility fields are consistent (inputType/scrapeEligible/blockerReasonCode)',
    severity: 'CRITICAL',
    passed: eligibilityMismatches.length === 0,
    details:
      eligibilityMismatches.length === 0
        ? ['all intake-linked candidates have deterministic eligibility flags']
        : eligibilityMismatches.map(
            (row) =>
              `${row.platform}:${row.handle} inputType=${row.inputType || 'null'} scrapeEligible=${row.scrapeEligible} blocker=${row.blockerReasonCode || 'null'}`
          ),
    recommendation:
      eligibilityMismatches.length > 0
        ? 'Normalize candidate eligibility during persist and reseed old jobs to avoid scrape queue drop-offs.'
        : undefined,
  });

  const discoveredByCandidate = new Map<string, (typeof discovered)[number]>();
  const discoveredByPlatformHandle = new Map<string, (typeof discovered)[number]>();
  for (const row of discovered) {
    if (row.candidateProfileId) {
      discoveredByCandidate.set(row.candidateProfileId, row);
    }
    discoveredByPlatformHandle.set(normalizeKey(row.platform, row.handle), row);
  }

  const socialInputCandidates = linkedInputCandidates.filter((row) => isScrapePlatform(row.platform));
  const missingDiscoveredLinks = socialInputCandidates.filter((row) => {
    if (discoveredByCandidate.has(row.id)) return false;
    return !discoveredByPlatformHandle.has(normalizeKey(row.platform, row.handle));
  });

  addCheck(checks, {
    id: 'competitors.discovered_linkage',
    area: 'Competitors',
    title: 'Social client-input competitors are connected to discovered competitors for scrape orchestration',
    severity: 'HIGH',
    passed: missingDiscoveredLinks.length === 0,
    details:
      missingDiscoveredLinks.length === 0
        ? ['all social intake competitors have discovered linkage']
        : missingDiscoveredLinks.map((row) => `${row.platform}:${row.handle} is not materialized in discovered_competitors`),
  });

  const queueReadyCandidates = candidates.filter((row) => {
    if (!isScrapePlatform(row.platform)) return false;
    if (!row.scrapeEligible) return false;
    if (!['TOP_PICK', 'SHORTLISTED', 'APPROVED'].includes(row.state)) return false;
    if (row.availabilityStatus === 'PROFILE_UNAVAILABLE' || row.availabilityStatus === 'INVALID_HANDLE') return false;
    return true;
  });

  addCheck(checks, {
    id: 'competitors.queue_ready_presence',
    area: 'Competitors',
    title: 'At least one scrape-eligible competitor exists for downloader pipeline',
    severity: 'HIGH',
    passed: queueReadyCandidates.length > 0,
    details:
      queueReadyCandidates.length > 0
        ? [`queue-ready candidates: ${queueReadyCandidates.length}`]
        : ['no queue-ready candidates found (pipeline likely blocked before scrape/download)'],
    recommendation:
      queueReadyCandidates.length === 0
        ? 'Ensure candidate persist sets scrapeEligible=true for instagram/tiktok and materialize into discovered_competitors.'
        : undefined,
  });

  const foundCompetitorsCount = candidates.filter((row) => row.source !== 'client_inspiration').length;
  addCheck(checks, {
    id: 'competitors.discovery_coverage',
    area: 'Competitors',
    title: 'Competitor discovery adds non-client candidates',
    severity: 'MEDIUM',
    passed: foundCompetitorsCount > 0,
    details: [`non-client candidate count: ${foundCompetitorsCount}`],
  });

  const candidateKeys = new Set(candidates.map((row) => normalizeKey(row.platform, row.normalizedHandle || row.handle)));
  const discoveredKeys = new Set(discovered.map((row) => normalizeKey(row.platform, row.handle)));
  const unmatchedSnapshots = competitorSnapshots.filter((snapshot) => {
    const key = normalizeKey(snapshot.competitorProfile?.platform, snapshot.competitorProfile?.handle);
    return !candidateKeys.has(key) && !discoveredKeys.has(key);
  });

  addCheck(checks, {
    id: 'competitors.snapshot_lineage',
    area: 'Competitors',
    title: 'Scraped competitor snapshots map back to candidate/discovered lineage',
    severity: 'MEDIUM',
    passed: unmatchedSnapshots.length === 0,
    details:
      unmatchedSnapshots.length === 0
        ? ['all competitor snapshots have candidate/discovered lineage']
        : unmatchedSnapshots.map(
            (snapshot) =>
              `${snapshot.competitorProfile?.platform || 'unknown'}:${snapshot.competitorProfile?.handle || 'unknown'} readiness=${snapshot.readinessStatus || 'UNKNOWN'}`
          ),
  });

  // -----------------------------------------------------------------------
  // 13 Questions
  // -----------------------------------------------------------------------
  const questionByType = new Map(
    questions.map((row) => [row.questionType, row] as const)
  );

  const missingQuestions = REQUIRED_QUESTION_TYPES.filter((type) => {
    const row = questionByType.get(type);
    return !row || !row.isAnswered || !String(row.answer || '').trim();
  });

  addCheck(checks, {
    id: 'questions.required_13',
    area: 'Questions',
    title: 'All 13 strategic questions are answered with non-empty content',
    severity: 'CRITICAL',
    passed: missingQuestions.length === 0,
    details:
      missingQuestions.length === 0
        ? [`answered questions: ${REQUIRED_QUESTION_TYPES.length}/${REQUIRED_QUESTION_TYPES.length}`]
        : missingQuestions.map((type) => `missing or empty answer: ${type}`),
  });

  const q13 = questionByType.get('COMPETITOR_DISCOVERY_METHOD');
  const q13Validation = q13 ? validateQuestion13(q13.answerJson) : { ok: false, reason: 'question missing' };
  addCheck(checks, {
    id: 'questions.q13_json',
    area: 'Questions',
    title: 'Question 13 has strict policy JSON',
    severity: 'HIGH',
    passed: q13Validation.ok,
    details: [q13Validation.reason],
  });

  // -----------------------------------------------------------------------
  // 9 Docs + content analysis doc quality
  // -----------------------------------------------------------------------
  const finalRows = docs.filter(
    (row) => row.documentStatus === 'FINAL' || row.documentStatus == null
  );
  const draftRows = docs.filter((row) => row.documentStatus === 'DRAFT');

  const latestFinalByTopic = new Map<string, (typeof finalRows)[number]>();
  for (const row of finalRows) {
    const topic = String(row.topic || '').trim();
    if (!topic) continue;
    if (!latestFinalByTopic.has(topic)) {
      latestFinalByTopic.set(topic, row);
    }
  }

  const latestDraftByTopic = new Map<string, (typeof draftRows)[number]>();
  for (const row of draftRows) {
    const topic = String(row.topic || '').trim();
    if (!topic) continue;
    if (!latestDraftByTopic.has(topic)) {
      latestDraftByTopic.set(topic, row);
    }
  }

  const missingTopics = REQUIRED_DOCUMENT_TOPICS.filter((topic) => !latestFinalByTopic.has(topic));
  addCheck(checks, {
    id: 'docs.required_9',
    area: 'Docs',
    title: 'All 9 required strategy document topics are persisted as final',
    severity: 'CRITICAL',
    passed: missingTopics.length === 0,
    details:
      missingTopics.length === 0
        ? ['all required topics are present in final document set']
        : missingTopics.map((topic) => `missing final topic: ${topic}`),
  });

  const placeholderHits: string[] = [];
  const shortSections: string[] = [];
  const blockedGrounding: string[] = [];
  const readinessMissing: string[] = [];

  for (const topic of REQUIRED_DOCUMENT_TOPICS) {
    const row = latestFinalByTopic.get(topic);
    if (!row) continue;

    const text = toText(row.fullResponse).trim();
    if (text.length < 300) {
      shortSections.push(`${topic} (${text.length} chars)`);
    }
    if (hasPlaceholderOrDisclaimer(text)) {
      placeholderHits.push(topic);
    }

    const report = row.groundingReport as Record<string, unknown> | null;
    const blocked = Boolean(report && report.blocked);
    if (blocked) {
      blockedGrounding.push(topic);
    }

    const readiness = report && typeof report.readiness === 'object'
      ? (report.readiness as Record<string, unknown>)
      : null;
    const hasReadinessNumbers =
      readiness &&
      typeof readiness.clientReady === 'number' &&
      typeof readiness.competitorReady === 'number';
    if (!hasReadinessNumbers) {
      readinessMissing.push(topic);
    }
  }

  addCheck(checks, {
    id: 'docs.no_placeholder_language',
    area: 'Docs',
    title: 'Final docs avoid placeholders/disclaimer hallucination markers',
    severity: 'CRITICAL',
    passed: placeholderHits.length === 0,
    details:
      placeholderHits.length === 0
        ? ['no placeholder/disclaimer markers detected in final topics']
        : placeholderHits.map((topic) => `placeholder/disclaimer marker detected in ${topic}`),
  });

  addCheck(checks, {
    id: 'docs.grounding_blocked',
    area: 'Docs',
    title: 'Final docs are not marked blocked by grounding report',
    severity: 'HIGH',
    passed: blockedGrounding.length === 0,
    details:
      blockedGrounding.length === 0
        ? ['all final topics have blocked=false']
        : blockedGrounding.map((topic) => `groundingReport.blocked=true for ${topic}`),
  });

  addCheck(checks, {
    id: 'docs.readiness_in_grounding',
    area: 'Docs',
    title: 'Grounding reports include readiness metadata',
    severity: 'MEDIUM',
    passed: readinessMissing.length === 0,
    details:
      readinessMissing.length === 0
        ? ['all final topics include readiness metadata in grounding report']
        : readinessMissing.map((topic) => `missing readiness metadata for ${topic}`),
  });

  addCheck(checks, {
    id: 'docs.section_length_floor',
    area: 'Docs',
    title: 'Final docs are sufficiently detailed (minimum section length)',
    severity: 'MEDIUM',
    passed: shortSections.length === 0,
    details:
      shortSections.length === 0
        ? ['all required final topics exceed minimum content length']
        : shortSections,
  });

  const staleDraftTopics: string[] = [];
  for (const topic of REQUIRED_DOCUMENT_TOPICS) {
    const latestFinal = latestFinalByTopic.get(topic);
    const latestDraft = latestDraftByTopic.get(topic);
    if (!latestFinal || !latestDraft) continue;
    if (new Date(latestDraft.analyzedAt).getTime() > new Date(latestFinal.analyzedAt).getTime()) {
      staleDraftTopics.push(topic);
    }
  }

  addCheck(checks, {
    id: 'docs.latest_final_preferred',
    area: 'Docs',
    title: 'No topic has a newer draft than final',
    severity: 'HIGH',
    passed: staleDraftTopics.length === 0,
    details:
      staleDraftTopics.length === 0
        ? ['final topics are not superseded by newer drafts']
        : staleDraftTopics.map((topic) => `newer draft exists for ${topic}`),
  });

  const contentAnalysisDoc = latestFinalByTopic.get('content_analysis');
  const contentAnalysisText = contentAnalysisDoc ? toText(contentAnalysisDoc.fullResponse) : '';
  addCheck(checks, {
    id: 'content_analysis.evidence_signals',
    area: 'Content Analysis',
    title: 'Content analysis doc includes evidence/metrics signals',
    severity: 'HIGH',
    passed: contentAnalysisText.length > 0 && hasContentEvidenceSignals(contentAnalysisText),
    details:
      contentAnalysisText.length > 0 && hasContentEvidenceSignals(contentAnalysisText)
        ? ['content_analysis section contains explicit evidence markers']
        : ['content_analysis section missing evidence markers (gaps/opportunities/metrics/handles)'],
  });

  const mediaAnalysisTotal = mediaAnalysisCounts.reduce((sum, row) => sum + row._count._all, 0);
  const scopedMediaAnalysisTotal = scopedMediaAnalysisRows.length;
  const unscopedMediaAnalysisTotal = unscopedMediaAnalysisRows.length;
  addCheck(checks, {
    id: 'content_analysis.media_ai_presence',
    area: 'Content Analysis',
    title: 'Scoped media AI analyses exist to support prompt-building quality',
    severity: 'MEDIUM',
    passed: scopedMediaAnalysisTotal > 0,
    details:
      scopedMediaAnalysisTotal > 0
        ? [
            `scoped media ai_analyses count: ${scopedMediaAnalysisTotal}`,
            `unscoped media ai_analyses count: ${unscopedMediaAnalysisTotal}`,
            `total media ai_analyses count: ${mediaAnalysisTotal}`,
            `qualified media asset IDs: ${qualifiedMediaAssetIds.size}`,
          ]
        : [
            `no scoped media ai_analyses rows found (qualified assets: ${qualifiedMediaAssetIds.size})`,
            `unscoped media ai_analyses count: ${unscopedMediaAnalysisTotal}`,
            `total media ai_analyses count: ${mediaAnalysisTotal}`,
          ],
    recommendation:
      scopedMediaAnalysisTotal === 0
        ? 'Run /analyze-media after readiness scoring so ai_analyses are created on qualified snapshot media assets.'
        : undefined,
  });

  addCheck(checks, {
    id: 'content_analysis.media_ai_scope_isolation',
    area: 'Content Analysis',
    title: 'Media AI analyses are isolated to qualified snapshot media scope',
    severity: 'MEDIUM',
    passed: unscopedMediaAnalysisTotal === 0,
    details:
      unscopedMediaAnalysisTotal === 0
        ? ['no out-of-scope media ai_analyses rows detected']
        : [
            `out-of-scope media ai_analyses rows: ${unscopedMediaAnalysisTotal}`,
            `scoped media ai_analyses rows: ${scopedMediaAnalysisTotal}`,
            'legacy social-post media analyses should be excluded from prompt/context/calendars',
          ],
    recommendation:
      unscopedMediaAnalysisTotal > 0
        ? 'Backfill scoped analyses and optionally purge legacy social-post ai_analyses to keep dashboards noise-free.'
        : undefined,
  });

  if (!latestMediaAnalysisRun) {
    addCheck(checks, {
      id: 'content_analysis.scope_metrics_run_exists',
      area: 'Content Analysis',
      title: 'Latest media analysis run scope counters are persisted',
      severity: 'LOW',
      passed: true,
      details: ['no media_analysis_runs rows yet (this is acceptable before first /analyze-media run)'],
    });
  } else {
    const monotonic =
      latestMediaAnalysisRun.downloadedTotal >= latestMediaAnalysisRun.analysisWindow &&
      latestMediaAnalysisRun.qualifiedForAi >= latestMediaAnalysisRun.analysisWindow &&
      latestMediaAnalysisRun.analyzedInWindow <= latestMediaAnalysisRun.analysisWindow &&
      latestMediaAnalysisRun.attemptedAssets <= latestMediaAnalysisRun.analysisWindow &&
      latestMediaAnalysisRun.succeededCount + latestMediaAnalysisRun.failedCount <=
        latestMediaAnalysisRun.attemptedAssets;
    addCheck(checks, {
      id: 'content_analysis.scope_metrics_consistency',
      area: 'Content Analysis',
      title: 'Latest media analysis run scope counters are internally consistent',
      severity: 'MEDIUM',
      passed: monotonic,
      details: [
        `runId=${latestMediaAnalysisRun.id} status=${latestMediaAnalysisRun.status}`,
        `downloadedTotal=${latestMediaAnalysisRun.downloadedTotal}`,
        `qualifiedForAi=${latestMediaAnalysisRun.qualifiedForAi}`,
        `analysisWindow=${latestMediaAnalysisRun.analysisWindow}`,
        `analyzedInWindow=${latestMediaAnalysisRun.analyzedInWindow}`,
        `attemptedAssets=${latestMediaAnalysisRun.attemptedAssets}, succeeded=${latestMediaAnalysisRun.succeededCount}, failed=${latestMediaAnalysisRun.failedCount}`,
        `skippedReason=${latestMediaAnalysisRun.skippedReason || 'n/a'}`,
      ],
      recommendation: monotonic
        ? undefined
        : 'Re-run /analyze-media and verify media_analysis_runs counters update correctly (downloaded >= qualified >= window >= analyzed).',
    });
  }

  // -----------------------------------------------------------------------
  // Content Calendar + slot evidence + post linkage
  // -----------------------------------------------------------------------
  if (!latestCalendarRun) {
    addCheck(checks, {
      id: 'calendar.run_exists',
      area: 'Calendar',
      title: 'At least one content calendar run exists',
      severity: 'CRITICAL',
      passed: false,
      details: ['no content_calendar_runs rows found'],
      recommendation: 'Generate calendar only after docs + readiness are green.',
    });
  } else {
    const run = latestCalendarRun;
    const schedule =
      run.contentCalendarJson && typeof run.contentCalendarJson === 'object'
        ? ((run.contentCalendarJson as Record<string, unknown>).schedule as Array<Record<string, unknown>> | undefined) || []
        : [];
    const briefUsedPostIds =
      run.calendarBriefJson && typeof run.calendarBriefJson === 'object'
        ? new Set(
            ((((run.calendarBriefJson as Record<string, unknown>).usedPostIds as unknown[]) || [])
              .map((id) => String(id || '').trim())
              .filter(Boolean))
          )
        : new Set<string>();

    addCheck(checks, {
      id: 'calendar.slot_count',
      area: 'Calendar',
      title: 'Latest run has persisted slots and schedule shape',
      severity: 'CRITICAL',
      passed: run.slots.length > 0 && schedule.length === run.slots.length,
      details: [
        `db slots: ${run.slots.length}`,
        `json schedule: ${schedule.length}`,
      ],
    });

    const readyClientSnapshotIds = readyClientSnapshots.map((row) => row.id);
    const readyCompetitorSnapshotIds = readyCompetitorSnapshots.map((row) => row.id);

    const [validClientPosts, validCompetitorPosts] = await Promise.all([
      prisma.clientPostSnapshot.findMany({
        where: {
          clientProfileSnapshot: { researchJobId: jobId },
        },
        select: {
          id: true,
          likesCount: true,
          viewsCount: true,
          playsCount: true,
          mediaAssets: { select: { id: true, isDownloaded: true } },
        },
      }),
      prisma.competitorPostSnapshot.findMany({
        where: {
          competitorProfileSnapshot: { researchJobId: jobId },
        },
        select: {
          id: true,
          likesCount: true,
          viewsCount: true,
          playsCount: true,
          mediaAssets: { select: { id: true, isDownloaded: true } },
        },
      }),
    ]);

    const validPostIds = new Set<string>([
      ...validClientPosts.map((row) => row.id),
      ...validCompetitorPosts.map((row) => row.id),
    ]);

    const postMetricMap = new Map<string, { hasMetrics: boolean; hasDownloadedMedia: boolean }>();
    for (const row of validClientPosts) {
      postMetricMap.set(row.id, {
        hasMetrics: Number(row.likesCount || 0) > 0 || Number(row.viewsCount || row.playsCount || 0) > 0,
        hasDownloadedMedia: row.mediaAssets.some((asset) => asset.isDownloaded),
      });
    }
    for (const row of validCompetitorPosts) {
      postMetricMap.set(row.id, {
        hasMetrics: Number(row.likesCount || 0) > 0 || Number(row.viewsCount || row.playsCount || 0) > 0,
        hasDownloadedMedia: row.mediaAssets.some((asset) => asset.isDownloaded),
      });
    }

    const invalidSlotCore: string[] = [];
    const missingInspirationForNonBlocked: string[] = [];
    const blockedWithoutReason: string[] = [];
    const unknownInspirationIds = new Set<string>();
    const missingFromBriefUsed = new Set<string>();
    const inspirationNoMetrics = new Set<string>();
    const inspirationNoDownloadedMedia = new Set<string>();

    for (const slot of run.slots) {
      if (!slot.platform || !slot.contentType || !slot.scheduledAt) {
        invalidSlotCore.push(`slotIndex=${slot.slotIndex}`);
      }

      const inspirationIds = Array.isArray(slot.inspirationPostIds) ? slot.inspirationPostIds : [];
      const isBlocked = slot.status === CalendarSlotStatus.BLOCKED;

      if (!isBlocked && inspirationIds.length === 0) {
        missingInspirationForNonBlocked.push(`slotIndex=${slot.slotIndex} status=${slot.status}`);
      }
      if (isBlocked && !String(slot.blockReason || '').trim()) {
        blockedWithoutReason.push(`slotIndex=${slot.slotIndex}`);
      }

      for (const postId of inspirationIds) {
        if (!validPostIds.has(postId)) {
          unknownInspirationIds.add(postId);
          continue;
        }
        if (!briefUsedPostIds.has(postId)) {
          missingFromBriefUsed.add(postId);
        }
        const metrics = postMetricMap.get(postId);
        if (!metrics?.hasMetrics) {
          inspirationNoMetrics.add(postId);
        }
        if (!metrics?.hasDownloadedMedia) {
          inspirationNoDownloadedMedia.add(postId);
        }
      }
    }

    addCheck(checks, {
      id: 'calendar.slot_core_fields',
      area: 'Calendar',
      title: 'Calendar slots have valid core fields',
      severity: 'CRITICAL',
      passed: invalidSlotCore.length === 0,
      details: invalidSlotCore.length === 0 ? ['all slots include platform/contentType/scheduledAt'] : invalidSlotCore,
    });

    addCheck(checks, {
      id: 'calendar.nonblocked_inspiration',
      area: 'Calendar',
      title: 'Non-blocked slots always include inspiration evidence',
      severity: 'CRITICAL',
      passed: missingInspirationForNonBlocked.length === 0,
      details:
        missingInspirationForNonBlocked.length === 0
          ? ['all non-blocked slots include inspirationPostIds']
          : missingInspirationForNonBlocked,
    });

    addCheck(checks, {
      id: 'calendar.block_reason',
      area: 'Calendar',
      title: 'Blocked slots include explicit block reason',
      severity: 'HIGH',
      passed: blockedWithoutReason.length === 0,
      details: blockedWithoutReason.length === 0 ? ['all blocked slots include blockReason'] : blockedWithoutReason,
    });

    if (unknownInspirationIds.size > 0) {
      const ids = Array.from(unknownInspirationIds);
      const [clientOtherJobs, competitorOtherJobs] = await Promise.all([
        prisma.clientPostSnapshot.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            clientProfileSnapshot: { select: { researchJobId: true } },
          },
        }),
        prisma.competitorPostSnapshot.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            competitorProfileSnapshot: { select: { researchJobId: true } },
          },
        }),
      ]);

      const crossJobIds = new Set<string>();
      for (const row of clientOtherJobs) {
        if (row.clientProfileSnapshot?.researchJobId !== jobId) crossJobIds.add(row.id);
      }
      for (const row of competitorOtherJobs) {
        if (row.competitorProfileSnapshot?.researchJobId !== jobId) crossJobIds.add(row.id);
      }

      addCheck(checks, {
        id: 'calendar.inspiration_job_scope',
        area: 'Calendar',
        title: 'Calendar inspiration post IDs stay inside the same research job',
        severity: 'CRITICAL',
        passed: crossJobIds.size === 0,
        details:
          crossJobIds.size === 0
            ? ['no cross-job inspiration references detected']
            : Array.from(crossJobIds).map((id) => `cross-job post reference: ${id}`),
      });

      const unknownOnly = ids.filter((id) => !crossJobIds.has(id));
      addCheck(checks, {
        id: 'calendar.inspiration_exists',
        area: 'Calendar',
        title: 'Calendar inspiration post IDs exist in snapshots',
        severity: 'CRITICAL',
        passed: unknownOnly.length === 0,
        details:
          unknownOnly.length === 0
            ? ['all inspiration post IDs resolve to snapshot posts']
            : unknownOnly.map((id) => `unknown inspiration post ID: ${id}`),
      });
    } else {
      addCheck(checks, {
        id: 'calendar.inspiration_job_scope',
        area: 'Calendar',
        title: 'Calendar inspiration post IDs stay inside the same research job',
        severity: 'CRITICAL',
        passed: true,
        details: ['no cross-job inspiration references detected'],
      });
      addCheck(checks, {
        id: 'calendar.inspiration_exists',
        area: 'Calendar',
        title: 'Calendar inspiration post IDs exist in snapshots',
        severity: 'CRITICAL',
        passed: true,
        details: ['all inspiration post IDs resolve to snapshot posts'],
      });
    }

    addCheck(checks, {
      id: 'calendar.brief_used_post_ids',
      area: 'Calendar',
      title: 'Calendar slot references remain in Stage 1 usedPostIds set',
      severity: 'MEDIUM',
      passed: missingFromBriefUsed.size === 0,
      details:
        missingFromBriefUsed.size === 0
          ? ['all inspiration IDs are present in calendarBrief.usedPostIds']
          : Array.from(missingFromBriefUsed).map((id) => `missing in usedPostIds: ${id}`),
    });

    addCheck(checks, {
      id: 'calendar.inspiration_metrics',
      area: 'Calendar',
      title: 'Inspiration posts include engagement metrics',
      severity: 'MEDIUM',
      passed: inspirationNoMetrics.size === 0,
      details:
        inspirationNoMetrics.size === 0
          ? ['all inspiration posts include likes/views metrics']
          : Array.from(inspirationNoMetrics).map((id) => `missing metrics on inspiration post: ${id}`),
    });

    addCheck(checks, {
      id: 'calendar.inspiration_downloaded_media',
      area: 'Calendar',
      title: 'Inspiration posts have downloaded media assets',
      severity: 'MEDIUM',
      passed: inspirationNoDownloadedMedia.size === 0,
      details:
        inspirationNoDownloadedMedia.size === 0
          ? ['all inspiration posts have downloaded media']
          : Array.from(inspirationNoDownloadedMedia).map((id) => `no downloaded media for inspiration post: ${id}`),
    });

    const diagnostics = (run.diagnostics || {}) as Record<string, unknown>;
    const usedFallback = Boolean(diagnostics.usedFallback);
    const fallbackSafe = run.slots.every((slot) => {
      if (slot.status === CalendarSlotStatus.BLOCKED) {
        return Boolean(String(slot.blockReason || '').trim());
      }
      return Array.isArray(slot.inspirationPostIds) && slot.inspirationPostIds.length > 0;
    });
    addCheck(checks, {
      id: 'calendar.processor_fallback',
      area: 'Calendar',
      title: 'Fallback stage (if used) still yields evidence-complete slots',
      severity: 'MEDIUM',
      passed: !usedFallback || fallbackSafe,
      details: [
        !usedFallback
          ? 'latest run generated without fallback brief'
          : fallbackSafe
            ? 'latest run used fallback brief, but slot evidence/blocking integrity is valid'
            : 'latest run used fallback brief and slot evidence integrity is invalid',
      ],
    });
  }

  // -----------------------------------------------------------------------
  // Downloader + readiness coverage
  // -----------------------------------------------------------------------
  const readyClientSnapshotIds = readyClientSnapshots.map((row) => row.id);
  const readyCompetitorSnapshotIds = readyCompetitorSnapshots.map((row) => row.id);

  const [
    clientPostsTotal,
    clientPostsWithDownloadedMedia,
    competitorPostsTotal,
    competitorPostsWithDownloadedMedia,
    clientDownloadedMediaAssets,
    competitorDownloadedMediaAssets,
  ] = await Promise.all([
    readyClientSnapshotIds.length > 0
      ? prisma.clientPostSnapshot.count({
          where: { clientProfileSnapshotId: { in: readyClientSnapshotIds } },
        })
      : Promise.resolve(0),
    readyClientSnapshotIds.length > 0
      ? prisma.clientPostSnapshot.count({
          where: {
            clientProfileSnapshotId: { in: readyClientSnapshotIds },
            mediaAssets: { some: { isDownloaded: true } },
          },
        })
      : Promise.resolve(0),
    readyCompetitorSnapshotIds.length > 0
      ? prisma.competitorPostSnapshot.count({
          where: { competitorProfileSnapshotId: { in: readyCompetitorSnapshotIds } },
        })
      : Promise.resolve(0),
    readyCompetitorSnapshotIds.length > 0
      ? prisma.competitorPostSnapshot.count({
          where: {
            competitorProfileSnapshotId: { in: readyCompetitorSnapshotIds },
            mediaAssets: { some: { isDownloaded: true } },
          },
        })
      : Promise.resolve(0),
    prisma.mediaAsset.count({
      where: {
        isDownloaded: true,
        clientPostSnapshot: {
          clientProfileSnapshot: { researchJobId: jobId },
        },
      },
    }),
    prisma.mediaAsset.count({
      where: {
        isDownloaded: true,
        competitorPostSnapshot: {
          competitorProfileSnapshot: { researchJobId: jobId },
        },
      },
    }),
  ]);

  const clientCoverage =
    clientPostsTotal > 0 ? clientPostsWithDownloadedMedia / clientPostsTotal : 0;
  const competitorCoverage =
    competitorPostsTotal > 0
      ? competitorPostsWithDownloadedMedia / competitorPostsTotal
      : 0;

  addCheck(checks, {
    id: 'downloader.client_ready_coverage',
    area: 'Downloader',
    title: 'Client READY snapshots have strong media download coverage',
    severity: 'HIGH',
    passed:
      readyClientSnapshotIds.length === 0
        ? false
        : clientPostsTotal === 0
          ? false
          : clientCoverage >= 0.5,
    details: [
      `ready client snapshots: ${readyClientSnapshotIds.length}`,
      `client posts (READY snapshots): ${clientPostsWithDownloadedMedia}/${clientPostsTotal}`,
      `coverage ratio: ${(clientCoverage * 100).toFixed(1)}%`,
      `downloaded client media assets: ${clientDownloadedMediaAssets}`,
    ],
    recommendation:
      readyClientSnapshotIds.length === 0 || clientCoverage < 0.5
        ? 'Re-run downloader for READY client snapshots before generating analysis/docs.'
        : undefined,
  });

  addCheck(checks, {
    id: 'downloader.competitor_ready_coverage',
    area: 'Downloader',
    title: 'Competitor READY snapshots have usable media download coverage',
    severity: 'HIGH',
    passed:
      readyCompetitorSnapshotIds.length === 0
        ? false
        : competitorPostsTotal === 0
          ? false
          : competitorCoverage >= 0.35,
    details: [
      `ready competitor snapshots: ${readyCompetitorSnapshotIds.length}`,
      `competitor posts (READY snapshots): ${competitorPostsWithDownloadedMedia}/${competitorPostsTotal}`,
      `coverage ratio: ${(competitorCoverage * 100).toFixed(1)}%`,
      `downloaded competitor media assets: ${competitorDownloadedMediaAssets}`,
    ],
    recommendation:
      readyCompetitorSnapshotIds.length === 0 || competitorCoverage < 0.35
        ? 'Increase scrape + downloader completion for competitor snapshots used in prompts/calendar.'
        : undefined,
  });

  // -----------------------------------------------------------------------
  // Prompt guardrails + prompt modifiability
  // -----------------------------------------------------------------------
  const [
    calendarPromptFile,
    baseGeneratorFile,
    systemPromptFile,
    contentCalendarRouteFile,
    runJobMediaAnalysisFile,
    contentCalendarContextFile,
  ] = promptFiles;

  const missingPromptGuards: string[] = [];

  if (!calendarPromptFile.includes('MISSING_INSPIRATION_EVIDENCE')) {
    missingPromptGuards.push('content-calendar-prompts.ts missing MISSING_INSPIRATION_EVIDENCE rule');
  }
  if (!calendarPromptFile.includes('OUTPUT JSON ONLY')) {
    missingPromptGuards.push('content-calendar-prompts.ts missing OUTPUT JSON ONLY constraints');
  }
  if (!calendarPromptFile.includes('Evidence:')) {
    missingPromptGuards.push('content-calendar-prompts.ts missing slot Evidence block requirement');
  }
  if (!baseGeneratorFile.includes('Never output placeholders')) {
    missingPromptGuards.push('base-generator.ts missing global placeholder hard-stop');
  }
  if (!systemPromptFile.includes('DO NOT FABRICATE')) {
    missingPromptGuards.push('system-prompts.ts missing anti-fabrication language');
  }
  if (!systemPromptFile.includes('SKIP this subsection entirely')) {
    missingPromptGuards.push('system-prompts.ts missing skip-subsection rule for missing data');
  }
  if (!contentCalendarRouteFile.includes('creativePromptOverride')) {
    missingPromptGuards.push('content-calendar route missing editable creativePrompt override wiring');
  }
  if (!contentCalendarRouteFile.includes("source: 'user_edited_prompt'")) {
    missingPromptGuards.push('content-calendar route missing prompt provenance marker user_edited_prompt');
  }
  if (!runJobMediaAnalysisFile.includes('buildQualifiedContentPool')) {
    missingPromptGuards.push('run-job-media-analysis.ts missing qualified content pool gate');
  }
  if (!contentCalendarContextFile.includes('buildQualifiedContentPool')) {
    missingPromptGuards.push('content-calendar-context.ts missing qualified content pool gate');
  }

  addCheck(checks, {
    id: 'prompts.guardrails_and_modifiable',
    area: 'Prompts',
    title: 'Prompt files include anti-hallucination guardrails and editable slot prompt flow',
    severity: 'HIGH',
    passed: missingPromptGuards.length === 0,
    details:
      missingPromptGuards.length === 0
        ? ['all required prompt guardrails and modifiable prompt hooks are present']
        : missingPromptGuards,
  });

  // -----------------------------------------------------------------------
  // DB schema linkage checks across pipeline entities
  // -----------------------------------------------------------------------
  const [discoveredWithCandidate, mediaAssetsForJob, mediaAnalysesWithAssets, contentDrafts] =
    await Promise.all([
      prisma.discoveredCompetitor.findMany({
        where: { researchJobId: jobId },
        select: {
          id: true,
          platform: true,
          handle: true,
          candidateProfileId: true,
          candidateProfile: {
            select: {
              id: true,
              researchJobId: true,
            },
          },
        },
      }),
      prisma.mediaAsset.findMany({
        where: {
          OR: [
            {
              clientPostSnapshot: {
                clientProfileSnapshot: { researchJobId: jobId },
              },
            },
            {
              competitorPostSnapshot: {
                competitorProfileSnapshot: { researchJobId: jobId },
              },
            },
          ],
        },
        select: {
          id: true,
          sourceType: true,
          clientPostSnapshotId: true,
          competitorPostSnapshotId: true,
        },
      }),
      prisma.aiAnalysis.findMany({
        where: {
          researchJobId: jobId,
          mediaAssetId: { not: null },
        },
        select: {
          id: true,
          mediaAssetId: true,
          mediaAsset: {
            select: {
              id: true,
              clientPostId: true,
              cleanedPostId: true,
              socialPostId: true,
              clientPostSnapshot: {
                select: {
                  clientProfileSnapshot: { select: { researchJobId: true } },
                },
              },
              competitorPostSnapshot: {
                select: {
                  competitorProfileSnapshot: { select: { researchJobId: true } },
                },
              },
            },
          },
        },
      }),
      prisma.contentDraft.findMany({
        where: {
          slot: {
            calendarRun: { researchJobId: jobId },
          },
        },
        select: {
          id: true,
          usedInspirationPostIds: true,
          slot: { select: { inspirationPostIds: true } },
        },
      }),
    ]);

  const brokenDiscoveredLinks = discoveredWithCandidate.filter((row) => {
    if (!isScrapePlatform(row.platform)) return false;
    if (!row.candidateProfileId) return true;
    if (!row.candidateProfile) return true;
    return row.candidateProfile.researchJobId !== jobId;
  });

  addCheck(checks, {
    id: 'db.discovered_candidate_fk',
    area: 'DB Links',
    title: 'discovered_competitors rows keep valid candidateProfile linkage',
    severity: 'CRITICAL',
    passed: brokenDiscoveredLinks.length === 0,
    details:
      brokenDiscoveredLinks.length === 0
        ? ['all scrape-surface discovered competitors are linked to candidate profiles in same job']
        : brokenDiscoveredLinks.map(
            (row) => `${row.platform}:${row.handle} candidateProfileId=${row.candidateProfileId || 'null'}`
          ),
  });

  const invalidMediaLinks = mediaAssetsForJob.filter((asset) => {
    if (asset.clientPostSnapshotId && asset.competitorPostSnapshotId) return true;
    if (asset.sourceType === 'CLIENT_POST_SNAPSHOT' && !asset.clientPostSnapshotId) return true;
    if (asset.sourceType === 'COMPETITOR_POST_SNAPSHOT' && !asset.competitorPostSnapshotId) return true;
    return false;
  });

  addCheck(checks, {
    id: 'db.media_source_integrity',
    area: 'DB Links',
    title: 'media_assets source linkage is internally consistent',
    severity: 'HIGH',
    passed: invalidMediaLinks.length === 0,
    details:
      invalidMediaLinks.length === 0
        ? ['media assets have consistent sourceType and snapshot linkage']
        : invalidMediaLinks.map((asset) => `mediaAsset=${asset.id} sourceType=${asset.sourceType || 'null'}`),
  });

  const mediaAnalysisCrossJob = mediaAnalysesWithAssets.filter((row) => {
    const asset = row.mediaAsset;
    if (!asset) return true;

    const clientJobId = asset.clientPostSnapshot?.clientProfileSnapshot?.researchJobId || null;
    const competitorJobId =
      asset.competitorPostSnapshot?.competitorProfileSnapshot?.researchJobId || null;

    const hasLegacyLink = Boolean(asset.clientPostId || asset.cleanedPostId || asset.socialPostId);

    if (clientJobId && clientJobId !== jobId) return true;
    if (competitorJobId && competitorJobId !== jobId) return true;
    if (!clientJobId && !competitorJobId && !hasLegacyLink) return true;
    return false;
  });

  const mediaAnalysisCrossJobDetails = mediaAnalysisCrossJob
    .slice(0, 40)
    .map(
      (row) => `analysis=${row.id} mediaAsset=${row.mediaAssetId || 'null'} cross-job or unlinked`
    );
  if (mediaAnalysisCrossJob.length > 40) {
    mediaAnalysisCrossJobDetails.push(`...and ${mediaAnalysisCrossJob.length - 40} more`);
  }

  addCheck(checks, {
    id: 'db.analysis_media_scope',
    area: 'DB Links',
    title: 'media ai_analyses rows reference media assets in same job scope',
    severity: 'CRITICAL',
    passed: mediaAnalysisCrossJob.length === 0,
    details:
      mediaAnalysisCrossJob.length === 0
        ? ['media analyses stay within job media scope']
        : mediaAnalysisCrossJobDetails,
  });

  const draftInspirationMismatch = contentDrafts.filter((draft) => {
    const slotIds = new Set((draft.slot.inspirationPostIds || []).map((id) => String(id || '').trim()));
    return (draft.usedInspirationPostIds || []).some((id) => !slotIds.has(String(id || '').trim()));
  });

  addCheck(checks, {
    id: 'db.draft_slot_inspiration',
    area: 'DB Links',
    title: 'content_drafts inspiration IDs stay aligned with slot inspiration IDs',
    severity: 'MEDIUM',
    passed: draftInspirationMismatch.length === 0,
    details:
      draftInspirationMismatch.length === 0
        ? ['all content drafts inherit valid inspiration IDs from their slots']
        : draftInspirationMismatch.map((draft) => `draft=${draft.id} has out-of-slot inspiration IDs`),
  });

  return checks;
}

function buildSummary(checks: CheckResult) {
  return checks;
}

function renderReport(input: {
  generatedAt: string;
  job: {
    id: string;
    status: string;
    startedAt: Date | null;
    clientName: string;
    clientId: string;
  };
  args: Args;
  fixLogs: string[];
  checks: CheckResult[];
}): string {
  const bySeverity: Record<Severity, { total: number; failed: number }> = {
    CRITICAL: { total: 0, failed: 0 },
    HIGH: { total: 0, failed: 0 },
    MEDIUM: { total: 0, failed: 0 },
    LOW: { total: 0, failed: 0 },
  };
  for (const check of input.checks) {
    bySeverity[check.severity].total += 1;
    if (!check.passed) bySeverity[check.severity].failed += 1;
  }

  const failed = input.checks.filter((check) => !check.passed);
  const passed = input.checks.length - failed.length;

  const lines: string[] = [];
  lines.push(`# Workflow Integrity Report`);
  lines.push('');
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push(`Job: ${input.job.id}`);
  lines.push(`Client: ${input.job.clientName} (${input.job.clientId})`);
  lines.push(`Job status: ${input.job.status}`);
  lines.push(`Started at: ${input.job.startedAt ? input.job.startedAt.toISOString() : 'null'}`);
  lines.push(`Strict mode: ${input.args.strict}`);
  lines.push(`Fix competitor pipeline before test: ${input.args.fixCompetitorPipeline}`);
  lines.push('');

  if (input.fixLogs.length > 0) {
    lines.push('## Applied Fixes');
    for (const log of input.fixLogs) {
      lines.push(`- ${log}`);
    }
    lines.push('');
  }

  lines.push('## Summary');
  lines.push(`- Checks passed: ${passed}/${input.checks.length}`);
  lines.push(`- Checks failed: ${failed.length}`);
  lines.push(`- Critical failures: ${bySeverity.CRITICAL.failed}`);
  lines.push(`- High failures: ${bySeverity.HIGH.failed}`);
  lines.push(`- Medium failures: ${bySeverity.MEDIUM.failed}`);
  lines.push(`- Low failures: ${bySeverity.LOW.failed}`);
  lines.push('');

  lines.push('## Severity Breakdown');
  lines.push('| Severity | Failed | Total |');
  lines.push('|---|---:|---:|');
  lines.push(`| CRITICAL | ${bySeverity.CRITICAL.failed} | ${bySeverity.CRITICAL.total} |`);
  lines.push(`| HIGH | ${bySeverity.HIGH.failed} | ${bySeverity.HIGH.total} |`);
  lines.push(`| MEDIUM | ${bySeverity.MEDIUM.failed} | ${bySeverity.MEDIUM.total} |`);
  lines.push(`| LOW | ${bySeverity.LOW.failed} | ${bySeverity.LOW.total} |`);
  lines.push('');

  const areaOrder = [
    'Competitors',
    'Questions',
    'Docs',
    'Content Analysis',
    'Calendar',
    'Downloader',
    'Prompts',
    'DB Links',
  ];

  for (const area of areaOrder) {
    const areaChecks = input.checks.filter((check) => check.area === area);
    if (areaChecks.length === 0) continue;

    lines.push(`## ${area}`);
    for (const check of areaChecks) {
      lines.push(
        `- [${check.passed ? 'PASS' : 'FAIL'}] (${check.severity}) ${check.title}`
      );
      for (const detail of check.details) {
        lines.push(`  - ${detail}`);
      }
      if (check.recommendation) {
        lines.push(`  - recommendation: ${check.recommendation}`);
      }
    }
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push('## Priority Fix Queue');
    const ordered = [...failed].sort((a, b) => {
      const rank: Record<Severity, number> = {
        CRITICAL: 4,
        HIGH: 3,
        MEDIUM: 2,
        LOW: 1,
      };
      return rank[b.severity] - rank[a.severity];
    });
    for (const check of ordered) {
      lines.push(`- (${check.severity}) ${check.id}: ${check.title}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs();
  const job = await resolveTargetJob(args.jobId, args.includeUmmah);

  const fixLogs: string[] = [];
  if (args.fixCompetitorPipeline) {
    fixLogs.push(...(await maybeApplyCompetitorFixes(job)));
  }

  const checks = await runChecks(job);

  const failedCritical = checks.filter(
    (check) => !check.passed && check.severity === 'CRITICAL'
  ).length;
  const failedHigh = checks.filter(
    (check) => !check.passed && check.severity === 'HIGH'
  ).length;
  const failedTotal = checks.filter((check) => !check.passed).length;

  const report = renderReport({
    generatedAt: new Date().toISOString(),
    job: {
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      clientName: job.client?.name || '(no client)',
      clientId: job.client?.id || '(unknown)',
    },
    args,
    fixLogs,
    checks,
  });

  const outputPath = args.outPath ? path.resolve(args.outPath) : defaultOutputPath(job.id);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, report, 'utf8');

  console.log(`[WorkflowIntegrity] Report written: ${outputPath}`);
  console.log(
    `[WorkflowIntegrity] Result: failed=${failedTotal}, critical=${failedCritical}, high=${failedHigh}`
  );

  if (args.strict && (failedCritical > 0 || failedHigh > 0)) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('[WorkflowIntegrity] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
