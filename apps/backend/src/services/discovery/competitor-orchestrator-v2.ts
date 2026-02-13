import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { emitResearchJobEvent } from '../social/research-job-events';
import { collectCompetitorCandidates } from './competitor-collector';
import { ConnectorHealthTracker } from './connector-health';
import {
  buildCompetitorDiscoveryPolicy,
  CompetitorDiscoveryMethodAnswerJson,
} from './competitor-policy-engine';
import { buildIdentityGroupedShortlist, approveAndQueueCandidates, continueQueueFromCandidates, persistOrchestrationCandidates } from './competitor-materializer';
import { buildPointyCompetitorQueryPlan, DiscoveryPrecision } from './competitor-query-composer';
import { sanitizeDiscoveryContext } from './discovery-context-sanitizer';
import { detectPlatformMatrix, CompetitorSurface } from './competitor-platform-detector';
import { resolveCandidateAvailability } from './competitor-resolver';
import { scoreCompetitorCandidates } from './competitor-scorer';

export type OrchestrationMode = 'append' | 'replace';
export type ConnectorPolicy = 'ddg_first_pluggable';

export interface CompetitorOrchestrationV2Input {
  mode?: OrchestrationMode;
  targetCount?: number;
  surfaces?: CompetitorSurface[];
  platforms?: CompetitorSurface[]; // Backward-compatible alias.
  // Backward-compatible alias from legacy routes; ignored by V2 planning.
  sources?: Array<'algorithmic' | 'direct' | 'ai'>;
  precision?: DiscoveryPrecision;
  connectorPolicy?: ConnectorPolicy;
}

export interface CompetitorOrchestrationV2Summary {
  candidatesDiscovered: number;
  candidatesFiltered: number;
  shortlisted: number;
  topPicks: number;
  profileUnavailableCount: number;
}

export interface CompetitorOrchestrationV2Response {
  runId: string;
  summary: CompetitorOrchestrationV2Summary;
  platformMatrix: ReturnType<typeof normalizePlatformMatrixForApi>;
  diagnostics: Record<string, unknown>;
}

export interface CompetitorShortlistV2Response {
  runId: string | null;
  controlMode?: 'auto' | 'manual';
  summary: CompetitorOrchestrationV2Summary;
  platformMatrix: ReturnType<typeof normalizePlatformMatrixForApi> | null;
  diagnostics: Record<string, unknown> | null;
  topPicks: ReturnType<typeof buildIdentityGroupedShortlist>['topPicks'];
  shortlist: ReturnType<typeof buildIdentityGroupedShortlist>['shortlist'];
  filteredOut: ReturnType<typeof buildIdentityGroupedShortlist>['filteredOut'];
}

type OrchestrationErrorCode =
  | 'ORCHESTRATION_ALREADY_RUNNING'
  | 'INVALID_PLATFORM_SCOPE'
  | 'ORCHESTRATION_RUN_NOT_FOUND'
  | 'CONNECTOR_DEGRADED'
  | 'INVALID_INPUT';

type OrchestrationServiceError = Error & {
  code?: OrchestrationErrorCode;
  statusCode?: number;
};

const STALE_MINUTES = Math.max(2, Number(process.env.COMPETITOR_ORCHESTRATION_STALE_MINUTES || 10));
const CONTEXT_TOKEN_STOPWORDS = new Set([
  'about',
  'after',
  'against',
  'all',
  'also',
  'although',
  'always',
  'among',
  'because',
  'been',
  'before',
  'being',
  'better',
  'between',
  'both',
  'could',
  'every',
  'feel',
  'from',
  'into',
  'just',
  'make',
  'many',
  'more',
  'most',
  'only',
  'other',
  'over',
  'some',
  'such',
  'than',
  'their',
  'them',
  'there',
  'they',
  'this',
  'those',
  'through',
  'very',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'followers',
  'following',
  'posts',
  'likes',
  'views',
  'comment',
  'comments',
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'twitter',
  'facebook',
  'official',
  'community',
  'business',
  'brand',
  'platform',
  'service',
  'services',
  'temp',
  'seed',
  'test',
  'demo',
  'sample',
]);

function createServiceError(
  code: OrchestrationErrorCode,
  message: string,
  statusCode: number
): OrchestrationServiceError {
  const error = new Error(message) as OrchestrationServiceError;
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizePlatformMatrixForApi(value: {
  requested: CompetitorSurface[];
  detected: CompetitorSurface[];
  fromAccounts: CompetitorSurface[];
  fromInput: CompetitorSurface[];
  fromContext: CompetitorSurface[];
  selected: CompetitorSurface[];
  websiteDomain: string | null;
  policyApplied?: string;
  policySource?: string;
}) {
  return {
    requested: value.requested,
    detected: value.detected,
    fromAccounts: value.fromAccounts,
    fromInput: value.fromInput,
    fromContext: value.fromContext,
    selected: value.selected,
    websiteDomain: value.websiteDomain,
    policyApplied: value.policyApplied || null,
    policySource: value.policySource || null,
  };
}

function tokenizeContextText(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => {
      if (token.length < 4) return false;
      if (CONTEXT_TOKEN_STOPWORDS.has(token)) return false;
      if (/^\d+$/.test(token)) return false;
      return true;
    });
}

function topContextKeywords(texts: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of tokenizeContextText(text)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function tokenizeBrandKeywords(values: string[]): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    for (const token of String(value || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 4)) {
      terms.add(token);
    }
  }
  return Array.from(terms).slice(0, 10);
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!text) return null;
  const stripped = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse failure
  }
  const objectMatch = stripped.match(/\{[\s\S]*\}/);
  if (!objectMatch) return null;
  try {
    const parsed = JSON.parse(objectMatch[0]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function compactAudienceSignal(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const firstSentence = trimmed.split(/[.!?]/, 1)[0] || trimmed;
  return firstSentence
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function parseQ13Answer(value: unknown): CompetitorDiscoveryMethodAnswerJson | null {
  const raw = parseObject(value);
  if (!raw) return null;
  const discoveryFocus = String(raw.discoveryFocus || '').trim().toLowerCase();
  const method = String(raw.method || '').trim().toLowerCase();
  const websitePolicy = String(raw.websitePolicy || '').trim().toLowerCase();
  const surfacePriority = Array.isArray(raw.surfacePriority)
    ? Array.from(
        new Set(
          raw.surfacePriority
            .map((entry) => String(entry || '').trim().toLowerCase())
            .filter((entry) =>
              ['instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'facebook', 'website'].includes(entry)
            )
        )
      ) as CompetitorDiscoveryMethodAnswerJson['surfacePriority']
    : [];

  if (
    !['social_first', 'hybrid', 'web_first'].includes(discoveryFocus) ||
    !['handle_led', 'niche_led', 'account_led', 'mixed'].includes(method) ||
    !['evidence_only', 'fallback_only', 'peer_candidate'].includes(websitePolicy) ||
    surfacePriority.length === 0
  ) {
    return null;
  }

  return {
    discoveryFocus: discoveryFocus as CompetitorDiscoveryMethodAnswerJson['discoveryFocus'],
    method: method as CompetitorDiscoveryMethodAnswerJson['method'],
    surfacePriority,
    websitePolicy: websitePolicy as CompetitorDiscoveryMethodAnswerJson['websitePolicy'],
    minimumSocialForShortlist: Math.max(1, Math.floor(Number(raw.minimumSocialForShortlist) || 1)),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    rationale: String(raw.rationale || '').trim().slice(0, 320),
  };
}

function clampTargetCount(value: number | undefined): number {
  if (!Number.isFinite(value as number)) return 10;
  return Math.max(5, Math.min(10, Math.floor(value as number)));
}

function normalizeMode(value: string | undefined): OrchestrationMode {
  return value === 'replace' ? 'replace' : 'append';
}

function normalizePrecision(value: string | undefined): DiscoveryPrecision {
  return value === 'balanced' ? 'balanced' : 'high';
}

function parseInputSurfaces(input: CompetitorOrchestrationV2Input): CompetitorSurface[] | undefined {
  const raw = input.surfaces || input.platforms;
  if (!raw || raw.length === 0) return undefined;
  const normalized = Array.from(
    new Set(
      raw
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean)
    )
  ) as CompetitorSurface[];

  const allowed: CompetitorSurface[] = [
    'instagram',
    'tiktok',
    'youtube',
    'linkedin',
    'x',
    'facebook',
    'website',
  ];
  if (!normalized.every((surface) => allowed.includes(surface))) {
    throw createServiceError(
      'INVALID_PLATFORM_SCOPE',
      'surfaces must only include instagram,tiktok,youtube,linkedin,x,facebook,website',
      400
    );
  }
  return normalized;
}

async function createRunWithLock(input: {
  researchJobId: string;
  mode: OrchestrationMode;
  targetCount: number;
  platformMatrix: ReturnType<typeof normalizePlatformMatrixForApi>;
  precision: DiscoveryPrecision;
  connectorPolicy: ConnectorPolicy;
  discoveryPolicy: ReturnType<typeof buildCompetitorDiscoveryPolicy>;
}) {
  return prisma.$transaction(
    async (tx) => {
      const running = await tx.competitorOrchestrationRun.findFirst({
        where: { researchJobId: input.researchJobId, status: 'RUNNING' },
        orderBy: { startedAt: 'desc' },
      });

      if (running) {
        const staleMs = STALE_MINUTES * 60 * 1000;
        const bootstrapStaleMs = 2 * 60 * 1000;
        const collectingStaleMs = 3 * 60 * 1000;
        const ageMs = Date.now() - running.startedAt.getTime();
        const runningSummary = (running.summary || {}) as Record<string, unknown>;
        const hasProgress =
          Number(runningSummary.candidatesDiscovered || 0) > 0 ||
          Number(runningSummary.candidatesFiltered || 0) > 0 ||
          Number(runningSummary.shortlisted || 0) > 0 ||
          Number(runningSummary.topPicks || 0) > 0;
        const effectiveStaleMs =
          running.phase === 'started' || !running.phase
            ? Math.min(staleMs, bootstrapStaleMs)
            : running.phase === 'collecting' && !hasProgress
              ? Math.min(staleMs, collectingStaleMs)
            : staleMs;
        if (ageMs < effectiveStaleMs) {
          throw createServiceError(
            'ORCHESTRATION_ALREADY_RUNNING',
            'A competitor orchestration run is already in progress',
            409
          );
        }
        await tx.competitorOrchestrationRun.update({
          where: { id: running.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorCode: 'STALE_REPLACED',
            summary: {
              reason: 'Stale run replaced by a fresh orchestration run',
            } as Prisma.InputJsonValue,
          },
        });
      }

      return tx.competitorOrchestrationRun.create({
        data: {
          researchJobId: input.researchJobId,
          mode: input.mode,
          targetCount: input.targetCount,
          platforms: input.platformMatrix as unknown as Prisma.InputJsonValue,
          status: 'RUNNING',
          strategyVersion: 'v2',
          phase: 'started',
          configSnapshot: {
            mode: input.mode,
            targetCount: input.targetCount,
            selectedSurfaces: input.platformMatrix.selected,
            precision: input.precision,
            connectorPolicy: input.connectorPolicy,
            discoveryPolicy: input.discoveryPolicy,
          } as unknown as Prisma.InputJsonValue,
          summary: {
            candidatesDiscovered: 0,
            candidatesFiltered: 0,
            shortlisted: 0,
            topPicks: 0,
            profileUnavailableCount: 0,
          } as Prisma.InputJsonValue,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

function extractJobContext(job: {
  client: {
    name: string;
    businessOverview: string | null;
    goalsKpis?: string | null;
    brainProfile?: {
      businessType: string | null;
      offerModel: string | null;
      primaryGoal: string | null;
      secondaryGoals: Prisma.JsonValue | null;
      targetMarket: string | null;
      geoScope: string | null;
      websiteDomain: string | null;
      constraints: Prisma.JsonValue | null;
      goals?: Array<{
        goalType: string;
        targetValue: string | null;
      }>;
    } | null;
    clientAccounts: Array<{ platform: string; handle: string; bio: string | null; profileUrl: string | null }>;
    clientDocuments: Array<{ extractedText: string | null; fileName: string }>;
  } | null;
  inputData: Prisma.JsonValue | null;
  rawSearchResults: Array<{ query: string; title: string; body: string | null; href: string; source: string }>;
  aiQuestions: Array<{
    questionType: string;
    answer: string | null;
    answerJson: Prisma.JsonValue | null;
  }>;
  discoveredCompetitors: Array<{ handle: string; platform: string; selectionState: string; status: string }>;
}) {
  const inputData = (job.inputData || {}) as Record<string, unknown>;
  const brainProfile = job.client?.brainProfile || null;
  const brainSecondaryGoals = Array.isArray(brainProfile?.secondaryGoals)
    ? (brainProfile?.secondaryGoals as unknown[]).map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const brainGoalRows = (brainProfile?.goals || [])
    .map((goal) => String(goal.targetValue || '').trim())
    .filter(Boolean);
  const brandName = String(inputData.brandName || job.client?.name || '').trim();
  const rawNiche = String(
    inputData.niche || brainProfile?.businessType || inputData.category || 'business'
  ).trim();
  const rawBusinessOverview = String(
    inputData.businessOverview ||
      inputData.description ||
      brainProfile?.offerModel ||
      job.client?.businessOverview ||
      ''
  ).trim();
  const rawAudienceSummary = String(
    inputData.targetAudience || brainProfile?.targetMarket || inputData.persona || inputData.audience || ''
  ).trim();
  const sanitized = sanitizeDiscoveryContext({
    niche: rawNiche,
    businessOverview: rawBusinessOverview,
    audienceSummary: rawAudienceSummary,
  });
  const niche = sanitized.niche || rawNiche || 'business';
  const businessOverview = sanitized.businessOverview;
  const audienceSummary = sanitized.audienceSummary;
  const excludeHandles = new Set<string>();
  const excludedCategories = new Set<string>();
  const aiQuestionMap = new Map(job.aiQuestions.map((item) => [item.questionType, item] as const));

  const targetAudienceAnswer =
    compactAudienceSignal(aiQuestionMap.get('TARGET_AUDIENCE')?.answer || '') || audienceSummary;
  const nichePositionAnswer = String(aiQuestionMap.get('NICHE_POSITION')?.answer || '').trim();
  const q13Question = aiQuestionMap.get('COMPETITOR_DISCOVERY_METHOD');
  const q13AnswerJson =
    parseQ13Answer(q13Question?.answerJson) ||
    parseQ13Answer(q13Question?.answer) ||
    null;

  for (const account of job.client?.clientAccounts || []) {
    excludeHandles.add(String(account.handle || '').toLowerCase());
  }
  if (typeof inputData.handle === 'string') {
    excludeHandles.add(String(inputData.handle || '').toLowerCase());
  }
  if (inputData.handles && typeof inputData.handles === 'object') {
    for (const value of Object.values(inputData.handles as Record<string, unknown>)) {
      if (typeof value === 'string') excludeHandles.add(value.toLowerCase());
    }
  }

  if (typeof inputData.excludedCategories === 'string') {
    for (const token of inputData.excludedCategories
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)) {
      excludedCategories.add(token);
    }
  }

  if (inputData.constraints && typeof inputData.constraints === 'object') {
    const constraints = inputData.constraints as Record<string, unknown>;
    const value = constraints.excludedCategories;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const token = String(entry || '').trim().toLowerCase();
        if (token) excludedCategories.add(token);
      }
    } else if (typeof value === 'string') {
      for (const token of value
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)) {
        excludedCategories.add(token);
      }
    }
  }

  if (brainProfile?.constraints && typeof brainProfile.constraints === 'object') {
    const constraints = brainProfile.constraints as Record<string, unknown>;
    const value = constraints.excludedCategories;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const token = String(entry || '').trim().toLowerCase();
        if (token) excludedCategories.add(token);
      }
    } else if (typeof value === 'string') {
      for (const token of value
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)) {
        excludedCategories.add(token);
      }
    }
  }

  const contextTexts: string[] = [
    brandName,
    niche,
    businessOverview,
    audienceSummary,
    String(brainProfile?.primaryGoal || ''),
    ...brainSecondaryGoals,
    ...brainGoalRows,
    String(job.client?.goalsKpis || ''),
    String(brainProfile?.geoScope || ''),
    targetAudienceAnswer,
    nichePositionAnswer,
    q13AnswerJson ? JSON.stringify(q13AnswerJson) : '',
    String(inputData.website || brainProfile?.websiteDomain || inputData.websiteUrl || inputData.domain || ''),
  ].filter(Boolean);

  for (const account of job.client?.clientAccounts || []) {
    if (account.profileUrl) contextTexts.push(account.profileUrl);
    if (account.bio) contextTexts.push(account.bio);
  }

  for (const doc of job.client?.clientDocuments || []) {
    if (doc.extractedText) contextTexts.push(doc.extractedText.slice(0, 3000));
    if (doc.fileName) contextTexts.push(doc.fileName);
  }

  // Keep discovery context grounded in client-provided signals only.
  // Historic search snippets create feedback loops and noisy anchors.

  const ragKeywords = topContextKeywords(contextTexts, 24);
  const brandKeywords = tokenizeBrandKeywords([
    brandName,
    String(inputData.website || inputData.websiteUrl || inputData.domain || ''),
    ...Array.from(excludeHandles),
  ]);

  return {
    inputData,
    brandName,
    niche,
    businessOverview,
    audienceSummary,
    targetAudienceAnswer,
    nichePositionAnswer,
    q13AnswerJson,
    contextQualityScore: sanitized.contextQualityScore,
    sanitizedContextDiagnostics: {
      placeholderMatches: sanitized.placeholderMatches,
      removedTokens: sanitized.removedTokens,
    },
    excludeHandles: Array.from(excludeHandles).filter(Boolean),
    excludedCategories: Array.from(excludedCategories).filter(Boolean),
    contextTexts,
    ragKeywords,
    brandKeywords,
  };
}

export async function orchestrateCompetitorsForJob(
  researchJobId: string,
  input: CompetitorOrchestrationV2Input = {}
): Promise<CompetitorOrchestrationV2Response> {
  const mode = normalizeMode(input.mode);
  const targetCount = clampTargetCount(input.targetCount);
  const precision = normalizePrecision(input.precision);
  const connectorPolicy: ConnectorPolicy = 'ddg_first_pluggable';
  const requestedSurfaces = parseInputSurfaces(input);
  const connectorHealth = new ConnectorHealthTracker();

  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: {
        include: {
          brainProfile: {
            include: {
              goals: {
                select: {
                  goalType: true,
                  targetValue: true,
                },
                orderBy: { priority: 'asc' },
              },
            },
          },
          clientAccounts: {
            select: {
              platform: true,
              handle: true,
              bio: true,
              profileUrl: true,
            },
          },
          clientDocuments: {
            select: {
              fileName: true,
              extractedText: true,
            },
            take: 12,
          },
        },
      },
      rawSearchResults: {
        select: {
          query: true,
          title: true,
          body: true,
          href: true,
          source: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 120,
      },
      aiQuestions: {
        where: {
          isAnswered: true,
          questionType: {
            in: ['TARGET_AUDIENCE', 'NICHE_POSITION', 'COMPETITOR_DISCOVERY_METHOD'],
          },
        },
        select: {
          questionType: true,
          answer: true,
          answerJson: true,
        },
      },
      discoveredCompetitors: {
        select: {
          handle: true,
          platform: true,
          selectionState: true,
          status: true,
        },
      },
    },
  });

  if (!job) {
    throw createServiceError('INVALID_INPUT', 'Research job not found', 404);
  }

  const context = extractJobContext(job);
  const platformMatrix = await detectPlatformMatrix({
    researchJobId,
    brandName: context.brandName || job.client?.name || 'brand',
    requestedSurfaces,
    inputData: context.inputData,
    clientAccounts:
      job.client?.clientAccounts.map((account) => ({
        platform: account.platform,
        handle: account.handle,
        profileUrl: account.profileUrl,
    })) || [],
    contextTexts: context.contextTexts,
  });

  const discoveryPolicy = buildCompetitorDiscoveryPolicy({
    requestedSurfaces,
    detectedSurfaces: platformMatrix.detected,
    clientAccounts:
      job.client?.clientAccounts.map((account) => ({
        platform: account.platform,
        handle: account.handle,
      })) || [],
    websiteDomain: platformMatrix.websiteDomain,
    inputData: context.inputData,
    q13AnswerJson: context.q13AnswerJson,
    contextQualityScore: context.contextQualityScore,
  });

  const policyDrivenMatrix = {
    ...platformMatrix,
    selected: discoveryPolicy.selectedSurfaces,
    policyApplied: discoveryPolicy.websitePolicy,
    policySource: discoveryPolicy.policySource,
  };
  const platformMatrixForApi = normalizePlatformMatrixForApi(policyDrivenMatrix);

  const run = await createRunWithLock({
    researchJobId,
    mode,
    targetCount,
    platformMatrix: platformMatrixForApi,
    precision,
    connectorPolicy,
    discoveryPolicy,
  });

  emitResearchJobEvent({
    researchJobId,
    runId: run.id,
    source: 'competitor-orchestrator-v2',
    code: 'competitor.orchestration.started',
    level: 'info',
    message: 'Competitor orchestration V2 started',
    metrics: {
      mode,
      targetCount,
      precision,
      connectorPolicy,
    },
  });

  emitResearchJobEvent({
    researchJobId,
    runId: run.id,
    source: 'competitor-orchestrator-v2',
    code: 'competitor.orchestration.platforms.detected',
    level: 'info',
    message: `Policy-selected surfaces: ${policyDrivenMatrix.selected.join(', ')}`,
    metrics: {
      ...platformMatrixForApi,
      discoveryPolicy,
    },
  });

  try {
    const queryPlan = buildPointyCompetitorQueryPlan({
      brandName: context.brandName || 'brand',
      niche: context.niche || 'business',
      businessOverview: context.businessOverview,
      audienceSummary: context.targetAudienceAnswer || context.audienceSummary,
      platformMatrix: policyDrivenMatrix,
      precision,
      extraNegativeTerms: context.excludedCategories,
    });

    emitResearchJobEvent({
      researchJobId,
      runId: run.id,
      source: 'competitor-orchestrator-v2',
      code: 'competitor.orchestration.query.generated',
      level: 'info',
      message: 'Pointy discovery queries generated',
      metrics: {
        precision,
        businessType: queryPlan.businessType,
        negatives: queryPlan.negatives.length,
        queryCount: Object.values(queryPlan.perSurface).reduce((sum, rows) => sum + rows.length, 0),
      },
      metadata: {
        perSurface: queryPlan.perSurface,
      },
    });

    await prisma.competitorOrchestrationRun.update({
      where: { id: run.id },
      data: { phase: 'collecting' },
    });

    const collectorResult = await collectCompetitorCandidates({
      researchJobId,
      brandName: context.brandName || 'brand',
      niche: context.niche || 'business',
      description: context.businessOverview,
      selectedSurfaces: policyDrivenMatrix.selected,
      queryPlan,
      precision,
      connectorHealth,
      excludeHandles: context.excludeHandles,
      excludeDomains: policyDrivenMatrix.websiteDomain ? [policyDrivenMatrix.websiteDomain] : [],
    });

    emitResearchJobEvent({
      researchJobId,
      runId: run.id,
      source: 'competitor-orchestrator-v2',
      code: 'competitor.orchestration.collector.completed',
      level: 'info',
      message: `Collector finished (${collectorResult.diagnostics.dedupedCount} deduped candidates)`,
      metrics: { ...collectorResult.diagnostics },
    });

    await prisma.competitorOrchestrationRun.update({
      where: { id: run.id },
      data: { phase: 'resolving' },
    });

    const resolverResult = await resolveCandidateAvailability(
      collectorResult.candidates,
      connectorHealth,
      {
        websitePolicy: discoveryPolicy.websitePolicy,
      }
    );

    emitResearchJobEvent({
      researchJobId,
      runId: run.id,
      source: 'competitor-orchestrator-v2',
      code: 'competitor.orchestration.resolver.completed',
      level: 'info',
      message: `Resolver finished (${resolverResult.diagnostics.verifiedCount} verified)`,
      metrics: { ...resolverResult.diagnostics },
    });

    for (const candidate of resolverResult.candidates) {
      if (candidate.availabilityStatus === 'PROFILE_UNAVAILABLE') {
        emitResearchJobEvent({
          researchJobId,
          runId: run.id,
          source: 'competitor-orchestrator-v2',
          code: 'competitor.profile.unavailable',
          level: 'warn',
          message: `${candidate.platform} @${candidate.handle} is not available`,
          platform: candidate.platform,
          handle: candidate.handle,
          metrics: {
            reason: candidate.availabilityReason,
          },
        });
      }
    }

    await prisma.competitorOrchestrationRun.update({
      where: { id: run.id },
      data: { phase: 'scoring' },
    });

    const scoredResult = scoreCompetitorCandidates({
      candidates: resolverResult.candidates,
      businessKeywords: queryPlan.businessKeywords,
      audienceKeywords: queryPlan.audienceKeywords,
      niche: context.niche || 'business',
      targetCount,
      precision,
      excludeHandles: context.excludeHandles,
      ragKeywords: context.ragKeywords,
      brandKeywords: context.brandKeywords,
      policy: {
        websitePolicy: discoveryPolicy.websitePolicy,
        minimumSocialForShortlist: discoveryPolicy.shortlistConstraints.minimumSocialForShortlist,
        websiteFallbackOnlyWhenSocialBelowMinimum:
          discoveryPolicy.shortlistConstraints.websiteFallbackOnlyWhenSocialBelowMinimum,
      },
    });

    const limitedScored = scoredResult.scored.slice(0, 120);
    const diagnostics = {
      ...collectorResult.diagnostics,
      ...resolverResult.diagnostics,
      perPlatformScored: limitedScored.reduce<Record<string, number>>((acc, row) => {
        acc[row.platform] = (acc[row.platform] || 0) + 1;
        return acc;
      }, {}),
      degradedConnectors: connectorHealth.degradedNames(),
      connectorSnapshot: connectorHealth.snapshot(),
      discoveryPolicy,
      contextQualityScore: context.contextQualityScore,
      contextSanitization: context.sanitizedContextDiagnostics,
    };

    const summary = await persistOrchestrationCandidates({
      researchJobId,
      runId: run.id,
      scored: limitedScored,
      mode,
      strategyVersion: 'v2',
      configSnapshot: {
        mode,
        targetCount,
        precision,
        selectedSurfaces: policyDrivenMatrix.selected,
        connectorPolicy,
        discoveryPolicy,
      },
      diagnostics,
    });

    // PHASE 2: Second-phase validation to review filtered competitors
    console.log('[Orchestrator] Starting second-phase validation of filtered competitors...');
    const { reviewFilteredCompetitors } = await import('./second-phase-validator');
    const validationResult = await reviewFilteredCompetitors(researchJobId, run.id);
    
    if (validationResult.promoted > 0) {
      console.log(`[Orchestrator] Second-phase validation promoted ${validationResult.promoted} competitors`);
      
      emitResearchJobEvent({
        researchJobId,
        runId: run.id,
        source: 'competitor-orchestrator-v2',
        code: 'competitor.orchestration.second_phase.completed',
        level: 'info',
        message: `Second-phase validation complete: ${validationResult.promoted} promoted from filtered`,
        metrics: {
          totalReviewed: validationResult.totalReviewed,
          promoted: validationResult.promoted,
          keptFiltered: validationResult.keptFiltered,
        },
      });
    }

    emitResearchJobEvent({
      researchJobId,
      runId: run.id,
      source: 'competitor-orchestrator-v2',
      code: 'competitor.orchestration.shortlist.generated',
      level: 'info',
      message: `Shortlist generated (${summary.shortlisted} shortlisted, ${summary.topPicks} top picks)`,
      metrics: summary,
    });

    for (const degraded of connectorHealth.snapshot().filter((item) => item.status === 'degraded')) {
      emitResearchJobEvent({
        researchJobId,
        runId: run.id,
        source: 'competitor-orchestrator-v2',
        code: 'connector.health.degraded',
        level: 'warn',
        message: `${degraded.name} degraded`,
        metrics: degraded as unknown as Record<string, unknown>,
      });
    }

    return {
      runId: run.id,
      summary,
      platformMatrix: platformMatrixForApi,
      diagnostics,
    };
  } catch (error: any) {
    const errorCode: OrchestrationErrorCode =
      error?.code && typeof error.code === 'string' ? error.code : 'INVALID_INPUT';
    await prisma.competitorOrchestrationRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        phase: 'failed',
        errorCode,
        summary: {
          error: error?.message || 'Competitor orchestration failed',
        } as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    emitResearchJobEvent({
      researchJobId,
      runId: run.id,
      source: 'competitor-orchestrator-v2',
      code: 'competitor.orchestration.failed',
      level: 'error',
      message: `Competitor orchestration failed: ${error?.message || error}`,
      metrics: { code: errorCode },
    });

    throw error;
  }
}

function parseRunPlatformMatrix(
  raw: Prisma.JsonValue | null
): ReturnType<typeof normalizePlatformMatrixForApi> | null {
  const allowed = new Set<CompetitorSurface>([
    'instagram',
    'tiktok',
    'youtube',
    'linkedin',
    'x',
    'facebook',
    'website',
  ]);
  const toSurfaceArray = (value: unknown): CompetitorSurface[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => String(entry) as CompetitorSurface)
      .filter((entry): entry is CompetitorSurface => allowed.has(entry));
  };

  if (!raw) return null;
  if (Array.isArray(raw)) {
    const selected = toSurfaceArray(raw);
    return {
      requested: selected,
      detected: selected,
      fromAccounts: [],
      fromInput: [],
      fromContext: [],
      selected,
      websiteDomain: null,
      policyApplied: null,
      policySource: null,
    };
  }

  if (typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    const selected = toSurfaceArray(value.selected);
    const requested = toSurfaceArray(value.requested);
    const detected = toSurfaceArray(value.detected);
    const fromAccounts = toSurfaceArray(value.fromAccounts);
    const fromInput = toSurfaceArray(value.fromInput);
    const fromContext = toSurfaceArray(value.fromContext);

    return {
      requested: requested.length > 0 ? requested : selected,
      detected: detected.length > 0 ? detected : selected,
      fromAccounts,
      fromInput,
      fromContext,
      selected,
      websiteDomain: typeof value.websiteDomain === 'string' ? value.websiteDomain : null,
      policyApplied: typeof value.policyApplied === 'string' ? value.policyApplied : null,
      policySource: typeof value.policySource === 'string' ? value.policySource : null,
    };
  }
  return null;
}

export async function getCompetitorShortlist(
  researchJobId: string,
  runId?: string
): Promise<CompetitorShortlistV2Response> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    select: { inputData: true },
  });
  const controlMode = ((job?.inputData as Record<string, unknown>)?.controlMode === 'manual' ? 'manual' : 'auto') as 'auto' | 'manual';

  let run = runId
    ? await prisma.competitorOrchestrationRun.findFirst({
        where: { id: runId, researchJobId },
      })
    : null;

  if (!run && !runId) {
    const recentRuns = await prisma.competitorOrchestrationRun.findMany({
      where: { researchJobId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    run = recentRuns[0] || null;
    if (run?.status === 'RUNNING') {
      const latestCompleted = recentRuns.find((row) => row.status === 'COMPLETED');
      if (latestCompleted) {
        run = latestCompleted;
      }
    }
  }

  if (!run) {
    return {
      runId: null,
      controlMode,
      summary: {
        candidatesDiscovered: 0,
        candidatesFiltered: 0,
        shortlisted: 0,
        topPicks: 0,
        profileUnavailableCount: 0,
      },
      platformMatrix: null,
      diagnostics: null,
      topPicks: [],
      shortlist: [],
      filteredOut: [],
    };
  }

  const profiles = await prisma.competitorCandidateProfile.findMany({
    where: {
      researchJobId,
      orchestrationRunId: run.id,
    },
    include: {
      identity: {
        select: {
          id: true,
          canonicalName: true,
          websiteDomain: true,
          businessType: true,
          audienceSummary: true,
        },
      },
      evidenceRows: {
        orderBy: { createdAt: 'desc' },
        take: 12,
      },
      discoveredCompetitors: {
        select: { id: true, status: true },
      },
    },
    orderBy: [{ relevanceScore: 'desc' }],
  });

  const grouped = buildIdentityGroupedShortlist(profiles as never);
  const rawSummary = (run.summary || {}) as Record<string, unknown>;
  const summary: CompetitorOrchestrationV2Summary = {
    candidatesDiscovered: Number(rawSummary.candidatesDiscovered || profiles.length || 0),
    candidatesFiltered: Number(rawSummary.candidatesFiltered || grouped.filteredOut.length || 0),
    shortlisted: Number(rawSummary.shortlisted || grouped.shortlist.length + grouped.topPicks.length || 0),
    topPicks: Number(rawSummary.topPicks || grouped.topPicks.length || 0),
    profileUnavailableCount: Number(rawSummary.profileUnavailableCount || 0),
  };

  return {
    runId: run.id,
    controlMode,
    summary,
    platformMatrix: parseRunPlatformMatrix(run.platforms || null),
    diagnostics: (run.diagnostics || null) as Record<string, unknown> | null,
    topPicks: grouped.topPicks,
    shortlist: grouped.shortlist,
    filteredOut: grouped.filteredOut,
  };
}

export async function getOrchestrationRunDiagnostics(
  researchJobId: string,
  runId: string
): Promise<Record<string, unknown>> {
  const run = await prisma.competitorOrchestrationRun.findFirst({
    where: { id: runId, researchJobId },
    select: {
      id: true,
      status: true,
      phase: true,
      errorCode: true,
      configSnapshot: true,
      diagnostics: true,
      summary: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!run) {
    throw createServiceError('ORCHESTRATION_RUN_NOT_FOUND', 'Orchestration run not found', 404);
  }
  return {
    id: run.id,
    status: run.status,
    phase: run.phase,
    errorCode: run.errorCode,
    configSnapshot: run.configSnapshot,
    diagnostics: run.diagnostics,
    summary: run.summary,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

export async function approveAndScrapeCompetitors(
  researchJobId: string,
  runId: string,
  candidateProfileIds: string[]
): Promise<{ approvedCount: number; rejectedCount: number; queuedCount: number; skippedCount: number }> {
  return approveAndQueueCandidates({
    researchJobId,
    runId,
    candidateProfileIds,
  });
}

export async function continueCompetitorScrape(
  researchJobId: string,
  input: {
    candidateProfileIds?: string[];
    onlyPending?: boolean;
    runId?: string;
    forceUnavailable?: boolean;
    forceMaterialize?: boolean;
  } = {}
): Promise<{ queuedCount: number; skippedCount: number }> {
  return continueQueueFromCandidates({
    researchJobId,
    runId: input.runId,
    candidateProfileIds: input.candidateProfileIds,
    onlyPending: Boolean(input.onlyPending),
    forceUnavailable: Boolean(input.forceUnavailable),
    forceMaterialize: Boolean(input.forceMaterialize),
  });
}
