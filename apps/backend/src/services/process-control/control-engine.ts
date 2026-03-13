import {
  ProcessQuestionTask,
  ProcessEscalationStatus,
  ProcessGateStatus,
  ProcessQuestionSeverity,
  ProcessQuestionStatus,
  ProcessRunDocumentType,
  ProcessRunMethod,
  ProcessRunStage,
  ProcessRunStatus,
  ProcessSectionStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  assertRolePermission,
  assertStageTransition,
  BLOCKER_SEVERITIES,
  PROCESS_EVENT_TYPES,
  QUESTION_SURFACES,
  type ProcessEventTypeLiteral,
} from './constants';
import {
  estimateNicheConfidence,
  selectMethodV2,
  type ProcessRequestMode,
  type WorkflowSelectionDecision,
} from './policy';
import { collectResearchEvidence } from './research-adapter';
import { evaluateSectionPolicyGates, summarizeGateEvaluations } from './quality-gates';
import {
  compileProcessPlan,
  readPlanFromMetadata,
  type CompiledProcessPlan,
  type ProcessRunTargetInput,
} from './request-compiler';
import {
  isProcessControlV2AutoStartEnabled,
  isProcessControlV2Enabled,
  processControlV2DefaultMaxRetries,
  processControlV2DefaultMaxRetryWithEvidence,
} from './feature-flags';
import { planBusinessStrategyHeaders } from './header-planner';

type ProcessRunRecord = Prisma.ProcessRunGetPayload<{
  include: {
    sectionRuns: {
      include: {
        revisions: {
          orderBy: { revisionNumber: 'desc' };
          take: 1;
        };
      };
      orderBy: { sortOrder: 'asc' };
    };
    questionTasks: true;
    gateResults: true;
    claimRecords: true;
  };
}>;

export type CreateProcessRunInput = {
  workspaceId: string;
  documentType?: ProcessRunDocumentType;
  objective?: string;
  requestMode?: ProcessRequestMode;
  targets?: ProcessRunTargetInput[];
  idempotencyKey?: string;
  startedBy?: string;
};

export type ResumeProcessRunInput = {
  workspaceId: string;
  runId: string;
  mode?: 'retry' | 'retry_with_new_evidence';
  requestedBy?: string;
};

export type EscalateProcessRunInput = {
  workspaceId: string;
  runId: string;
  reason: string;
  details?: string;
  requestedBy?: string;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function hasUsableValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => normalizeText(entry).length > 0);
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return normalizeText(value).length > 0;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function getMethodObjective(inputData: Record<string, unknown>, fallback: string): string {
  return (
    normalizeText(inputData.primaryGoal) ||
    normalizeText(inputData.engineGoal) ||
    normalizeText(inputData.futureGoal) ||
    normalizeText(fallback)
  );
}

function sanitizeIdempotencyKey(value: unknown): string {
  return normalizeText(value)
    .replace(/[^a-z0-9._:-]/gi, '-')
    .slice(0, 120);
}

type SectionFieldRequirement = {
  key: string;
  label: string;
  severity: 'BLOCKER' | 'IMPORTANT' | 'OPTIONAL';
  question: string;
  answerType: 'single_select' | 'multi_select' | 'text';
  options: Array<{ value: string; label: string }>;
  suggestedAnswers: string[];
};

type SectionContract = {
  nodeId: string;
  sectionSlug: string;
  artifactKey: string;
  artifactType: string;
  title: string;
  framework: string;
  minWords: number;
  minEvidence: number;
  exitCriteria: string[];
  requiredInputs: SectionFieldRequirement[];
  dependencies: string[];
  standardId: string;
  standardVersion: number;
};

function normalizeSeverity(value: unknown): SectionFieldRequirement['severity'] {
  const raw = normalizeText(value).toUpperCase();
  if (raw === 'BLOCKER' || raw === 'IMPORTANT') return raw;
  return 'OPTIONAL';
}

function normalizeAnswerType(value: unknown): SectionFieldRequirement['answerType'] {
  const raw = normalizeText(value).toLowerCase();
  if (raw === 'single_select' || raw === 'multi_select') return raw;
  return 'text';
}

function parseQuestionOptions(value: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      value: normalizeText(entry.value),
      label: normalizeText(entry.label) || normalizeText(entry.value),
    }))
    .filter((entry) => Boolean(entry.value));
  return Array.from(new Map(normalized.map((entry) => [entry.value.toLowerCase(), entry])).values());
}

function parseSuggestedAnswers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => normalizeText(entry)).filter(Boolean))).slice(0, 8);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeText(entry)).filter(Boolean);
}

function parseRequiredInputs(value: unknown): SectionFieldRequirement[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      key: normalizeText(entry.key),
      label: normalizeText(entry.label) || normalizeText(entry.key),
      severity: normalizeSeverity(entry.severity),
      question:
        normalizeText(entry.question) || `Please provide ${normalizeText(entry.label) || normalizeText(entry.key)}.`,
      answerType: normalizeAnswerType(entry.answerType),
      options: parseQuestionOptions(entry.options),
      suggestedAnswers: parseSuggestedAnswers(entry.suggestedAnswers),
    }))
    .filter((entry) => Boolean(entry.key));
}

function readRunPlan(run: ProcessRunRecord): CompiledProcessPlan | null {
  return readPlanFromMetadata(run.metadataJson);
}

function buildSectionContract(sectionRun: ProcessRunRecord['sectionRuns'][number]): SectionContract {
  const requiredInputs = parseRequiredInputs(sectionRun.requiredInputsJson);
  const evidenceMeta = asRecord(sectionRun.requiredEvidenceJson);

  const minEvidenceRaw = Number(evidenceMeta.minEvidence);
  const minWordsRaw = Number(evidenceMeta.minWords);
  const dependencies = asStringArray(evidenceMeta.dependencies);
  const artifactType = normalizeText(evidenceMeta.artifactType) || 'BUSINESS_STRATEGY';
  const artifactKey = normalizeText(evidenceMeta.artifactKey) || artifactType.toLowerCase();
  const sectionSlug = normalizeText(evidenceMeta.sectionSlug || evidenceMeta.sectionKey || sectionRun.sectionKey) || sectionRun.sectionKey;
  const nodeId = normalizeText(evidenceMeta.nodeId || sectionRun.sectionKey) || sectionRun.sectionKey;
  const standardId = normalizeText(evidenceMeta.standardId) || 'legacy/business_strategy';
  const standardVersionRaw = Number(evidenceMeta.standardVersion);

  return {
    nodeId,
    sectionSlug,
    artifactKey,
    artifactType,
    title: sectionRun.title,
    framework: sectionRun.framework,
    minWords: Number.isFinite(minWordsRaw) ? Math.max(40, Math.floor(minWordsRaw)) : 120,
    minEvidence: Number.isFinite(minEvidenceRaw) ? Math.max(1, Math.floor(minEvidenceRaw)) : 2,
    exitCriteria: asStringArray(evidenceMeta.exitCriteria),
    requiredInputs,
    dependencies,
    standardId,
    standardVersion: Number.isFinite(standardVersionRaw) ? Math.max(1, Math.floor(standardVersionRaw)) : 1,
  };
}

async function emitRunEvent(params: {
  runId: string;
  workspaceId: string;
  type: ProcessEventTypeLiteral;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await prisma.processRunEvent.create({
    data: {
      processRunId: params.runId,
      researchJobId: params.workspaceId,
      type: params.type,
      message: params.message,
      payloadJson: params.payload ? toJson(params.payload) : undefined,
    },
  });

  await prisma.researchJobEvent.create({
    data: {
      researchJobId: params.workspaceId,
      source: 'process-control-v2',
      code: params.type.replace(/\./g, '_').toUpperCase(),
      level: 'info',
      message: params.message,
      metadata: params.payload ? toJson(params.payload) : undefined,
    },
  });
}

async function logDecisionEvent(params: {
  runId: string;
  workspaceId: string;
  stage: ProcessRunStage;
  ruleId: string;
  inputSnapshot: Record<string, unknown>;
  evidenceRefs?: string[];
  output: Record<string, unknown>;
}): Promise<void> {
  await prisma.processDecisionEvent.create({
    data: {
      processRunId: params.runId,
      researchJobId: params.workspaceId,
      stage: params.stage,
      ruleId: params.ruleId,
      inputSnapshotJson: toJson(params.inputSnapshot),
      evidenceRefsJson: toJson(params.evidenceRefs || []),
      outputJson: toJson(params.output),
    },
  });
}

async function loadRunStrict(workspaceId: string, runId: string): Promise<ProcessRunRecord> {
  const run = await prisma.processRun.findFirst({
    where: { id: runId, researchJobId: workspaceId },
    include: {
      sectionRuns: {
        include: {
          revisions: {
            orderBy: { revisionNumber: 'desc' },
            take: 1,
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      questionTasks: true,
      gateResults: true,
      claimRecords: true,
    },
  });
  if (!run) {
    throw new Error(`Process run ${runId} not found for workspace ${workspaceId}`);
  }
  return run;
}

async function updateRunStage(params: {
  run: ProcessRunRecord;
  to: ProcessRunStage;
  status: ProcessRunStatus;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  assertStageTransition(params.run.stage, params.to);
  await prisma.processRun.update({
    where: { id: params.run.id },
    data: {
      stage: params.to,
      status: params.status,
    },
  });

  await emitRunEvent({
    runId: params.run.id,
    workspaceId: params.run.researchJobId,
    type: PROCESS_EVENT_TYPES.STAGE_CHANGED,
    message: params.message,
    payload: {
      from: params.run.stage,
      to: params.to,
      status: params.status,
      ...(params.payload || {}),
    },
  });
}

async function ensureQuestionTask(params: {
  runId: string;
  workspaceId: string;
  sectionRunId?: string;
  sourceSectionKey?: string;
  fieldKey: string;
  question: string;
  severity: ProcessQuestionSeverity;
  answerType?: SectionFieldRequirement['answerType'];
  options?: Array<{ value: string; label: string }>;
  suggestedAnswers?: string[];
  requestedBy?: string;
}): Promise<void> {
  const existing = await prisma.processQuestionTask.findFirst({
    where: {
      processRunId: params.runId,
      sectionRunId: params.sectionRunId || null,
      fieldKey: params.fieldKey,
      status: ProcessQuestionStatus.OPEN,
    },
  });

  if (existing) return;

  const created = await prisma.processQuestionTask.create({
    data: {
      processRunId: params.runId,
      researchJobId: params.workspaceId,
      sectionRunId: params.sectionRunId || null,
      fieldKey: params.fieldKey,
      question: params.question,
      severity: params.severity,
      status: ProcessQuestionStatus.OPEN,
      surfacesJson: toJson({
        surfaces: [...QUESTION_SURFACES],
        answerType: normalizeAnswerType(params.answerType),
        options: parseQuestionOptions(params.options),
        suggestedAnswers: parseSuggestedAnswers(params.suggestedAnswers),
        sourceSectionKey: normalizeText(params.sourceSectionKey) || null,
      }),
      requestedBy: normalizeText(params.requestedBy) || 'system',
    },
  });

  await emitRunEvent({
    runId: params.runId,
    workspaceId: params.workspaceId,
    type: PROCESS_EVENT_TYPES.QUESTION_CREATED,
    message: `Question created: ${params.fieldKey}`,
    payload: {
      questionTaskId: created.id,
      sectionRunId: params.sectionRunId || null,
      fieldKey: params.fieldKey,
      severity: params.severity,
      surfaces: QUESTION_SURFACES,
      answerType: normalizeAnswerType(params.answerType),
      options: parseQuestionOptions(params.options),
      suggestedAnswers: parseSuggestedAnswers(params.suggestedAnswers),
      sourceSectionKey: normalizeText(params.sourceSectionKey) || null,
    },
  });
}

function latestRevisionMarkdown(sectionRun: ProcessRunRecord['sectionRuns'][number]): string {
  return normalizeText(sectionRun.revisions[0]?.markdown || '');
}

function buildAvailableInputs(inputData: Record<string, unknown>, answeredTasks: Array<{ fieldKey: string; answerJson: unknown }>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...inputData };

  for (const task of answeredTasks) {
    if (!task.fieldKey) continue;
    merged[task.fieldKey] = task.answerJson;
  }

  const runtimeAnswers = asRecord(inputData.runtimeAnswers);
  for (const [key, value] of Object.entries(runtimeAnswers)) {
    if (!hasUsableValue(merged[key])) {
      merged[key] = value;
    }
  }

  return merged;
}

const SECTION_INPUT_ALIASES: Record<string, string[]> = {
  primaryGoal: ['primaryGoal', 'engineGoal', 'futureGoal'],
  oneSentenceDescription: ['oneSentenceDescription', 'businessOverview', 'description'],
  targetAudience: ['targetAudience', 'idealAudience'],
  idealAudience: ['idealAudience', 'targetAudience'],
  topProblems: ['topProblems', 'challenges'],
  mainOffer: ['mainOffer', 'servicesList', 'productsServices'],
  servicesList: ['servicesList', 'productsServices', 'mainOffer'],
  questionsBeforeBuying: ['questionsBeforeBuying'],
  resultsIn90Days: ['resultsIn90Days', 'primaryGoal'],
  constraints: ['constraints', 'challenges'],
  niche: ['niche', 'businessType'],
  operateWhere: ['operateWhere', 'geoScope'],
  wantClientsWhere: ['wantClientsWhere', 'geoScope'],
  language: ['language'],
  planningHorizon: ['planningHorizon'],
  autonomyLevel: ['autonomyLevel'],
  budgetSensitivity: ['budgetSensitivity'],
  competitorInspirationLinks: ['competitorInspirationLinks'],
};

type EvidenceRow = {
  id: string;
  sourceType: string;
  title: string | null;
  snippet: string | null;
  url: string | null;
  fetchedAt: Date | null;
};

type CompetitorSeed = {
  handle: string;
  profileUrl: string | null;
};

function extractDomain(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function inferCompetitorLinksFromEvidence(
  evidenceRows: EvidenceRow[],
  discoveredCompetitors: CompetitorSeed[],
  clientDomain: string
): string[] {
  const directCompetitorLinks = discoveredCompetitors
    .map((item) => normalizeText(item.profileUrl))
    .filter(Boolean);
  if (directCompetitorLinks.length > 0) {
    return Array.from(new Set(directCompetitorLinks)).slice(0, 6);
  }

  const refs: string[] = [];
  for (const row of evidenceRows) {
    const candidate = normalizeText(row.url);
    if (!candidate) continue;
    const domain = extractDomain(candidate);
    if (!domain) continue;
    if (clientDomain && domain === clientDomain) continue;
    if (/linkedin\.com/i.test(domain)) continue;
    refs.push(candidate);
  }
  return Array.from(new Set(refs)).slice(0, 6);
}

function inferLanguageFromEvidence(evidenceRows: EvidenceRow[]): string | null {
  const sample = evidenceRows
    .map((row) => `${normalizeText(row.title)} ${normalizeText(row.snippet)}`.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(' ');
  if (!sample) return null;
  if (/[\u0600-\u06FF]/.test(sample)) return 'arabic';
  return 'english';
}

function inferFieldFromEvidence(input: {
  fieldKey: string;
  availableInputs: Record<string, unknown>;
  evidenceRows: EvidenceRow[];
  discoveredCompetitors: CompetitorSeed[];
  clientDomain: string;
}): { value: unknown; evidenceRefs: string[] } | null {
  const aliases = SECTION_INPUT_ALIASES[input.fieldKey] || [];
  for (const alias of aliases) {
    if (alias === input.fieldKey) continue;
    const candidate = input.availableInputs[alias];
    if (!hasUsableValue(candidate)) continue;
    return {
      value: candidate,
      evidenceRefs: [`input:${alias}`],
    };
  }

  if (input.fieldKey === 'competitorInspirationLinks') {
    const links = inferCompetitorLinksFromEvidence(input.evidenceRows, input.discoveredCompetitors, input.clientDomain);
    if (links.length > 0) {
      return {
        value: links,
        evidenceRefs: input.evidenceRows.filter((row) => normalizeText(row.url)).slice(0, 6).map((row) => row.id),
      };
    }
  }

  if (input.fieldKey === 'language') {
    const language = inferLanguageFromEvidence(input.evidenceRows);
    if (language) {
      return {
        value: language,
        evidenceRefs: input.evidenceRows.slice(0, 4).map((row) => row.id),
      };
    }
  }

  return null;
}

function pickSectionEvidence(
  allEvidence: Array<{ id: string; sourceType: string; title: string | null; snippet: string | null; url: string | null; fetchedAt: Date | null }>,
  sectionKey: string,
  take: number
): Array<{ id: string; sourceType: string; title: string | null; snippet: string | null; url: string | null; fetchedAt: Date | null }> {
  const lower = sectionKey.toLowerCase();

  const matched = allEvidence.filter((item) => {
    const haystack = `${normalizeText(item.title)} ${normalizeText(item.snippet)} ${normalizeText(item.url)}`.toLowerCase();
    if (!haystack) return false;
    if (lower.includes('competitive') || lower.includes('market')) {
      return /(competitor|market|industry|trend|benchmark)/i.test(haystack);
    }
    if (lower.includes('audience') || lower.includes('problem')) {
      return /(audience|customer|pain|question|segment)/i.test(haystack);
    }
    if (lower.includes('offer') || lower.includes('positioning')) {
      return /(offer|service|product|position|pricing|value)/i.test(haystack);
    }
    if (lower.includes('measurement') || lower.includes('risk')) {
      return /(metric|kpi|risk|constraint|budget)/i.test(haystack);
    }
    if (lower.includes('execution') || lower.includes('roadmap')) {
      return /(plan|execution|roadmap|channel|launch|timeline)/i.test(haystack);
    }
    return true;
  });

  const selected = (matched.length ? matched : allEvidence).slice(0, Math.max(1, take));
  return selected;
}

function buildSectionDraftMarkdown(input: {
  sectionTitle: string;
  sectionFramework: string;
  objective: string;
  requiredInputs: Array<{ key: string; label: string }>;
  availableInputs: Record<string, unknown>;
  evidence: Array<{ id: string; title: string | null; snippet: string | null; url: string | null }>;
}): string {
  const contextLines = input.requiredInputs.map((field) => {
    const raw = input.availableInputs[field.key];
    if (Array.isArray(raw)) {
      return `- ${field.label}: ${raw.map((entry) => normalizeText(entry)).filter(Boolean).join(', ') || 'Not provided'}`;
    }
    return `- ${field.label}: ${normalizeText(raw) || 'Not provided'}`;
  });

  const evidenceLines = input.evidence.map((item, index) => {
    const label = normalizeText(item.title) || `Evidence ${index + 1}`;
    const snippet = normalizeText(item.snippet).slice(0, 160);
    const url = normalizeText(item.url);
    const sourceSuffix = url ? ` (${url})` : '';
    return `- [evidence:${item.id}] ${label}${sourceSuffix}${snippet ? ` -> ${snippet}` : ''}`;
  });

  const mainClaim = `${input.sectionTitle} should prioritize ${normalizeText(input.objective) || 'focused strategic execution'} based on current signals.`;

  return [
    `## ${input.sectionTitle}`,
    '',
    `Framework: ${input.sectionFramework}`,
    '',
    '### Context Inputs',
    ...contextLines,
    '',
    '### Strategic Analysis',
    `Claim: ${mainClaim}`,
    'Analysis: This section is generated using policy-first workflow and evidence-backed synthesis.',
    'Implication: Recommended actions are constrained by available validated inputs and evidence quality gates.',
    'Recommendation: Execute the actions in sequence and escalate when blocker conditions remain unresolved.',
    '',
    '### Evidence',
    ...(evidenceLines.length ? evidenceLines : ['- No external evidence was available at draft time.']),
    '',
    '### Limitations',
    'If new evidence or user clarifications are provided, this section should be revised before final publish.',
  ].join('\n');
}

function extractEvidenceIds(markdown: string): string[] {
  const matches = markdown.match(/\[evidence:([a-z0-9-]+)\]/gi) || [];
  const ids = matches
    .map((entry) => entry.match(/\[evidence:([a-z0-9-]+)\]/i)?.[1] || '')
    .filter(Boolean);
  return Array.from(new Set(ids));
}

function extractPrimaryClaim(markdown: string): string {
  const claimLine = markdown
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^Claim\s*:/i.test(line));
  if (!claimLine) return '';
  return claimLine.replace(/^Claim\s*:/i, '').trim();
}

async function upsertClaimRecord(params: {
  runId: string;
  workspaceId: string;
  sectionRunId: string;
  revisionId: string;
  claimText: string;
  evidenceRecordIds: string[];
}): Promise<void> {
  if (!normalizeText(params.claimText)) return;

  const existing = await prisma.processClaimRecord.findFirst({
    where: {
      processRunId: params.runId,
      sectionRunId: params.sectionRunId,
      revisionId: params.revisionId,
    },
  });

  const data = {
    processRunId: params.runId,
    researchJobId: params.workspaceId,
    sectionRunId: params.sectionRunId,
    revisionId: params.revisionId,
    claimText: params.claimText,
    material: true,
    evidenceRecordIdsJson: toJson(params.evidenceRecordIds),
    groundingStatus: params.evidenceRecordIds.length ? 'grounded' : 'ungrounded',
  };

  if (existing) {
    await prisma.processClaimRecord.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await prisma.processClaimRecord.create({ data });
}

async function ensureRunSections(run: ProcessRunRecord): Promise<void> {
  if (run.sectionRuns.length > 0) return;

  const compiledPlan =
    readRunPlan(run) ||
    compileProcessPlan({
      objective: normalizeText(run.objective) || 'Build business strategy',
      documentType: run.documentType,
    });

  const artifactsCount = compiledPlan.artifacts.length;
  const data: Prisma.ProcessSectionRunCreateManyInput[] = compiledPlan.sections.map((section) => {
    const displayTitle =
      artifactsCount > 1 ? `${section.title} [${section.artifactType.replace(/_/g, ' ')}]` : section.title;
    return {
      processRunId: run.id,
      researchJobId: run.researchJobId,
      sectionKey: section.nodeId,
      title: displayTitle,
      framework: section.framework,
      sortOrder: section.order,
      status: ProcessSectionStatus.PLANNED,
      requiredInputsJson: toJson(section.requiredInputs),
      requiredEvidenceJson: toJson({
        minEvidence: section.minEvidence,
        exitCriteria: section.exitCriteria,
        minWords: section.minWords,
        dependencies: section.dependsOnNodeIds,
        artifactType: section.artifactType,
        artifactKey: section.artifactKey,
        sectionSlug: section.sectionKey,
        nodeId: section.nodeId,
        standardId: section.standardId,
        standardVersion: section.standardVersion,
      }),
    };
  });

  await prisma.processSectionRun.createMany({
    data,
    skipDuplicates: true,
  });

  await prisma.processRun.update({
    where: { id: run.id },
    data: {
      metadataJson: toJson({
        ...asRecord(run.metadataJson),
        phase2: {
          ...asRecord(asRecord(run.metadataJson).phase2),
          plan: compiledPlan,
          planHash: compiledPlan.planHash,
          requestMode: compiledPlan.mode,
        },
      }),
    },
  });
}

async function ensureResearchEvidenceForRun(run: ProcessRunRecord): Promise<void> {
  const objective = normalizeText(run.objective) || 'Build business strategy';
  const evidence = await collectResearchEvidence({
    researchJobId: run.researchJobId,
    processRunId: run.id,
    method: (run.method || ProcessRunMethod.BAT_CORE) as 'NICHE_STANDARD' | 'BAT_CORE',
    objective,
  });

  if (!evidence.length) {
    await emitRunEvent({
      runId: run.id,
      workspaceId: run.researchJobId,
      type: PROCESS_EVENT_TYPES.LOG,
      message: 'Research adapter returned no evidence records.',
      payload: {
        stage: run.stage,
      },
    });
    return;
  }

  for (const item of evidence) {
    await prisma.processEvidenceRecord.create({
      data: {
        processRunId: run.id,
        researchJobId: run.researchJobId,
        sectionRunId: null,
        sourceType: normalizeText(item.sourceType) || 'unknown',
        refId: normalizeText(item.refId) || null,
        url: normalizeText(item.url) || null,
        title: normalizeText(item.title) || null,
        snippet: normalizeText(item.snippet) || null,
        fetchedAt: item.fetchedAt || new Date(),
        metadataJson: toJson(item.metadata || {}),
      },
    });
  }
}

async function runMethodSelection(run: ProcessRunRecord): Promise<WorkflowSelectionDecision> {
  const workspace = await prisma.researchJob.findUnique({
    where: { id: run.researchJobId },
    include: {
      discoveredCompetitors: {
        where: { isActive: true },
        take: 3,
      },
      client: true,
    },
  });

  if (!workspace) throw new Error(`Workspace ${run.researchJobId} not found`);
  const inputData = asRecord(workspace.inputData);
  const objective = getMethodObjective(inputData, normalizeText(run.objective) || 'Build strategy');

  const businessState = {
    niche: normalizeText(inputData.niche),
    businessType: normalizeText(inputData.businessType),
    website: normalizeText(inputData.website),
    hasCompetitors: workspace.discoveredCompetitors.length > 0,
  };

  const plan = readRunPlan(run);
  const requestModeRaw = normalizeText(asRecord(asRecord(run.metadataJson).phase2).requestMode).toLowerCase();
  const requestMode: ProcessRequestMode =
    requestModeRaw === 'section_bundle'
      ? 'section_bundle'
      : requestModeRaw === 'multi_doc_bundle'
        ? 'multi_doc_bundle'
        : 'single_doc';

  const decision = selectMethodV2({
    businessState,
    objective,
    nicheConfidence: estimateNicheConfidence({
      niche: businessState.niche,
      businessType: businessState.businessType,
      website: businessState.website,
      targetAudience: normalizeText(inputData.targetAudience),
    }),
    context: {
      requestMode,
      artifactTypes: plan?.artifacts.map((artifact) => artifact.artifactType) || [run.documentType],
    },
  });

  await prisma.processRun.update({
    where: { id: run.id },
    data: {
      method: decision.method === 'NICHE_STANDARD' ? ProcessRunMethod.NICHE_STANDARD : ProcessRunMethod.BAT_CORE,
      methodRuleId: decision.ruleId,
      methodInputsJson: toJson(decision.inputSnapshot),
      methodEvidenceJson: toJson(decision.evidenceRefs),
      objective,
    },
  });

  await logDecisionEvent({
    runId: run.id,
    workspaceId: run.researchJobId,
    stage: ProcessRunStage.METHOD_SELECTED,
    ruleId: decision.ruleId,
    inputSnapshot: decision.inputSnapshot,
    evidenceRefs: decision.evidenceRefs,
    output: decision.output,
  });

  return decision;
}

async function draftSections(
  run: ProcessRunRecord
): Promise<{ blockerPending: boolean; dependencyPending: boolean; draftedCount: number }> {
  assertRolePermission('Drafter', 'section.draft');

  const workspace = await prisma.researchJob.findUnique({
    where: { id: run.researchJobId },
    select: {
      inputData: true,
      discoveredCompetitors: {
        where: { isActive: true },
        orderBy: { relevanceScore: 'desc' },
        take: 12,
        select: {
          handle: true,
          profileUrl: true,
        },
      },
    },
  });

  if (!workspace) throw new Error(`Workspace ${run.researchJobId} not found`);
  const inputData = asRecord(workspace.inputData);
  const answeredTasks = await prisma.processQuestionTask.findMany({
    where: {
      processRunId: run.id,
      status: ProcessQuestionStatus.ANSWERED,
    },
    select: {
      fieldKey: true,
      answerJson: true,
    },
  });
  const availableInputs = buildAvailableInputs(inputData, answeredTasks);
  const runtimeAnswersState: Record<string, unknown> = { ...asRecord(inputData.runtimeAnswers) };
  const clientDomain = extractDomain(inputData.website);

  const evidenceRows = await prisma.processEvidenceRecord.findMany({
    where: {
      processRunId: run.id,
    },
    orderBy: { createdAt: 'desc' },
    take: 120,
  });

  let blockerPending = false;
  let dependencyPending = false;
  let draftedCount = 0;

  const sections = await prisma.processSectionRun.findMany({
    where: { processRunId: run.id },
    orderBy: { sortOrder: 'asc' },
    include: {
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        take: 1,
      },
    },
  });

  const sectionStatusByKey = new Map(
    sections.map((section) => [
      section.sectionKey,
      {
        status: section.status,
        hasRevision: Boolean(latestRevisionMarkdown(section)),
      },
    ])
  );

  for (const sectionRun of sections) {
    const contract = buildSectionContract(sectionRun);
    const existingMarkdown = latestRevisionMarkdown(sectionRun);
    if (
      normalizeText(existingMarkdown) &&
      (sectionRun.status === ProcessSectionStatus.DRAFTED ||
        sectionRun.status === ProcessSectionStatus.VALIDATED ||
        sectionRun.status === ProcessSectionStatus.READY ||
        sectionRun.status === ProcessSectionStatus.NEEDS_REVIEW)
    ) {
      sectionStatusByKey.set(sectionRun.sectionKey, {
        status: sectionRun.status,
        hasRevision: true,
      });
      continue;
    }

    const unresolvedDependencies = contract.dependencies.filter((dependencyKey) => {
      const dependency = sectionStatusByKey.get(dependencyKey);
      return !dependency || !dependency.hasRevision;
    });
    if (unresolvedDependencies.length > 0) {
      dependencyPending = true;
      await prisma.processSectionRun.update({
        where: { id: sectionRun.id },
        data: {
          status: ProcessSectionStatus.PLANNED,
          entrySatisfied: false,
          lastError: `Waiting for dependencies: ${unresolvedDependencies.join(', ')}`,
        },
      });
      continue;
    }

    let missing = contract.requiredInputs.filter((field) => !hasUsableValue(availableInputs[field.key]));
    if (missing.length > 0) {
      const hydratedAnswers: Record<string, unknown> = {};
      const evidenceRefs = new Set<string>();
      for (const field of missing) {
        const inferred = inferFieldFromEvidence({
          fieldKey: field.key,
          availableInputs,
          evidenceRows,
          discoveredCompetitors: workspace.discoveredCompetitors,
          clientDomain,
        });
        if (!inferred || !hasUsableValue(inferred.value)) continue;
        availableInputs[field.key] = inferred.value;
        hydratedAnswers[field.key] = inferred.value;
        for (const ref of inferred.evidenceRefs) {
          const normalizedRef = normalizeText(ref);
          if (normalizedRef) evidenceRefs.add(normalizedRef);
        }
      }

      if (Object.keys(hydratedAnswers).length > 0) {
        for (const [fieldKey, value] of Object.entries(hydratedAnswers)) {
          runtimeAnswersState[fieldKey] = value;
        }
        await prisma.researchJob.update({
          where: { id: run.researchJobId },
          data: {
            inputData: toJson({
              ...inputData,
              runtimeAnswers: runtimeAnswersState,
            }),
          },
        });

        await logDecisionEvent({
          runId: run.id,
          workspaceId: run.researchJobId,
          stage: ProcessRunStage.SECTION_DRAFTING,
          ruleId: 'manager/evidence_hydration/v1',
          inputSnapshot: {
            sectionKey: sectionRun.sectionKey,
            missingBeforeHydration: missing.map((field) => field.key),
          },
          evidenceRefs: [...evidenceRefs],
          output: {
            hydratedFields: Object.keys(hydratedAnswers),
          },
        });
      }

      missing = contract.requiredInputs.filter((field) => !hasUsableValue(availableInputs[field.key]));
    }

    for (const field of missing) {
      await ensureQuestionTask({
        runId: run.id,
        workspaceId: run.researchJobId,
        sectionRunId: sectionRun.id,
        sourceSectionKey: contract.sectionSlug,
        fieldKey: field.key,
        question: field.question,
        severity:
          field.severity === 'BLOCKER'
            ? ProcessQuestionSeverity.BLOCKER
            : field.severity === 'IMPORTANT'
              ? ProcessQuestionSeverity.IMPORTANT
              : ProcessQuestionSeverity.OPTIONAL,
        answerType: field.answerType,
        options: field.options,
        suggestedAnswers: field.suggestedAnswers,
        requestedBy: 'manager',
      });
    }

    const hasBlocker = missing.some((field) => field.severity === 'BLOCKER');
    if (hasBlocker) {
      blockerPending = true;
      await prisma.processSectionRun.update({
        where: { id: sectionRun.id },
        data: {
          status: ProcessSectionStatus.NEEDS_USER_INPUT,
          entrySatisfied: false,
          lastError: 'Blocked by missing required section inputs.',
        },
      });
      sectionStatusByKey.set(sectionRun.sectionKey, {
        status: ProcessSectionStatus.NEEDS_USER_INPUT,
        hasRevision: Boolean(latestRevisionMarkdown(sectionRun)),
      });
      continue;
    }

    const evidence = pickSectionEvidence(evidenceRows, contract.sectionSlug, Math.max(2, contract.minEvidence));
    const markdown = buildSectionDraftMarkdown({
      sectionTitle: contract.title,
      sectionFramework: contract.framework,
      objective: normalizeText(run.objective) || 'business growth',
      requiredInputs: contract.requiredInputs.map((field) => ({ key: field.key, label: field.label })),
      availableInputs,
      evidence,
    });

    const revisionNumber = (sectionRun.revisions[0]?.revisionNumber || 0) + 1;
    const revision = await prisma.processSectionRevision.create({
      data: {
        processRunId: run.id,
        researchJobId: run.researchJobId,
        sectionRunId: sectionRun.id,
        revisionNumber,
        markdown,
        summary: `Initial draft generated by policy workflow (revision ${revisionNumber}).`,
        createdByRole: 'Drafter',
        evidenceRecordIdsJson: toJson(evidence.map((item) => item.id)),
      },
    });

    const claim = extractPrimaryClaim(markdown);
    const evidenceIds = extractEvidenceIds(markdown);
    await upsertClaimRecord({
      runId: run.id,
      workspaceId: run.researchJobId,
      sectionRunId: sectionRun.id,
      revisionId: revision.id,
      claimText: claim,
      evidenceRecordIds: evidenceIds,
    });

    await prisma.processSectionRun.update({
      where: { id: sectionRun.id },
      data: {
        status: ProcessSectionStatus.DRAFTED,
        entrySatisfied: true,
        lastError: null,
      },
    });
    sectionStatusByKey.set(sectionRun.sectionKey, {
      status: ProcessSectionStatus.DRAFTED,
      hasRevision: true,
    });
    draftedCount += 1;
  }

  return { blockerPending, dependencyPending, draftedCount };
}

async function validateSections(run: ProcessRunRecord): Promise<{ blockerPending: boolean; shouldEscalate: boolean }> {
  assertRolePermission('FactChecker', 'factcheck.run');

  const workspace = await prisma.researchJob.findUnique({
    where: { id: run.researchJobId },
    select: { inputData: true },
  });
  if (!workspace) throw new Error(`Workspace ${run.researchJobId} not found`);

  const inputData = asRecord(workspace.inputData);
  const answeredTasks = await prisma.processQuestionTask.findMany({
    where: {
      processRunId: run.id,
      status: ProcessQuestionStatus.ANSWERED,
    },
    select: {
      fieldKey: true,
      answerJson: true,
    },
  });
  const availableInputs = buildAvailableInputs(inputData, answeredTasks);

  const sections = await prisma.processSectionRun.findMany({
    where: { processRunId: run.id },
    orderBy: { sortOrder: 'asc' },
    include: {
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        take: 1,
      },
    },
  });

  let blockerPending = false;
  let shouldEscalate = false;
  const sectionStatusByKey = new Map(
    sections.map((section) => [section.sectionKey, section.status])
  );

  for (const sectionRun of sections) {
    const contract = buildSectionContract(sectionRun);

    const unresolvedDependencies = contract.dependencies.filter((dependencyKey) => {
      const status = sectionStatusByKey.get(dependencyKey);
      return status !== ProcessSectionStatus.READY;
    });
    if (unresolvedDependencies.length > 0) {
      shouldEscalate = true;
      await prisma.processSectionRun.update({
        where: { id: sectionRun.id },
        data: {
          status: ProcessSectionStatus.NEEDS_REVIEW,
          exitSatisfied: false,
          lastError: `Dependency contract failed: ${unresolvedDependencies.join(', ')}`,
        },
      });
      sectionStatusByKey.set(sectionRun.sectionKey, ProcessSectionStatus.NEEDS_REVIEW);
      continue;
    }

    const markdown = latestRevisionMarkdown(sectionRun);
    if (!markdown) {
      blockerPending = true;
      await ensureQuestionTask({
        runId: run.id,
        workspaceId: run.researchJobId,
        sectionRunId: sectionRun.id,
        sourceSectionKey: contract.sectionSlug,
        fieldKey: `${sectionRun.sectionKey}__draft_missing`,
        question: `No draft exists yet for ${sectionRun.title}. Provide missing context so drafting can continue.`,
        severity: ProcessQuestionSeverity.BLOCKER,
      });
      await prisma.processSectionRun.update({
        where: { id: sectionRun.id },
        data: {
          status: ProcessSectionStatus.NEEDS_USER_INPUT,
          exitSatisfied: false,
          lastError: 'Section draft missing.',
        },
      });
      sectionStatusByKey.set(sectionRun.sectionKey, ProcessSectionStatus.NEEDS_USER_INPUT);
      continue;
    }

    const sectionEvidence = await prisma.processEvidenceRecord.findMany({
      where: {
        processRunId: run.id,
      },
      orderBy: { createdAt: 'desc' },
      take: 120,
    });

    const selectedEvidence = pickSectionEvidence(
      sectionEvidence,
      contract.sectionSlug,
      Math.max(2, contract.minEvidence)
    );
    const latestEvidenceAt = selectedEvidence
      .map((item) => item.fetchedAt)
      .filter((item): item is Date => item instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;

    const evaluations = evaluateSectionPolicyGates({
      section: {
        key: contract.sectionSlug,
        title: contract.title,
        framework: contract.framework,
        order: sectionRun.sortOrder,
        minWords: contract.minWords,
        minEvidence: contract.minEvidence,
        requiredInputs: contract.requiredInputs,
        exitCriteria: contract.exitCriteria,
      },
      markdown,
      availableInputs,
      evidenceCount: selectedEvidence.length,
      latestEvidenceAt,
    });

    for (const item of evaluations) {
      await prisma.processGateResult.create({
        data: {
          processRunId: run.id,
          researchJobId: run.researchJobId,
          sectionRunId: sectionRun.id,
          gateName: item.gateName,
          status:
            item.status === 'PASS'
              ? ProcessGateStatus.PASS
              : item.status === 'FAIL'
                ? ProcessGateStatus.FAIL
                : ProcessGateStatus.HOLD,
          passed: item.passed,
          score: item.score,
          ruleId: item.ruleId,
          reasonsJson: toJson(item.reasons),
          evidenceRecordIdsJson: toJson(selectedEvidence.map((evidence) => evidence.id)),
        },
      });
    }

    const summary = summarizeGateEvaluations(evaluations);
    const missingRequired = contract.requiredInputs.filter((field) => !hasUsableValue(availableInputs[field.key]));
    for (const field of missingRequired) {
      const severity =
        field.severity === 'BLOCKER'
          ? ProcessQuestionSeverity.BLOCKER
          : field.severity === 'IMPORTANT'
            ? ProcessQuestionSeverity.IMPORTANT
            : ProcessQuestionSeverity.OPTIONAL;
      await ensureQuestionTask({
        runId: run.id,
        workspaceId: run.researchJobId,
        sectionRunId: sectionRun.id,
        sourceSectionKey: contract.sectionSlug,
        fieldKey: field.key,
        question: field.question,
        severity,
        answerType: field.answerType,
        options: field.options,
        suggestedAnswers: field.suggestedAnswers,
      });
      if (BLOCKER_SEVERITIES.has(severity)) {
        blockerPending = true;
      }
    }

    if (summary.shouldEscalate) {
      shouldEscalate = true;
      await prisma.processSectionRun.update({
        where: { id: sectionRun.id },
        data: {
          status: ProcessSectionStatus.NEEDS_REVIEW,
          exitSatisfied: false,
          lastError: summary.reasons.join(' | ').slice(0, 1000),
        },
      });
      sectionStatusByKey.set(sectionRun.sectionKey, ProcessSectionStatus.NEEDS_REVIEW);
      continue;
    }

    if (summary.passed) {
      await prisma.processSectionRun.update({
        where: { id: sectionRun.id },
        data: {
          status: ProcessSectionStatus.READY,
          exitSatisfied: true,
          lastError: null,
        },
      });
      sectionStatusByKey.set(sectionRun.sectionKey, ProcessSectionStatus.READY);

      await emitRunEvent({
        runId: run.id,
        workspaceId: run.researchJobId,
        type: PROCESS_EVENT_TYPES.SECTION_READY,
        message: `Section ready: ${sectionRun.sectionKey}`,
        payload: {
          sectionRunId: sectionRun.id,
          sectionKey: sectionRun.sectionKey,
        },
      });
      continue;
    }

    await prisma.processSectionRun.update({
      where: { id: sectionRun.id },
      data: {
        status: missingRequired.length > 0 ? ProcessSectionStatus.NEEDS_USER_INPUT : ProcessSectionStatus.NEEDS_REVIEW,
        exitSatisfied: false,
        lastError: summary.reasons.join(' | ').slice(0, 1000),
      },
    });
    sectionStatusByKey.set(
      sectionRun.sectionKey,
      missingRequired.length > 0 ? ProcessSectionStatus.NEEDS_USER_INPUT : ProcessSectionStatus.NEEDS_REVIEW
    );

    if (missingRequired.some((field) => field.severity === 'BLOCKER')) {
      blockerPending = true;
    }
  }

  return { blockerPending, shouldEscalate };
}

async function composeDocument(run: ProcessRunRecord): Promise<void> {
  assertRolePermission('Publisher', 'compose.document');

  const sections = await prisma.processSectionRun.findMany({
    where: { processRunId: run.id },
    orderBy: { sortOrder: 'asc' },
    include: {
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        take: 1,
      },
    },
  });

  const plan = readRunPlan(run);
  const artifactOrder = new Map<string, number>();
  if (plan) {
    plan.artifacts.forEach((artifact, index) => {
      artifactOrder.set(artifact.artifactKey, index + 1);
    });
  }

  const grouped = new Map<string, Array<{ title: string; markdown: string; artifactType: string; sortOrder: number }>>();
  for (const section of sections) {
    const markdown = latestRevisionMarkdown(section);
    if (!normalizeText(markdown)) continue;
    const contract = buildSectionContract(section);
    const artifactKey = contract.artifactKey || 'business_strategy_1';
    const bucket = grouped.get(artifactKey) || [];
    bucket.push({
      title: section.title,
      markdown,
      artifactType: contract.artifactType,
      sortOrder: section.sortOrder,
    });
    grouped.set(artifactKey, bucket);
  }

  const orderedArtifactKeys = [...grouped.keys()].sort((left, right) => {
    const leftOrder = artifactOrder.get(left) || 9999;
    const rightOrder = artifactOrder.get(right) || 9999;
    return leftOrder - rightOrder || left.localeCompare(right);
  });

  const artifactBlocks: string[] = [];
  for (const artifactKey of orderedArtifactKeys) {
    const parts = grouped.get(artifactKey) || [];
    if (!parts.length) continue;
    parts.sort((a, b) => a.sortOrder - b.sortOrder);
    const artifactType = parts[0].artifactType || 'BUSINESS_STRATEGY';
    const title = artifactType.replace(/_/g, ' ');
    artifactBlocks.push(
      [
        `## Artifact: ${title}`,
        `Artifact key: ${artifactKey}`,
        '',
        ...parts.map((part) => part.markdown),
      ].join('\n\n')
    );
  }

  const header = [
    '# Strategy Deliverables',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Process Run: ${run.id}`,
    `Mode: ${normalizeText(asRecord(asRecord(run.metadataJson).phase2).requestMode) || 'single_doc'}`,
    '',
  ].join('\n');

  const composedMarkdown = [header, ...artifactBlocks].join('\n\n---\n\n').trim();

  await prisma.processRun.update({
    where: { id: run.id },
    data: {
      composedMarkdown,
    },
  });
}

async function runFinalGate(run: ProcessRunRecord): Promise<{ ready: boolean; waitForInput: boolean; escalate: boolean; reason: string }> {
  assertRolePermission('Publisher', 'publish.final_gate');

  const sectionReadiness = await prisma.processSectionRun.findMany({
    where: { processRunId: run.id },
    select: { status: true },
  });

  const waitingSections = sectionReadiness.filter(
    (section) => section.status === ProcessSectionStatus.NEEDS_USER_INPUT
  ).length;
  if (waitingSections > 0) {
    return {
      ready: false,
      waitForInput: true,
      escalate: false,
      reason: `${waitingSections} section(s) are waiting for user input.`,
    };
  }

  const sectionNeedsReview = sectionReadiness.filter(
    (section) => section.status === ProcessSectionStatus.NEEDS_REVIEW
  ).length;
  if (sectionNeedsReview > 0) {
    return {
      ready: false,
      waitForInput: false,
      escalate: true,
      reason: `${sectionNeedsReview} section(s) require human review.`,
    };
  }

  const incompleteSections = sectionReadiness.filter(
    (section) =>
      section.status !== ProcessSectionStatus.READY && section.status !== ProcessSectionStatus.LOCKED
  ).length;
  if (incompleteSections > 0) {
    return {
      ready: false,
      waitForInput: false,
      escalate: true,
      reason: `${incompleteSections} section(s) are incomplete at final gate.`,
    };
  }

  const unresolvedImportantOrBlocker = await prisma.processQuestionTask.count({
    where: {
      processRunId: run.id,
      status: ProcessQuestionStatus.OPEN,
      severity: {
        in: [ProcessQuestionSeverity.BLOCKER, ProcessQuestionSeverity.IMPORTANT],
      },
    },
  });

  if (unresolvedImportantOrBlocker > 0) {
    return {
      ready: false,
      waitForInput: true,
      escalate: false,
      reason: `${unresolvedImportantOrBlocker} important/blocker question(s) still open.`,
    };
  }

  const claims = await prisma.processClaimRecord.findMany({
    where: {
      processRunId: run.id,
      material: true,
    },
  });

  const ungroundedClaims = claims.filter((claim) => {
    const refs = Array.isArray(claim.evidenceRecordIdsJson) ? claim.evidenceRecordIdsJson : [];
    return refs.length === 0;
  });

  if (ungroundedClaims.length > 0) {
    return {
      ready: false,
      waitForInput: false,
      escalate: true,
      reason: `${ungroundedClaims.length} material claim(s) have no evidence lineage.`,
    };
  }

  const hasComposed = normalizeText(run.composedMarkdown).length > 0;
  if (!hasComposed) {
    return {
      ready: false,
      waitForInput: false,
      escalate: true,
      reason: 'Composed markdown is empty.',
    };
  }

  return {
    ready: true,
    waitForInput: false,
    escalate: false,
    reason: 'All final gates passed.',
  };
}

async function handleFailure(run: ProcessRunRecord, error: unknown): Promise<void> {
  const message = normalizeText((error as Error)?.message || error);
  await prisma.processRun.update({
    where: { id: run.id },
    data: {
      stage: ProcessRunStage.FAILED,
      status: ProcessRunStatus.FAILED,
      lastError: message || 'Unknown process failure',
    },
  });

  await emitRunEvent({
    runId: run.id,
    workspaceId: run.researchJobId,
    type: PROCESS_EVENT_TYPES.LOG,
    message: 'Process run failed.',
    payload: {
      stage: run.stage,
      error: message || 'Unknown process failure',
    },
  });
}

async function runStageMachine(runId: string): Promise<void> {
  let safety = 0;

  while (safety < 30) {
    safety += 1;
    const run = await loadRunStrictById(runId);

    if (
      run.stage === ProcessRunStage.READY ||
      run.stage === ProcessRunStage.FAILED ||
      run.stage === ProcessRunStage.NEEDS_HUMAN_REVIEW
    ) {
      return;
    }

    if (run.stage === ProcessRunStage.WAITING_USER && run.status === ProcessRunStatus.WAITING_USER) {
      return;
    }

    try {
      if (run.stage === ProcessRunStage.INTAKE_READY) {
        const workspace = await prisma.researchJob.findUnique({
          where: { id: run.researchJobId },
          select: { inputData: true },
        });
        if (!workspace) throw new Error(`Workspace ${run.researchJobId} not found`);
        const inputData = asRecord(workspace.inputData);
        const intakeReady = hasUsableValue(inputData.intakeCompletedAt) || hasUsableValue(inputData.source);

        if (!intakeReady) {
          await ensureQuestionTask({
            runId: run.id,
            workspaceId: run.researchJobId,
            fieldKey: 'intake_completion_required',
            question: 'Please complete intake before strategy generation can continue.',
            severity: ProcessQuestionSeverity.BLOCKER,
          });

          await updateRunStage({
            run,
            to: ProcessRunStage.WAITING_USER,
            status: ProcessRunStatus.WAITING_USER,
            message: 'Run paused because intake is incomplete.',
            payload: { reason: 'intake_incomplete' },
          });
          return;
        }

        await updateRunStage({
          run,
          to: ProcessRunStage.METHOD_SELECTED,
          status: ProcessRunStatus.RUNNING,
          message: 'Intake validated. Proceeding to explicit method selection.',
        });
        continue;
      }

      if (run.stage === ProcessRunStage.METHOD_SELECTED) {
        const decision = await runMethodSelection(run);
        await updateRunStage({
          run,
          to: ProcessRunStage.RESEARCHING,
          status: ProcessRunStatus.RUNNING,
          message: `Method selected: ${decision.method}`,
          payload: {
            method: decision.method,
            ruleId: decision.ruleId,
            score: decision.score,
          },
        });
        continue;
      }

      if (run.stage === ProcessRunStage.RESEARCHING) {
        assertRolePermission('Researcher', 'research.web_search');
        await ensureResearchEvidenceForRun(run);
        await updateRunStage({
          run,
          to: ProcessRunStage.SECTION_PLANNING,
          status: ProcessRunStatus.RUNNING,
          message: 'Research complete. Planning section runs.',
        });
        continue;
      }

      if (run.stage === ProcessRunStage.SECTION_PLANNING) {
        await ensureRunSections(run);
        await updateRunStage({
          run,
          to: ProcessRunStage.SECTION_DRAFTING,
          status: ProcessRunStatus.RUNNING,
          message: 'Section plans prepared. Starting drafting stage.',
        });
        continue;
      }

      if (run.stage === ProcessRunStage.SECTION_DRAFTING || run.stage === ProcessRunStage.WAITING_USER) {
        const { blockerPending, dependencyPending, draftedCount } = await draftSections(run);
        if (blockerPending) {
          await updateRunStage({
            run,
            to: ProcessRunStage.WAITING_USER,
            status: ProcessRunStatus.WAITING_USER,
            message: 'Waiting for blocker inputs before drafting can continue.',
          });
          return;
        }

        if (dependencyPending) {
          if (draftedCount > 0) {
            await emitRunEvent({
              runId: run.id,
              workspaceId: run.researchJobId,
              type: PROCESS_EVENT_TYPES.LOG,
              message: 'Continuing drafting to resolve section dependencies.',
            });
            continue;
          }
          throw new Error('Drafting is blocked by unresolved section dependencies with no progress.');
        }

        await updateRunStage({
          run,
          to: ProcessRunStage.SECTION_VALIDATING,
          status: ProcessRunStatus.RUNNING,
          message: 'Section drafts ready. Running policy validation.',
        });
        continue;
      }

      if (run.stage === ProcessRunStage.SECTION_VALIDATING) {
        const { blockerPending, shouldEscalate } = await validateSections(run);

        if (shouldEscalate) {
          await prisma.processEscalationRecord.create({
            data: {
              processRunId: run.id,
              researchJobId: run.researchJobId,
              reason: 'Section gate escalation',
              details: 'A safety or consistency gate failed during section validation.',
              status: ProcessEscalationStatus.OPEN,
              createdBy: 'system',
            },
          });

          await updateRunStage({
            run,
            to: ProcessRunStage.NEEDS_HUMAN_REVIEW,
            status: ProcessRunStatus.NEEDS_HUMAN_REVIEW,
            message: 'Escalated to human review due to fail-closed policy gates.',
          });

          await emitRunEvent({
            runId: run.id,
            workspaceId: run.researchJobId,
            type: PROCESS_EVENT_TYPES.ESCALATED,
            message: 'Run escalated to human review during section validation.',
            payload: {
              reason: 'policy_gate_failed',
            },
          });
          return;
        }

        if (blockerPending) {
          await updateRunStage({
            run,
            to: ProcessRunStage.WAITING_USER,
            status: ProcessRunStatus.WAITING_USER,
            message: 'Waiting for blocker input raised during validation stage.',
          });
          return;
        }

        await updateRunStage({
          run,
          to: ProcessRunStage.COMPOSING,
          status: ProcessRunStatus.RUNNING,
          message: 'Sections validated. Composing full document markdown.',
        });
        continue;
      }

      if (run.stage === ProcessRunStage.COMPOSING) {
        await composeDocument(run);
        await updateRunStage({
          run,
          to: ProcessRunStage.FINAL_GATE,
          status: ProcessRunStatus.RUNNING,
          message: 'Composed document. Running final policy gate.',
        });
        continue;
      }

      if (run.stage === ProcessRunStage.FINAL_GATE) {
        const finalGate = await runFinalGate(run);

        await logDecisionEvent({
          runId: run.id,
          workspaceId: run.researchJobId,
          stage: ProcessRunStage.FINAL_GATE,
          ruleId: 'final-gate/business_strategy/v2',
          inputSnapshot: {
            stage: run.stage,
            status: run.status,
          },
          evidenceRefs: [],
          output: {
            ...finalGate,
          },
        });

        if (finalGate.waitForInput) {
          await updateRunStage({
            run,
            to: ProcessRunStage.WAITING_USER,
            status: ProcessRunStatus.WAITING_USER,
            message: `Final gate paused: ${finalGate.reason}`,
          });
          return;
        }

        if (finalGate.escalate) {
          await prisma.processEscalationRecord.create({
            data: {
              processRunId: run.id,
              researchJobId: run.researchJobId,
              reason: 'Final gate escalation',
              details: finalGate.reason,
              status: ProcessEscalationStatus.OPEN,
              createdBy: 'system',
            },
          });

          await updateRunStage({
            run,
            to: ProcessRunStage.NEEDS_HUMAN_REVIEW,
            status: ProcessRunStatus.NEEDS_HUMAN_REVIEW,
            message: `Final gate escalation: ${finalGate.reason}`,
          });

          await emitRunEvent({
            runId: run.id,
            workspaceId: run.researchJobId,
            type: PROCESS_EVENT_TYPES.ESCALATED,
            message: 'Run escalated during final publish gate.',
            payload: { reason: finalGate.reason },
          });
          return;
        }

        if (finalGate.ready) {
          await updateRunStage({
            run,
            to: ProcessRunStage.READY,
            status: ProcessRunStatus.READY,
            message: 'Process run is ready.',
          });
          await emitRunEvent({
            runId: run.id,
            workspaceId: run.researchJobId,
            type: PROCESS_EVENT_TYPES.READY,
            message: 'Business strategy is ready for client review.',
          });
          return;
        }

        await updateRunStage({
          run,
          to: ProcessRunStage.NEEDS_HUMAN_REVIEW,
          status: ProcessRunStatus.NEEDS_HUMAN_REVIEW,
          message: 'Final gate did not pass and requires human review.',
          payload: {
            reason: finalGate.reason,
          },
        });

        return;
      }
    } catch (error) {
      await handleFailure(run, error);
      return;
    }
  }
}

async function loadRunStrictById(runId: string): Promise<ProcessRunRecord> {
  const run = await prisma.processRun.findUnique({
    where: { id: runId },
    include: {
      sectionRuns: {
        include: {
          revisions: {
            orderBy: { revisionNumber: 'desc' },
            take: 1,
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      questionTasks: true,
      gateResults: true,
      claimRecords: true,
    },
  });

  if (!run) {
    throw new Error(`Process run ${runId} not found`);
  }

  return run;
}

export async function createProcessRun(input: CreateProcessRunInput): Promise<ProcessRunRecord> {
  if (!isProcessControlV2Enabled()) {
    throw new Error('PROCESS_CONTROL_V2_DISABLED');
  }

  const workspaceId = normalizeText(input.workspaceId);
  if (!workspaceId) throw new Error('workspaceId is required');

  const documentType = input.documentType || ProcessRunDocumentType.BUSINESS_STRATEGY;

  const idempotencyKey = sanitizeIdempotencyKey(input.idempotencyKey);
  if (idempotencyKey) {
    const existing = await prisma.processRun.findFirst({
      where: {
        researchJobId: workspaceId,
        idempotencyKey,
      },
      include: {
        sectionRuns: {
          include: {
            revisions: {
              orderBy: { revisionNumber: 'desc' },
              take: 1,
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        questionTasks: true,
        gateResults: true,
        claimRecords: true,
      },
    });
    if (existing) {
      return existing;
    }
  }

  const workspace = await prisma.researchJob.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      inputData: true,
      client: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!workspace) {
    throw new Error('Workspace not found');
  }

  const inputData = asRecord(workspace.inputData);
  const objectiveSeed = normalizeText(input.objective) || getMethodObjective(inputData, 'Build business strategy');
  const compiledPlan = compileProcessPlan({
    objective: objectiveSeed,
    documentType,
    requestMode: input.requestMode,
    targets: input.targets,
  });
  const objective = compiledPlan.rootObjective;

  const run = await prisma.processRun.create({
    data: {
      researchJobId: workspaceId,
      documentType: ProcessRunDocumentType.BUSINESS_STRATEGY,
      stage: ProcessRunStage.INTAKE_READY,
      status: ProcessRunStatus.RUNNING,
      objective,
      idempotencyKey: idempotencyKey || null,
      maxRetries: processControlV2DefaultMaxRetries(),
      maxRetryWithEvidence: processControlV2DefaultMaxRetryWithEvidence(),
      metadataJson: toJson({
        startedBy: normalizeText(input.startedBy) || 'system',
        brandName: normalizeText(workspace.client?.name),
        phase2: {
          requestMode: compiledPlan.mode,
          planHash: compiledPlan.planHash,
          plan: compiledPlan,
          requestedTargets: input.targets || [],
        },
      }),
    },
    include: {
      sectionRuns: {
        include: {
          revisions: {
            orderBy: { revisionNumber: 'desc' },
            take: 1,
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      questionTasks: true,
      gateResults: true,
      claimRecords: true,
    },
  });

  await emitRunEvent({
    runId: run.id,
    workspaceId,
    type: PROCESS_EVENT_TYPES.LOG,
    message: 'Process run created.',
    payload: {
      stage: run.stage,
      status: run.status,
      documentType: run.documentType,
      objective: run.objective,
      requestMode: compiledPlan.mode,
      artifactTypes: compiledPlan.artifacts.map((artifact) => artifact.artifactType),
      planHash: compiledPlan.planHash,
    },
  });

  await runStageMachine(run.id);
  return loadRunStrictById(run.id);
}

export async function autoStartBusinessStrategyProcessRun(workspaceId: string, options?: { trigger?: string }): Promise<void> {
  if (!isProcessControlV2Enabled() || !isProcessControlV2AutoStartEnabled()) return;

  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) return;

  const existingActive = await prisma.processRun.findFirst({
    where: {
      researchJobId: normalizedWorkspaceId,
      documentType: ProcessRunDocumentType.BUSINESS_STRATEGY,
      stage: {
        in: [
          ProcessRunStage.INTAKE_READY,
          ProcessRunStage.METHOD_SELECTED,
          ProcessRunStage.RESEARCHING,
          ProcessRunStage.SECTION_PLANNING,
          ProcessRunStage.SECTION_DRAFTING,
          ProcessRunStage.SECTION_VALIDATING,
          ProcessRunStage.WAITING_USER,
          ProcessRunStage.COMPOSING,
          ProcessRunStage.FINAL_GATE,
        ],
      },
    },
  });

  if (existingActive) return;

  const plannedHeaders = await planBusinessStrategyHeaders({
    workspaceId: normalizedWorkspaceId,
    objective: 'Draft a near-complete business strategy in the background.',
  });

  const idempotencyKey = `auto-business-strategy-${new Date().toISOString().slice(0, 13)}-${normalizeText(options?.trigger) || 'intake'}`;
  const run = await createProcessRun({
    workspaceId: normalizedWorkspaceId,
    documentType: ProcessRunDocumentType.BUSINESS_STRATEGY,
    objective: plannedHeaders.objective,
    requestMode: 'section_bundle',
    targets: plannedHeaders.targets,
    idempotencyKey,
    startedBy: 'system:auto_start',
  });

  const existingPlannerDecision = await prisma.processDecisionEvent.findFirst({
    where: {
      processRunId: run.id,
      ruleId: plannedHeaders.ruleId,
    },
    select: { id: true },
  });
  if (!existingPlannerDecision) {
    await prisma.processDecisionEvent.create({
      data: {
        processRunId: run.id,
        researchJobId: normalizedWorkspaceId,
        stage: ProcessRunStage.INTAKE_READY,
        ruleId: plannedHeaders.ruleId,
        inputSnapshotJson: toJson(plannedHeaders.inputSnapshot),
        evidenceRefsJson: toJson(plannedHeaders.evidenceRefs),
        outputJson: toJson({
          objective: plannedHeaders.objective,
          coreSectionKeys: plannedHeaders.coreSectionKeys,
          nicheSectionKeys: plannedHeaders.nicheSectionKeys,
          selectedNichePackId: plannedHeaders.selectedNichePackId,
          targets: plannedHeaders.targets,
        }),
      },
    });
  }
}

export async function getProcessRun(workspaceId: string, runId: string): Promise<ProcessRunRecord> {
  return loadRunStrict(normalizeText(workspaceId), normalizeText(runId));
}

export async function getProcessRunPlan(workspaceId: string, runId: string) {
  const run = await loadRunStrict(normalizeText(workspaceId), normalizeText(runId));
  const plan = readRunPlan(run);
  if (!plan) {
    return {
      plan: null,
      planHash: null,
      requestMode: null,
      artifacts: [],
    };
  }

  return {
    plan,
    planHash: plan.planHash,
    requestMode: plan.mode,
    artifacts: plan.artifacts.map((artifact) => ({
      artifactKey: artifact.artifactKey,
      artifactType: artifact.artifactType,
      objective: artifact.objective,
      requestedSections: artifact.requestedSections,
      selectedSections: artifact.selectedSections,
      standardId: artifact.standardId,
      standardVersion: artifact.standardVersion,
    })),
  };
}

export async function listProcessRuns(workspaceId: string, options?: { limit?: number }) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    throw new Error('workspaceId is required');
  }

  const limitRaw = Number(options?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 20;

  return prisma.processRun.findMany({
    where: { researchJobId: normalizedWorkspaceId },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    include: {
      sectionRuns: {
        select: {
          id: true,
          status: true,
          updatedAt: true,
        },
      },
      questionTasks: {
        select: {
          id: true,
          status: true,
          severity: true,
          createdAt: true,
        },
      },
      escalationRecords: {
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });
}

export async function resumeProcessRun(input: ResumeProcessRunInput): Promise<ProcessRunRecord> {
  const workspaceId = normalizeText(input.workspaceId);
  const runId = normalizeText(input.runId);
  if (!workspaceId || !runId) {
    throw new Error('workspaceId and runId are required');
  }

  const mode = input.mode || 'retry';
  const run = await loadRunStrict(workspaceId, runId);

  if (run.stage === ProcessRunStage.READY) {
    return run;
  }

  const updateData: Prisma.ProcessRunUpdateInput = {
    status: ProcessRunStatus.RUNNING,
    pausedAt: null,
    lastError: null,
    lastRetriedAt: new Date(),
  };

  if (mode === 'retry_with_new_evidence') {
    if (run.retryWithNewEvidenceCount >= run.maxRetryWithEvidence) {
      throw new Error('retry_with_new_evidence limit reached');
    }
    updateData.retryWithNewEvidenceCount = { increment: 1 };
    if (run.stage !== ProcessRunStage.RESEARCHING) {
      assertStageTransition(run.stage, ProcessRunStage.RESEARCHING);
      updateData.stage = ProcessRunStage.RESEARCHING;
    }
  } else {
    if (run.retryCount >= run.maxRetries) {
      throw new Error('retry limit reached');
    }
    updateData.retryCount = { increment: 1 };
    if (run.stage === ProcessRunStage.WAITING_USER) {
      updateData.stage = ProcessRunStage.SECTION_DRAFTING;
    }
    if (run.stage === ProcessRunStage.NEEDS_HUMAN_REVIEW) {
      updateData.stage = ProcessRunStage.SECTION_VALIDATING;
    }
    if (run.stage === ProcessRunStage.FAILED) {
      updateData.stage = ProcessRunStage.SECTION_DRAFTING;
    }
  }

  await prisma.processRun.update({
    where: { id: run.id },
    data: updateData,
  });

  await emitRunEvent({
    runId: run.id,
    workspaceId,
    type: PROCESS_EVENT_TYPES.LOG,
    message: `Run resumed (${mode}).`,
    payload: {
      requestedBy: normalizeText(input.requestedBy) || 'system',
      mode,
      previousStage: run.stage,
    },
  });

  await runStageMachine(run.id);
  return loadRunStrictById(run.id);
}

export async function escalateProcessRun(input: EscalateProcessRunInput): Promise<ProcessRunRecord> {
  const workspaceId = normalizeText(input.workspaceId);
  const runId = normalizeText(input.runId);
  if (!workspaceId || !runId) {
    throw new Error('workspaceId and runId are required');
  }

  const run = await loadRunStrict(workspaceId, runId);

  await prisma.processEscalationRecord.create({
    data: {
      processRunId: run.id,
      researchJobId: workspaceId,
      reason: normalizeText(input.reason) || 'Manual escalation requested',
      details: normalizeText(input.details) || null,
      status: ProcessEscalationStatus.OPEN,
      createdBy: normalizeText(input.requestedBy) || 'user',
    },
  });

  await prisma.processRun.update({
    where: { id: run.id },
    data: {
      stage: ProcessRunStage.NEEDS_HUMAN_REVIEW,
      status: ProcessRunStatus.NEEDS_HUMAN_REVIEW,
    },
  });

  await emitRunEvent({
    runId: run.id,
    workspaceId,
    type: PROCESS_EVENT_TYPES.ESCALATED,
    message: 'Run escalated manually.',
    payload: {
      reason: normalizeText(input.reason),
      details: normalizeText(input.details),
    },
  });

  return loadRunStrictById(run.id);
}

export async function listProcessRunQuestions(workspaceId: string, runId: string) {
  const run = await loadRunStrict(workspaceId, runId);
  const rows = await prisma.processQuestionTask.findMany({
    where: {
      processRunId: run.id,
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    include: {
      sectionRun: {
        select: {
          sectionKey: true,
          requiredInputsJson: true,
        },
      },
      processRun: {
        select: {
          id: true,
          stage: true,
          status: true,
        },
      },
    },
  });

  return rows.map((row) => mapQuestionTaskForPortal(row));
}

function parseQuestionMetaFromSurfacesJson(value: unknown): {
  answerType: SectionFieldRequirement['answerType'];
  options: Array<{ value: string; label: string }>;
  suggestedAnswers: string[];
  sourceSectionKey: string | null;
} {
  if (Array.isArray(value)) {
    return {
      answerType: 'text',
      options: [],
      suggestedAnswers: [],
      sourceSectionKey: null,
    };
  }

  const raw = asRecord(value);
  return {
    answerType: normalizeAnswerType(raw.answerType),
    options: parseQuestionOptions(raw.options),
    suggestedAnswers: parseSuggestedAnswers(raw.suggestedAnswers),
    sourceSectionKey: normalizeText(raw.sourceSectionKey) || null,
  };
}

function findFieldRequirementMeta(requiredInputsJson: unknown, fieldKey: string): SectionFieldRequirement | null {
  const normalizedField = normalizeText(fieldKey);
  if (!normalizedField) return null;
  const fields = parseRequiredInputs(requiredInputsJson);
  return fields.find((field) => field.key === normalizedField) || null;
}

function mapQuestionTaskForPortal(
  task: ProcessQuestionTask & {
    sectionRun?: { sectionKey: string; requiredInputsJson: Prisma.JsonValue | null } | null;
    processRun?: { id: string; stage: ProcessRunStage; status: ProcessRunStatus } | null;
  }
) {
  const fromSurfaces = parseQuestionMetaFromSurfacesJson(task.surfacesJson);
  const fallbackFieldMeta = findFieldRequirementMeta(task.sectionRun?.requiredInputsJson, task.fieldKey);

  return {
    id: task.id,
    answerType: fromSurfaces.answerType || fallbackFieldMeta?.answerType || 'text',
    options: fromSurfaces.options.length ? fromSurfaces.options : fallbackFieldMeta?.options || [],
    suggestedAnswers: fromSurfaces.suggestedAnswers.length
      ? fromSurfaces.suggestedAnswers
      : fallbackFieldMeta?.suggestedAnswers || [],
    sourceSectionKey:
      fromSurfaces.sourceSectionKey || normalizeText(task.sectionRun?.sectionKey) || null,
    processRunId: task.processRunId,
    sectionRunId: task.sectionRunId,
    fieldKey: task.fieldKey,
    question: task.question,
    severity: task.severity,
    status: task.status,
    surfacesJson: task.surfacesJson,
    answerJson: task.answerJson,
    answeredAt: task.answeredAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export async function getActiveWorkspaceProcessQuestion(workspaceId: string) {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) {
    throw new Error('workspaceId is required');
  }

  const rows = await prisma.processQuestionTask.findMany({
    where: {
      researchJobId: normalizedWorkspaceId,
      status: ProcessQuestionStatus.OPEN,
      severity: {
        in: [ProcessQuestionSeverity.BLOCKER, ProcessQuestionSeverity.IMPORTANT],
      },
      processRun: {
        stage: {
          in: [
            ProcessRunStage.INTAKE_READY,
            ProcessRunStage.METHOD_SELECTED,
            ProcessRunStage.RESEARCHING,
            ProcessRunStage.SECTION_PLANNING,
            ProcessRunStage.SECTION_DRAFTING,
            ProcessRunStage.SECTION_VALIDATING,
            ProcessRunStage.WAITING_USER,
            ProcessRunStage.COMPOSING,
            ProcessRunStage.FINAL_GATE,
          ],
        },
        status: {
          in: [ProcessRunStatus.RUNNING, ProcessRunStatus.WAITING_USER, ProcessRunStatus.PAUSED],
        },
      },
    },
    include: {
      sectionRun: {
        select: {
          sectionKey: true,
          requiredInputsJson: true,
        },
      },
      processRun: {
        select: {
          id: true,
          stage: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 80,
  });

  if (rows.length === 0) return null;
  const rank = { BLOCKER: 0, IMPORTANT: 1, OPTIONAL: 2 } as const;
  rows.sort((left, right) => {
    const leftRank = rank[left.severity as keyof typeof rank] ?? 9;
    const rightRank = rank[right.severity as keyof typeof rank] ?? 9;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.createdAt.getTime() - right.createdAt.getTime();
  });

  return mapQuestionTaskForPortal(rows[0]);
}

export async function answerQuestionTask(input: {
  workspaceId: string;
  taskId: string;
  answer: unknown;
  answeredBy?: string;
}): Promise<ProcessRunRecord> {
  const workspaceId = normalizeText(input.workspaceId);
  const taskId = normalizeText(input.taskId);
  if (!workspaceId || !taskId) throw new Error('workspaceId and taskId are required');

  const task = await prisma.processQuestionTask.findFirst({
    where: {
      id: taskId,
      researchJobId: workspaceId,
    },
  });

  if (!task) throw new Error('Question task not found');

  await prisma.processQuestionTask.update({
    where: { id: task.id },
    data: {
      status: ProcessQuestionStatus.ANSWERED,
      answerJson: toJson(input.answer),
      answeredBy: normalizeText(input.answeredBy) || 'user',
      answeredAt: new Date(),
    },
  });

  const workspace = await prisma.researchJob.findUnique({
    where: { id: workspaceId },
    select: { inputData: true },
  });
  if (workspace) {
    const inputData = asRecord(workspace.inputData);
    const runtimeAnswers = asRecord(inputData.runtimeAnswers);
    runtimeAnswers[task.fieldKey] = input.answer;
    await prisma.researchJob.update({
      where: { id: workspaceId },
      data: {
        inputData: toJson({
          ...inputData,
          runtimeAnswers,
        }),
      },
    });
  }

  await emitRunEvent({
    runId: task.processRunId,
    workspaceId,
    type: PROCESS_EVENT_TYPES.QUESTION_RESOLVED,
    message: `Question answered: ${task.fieldKey}`,
    payload: {
      questionTaskId: task.id,
      sectionRunId: task.sectionRunId,
      fieldKey: task.fieldKey,
      answeredBy: normalizeText(input.answeredBy) || 'user',
    },
  });

  await resumeProcessRun({
    workspaceId,
    runId: task.processRunId,
    mode: 'retry',
    requestedBy: normalizeText(input.answeredBy) || 'user',
  });

  return loadRunStrictById(task.processRunId);
}

export async function listProcessRunSections(workspaceId: string, runId: string) {
  const run = await loadRunStrict(workspaceId, runId);
  return prisma.processSectionRun.findMany({
    where: { processRunId: run.id },
    orderBy: { sortOrder: 'asc' },
    include: {
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        take: 1,
      },
    },
  });
}

export async function listSectionRevisions(workspaceId: string, sectionId: string) {
  const section = await prisma.processSectionRun.findFirst({
    where: {
      id: normalizeText(sectionId),
      researchJobId: normalizeText(workspaceId),
    },
  });
  if (!section) throw new Error('Section not found');

  return prisma.processSectionRevision.findMany({
    where: {
      sectionRunId: section.id,
    },
    orderBy: { revisionNumber: 'desc' },
  });
}

export async function reviseSection(input: {
  workspaceId: string;
  sectionId: string;
  markdown: string;
  summary?: string;
  createdByRole?: string;
}): Promise<ProcessRunRecord> {
  const workspaceId = normalizeText(input.workspaceId);
  const sectionId = normalizeText(input.sectionId);
  const markdown = normalizeText(input.markdown);
  if (!workspaceId || !sectionId) throw new Error('workspaceId and sectionId are required');
  if (!markdown) throw new Error('markdown is required');

  assertRolePermission('Editor', 'section.edit');

  const section = await prisma.processSectionRun.findFirst({
    where: {
      id: sectionId,
      researchJobId: workspaceId,
    },
    include: {
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        take: 1,
      },
      processRun: true,
    },
  });

  if (!section) throw new Error('Section not found');

  const revisionNumber = (section.revisions[0]?.revisionNumber || 0) + 1;
  const evidenceIds = extractEvidenceIds(markdown);

  const revision = await prisma.processSectionRevision.create({
    data: {
      processRunId: section.processRunId,
      researchJobId: workspaceId,
      sectionRunId: section.id,
      revisionNumber,
      markdown,
      summary: normalizeText(input.summary) || `Manual revision ${revisionNumber}`,
      createdByRole: normalizeText(input.createdByRole) || 'Editor',
      evidenceRecordIdsJson: toJson(evidenceIds),
    },
  });

  await upsertClaimRecord({
    runId: section.processRunId,
    workspaceId,
    sectionRunId: section.id,
    revisionId: revision.id,
    claimText: extractPrimaryClaim(markdown),
    evidenceRecordIds: evidenceIds,
  });

  await prisma.processSectionRun.update({
    where: { id: section.id },
    data: {
      status: ProcessSectionStatus.DRAFTED,
      entrySatisfied: true,
      exitSatisfied: false,
      lastError: null,
    },
  });

  const run = await loadRunStrictById(section.processRunId);
  if (run.stage !== ProcessRunStage.SECTION_VALIDATING) {
    assertStageTransition(run.stage, ProcessRunStage.SECTION_VALIDATING);
  }

  await prisma.processRun.update({
    where: { id: run.id },
    data: {
      stage: ProcessRunStage.SECTION_VALIDATING,
      status: ProcessRunStatus.RUNNING,
    },
  });

  await runStageMachine(run.id);
  return loadRunStrictById(run.id);
}

export async function listRunEvents(workspaceId: string, runId: string) {
  const run = await loadRunStrict(workspaceId, runId);
  return prisma.processRunEvent.findMany({
    where: { processRunId: run.id },
    orderBy: { createdAt: 'asc' },
  });
}
