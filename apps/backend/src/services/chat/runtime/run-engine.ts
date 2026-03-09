import {
  AgentRunStatus,
  AgentRunTriggerType,
  ChatBranchMessageRole,
  MessageQueueItemStatus,
  ProcessEventLevel,
  ProcessEventType,
  ToolRunStatus,
} from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { publishProcessEvent } from './process-event-bus';
import { attachRuntimeEventV2Payload } from './event-contract';
import {
  cancelActiveRuns,
  cancelActiveToolRuns,
  createAgentRun,
  createBranchMessage,
  createProcessEvent,
  createToolRun,
  enqueueMessage,
  getAgentRun,
  getBranch,
  listBranchMessages,
  listActiveRuns,
  listToolRuns,
  markQueueItemStatus,
  popNextQueuedMessage,
  runtimeEnums,
  updateQueueItem,
  updateAgentRun,
  updateToolRun,
} from './repository';
import { executeToolWithContract } from './tool-contract';
import {
  applyWriterQualityGate,
  buildToolDigest,
  buildEvidenceLedger,
  generatePlannerPlan,
  sanitizeWriterActions,
  validateClientResponse,
  writeClientResponse,
} from './prompt-suite';
import { routeRuntimeIntent } from './prompts/router';
import type {
  RunPolicy,
  RuntimeDecision,
  RuntimeInputOptions,
  RuntimePlan,
  RuntimeResponseMode,
  RuntimeSourceScope,
  RuntimeTargetLength,
  RuntimeToolCall,
  RuntimeToolResult,
  SendMessageMode,
} from './types';
import { TOOL_REGISTRY } from '../../ai/chat/tools/tool-registry';
import { buildRuntimeAgentContext } from './context-assembler';
import type { RuntimeAgentContext } from './agent-context';
import { createKnowledgeLedgerVersion } from '../../knowledge/knowledge-ledger-service';
import { resolveModelForTask } from '../../ai/model-router';
import {
  listPortalWorkspaceLibrary,
  resolvePortalWorkspaceLibraryRefs,
} from '../../portal/portal-library';
import { canonicalDocFamily } from '../../documents/document-spec';
import { flattenMemoryForRuntimeContext, readWorkspaceMemoryContext } from './workspace-memory';

type SendMessageInput = {
  researchJobId: string;
  branchId: string;
  userId: string;
  content: string;
  mode?: SendMessageMode;
  policy?: Partial<RunPolicy>;
  inputOptions?: RuntimeInputOptions;
  libraryRefs?: string[];
  attachmentIds?: string[];
  documentIds?: string[];
  blocksJson?: unknown;
  citationsJson?: unknown;
};

type SendMessageResult = {
  branchId: string;
  queued: boolean;
  queueItemId?: string;
  runId?: string;
  userMessageId?: string;
};

type RuntimeDocumentHydrationInput = {
  researchJobId: string;
  documentIds?: string[];
  attachmentIds?: string[];
};

type RuntimeDocumentGroundingInput = {
  researchJobId: string;
  documentIds?: string[];
  attachmentIds?: string[];
  maxChars?: number;
};

function envRuntimeNumber(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeDocumentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const normalized = String(entry || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function hydrateDocumentIdsFromMessageInput(input: RuntimeDocumentHydrationInput): Promise<string[]> {
  const fallbackIds = normalizeDocumentIds(input.documentIds || []);
  try {
    const documentService = await import('../../documents/workspace-document-service');
    const hydrated = await documentService.hydrateDocumentIdsFromMessageInput({
      researchJobId: input.researchJobId,
      documentIds: fallbackIds,
      attachmentIds: normalizeDocumentIds(input.attachmentIds || []),
    });
    return normalizeDocumentIds(hydrated);
  } catch {
    // Keep runtime chat available even if document modules are not active.
    return fallbackIds;
  }
}

async function buildDocumentGroundingHint(input: RuntimeDocumentGroundingInput): Promise<string> {
  const hydrated = await hydrateDocumentIdsFromMessageInput({
    researchJobId: input.researchJobId,
    documentIds: normalizeDocumentIds(input.documentIds || []),
    attachmentIds: normalizeDocumentIds(input.attachmentIds || []),
  });
  if (!hydrated.length) return '';

  try {
    const documentService = await import('../../documents/workspace-document-service');
    const hint = await documentService.buildDocumentGroundingHint({
      researchJobId: input.researchJobId,
      documentIds: hydrated,
    });
    const compact = String(hint || '').trim();
    if (!compact) return '';
    const maxChars = Number.isFinite(Number(input.maxChars)) ? Math.max(400, Number(input.maxChars)) : 3600;
    return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 1).trimEnd()}…`;
  } catch {
    return '';
  }
}

const DEFAULT_POLICY: RunPolicy = {
  autoContinue: true,
  maxAutoContinuations: envRuntimeNumber('RUNTIME_MAX_AUTO_CONTINUATIONS', 1, 0, 8),
  maxToolRuns: 4,
  toolConcurrency: 3,
  allowMutationTools: false,
  maxToolMs: envRuntimeNumber('CHAT_TOOL_TIMEOUT_MS', 45_000, 2_000, 300_000),
  responseMode: 'deep',
  targetLength: 'long',
  strictValidation: false,
  sourceScope: {
    workspaceData: true,
    libraryPinned: true,
    uploadedDocs: true,
    webSearch: true,
    liveWebsiteCrawl: true,
    socialIntel: true,
  },
  pauseAfterPlanning: false,
};

const MODE_EXECUTION_PROFILE: Record<RuntimeResponseMode, { maxToolRuns: number; maxAutoContinuations: number; targetLength: RuntimeTargetLength; strictValidation: boolean }> =
  {
    fast: {
      maxToolRuns: 4,
      maxAutoContinuations: 1,
      targetLength: 'short',
      strictValidation: false,
    },
    balanced: {
      maxToolRuns: 6,
      maxAutoContinuations: 2,
      targetLength: 'medium',
      strictValidation: false,
    },
    deep: {
      maxToolRuns: 10,
      maxAutoContinuations: 4,
      targetLength: 'long',
      strictValidation: false,
    },
    pro: {
      maxToolRuns: 12,
      maxAutoContinuations: 5,
      targetLength: 'long',
      strictValidation: true,
    },
  };

const BOOTSTRAP_PROMPT =
  'Bootstrap this workspace by auditing existing intelligence and producing an actionable kickoff. ' +
  'Use tools to inspect web_sources, web_snapshots, competitors, social signals, community insights, and news. ' +
  'If websites are known, run web.crawl first before synthesis. ' +
  'Ground all claims in evidence and list clear next steps plus decisions needed from the client.';

const SUPPORTED_TOOL_NAMES = new Set(TOOL_REGISTRY.map((tool) => tool.name));

const TOOL_NAME_ALIASES: Record<string, { tool: string; args: Record<string, unknown> }> = {
  competitoranalysis: { tool: 'orchestration.run', args: { targetCount: 12, mode: 'append' } },
  competitoranalysistool: { tool: 'orchestration.run', args: { targetCount: 12, mode: 'append' } },
  competitoraudit: { tool: 'orchestration.run', args: { targetCount: 12, mode: 'append' } },
  runcompetitordiscovery: { tool: 'orchestration.run', args: { targetCount: 12, mode: 'append' } },
  competitorfinderv3: { tool: 'competitors.discover_v3', args: { mode: 'standard' } },
  discovercompetitorsv3: { tool: 'competitors.discover_v3', args: { mode: 'standard' } },
  widecompetitordiscovery: { tool: 'competitors.discover_v3', args: { mode: 'wide' } },
  deepcompetitordiscovery: { tool: 'competitors.discover_v3', args: { mode: 'deep' } },
  rundeepresearch: { tool: 'research.gather', args: { depth: 'deep', includeScrapling: true, includeAccountContext: true } },
  deepresearch: { tool: 'research.gather', args: { depth: 'deep', includeScrapling: true, includeAccountContext: true } },
  ddgsearch: { tool: 'research.gather', args: { depth: 'standard', includeScrapling: false, includeAccountContext: true } },
  searchweb: { tool: 'search.web', args: { provider: 'auto', count: 10 } },
  bravesearch: { tool: 'search.web', args: { provider: 'brave', count: 10 } },
  scraplyscan: { tool: 'research.gather', args: { depth: 'deep', includeScrapling: true, includeAccountContext: true } },
  scraplingscan: { tool: 'research.gather', args: { depth: 'deep', includeScrapling: true, includeAccountContext: true } },
  addcompetitorlinks: { tool: 'competitors.add_links', args: {} },
  updateintake: { tool: 'intake.update_from_text', args: {} },
  newssearch: { tool: 'evidence.news', args: { limit: 8 } },
  newsaggregator: { tool: 'evidence.news', args: { limit: 8 } },
  newsaggregatortool: { tool: 'evidence.news', args: { limit: 8 } },
  webcrawler: { tool: 'web.crawl', args: { maxPages: 8, maxDepth: 1 } },
  websitecrawler: { tool: 'web.crawl', args: { maxPages: 8, maxDepth: 1 } },
  pageextractor: { tool: 'web.fetch', args: {} },
  opportunityplanner: {
    tool: 'document.plan',
    args: {
      docType: 'BUSINESS_STRATEGY',
      depth: 'deep',
      includeCompetitors: true,
      includeEvidenceLinks: true,
    },
  },
};

const INTEL_LIST_SECTIONS = new Set([
  'client_profiles',
  'competitors',
  'competitor_entities',
  'competitor_accounts',
  'search_results',
  'images',
  'videos',
  'news',
  'brand_mentions',
  'media_assets',
  'search_trends',
  'community_insights',
  'ai_questions',
  'web_sources',
  'web_snapshots',
  'web_extraction_recipes',
  'web_extraction_runs',
]);

const RUNTIME_PROMPT_STAGE_TIMEOUT_MS = Number.isFinite(Number(process.env.RUNTIME_PROMPT_STAGE_TIMEOUT_MS))
  ? Math.max(15_000, Math.min(180_000, Math.floor(Number(process.env.RUNTIME_PROMPT_STAGE_TIMEOUT_MS))))
  : 60_000;
const MAX_PROMPT_TOOL_RESULTS = 12;
const MAX_PROMPT_ARRAY_ITEMS = 10;
const MAX_PROMPT_OBJECT_KEYS = 18;
const MAX_PROMPT_STRING_CHARS = 320;
const SCHEDULED_RUN_PREEMPTION_ENABLED = String(process.env.RUNTIME_PREEMPT_SCHEDULED_RUNS || 'true')
  .trim()
  .toLowerCase() !== 'false';
const TOOL_TRANSIENT_MAX_RETRIES = envRuntimeNumber('CHAT_TOOL_MAX_RETRIES', 2, 0, 5);
const TOOL_TRANSIENT_RETRY_OVERRIDES: Record<string, number> = {
  'document.generate': 0,
  'document.export': 0,
  'research.gather': 0,
  'competitors.discover_v3': 0,
  'evidence.news': 0,
  'evidence.posts': 0,
};
const DOCUMENT_RUN_BUDGET_SHORT_MS = envRuntimeNumber(
  'RUNTIME_DOCUMENT_RUN_BUDGET_SHORT_MS',
  2 * 60_000,
  60_000,
  10 * 60_000
);
const DOCUMENT_RUN_BUDGET_STANDARD_MS = envRuntimeNumber(
  'RUNTIME_DOCUMENT_RUN_BUDGET_STANDARD_MS',
  4 * 60_000,
  2 * 60_000,
  15 * 60_000
);
const DOCUMENT_RUN_BUDGET_DEEP_MS = envRuntimeNumber(
  'RUNTIME_DOCUMENT_RUN_BUDGET_DEEP_MS',
  10 * 60_000,
  4 * 60_000,
  20 * 60_000
);
const DOCUMENT_RUN_BUDGET_PRO_MS = envRuntimeNumber(
  'RUNTIME_DOCUMENT_RUN_BUDGET_PRO_MS',
  10 * 60_000,
  6 * 60_000,
  25 * 60_000
);
const DOCUMENT_ENRICHMENT_MIN_SCORE = envRuntimeNumber(
  'RUNTIME_DOCUMENT_ENRICHMENT_MIN_SCORE',
  65,
  0,
  100
);
const RUNTIME_PROGRESSIVE_LOOPS_ENABLED = String(process.env.RUNTIME_PROGRESSIVE_LOOPS_ENABLED || 'true')
  .trim()
  .toLowerCase() !== 'false';
const DOCUMENT_ALWAYS_DEEP_ENABLED = String(process.env.DOCUMENT_ALWAYS_DEEP_ENABLED || 'true')
  .trim()
  .toLowerCase() !== 'false';
const DEEP_RESPONSE_SECTION_GATE_ENABLED = String(process.env.DEEP_RESPONSE_SECTION_GATE_ENABLED || 'true')
  .trim()
  .toLowerCase() !== 'false';
const RUNTIME_CONTINUATION_CALLS_V2 = String(process.env.RUNTIME_CONTINUATION_CALLS_V2 || 'true')
  .trim()
  .toLowerCase() === 'true';
const RUNTIME_LEDGER_BUILDER_ENABLED = String(process.env.RUNTIME_EVIDENCE_LEDGER_ENABLED || 'false')
  .trim()
  .toLowerCase() === 'true';
const RUNTIME_LEDGER_BUILDER_ROLLOUT = envRuntimeNumber('RUNTIME_LEDGER_BUILDER_ROLLOUT', 100, 0, 100);
const RUNTIME_STALE_ACTIVE_RUN_MS = envRuntimeNumber(
  'RUNTIME_STALE_ACTIVE_RUN_MS',
  10 * 60_000,
  120_000,
  24 * 60 * 60_000
);
const RUNTIME_STALE_RECOVERY_COOLDOWN_MS = envRuntimeNumber(
  'RUNTIME_STALE_RECOVERY_COOLDOWN_MS',
  60_000,
  10_000,
  15 * 60_000
);
const PORTAL_LIBRARY_TRUST_GUARD_ENABLED = String(
  process.env.PORTAL_LIBRARY_TRUST_GUARD_ENABLED || 'true'
)
  .trim()
  .toLowerCase() !== 'false';

function normalizeSourceScope(raw?: Partial<RuntimeSourceScope> | null): RuntimeSourceScope {
  const scope = {
    ...DEFAULT_POLICY.sourceScope,
    ...(raw || {}),
  };
  return {
    workspaceData: scope.workspaceData !== false,
    libraryPinned: scope.libraryPinned !== false,
    uploadedDocs: scope.uploadedDocs !== false,
    webSearch: scope.webSearch !== false,
    liveWebsiteCrawl: scope.liveWebsiteCrawl !== false,
    socialIntel: scope.socialIntel !== false,
  };
}

function normalizeInputSourceScope(raw?: unknown): Partial<RuntimeSourceScope> | undefined {
  if (!isRecord(raw)) return undefined;
  const normalized: Partial<RuntimeSourceScope> = {};
  if (typeof raw.workspaceData === 'boolean') normalized.workspaceData = raw.workspaceData;
  if (typeof raw.libraryPinned === 'boolean') normalized.libraryPinned = raw.libraryPinned;
  if (typeof raw.uploadedDocs === 'boolean') normalized.uploadedDocs = raw.uploadedDocs;
  if (typeof raw.webSearch === 'boolean') normalized.webSearch = raw.webSearch;
  if (typeof raw.liveWebsiteCrawl === 'boolean') normalized.liveWebsiteCrawl = raw.liveWebsiteCrawl;
  if (typeof raw.socialIntel === 'boolean') normalized.socialIntel = raw.socialIntel;
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeInputOptions(raw?: RuntimeInputOptions | null): RuntimeInputOptions | null {
  if (!isRecord(raw)) return null;
  const normalized: RuntimeInputOptions = {};
  const modeRaw = typeof raw.modeLabel === 'string' ? raw.modeLabel.trim().toLowerCase() : '';
  if (modeRaw === 'fast' || modeRaw === 'balanced' || modeRaw === 'deep' || modeRaw === 'pro') {
    normalized.modeLabel = modeRaw as RuntimeResponseMode;
  }
  const targetLengthRaw = typeof raw.targetLength === 'string' ? raw.targetLength.trim().toLowerCase() : '';
  if (targetLengthRaw === 'short' || targetLengthRaw === 'medium' || targetLengthRaw === 'long') {
    normalized.targetLength = targetLengthRaw as RuntimeTargetLength;
  }
  const sourceScope = normalizeInputSourceScope(raw.sourceScope);
  if (sourceScope) {
    normalized.sourceScope = sourceScope;
  }
  if (typeof raw.steerNote === 'string' && raw.steerNote.trim()) {
    normalized.steerNote = raw.steerNote.trim().slice(0, 1000);
  }
  if (typeof raw.strictValidation === 'boolean') {
    normalized.strictValidation = raw.strictValidation;
  }
  if (typeof raw.pauseAfterPlanning === 'boolean') {
    normalized.pauseAfterPlanning = raw.pauseAfterPlanning;
  }
  if (Array.isArray(raw.libraryRefs)) {
    const refs = raw.libraryRefs
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, 40);
    if (refs.length) {
      normalized.libraryRefs = Array.from(new Set(refs));
    }
  }
  return Object.keys(normalized).length ? normalized : null;
}

function mergeLibraryRefs(...values: Array<unknown>): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const ref = String(entry || '').trim();
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
      if (refs.length >= 40) return refs;
    }
  }
  return refs;
}

function modeExecutionProfile(mode: RuntimeResponseMode) {
  return MODE_EXECUTION_PROFILE[mode] || MODE_EXECUTION_PROFILE.balanced;
}

function applyModeExecutionProfile(policy: RunPolicy): RunPolicy {
  const profile = modeExecutionProfile(policy.responseMode);
  return {
    ...policy,
    maxToolRuns: profile.maxToolRuns,
    maxAutoContinuations: profile.maxAutoContinuations,
    targetLength: profile.targetLength,
    strictValidation: profile.strictValidation || policy.strictValidation,
  };
}

function mergePolicyWithInputOptions(
  policy: RunPolicy,
  inputOptions?: RuntimeInputOptions | null
): RunPolicy {
  const normalizedOptions = normalizeInputOptions(inputOptions);
  if (!normalizedOptions) return applyModeExecutionProfile(policy);

  const responseMode = normalizedOptions.modeLabel || policy.responseMode;
  const modeAwareBase = applyModeExecutionProfile({
    ...policy,
    responseMode,
  });
  let targetLength: RuntimeTargetLength = modeAwareBase.targetLength;
  if (normalizedOptions.targetLength) {
    targetLength = normalizedOptions.targetLength;
  }
  const strictValidation =
    typeof normalizedOptions.strictValidation === 'boolean'
      ? normalizedOptions.strictValidation
      : modeAwareBase.strictValidation;
  const sourceScope = normalizeSourceScope({
    ...policy.sourceScope,
    ...(normalizedOptions.sourceScope || {}),
  });

  return {
    ...modeAwareBase,
    responseMode,
    targetLength,
    strictValidation,
    sourceScope,
    pauseAfterPlanning:
      typeof normalizedOptions.pauseAfterPlanning === 'boolean'
        ? normalizedOptions.pauseAfterPlanning
        : policy.pauseAfterPlanning,
  };
}

function buildPolicySummary(policy: RunPolicy) {
  return {
    responseMode: policy.responseMode,
    targetLength: policy.targetLength,
    maxToolRuns: policy.maxToolRuns,
    maxAutoContinuations: policy.maxAutoContinuations,
    strictValidation: policy.strictValidation,
    sourceScope: policy.sourceScope,
    pauseAfterPlanning: policy.pauseAfterPlanning,
  };
}

export function normalizePolicy(raw?: Partial<RunPolicy> | null, inputOptions?: RuntimeInputOptions | null): RunPolicy {
  const policy = {
    ...DEFAULT_POLICY,
    ...(raw || {}),
  };

  const maxAutoContinuationsRaw = Number(policy.maxAutoContinuations);
  const maxToolRunsRaw = Number(policy.maxToolRuns);
  const toolConcurrencyRaw = Number(policy.toolConcurrency);
  const maxToolMsRaw = Number(policy.maxToolMs);

  const basePolicy: RunPolicy = {
    autoContinue: Boolean(policy.autoContinue),
    maxAutoContinuations: Number.isFinite(maxAutoContinuationsRaw)
      ? Math.max(0, Math.min(5, Math.floor(maxAutoContinuationsRaw)))
      : DEFAULT_POLICY.maxAutoContinuations,
    maxToolRuns: Number.isFinite(maxToolRunsRaw)
      ? Math.max(1, Math.min(12, Math.floor(maxToolRunsRaw)))
      : DEFAULT_POLICY.maxToolRuns,
    toolConcurrency: Number.isFinite(toolConcurrencyRaw)
      ? Math.max(1, Math.min(3, Math.floor(toolConcurrencyRaw)))
      : DEFAULT_POLICY.toolConcurrency,
    allowMutationTools: Boolean(policy.allowMutationTools),
    maxToolMs: Number.isFinite(maxToolMsRaw)
      ? Math.max(1_000, Math.min(180_000, Math.floor(maxToolMsRaw)))
      : DEFAULT_POLICY.maxToolMs,
    responseMode:
      String(policy.responseMode || '').toLowerCase() === 'fast' ||
      String(policy.responseMode || '').toLowerCase() === 'deep' ||
      String(policy.responseMode || '').toLowerCase() === 'pro'
        ? (String(policy.responseMode || '').toLowerCase() as RuntimeResponseMode)
        : 'balanced',
    targetLength:
      String(policy.targetLength || '').toLowerCase() === 'short' ||
      String(policy.targetLength || '').toLowerCase() === 'long'
        ? (String(policy.targetLength || '').toLowerCase() as RuntimeTargetLength)
        : 'medium',
    strictValidation: Boolean(policy.strictValidation),
    sourceScope: normalizeSourceScope(isRecord(policy.sourceScope) ? (policy.sourceScope as Partial<RuntimeSourceScope>) : {}),
    pauseAfterPlanning: Boolean(policy.pauseAfterPlanning),
  };
  // Input options are message-scoped and should override persisted/session defaults.
  return mergePolicyWithInputOptions(applyModeExecutionProfile(basePolicy), inputOptions);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

type RuntimeUserCitation = {
  id: string;
  label: string;
  url?: string;
  libraryRef?: string;
};

type RuntimeViralStudioContextCard = {
  id: string;
  title: string;
  subtitle?: string;
  sourcePlatform?: string;
  sourceUrl?: string;
  score?: number;
  notes?: string[];
};

type RuntimeViralStudioContextBlock = {
  type: 'viral_studio_context';
  contextKind: string;
  objective?: string;
  summary?: string;
  cards: RuntimeViralStudioContextCard[];
  citations: RuntimeUserCitation[];
};

function sanitizeHttpUrl(value: unknown): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeRuntimeUserCitations(value: unknown, maxItems = 16): RuntimeUserCitation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const citations: RuntimeUserCitation[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = compactPromptString(item.id || item.refId || item.libraryRef || `citation-${citations.length + 1}`, 80);
    const label = compactPromptString(item.label || item.title || item.name || '', 180);
    if (!label) continue;
    const key = `${id}|${label}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const libraryRef = compactPromptString(item.libraryRef || item.refId || '', 200);
    const url = sanitizeHttpUrl(item.url || item.href || item.sourceUrl);
    citations.push({
      id: id || `citation-${citations.length + 1}`,
      label,
      ...(url ? { url } : {}),
      ...(libraryRef ? { libraryRef } : {}),
    });
    if (citations.length >= maxItems) break;
  }
  return citations;
}

function normalizeRuntimeViralStudioBlocks(value: unknown): RuntimeViralStudioContextBlock[] {
  const rawBlocks = Array.isArray(value) ? value : value ? [value] : [];
  const normalized: RuntimeViralStudioContextBlock[] = [];
  for (const entry of rawBlocks) {
    if (!isRecord(entry)) continue;
    if (String(entry.type || '').trim().toLowerCase() !== 'viral_studio_context') continue;
    const contextKind = compactPromptString(entry.contextKind || entry.contextType || 'context', 40).toLowerCase() || 'context';
    const cards: RuntimeViralStudioContextCard[] = Array.isArray(entry.cards)
      ? entry.cards
          .map((card, index) => {
            if (!isRecord(card)) return null;
            const title = compactPromptString(card.title || card.heading || '', 180);
            if (!title) return null;
            const notes = Array.isArray(card.notes)
              ? card.notes.map((note) => compactPromptString(note, 180)).filter(Boolean).slice(0, 3)
              : [];
            const score = Number(card.score);
            return {
              id: compactPromptString(card.id || `card-${index + 1}`, 80) || `card-${index + 1}`,
              title,
              ...(compactPromptString(card.subtitle || card.summary || '', 180)
                ? { subtitle: compactPromptString(card.subtitle || card.summary || '', 180) }
                : {}),
              ...(compactPromptString(card.sourcePlatform || card.platform || '', 32)
                ? { sourcePlatform: compactPromptString(card.sourcePlatform || card.platform || '', 32) }
                : {}),
              ...(sanitizeHttpUrl(card.sourceUrl || card.url || card.href)
                ? { sourceUrl: sanitizeHttpUrl(card.sourceUrl || card.url || card.href) }
                : {}),
              ...(Number.isFinite(score) ? { score: Math.max(0, Math.min(1_000, score)) } : {}),
              ...(notes.length ? { notes } : {}),
            };
          })
          .filter((card): card is RuntimeViralStudioContextCard => Boolean(card))
          .slice(0, 12)
      : [];

    const citations = normalizeRuntimeUserCitations(entry.citations, 16);
    normalized.push({
      type: 'viral_studio_context',
      contextKind,
      ...(compactPromptString(entry.objective, 240) ? { objective: compactPromptString(entry.objective, 240) } : {}),
      ...(compactPromptString(entry.summary, 280) ? { summary: compactPromptString(entry.summary, 280) } : {}),
      cards,
      citations,
    });
    if (normalized.length >= 4) break;
  }
  return normalized;
}

function extractLibraryRefsFromRuntimeCitations(value: unknown): string[] {
  return normalizeRuntimeUserCitations(value, 40)
    .map((item) => String(item.libraryRef || '').trim())
    .filter(Boolean)
    .slice(0, 40);
}

function extractLibraryRefsFromRuntimeViralBlocks(value: unknown): string[] {
  const refs: string[] = [];
  for (const block of normalizeRuntimeViralStudioBlocks(value)) {
    for (const citation of block.citations) {
      const ref = String(citation.libraryRef || '').trim();
      if (!ref) continue;
      refs.push(ref);
      if (refs.length >= 40) break;
    }
    if (refs.length >= 40) break;
  }
  return refs;
}

function buildViralStudioTriggerHint(
  blocks: RuntimeViralStudioContextBlock[],
  citations: RuntimeUserCitation[]
): string {
  if (!blocks.length && !citations.length) return '';
  const lines: string[] = ['Viral Studio structured context (user-provided):'];
  const cards: RuntimeViralStudioContextCard[] = [];
  for (const block of blocks) {
    const kind = String(block.contextKind || 'context').replace(/_/g, ' ');
    const summary = block.summary ? `: ${block.summary}` : '';
    lines.push(`- ${kind}${summary}`);
    if (block.objective) {
      lines.push(`  Objective: ${block.objective}`);
    }
    cards.push(...block.cards);
  }
  if (cards.length > 0) {
    lines.push('Top context cards:');
    for (const [index, card] of cards.slice(0, 8).entries()) {
      const scorePart = typeof card.score === 'number' ? ` | score ${card.score.toFixed(3)}` : '';
      const sourcePart = card.sourceUrl ? ` | source ${card.sourceUrl}` : '';
      const subtitle = card.subtitle ? ` | ${card.subtitle}` : '';
      lines.push(`${index + 1}. ${card.title}${subtitle}${scorePart}${sourcePart}`);
    }
  }
  const normalizedCitations =
    citations.length > 0 ? citations : blocks.flatMap((block) => block.citations).slice(0, 10);
  if (normalizedCitations.length > 0) {
    lines.push('Citations to prefer:');
    for (const [index, item] of normalizedCitations.slice(0, 8).entries()) {
      const refPart = item.libraryRef ? ` [ref ${item.libraryRef}]` : '';
      const urlPart = item.url ? ` (${item.url})` : '';
      lines.push(`${index + 1}. ${item.label}${refPart}${urlPart}`);
    }
  }
  return lines.join('\n');
}

function buildViralStudioRuntimeSnapshot(
  blocks: RuntimeViralStudioContextBlock[],
  citations: RuntimeUserCitation[]
): Record<string, unknown> {
  if (!blocks.length && !citations.length) return {};
  const normalizedCitations = citations.length > 0 ? citations : blocks.flatMap((block) => block.citations);
  return {
    viralStudioContext: {
      blocks: blocks.slice(0, 4),
      citations: normalizedCitations.slice(0, 16),
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isTransientToolError(error: unknown): boolean {
  const message = String((error as Error)?.message || error || '')
    .trim()
    .toLowerCase();
  if (!message) return false;
  if (
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('too many requests') ||
    message.includes('rate limit') ||
    /\b429\b/.test(message)
  ) {
    return true;
  }
  return /\b5\d\d\b/.test(message);
}

function isTransientToolContractFailure(result: RuntimeToolResult): boolean {
  if (result.ok) return false;
  const text = [result.summary, ...(Array.isArray(result.warnings) ? result.warnings : [])]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' | ');
  if (!text) return false;
  if (
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('econnreset') ||
    text.includes('too many requests') ||
    text.includes('rate limit') ||
    /\b429\b/.test(text)
  ) {
    return true;
  }
  return /\b5\d\d\b/.test(text);
}

function resolveToolRetryLimit(toolName: string): number {
  const normalized = String(toolName || '').trim().toLowerCase();
  const override = TOOL_TRANSIENT_RETRY_OVERRIDES[normalized];
  if (typeof override === 'number' && Number.isFinite(override)) {
    return Math.max(0, Math.floor(override));
  }
  return TOOL_TRANSIENT_MAX_RETRIES;
}

function retryBackoffMs(attempt: number): number {
  const base = Math.min(4_000, 350 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 220);
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function shouldBuildLedgerForRun(runId: string): boolean {
  if (!RUNTIME_LEDGER_BUILDER_ENABLED) return false;
  if (RUNTIME_LEDGER_BUILDER_ROLLOUT >= 100) return true;
  if (RUNTIME_LEDGER_BUILDER_ROLLOUT <= 0) return false;
  const source = String(runId || '').trim();
  if (!source) return false;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) % 10_000;
  }
  const bucket = Math.abs(hash % 100);
  return bucket < RUNTIME_LEDGER_BUILDER_ROLLOUT;
}

function compactPromptString(value: unknown, maxChars = MAX_PROMPT_STRING_CHARS): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function compactPromptValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return compactPromptString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= 3) return [];
    return value.slice(0, MAX_PROMPT_ARRAY_ITEMS).map((entry) => compactPromptValue(entry, depth + 1));
  }
  if (!isRecord(value)) {
    return compactPromptString(value);
  }
  if (depth >= 3) return {};

  const compacted: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, MAX_PROMPT_OBJECT_KEYS);
  for (const [key, entry] of entries) {
    if (typeof entry === 'string') {
      compacted[key] = compactPromptString(entry);
      continue;
    }
    compacted[key] = compactPromptValue(entry, depth + 1);
  }
  return compacted;
}

function compactToolResultsForPrompt(toolResults: RuntimeToolResult[]): RuntimeToolResult[] {
  return toolResults.slice(0, MAX_PROMPT_TOOL_RESULTS).map((result) => ({
    ok: Boolean(result.ok),
    summary: compactPromptString(result.summary, 420),
    artifacts: (Array.isArray(result.artifacts) ? result.artifacts : []).slice(0, 10).map((artifact) => ({
      kind: compactPromptString(artifact?.kind, 80),
      id: compactPromptString(artifact?.id, 120),
      ...(artifact?.section ? { section: compactPromptString(artifact.section, 80) } : {}),
    })),
    evidence: (Array.isArray(result.evidence) ? result.evidence : []).slice(0, 12).map((entry) => ({
      kind: compactPromptString(entry?.kind, 40),
      label: compactPromptString(entry?.label, 220),
      ...(entry?.url ? { url: compactPromptString(entry.url, 260) } : {}),
    })),
    continuations: (Array.isArray(result.continuations) ? result.continuations : []).slice(0, 6).map((entry) => ({
      type: entry?.type === 'manual_continue' ? 'manual_continue' : 'auto_continue',
      reason: compactPromptString(entry?.reason, 180),
      ...(Array.isArray(entry?.suggestedNextTools)
        ? {
            suggestedNextTools: entry.suggestedNextTools
              .map((tool) => compactPromptString(tool, 80))
              .filter(Boolean)
              .slice(0, 6),
          }
        : {}),
      ...(Array.isArray(entry?.suggestedToolCalls)
        ? {
            suggestedToolCalls: entry.suggestedToolCalls
              .map((call) => {
                if (!call || typeof call !== 'object') return null;
                const tool = compactPromptString((call as { tool?: unknown }).tool, 90);
                if (!tool) return null;
                const args = isRecord((call as { args?: unknown }).args)
                  ? (compactPromptValue((call as { args?: unknown }).args) as Record<string, unknown>)
                  : {};
                return { tool, args };
              })
              .filter((call): call is { tool: string; args: Record<string, unknown> } => Boolean(call))
              .slice(0, 6),
          }
        : {}),
    })),
    decisions: (Array.isArray(result.decisions) ? result.decisions : []).slice(0, 6).map((decision) => ({
      id: compactPromptString(decision?.id, 120),
      title: compactPromptString(decision?.title, 220),
      options: (Array.isArray(decision?.options) ? decision.options : []).slice(0, 6).map((option) => ({
        value: compactPromptString(option?.value, 120),
        ...(option?.label ? { label: compactPromptString(option.label, 160) } : {}),
      })),
      ...(decision?.default ? { default: compactPromptString(decision.default, 120) } : {}),
      blocking: Boolean(decision?.blocking),
    })),
    warnings: (Array.isArray(result.warnings) ? result.warnings : [])
      .map((warning) => compactPromptString(warning, 220))
      .filter(Boolean)
      .slice(0, 6),
    ...(isRecord(result.raw) ? { raw: compactPromptValue(result.raw) as Record<string, unknown> } : {}),
  }));
}

type RuntimeToolDigest = Awaited<ReturnType<typeof buildToolDigest>>;
type RuntimeEvidenceLedger = Awaited<ReturnType<typeof buildEvidenceLedger>>;
type RuntimeWriterOutput = Awaited<ReturnType<typeof writeClientResponse>>;
type RuntimeValidatorOutput = Awaited<ReturnType<typeof validateClientResponse>>;

function fallbackToolDigest(toolResults: RuntimeToolResult[], plan: RuntimePlan, userMessage: string): RuntimeToolDigest {
  const digest = buildToolDigest({
    userMessage,
    plan,
    toolResults,
  });
  return {
    highlights: digest.highlights.map((item) => compactPromptString(item, 220)).filter(Boolean),
    facts: digest.facts
      .map((fact) => ({
        claim: compactPromptString(fact.claim, 220),
        evidence: (Array.isArray(fact.evidence) ? fact.evidence : [])
          .map((item) => compactPromptString(item, 220))
          .filter(Boolean)
          .slice(0, 8),
      }))
      .filter((item) => item.claim),
    openQuestions: digest.openQuestions.map((item) => compactPromptString(item, 220)).filter(Boolean).slice(0, 10),
    recommendedContinuations: digest.recommendedContinuations
      .map((tool) => compactPromptString(tool, 80))
      .filter(Boolean)
      .slice(0, 8),
  };
}

function prefersConciseOutput(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  if (!normalized.trim()) return false;
  return /\b(concise|brief|short|tl;dr|tldr|in short|summarize quickly|quick summary)\b/.test(normalized);
}

function detectWriterIntent(message: string): 'competitor_brief' | 'general' {
  const normalized = String(message || '').toLowerCase();
  if (!/\bcompetitor|rival|alternative\b/.test(normalized)) return 'general';
  const hasBriefSignals =
    /\b(top\s*\d+|top five|top 5|best competitors?|direct competitors?|competitor brief|competitor analysis)\b/.test(
      normalized
    ) ||
    /\bwhy (each|they|these)\b/.test(normalized) ||
    /\b(positioning gap|market gap|white\s*space|whitespace|angle)\b/.test(normalized);
  return hasBriefSignals ? 'competitor_brief' : 'general';
}

function fallbackWriterOutput(input: {
  toolDigest: RuntimeToolDigest;
  toolResults: RuntimeToolResult[];
  plan: RuntimePlan;
  policy?: RunPolicy;
  userMessage?: string;
  runtimeContext?: Record<string, unknown>;
}): RuntimeWriterOutput {
  const requestedWriterModel = resolveModelForTask('workspace_chat_writer');
  const userMessage = String(input.userMessage || '');
  const concise = prefersConciseOutput(userMessage);
  const hasToolResults = input.toolResults.length > 0;
  const highlights = input.toolDigest.highlights.filter(Boolean).slice(0, concise ? 4 : 8);
  const evidenceLines = input.toolResults
    .flatMap((result) => result.evidence)
    .slice(0, concise ? 5 : 10)
    .map((entry, index) => `${index + 1}. ${compactPromptString(entry.label, 220)}`);
  const runtimeContext = isRecord(input.runtimeContext) ? input.runtimeContext : {};
  const baselineSummary: string[] = [];
  const clientName = String(runtimeContext.clientName || '').trim();
  if (clientName) baselineSummary.push(`Workspace: ${clientName}.`);
  const websites = Array.isArray(runtimeContext.websites)
    ? runtimeContext.websites.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  if (websites.length) baselineSummary.push(`Known website(s): ${websites.join(', ')}.`);
  const webSnapshotsCount = Number(runtimeContext.webSnapshotsCount || 0);
  if (Number.isFinite(webSnapshotsCount) && webSnapshotsCount > 0) {
    baselineSummary.push(`Stored web snapshots: ${webSnapshotsCount}.`);
  }
  const responseSections: string[] = [];

  if (!hasToolResults && baselineSummary.length) {
    responseSections.push(`Grounded workspace snapshot:\n${baselineSummary.map((line, idx) => `${idx + 1}. ${line}`).join('\n')}`);
  }

  if (highlights.length > 0) {
    responseSections.push(highlights[0]);
    if (highlights.length > 1) {
      responseSections.push(
        `${concise ? 'Key findings' : 'What stands out most'}:\n${highlights
          .slice(1, concise ? 4 : 7)
          .map((item, index) => `${index + 1}. ${item}`)
          .join('\n')}`
      );
    }
  } else {
    responseSections.push(
      hasToolResults
        ? 'I reviewed the available workspace evidence and compiled the latest findings.'
        : 'I do not have fresh tool output for this run yet, so this response is grounded in the current workspace snapshot.'
    );
  }

  if (evidenceLines.length > 0) {
    responseSections.push(`${concise ? 'Evidence' : 'Evidence used for this response'}:\n${evidenceLines.join('\n')}`);
  }

  if (!concise) {
    responseSections.push(
      'If you want, I can now deepen this into a more strategic output (execution plan, post prompt, or client-ready brief) using the same evidence set.'
    );
  }

  const response = responseSections.filter(Boolean).join('\n\n');
  const hasCompetitorSignals = /\bcompetitor|adjacent|substitute|inspiration\b/i.test(String(input.userMessage || ''));
  const sourceScope = input.policy?.sourceScope;
  const allowWebSearch = sourceScope ? sourceScope.webSearch !== false : true;

  const actions: RuntimeWriterOutput['actions'] = [
    { label: 'Show sources', action: 'show_sources' },
    { label: 'Generate PDF', action: 'generate_pdf' },
  ];
  if (hasCompetitorSignals && allowWebSearch) {
    actions.unshift({
      label: 'Run V3 competitor finder',
      action: 'competitors.discover_v3',
      payload: { mode: 'standard', maxCandidates: 140, maxEnrich: 10 },
    });
  } else if (allowWebSearch) {
    actions.unshift({
      label: 'Search web evidence',
      action: 'search.web',
      payload: { query: String(input.userMessage || '').slice(0, 180), count: 10, provider: 'auto' },
    });
  } else {
    actions.unshift({
      label: 'Open library',
      action: 'open_library',
      payload: { collection: 'web' },
    });
  }

  const qualityGate = applyWriterQualityGate({
    userMessage,
    response,
    toolResults: input.toolResults,
    runtimeContext,
    responseMode: input.policy?.responseMode,
    enforceDeepSections: DEEP_RESPONSE_SECTION_GATE_ENABLED,
  });

  return {
    response: qualityGate.response,
    model: {
      requested: requestedWriterModel || 'unknown',
      used: 'heuristic-fallback',
      fallbackUsed: true,
      fallbackFrom: requestedWriterModel || 'unknown',
    },
    reasoning: {
      plan: input.plan.plan.slice(0, 8),
      tools: input.plan.toolCalls.map((entry) => entry.tool).slice(0, 8),
      assumptions: ['This response uses the most recent tool outputs available in this run.'],
      nextSteps: concise
        ? ['Tell me if you want a deeper pass on the same evidence.']
        : ['Tell me which angle to deepen next: strategy implications, content direction, or execution plan.'],
      evidence: input.toolResults
        .flatMap((result) => result.evidence)
        .slice(0, concise ? 8 : 12)
        .map((entry, index) => ({
          id: `e-${index + 1}`,
          label: compactPromptString(entry.label, 220),
          ...(entry.url ? { url: compactPromptString(entry.url, 260) } : {}),
        })),
      quality: qualityGate.quality,
    },
    actions,
    decisions: [],
  };
}

function fallbackValidatorOutput(): RuntimeValidatorOutput {
  return {
    pass: false,
    issues: [
      {
        code: 'VALIDATOR_UNAVAILABLE',
        severity: 'high',
        message: 'Validator fallback executed because the validation stage was unavailable.',
      },
    ],
    suggestedFixes: ['Retry this run or request a shorter answer to reduce model-stage timeout risk.'],
  };
}

function normalizeToolAliasKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(String(value));
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function findFirstUrl(message: string): string | null {
  const raw = String(message || '');
  const fullUrl = raw.match(/https?:\/\/[^\s)]+/i);
  if (fullUrl?.[0]) return fullUrl[0];

  const bareDomain = raw.match(/\b([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?)\b/i);
  if (!bareDomain?.[1]) return null;
  return `https://${bareDomain[1]}`;
}

function findReferencedCrawlRunId(message: string): string | null {
  const raw = String(message || '');
  const directId = raw.match(/\b(crawl-[a-z0-9-]+)\b/i);
  if (directId?.[1]) return directId[1].toLowerCase();

  const labeled = raw.match(/\bcrawl\s*run[:\s#-]*([a-z0-9-]+)/i);
  if (!labeled?.[1]) return null;
  const candidate = labeled[1].trim().toLowerCase();
  if (!candidate) return null;
  return candidate.startsWith('crawl-') ? candidate : `crawl-${candidate}`;
}

type LibraryMention = {
  ref: string;
  title: string;
  rawToken: string;
};

function extractLibraryMentions(message: string): LibraryMention[] {
  const raw = String(message || '');
  const mentions: LibraryMention[] = [];
  const patterns = [
    /@libraryRef\[([^\]|]+)\|([^\]]+)\]/gi,
    /@library\[([^\]|]+)\|([^\]]+)\]/gi,
  ];
  for (const matcher of patterns) {
    let current = matcher.exec(raw);
    while (current) {
      const ref = String(current[1] || '').trim();
      const title = String(current[2] || '').trim();
      const rawToken = String(current[0] || '').trim();
      if (ref && title && rawToken) {
        mentions.push({ ref, title, rawToken });
      }
      current = matcher.exec(raw);
    }
  }
  return mentions;
}

function extractLibraryRefsFromText(message: string): string[] {
  return Array.from(
    new Set(
      extractLibraryMentions(message)
        .map((entry) => entry.ref)
        .filter(Boolean)
    )
  ).slice(0, 40);
}

function requestsExplicitLibraryGrounding(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) return false;
  return (
    /@libraryref\[|@library\[/.test(normalized) ||
    /\b(use|show|cite|ground|pin|resolve)\b.{0,24}\b(library|source|evidence|citation)\b/.test(normalized) ||
    /\b(from|with)\b.{0,24}\b(library|source|evidence)\b/.test(normalized)
  );
}

function withLibraryMentionHints(message: string): string {
  const mentions = extractLibraryMentions(message);
  if (!mentions.length) return message;
  const hints = mentions.map((entry) => `Use pinned library evidence: ${entry.title}`).join('\n');
  return `${message}\n${hints}`;
}

function extractCompetitorQueryTarget(message: string): string {
  const raw = String(message || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const forMatch = raw.match(/\bfor\s+([^.!?\n]{2,100})/i);
  if (forMatch?.[1]) return forMatch[1].trim();
  const ofMatch = raw.match(/\bof\s+([^.!?\n]{2,100})/i);
  if (ofMatch?.[1]) return ofMatch[1].trim();
  return '';
}

function sanitizeSearchQueryText(message: string): string {
  const compact = String(message || '')
    .replace(/use pinned library evidence:[^\n]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';

  const stripped = compact
    .replace(
      /^(please\s+)?(?:can you\s+)?(?:run|do|execute|start|continue|perform)?\s*(?:a\s+)?(?:full\s+)?(?:web\s+)?search(?:\s+the\s+web)?\s*(?:for|on|about)?\s*/i,
      ''
    )
    .replace(/^(please\s+)?(?:look up|find online|search online|research)\s*/i, '')
    .trim();

  return stripped || compact;
}

function extractExplicitSearchQuery(
  message: string,
  input: { competitorIntent?: boolean; defaultQuery?: string } = {}
): string {
  const compact = sanitizeSearchQueryText(message);
  const competitorIntent = Boolean(input.competitorIntent);
  const hasOrchestrationSyntax =
    /\b(run|continue|execute|use tools|scenario|next actions|workspace|intelligence audit|evidence loop)\b/i.test(compact) ||
    compact.includes('\n') ||
    compact.split(/[,.]/).length > 4;
  const hasLongAudienceSentence =
    /\/| who want| looking for| technology-framed approach|consistency and structure/i.test(compact) ||
    compact.length > 140;

  if (competitorIntent) {
    const target = extractCompetitorQueryTarget(compact);
    if (target) {
      return compactPromptString(`${target} competitors alternatives`, 100) || 'direct competitors alternatives';
    }
  }

  if (hasOrchestrationSyntax || hasLongAudienceSentence) {
    return input.defaultQuery || (competitorIntent ? 'direct competitors alternatives' : 'brand strategy research');
  }

  const normalized = compact
    .replace(/[“”"'`]/g, ' ')
    .replace(/[|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const finalQuery = compactPromptString(normalized, 100);
  if (finalQuery.length >= 12) return finalQuery;
  return input.defaultQuery || (competitorIntent ? 'direct competitors alternatives' : 'brand strategy research');
}

function parseSlashCommand(message: string): { command: string; argsText: string; argsJson: Record<string, unknown> | null } | null {
  const raw = String(message || '').trim();
  const match = raw.match(/^\/([a-z0-9_./-]+)(?:\s+([\s\S]+))?$/i);
  if (!match?.[1]) return null;

  const command = match[1].trim().toLowerCase();
  const argsText = String(match[2] || '').trim();
  if (!argsText) {
    return { command, argsText: '', argsJson: null };
  }

  if (argsText.startsWith('{') && argsText.endsWith('}')) {
    try {
      const parsed = JSON.parse(argsText);
      if (isRecord(parsed)) {
        return { command, argsText, argsJson: parsed };
      }
    } catch {
      // Keep argsText fallback for non-JSON slash commands.
    }
  }
  return { command, argsText, argsJson: null };
}

function extractDocumentEditDirective(message: string): {
  quotedText?: string;
  replacementText?: string;
} {
  const prompt = String(message || '').trim();
  if (!prompt) return {};

  const patterns: RegExp[] = [
    /replace\s+[“"]([^”"]+)[”"]\s+with\s+[“"]([^”"]*)[”"]/i,
    /replace\s+'([^']+)'\s+with\s+'([^']*)'/i,
    /change\s+[“"]([^”"]+)[”"]\s+(?:to|into)\s+[“"]([^”"]*)[”"]/i,
    /change\s+'([^']+)'\s+(?:to|into)\s+'([^']*)'/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const quotedText = String(match[1] || '').trim();
    const replacementText = String(match[2] || '').trim();
    if (quotedText) {
      return {
        quotedText,
        replacementText,
      };
    }
  }

  const quotedParts = Array.from(
    prompt.matchAll(/[“"]([^”"]{2,320})[”"]|'([^']{2,320})'/g),
    (match) => String(match[1] || match[2] || '').trim()
  ).filter(Boolean);
  if (
    quotedParts.length >= 2 &&
    /\b(replace|change|rewrite|update|swap)\b/i.test(prompt)
  ) {
    return {
      quotedText: quotedParts[0],
      replacementText: quotedParts[1],
    };
  }

  if (quotedParts.length >= 1 && /\b(remove|delete)\b/i.test(prompt)) {
    return {
      quotedText: quotedParts[0],
      replacementText: '',
    };
  }

  if (
    quotedParts.length >= 1 &&
    /\b(edit|rewrite|update|change|replace|quote|quoted|around|section)\b/i.test(prompt)
  ) {
    return {
      quotedText: quotedParts[0],
    };
  }

  return {};
}

export function stripLegacyBoilerplateResponse(content: string): string {
  const raw = String(content || '').trim();
  if (!raw) return '';

  const markers = [
    /fork from here/i,
    /how bat got here/i,
    /no tools executed in this run\./i,
    /tool execution trace:/i,
    /validation note:/i,
    /^next actions$/im,
    /^tools used$/im,
    /^assumptions$/im,
  ];
  const markerCount = markers.reduce((count, pattern) => (pattern.test(raw) ? count + 1 : count), 0);
  if (markerCount < 2) return raw;

  let cleaned = raw.replace(/^\s*fork from here\s*\n?/i, '').trim();
  cleaned = cleaned.replace(/\n{2,}how bat got here[\s\S]*$/i, '').trim();
  cleaned = cleaned.replace(/\n{2,}next actions[\s\S]*$/i, '').trim();
  cleaned = cleaned.replace(/\n{2,}tool execution trace:[\s\S]*$/i, '').trim();
  cleaned = cleaned.replace(/\n{2,}no tools executed in this run\.[\s\S]*$/i, '').trim();
  cleaned = cleaned.replace(/\n{2,}validation note:[\s\S]*$/i, '').trim();
  return cleaned;
}

const CLIENT_META_BLOCKLIST = [
  /\btool execution trace\b/gi,
  /\bexecution trace\b/gi,
  /\bvalidation note\b/gi,
  /\bno tools executed in this run\b/gi,
  /\bhow bat got here\b/gi,
  /\bfork from here\b/gi,
  /^tools used\s*$/gim,
  /^assumptions\s*$/gim,
];

function stripClientFacingIds(content: string): string {
  return String(content || '')
    .replace(/\b(run|snapshot|document|tool run)\s*[:#-]?\s*[a-f0-9]{6,}\b/gi, '$1')
    .replace(/(^|[\s•(])[a-f0-9]{8,}(?=([\s•),]|$))/gi, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.)])/g, '$1')
    .replace(/•\s*•/g, '•')
    .replace(/\(\s*\)/g, '')
    .trim();
}

export function sanitizeClientResponse(content: string): string {
  let cleaned = stripLegacyBoilerplateResponse(content);
  cleaned = cleaned.replace(/\n{0,2}tool execution trace:[\s\S]*$/i, '').trim();
  cleaned = cleaned.replace(/\n{0,2}validation note:[\s\S]*$/i, '').trim();
  cleaned = cleaned.replace(/\n{0,2}no tools executed in this run\.[\s\S]*$/i, '').trim();
  cleaned = cleaned.replace(/\n{0,2}how bat got here[\s\S]*$/i, '').trim();
  for (const pattern of CLIENT_META_BLOCKLIST) {
    cleaned = cleaned.replace(pattern, '');
  }
  cleaned = stripClientFacingIds(cleaned);
  cleaned = cleaned
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return cleaned;
}

function buildRuntimeContextSnapshot(context: RuntimeAgentContext): Record<string, unknown> {
  const websitesRaw = Array.isArray(context.workspace.inputData?.websites)
    ? context.workspace.inputData.websites
    : [];
  const website = String(context.workspace.inputData?.website || '').trim();
  const evidenceCounts = isRecord((context.evidence as Record<string, unknown>).counts)
    ? ((context.evidence as Record<string, unknown>).counts as Record<string, unknown>)
    : {};
  const websites = [
    ...(website ? [website] : []),
    ...websitesRaw.map((entry) => String(entry || '').trim()).filter(Boolean),
  ].slice(0, 6);

  return {
    clientName: context.workspace.clientName || null,
    websites,
    competitorsCount: Number(context.evidence.competitors?.discovered || 0),
    candidateCompetitorsCount: Number(context.evidence.competitors?.candidates || 0),
    webSnapshotsCount: Array.isArray(context.evidence.webSnapshots) ? context.evidence.webSnapshots.length : 0,
    socialPostsCount: Number(evidenceCounts.socialPosts || 0),
    newsCount: Number(evidenceCounts.news || 0),
    communityInsightsCount: Number(evidenceCounts.communityInsights || 0),
    pendingDecisionsCount: Array.isArray(context.runtime.pendingDecisions) ? context.runtime.pendingDecisions.length : 0,
    queuedMessagesCount: Array.isArray(context.runtime.queuedMessages) ? context.runtime.queuedMessages.length : 0,
    topCompetitors: Array.isArray(context.evidence.competitors?.topPicks)
      ? context.evidence.competitors.topPicks
          .map((entry) => String((entry as Record<string, unknown>).handle || '').trim())
          .filter(Boolean)
          .slice(0, 5)
      : [],
  };
}

async function loadFallbackRuntimeContextSnapshot(researchJobId: string): Promise<Record<string, unknown>> {
  const workspace = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    select: {
      inputData: true,
      client: {
        select: {
          name: true,
        },
      },
    },
  });

  const inputData = isRecord(workspace?.inputData) ? workspace?.inputData : {};
  const websites = extractWorkspaceWebsites(inputData);
  return {
    clientName: String(workspace?.client?.name || '').trim() || null,
    websites,
    competitorsCount: 0,
    candidateCompetitorsCount: 0,
    webSnapshotsCount: 0,
    socialPostsCount: 0,
    newsCount: 0,
    communityInsightsCount: 0,
    pendingDecisionsCount: 0,
    queuedMessagesCount: 0,
    topCompetitors: [],
  };
}

function buildGroundedFailureResponse(input: {
  contextSnapshot: Record<string, unknown>;
}): string {
  const context = input.contextSnapshot;
  const lines: string[] = [];

  lines.push('I hit a tool/runtime issue while preparing this response, but I can still ground you in your workspace state now.');

  const baseline = buildGroundedBaselineLines(context);

  if (baseline.length > 0) {
    lines.push(`Grounded baseline:\n${baseline.map((item, index) => `${index + 1}. ${item}`).join('\n')}`);
  }

  lines.push(
    'Next actions:\n1. Retry this run now.\n2. Run a narrower step first (for example `intel.list` or `web.fetch`) and then continue.\n3. Tell me if you want concise output for this specific reply.'
  );
  return lines.join('\n\n');
}

function buildGroundedBaselineLines(contextSnapshot: Record<string, unknown>): string[] {
  const clientName = String(contextSnapshot.clientName || '').trim();
  const websites = Array.isArray(contextSnapshot.websites)
    ? contextSnapshot.websites.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const competitorsCount = Number(contextSnapshot.competitorsCount || 0);
  const candidateCount = Number(contextSnapshot.candidateCompetitorsCount || 0);
  const webSnapshotsCount = Number(contextSnapshot.webSnapshotsCount || 0);
  const socialPostsCount = Number(contextSnapshot.socialPostsCount || 0);
  const newsCount = Number(contextSnapshot.newsCount || 0);
  const communityInsightsCount = Number(contextSnapshot.communityInsightsCount || 0);

  const baseline: string[] = [];
  if (clientName) baseline.push(`Workspace: ${clientName}.`);
  if (websites.length) baseline.push(`Known websites: ${websites.join(', ')}.`);
  if (Number.isFinite(webSnapshotsCount) && webSnapshotsCount > 0) {
    baseline.push(`Stored web snapshots: ${webSnapshotsCount}.`);
  }
  if (Number.isFinite(socialPostsCount) && socialPostsCount > 0) {
    baseline.push(`Stored social posts: ${socialPostsCount}.`);
  }
  if (Number.isFinite(newsCount) && newsCount > 0) {
    baseline.push(`Stored news items: ${newsCount}.`);
  }
  if (Number.isFinite(communityInsightsCount) && communityInsightsCount > 0) {
    baseline.push(`Stored community insights: ${communityInsightsCount}.`);
  }
  if (Number.isFinite(competitorsCount) && competitorsCount > 0) {
    baseline.push(`Discovered competitors: ${competitorsCount}.`);
  }
  if (Number.isFinite(candidateCount) && candidateCount > 0) {
    baseline.push(`Candidate competitors: ${candidateCount}.`);
  }
  return baseline;
}

function sanitizeFinalAssistantResponse(content: string, contextSnapshot: Record<string, unknown>): string {
  let cleaned = sanitizeClientResponse(content);
  const baseline = buildGroundedBaselineLines(contextSnapshot);
  if (!baseline.length) {
    return cleaned;
  }

  const missingDataPattern =
    /\b(i\s+(?:cannot|can't|do not|don't)\s+(?:access|see|find|have)\b|no\s+(?:crawl artifacts?|artifacts?|evidence|data)\s+(?:provided|available)|not\s+provided\s+in\s+(?:this|the)\s+chat)\b/i;
  if (!missingDataPattern.test(cleaned)) {
    return cleaned;
  }

  const contextLead = `Grounded workspace context:\n${baseline.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
  const filteredLines = cleaned
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !missingDataPattern.test(line));
  const trimmed = filteredLines.join('\n').trim();
  cleaned = trimmed ? `${contextLead}\n\n${trimmed}` : `${contextLead}\n\nI can continue directly from this context now.`;
  return sanitizeClientResponse(cleaned);
}

function normalizeUrlCandidate(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractWorkspaceWebsites(inputData: unknown): string[] {
  if (!isRecord(inputData)) return [];
  const candidates: unknown[] = [];

  if (typeof inputData.website === 'string') {
    candidates.push(inputData.website);
  }
  if (Array.isArray(inputData.websites)) {
    candidates.push(...inputData.websites);
  }

  const seen = new Set<string>();
  const websites: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeUrlCandidate(candidate);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    websites.push(normalized);
  }

  return websites.slice(0, 5);
}

function buildBootstrapPrompt(input: { brandName?: string | null; websites: string[] }) {
  const brand = String(input.brandName || '').trim();
  const sites = input.websites;
  const websiteClause = sites.length
    ? `Known websites: ${sites.join(', ')}.`
    : 'No websites are confirmed yet, so start from existing intelligence collections.';
  const crawlClause = sites.length
    ? `Run web.crawl on ${sites[0]} (respect domain boundaries), then inspect web_snapshots, competitors, community insights, social evidence, and news.`
    : 'Inspect web_sources, web_snapshots, competitors, community insights, social evidence, and news.';
  const brandClause = brand ? `Brand: ${brand}.` : '';

  return [BOOTSTRAP_PROMPT, brandClause, websiteClause, crawlClause].filter(Boolean).join(' ');
}

function shouldForceDiscoveryTools(input: { triggerType: AgentRunTriggerType; userMessage: string }): boolean {
  if (input.triggerType === AgentRunTriggerType.SCHEDULED_LOOP) return true;
  const normalized = input.userMessage.toLowerCase();
  return /(kickoff|intake|onboard|audit|investigat|analy[sz]e|strategy|workspace)/.test(normalized);
}

function buildFallbackDiscoveryToolCalls(userMessage: string, maxToolRuns: number): RuntimeToolCall[] {
  const calls: RuntimeToolCall[] = [];
  const seen = new Set<string>();
  const push = (tool: string, args: Record<string, unknown>) => {
    const key = `${tool}:${JSON.stringify(args)}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({ tool, args });
  };

  const primaryUrl = findFirstUrl(userMessage);
  if (primaryUrl) {
    push('web.crawl', { startUrls: [primaryUrl], maxPages: 20, maxDepth: 2, allowExternal: false });
  }
  push('orchestration.run', { targetCount: 12, mode: 'append' });
  push('intel.list', { section: 'web_snapshots', limit: 20 });
  push('intel.list', { section: 'competitors', limit: 12 });
  push('intel.list', { section: 'community_insights', limit: 10 });
  push('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
  push('evidence.news', { limit: 8 });

  return sanitizeToolCalls(calls, userMessage, maxToolRuns).slice(0, maxToolRuns);
}

function normalizeIntelListSection(sectionRaw: unknown, userMessage: string): string {
  const candidate = String(sectionRaw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (INTEL_LIST_SECTIONS.has(candidate)) return candidate;

  const normalizedMessage = userMessage.toLowerCase();
  if (/web|site|snapshot|page/.test(normalizedMessage)) return 'web_sources';
  if (/community|reddit|forum|insight/.test(normalizedMessage)) return 'community_insights';
  if (/news|press|mention/.test(normalizedMessage)) return 'news';
  if (/competitor|rival|alternative/.test(normalizedMessage)) return 'competitors';
  return 'competitors';
}

function normalizeToolArgs(tool: string, args: Record<string, unknown>, userMessage: string): Record<string, unknown> | null {
  const normalized = { ...args };

  if (tool === 'intel.list') {
    normalized.section = normalizeIntelListSection(normalized.section, userMessage);
    const limit = Number(normalized.limit);
    normalized.limit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 12;
    return normalized;
  }

  if (tool === 'intel.get') {
    normalized.section = normalizeIntelListSection(normalized.section, userMessage);
    const id = String(normalized.id || '').trim();
    const target = isRecord(normalized.target) ? normalized.target : null;
    if (id) {
      normalized.id = id;
    } else {
      delete normalized.id;
    }
    if (target && Object.keys(target).length > 0) {
      normalized.target = target;
    } else {
      delete normalized.target;
    }
    if (!normalized.id && !normalized.target) return null;
    return normalized;
  }

  if (tool === 'workspace.intake.get') {
    return {};
  }

  if (tool === 'evidence.news' || tool === 'evidence.videos') {
    const limit = Number(normalized.limit);
    normalized.limit = Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.floor(limit))) : 8;
    return normalized;
  }

  if (tool === 'evidence.posts') {
    const limit = Number(normalized.limit);
    normalized.limit = Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.floor(limit))) : 8;
    if (!['instagram', 'tiktok', 'any'].includes(String(normalized.platform || ''))) {
      normalized.platform = 'any';
    }
    if (!['engagement', 'recent'].includes(String(normalized.sort || ''))) {
      normalized.sort = 'engagement';
    }
    return normalized;
  }

  if (tool === 'web.fetch') {
    const url = String(normalized.url || '').trim() || findFirstUrl(userMessage) || '';
    if (!url) return null;
    normalized.url = url;
    if (!String(normalized.sourceType || '').trim()) normalized.sourceType = 'ARTICLE';
    if (!String(normalized.discoveredBy || '').trim()) normalized.discoveredBy = 'CHAT_TOOL';
    if (typeof normalized.allowExternal !== 'boolean') normalized.allowExternal = true;
    return normalized;
  }

  if (tool === 'web.crawl') {
    const startUrls = Array.isArray(normalized.startUrls)
      ? normalized.startUrls.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    if (!startUrls.length) {
      const fallbackUrl = String(normalized.url || '').trim() || findFirstUrl(userMessage) || '';
      if (fallbackUrl) startUrls.push(fallbackUrl);
    }
    if (!startUrls.length) return null;
    normalized.startUrls = startUrls.slice(0, 5);
    const maxPages = Number(normalized.maxPages);
    const maxDepth = Number(normalized.maxDepth);
    normalized.maxPages = Number.isFinite(maxPages) ? Math.max(1, Math.min(200, Math.floor(maxPages))) : 8;
    normalized.maxDepth = Number.isFinite(maxDepth) ? Math.max(0, Math.min(5, Math.floor(maxDepth))) : 1;
    if (typeof normalized.allowExternal !== 'boolean') normalized.allowExternal = true;
    return normalized;
  }

  if (tool === 'web.crawl.get_run') {
    const runId = String(normalized.runId || '').trim() || findReferencedCrawlRunId(userMessage) || '';
    if (!runId) return null;
    normalized.runId = runId;
    return normalized;
  }

  if (tool === 'web.crawl.list_snapshots') {
    const runId = String(normalized.runId || '').trim() || findReferencedCrawlRunId(userMessage) || '';
    if (!runId) return null;
    normalized.runId = runId;
    const limit = Number(normalized.limit);
    normalized.limit = Number.isFinite(limit) ? Math.max(1, Math.min(120, Math.floor(limit))) : 40;
    return normalized;
  }

  if (tool === 'web.extract') {
    const snapshotId = String(normalized.snapshotId || '').trim();
    if (!snapshotId) return null;
    normalized.snapshotId = snapshotId;
    return normalized;
  }

  if (tool === 'document.plan' || tool === 'document.generate' || tool === 'document.build_spec' || tool === 'document.render_pdf') {
    const requestedDocType = String(normalized.docType || '').trim().toUpperCase();
    if (requestedDocType === 'SWOT' || requestedDocType === 'SWOT_ANALYSIS') {
      normalized.docType = 'SWOT';
    } else if (requestedDocType === 'PLAYBOOK') {
      normalized.docType = 'PLAYBOOK';
    } else if (requestedDocType === 'CONTENT_CALENDAR' || requestedDocType === 'CONTENT_CALENDAR_LEGACY') {
      normalized.docType = 'CONTENT_CALENDAR';
    } else if (requestedDocType === 'COMPETITOR_AUDIT') {
      normalized.docType = 'COMPETITOR_AUDIT';
    } else if (requestedDocType === 'GO_TO_MARKET' || requestedDocType === 'GTM_PLAN') {
      normalized.docType = 'GO_TO_MARKET';
    } else if (
      requestedDocType === 'BUSINESS_STRATEGY' ||
      requestedDocType === 'STRATEGY_BRIEF'
    ) {
      normalized.docType = 'BUSINESS_STRATEGY';
    } else {
      normalized.docType = 'BUSINESS_STRATEGY';
    }
    const depthRaw = String(normalized.depth || '').trim().toLowerCase();
    const normalizedDepth = depthRaw === 'short' || depthRaw === 'standard' || depthRaw === 'deep' ? depthRaw : '';
    const forceQuickDraft = normalized.forceQuickDraft === true;
    if (!forceQuickDraft && DOCUMENT_ALWAYS_DEEP_ENABLED) {
      normalized.depth = 'deep';
    } else if (normalizedDepth) {
      normalized.depth = normalizedDepth;
    } else {
      normalized.depth = forceQuickDraft ? 'standard' : 'deep';
    }
    if (typeof normalized.includeCompetitors !== 'boolean') normalized.includeCompetitors = true;
    if (typeof normalized.includeEvidenceLinks !== 'boolean') normalized.includeEvidenceLinks = true;
    if (typeof normalized.requestedIntent === 'string') {
      normalized.requestedIntent = String(normalized.requestedIntent).trim().slice(0, 120);
    }
    return normalized;
  }

  if (tool === 'competitors.add_links') {
    const links = Array.isArray(normalized.links)
      ? normalized.links.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 10)
      : [];
    if (links.length) {
      normalized.links = links;
    } else {
      normalized.text = String(normalized.text || userMessage || '').trim();
    }
    return normalized;
  }

  if (tool === 'intake.update_from_text') {
    normalized.text = String(normalized.text || userMessage || '').trim();
    if (!normalized.text) return null;
    if (normalized.fields && !isRecord(normalized.fields)) {
      delete normalized.fields;
    }
    return normalized;
  }

  if (tool === 'orchestration.run') {
    const targetCount = Number(normalized.targetCount);
    normalized.targetCount = Number.isFinite(targetCount) ? Math.max(3, Math.min(30, Math.floor(targetCount))) : 12;
    normalized.mode = String(normalized.mode || '').toLowerCase() === 'replace' ? 'replace' : 'append';
    if (!['high', 'balanced'].includes(String(normalized.precision || '').toLowerCase())) {
      normalized.precision = 'balanced';
    }
    if (Array.isArray(normalized.surfaces)) {
      normalized.surfaces = normalized.surfaces
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter((entry) => ['instagram', 'tiktok', 'youtube', 'x', 'web'].includes(entry))
        .slice(0, 5);
      if (!(normalized.surfaces as string[]).length) {
        delete normalized.surfaces;
      }
    }
    return normalized;
  }

  if (tool === 'research.gather') {
    const query = String(normalized.query || normalized.text || userMessage || '').trim();
    if (!query) return null;
    normalized.query = query;

    const depthRaw = String(normalized.depth || '').trim().toLowerCase();
    if (depthRaw === 'deep' || depthRaw === 'quick' || depthRaw === 'standard') {
      normalized.depth = depthRaw;
    } else if (/\b(deep|deeper|thorough|full|comprehensive|detailed)\b/i.test(userMessage)) {
      normalized.depth = 'deep';
    } else if (/\b(quick|fast|brief)\b/i.test(userMessage)) {
      normalized.depth = 'quick';
    } else {
      normalized.depth = 'standard';
    }

    if (Array.isArray(normalized.handles)) {
      normalized.handles = normalized.handles
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 12);
      if (!(normalized.handles as string[]).length) {
        delete normalized.handles;
      }
    }

    if (Array.isArray(normalized.websites)) {
      normalized.websites = normalized.websites
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 8);
      if (!(normalized.websites as string[]).length) {
        delete normalized.websites;
      }
    }

    if (typeof normalized.includeScrapling !== 'boolean') normalized.includeScrapling = true;
    if (typeof normalized.includeAccountContext !== 'boolean') normalized.includeAccountContext = true;
    if (typeof normalized.includeWorkspaceWebsites !== 'boolean') normalized.includeWorkspaceWebsites = true;
    return normalized;
  }

  return normalized;
}

function sanitizeToolCalls(toolCalls: RuntimeToolCall[], userMessage: string, maxToolRuns: number): RuntimeToolCall[] {
  const sanitized: RuntimeToolCall[] = [];
  const seen = new Set<string>();

  for (const call of toolCalls) {
    if (!call || !String(call.tool || '').trim()) continue;

    const alias = TOOL_NAME_ALIASES[normalizeToolAliasKey(call.tool)];
    const toolName = alias?.tool || String(call.tool).trim();
    if (!SUPPORTED_TOOL_NAMES.has(toolName as (typeof TOOL_REGISTRY)[number]['name'])) continue;

    const mergedArgs = {
      ...(isRecord(call.args) ? call.args : {}),
      ...(alias?.args || {}),
    };
    const normalizedArgs = normalizeToolArgs(toolName, mergedArgs, userMessage);
    if (!normalizedArgs) continue;

    const key = `${toolName}:${stableJson(normalizedArgs)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    sanitized.push({
      tool: toolName,
      args: normalizedArgs,
      ...(Array.isArray(call.dependsOn) && call.dependsOn.length ? { dependsOn: call.dependsOn } : {}),
    });
  }

  const inferred = inferToolCallsFromMessage(userMessage);
  for (const call of inferred) {
    if (!SUPPORTED_TOOL_NAMES.has(call.tool as (typeof TOOL_REGISTRY)[number]['name'])) continue;
    const normalizedArgs = normalizeToolArgs(call.tool, isRecord(call.args) ? call.args : {}, userMessage);
    if (!normalizedArgs) continue;
    const key = `${call.tool}:${stableJson(normalizedArgs)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sanitized.push({ tool: call.tool, args: normalizedArgs });
  }

  const hasResearchIntent =
    /\b(investigat|research|analy[sz]e|profile|account|person|people|creator|founder|handle)\b/i.test(userMessage) &&
    /\b(deep|deeper|thorough|full|comprehensive|detailed|ddg|duckduckgo|scraply|scrapling)\b/i.test(userMessage);
  const researchIndex = sanitized.findIndex((entry) => entry.tool === 'research.gather');
  if (hasResearchIntent && researchIndex > 0) {
    const [researchCall] = sanitized.splice(researchIndex, 1);
    sanitized.unshift(researchCall);
  }

  return sanitized.slice(0, maxToolRuns);
}

type ToolFamily =
  | 'web_search'
  | 'crawl_extract'
  | 'workspace_intel'
  | 'social_signals'
  | 'news_signals'
  | 'competitor_discovery';

type ToolFamilyDiversityResult = {
  toolCalls: RuntimeToolCall[];
  familiesUsed: ToolFamily[];
  addedFamilies: ToolFamily[];
};

const TOOL_FAMILY_PRIORITY: ToolFamily[] = [
  'web_search',
  'workspace_intel',
  'competitor_discovery',
  'social_signals',
  'news_signals',
  'crawl_extract',
];
const LOOP_STALL_MAX_RETRIES = envRuntimeNumber('RUNTIME_LOOP_STALL_MAX_RETRIES', 2, 1, 5);
const LOOP_HISTORY_MAX = 24;
const LOOP_QUERY_FINGERPRINT_MAX = 64;
const LOOP_SEEN_EVIDENCE_MAX = 240;
const TOOL_FAMILY_SET = new Set<ToolFamily>(TOOL_FAMILY_PRIORITY);

function normalizeStringHistory(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const normalized = String(entry || '').trim();
    if (!normalized || deduped.has(normalized)) continue;
    deduped.add(normalized);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeNumberHistory(value: unknown, maxItems: number): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const entry of value) {
    const parsed = Number(entry);
    if (!Number.isFinite(parsed)) continue;
    out.push(parsed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeToolFamilyHistory(value: unknown, maxItems: number): ToolFamily[] {
  if (!Array.isArray(value)) return [];
  const out: ToolFamily[] = [];
  const seen = new Set<ToolFamily>();
  for (const entry of value) {
    const normalized = String(entry || '').trim().toLowerCase() as ToolFamily;
    if (!TOOL_FAMILY_SET.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function appendBoundedNumberHistory(history: number[], next: number, maxItems: number): number[] {
  const normalized = Number.isFinite(next) ? next : 0;
  return [...history.slice(-(Math.max(0, maxItems - 1))), normalized];
}

function appendBoundedStringHistory(history: string[], nextItems: string[], maxItems: number): string[] {
  if (!nextItems.length) return history.slice(-maxItems);
  const out = history.slice(-maxItems);
  for (const item of nextItems) {
    const normalized = String(item || '').trim();
    if (!normalized) continue;
    out.push(normalized);
  }
  const deduped = new Set<string>();
  const compact: string[] = [];
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const value = out[index];
    if (deduped.has(value)) continue;
    deduped.add(value);
    compact.push(value);
    if (compact.length >= maxItems) break;
  }
  return compact.reverse();
}

function appendBoundedFamilyHistory(history: ToolFamily[], nextItems: ToolFamily[], maxItems: number): ToolFamily[] {
  if (!nextItems.length) return history.slice(-maxItems);
  const out = history.slice(-maxItems);
  for (const item of nextItems) {
    if (!TOOL_FAMILY_SET.has(item)) continue;
    out.push(item);
  }
  return out.slice(-maxItems);
}

function laneToToolFamily(laneRaw: unknown): ToolFamily | null {
  const lane = String(laneRaw || '').trim().toLowerCase();
  if (!lane) return null;
  if (lane.includes('competitor') || lane.includes('battlecard') || lane.includes('market_map')) return 'competitor_discovery';
  if (lane.includes('news') || lane.includes('press')) return 'news_signals';
  if (lane.includes('social') || lane.includes('post') || lane.includes('video')) return 'social_signals';
  if (lane.includes('crawl') || lane.includes('extract') || lane.includes('snapshot') || lane.includes('web_fetch')) return 'crawl_extract';
  if (lane.includes('intel') || lane.includes('workspace') || lane.includes('library')) return 'workspace_intel';
  if (lane.includes('web') || lane.includes('search') || lane.includes('site')) return 'web_search';
  return null;
}

function preferredFamiliesFromLanePriority(value: unknown): ToolFamily[] {
  if (!Array.isArray(value)) return [];
  const out: ToolFamily[] = [];
  const seen = new Set<ToolFamily>();
  for (const lane of value) {
    const family = laneToToolFamily(lane);
    if (!family || seen.has(family)) continue;
    seen.add(family);
    out.push(family);
  }
  return out;
}

function toolCallFingerprint(call: RuntimeToolCall): string {
  return `${String(call.tool || '').trim().toLowerCase()}:${stableJson(isRecord(call.args) ? call.args : {})}`;
}

function buildToolCallFingerprints(toolCalls: RuntimeToolCall[], maxItems: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const call of toolCalls) {
    const key = toolCallFingerprint(call);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= maxItems) break;
  }
  return out;
}

function countConsecutiveLowDeltaLoops(coverageDeltaHistory: number[], newEvidenceRefCountHistory: number[]): number {
  const span = Math.min(coverageDeltaHistory.length, newEvidenceRefCountHistory.length);
  let count = 0;
  for (let index = span - 1; index >= 0; index -= 1) {
    const coverageDelta = Number(coverageDeltaHistory[index] || 0);
    const novelty = Number(newEvidenceRefCountHistory[index] || 0);
    if (coverageDelta <= 0 && novelty <= 0) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function chooseAlternateFamiliesForStall(input: {
  availableFamilies: ToolFamily[];
  currentFamilies: ToolFamily[];
  familyHistory: ToolFamily[];
  preferredFamilies: ToolFamily[];
}): ToolFamily[] {
  if (!input.availableFamilies.length) return [];
  const currentSet = new Set<ToolFamily>(input.currentFamilies);
  const recentHistory = input.familyHistory.slice(-10);
  const usage = new Map<ToolFamily, number>();
  for (const family of recentHistory) {
    usage.set(family, (usage.get(family) || 0) + 1);
  }
  const preferredRank = new Map<ToolFamily, number>();
  input.preferredFamilies.forEach((family, index) => preferredRank.set(family, index));
  const sorted = [...input.availableFamilies].sort((left, right) => {
    const leftCurrent = currentSet.has(left) ? 1 : 0;
    const rightCurrent = currentSet.has(right) ? 1 : 0;
    if (leftCurrent !== rightCurrent) return leftCurrent - rightCurrent;
    const leftPreferred = preferredRank.has(left) ? preferredRank.get(left)! : Number.MAX_SAFE_INTEGER;
    const rightPreferred = preferredRank.has(right) ? preferredRank.get(right)! : Number.MAX_SAFE_INTEGER;
    if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
    const leftUsage = usage.get(left) || 0;
    const rightUsage = usage.get(right) || 0;
    if (leftUsage !== rightUsage) return leftUsage - rightUsage;
    return TOOL_FAMILY_PRIORITY.indexOf(left) - TOOL_FAMILY_PRIORITY.indexOf(right);
  });
  return sorted.slice(0, 2);
}

function pickQueryVariantForLoop(value: unknown, loopIndex: number): string | null {
  const variants = normalizeStringHistory(value, 12);
  if (!variants.length) return null;
  const index = Math.max(0, (Math.max(1, loopIndex) - 1) % variants.length);
  return variants[index] || null;
}

function pickLaneForLoop(value: unknown, loopIndex: number): string | null {
  const lanes = normalizeStringHistory(value, 12);
  if (!lanes.length) return null;
  const index = Math.max(0, (Math.max(1, loopIndex) - 1) % lanes.length);
  return lanes[index] || null;
}

function toolFamilyForTool(toolNameRaw: string): ToolFamily | null {
  const tool = String(toolNameRaw || '').trim().toLowerCase();
  if (tool === 'search.web' || tool === 'research.gather') return 'web_search';
  if (tool === 'web.crawl' || tool === 'web.fetch' || tool === 'web.extract' || tool === 'web.crawl.list_snapshots') {
    return 'crawl_extract';
  }
  if (tool === 'intel.list' || tool === 'intel.get') return 'workspace_intel';
  if (tool === 'evidence.posts' || tool === 'evidence.videos') return 'social_signals';
  if (tool === 'evidence.news') return 'news_signals';
  if (tool === 'competitors.discover_v3' || tool === 'orchestration.run' || tool === 'orchestration.status') {
    return 'competitor_discovery';
  }
  return null;
}

function listToolFamilies(toolCalls: RuntimeToolCall[]): ToolFamily[] {
  const seen = new Set<ToolFamily>();
  for (const call of toolCalls) {
    const family = toolFamilyForTool(call.tool);
    if (!family) continue;
    seen.add(family);
  }
  return Array.from(seen);
}

function listAvailableToolFamilies(policy: RunPolicy): ToolFamily[] {
  const available = new Set<ToolFamily>(['workspace_intel']);
  if (policy.sourceScope.webSearch) {
    available.add('web_search');
    available.add('news_signals');
    available.add('competitor_discovery');
  }
  if (policy.sourceScope.socialIntel) {
    available.add('social_signals');
    available.add('competitor_discovery');
  }
  if (policy.sourceScope.liveWebsiteCrawl) {
    available.add('crawl_extract');
  }
  return Array.from(available);
}

function requiredFamilyCount(policy: RunPolicy, availableFamilies: ToolFamily[]): number {
  if (policy.responseMode === 'pro') return Math.max(1, Math.min(4, availableFamilies.length));
  if (policy.responseMode === 'deep') return Math.max(1, Math.min(3, availableFamilies.length));
  return 0;
}

function buildFamilyCandidateToolCall(input: {
  family: ToolFamily;
  userMessage: string;
  policy: RunPolicy;
  runtimeContextSnapshot?: Record<string, unknown>;
}): RuntimeToolCall | null {
  const query = compactPromptString(input.userMessage, 180) || 'brand strategy research';
  const websiteCandidates = Array.isArray(input.runtimeContextSnapshot?.websites)
    ? input.runtimeContextSnapshot?.websites.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const firstWebsite = websiteCandidates[0] || findFirstUrl(input.userMessage) || '';

  if (input.family === 'web_search') {
    return {
      tool: input.policy.responseMode === 'pro' ? 'research.gather' : 'search.web',
      args:
        input.policy.responseMode === 'pro'
          ? {
              query,
              depth: 'deep',
              includeScrapling: true,
              includeAccountContext: true,
              includeWorkspaceWebsites: true,
            }
          : {
              query,
              count: 10,
              provider: 'auto',
            },
    };
  }

  if (input.family === 'crawl_extract') {
    if (!firstWebsite) return null;
    return {
      tool: 'web.crawl',
      args: {
        startUrls: [firstWebsite],
        maxPages: input.policy.responseMode === 'pro' ? 16 : 10,
        maxDepth: input.policy.responseMode === 'pro' ? 2 : 1,
        allowExternal: false,
      },
    };
  }

  if (input.family === 'workspace_intel') {
    return {
      tool: 'intel.list',
      args: {
        section: 'web_snapshots',
        limit: 20,
      },
    };
  }

  if (input.family === 'social_signals') {
    return {
      tool: 'evidence.posts',
      args: {
        platform: 'any',
        sort: 'engagement',
        limit: 10,
      },
    };
  }

  if (input.family === 'news_signals') {
    return {
      tool: 'evidence.news',
      args: {
        limit: 10,
      },
    };
  }

  if (input.family === 'competitor_discovery') {
    if (input.policy.sourceScope.webSearch) {
      return {
        tool: 'competitors.discover_v3',
        args: {
          mode: input.policy.responseMode === 'pro' ? 'deep' : 'standard',
          maxCandidates: input.policy.responseMode === 'pro' ? 120 : 80,
          maxEnrich: input.policy.responseMode === 'pro' ? 10 : 6,
        },
      };
    }
    if (input.policy.sourceScope.socialIntel) {
      return {
        tool: 'orchestration.run',
        args: {
          targetCount: 12,
          mode: 'append',
          precision: 'balanced',
        },
      };
    }
    return null;
  }

  return null;
}

function enforceToolFamilyDiversity(input: {
  toolCalls: RuntimeToolCall[];
  policy: RunPolicy;
  userMessage: string;
  maxToolRuns: number;
  runtimeContextSnapshot?: Record<string, unknown>;
  preferredFamilies?: ToolFamily[];
}): ToolFamilyDiversityResult {
  const availableFamilies = listAvailableToolFamilies(input.policy);
  const required = requiredFamilyCount(input.policy, availableFamilies);
  const existingFamilies = listToolFamilies(input.toolCalls);

  if (required <= 0 || existingFamilies.length >= required) {
    return {
      toolCalls: input.toolCalls.slice(0, input.maxToolRuns),
      familiesUsed: existingFamilies,
      addedFamilies: [],
    };
  }

  const preferred = Array.isArray(input.preferredFamilies)
    ? input.preferredFamilies.filter((family) => availableFamilies.includes(family))
    : [];
  const familyOrder = [
    ...preferred,
    ...TOOL_FAMILY_PRIORITY.filter((family) => !preferred.includes(family)),
  ].filter((family) => availableFamilies.includes(family));
  const missingFamilies = familyOrder.filter((family) => !existingFamilies.includes(family));
  const existingKeys = new Set(input.toolCalls.map((call) => `${call.tool}:${stableJson(call.args || {})}`));
  const addedCalls: RuntimeToolCall[] = [];
  const addedFamilies: ToolFamily[] = [];

  for (const family of missingFamilies) {
    const candidate = buildFamilyCandidateToolCall({
      family,
      userMessage: input.userMessage,
      policy: input.policy,
      ...(input.runtimeContextSnapshot ? { runtimeContextSnapshot: input.runtimeContextSnapshot } : {}),
    });
    if (!candidate) continue;
    const key = `${candidate.tool}:${stableJson(candidate.args || {})}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    addedCalls.push(candidate);
    addedFamilies.push(family);
    if (existingFamilies.length + addedFamilies.length >= required) break;
  }

  if (!addedCalls.length) {
    return {
      toolCalls: input.toolCalls.slice(0, input.maxToolRuns),
      familiesUsed: existingFamilies,
      addedFamilies: [],
    };
  }

  const merged = [...addedCalls, ...input.toolCalls];
  const bounded = [...merged];
  const familyCounts = new Map<ToolFamily, number>();
  for (const call of bounded) {
    const family = toolFamilyForTool(call.tool);
    if (!family) continue;
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }

  while (bounded.length > input.maxToolRuns) {
    let removalIndex = -1;
    for (let index = bounded.length - 1; index >= 0; index -= 1) {
      const toolName = String(bounded[index].tool || '').trim().toLowerCase();
      if (toolName === 'document.generate') continue;
      const family = toolFamilyForTool(toolName);
      if (family && (familyCounts.get(family) || 0) > 1) {
        removalIndex = index;
        break;
      }
    }
    if (removalIndex < 0) {
      for (let index = bounded.length - 1; index >= 0; index -= 1) {
        const toolName = String(bounded[index].tool || '').trim().toLowerCase();
        if (toolName === 'document.generate') continue;
        removalIndex = index;
        break;
      }
    }
    if (removalIndex < 0) break;
    const removed = bounded.splice(removalIndex, 1)[0];
    const family = toolFamilyForTool(removed.tool);
    if (family) {
      familyCounts.set(family, Math.max(0, (familyCounts.get(family) || 0) - 1));
    }
  }

  return {
    toolCalls: bounded.slice(0, input.maxToolRuns),
    familiesUsed: listToolFamilies(bounded),
    addedFamilies,
  };
}

type RuntimeDocumentCoverage = {
  score: number;
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
  reasons: string[];
};

function isDocumentGenerateCall(call: RuntimeToolCall): boolean {
  return String(call.tool || '').trim().toLowerCase() === 'document.generate';
}

function resolveDocumentGenerateDepth(call: RuntimeToolCall | null): 'short' | 'standard' | 'deep' {
  if (!call || !isRecord(call.args)) return 'deep';
  const raw = String(call.args.depth || '').trim().toLowerCase();
  if (raw === 'short' || raw === 'standard' || raw === 'deep') return raw;
  return 'deep';
}

function scoreRuntimeDocumentCoverage(contextSnapshot: Record<string, unknown>): RuntimeDocumentCoverage {
  const counts = {
    competitors: Math.max(0, Math.floor(Number(contextSnapshot.competitorsCount || 0))),
    posts: Math.max(0, Math.floor(Number(contextSnapshot.socialPostsCount || 0))),
    webSnapshots: Math.max(0, Math.floor(Number(contextSnapshot.webSnapshotsCount || 0))),
    news: Math.max(0, Math.floor(Number(contextSnapshot.newsCount || 0))),
    community: Math.max(0, Math.floor(Number(contextSnapshot.communityInsightsCount || 0))),
  };
  const targets = {
    competitors: 12,
    posts: 18,
    webSnapshots: 10,
    news: 7,
    community: 6,
  };
  const weights = {
    competitors: 0.25,
    posts: 0.25,
    webSnapshots: 0.2,
    news: 0.15,
    community: 0.15,
  } as const;

  const component = (key: keyof typeof counts): number => {
    const target = Number(targets[key] || 0);
    if (target <= 0) return 1;
    return Math.max(0, Math.min(1, counts[key] / target));
  };

  const rawScore =
    component('competitors') * weights.competitors +
    component('posts') * weights.posts +
    component('webSnapshots') * weights.webSnapshots +
    component('news') * weights.news +
    component('community') * weights.community;
  const score = Math.max(0, Math.min(100, Math.round(rawScore * 100)));

  const reasons: string[] = [];
  if (counts.competitors < targets.competitors) {
    reasons.push(`Competitor evidence is thin (${counts.competitors}/${targets.competitors}).`);
  }
  if (counts.posts < targets.posts) {
    reasons.push(`Social signal density is thin (${counts.posts}/${targets.posts}).`);
  }
  if (counts.webSnapshots < targets.webSnapshots) {
    reasons.push(`Web snapshot coverage is thin (${counts.webSnapshots}/${targets.webSnapshots}).`);
  }
  if (counts.news < targets.news) {
    reasons.push(`News signal coverage is thin (${counts.news}/${targets.news}).`);
  }
  if (counts.community < targets.community) {
    reasons.push(`Community signal coverage is thin (${counts.community}/${targets.community}).`);
  }

  return {
    score,
    counts,
    targets,
    reasons: reasons.length ? reasons : ['Coverage is strong enough for deep document generation.'],
  };
}

function maybeInjectDocumentEnrichmentToolCalls(input: {
  toolCalls: RuntimeToolCall[];
  triggerMessage: string;
  runtimeContextSnapshot?: Record<string, unknown>;
  maxToolRuns: number;
}): {
  toolCalls: RuntimeToolCall[];
  enrichmentApplied: boolean;
  coverage: RuntimeDocumentCoverage | null;
  addedTools: string[];
} {
  const docCall = input.toolCalls.find((call) => isDocumentGenerateCall(call)) || null;
  if (!docCall) {
    return {
      toolCalls: input.toolCalls,
      enrichmentApplied: false,
      coverage: null,
      addedTools: [],
    };
  }

  const depth = resolveDocumentGenerateDepth(docCall);
  if (depth !== 'deep') {
    return {
      toolCalls: input.toolCalls,
      enrichmentApplied: false,
      coverage: null,
      addedTools: [],
    };
  }

  const context = isRecord(input.runtimeContextSnapshot) ? input.runtimeContextSnapshot : {};
  const coverage = scoreRuntimeDocumentCoverage(context);
  if (coverage.score >= DOCUMENT_ENRICHMENT_MIN_SCORE) {
    return {
      toolCalls: input.toolCalls,
      enrichmentApplied: false,
      coverage,
      addedTools: [],
    };
  }

  const query = compactPromptString(input.triggerMessage, 220) || 'Collect additional validated evidence for the active workspace';
  const needsCompetitors = coverage.counts.competitors < coverage.targets.competitors;
  const needsPosts = coverage.counts.posts < coverage.targets.posts;
  const needsWeb = coverage.counts.webSnapshots < coverage.targets.webSnapshots;
  const needsNews = coverage.counts.news < coverage.targets.news;
  const needsCommunity = coverage.counts.community < coverage.targets.community;
  const previousQuality = isRecord(context.lastDocumentQuality) ? context.lastDocumentQuality : {};
  const qualityReasons = Array.isArray(previousQuality.partialReasons)
    ? previousQuality.partialReasons.map((entry) => String(entry || '').toLowerCase())
    : [];
  const shouldPrioritizeCompetitors = qualityReasons.some((reason) => reason.includes('competitor'));
  const shouldPrioritizeWeb = qualityReasons.some((reason) => reason.includes('web snapshot') || reason.includes('web'));
  const shouldPrioritizeNews = qualityReasons.some((reason) => reason.includes('news'));

  const candidates: RuntimeToolCall[] = [];
  const prioritizedCandidates: RuntimeToolCall[] = [];
  const enqueueCandidate = (call: RuntimeToolCall, prioritized = false) => {
    if (prioritized) {
      prioritizedCandidates.push(call);
      return;
    }
    candidates.push(call);
  };
  if (needsWeb || needsNews || needsCommunity || needsPosts || needsCompetitors) {
    enqueueCandidate({
      tool: 'research.gather',
      args: {
        query,
        depth: 'standard',
        includeScrapling: false,
        includeAccountContext: true,
        includeWorkspaceWebsites: true,
      },
    }, shouldPrioritizeWeb || shouldPrioritizeNews);
  }
  if (needsCompetitors) {
    enqueueCandidate({
      tool: 'competitors.discover_v3',
      args: {
        mode: 'standard',
        maxCandidates: 60,
        maxEnrich: 4,
      },
    }, shouldPrioritizeCompetitors);
  }
  if (needsPosts) {
    enqueueCandidate({
      tool: 'evidence.posts',
      args: {
        platform: 'any',
        sort: 'engagement',
        limit: 8,
      },
    });
  }
  if (needsNews) {
    enqueueCandidate({
      tool: 'evidence.news',
      args: {
        limit: 6,
      },
    }, shouldPrioritizeNews);
  }
  const orderedCandidates = [...prioritizedCandidates, ...candidates];

  const existing = new Set(input.toolCalls.map((call) => `${call.tool}:${stableJson(call.args || {})}`));
  const addedCalls: RuntimeToolCall[] = [];
  const maxAddedTools = 3;
  for (const candidate of orderedCandidates) {
    if (addedCalls.length >= maxAddedTools) break;
    const key = `${candidate.tool}:${stableJson(candidate.args || {})}`;
    if (existing.has(key)) continue;
    existing.add(key);
    addedCalls.push(candidate);
  }

  if (!addedCalls.length) {
    return {
      toolCalls: input.toolCalls,
      enrichmentApplied: false,
      coverage,
      addedTools: [],
    };
  }

  const merged = [...addedCalls, ...input.toolCalls];
  let bounded = merged.slice(0, Math.max(1, input.maxToolRuns));

  if (!bounded.some((call) => isDocumentGenerateCall(call))) {
    const originalDocCall = input.toolCalls.find((call) => isDocumentGenerateCall(call));
    if (originalDocCall) {
      if (bounded.length >= input.maxToolRuns) {
        bounded[bounded.length - 1] = originalDocCall;
      } else {
        bounded.push(originalDocCall);
      }
    }
  }

  const boundedWithEnrichmentFlag = bounded.map((call) => {
    if (!isDocumentGenerateCall(call)) return call;
    return {
      ...call,
      args: {
        ...(isRecord(call.args) ? call.args : {}),
        enrichmentPerformed: true,
      },
    };
  });

  return {
    toolCalls: boundedWithEnrichmentFlag,
    enrichmentApplied: true,
    coverage,
    addedTools: addedCalls.map((call) => call.tool),
  };
}

function resolveDocFamilyFromPlan(plan: RuntimePlan | null): string | undefined {
  const toolCalls = Array.isArray(plan?.toolCalls) ? plan!.toolCalls : [];
  for (const call of toolCalls) {
    const tool = String(call.tool || '').trim().toLowerCase();
    if (tool !== 'document.generate' && tool !== 'document.plan' && tool !== 'document.build_spec' && tool !== 'document.render_pdf') {
      continue;
    }
    const rawDocType = String((isRecord(call.args) ? call.args.docType : '') || '').trim();
    if (!rawDocType) continue;
    return canonicalDocFamily(rawDocType);
  }
  return undefined;
}

function buildLoopRuntimeState(input: {
  plan: RuntimePlan;
  policy: RunPolicy;
  contextSnapshot?: Record<string, unknown>;
}): {
  loopIndex: number;
  loopMax: number;
  loopReason: string;
  coverageDelta: number;
  coverageScore?: number;
} {
  const continuationDepth = Number(input.plan.runtime?.continuationDepth || 0);
  const loopIndex = Math.max(1, continuationDepth + 1);
  const loopMax = Math.max(loopIndex, Number(input.policy.maxAutoContinuations || 0) + 1);
  const context = isRecord(input.contextSnapshot) ? input.contextSnapshot : {};
  const previousCoverage = Number(context.previousDocumentCoverageScore);
  const coverageScore = Number(context.documentCoverageScore);
  const coverageDelta =
    Number.isFinite(coverageScore) && Number.isFinite(previousCoverage)
      ? Math.round((coverageScore - previousCoverage) * 10) / 10
      : 0;
  return {
    loopIndex,
    loopMax,
    loopReason: continuationDepth > 0 ? 'auto_continue' : 'initial',
    coverageDelta,
    ...(Number.isFinite(coverageScore) ? { coverageScore } : {}),
  };
}

function isDocumentFocusedRun(input: { plan: RuntimePlan; toolRuns: Array<{ toolName: string }> }): boolean {
  const planHasDocument = input.plan.toolCalls.some((call) => /^document\./i.test(String(call.tool || '').trim()));
  const runHasDocument = input.toolRuns.some((run) => /^document\./i.test(String(run.toolName || '').trim()));
  return planHasDocument || runHasDocument;
}

function extractDocumentRuntimeTarget(toolResults: RuntimeToolResult[]): {
  runtimeDocumentId?: string;
  storagePath?: string;
  title?: string;
  docType?: string;
  coverageScore?: number;
} {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const raw = isRecord(toolResults[index].raw) ? (toolResults[index].raw as Record<string, unknown>) : null;
    if (!raw) continue;
    const runtimeDocumentId = String(raw.documentId || raw.runtimeDocumentId || '').trim();
    const storagePath = String(raw.storagePath || '').trim();
    const title = String(raw.title || '').trim();
    const docType = String(raw.docType || raw.documentType || '').trim().toUpperCase();
    const coverageScore = Number(raw.coverageScore);
    return {
      ...(runtimeDocumentId ? { runtimeDocumentId } : {}),
      ...(storagePath ? { storagePath } : {}),
      ...(title ? { title } : {}),
      ...(docType ? { docType } : {}),
      ...(Number.isFinite(coverageScore) ? { coverageScore } : {}),
    };
  }
  return {};
}

function normalizeStorageHref(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith('/storage/')) return normalized;
  if (normalized.startsWith('storage/')) return `/${normalized}`;
  if (normalized.startsWith('./storage/')) return `/${normalized.slice(2)}`;
  return normalized;
}

function extractDocumentArtifact(toolResults: RuntimeToolResult[]): Record<string, unknown> | null {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const raw = isRecord(toolResults[index].raw) ? (toolResults[index].raw as Record<string, unknown>) : null;
    if (!raw) continue;
    const storagePath = String(raw.storagePath || raw.downloadPath || raw.path || '').trim();
    const runtimeDocumentId = String(raw.documentId || raw.runtimeDocumentId || raw.docId || '').trim();
    const hasSignals = Boolean(storagePath || runtimeDocumentId || raw.docId || raw.coverageScore !== undefined);
    if (!hasSignals) continue;

    const title = String(raw.title || raw.fileName || raw.documentTitle || raw.docTitle || raw.docType || 'Generated document').trim();
    const docType = String(raw.docType || raw.documentType || '').trim().toUpperCase();
    const familyRaw = String(raw.family || raw.docFamily || '').trim().toUpperCase();
    const family = familyRaw || (docType ? canonicalDocFamily(docType) : '');
    const versionId = String(raw.versionId || '').trim();
    const versionNumber = Number(raw.versionNumber || raw.version || raw.docVersionNumber);
    const formatRaw = String(raw.format || 'PDF').trim().toUpperCase();
    const format = formatRaw === 'DOCX' || formatRaw === 'MD' ? formatRaw : 'PDF';
    const previewModeDefaultRaw = String(raw.previewModeDefault || '').trim().toLowerCase();
    const previewModeDefault = previewModeDefaultRaw === 'markdown' ? 'markdown' : 'pdf';
    const downloadHref = normalizeStorageHref(
      String(raw.downloadHref || raw.storageHref || raw.href || raw.url || storagePath || '').trim()
    );
    const previewHref = normalizeStorageHref(String(raw.previewHref || downloadHref || storagePath || '').trim());
    const partialReasons = Array.isArray(raw.partialReasons)
      ? raw.partialReasons.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 6)
      : [];
    const coverageScore = Number(raw.coverageScore);

    return {
      type: 'document_artifact',
      title: title || 'Generated document',
      docType: docType || undefined,
      ...(family ? { family } : {}),
      format,
      storagePath: storagePath || downloadHref || previewHref || '',
      ...(downloadHref ? { downloadHref } : {}),
      ...(previewHref ? { previewHref } : {}),
      ...(runtimeDocumentId ? { documentId: runtimeDocumentId } : {}),
      ...(versionId ? { versionId } : {}),
      ...(Number.isFinite(versionNumber) ? { versionNumber: Math.max(1, Math.floor(versionNumber)) } : {}),
      previewModeDefault,
      ...(Number.isFinite(coverageScore) ? { coverageScore } : {}),
      ...(typeof raw.partial === 'boolean' ? { partial: raw.partial } : {}),
      ...(partialReasons.length ? { partialReasons } : {}),
    };
  }
  return null;
}

function hasPartialDocumentResult(toolResults: RuntimeToolResult[]): boolean {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const raw = isRecord(toolResults[index].raw) ? (toolResults[index].raw as Record<string, unknown>) : null;
    if (!raw) continue;
    const hasDocumentSignals = Boolean(
      String(raw.documentId || raw.runtimeDocumentId || raw.docId || '').trim() ||
        String(raw.storagePath || '').trim() ||
        raw.coverageScore !== undefined ||
        raw.coverageBand !== undefined ||
        raw.partial !== undefined
    );
    if (!hasDocumentSignals) continue;

    if (raw.partial === true) return true;
    if (raw.partial === false) return false;

    const coverageBand = String(raw.coverageBand || '').trim().toLowerCase();
    if (coverageBand === 'thin') return true;
    if (coverageBand === 'moderate' || coverageBand === 'strong') return false;
  }
  return false;
}

function resolveDocumentDepthFromPlan(plan: RuntimePlan | null): 'short' | 'standard' | 'deep' {
  const toolCalls = Array.isArray(plan?.toolCalls) ? plan!.toolCalls : [];
  for (const call of toolCalls) {
    const tool = String(call.tool || '').trim().toLowerCase();
    if (tool !== 'document.generate' && tool !== 'document.plan' && tool !== 'document.build_spec' && tool !== 'document.render_pdf') {
      continue;
    }
    const depth = String((isRecord(call.args) ? call.args.depth : '') || '')
      .trim()
      .toLowerCase();
    if (depth === 'short' || depth === 'deep') return depth;
    if (depth === 'standard') return 'standard';
  }
  return DOCUMENT_ALWAYS_DEEP_ENABLED ? 'deep' : 'standard';
}

function resolveDocumentRunBudgetMs(plan: RuntimePlan | null, policy?: RunPolicy): number {
  if (policy?.responseMode === 'pro') return DOCUMENT_RUN_BUDGET_PRO_MS;
  const depth = resolveDocumentDepthFromPlan(plan);
  if (depth === 'short') return DOCUMENT_RUN_BUDGET_SHORT_MS;
  if (depth === 'deep') return DOCUMENT_RUN_BUDGET_DEEP_MS;
  return DOCUMENT_RUN_BUDGET_STANDARD_MS;
}

function buildDocumentBudgetPartialMessage(input: {
  runElapsedMs: number;
  budgetMs: number;
  contextSnapshot: Record<string, unknown>;
  toolResults: RuntimeToolResult[];
}): {
  content: string;
  actions: Array<{ label: string; action: string; payload?: Record<string, unknown> }>;
} {
  const target = extractDocumentRuntimeTarget(input.toolResults);
  const coverageScore = Number(input.contextSnapshot.documentCoverageScore || target.coverageScore || 0);
  const websites = Array.isArray(input.contextSnapshot.websites)
    ? input.contextSnapshot.websites.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  const elapsedMin = Math.max(1, Math.round(input.runElapsedMs / 60_000));
  const budgetMin = Math.max(1, Math.round(input.budgetMs / 60_000));

  const lines: string[] = [
    `I returned the best available draft after ${elapsedMin} minute(s) to stay within the ${budgetMin}-minute runtime budget.`,
    'You can continue deepening now without losing current progress.',
  ];

  if (Number.isFinite(coverageScore) && coverageScore > 0) {
    lines.push(`Current evidence coverage score: ${Math.round(coverageScore)}/100.`);
  }
  if (websites.length) {
    lines.push(`Known website scope: ${websites.join(', ')}.`);
  }

  const actions: Array<{ label: string; action: string; payload?: Record<string, unknown> }> = [];
  if (target.runtimeDocumentId) {
    actions.push({
      label: 'Open Draft In Docs',
      action: 'document.read',
      payload: { documentId: target.runtimeDocumentId },
    });
  }
  if (target.storagePath) {
    actions.push({
      label: 'Download Current PDF',
      action: 'document.download',
      payload: { storagePath: target.storagePath },
    });
  }
  actions.push({
    label: 'Continue Deepening Document',
    action: 'document.generate',
    payload: {
      docType: target.docType || 'BUSINESS_STRATEGY',
      depth: 'deep',
      continueDeepening: true,
      ...(target.runtimeDocumentId ? { resumeDocumentId: target.runtimeDocumentId } : {}),
    },
  });

  return {
    content: lines.join('\n\n'),
    actions,
  };
}

type SourceScopeBlockedTool = {
  tool: string;
  lane: 'web_search' | 'live_website_crawl' | 'social_intel';
  reason: string;
  fallbackTool?: RuntimeToolCall;
};

function parseHostname(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return String(new URL(normalized).hostname || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function parseHostnames(values: unknown[]): string[] {
  const hosts = new Set<string>();
  for (const value of values) {
    const hostname = parseHostname(value);
    if (!hostname) continue;
    hosts.add(hostname.replace(/^www\./, ''));
  }
  return Array.from(hosts);
}

function isAllowedWebsiteUrl(url: string, allowedHosts: string[]): boolean {
  const hostname = parseHostname(url).replace(/^www\./, '');
  if (!hostname) return false;
  return allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function enforceToolSourceScope(input: {
  toolCalls: RuntimeToolCall[];
  policy: RunPolicy;
  runtimeContextSnapshot?: Record<string, unknown>;
  maxToolRuns: number;
}): { toolCalls: RuntimeToolCall[]; blocked: SourceScopeBlockedTool[] } {
  const blocked: SourceScopeBlockedTool[] = [];
  const output: RuntimeToolCall[] = [];
  const seen = new Set<string>();
  const sourceScope = input.policy.sourceScope;
  const contextWebsites = Array.isArray(input.runtimeContextSnapshot?.websites)
    ? input.runtimeContextSnapshot?.websites
    : [];
  const allowedHosts = parseHostnames(contextWebsites as unknown[]);

  const pushAllowed = (call: RuntimeToolCall) => {
    const key = `${call.tool}:${stableJson(call.args || {})}`;
    if (seen.has(key)) return;
    seen.add(key);
    output.push(call);
  };

  const pushFallback = (fallback: RuntimeToolCall | undefined) => {
    if (!fallback) return;
    const key = `${fallback.tool}:${stableJson(fallback.args || {})}`;
    if (seen.has(key)) return;
    seen.add(key);
    output.push(fallback);
  };

  const block = (entry: SourceScopeBlockedTool) => {
    blocked.push(entry);
    pushFallback(entry.fallbackTool);
  };

  for (const call of input.toolCalls) {
    const tool = String(call.tool || '').trim();
    if (!tool) continue;

    if (
      !sourceScope.webSearch &&
      (tool === 'search.web' || tool === 'research.gather' || tool === 'competitors.discover_v3' || tool === 'evidence.news')
    ) {
      block({
        tool,
        lane: 'web_search',
        reason: 'Web search is disabled by input source scope.',
        fallbackTool: {
          tool: 'intel.list',
          args: { section: 'web_sources', limit: 12 },
        },
      });
      continue;
    }

    if (!sourceScope.socialIntel && (tool === 'evidence.posts' || tool === 'evidence.videos' || tool === 'orchestration.run')) {
      block({
        tool,
        lane: 'social_intel',
        reason: 'Social intelligence is disabled by input source scope.',
        fallbackTool: {
          tool: 'intel.list',
          args: { section: 'competitors', limit: 12 },
        },
      });
      continue;
    }

    if (!sourceScope.liveWebsiteCrawl && (tool === 'web.crawl' || tool === 'web.fetch')) {
      let canUseKnownWorkspaceSite = false;
      if (tool === 'web.fetch') {
        const url = String((call.args as Record<string, unknown>)?.url || '').trim();
        canUseKnownWorkspaceSite = Boolean(url) && isAllowedWebsiteUrl(url, allowedHosts);
      } else if (tool === 'web.crawl') {
        const urls = Array.isArray((call.args as Record<string, unknown>)?.startUrls)
          ? ((call.args as Record<string, unknown>)?.startUrls as unknown[])
          : [];
        canUseKnownWorkspaceSite =
          urls.length > 0 && urls.every((entry) => isAllowedWebsiteUrl(String(entry || '').trim(), allowedHosts));
      }

      if (!canUseKnownWorkspaceSite) {
        block({
          tool,
          lane: 'live_website_crawl',
          reason: 'Live website crawling is disabled by input source scope.',
          fallbackTool: {
            tool: 'intel.list',
            args: { section: 'web_snapshots', limit: 20 },
          },
        });
        continue;
      }
    }

    pushAllowed(call);
  }

  return {
    toolCalls: output.slice(0, input.maxToolRuns),
    blocked,
  };
}

function normalizeRunPlan(value: unknown): RuntimePlan | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.plan) || !Array.isArray(value.toolCalls)) return null;

  const responseStyle = isRecord(value.responseStyle)
    ? value.responseStyle
    : { depth: 'deep', tone: 'direct' };

  const depth = responseStyle.depth === 'deep' || responseStyle.depth === 'fast' ? responseStyle.depth : 'deep';
  const tone = responseStyle.tone === 'friendly' ? 'friendly' : 'direct';

  const toolCalls: RuntimeToolCall[] = [];
  for (const entry of value.toolCalls) {
    if (!isRecord(entry)) continue;
    const tool = String(entry.tool || '').trim();
    if (!tool) continue;
    const args = isRecord(entry.args) ? entry.args : {};
    const dependsOn = Array.isArray(entry.dependsOn)
      ? entry.dependsOn.map((dep) => String(dep || '').trim()).filter(Boolean)
      : undefined;
    toolCalls.push({ tool, args, dependsOn });
  }

  return {
    goal: String(value.goal || 'Respond to the user request'),
    plan: value.plan.map((step) => String(step || '').trim()).filter(Boolean),
    toolCalls,
    needUserInput: Boolean(value.needUserInput),
    decisionRequests: Array.isArray(value.decisionRequests)
      ? value.decisionRequests.filter((item): item is RuntimeDecision => isRecord(item) && typeof item.id === 'string' && typeof item.title === 'string') as RuntimeDecision[]
      : [],
    responseStyle: {
      depth,
      tone,
    },
    runtime:
      isRecord(value.runtime) && typeof value.runtime.continuationDepth === 'number'
        ? {
            continuationDepth: Math.max(0, Math.floor(value.runtime.continuationDepth)),
            ...(isRecord(value.runtime.contextSnapshot)
              ? { contextSnapshot: value.runtime.contextSnapshot }
              : {}),
          }
        : { continuationDepth: 0 },
  };
}

export function inferToolCallsFromMessage(message: string): RuntimeToolCall[] {
  const originalMessage = String(message || '');
  const messageWithMentions = withLibraryMentionHints(originalMessage);
  const normalized = messageWithMentions.toLowerCase();
  const writerIntent = detectWriterIntent(originalMessage);
  const isCompetitorBriefIntent = writerIntent === 'competitor_brief';
  const calls: RuntimeToolCall[] = [];
  const firstUrl = findFirstUrl(messageWithMentions);
  const referencedCrawlRunId = findReferencedCrawlRunId(messageWithMentions);
  const libraryMentions = extractLibraryMentions(originalMessage);
  const slashCommand = parseSlashCommand(originalMessage);
  const referencedDocumentIds = Array.from(
    messageWithMentions.matchAll(/\[document:([a-z0-9-]{8,})\]/gi),
    (match) => String(match[1] || '').trim()
  ).filter(Boolean);
  const resumeDocumentIdFromText =
    String(messageWithMentions.match(/\bresume(?: from)?(?: document)?(?: id)?[:\s]+([a-z0-9-]{8,})\b/i)?.[1] || '').trim() ||
    referencedDocumentIds[0] ||
    '';

  const pushIfMissing = (tool: string, args: Record<string, unknown>) => {
    const key = `${tool}:${JSON.stringify(args)}`;
    const exists = calls.some((entry) => `${entry.tool}:${JSON.stringify(entry.args)}` === key);
    if (!exists) calls.push({ tool, args });
  };

  const hasCompetitorSignals = /\b(competitor|rival|alternative|inspiration|accounts?|handles?)\b/.test(normalized);
  const hasAddIntent = /\b(add|include|save|insert|append|import|update)\b/.test(normalized);
  const hasCompetitorMutationNegation =
    /\b(do not|don't|dont|without|avoid|no need to)\b.{0,40}\b(add|include|save|import|append|insert|modify|change|update)\b/.test(
      normalized
    ) ||
    /\b(do not|don't|dont)\b.{0,50}\bcompetitor(?:s)?\b.{0,25}\b(link|url|handle|account)s?\b/.test(normalized);
  const hasExplicitCompetitorLinkMutationIntent =
    /(?:\b(add|include|save|import|append|insert)\b.{0,80}\b(competitor|inspiration)\b.{0,80}\b(link|url|handle|account)s?\b)|(?:\bcompetitors?\s*(?:\/|or)\s*inspiration(?:\s+links?)?\b)/.test(
      normalized
    ) || (hasAddIntent && /\b(competitor|inspiration)\b/.test(normalized));
  const shouldMutateCompetitorLinks = hasExplicitCompetitorLinkMutationIntent && !hasCompetitorMutationNegation;
  const hasCompetitorLinks = /(instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|@[a-z0-9._-]+)/i.test(
    message
  );
  const hasIntakeHeadings =
    /what services do you offer|what do you do in one sentence|what are the top 3 problems|who is the ideal audience|what results should content drive|what do people usually ask/i.test(
      message
    );
  const hasIntakeUpdateIntent =
    /\b(update|replace|refresh|apply|rewrite|save)\b/.test(normalized) &&
    /\b(form|intake|onboarding|onboard|original form content)\b/.test(normalized);
  const hasIntakeReadIntent =
    /\b(original|initial|first)\b/.test(normalized) &&
    /\b(form|intake|onboarding)\b/.test(normalized) &&
    /\b(response|submission|answers?)\b/.test(normalized);
  const hasRunIntent = /\b(run|start|continue|resume|expand|investigat(?:e|ing)|analy[sz]e)\b/.test(normalized);
  const hasFindIntent = /\b(find|finder|discover|identify|map|search|look up)\b/.test(normalized);
  const hasCompetitorDiscoveryIntent =
    /\b(competitor discovery|discover competitors|competitor investigation|competitor set)\b/.test(normalized) ||
    (/\bcompetitor\b/.test(normalized) && /\b(discovery|discover|investigat|analy[sz]e)\b/.test(normalized));
  const hasV3DiscoveryIntent =
    /\b(v3|discover_v3|competitor finder|best competitor finder|wide competitor)\b/.test(normalized) ||
    (/\b(adjacent|substitute|aspirational|complementary)\b/.test(normalized) && /\bcompetitor\b/.test(normalized));
  const hasExplicitWebSearchIntent =
    /\b(search (the )?(web|internet)|web search|find online|look up online)\b/.test(normalized) &&
    !/\b(competitor|rival|alternative)\b/.test(normalized);
  const hasCompetitorStatusIntent =
    /\b(status|progress|started|update)\b/.test(normalized) && /\bcompetitor\b/.test(normalized);
  const hasDeepInvestigationIntent =
    /\b(deep|deeper|thorough|full|comprehensive|detailed)\b/.test(normalized) &&
    /\b(investigat|research|analy[sz]e|profile|account|person|people|creator|founder)\b/.test(normalized);
  const hasResearchSignal =
    /\b(investigat|research|analy[sz]e|profile|account|person|people|creator|founder|handle)\b/.test(normalized) &&
    (/(instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|@[a-z0-9._-]+)/i.test(messageWithMentions) ||
      /\b(ddg|duckduckgo|scraply|scrapling|crawl|fetch)\b/.test(normalized));
  const hasEvidenceReferenceIntent =
    /use evidence from|evidence from/i.test(messageWithMentions) ||
    (/\b(evidence|source|sources)\b/.test(normalized) && /\b(use|ground|base|summariz|detail|answer)\b/.test(normalized));
  const hasWorkspaceOverviewIntent =
    /\b(what do (you|we) (see|have)|what['’]s (on|in) (the )?(app|application|workspace)|show (me )?(what|everything) (we|you) (have|see)|workspace status|workspace snapshot|summari[sz]e (the )?(workspace|app|application))\b/.test(
      normalized
    );
  const hasDocumentKeyword = /\b(pdf|report|brief|document|doc)\b/.test(normalized);
  const hasDocumentGenerateVerb = /\b(generate|create|make|build|produce|draft|export)\b/.test(normalized);
  const hasContinueDeepeningIntent =
    /\bcontinue\b/.test(normalized) &&
    /\b(deepen|deepening|improve|enrich|expand|refine)\b/.test(normalized);
  const hasDocumentGenerationIntent = hasDocumentKeyword && hasDocumentGenerateVerb;
  const wantsSwot = /\bswot\b/.test(normalized);
  const wantsPlaybook = /\bplaybook\b|\bcadence\b/.test(normalized);
  const wantsCompetitorAudit = /\bcompetitor audit\b/.test(normalized);
  const wantsContentCalendar = /\bcontent calendar\b/.test(normalized);
  const wantsGoToMarket = /\bgo[-\s]?to[-\s]?market\b|\bgtm\b|\blaunch plan\b/.test(normalized);
  const hasRequestedDocFamily =
    wantsSwot || wantsPlaybook || wantsCompetitorAudit || wantsContentCalendar || wantsGoToMarket;
  const inferredDocType = wantsSwot
    ? 'SWOT'
    : wantsGoToMarket
      ? 'GO_TO_MARKET'
    : wantsContentCalendar
      ? 'CONTENT_CALENDAR'
    : wantsCompetitorAudit
      ? 'COMPETITOR_AUDIT'
    : wantsPlaybook
      ? 'PLAYBOOK'
      : 'BUSINESS_STRATEGY';
  const defaultDocumentArgs: Record<string, unknown> = {
    docType: inferredDocType,
    depth: 'deep',
    includeCompetitors: true,
    includeEvidenceLinks: true,
    requestedIntent: wantsSwot
      ? 'swot_analysis'
      : wantsGoToMarket
        ? 'go_to_market'
        : wantsContentCalendar
          ? 'content_calendar'
          : wantsCompetitorAudit
            ? 'competitor_audit'
            : wantsPlaybook
              ? 'playbook'
              : 'business_strategy',
    ...(hasContinueDeepeningIntent ? { continueDeepening: true } : {}),
    ...(resumeDocumentIdFromText ? { resumeDocumentId: resumeDocumentIdFromText } : {}),
  };
  const sanitizedSearchQuery = extractExplicitSearchQuery(originalMessage, {
    competitorIntent: hasCompetitorSignals || hasCompetitorDiscoveryIntent || hasV3DiscoveryIntent,
  });
  const sanitizedResearchQuery = extractExplicitSearchQuery(messageWithMentions, {
    competitorIntent: hasCompetitorSignals || hasCompetitorDiscoveryIntent || hasV3DiscoveryIntent,
    defaultQuery: sanitizedSearchQuery,
  });

  if (slashCommand) {
    if (slashCommand.command === 'show_sources') {
      pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
      pushIfMissing('intel.list', { section: 'web_sources', limit: 10 });
      pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
      pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
      pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
      pushIfMissing('evidence.news', { limit: 8 });
    } else if (slashCommand.command === 'generate_pdf') {
      pushIfMissing('document.generate', {
        ...defaultDocumentArgs,
        ...(slashCommand.argsJson || {}),
      });
    } else if (slashCommand.command === 'audit') {
      pushIfMissing('intel.list', { section: 'web_sources', limit: 10 });
      pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
      pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
      pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
      pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
      pushIfMissing('evidence.news', { limit: 8 });
    } else if (SUPPORTED_TOOL_NAMES.has(slashCommand.command as (typeof TOOL_REGISTRY)[number]['name'])) {
      pushIfMissing(slashCommand.command, slashCommand.argsJson || {});
    } else {
      const alias = TOOL_NAME_ALIASES[normalizeToolAliasKey(slashCommand.command)];
      if (alias) {
        pushIfMissing(alias.tool, {
          ...(slashCommand.argsJson || {}),
          ...(alias.args || {}),
        });
      }
    }
  }

  if (hasCompetitorSignals) {
    pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
  }

  if (isCompetitorBriefIntent) {
    pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
    pushIfMissing('intel.list', { section: 'competitor_accounts', limit: 20 });
    pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
  }

  if (
    shouldMutateCompetitorLinks &&
    hasCompetitorLinks
  ) {
    pushIfMissing('competitors.add_links', { text: messageWithMentions });
  }

  if (hasIntakeUpdateIntent || hasIntakeHeadings) {
    pushIfMissing('intake.update_from_text', { text: message });
  }

  if (hasIntakeReadIntent) {
    pushIfMissing('workspace.intake.get', {});
  }

  if ((hasRunIntent && hasCompetitorDiscoveryIntent) || (hasFindIntent && /\bcompetitor\b/.test(normalized))) {
    if (hasV3DiscoveryIntent) {
      pushIfMissing('competitors.discover_v3', {
        mode: hasDeepInvestigationIntent ? 'deep' : 'standard',
        maxCandidates: hasDeepInvestigationIntent ? 200 : 120,
        maxEnrich: hasDeepInvestigationIntent ? 18 : 10,
      });
    } else {
      pushIfMissing('orchestration.run', { targetCount: 12, mode: 'append' });
    }
  }

  if (hasCompetitorStatusIntent) {
    pushIfMissing('orchestration.status', {});
  }

  if (hasDeepInvestigationIntent || hasResearchSignal) {
    pushIfMissing('research.gather', {
      query: sanitizedResearchQuery,
      depth: hasDeepInvestigationIntent ? 'deep' : 'standard',
      includeScrapling: true,
      includeAccountContext: true,
      includeWorkspaceWebsites: true,
    });
  }

  if (/web|site|website|source|snapshot|page/.test(normalized)) {
    pushIfMissing('intel.list', { section: 'web_sources', limit: 10 });
    pushIfMissing('intel.list', { section: 'web_snapshots', limit: 12 });
  }

  if (hasWorkspaceOverviewIntent) {
    pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
    pushIfMissing('intel.list', { section: 'web_sources', limit: 10 });
    pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
    pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
  }

  if (/crawl|spider/.test(normalized) && firstUrl) {
    pushIfMissing('web.crawl', { startUrls: [firstUrl], maxPages: 8, maxDepth: 1 });
  }

  if (referencedCrawlRunId) {
    pushIfMissing('web.crawl.list_snapshots', { runId: referencedCrawlRunId, limit: 50 });
  }

  if (hasEvidenceReferenceIntent && firstUrl) {
    pushIfMissing('web.fetch', { url: firstUrl, sourceType: 'ARTICLE', discoveredBy: 'CHAT_TOOL' });
  }

  if (/(fetch|scrape|extract).*(web|site|page|url)|\bfetch\b/.test(normalized) && firstUrl) {
    pushIfMissing('web.fetch', { url: firstUrl, sourceType: 'ARTICLE', discoveredBy: 'CHAT_TOOL' });
  }

  if (/community|reddit|forum|insight/.test(normalized)) {
    pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
  }

  if (hasExplicitWebSearchIntent) {
    pushIfMissing('search.web', { query: sanitizedSearchQuery, count: 10, provider: 'auto' });
  }

  if (/news|press|mention/.test(normalized)) {
    pushIfMissing('evidence.news', { limit: 8 });
  }

  if (/video|youtube/.test(normalized)) {
    pushIfMissing('evidence.videos', { limit: 8 });
  }

  if (/post|example|tiktok|instagram|social/.test(normalized)) {
    pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
  }

  if (hasDocumentKeyword || hasRequestedDocFamily) {
    if (slashCommand?.command === 'generate_pdf' || hasDocumentGenerationIntent) {
      pushIfMissing('document.generate', {
        ...defaultDocumentArgs,
      });
    } else {
      pushIfMissing('document.plan', {
        ...defaultDocumentArgs,
      });
    }
  }

  if (
    referencedDocumentIds.length > 0 &&
    /\b(document|doc|draft|proposal|attachment|edit|rewrite|change|update|summari[sz]e|read|review|export|download)\b/.test(
      normalized
    )
  ) {
    const primaryDocumentId = referencedDocumentIds[0];
    const editDirective = extractDocumentEditDirective(originalMessage);
    const hasDocumentEditIntent = /\b(edit|rewrite|refine|improve|change|update|replace)\b/.test(normalized);
    const hasDocumentReadIntent =
      /\b(summarize|summarise|read|review|outline|extract|what does it say)\b/.test(normalized) || hasEvidenceReferenceIntent;
    const hasDocumentExportIntent = /\b(export|download|pdf|docx|markdown|md)\b/.test(normalized);

    if (hasDocumentEditIntent) {
      const editArgs: Record<string, unknown> = {
        documentId: primaryDocumentId,
        instruction: originalMessage,
      };
      if (editDirective.quotedText) {
        editArgs.quotedText = editDirective.quotedText;
      }
      if (editDirective.replacementText !== undefined) {
        editArgs.replacementText = editDirective.replacementText;
      }
      pushIfMissing('document.propose_edit', editArgs);
      if (editDirective.quotedText && editDirective.replacementText === undefined) {
        pushIfMissing('document.search', {
          documentId: primaryDocumentId,
          query: editDirective.quotedText,
          limit: 6,
        });
      }
    } else if (hasDocumentReadIntent) {
      pushIfMissing('document.read', {
        documentId: primaryDocumentId,
      });
    }

    if (hasDocumentExportIntent) {
      const format = /\bdocx\b/.test(normalized) ? 'DOCX' : /\bmarkdown|\bmd\b/.test(normalized) ? 'MD' : 'PDF';
      pushIfMissing('document.export', {
        documentId: primaryDocumentId,
        format,
      });
    }
  }

  if (libraryMentions.length) {
    // Library refs are resolved strictly before planning; avoid heuristic fallback retrieval.
  }

  return calls;
}

export function buildPlanFromMessage(message: string): RuntimePlan {
  const toolCalls = inferToolCallsFromMessage(message);
  const concise = prefersConciseOutput(message);

  const plan: RuntimePlan = {
    goal: 'Generate an evidence-grounded response for the active branch',
    plan: toolCalls.length
      ? [
          'Collect relevant evidence and intelligence signals',
          'Synthesize findings with assumptions and next steps',
          'Ask for approvals when required before mutations',
        ]
      : ['Respond directly with available context and suggest next actions'],
    toolCalls,
    needUserInput: false,
    decisionRequests: [],
    responseStyle: {
      depth: concise ? 'fast' : 'deep',
      tone: 'friendly',
    },
    runtime: {
      continuationDepth: 0,
    },
  };

  return plan;
}

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildLibraryUpdatesSection(
  toolRuns: Array<{
    toolName: string;
    status: ToolRunStatus;
    resultJson: unknown;
  }>
): { text: string; hasUpdates: boolean; collection?: string } {
  const lines: string[] = [];
  const seen = new Set<string>();
  let primaryCollection: string | undefined;

  const pushLine = (line: string, collection?: string) => {
    const normalized = String(line || '').trim();
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    lines.push(normalized);
    if (!primaryCollection && collection) {
      primaryCollection = collection;
    }
  };

  for (const toolRun of toolRuns) {
    if (toolRun.status !== ToolRunStatus.DONE) continue;
    const result = isRecord(toolRun.resultJson) ? toolRun.resultJson : null;
    if (!result) continue;

    if (toolRun.toolName === 'web.fetch') {
      const finalUrl = String(result.finalUrl || '').trim();
      if (finalUrl) {
        pushLine(
          `Web library updated: saved a page snapshot from ${finalUrl}.`,
          'web'
        );
      } else if (result.snapshotId) {
        pushLine('Web library updated: saved a new page snapshot.', 'web');
      }
      continue;
    }

    if (toolRun.toolName === 'web.crawl') {
      const persisted = toNumber(result.persisted);
      if (persisted !== null && persisted > 0) {
        pushLine(
          `Web library updated: crawl captured ${Math.max(0, Math.floor(persisted))} page snapshot(s).`,
          'web'
        );
      } else if (result.runId) {
        pushLine('Web library updated: crawl finished and added workspace evidence.', 'web');
      }
      continue;
    }

    if (toolRun.toolName === 'research.gather') {
      const websitesScanned = toNumber(result.websitesScanned);
      const artifacts = Array.isArray(result.artifacts) ? result.artifacts.length : 0;
      if ((websitesScanned !== null && websitesScanned > 0) || artifacts > 0) {
        pushLine(
          `Research saved new workspace evidence: ${artifacts} artifact(s)${websitesScanned !== null ? `, ${Math.max(0, Math.floor(websitesScanned))} website scan(s)` : ''}.`,
          'web'
        );
      }
      continue;
    }

    if (toolRun.toolName === 'competitors.add_links') {
      const added = toNumber(result.added);
      if (added !== null && added > 0) {
        pushLine(
          `Competitor library updated: added ${Math.max(0, Math.floor(added))} competitor/inspiration link(s).`,
          'competitors'
        );
      }
      continue;
    }

    if (toolRun.toolName === 'intake.update_from_text') {
      const added = toNumber(result.competitorLinksAdded);
      if (added !== null && added > 0) {
        pushLine(
          `Competitor library updated via intake: added ${Math.max(0, Math.floor(added))} inspiration link(s).`,
          'competitors'
        );
      }
      continue;
    }

    if (toolRun.toolName === 'orchestration.run') {
      const summary = isRecord(result.summary) ? result.summary : null;
      const shortlisted = summary ? toNumber(summary.shortlisted) : null;
      const topPicks = summary ? toNumber(summary.topPicks) : null;
      if ((shortlisted !== null && shortlisted > 0) || (topPicks !== null && topPicks > 0)) {
        pushLine(
          `Competitor library refreshed: ${shortlisted !== null ? Math.max(0, Math.floor(shortlisted)) : 0} shortlisted, ${topPicks !== null ? Math.max(0, Math.floor(topPicks)) : 0} top picks.`,
          'competitors'
        );
      }
      continue;
    }

    if (toolRun.toolName === 'document.generate') {
      const title = String(
        result.title || result.fileName || result.documentTitle || result.docType || ''
      ).trim();
      const runtimeDocumentId = String(result.documentId || '').trim();
      if (title) {
        pushLine(`Deliverables library updated: generated "${title}".`, 'deliverables');
      } else if (result.docId) {
        pushLine('Deliverables library updated: generated a new document.', 'deliverables');
      }
      if (runtimeDocumentId) {
        pushLine('Docs workspace updated: the generated brief is now available for quote/edit.', 'deliverables');
      }
      continue;
    }
  }

  if (!lines.length) {
    return { text: '', hasUpdates: false };
  }

  return {
    text: `Library updates:\n${lines.map((line, index) => `${index + 1}. ${line}`).join('\n')}`,
    hasUpdates: true,
    ...(primaryCollection ? { collection: primaryCollection } : {}),
  };
}

function flattenEvidence(results: RuntimeToolResult[]) {
  return results.flatMap((result) => result.evidence).slice(0, 20);
}

function collectRuntimeEvidenceRefIds(results: RuntimeToolResult[]): string[] {
  const ids = new Set<string>();
  for (const result of results) {
    const raw = isRecord(result.raw) ? result.raw : {};
    if (!Array.isArray(raw.runtimeEvidenceRefIds)) continue;
    for (const entry of raw.runtimeEvidenceRefIds) {
      const id = String(entry || '').trim();
      if (!id) continue;
      ids.add(id);
      if (ids.size >= 120) break;
    }
    if (ids.size >= 120) break;
  }
  return Array.from(ids);
}

function sanitizePreviewText(value: unknown, maxChars = 180): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function buildListPreviewItems(value: unknown, maxItems = 6): Array<{ label: string; url?: string }> {
  if (!Array.isArray(value)) return [];
  const items: Array<{ label: string; url?: string }> = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const label = sanitizePreviewText(
      row.title || row.name || row.handle || row.profileUrl || row.finalUrl || row.url || row.id || row.snippet,
      160
    );
    if (!label) continue;
    const url = sanitizePreviewText(row.url || row.finalUrl || row.profileUrl || row.permalink, 220);
    items.push({
      label,
      ...(url ? { url } : {}),
    });
    if (items.length >= maxItems) break;
  }
  return items;
}

function buildToolOutputPreview(raw: Record<string, unknown>, toolName: string): Record<string, unknown> | null {
  if (toolName === 'document.plan') {
    const plan = isRecord(raw.plan) ? raw.plan : raw;
    return {
      ...(typeof plan.docType === 'string' ? { docType: sanitizePreviewText(plan.docType, 48) } : {}),
      ...(typeof plan.title === 'string' ? { title: sanitizePreviewText(plan.title, 180) } : {}),
      ...(typeof plan.audience === 'string' ? { audience: sanitizePreviewText(plan.audience, 140) } : {}),
      ...(typeof plan.depth === 'string' ? { depth: sanitizePreviewText(plan.depth, 40) } : {}),
      ...(toNumber(plan.timeframeDays) !== null ? { timeframeDays: Math.max(1, Math.floor(Number(plan.timeframeDays))) } : {}),
      ...(typeof plan.includeCompetitors === 'boolean' ? { includeCompetitors: plan.includeCompetitors } : {}),
      ...(typeof plan.includeEvidenceLinks === 'boolean' ? { includeEvidenceLinks: plan.includeEvidenceLinks } : {}),
    };
  }

  if (toolName === 'competitors.discover_v3') {
    const statsRaw = isRecord(raw.stats) ? raw.stats : isRecord(raw.summary) ? raw.summary : null;
    const laneStatsRaw = isRecord(raw.laneStats) ? raw.laneStats : null;
    const topCandidates = buildListPreviewItems(raw.topCandidates, 6);
    const lanes =
      laneStatsRaw &&
      Object.entries(laneStatsRaw)
        .map(([lane, entry]) => {
          if (!isRecord(entry)) return null;
          const queries = toNumber(entry.queries);
          const hits = toNumber(entry.hits);
          return {
            lane,
            ...(queries !== null ? { queries: Math.max(0, Math.floor(queries)) } : {}),
            ...(hits !== null ? { hits: Math.max(0, Math.floor(hits)) } : {}),
          };
        })
        .filter(Boolean)
        .slice(0, 8);

    return {
      ...(typeof raw.mode === 'string' ? { mode: sanitizePreviewText(raw.mode, 40) } : {}),
      ...(statsRaw ? { stats: statsRaw } : {}),
      ...(Array.isArray(lanes) ? { lanes } : {}),
      ...(topCandidates.length ? { topCandidates } : {}),
    };
  }

  if (toolName === 'search.web') {
    const items = buildListPreviewItems(raw.items, 6);
    return {
      ...(typeof raw.query === 'string' ? { query: sanitizePreviewText(raw.query, 180) } : {}),
      ...(typeof raw.provider === 'string' ? { provider: sanitizePreviewText(raw.provider, 40) } : {}),
      ...(typeof raw.vertical === 'string' ? { vertical: sanitizePreviewText(raw.vertical, 40) } : {}),
      ...(toNumber(raw.count) !== null ? { count: Math.max(0, Math.floor(Number(raw.count))) } : {}),
      ...(items.length ? { items } : {}),
    };
  }

  if (toolName === 'intel.list') {
    const items = buildListPreviewItems(Array.isArray(raw.items) ? raw.items : raw.data, 6);
    const count = toNumber(raw.count);
    return {
      ...(typeof raw.section === 'string' ? { section: sanitizePreviewText(raw.section, 80) } : {}),
      ...(count !== null ? { count: Math.max(0, Math.floor(count)) } : {}),
      ...(items.length ? { items } : {}),
    };
  }

  if (toolName === 'web.crawl' || toolName === 'web.crawl.list_snapshots' || toolName === 'web.crawl.get_run') {
    const items = buildListPreviewItems(raw.items, 6);
    const persisted = toNumber(raw.persisted);
    const count = toNumber(raw.count);
    return {
      ...(typeof raw.runId === 'string' ? { runId: sanitizePreviewText(raw.runId, 64) } : {}),
      ...(persisted !== null ? { persisted: Math.max(0, Math.floor(persisted)) } : {}),
      ...(count !== null ? { count: Math.max(0, Math.floor(count)) } : {}),
      ...(items.length ? { items } : {}),
    };
  }

  if (toolName === 'web.fetch') {
    return {
      ...(typeof raw.snapshotId === 'string' ? { snapshotId: sanitizePreviewText(raw.snapshotId, 80) } : {}),
      ...(typeof raw.finalUrl === 'string' ? { finalUrl: sanitizePreviewText(raw.finalUrl, 220) } : {}),
      ...(toNumber(raw.statusCode) !== null ? { statusCode: Math.floor(Number(raw.statusCode)) } : {}),
    };
  }

  if (toolName === 'evidence.posts' || toolName === 'evidence.news' || toolName === 'evidence.videos') {
    const items = buildListPreviewItems(raw.items, 6);
    const count = toNumber(raw.count);
    return {
      ...(count !== null ? { count: Math.max(0, Math.floor(count)) } : {}),
      ...(items.length ? { items } : {}),
    };
  }

  const fallbackItems = buildListPreviewItems(raw.items, 4);
  if (!fallbackItems.length && toNumber(raw.count) === null) {
    return null;
  }

  return {
    ...(toNumber(raw.count) !== null ? { count: Math.max(0, Math.floor(Number(raw.count))) } : {}),
    ...(fallbackItems.length ? { items: fallbackItems } : {}),
  };
}

function buildToolOutputEventPayload(toolName: string, contract: RuntimeToolResult): Record<string, unknown> {
  const preview = isRecord(contract.raw) ? buildToolOutputPreview(contract.raw, toolName) : null;
  const runtimeEvidenceRefIds =
    isRecord(contract.raw) && Array.isArray(contract.raw.runtimeEvidenceRefIds)
      ? contract.raw.runtimeEvidenceRefIds.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 60)
      : [];
  return {
    toolName,
    warnings: contract.warnings,
    decisions: contract.decisions,
    toolOutput: {
      summary: contract.summary,
      artifactCount: contract.artifacts.length,
      evidenceCount: contract.evidence.length,
      warningCount: contract.warnings.length,
      artifacts: contract.artifacts.slice(0, 8),
      evidence: contract.evidence.slice(0, 10),
      ...(runtimeEvidenceRefIds.length ? { evidenceRefIds: runtimeEvidenceRefIds } : {}),
      ...(preview ? { preview } : {}),
    },
  };
}

function collectBlockingDecisions(results: RuntimeToolResult[]): RuntimeDecision[] {
  const deduped = new Map<string, RuntimeDecision>();

  for (const decision of results.flatMap((result) => result.decisions)) {
    if (!decision?.blocking) continue;
    const key = String(decision.id || '').trim();
    if (!key) continue;
    if (!deduped.has(key)) {
      deduped.set(key, decision);
    }
  }

  return Array.from(deduped.values());
}

function mergeBlockingDecisions(groups: RuntimeDecision[][]): RuntimeDecision[] {
  const merged = new Map<string, RuntimeDecision>();

  for (const group of groups) {
    for (const decision of group) {
      if (!decision?.blocking) continue;
      const key = String(decision.id || '').trim();
      if (!key) continue;
      if (!merged.has(key)) {
        merged.set(key, decision);
      }
    }
  }

  return Array.from(merged.values());
}

export function collectContinuationTools(results: RuntimeToolResult[]): string[] {
  const nextFromNames = results
    .flatMap((result) => result.continuations)
    .filter((item) => item.type === 'auto_continue')
    .flatMap((item) => item.suggestedNextTools || []);
  const nextFromCalls = results
    .flatMap((result) => result.continuations)
    .filter((item) => item.type === 'auto_continue')
    .flatMap((item) => (item.suggestedToolCalls || []).map((entry) => String(entry.tool || '').trim()))
    .filter(Boolean);

  return Array.from(new Set([...nextFromNames, ...nextFromCalls].map((tool) => tool.trim()).filter(Boolean)));
}

function collectContinuationToolCalls(results: RuntimeToolResult[]): RuntimeToolCall[] {
  const out: RuntimeToolCall[] = [];
  const seen = new Set<string>();

  const push = (toolRaw: unknown, argsRaw: unknown) => {
    const tool = String(toolRaw || '').trim();
    if (!tool) return;
    const args = isRecord(argsRaw) ? argsRaw : {};
    const key = `${tool}:${stableJson(args)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ tool, args });
  };

  for (const result of results) {
    for (const continuation of result.continuations || []) {
      if (continuation.type !== 'auto_continue') continue;
      for (const call of continuation.suggestedToolCalls || []) {
        push(call.tool, call.args);
      }
      for (const name of continuation.suggestedNextTools || []) {
        push(name, {});
      }
    }
  }

  return out;
}

function compactSteerNote(value: string, maxChars = 140): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function extractRunSteerNotes(messages: Array<{ role: ChatBranchMessageRole; content: string; createdAt: Date }>, startedAt: Date): string[] {
  return messages
    .filter((message) => message.role === ChatBranchMessageRole.SYSTEM && message.createdAt >= startedAt)
    .map((message) => {
      const raw = String(message.content || '').trim();
      if (!raw.startsWith('STEER_NOTE::')) return '';
      return raw.replace(/^STEER_NOTE::/i, '').trim();
    })
    .filter(Boolean)
    .slice(-6);
}

function inferRunLastActivityMs(input: {
  createdAt: Date;
  startedAt?: Date | null;
  toolRuns?: Array<{
    createdAt: Date;
    startedAt?: Date | null;
    endedAt?: Date | null;
  }>;
}): number {
  const baseDate = input.startedAt || input.createdAt;
  let latestMs = baseDate.getTime();
  if (!Number.isFinite(latestMs)) {
    latestMs = Date.now();
  }

  for (const toolRun of input.toolRuns || []) {
    const candidates = [toolRun.createdAt, toolRun.startedAt || null, toolRun.endedAt || null];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const candidateMs = candidate.getTime();
      if (!Number.isFinite(candidateMs)) continue;
      if (candidateMs > latestMs) {
        latestMs = candidateMs;
      }
    }
  }

  return latestMs;
}

export class RuntimeRunEngine {
  private readonly branchLocks = new Map<string, Promise<void>>();
  private readonly staleRecoveryInFlight = new Set<string>();
  private readonly staleRecoveryLastAttemptMs = new Map<string, number>();

  private async withBranchLock<T>(branchId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.branchLocks.get(branchId) || Promise.resolve();
    let releaseCurrent: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const lockChain = previous.then(() => current);
    this.branchLocks.set(branchId, lockChain);

    await previous;
    try {
      return await work();
    } finally {
      releaseCurrent();
      if (this.branchLocks.get(branchId) === lockChain) {
        this.branchLocks.delete(branchId);
      }
    }
  }

  private async scheduleStaleActiveRunRecovery(branchId: string): Promise<void> {
    const activeRuns = await listActiveRuns(branchId);
    if (!activeRuns.length) return;

    const nowMs = Date.now();
    for (const run of activeRuns) {
      if (run.status === AgentRunStatus.WAITING_USER) continue;
      const lastActivityMs = inferRunLastActivityMs({
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        toolRuns: run.toolRuns,
      });
      const idleMs = Math.max(0, nowMs - lastActivityMs);
      if (idleMs < RUNTIME_STALE_ACTIVE_RUN_MS) continue;

      const lastAttemptMs = this.staleRecoveryLastAttemptMs.get(run.id) || 0;
      if (nowMs - lastAttemptMs < RUNTIME_STALE_RECOVERY_COOLDOWN_MS) continue;
      if (this.staleRecoveryInFlight.has(run.id)) continue;

      this.staleRecoveryLastAttemptMs.set(run.id, nowMs);
      this.staleRecoveryInFlight.add(run.id);

      await this.emitEvent({
        branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_LOG,
        level: ProcessEventLevel.WARN,
        message: `Detected stale active run (idle ${Math.floor(idleMs / 1000)}s). Attempting recovery.`,
        payload: {
          event: 'run.stale_detected',
          status: run.status,
          idleMs,
          lastActivityAt: new Date(lastActivityMs).toISOString(),
        },
      });

      void this.executeRun(run.id)
        .then(async () => {
          const refreshed = await getAgentRun(run.id);
          if (!refreshed) return;
          if (
            refreshed.status === AgentRunStatus.DONE ||
            refreshed.status === AgentRunStatus.FAILED ||
            refreshed.status === AgentRunStatus.CANCELLED ||
            refreshed.status === AgentRunStatus.WAITING_USER
          ) {
            return;
          }

          await this.handleRunFailure({
            runId: run.id,
            branchId,
            message: 'Run remained active after stale recovery attempt.',
            error: new Error('stale_recovery_no_progress'),
          });
        })
        .catch((error) =>
          this.handleRunFailure({
            runId: run.id,
            branchId,
            message: 'Automatic stale-run recovery failed.',
            error,
          })
        )
        .finally(() => {
          this.staleRecoveryInFlight.delete(run.id);
        });
    }
  }

  private async emitEvent(input: {
    branchId: string;
    type: ProcessEventType;
    message: string;
    level?: ProcessEventLevel;
    agentRunId?: string | null;
    toolRunId?: string | null;
    payload?: unknown;
  }) {
    const createdAt = new Date();
    const payload = attachRuntimeEventV2Payload({
      type: input.type,
      level: input.level,
      message: input.message,
      agentRunId: input.agentRunId ?? null,
      toolRunId: input.toolRunId ?? null,
      payload: input.payload,
      createdAt,
    });

    const event = await createProcessEvent({
      ...input,
      payload,
    });
    publishProcessEvent(event);
    return event;
  }

  private async persistAssistantMessage(input: {
    branchId: string;
    content: string;
    contextSnapshot?: Record<string, unknown>;
    blocksJson?: unknown;
    reasoningJson?: Record<string, unknown>;
    citationsJson?: unknown;
    clientVisible?: boolean;
  }) {
    const contextSnapshot = isRecord(input.contextSnapshot) ? input.contextSnapshot : {};
    const sanitized = sanitizeFinalAssistantResponse(input.content, contextSnapshot);
    const content = sanitized || buildGroundedFailureResponse({ contextSnapshot });

    return createBranchMessage({
      branchId: input.branchId,
      role: ChatBranchMessageRole.ASSISTANT,
      content,
      ...(input.blocksJson !== undefined ? { blocksJson: input.blocksJson } : {}),
      ...(input.reasoningJson !== undefined ? { reasoningJson: input.reasoningJson } : {}),
      ...(input.citationsJson !== undefined ? { citationsJson: input.citationsJson } : {}),
      clientVisible: input.clientVisible ?? true,
    });
  }

  private async handleRunFailure(input: {
    runId: string;
    branchId: string;
    message: string;
    error: unknown;
  }) {
    const details = String((input.error as { message?: unknown })?.message || input.error || 'Unknown error');

    try {
      await updateAgentRun(input.runId, {
        status: AgentRunStatus.FAILED,
        endedAt: new Date(),
        error: details,
      });
    } catch (updateError) {
      console.error('[RuntimeRunEngine] Failed to mark run as FAILED:', updateError);
    }

    await this.emitEvent({
      branchId: input.branchId,
      agentRunId: input.runId,
      type: ProcessEventType.FAILED,
      level: ProcessEventLevel.ERROR,
      message: input.message,
      payload: {
        error: details,
      },
    });
  }

  private async dispatchNextQueuedMessage(input: {
    researchJobId: string;
    branchId: string;
    policy: RunPolicy;
    mode?: SendMessageMode;
  }) {
    const nextQueued = await popNextQueuedMessage(input.branchId);
    if (!nextQueued || nextQueued.status !== MessageQueueItemStatus.SENT) {
      return false;
    }

    queueMicrotask(() => {
      void this.sendMessage({
        researchJobId: input.researchJobId,
        branchId: input.branchId,
        userId: nextQueued.userId,
        content: nextQueued.content,
        mode: input.mode || 'send',
        policy: input.policy,
        inputOptions: isRecord(nextQueued.inputOptionsJson)
          ? (nextQueued.inputOptionsJson as RuntimeInputOptions)
          : undefined,
        attachmentIds: normalizeIdList((nextQueued as any).attachmentIdsJson),
        documentIds: normalizeIdList((nextQueued as any).documentIdsJson),
      }).catch((error) => {
        console.error('[RuntimeRunEngine] Failed to process next queued message:', error);
        void markQueueItemStatus(nextQueued.id, MessageQueueItemStatus.QUEUED).catch((statusError) => {
          console.error('[RuntimeRunEngine] Failed to re-queue message after dispatch failure:', statusError);
        });
      });
    });

    return true;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const branch = await getBranch(input.branchId, input.researchJobId);
    if (!branch) {
      throw new Error('Branch not found for this research job');
    }
    await this.scheduleStaleActiveRunRecovery(input.branchId);

    const mode = input.mode || 'send';
    const attachmentIds = normalizeDocumentIds(input.attachmentIds || []);
    const documentIds = await hydrateDocumentIdsFromMessageInput({
      researchJobId: input.researchJobId,
      documentIds: normalizeDocumentIds(input.documentIds || []),
      attachmentIds,
    });
    const content = String(input.content || '').trim();
    if (!content && attachmentIds.length === 0 && documentIds.length === 0) {
      throw new Error('Message content is required');
    }
    const normalizedContent =
      content ||
      (documentIds.length > 0
        ? 'Please analyze the attached documents and continue the workflow with grounded recommendations.'
        : 'Please analyze the attached files and continue the workflow with grounded recommendations.');
    const normalizedInputOptions = normalizeInputOptions(input.inputOptions);
    const requestedLibraryRefs = mergeLibraryRefs(
      Array.isArray(input.libraryRefs) ? input.libraryRefs : [],
      normalizedInputOptions?.libraryRefs || [],
      extractLibraryRefsFromText(normalizedContent)
    );
    let resolvedLibraryRefs: string[] = [];
    let unresolvedLibraryRefs: string[] = [];
    if (requestedLibraryRefs.length > 0) {
      const resolved = await resolvePortalWorkspaceLibraryRefs(input.researchJobId, requestedLibraryRefs);
      resolvedLibraryRefs = resolved.items.map((item) => item.libraryRef || item.id).filter(Boolean);
      unresolvedLibraryRefs = resolved.unresolvedRefs;
      await this.emitEvent({
        branchId: input.branchId,
        type: ProcessEventType.PROCESS_LOG,
        message: `Pinned library references resolved: ${resolvedLibraryRefs.length}/${requestedLibraryRefs.length}.`,
        payload: {
          event: 'LIBRARY_REF_RESOLVED',
          requestedRefs: requestedLibraryRefs.length,
          resolvedRefs: resolvedLibraryRefs.length,
          unresolvedRefs: unresolvedLibraryRefs.length,
        },
      });
      if (unresolvedLibraryRefs.length > 0) {
        await this.emitEvent({
          branchId: input.branchId,
          type: ProcessEventType.PROCESS_LOG,
          level: ProcessEventLevel.WARN,
          message: 'Some library references could not be resolved and were ignored.',
          payload: {
            event: 'LIBRARY_HEURISTIC_BLOCKED',
            unresolvedRefs: unresolvedLibraryRefs.slice(0, 20),
          },
        });
      }
    }
    const inputOptionsWithRefs = normalizeInputOptions({
      ...(normalizedInputOptions || {}),
      ...(resolvedLibraryRefs.length ? { libraryRefs: resolvedLibraryRefs } : {}),
    });

    const activeRuns = await listActiveRuns(input.branchId);
    if (mode === 'send' && activeRuns.length > 0) {
      const allWaitingForInput = activeRuns.every((run) => run.status === AgentRunStatus.WAITING_USER);
      const allScheduledRuns = activeRuns.every((run) => run.triggerType === AgentRunTriggerType.SCHEDULED_LOOP);
      if (allWaitingForInput) {
        await this.cancelBranchRuns({
          researchJobId: input.researchJobId,
          branchId: input.branchId,
          reason: 'Superseded by a new user message while waiting for input.',
        });
      } else if (allScheduledRuns && SCHEDULED_RUN_PREEMPTION_ENABLED) {
        await this.cancelBranchRuns({
          researchJobId: input.researchJobId,
          branchId: input.branchId,
          reason: 'Superseded by a direct user message while scheduled processing was running.',
        });
      } else {
        const queueItem = await enqueueMessage({
          branchId: input.branchId,
          userId: input.userId,
          content: normalizedContent,
          ...(inputOptionsWithRefs ? { inputOptions: inputOptionsWithRefs } : {}),
          ...(attachmentIds.length ? { attachmentIds } : {}),
          ...(documentIds.length ? { documentIds } : {}),
        });

        await this.emitEvent({
          branchId: input.branchId,
          type: ProcessEventType.PROCESS_LOG,
          message: 'Message queued because a run is already in progress.',
        payload: {
          queueItemId: queueItem.id,
          position: queueItem.position,
          reason: 'active_run',
          attachmentCount: attachmentIds.length,
          documentCount: documentIds.length,
        },
      });

        return {
          branchId: input.branchId,
          queued: true,
          queueItemId: queueItem.id,
        };
      }
    }

    if (mode === 'queue') {
      const queueItem = await enqueueMessage({
        branchId: input.branchId,
        userId: input.userId,
        content: normalizedContent,
        ...(inputOptionsWithRefs ? { inputOptions: inputOptionsWithRefs } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(documentIds.length ? { documentIds } : {}),
      });

      await this.emitEvent({
        branchId: input.branchId,
        type: ProcessEventType.PROCESS_LOG,
        message: 'Message queued for later execution.',
        payload: {
          queueItemId: queueItem.id,
          position: queueItem.position,
          attachmentCount: attachmentIds.length,
          documentCount: documentIds.length,
        },
      });

      return {
        branchId: input.branchId,
        queued: true,
        queueItemId: queueItem.id,
      };
    }

    if (mode === 'interrupt') {
      await this.cancelBranchRuns({
        researchJobId: input.researchJobId,
        branchId: input.branchId,
        reason: 'Interrupted by user message',
      });
    }

    const userMessage = await createBranchMessage({
      branchId: input.branchId,
      role: ChatBranchMessageRole.USER,
      content: normalizedContent,
      ...(inputOptionsWithRefs ? { inputOptionsJson: inputOptionsWithRefs } : {}),
      ...(attachmentIds.length ? { attachmentIdsJson: attachmentIds } : {}),
      ...(documentIds.length ? { documentIdsJson: documentIds } : {}),
      ...(input.blocksJson !== undefined ? { blocksJson: input.blocksJson } : {}),
      ...(input.citationsJson !== undefined ? { citationsJson: input.citationsJson } : {}),
      clientVisible: true,
    });

    const normalizedPolicy = normalizePolicy(input.policy, inputOptionsWithRefs || normalizedInputOptions);
    const run = await createAgentRun({
      branchId: input.branchId,
      triggerType: AgentRunTriggerType.USER_MESSAGE,
      triggerMessageId: userMessage.id,
      policy: normalizedPolicy,
      ...(inputOptionsWithRefs ? { inputOptions: inputOptionsWithRefs } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(documentIds.length ? { documentIds } : {}),
    });

    await this.emitEvent({
      branchId: input.branchId,
      type: ProcessEventType.PROCESS_STARTED,
      agentRunId: run.id,
      message: 'Agent run started from user message.',
      payload: {
        triggerType: run.triggerType,
        triggerMessageId: userMessage.id,
        inputOptions: inputOptionsWithRefs,
        attachmentIds,
        documentIds,
        trustedRefsUsed: resolvedLibraryRefs,
        lowTrustRefsDeferred: 0,
        policySummary: buildPolicySummary(normalizedPolicy),
      },
    });

    await this.emitEvent({
      branchId: input.branchId,
      agentRunId: run.id,
      type: ProcessEventType.PROCESS_LOG,
      message: 'Input options applied for this run.',
      payload: {
        event: 'CHAT_INPUT_OPTIONS_APPLIED',
        inputOptions: inputOptionsWithRefs || null,
        policySummary: buildPolicySummary(normalizedPolicy),
      },
    });

    void this.executeRun(run.id).catch((error) => {
      console.error('[RuntimeRunEngine] executeRun failed:', error);
      void this.handleRunFailure({
        runId: run.id,
        branchId: input.branchId,
        message: 'Run failed unexpectedly while processing a user message.',
        error,
      });
    });

    return {
      branchId: input.branchId,
      queued: false,
      runId: run.id,
      userMessageId: userMessage.id,
    };
  }

  async updateQueuedMessage(input: {
    researchJobId: string;
    branchId: string;
    itemId: string;
    content?: string;
    inputOptions?: RuntimeInputOptions;
    steerNote?: string;
    attachmentIds?: string[];
    documentIds?: string[];
  }) {
    const branch = await getBranch(input.branchId, input.researchJobId);
    if (!branch) {
      throw new Error('Branch not found for this research job');
    }

    const content = input.content !== undefined ? String(input.content || '').trim() : undefined;
    if (content !== undefined && !content) {
      throw new Error('Queue item content cannot be empty');
    }
    const normalizedInputOptions = normalizeInputOptions(input.inputOptions);
    const attachmentIds =
      input.attachmentIds === undefined ? undefined : normalizeDocumentIds(input.attachmentIds || []);
    const documentIds =
      input.documentIds === undefined
        ? undefined
        : await hydrateDocumentIdsFromMessageInput({
            researchJobId: input.researchJobId,
            documentIds: normalizeDocumentIds(input.documentIds || []),
            attachmentIds: normalizeDocumentIds(input.attachmentIds || []),
          });
    const steerNote = String(input.steerNote || '').trim();
    const steerPayload =
      input.steerNote === undefined
        ? undefined
        : steerNote
          ? { note: steerNote.slice(0, 1000), updatedAt: new Date().toISOString() }
          : null;

    await updateQueueItem(input.branchId, input.itemId, {
      ...(content !== undefined ? { content } : {}),
      ...(input.inputOptions !== undefined ? { inputOptions: normalizedInputOptions } : {}),
      ...(attachmentIds !== undefined ? { attachmentIds } : {}),
      ...(documentIds !== undefined ? { documentIds } : {}),
      ...(steerPayload !== undefined ? { steer: steerPayload } : {}),
    });

    await this.emitEvent({
      branchId: input.branchId,
      type: ProcessEventType.PROCESS_LOG,
      message: 'Queued message updated.',
      payload: {
        event: 'CHAT_QUEUE_ITEM_UPDATED',
        queueItemId: input.itemId,
        hasContentUpdate: content !== undefined,
        hasInputOptionsUpdate: input.inputOptions !== undefined,
        hasAttachmentsUpdate: attachmentIds !== undefined,
        hasDocumentsUpdate: documentIds !== undefined,
        hasSteerNote: Boolean(steerNote),
      },
    });
  }

  async cancelBranchRuns(input: { researchJobId: string; branchId: string; reason?: string }) {
    const branch = await getBranch(input.branchId, input.researchJobId);
    if (!branch) {
      throw new Error('Branch not found for this research job');
    }

    await cancelActiveToolRuns(input.branchId);
    await cancelActiveRuns(input.branchId);

    await this.emitEvent({
      branchId: input.branchId,
      type: ProcessEventType.PROCESS_CANCELLED,
      level: ProcessEventLevel.WARN,
      message: input.reason || 'Cancelled by user.',
    });

    return { ok: true };
  }

  async resolveDecision(input: {
    researchJobId: string;
    branchId: string;
    decisionId: string;
    option: string;
    actorUserId: string;
  }): Promise<{ ok: boolean; runId: string; retriedToolRuns: number; skippedToolRuns: number }> {
    const branch = await getBranch(input.branchId, input.researchJobId);
    if (!branch) {
      throw new Error('Branch not found for this research job');
    }

    const decisionId = String(input.decisionId || '').trim();
    const option = String(input.option || '').trim();
    if (!decisionId || !option) {
      throw new Error('decisionId and option are required');
    }

    const waitingRuns = (await listActiveRuns(input.branchId)).filter(
      (run) => run.status === AgentRunStatus.WAITING_USER
    );
    if (!waitingRuns.length) {
      throw new Error('No waiting decision run found for this branch');
    }

    const targetRun = waitingRuns[waitingRuns.length - 1];
    const normalizedOption = option.toLowerCase();
    const shouldRetryBlockedTools = /(approve|allow|yes|continue|apply|run|proceed)/i.test(normalizedOption);

    const plan = normalizeRunPlan(targetRun.planJson);
    const updatedPlan =
      plan && plan.decisionRequests.length
        ? {
            ...plan,
            decisionRequests: plan.decisionRequests.filter((decision) => decision.id !== decisionId),
          }
        : plan;
    if (updatedPlan) {
      updatedPlan.needUserInput = updatedPlan.decisionRequests.some((decision) => Boolean(decision.blocking));
    }

    const basePolicy = normalizePolicy(
      isRecord(targetRun.policyJson) ? (targetRun.policyJson as Partial<RunPolicy>) : undefined,
      isRecord(targetRun.inputOptionsJson) ? (targetRun.inputOptionsJson as RuntimeInputOptions) : undefined
    );
    const policyForRun: Record<string, unknown> = {
      ...basePolicy,
      ...(shouldRetryBlockedTools ? { allowMutationTools: true } : {}),
    };

    const blockedToolRuns = targetRun.toolRuns.filter((toolRun) => {
      if (toolRun.status !== ToolRunStatus.FAILED) return false;
      if (!isRecord(toolRun.resultJson)) return false;
      const decisions = Array.isArray(toolRun.resultJson.decisions) ? toolRun.resultJson.decisions : [];
      return decisions.some((decision) => isRecord(decision) && String(decision.id || '').trim() === decisionId);
    });

    if (shouldRetryBlockedTools) {
      for (const toolRun of blockedToolRuns) {
        await updateToolRun(toolRun.id, {
          status: ToolRunStatus.QUEUED,
          result: null,
          startedAt: null,
          endedAt: null,
        });
      }
    } else {
      for (const toolRun of blockedToolRuns) {
        await updateToolRun(toolRun.id, {
          status: ToolRunStatus.CANCELLED,
          endedAt: new Date(),
          result: {
            ok: false,
            summary: `Skipped ${toolRun.toolName} based on decision "${option}".`,
            artifacts: [],
            evidence: [],
            continuations: [],
            decisions: [],
            warnings: [`Skipped by user decision: ${option}`],
            raw: {
              decisionId,
              option,
            },
          } satisfies RuntimeToolResult,
        });
      }
    }

    await createBranchMessage({
      branchId: input.branchId,
      role: ChatBranchMessageRole.SYSTEM,
      content: `DECISION_RESOLUTION::${decisionId}::${option}`,
      clientVisible: false,
    });

    await updateAgentRun(targetRun.id, {
      status: AgentRunStatus.RUNNING,
      ...(updatedPlan ? { plan: updatedPlan } : {}),
      policy: policyForRun,
      error: null,
      endedAt: null,
    });

    await this.emitEvent({
      branchId: input.branchId,
      agentRunId: targetRun.id,
      type: ProcessEventType.PROCESS_LOG,
      message: `Decision resolved (${decisionId}): ${option}`,
      payload: {
        decisionId,
        option,
        actorUserId: input.actorUserId,
        retriedToolRuns: shouldRetryBlockedTools ? blockedToolRuns.length : 0,
        skippedToolRuns: shouldRetryBlockedTools ? 0 : blockedToolRuns.length,
      },
    });

    void this.executeRun(targetRun.id).catch((error) => {
      console.error('[RuntimeRunEngine] executeRun failed after decision resolution:', error);
      void this.handleRunFailure({
        runId: targetRun.id,
        branchId: input.branchId,
        message: 'Run failed after resolving a decision.',
        error,
      });
    });

    return {
      ok: true,
      runId: targetRun.id,
      retriedToolRuns: shouldRetryBlockedTools ? blockedToolRuns.length : 0,
      skippedToolRuns: shouldRetryBlockedTools ? 0 : blockedToolRuns.length,
    };
  }

  async steerActiveRun(input: {
    researchJobId: string;
    branchId: string;
    userId: string;
    note: string;
  }): Promise<{ ok: boolean; applied: boolean; runId?: string; queued?: boolean; queueItemId?: string }> {
    const branch = await getBranch(input.branchId, input.researchJobId);
    if (!branch) {
      throw new Error('Branch not found for this research job');
    }

    const note = String(input.note || '').trim();
    if (!note) {
      throw new Error('Steer note is required');
    }

    const activeRuns = (await listActiveRuns(input.branchId)).filter(
      (run) => run.status !== AgentRunStatus.CANCELLED && run.status !== AgentRunStatus.DONE
    );

    if (!activeRuns.length) {
      const queueItem = await enqueueMessage({
        branchId: input.branchId,
        userId: input.userId,
        content: `Steer note: ${note}`,
        steer: {
          note,
          updatedAt: new Date().toISOString(),
        },
      });

      await this.emitEvent({
        branchId: input.branchId,
        type: ProcessEventType.PROCESS_LOG,
        message: 'No active run to steer. Steer note queued for the next run.',
        payload: {
          queueItemId: queueItem.id,
          note: compactSteerNote(note),
        },
      });

      return {
        ok: true,
        applied: false,
        queued: true,
        queueItemId: queueItem.id,
      };
    }

    const activeRun = activeRuns[activeRuns.length - 1];

    await createBranchMessage({
      branchId: input.branchId,
      role: ChatBranchMessageRole.SYSTEM,
      content: `STEER_NOTE::${note}`,
      clientVisible: false,
    });

    await this.emitEvent({
      branchId: input.branchId,
      agentRunId: activeRun.id,
      type: ProcessEventType.PROCESS_LOG,
      message: `Steer note applied to the active run: ${compactSteerNote(note)}`,
      payload: {
        note,
        actorUserId: input.userId,
      },
    });

    return {
      ok: true,
      applied: true,
      runId: activeRun.id,
    };
  }

  private async ensureToolRuns(runId: string, toolCalls: RuntimeToolCall[], maxToolRuns: number) {
    const existing = await listToolRuns(runId);
    const existingKeys = new Set(
      existing.map((toolRun) => `${toolRun.toolName}:${JSON.stringify(toolRun.argsJson || {})}`)
    );

    const capped = toolCalls.slice(0, maxToolRuns);
    for (const call of capped) {
      const key = `${call.tool}:${JSON.stringify(call.args || {})}`;
      if (existingKeys.has(key)) continue;
      await createToolRun({
        agentRunId: runId,
        toolName: call.tool,
        args: call.args || {},
      });
      existingKeys.add(key);
    }
  }

  private async executeToolRun(runId: string, toolRunId: string, policy: RunPolicy) {
    const run = await getAgentRun(runId);
    if (!run) return;

    const toolRun = run.toolRuns.find((item) => item.id === toolRunId);
    if (!toolRun) return;

    if (toolRun.status !== ToolRunStatus.QUEUED && toolRun.status !== ToolRunStatus.RUNNING) {
      return;
    }

    await updateToolRun(toolRunId, {
      status: ToolRunStatus.RUNNING,
      startedAt: new Date(),
    });

    await this.emitEvent({
      branchId: run.branchId,
      agentRunId: runId,
      toolRunId,
      type: ProcessEventType.PROCESS_PROGRESS,
      message: `Running tool ${toolRun.toolName}`,
      payload: {
        toolName: toolRun.toolName,
      },
    });

    const args = isRecord(toolRun.argsJson) ? toolRun.argsJson : {};
    const userMessage = run.triggerMessage?.content || '';
    let contract: RuntimeToolResult | null = null;
    let attempt = 0;
    const maxTransientRetries = resolveToolRetryLimit(toolRun.toolName);

    while (attempt <= maxTransientRetries) {
      attempt += 1;
      try {
        const nextContract = await executeToolWithContract({
          researchJobId: run.branch.thread.researchJobId,
          syntheticSessionId: `runtime-${run.branchId}`,
          userMessage,
          toolName: toolRun.toolName,
          args,
          policy,
          runId,
        });
        contract = nextContract;

        if (nextContract.ok || !isTransientToolContractFailure(nextContract) || attempt > maxTransientRetries) {
          break;
        }

        const delayMs = retryBackoffMs(attempt);
        await this.emitEvent({
          branchId: run.branchId,
          agentRunId: runId,
          toolRunId,
          type: ProcessEventType.PROCESS_LOG,
          level: ProcessEventLevel.WARN,
          message: `Retrying ${toolRun.toolName} after transient failure (${attempt}/${maxTransientRetries}).`,
          payload: {
            toolName: toolRun.toolName,
            retryAttempt: attempt,
            maxRetries: maxTransientRetries,
            delayMs,
            reason: nextContract.warnings.slice(0, 3),
          },
        });
        await sleep(delayMs);
      } catch (error) {
        if (!isTransientToolError(error) || attempt > maxTransientRetries) {
          contract = {
            ok: false,
            summary: `Tool ${toolRun.toolName} failed.`,
            artifacts: [],
            evidence: [],
            continuations: [],
            decisions: [],
            warnings: [String((error as Error)?.message || error || 'Unknown tool execution error')],
          };
          break;
        }

        const delayMs = retryBackoffMs(attempt);
        await this.emitEvent({
          branchId: run.branchId,
          agentRunId: runId,
          toolRunId,
          type: ProcessEventType.PROCESS_LOG,
          level: ProcessEventLevel.WARN,
          message: `Retrying ${toolRun.toolName} after transient runtime error (${attempt}/${maxTransientRetries}).`,
          payload: {
            toolName: toolRun.toolName,
            retryAttempt: attempt,
            maxRetries: maxTransientRetries,
            delayMs,
            error: String((error as Error)?.message || error || 'unknown error'),
          },
        });
        await sleep(delayMs);
      }
    }

    if (!contract) {
      contract = {
        ok: false,
        summary: `Tool ${toolRun.toolName} failed.`,
        artifacts: [],
        evidence: [],
        continuations: [],
        decisions: [],
        warnings: ['Tool execution returned no result.'],
      };
    }
    const retryAttempts = Math.max(0, attempt - 1);
    const contractWithRetryMeta: RuntimeToolResult = {
      ...contract,
      ...(retryAttempts > 0
        ? {
            raw: {
              ...(isRecord(contract.raw) ? contract.raw : {}),
              retryAttempts,
            },
          }
        : {}),
    };

    await updateToolRun(toolRunId, {
      status: contractWithRetryMeta.ok ? ToolRunStatus.DONE : ToolRunStatus.FAILED,
      result: contractWithRetryMeta,
      endedAt: new Date(),
      producedArtifacts: contractWithRetryMeta.artifacts,
    });

    await createBranchMessage({
      branchId: run.branchId,
      role: ChatBranchMessageRole.TOOL,
      content: `${toolRun.toolName}: ${contractWithRetryMeta.summary}`,
      citationsJson: contractWithRetryMeta.evidence,
      clientVisible: false,
    });

    await this.emitEvent({
      branchId: run.branchId,
      agentRunId: runId,
      toolRunId,
      type: contractWithRetryMeta.ok ? ProcessEventType.PROCESS_RESULT : ProcessEventType.FAILED,
      level: contractWithRetryMeta.ok ? ProcessEventLevel.INFO : ProcessEventLevel.WARN,
      message: contractWithRetryMeta.summary,
      payload: {
        ...buildToolOutputEventPayload(toolRun.toolName, contractWithRetryMeta),
        retryAttempts,
      },
    });

    for (const warning of contractWithRetryMeta.warnings) {
      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: runId,
        toolRunId,
        type: ProcessEventType.PROCESS_LOG,
        level: ProcessEventLevel.WARN,
        message: warning,
      });
    }
  }

  private async executePendingToolRuns(runId: string, policy: RunPolicy) {
    const toolRuns = (await listToolRuns(runId)).filter((run) => run.status === ToolRunStatus.QUEUED);
    if (!toolRuns.length) return;

    const concurrency = Math.max(1, Math.min(policy.toolConcurrency, toolRuns.length));
    let cursor = 0;

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const current = toolRuns[cursor];
        cursor += 1;
        if (!current) return;
        await this.executeToolRun(runId, current.id, policy);
      }
    });

    await Promise.all(workers);
  }

  private async finalizeRun(runId: string, policy: RunPolicy) {
    const run = await getAgentRun(runId);
    if (!run) return;

    const triggerMessageRaw = run.triggerMessage?.content || 'Continue with available results.';
    const triggerBlocksRaw = (run.triggerMessage as any)?.blocksJson;
    const triggerCitationsRaw = (run.triggerMessage as any)?.citationsJson;
    const triggerViralStudioBlocks = normalizeRuntimeViralStudioBlocks(triggerBlocksRaw);
    const triggerCitations = normalizeRuntimeUserCitations(triggerCitationsRaw, 16);
    const viralStudioHint = buildViralStudioTriggerHint(triggerViralStudioBlocks, triggerCitations);
    const viralStudioSnapshot = buildViralStudioRuntimeSnapshot(triggerViralStudioBlocks, triggerCitations);
    const triggerAttachmentIds = normalizeDocumentIds([
      ...normalizeIdList((run.triggerMessage as any)?.attachmentIdsJson),
      ...normalizeIdList((run as any).attachmentIdsJson),
    ]);
    const triggerDocumentIds = await hydrateDocumentIdsFromMessageInput({
      researchJobId: run.branch.thread.researchJobId,
      documentIds: [
        ...normalizeIdList((run.triggerMessage as any)?.documentIdsJson),
        ...normalizeIdList((run as any).documentIdsJson),
      ],
      attachmentIds: triggerAttachmentIds,
    });
    const documentGroundingHint = triggerDocumentIds.length
      ? await buildDocumentGroundingHint({
          researchJobId: run.branch.thread.researchJobId,
          documentIds: triggerDocumentIds,
        })
      : '';
    let triggerMessage = documentGroundingHint ? `${triggerMessageRaw}\n\n${documentGroundingHint}` : triggerMessageRaw;
    if (viralStudioHint) {
      triggerMessage = `${triggerMessage}\n\n${viralStudioHint}`;
    }
    let plan = normalizeRunPlan(run.planJson) || buildPlanFromMessage(triggerMessage);
    let runtimeContextSnapshot = isRecord(plan.runtime?.contextSnapshot)
      ? (plan.runtime.contextSnapshot as Record<string, unknown>)
      : {};
    if (Object.keys(viralStudioSnapshot).length > 0) {
      runtimeContextSnapshot = {
        ...runtimeContextSnapshot,
        ...viralStudioSnapshot,
      };
    }
    const runStartedAt = run.startedAt || run.createdAt || new Date(0);
    const runMessages = await listBranchMessages(run.branchId, 180);
    const steerNotes = extractRunSteerNotes(
      runMessages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),
      runStartedAt
    );
    const effectiveUserMessage =
      steerNotes.length > 0
        ? `${triggerMessage}\n\nSteer notes for this run:\n${steerNotes.map((note, index) => `${index + 1}. ${note}`).join('\n')}`
        : triggerMessage;
    const toolRuns = await listToolRuns(run.id);
    const toolResults = toolRuns
      .map((item) => (isRecord(item.resultJson) ? (item.resultJson as RuntimeToolResult) : null))
      .filter((item): item is RuntimeToolResult => Boolean(item));
    const docFamily = resolveDocFamilyFromPlan(plan);
    const loopState = buildLoopRuntimeState({
      plan,
      policy,
      contextSnapshot: runtimeContextSnapshot,
    });

    const emitProgressiveLoopEvent = async (input: {
      event: 'run.loop_started' | 'run.loop_completed' | 'run.stage_searching' | 'run.stage_thinking' | 'run.stage_building' | 'run.stage_validating';
      message: string;
      level?: ProcessEventLevel;
      phase?: 'planning' | 'tools' | 'writing' | 'completed';
      stage?: string;
      extra?: Record<string, unknown>;
    }) => {
      if (!RUNTIME_PROGRESSIVE_LOOPS_ENABLED) return;
      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_LOG,
        level: input.level || ProcessEventLevel.INFO,
        message: input.message,
        payload: {
          stage: input.stage || undefined,
          loopIndex: loopState.loopIndex,
          loopMax: loopState.loopMax,
          loopReason: loopState.loopReason,
          coverageDelta: loopState.coverageDelta,
          ...(loopState.coverageScore !== undefined ? { coverageScore: loopState.coverageScore } : {}),
          ...(docFamily ? { docFamily } : {}),
          ...(input.extra || {}),
          eventV2: {
            version: 2,
            event: input.event,
            phase: input.phase || 'tools',
            status: input.level === ProcessEventLevel.WARN ? 'warn' : input.level === ProcessEventLevel.ERROR ? 'error' : 'info',
            runId: run.id,
            createdAt: new Date().toISOString(),
          },
        },
      });
    };

    if (RUNTIME_PROGRESSIVE_LOOPS_ENABLED) {
      const loopMethodFamily = listToolFamilies(plan.toolCalls).join(', ');
      const loopQueryVariant = pickQueryVariantForLoop(plan.runtime?.queryVariants, loopState.loopIndex);
      const loopLane = pickLaneForLoop(plan.runtime?.lanePriority, loopState.loopIndex);
      plan = {
        ...plan,
        runtime: {
          ...(isRecord(plan.runtime) ? plan.runtime : {}),
          continuationDepth: plan.runtime?.continuationDepth ?? 0,
          loopIndex: loopState.loopIndex,
          loopMax: loopState.loopMax,
          loopReason: loopState.loopReason,
          coverageDelta: loopState.coverageDelta,
          ...(runtimeContextSnapshot && Object.keys(runtimeContextSnapshot).length
            ? { contextSnapshot: runtimeContextSnapshot }
            : {}),
        },
      };
      await updateAgentRun(run.id, { plan });
      await emitProgressiveLoopEvent({
        event: 'run.loop_started',
        message: `Loop ${loopState.loopIndex}/${loopState.loopMax} started${loopMethodFamily ? ` (${loopMethodFamily})` : ''}.`,
        phase: 'tools',
        stage: 'loop',
        extra: {
          ...(loopMethodFamily ? { methodFamily: loopMethodFamily } : {}),
          ...(loopLane ? { lane: loopLane } : {}),
          ...(loopQueryVariant ? { queryVariant: loopQueryVariant } : {}),
        },
      });
      await emitProgressiveLoopEvent({
        event: 'run.stage_thinking',
        message: `Thinking and restructuring sections (loop ${loopState.loopIndex}/${loopState.loopMax}).`,
        phase: 'planning',
        stage: 'thinking',
        extra: {
          ...(loopMethodFamily ? { methodFamily: loopMethodFamily } : {}),
          ...(loopLane ? { lane: loopLane } : {}),
          ...(loopQueryVariant ? { queryVariant: loopQueryVariant } : {}),
        },
      });
    }

    if (
      isRecord(runtimeContextSnapshot) &&
      runtimeContextSnapshot.documentEnrichmentApplied &&
      !runtimeContextSnapshot.documentEnrichmentCompleted
    ) {
      runtimeContextSnapshot = {
        ...runtimeContextSnapshot,
        documentEnrichmentCompleted: true,
        documentEnrichmentCompletedAt: new Date().toISOString(),
      };
      plan = {
        ...plan,
        runtime: {
          ...(isRecord(plan.runtime) ? plan.runtime : {}),
          continuationDepth: plan.runtime?.continuationDepth ?? 0,
          contextSnapshot: runtimeContextSnapshot,
        },
      };
      await updateAgentRun(run.id, { plan });
      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_RESULT,
        message: 'Bounded enrichment completed; generating best available deep draft now.',
        payload: {
          toolName: 'document.generate',
          eventV2: {
            version: 2,
            event: 'document.enrichment_completed',
            phase: 'tools',
            status: 'info',
            runId: run.id,
            toolName: 'document.generate',
            createdAt: new Date().toISOString(),
          },
        },
      });
    }

    const blockingDecisions = collectBlockingDecisions(toolResults);
    if (blockingDecisions.length > 0) {
      await this.persistAssistantMessage({
        branchId: run.branchId,
        content:
          'I reached a decision checkpoint before continuing. Please choose one option to proceed with the branch execution.',
        blocksJson: {
          type: 'decision_requests',
          items: blockingDecisions,
        },
        reasoningJson: {
          plan: plan.plan,
          tools: toolRuns.map((item) => item.toolName),
          assumptions: ['Mutation-like steps require explicit user approval.'],
          nextSteps: ['Provide approval decision', 'Continue run once approved'],
          evidence: flattenEvidence(toolResults).map((item, idx) => ({
            id: `e-${idx + 1}`,
            label: item.label,
            url: item.url,
          })),
        },
        citationsJson: flattenEvidence(toolResults),
        clientVisible: true,
        contextSnapshot: runtimeContextSnapshot,
      });

      await updateAgentRun(run.id, {
        status: AgentRunStatus.WAITING_USER,
      });

      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.DECISION_REQUIRED,
        level: ProcessEventLevel.WARN,
        message: 'Run is waiting for approval before continuing.',
        payload: { decisions: blockingDecisions },
      });

      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.WAITING_FOR_INPUT,
        message: 'Waiting for user input.',
      });
      await emitProgressiveLoopEvent({
        event: 'run.loop_completed',
        message: `Loop ${loopState.loopIndex}/${loopState.loopMax} paused for approval.`,
        phase: 'tools',
        stage: 'loop',
        level: ProcessEventLevel.WARN,
        extra: {
          pausedForApproval: true,
        },
      });

      await this.dispatchNextQueuedMessage({
        researchJobId: run.branch.thread.researchJobId,
        branchId: run.branchId,
        policy,
        mode: 'interrupt',
      });
      return;
    }

    if (isDocumentFocusedRun({ plan, toolRuns })) {
      const runElapsedMs = Date.now() - runStartedAt.getTime();
      const budgetMs = resolveDocumentRunBudgetMs(plan, policy);
      if (Number.isFinite(runElapsedMs) && runElapsedMs > budgetMs) {
        const partial = buildDocumentBudgetPartialMessage({
          runElapsedMs,
          budgetMs,
          contextSnapshot: runtimeContextSnapshot,
          toolResults,
        });
        const actionButtons = sanitizeWriterActions(partial.actions, 8);
        const documentArtifact = extractDocumentArtifact(toolResults);
        const budgetBlocks: Record<string, unknown>[] = [];
        if (documentArtifact) {
          budgetBlocks.push(documentArtifact);
        }
        if (actionButtons.length) {
          budgetBlocks.push({
            type: 'action_buttons',
            actions: actionButtons,
            decisions: [],
          });
        }
        await this.persistAssistantMessage({
          branchId: run.branchId,
          content: partial.content,
          blocksJson:
            budgetBlocks.length === 0
              ? undefined
              : budgetBlocks.length === 1
                ? budgetBlocks[0]
                : budgetBlocks,
          reasoningJson: {
            plan: plan.plan,
            tools: toolRuns.map((item) => item.toolName),
            assumptions: ['Runtime budget guard returned a best-available draft to prevent stalls.'],
            nextSteps: ['Open current draft', 'Continue deepening only if needed'],
            evidence: flattenEvidence(toolResults).map((item, idx) => ({
              id: `e-${idx + 1}`,
              label: item.label,
              url: item.url,
            })),
          },
          citationsJson: flattenEvidence(toolResults),
          clientVisible: true,
          contextSnapshot: runtimeContextSnapshot,
        });

        await updateAgentRun(run.id, {
          status: AgentRunStatus.DONE,
          endedAt: new Date(),
          error: null,
        });

        await this.emitEvent({
          branchId: run.branchId,
          agentRunId: run.id,
          type: ProcessEventType.PROCESS_RESULT,
          level: ProcessEventLevel.WARN,
          message: 'Returned best draft due to document runtime budget.',
          payload: {
            budgetMs,
            elapsedMs: runElapsedMs,
            toolName: 'document.generate',
            eventV2: {
              version: 2,
              event: 'document.partial_returned',
              phase: 'writing',
              status: 'warn',
              runId: run.id,
              toolName: 'document.generate',
              createdAt: new Date().toISOString(),
            },
          },
        });

        await this.emitEvent({
          branchId: run.branchId,
          agentRunId: run.id,
          type: ProcessEventType.DONE,
          message: `Run completed with budget guard after ${Math.round(runElapsedMs / 1000)}s.`,
          payload: {
            policySummary: buildPolicySummary(policy),
          },
        });
        await emitProgressiveLoopEvent({
          event: 'run.loop_completed',
          message: `Loop ${loopState.loopIndex}/${loopState.loopMax} completed with budget fallback.`,
          phase: 'completed',
          stage: 'loop',
          level: ProcessEventLevel.WARN,
          extra: {
            partialReturned: true,
          },
        });

        await this.dispatchNextQueuedMessage({
          researchJobId: run.branch.thread.researchJobId,
          branchId: run.branchId,
          policy,
          mode: 'send',
        });
        return;
      }
    }

    const promptToolResults = compactToolResultsForPrompt(toolResults);
    await updateAgentRun(run.id, { status: AgentRunStatus.RUNNING });
    await this.emitEvent({
      branchId: run.branchId,
      agentRunId: run.id,
      type: ProcessEventType.PROCESS_PROGRESS,
      message: 'Synthesizing evidence and preparing final response.',
      payload: {
        phase: 'planning',
        stage: 'synthesis',
        toolCount: toolRuns.length,
      },
    });
    const isRunCancelled = async (stage: string): Promise<boolean> => {
      const latest = await getAgentRun(run.id);
      if (!latest || latest.status === AgentRunStatus.CANCELLED) {
        await this.emitEvent({
          branchId: run.branchId,
          agentRunId: run.id,
          type: ProcessEventType.PROCESS_CANCELLED,
          level: ProcessEventLevel.WARN,
          message: `Run cancelled during ${stage}.`,
        });
        return true;
      }
      return false;
    };

    if (await isRunCancelled('tool_digest')) return;

    const toolDigest = fallbackToolDigest(promptToolResults, plan, effectiveUserMessage);

    let evidenceLedger: RuntimeEvidenceLedger | null = null;
    let ledgerVersionId: string | null = null;
    if (shouldBuildLedgerForRun(run.id)) {
      evidenceLedger = await withTimeout(
        buildEvidenceLedger({
          userMessage: effectiveUserMessage,
          plan,
          policy,
          runtimeContext: runtimeContextSnapshot,
          toolDigest,
          toolResults: promptToolResults,
        }),
        RUNTIME_PROMPT_STAGE_TIMEOUT_MS,
        'buildEvidenceLedger'
      ).catch(async (error: any) => {
        await this.emitEvent({
          branchId: run.branchId,
          agentRunId: run.id,
          type: ProcessEventType.PROCESS_LOG,
          level: ProcessEventLevel.WARN,
          message: `Evidence ledger fallback used: ${compactPromptString(error?.message || error, 220)}`,
        });
        return null;
      });

      if (evidenceLedger) {
        try {
          const savedLedger = await createKnowledgeLedgerVersion({
            researchJobId: run.branch.thread.researchJobId,
            runId: run.id,
            source: 'runtime',
            payload: evidenceLedger,
          });
          ledgerVersionId = savedLedger.id;
          await this.emitEvent({
            branchId: run.branchId,
            agentRunId: run.id,
            type: ProcessEventType.PROCESS_LOG,
            message: 'Evidence ledger version created.',
            payload: {
              ledgerVersionId,
              entities: evidenceLedger.entities.length,
              facts: evidenceLedger.facts.length,
              relations: evidenceLedger.relations.length,
              gaps: evidenceLedger.gaps.length,
            },
          });
        } catch (ledgerPersistError: any) {
          await this.emitEvent({
            branchId: run.branchId,
            agentRunId: run.id,
            type: ProcessEventType.PROCESS_LOG,
            level: ProcessEventLevel.WARN,
            message: `Ledger persistence failed: ${compactPromptString(ledgerPersistError?.message || ledgerPersistError, 220)}`,
          });
        }
      }
    }

    const continuationDepth = plan.runtime?.continuationDepth ?? 0;
    const runtimeState = (isRecord(plan.runtime) ? plan.runtime : {}) as NonNullable<RuntimePlan['runtime']>;
    const plannerPreferredFamilies = preferredFamiliesFromLanePriority(runtimeState.lanePriority);
    const currentLoopFamilies = listToolFamilies(plan.toolCalls);
    const currentLoopFingerprints = buildToolCallFingerprints(plan.toolCalls, policy.maxToolRuns);
    const familyHistory = normalizeToolFamilyHistory(runtimeState.familyHistory, LOOP_HISTORY_MAX);
    const queryFingerprints = normalizeStringHistory(runtimeState.queryFingerprints, LOOP_QUERY_FINGERPRINT_MAX);
    const coverageDeltaHistory = normalizeNumberHistory(runtimeState.coverageDeltaHistory, LOOP_HISTORY_MAX);
    const newEvidenceRefCountHistory = normalizeNumberHistory(runtimeState.newEvidenceRefCountHistory, LOOP_HISTORY_MAX);
    const seenEvidenceRefIds = normalizeStringHistory(runtimeState.seenEvidenceRefIds, LOOP_SEEN_EVIDENCE_MAX);
    const loopRuntimeEvidenceRefIds = collectRuntimeEvidenceRefIds(toolResults);
    const seenEvidenceRefSet = new Set<string>(seenEvidenceRefIds);
    let newEvidenceRefs = 0;
    for (const refId of loopRuntimeEvidenceRefIds) {
      if (!refId || seenEvidenceRefSet.has(refId)) continue;
      seenEvidenceRefSet.add(refId);
      newEvidenceRefs += 1;
    }
    const nextCoverageDeltaHistory = appendBoundedNumberHistory(coverageDeltaHistory, loopState.coverageDelta, LOOP_HISTORY_MAX);
    const nextNoveltyHistory = appendBoundedNumberHistory(
      newEvidenceRefCountHistory,
      newEvidenceRefs,
      LOOP_HISTORY_MAX
    );
    const nextFamilyHistory = appendBoundedFamilyHistory(familyHistory, currentLoopFamilies, LOOP_HISTORY_MAX);
    const nextQueryFingerprints = appendBoundedStringHistory(
      queryFingerprints,
      currentLoopFingerprints,
      LOOP_QUERY_FINGERPRINT_MAX
    );
    const nextSeenEvidenceRefIds = Array.from(seenEvidenceRefSet).slice(-LOOP_SEEN_EVIDENCE_MAX);
    const consecutiveLowDeltaLoops = countConsecutiveLowDeltaLoops(nextCoverageDeltaHistory, nextNoveltyHistory);
    const shouldForceAlternateMethod = consecutiveLowDeltaLoops >= 2;
    const alternateFamilies = shouldForceAlternateMethod
      ? chooseAlternateFamiliesForStall({
          availableFamilies: listAvailableToolFamilies(policy),
          currentFamilies: currentLoopFamilies,
          familyHistory: nextFamilyHistory,
          preferredFamilies: plannerPreferredFamilies,
        })
      : [];
    const continuationPreferredFamilies = Array.from(
      new Set<ToolFamily>([...alternateFamilies, ...plannerPreferredFamilies])
    );
    const nextLoopIndexCandidate = Math.max(1, continuationDepth + 2);
    const continuationQueryVariant = pickQueryVariantForLoop(plan.runtime?.queryVariants, nextLoopIndexCandidate);
    const continuationLane = pickLaneForLoop(plan.runtime?.lanePriority, nextLoopIndexCandidate);
    const continuationSeedMessage = continuationQueryVariant
      ? `${triggerMessage}\n\nQuery variant: ${continuationQueryVariant}`
      : triggerMessage;

    const shouldPersistLoopRuntimeState =
      JSON.stringify(familyHistory) !== JSON.stringify(nextFamilyHistory) ||
      JSON.stringify(queryFingerprints) !== JSON.stringify(nextQueryFingerprints) ||
      JSON.stringify(coverageDeltaHistory) !== JSON.stringify(nextCoverageDeltaHistory) ||
      JSON.stringify(newEvidenceRefCountHistory) !== JSON.stringify(nextNoveltyHistory) ||
      JSON.stringify(seenEvidenceRefIds) !== JSON.stringify(nextSeenEvidenceRefIds);
    if (shouldPersistLoopRuntimeState) {
      plan = {
        ...plan,
        runtime: {
          ...(isRecord(plan.runtime) ? plan.runtime : {}),
          continuationDepth,
          familyHistory: nextFamilyHistory,
          queryFingerprints: nextQueryFingerprints,
          coverageDeltaHistory: nextCoverageDeltaHistory,
          newEvidenceRefCountHistory: nextNoveltyHistory,
          seenEvidenceRefIds: nextSeenEvidenceRefIds,
        },
      };
      await updateAgentRun(run.id, { plan });
    }

    if (shouldForceAlternateMethod) {
      await emitProgressiveLoopEvent({
        event: 'run.stage_thinking',
        message: `Coverage stalled for ${consecutiveLowDeltaLoops} loop(s); rotating methods for the next loop.`,
        phase: 'planning',
        stage: 'thinking',
        extra: {
          stallLoops: consecutiveLowDeltaLoops,
          methodFamily: continuationPreferredFamilies.join(', '),
          newEvidenceRefs,
          ...(continuationLane ? { lane: continuationLane } : {}),
          ...(continuationQueryVariant ? { queryVariant: continuationQueryVariant } : {}),
        },
      });
    }

    const continuationCallsFromResults = RUNTIME_CONTINUATION_CALLS_V2
      ? collectContinuationToolCalls(toolResults)
      : collectContinuationTools(toolResults).map((tool) => ({ tool, args: {} }));
    const continuationCallsFromLedger =
      RUNTIME_CONTINUATION_CALLS_V2 && evidenceLedger
        ? (Array.isArray(evidenceLedger.suggestedToolCalls)
            ? evidenceLedger.suggestedToolCalls.map((entry) => ({
                tool: String(entry.tool || '').trim(),
                args: isRecord(entry.args) ? entry.args : {},
              }))
            : []
          ).filter((entry) => entry.tool)
        : [];
    const continuationFromDigest = toolDigest.recommendedContinuations
      .map((tool) => tool.trim())
      .filter((tool) => /^[a-z_]+\.[a-z_]+$/i.test(tool));
    const continuationFromDigestCalls: RuntimeToolCall[] = continuationFromDigest.map((tool) => ({
      tool,
      args: {},
    }));
    const continuationCallsRaw = sanitizeToolCalls(
      [...continuationCallsFromResults, ...continuationCallsFromLedger, ...continuationFromDigestCalls].slice(
        0,
        policy.maxToolRuns
      ),
      continuationSeedMessage,
      policy.maxToolRuns
    );
    const continuationSourceScope = enforceToolSourceScope({
      toolCalls: continuationCallsRaw,
      policy,
      ...(runtimeContextSnapshot ? { runtimeContextSnapshot } : {}),
      maxToolRuns: policy.maxToolRuns,
    });
    const continuationDiversity = enforceToolFamilyDiversity({
      toolCalls: continuationSourceScope.toolCalls,
      policy,
      userMessage: continuationSeedMessage,
      ...(runtimeContextSnapshot ? { runtimeContextSnapshot } : {}),
      maxToolRuns: policy.maxToolRuns,
      ...(continuationPreferredFamilies.length ? { preferredFamilies: continuationPreferredFamilies } : {}),
    });
    const continuationCalls = continuationDiversity.toolCalls;
    const continuationFamiliesUsed = continuationDiversity.familiesUsed.join(', ');
    const suppressAutoContinueForCompetitorBrief = detectWriterIntent(effectiveUserMessage) === 'competitor_brief';
    const hasGeneratedDocumentDraft = toolRuns.some(
      (toolRun) => toolRun.toolName === 'document.generate' && toolRun.status === ToolRunStatus.DONE
    );
    const suppressAutoContinueForDocumentRun = isDocumentFocusedRun({ plan, toolRuns }) && hasGeneratedDocumentDraft;
    const shouldStopForLowDeltaLoops = consecutiveLowDeltaLoops > LOOP_STALL_MAX_RETRIES;
    const continuationCallsForRun =
      suppressAutoContinueForCompetitorBrief || suppressAutoContinueForDocumentRun || shouldStopForLowDeltaLoops
        ? []
        : continuationCalls;
    if (continuationSourceScope.blocked.length > 0) {
      for (const blocked of continuationSourceScope.blocked) {
        await this.emitEvent({
          branchId: run.branchId,
          agentRunId: run.id,
          type: ProcessEventType.PROCESS_LOG,
          level: ProcessEventLevel.WARN,
          message: blocked.reason,
          payload: {
            event: 'CHAT_SOURCE_SCOPE_BLOCKED_TOOL',
            blockedTool: blocked.tool,
            sourceLane: blocked.lane,
            ...(blocked.fallbackTool
              ? {
                  fallbackTool: blocked.fallbackTool.tool,
                  fallbackArgs: blocked.fallbackTool.args,
                }
              : {}),
            policySummary: buildPolicySummary(policy),
          },
        });
      }
    }
    if (continuationDiversity.addedFamilies.length > 0) {
      await emitProgressiveLoopEvent({
        event: 'run.stage_searching',
        message: `Expanded methods for next loop: ${continuationDiversity.addedFamilies.join(', ')}.`,
        phase: 'tools',
        stage: 'searching',
        extra: {
          methodFamily: continuationFamiliesUsed,
          newEvidenceRefs,
          ...(continuationLane ? { lane: continuationLane } : {}),
          ...(continuationQueryVariant ? { queryVariant: continuationQueryVariant } : {}),
        },
      });
    }
    if (shouldStopForLowDeltaLoops) {
      runtimeContextSnapshot = {
        ...(runtimeContextSnapshot || {}),
        researchLoopStalled: true,
        researchLoopStalledCount: consecutiveLowDeltaLoops,
        researchLoopStalledFamilies: continuationFamiliesUsed,
      };
      plan = {
        ...plan,
        runtime: {
          ...(isRecord(plan.runtime) ? plan.runtime : {}),
          continuationDepth,
          ...(runtimeContextSnapshot ? { contextSnapshot: runtimeContextSnapshot } : {}),
        },
      };
      await updateAgentRun(run.id, { plan });
      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_LOG,
        level: ProcessEventLevel.WARN,
        message: `Loop quality cap reached after ${consecutiveLowDeltaLoops} low-improvement loop(s); returning best grounded draft now.`,
        payload: {
          stage: 'validation',
          loopIndex: loopState.loopIndex,
          loopMax: loopState.loopMax,
          methodFamily: continuationFamiliesUsed,
          newEvidenceRefs,
        },
      });
    }

    if (
      policy.autoContinue &&
      continuationCallsForRun.length > 0 &&
      continuationDepth < policy.maxAutoContinuations
    ) {
      const nextPlan: RuntimePlan = {
        ...plan,
        runtime: {
          ...(isRecord(plan.runtime) ? plan.runtime : {}),
          continuationDepth: continuationDepth + 1,
          ...(isRecord(plan.runtime?.contextSnapshot) ? { contextSnapshot: plan.runtime?.contextSnapshot } : {}),
        },
        toolCalls: continuationCallsForRun,
      };

      await updateAgentRun(run.id, {
        plan: nextPlan,
        status: AgentRunStatus.RUNNING,
      });

      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_LOG,
        message: 'Auto-continuing based on tool suggestions.',
        payload: {
          continuationDepth: nextPlan.runtime?.continuationDepth,
          tools: continuationCallsForRun.map((call) => call.tool),
        },
      });
      await emitProgressiveLoopEvent({
        event: 'run.loop_completed',
        message: `Loop ${loopState.loopIndex}/${loopState.loopMax} completed; continuing with new evidence tasks.`,
        phase: 'tools',
        stage: 'loop',
      });
      if (RUNTIME_PROGRESSIVE_LOOPS_ENABLED) {
        const nextLoopIndex = Math.max(1, Number(nextPlan.runtime?.continuationDepth || 0) + 1);
        const nextMethodFamily = listToolFamilies(nextPlan.toolCalls).join(', ');
        const nextQueryVariant = pickQueryVariantForLoop(nextPlan.runtime?.queryVariants, nextLoopIndex);
        const nextLane = pickLaneForLoop(nextPlan.runtime?.lanePriority, nextLoopIndex);
        await this.emitEvent({
          branchId: run.branchId,
          agentRunId: run.id,
          type: ProcessEventType.PROCESS_LOG,
          message: `Searching sources (loop ${nextLoopIndex}/${loopState.loopMax})${nextMethodFamily ? `: ${nextMethodFamily}` : ''}.`,
          payload: {
            stage: 'searching',
            loopIndex: nextLoopIndex,
            loopMax: loopState.loopMax,
            ...(docFamily ? { docFamily } : {}),
            ...(nextMethodFamily ? { methodFamily: nextMethodFamily } : {}),
            ...(nextLane ? { lane: nextLane } : {}),
            ...(nextQueryVariant ? { queryVariant: nextQueryVariant } : {}),
            eventV2: {
              version: 2,
              event: 'run.stage_searching',
              phase: 'tools',
              status: 'info',
              runId: run.id,
              createdAt: new Date().toISOString(),
            },
          },
        });
      }

      await this.ensureToolRuns(run.id, nextPlan.toolCalls, policy.maxToolRuns);
      await updateAgentRun(run.id, { status: AgentRunStatus.WAITING_TOOLS });
      await this.executePendingToolRuns(run.id, policy);
      await this.finalizeRun(run.id, policy);
      return;
    }

    await emitProgressiveLoopEvent({
      event: 'run.stage_building',
      message: `Building response from evidence (loop ${loopState.loopIndex}/${loopState.loopMax}).`,
      phase: 'writing',
      stage: 'building',
      extra: {
        methodFamily: currentLoopFamilies.join(', '),
        newEvidenceRefs,
      },
    });
    await this.emitEvent({
      branchId: run.branchId,
      agentRunId: run.id,
      type: ProcessEventType.PROCESS_PROGRESS,
      message: 'Writing final response from collected evidence.',
      payload: {
        phase: 'writing',
        toolCount: toolRuns.length,
      },
    });

    if (await isRunCancelled('writing')) return;
    const promptStageTimeoutMs = isDocumentFocusedRun({ plan, toolRuns })
      ? Math.min(RUNTIME_PROMPT_STAGE_TIMEOUT_MS, 30_000)
      : RUNTIME_PROMPT_STAGE_TIMEOUT_MS;

    const initialWriterOutput = await withTimeout(
      writeClientResponse({
        userMessage: effectiveUserMessage,
        plan,
        policy,
        runtimeContext: runtimeContextSnapshot,
        toolDigest,
        ...(evidenceLedger ? { evidenceLedger } : {}),
        toolResults: promptToolResults,
      }),
      promptStageTimeoutMs,
      'writeClientResponse'
    ).catch(async (error: any) => {
      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_LOG,
        level: ProcessEventLevel.WARN,
        message: `Writer fallback used: ${compactPromptString(error?.message || error, 220)}`,
      });
      return fallbackWriterOutput({
        toolDigest,
        toolResults: promptToolResults,
        plan,
        policy,
        userMessage: effectiveUserMessage,
        runtimeContext: runtimeContextSnapshot,
      });
    });

    const writerQualityGate = applyWriterQualityGate({
      userMessage: effectiveUserMessage,
      response: initialWriterOutput.response,
      toolResults: promptToolResults,
      runtimeContext: runtimeContextSnapshot,
      responseMode: policy.responseMode,
      enforceDeepSections: DEEP_RESPONSE_SECTION_GATE_ENABLED,
    });
    const writerOutput: RuntimeWriterOutput = {
      ...initialWriterOutput,
      response: writerQualityGate.response,
      reasoning: {
        ...initialWriterOutput.reasoning,
        quality: writerQualityGate.quality,
      },
    };

    if (writerOutput.model?.fallbackUsed) {
      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_LOG,
        level: ProcessEventLevel.WARN,
        message: `Chat writer model fallback: ${writerOutput.model.used} (requested ${writerOutput.model.requested})`,
        payload: {
          requestedModel: writerOutput.model.requested,
          usedModel: writerOutput.model.used,
          fallbackUsed: writerOutput.model.fallbackUsed,
          fallbackFrom: writerOutput.model.fallbackFrom || writerOutput.model.requested,
        },
      });
    }

    const qualityRewriteApplied =
      writerQualityGate.quality.intent === 'competitor_brief' &&
      writerOutput.response !== initialWriterOutput.response;
    if (qualityRewriteApplied) {
      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_LOG,
        level: ProcessEventLevel.WARN,
        message: 'Competitor brief quality gate rewrite applied.',
        payload: {
          quality: writerQualityGate.quality,
        },
      });
    }

    if (await isRunCancelled('validation')) return;

    await emitProgressiveLoopEvent({
      event: 'run.stage_validating',
      message: `Validating grounded claims (loop ${loopState.loopIndex}/${loopState.loopMax}).`,
      phase: 'writing',
      stage: 'validation',
      extra: {
        methodFamily: currentLoopFamilies.join(', '),
        newEvidenceRefs,
      },
    });

    const validatorOutput = await withTimeout(
      validateClientResponse({
        userMessage: effectiveUserMessage,
        plan,
        policy,
        writerOutput,
        toolResults: promptToolResults,
      }),
      promptStageTimeoutMs,
      'validateClientResponse'
    ).catch(async (error: any) => {
      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_LOG,
        level: ProcessEventLevel.WARN,
        message: `Validator fallback used: ${compactPromptString(error?.message || error, 220)}`,
      });
      return fallbackValidatorOutput();
    });

    const plannerBlockingDecisions = plan.decisionRequests.filter((decision) => decision.blocking);
    const writerBlockingDecisions = writerOutput.decisions.filter((decision) => decision.blocking);
    const plannerDecisionIds = new Set(plannerBlockingDecisions.map((decision) => decision.id));
    const writerAlignedBlockingDecisions = writerBlockingDecisions.filter((decision) =>
      plannerDecisionIds.has(decision.id)
    );
    const finalDecisions =
      plan.needUserInput || plannerBlockingDecisions.length > 0
        ? mergeBlockingDecisions([plannerBlockingDecisions, writerAlignedBlockingDecisions])
        : [];

    const libraryUpdates = buildLibraryUpdatesSection(
      toolRuns.map((toolRun) => ({
        toolName: toolRun.toolName,
        status: toolRun.status,
        resultJson: toolRun.resultJson,
      }))
    );
    const pinnedLibraryItems = Array.isArray(runtimeContextSnapshot.libraryPinnedItems)
      ? runtimeContextSnapshot.libraryPinnedItems
          .map((item) => (isRecord(item) ? item : null))
          .filter((item): item is Record<string, unknown> => Boolean(item))
      : [];
    const lowTrustPinnedOnly =
      PORTAL_LIBRARY_TRUST_GUARD_ENABLED &&
      Boolean(runtimeContextSnapshot.libraryLowTrustOnly) &&
      pinnedLibraryItems.length > 0;
    const trustedRefsUsed = pinnedLibraryItems
      .filter((item) => {
        const status = String(item.trustStatus || '').toLowerCase();
        return status === 'high' || status === 'medium';
      })
      .map((item) => String(item.libraryRef || '').trim())
      .filter(Boolean)
      .slice(0, 40);
    const lowTrustRefsDeferred = lowTrustPinnedOnly ? pinnedLibraryItems.length : 0;

    const toolFailures = toolRuns.filter(
      (toolRun) => toolRun.status === ToolRunStatus.FAILED || toolRun.status === ToolRunStatus.CANCELLED
    );
    const allToolsFailed = toolRuns.length > 0 && toolFailures.length === toolRuns.length;
    let finalResponseContent = [
      sanitizeClientResponse(writerOutput.response),
      libraryUpdates.hasUpdates ? libraryUpdates.text : '',
    ]
      .filter((section) => String(section || '').trim().length > 0)
      .join('\n\n');
    finalResponseContent = sanitizeClientResponse(finalResponseContent);
    if (runtimeContextSnapshot.researchLoopStalled) {
      const stalledLoops = Math.max(1, Number(runtimeContextSnapshot.researchLoopStalledCount || 0));
      const stalledFamilies = String(runtimeContextSnapshot.researchLoopStalledFamilies || '').trim();
      finalResponseContent = [
        finalResponseContent,
        '## Loop cap reached',
        `I stopped iterative searching after ${stalledLoops} low-improvement loop(s) to avoid repetitive tool churn.`,
        stalledFamilies ? `Methods attempted: ${stalledFamilies}.` : '',
        'Use **Continue deepening** to focus only on missing lanes and weak sections.',
      ]
        .filter((section) => String(section || '').trim().length > 0)
        .join('\n\n');
    }

    if (lowTrustPinnedOnly) {
      const pinnedSummary = pinnedLibraryItems
        .slice(0, 5)
        .map((item, index) => {
          const title = String(item.title || `Pinned source ${index + 1}`).trim();
          const score = Number(item.trustScore || 0);
          return `${index + 1}. ${title} (trust ${(Number.isFinite(score) ? score : 0).toFixed(2)}).`;
        })
        .join('\n');
      finalResponseContent = [
        'I found only low-trust pinned library evidence for this request, so I need your confirmation before making factual claims.',
        'Choose one to continue safely:',
        '1. Approve using these sources as-is.',
        '2. Ask me to fetch fresher supporting evidence first.',
        'Pinned sources:',
        pinnedSummary,
      ]
        .filter(Boolean)
        .join('\n\n');
      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_LOG,
        level: ProcessEventLevel.WARN,
        message: 'Low-trust pinned evidence blocked direct factual synthesis.',
      payload: {
          event: 'LIBRARY_LOW_TRUST_BLOCKED',
          pinnedCount: pinnedLibraryItems.length,
          trustedRefsUsed,
          lowTrustRefsDeferred,
        },
      });
    }

    if ((!finalResponseContent || allToolsFailed) && !lowTrustPinnedOnly) {
      finalResponseContent = buildGroundedFailureResponse({
        contextSnapshot: runtimeContextSnapshot,
      });
      if (libraryUpdates.hasUpdates) {
        finalResponseContent = `${finalResponseContent}\n\n${libraryUpdates.text}`;
      }
    }

    const actionButtons = sanitizeWriterActions(writerOutput.actions, 8);
    const documentArtifact = extractDocumentArtifact(toolResults);
    if (documentArtifact) {
      const artifactDocumentId = String(documentArtifact.documentId || '').trim();
      const artifactDownloadHref = String(documentArtifact.downloadHref || documentArtifact.storagePath || '').trim();
      if (
        artifactDocumentId &&
        !actionButtons.some((action) => {
          const actionKey = String(action.action || '').trim().toLowerCase();
          if (actionKey !== 'document.read') return false;
          const payload = isRecord(action.payload) ? action.payload : {};
          return String(payload.documentId || payload.docId || '').trim() === artifactDocumentId;
        })
      ) {
        actionButtons.unshift({
          label: 'Open in Docs',
          action: 'document.read',
          payload: { documentId: artifactDocumentId },
        });
      }
      if (
        artifactDownloadHref &&
        !actionButtons.some((action) => String(action.action || '').trim().toLowerCase() === 'document.download')
      ) {
        actionButtons.unshift({
          label: 'Download PDF',
          action: 'document.download',
          payload: { storagePath: artifactDownloadHref },
        });
      }
    }
    if (isDocumentFocusedRun({ plan, toolRuns }) && hasPartialDocumentResult(toolResults)) {
      const hasContinueAction = actionButtons.some((action) => {
        if (String(action.action || '').trim().toLowerCase() !== 'document.generate') return false;
        const payload = isRecord(action.payload) ? action.payload : {};
        return (
          payload.continueDeepening === true ||
          (typeof payload.resumeDocumentId === 'string' && payload.resumeDocumentId.trim().length > 0)
        );
      });
      if (!hasContinueAction) {
        const target = extractDocumentRuntimeTarget(toolResults);
        actionButtons.push({
          label: 'Continue Deepening Document',
          action: 'document.generate',
          payload: {
            docType: target.docType || 'BUSINESS_STRATEGY',
            depth: 'deep',
            continueDeepening: true,
            ...(target.runtimeDocumentId ? { resumeDocumentId: target.runtimeDocumentId } : {}),
          },
        });
      }
    }
    if (libraryUpdates.hasUpdates && !actionButtons.some((action) => action.action === 'open_library')) {
      actionButtons.unshift({
        label: 'Open library',
        action: 'open_library',
        ...(libraryUpdates.collection ? { payload: { collection: libraryUpdates.collection } } : {}),
      });
    }
    const persistedActionButtons = sanitizeWriterActions(actionButtons, 8);

    if (await isRunCancelled('response_persist')) return;

    const runtimeEvidenceRefIds = collectRuntimeEvidenceRefIds(toolResults);
    const citationsPayload =
      runtimeEvidenceRefIds.length > 0 || ledgerVersionId
        ? {
            evidenceRefIds: runtimeEvidenceRefIds,
            ...(ledgerVersionId ? { ledgerVersionId } : {}),
            reasoningEvidence: writerOutput.reasoning.evidence,
          }
        : writerOutput.reasoning.evidence;

    const persistedBlocks: Record<string, unknown>[] = [];
    if (documentArtifact) {
      persistedBlocks.push(documentArtifact);
    }
    if (persistedActionButtons.length || finalDecisions.length) {
      persistedBlocks.push({
        type: 'action_buttons',
        actions: persistedActionButtons,
        decisions: finalDecisions,
      });
    }

    await this.persistAssistantMessage({
      branchId: run.branchId,
      content: finalResponseContent,
      blocksJson:
        persistedBlocks.length === 0
          ? undefined
          : persistedBlocks.length === 1
            ? persistedBlocks[0]
            : persistedBlocks,
      reasoningJson: {
        ...writerOutput.reasoning,
        model: writerOutput.model,
        runId: run.id,
        ...(ledgerVersionId ? { ledgerVersionId } : {}),
      },
      citationsJson: citationsPayload,
      clientVisible: true,
      contextSnapshot: runtimeContextSnapshot,
    });

    if (finalDecisions.length > 0) {
      await updateAgentRun(run.id, {
        status: AgentRunStatus.WAITING_USER,
      });

      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.DECISION_REQUIRED,
        level: ProcessEventLevel.WARN,
        message: 'Run produced decisions that require user input.',
        payload: { decisions: finalDecisions },
      });

      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.WAITING_FOR_INPUT,
        message: 'Waiting for user input.',
      });
      await emitProgressiveLoopEvent({
        event: 'run.loop_completed',
        message: `Loop ${loopState.loopIndex}/${loopState.loopMax} paused for decision.`,
        phase: 'tools',
        stage: 'loop',
        level: ProcessEventLevel.WARN,
        extra: {
          pausedForDecision: true,
        },
      });

      await this.dispatchNextQueuedMessage({
        researchJobId: run.branch.thread.researchJobId,
        branchId: run.branchId,
        policy,
        mode: 'interrupt',
      });
      return;
    }

    await updateAgentRun(run.id, {
      status: AgentRunStatus.DONE,
      endedAt: new Date(),
      error: null,
    });

    await this.emitEvent({
      branchId: run.branchId,
      agentRunId: run.id,
      type: ProcessEventType.DONE,
      message: `Run completed: ${toolRuns.length} tool(s) executed.`,
      payload: {
        ...(ledgerVersionId ? { ledgerVersionId } : {}),
        trustedRefsUsed,
        lowTrustRefsDeferred,
        policySummary: buildPolicySummary(policy),
        toolRuns: toolRuns.map((item) => {
          const result = isRecord(item.resultJson) ? item.resultJson : null;
          return {
            id: item.id,
            toolName: item.toolName,
            status: item.status,
            summary: String(result?.summary || '').trim() || undefined,
            artifactCount: Array.isArray(result?.artifacts) ? result.artifacts.length : 0,
            evidenceCount: Array.isArray(result?.evidence) ? result.evidence.length : 0,
            warningCount: Array.isArray(result?.warnings) ? result.warnings.length : 0,
          };
        }),
        validation: validatorOutput,
      },
    });
    await emitProgressiveLoopEvent({
      event: 'run.loop_completed',
      message: `Loop ${loopState.loopIndex}/${loopState.loopMax} completed.`,
      phase: 'completed',
      stage: 'loop',
      extra: {
        validationPass: validatorOutput.pass,
      },
    });

    await this.dispatchNextQueuedMessage({
      researchJobId: run.branch.thread.researchJobId,
      branchId: run.branchId,
      policy,
      mode: 'send',
    });
  }

  async executeRun(runId: string) {
    const run = await getAgentRun(runId);
    if (!run) return;

    await this.withBranchLock(run.branchId, async () => {
      const fresh = await getAgentRun(runId);
      if (!fresh) return;
      if (fresh.status === AgentRunStatus.CANCELLED || fresh.status === AgentRunStatus.DONE) return;

      const policy = normalizePolicy(
        isRecord(fresh.policyJson) ? (fresh.policyJson as Partial<RunPolicy>) : undefined,
        isRecord(fresh.inputOptionsJson) ? (fresh.inputOptionsJson as RuntimeInputOptions) : undefined
      );
      const triggerMessageRaw = fresh.triggerMessage?.content || 'Continue workflow';
      const triggerBlocksRaw = (fresh.triggerMessage as any)?.blocksJson;
      const triggerCitationsRaw = (fresh.triggerMessage as any)?.citationsJson;
      const triggerViralStudioBlocks = normalizeRuntimeViralStudioBlocks(triggerBlocksRaw);
      const triggerCitations = normalizeRuntimeUserCitations(triggerCitationsRaw, 16);
      const viralStudioHint = buildViralStudioTriggerHint(triggerViralStudioBlocks, triggerCitations);
      const viralStudioSnapshot = buildViralStudioRuntimeSnapshot(triggerViralStudioBlocks, triggerCitations);
      const triggerAttachmentIds = normalizeDocumentIds([
        ...normalizeIdList((fresh.triggerMessage as any)?.attachmentIdsJson),
        ...normalizeIdList((fresh as any).attachmentIdsJson),
      ]);
      const triggerDocumentIds = await hydrateDocumentIdsFromMessageInput({
        researchJobId: fresh.branch.thread.researchJobId,
        documentIds: [
          ...normalizeIdList((fresh.triggerMessage as any)?.documentIdsJson),
          ...normalizeIdList((fresh as any).documentIdsJson),
        ],
        attachmentIds: triggerAttachmentIds,
      });
      const documentGroundingHint = triggerDocumentIds.length
        ? await buildDocumentGroundingHint({
            researchJobId: fresh.branch.thread.researchJobId,
            documentIds: triggerDocumentIds,
          })
        : '';
      let triggerMessageForPlanning = documentGroundingHint
        ? `${triggerMessageRaw}\n\n${documentGroundingHint}`
        : triggerMessageRaw;
      if (viralStudioHint) {
        triggerMessageForPlanning = `${triggerMessageForPlanning}\n\n${viralStudioHint}`;
      }

      if (!fresh.startedAt) {
        await updateAgentRun(fresh.id, {
          startedAt: new Date(),
        });
      }

      let plan = normalizeRunPlan(fresh.planJson);
      let runtimeContextSnapshot =
        isRecord(plan?.runtime?.contextSnapshot) ? (plan?.runtime?.contextSnapshot as Record<string, unknown>) : null;

      if (!runtimeContextSnapshot) {
        try {
          const runtimeContext = await buildRuntimeAgentContext({
            researchJobId: fresh.branch.thread.researchJobId,
            branchId: fresh.branchId,
            syntheticSessionId: `runtime-${fresh.branchId}`,
            userMessage: triggerMessageForPlanning,
            runId: fresh.id,
            actor: {
              role: 'system',
            },
          });
          runtimeContextSnapshot = buildRuntimeContextSnapshot(runtimeContext);

          await this.emitEvent({
            branchId: fresh.branchId,
            agentRunId: fresh.id,
            type: ProcessEventType.PROCESS_LOG,
            message: 'Runtime context loaded for grounding.',
            payload: {
              event: 'run.context.loaded',
              competitorsCount: Number(runtimeContextSnapshot.competitorsCount || 0),
              candidateCompetitorsCount: Number(runtimeContextSnapshot.candidateCompetitorsCount || 0),
              webSnapshotsCount: Number(runtimeContextSnapshot.webSnapshotsCount || 0),
              pendingDecisionsCount: Number(runtimeContextSnapshot.pendingDecisionsCount || 0),
            },
          });
        } catch (error) {
          const fallbackSnapshot = await loadFallbackRuntimeContextSnapshot(fresh.branch.thread.researchJobId).catch(
            () => ({})
          );
          runtimeContextSnapshot = isRecord(fallbackSnapshot) ? fallbackSnapshot : {};
          await this.emitEvent({
            branchId: fresh.branchId,
            agentRunId: fresh.id,
            type: ProcessEventType.PROCESS_LOG,
            level: ProcessEventLevel.WARN,
            message: `Failed to load runtime context; using fallback snapshot: ${compactPromptString((error as Error)?.message || error, 200)}`,
            payload: {
              event: 'run.context.loaded',
              fallback: true,
              competitorsCount: Number(runtimeContextSnapshot.competitorsCount || 0),
              candidateCompetitorsCount: Number(runtimeContextSnapshot.candidateCompetitorsCount || 0),
              webSnapshotsCount: Number(runtimeContextSnapshot.webSnapshotsCount || 0),
              pendingDecisionsCount: Number(runtimeContextSnapshot.pendingDecisionsCount || 0),
            },
          });
        }
      }

      if (Object.keys(viralStudioSnapshot).length > 0) {
        runtimeContextSnapshot = {
          ...(runtimeContextSnapshot || {}),
          ...viralStudioSnapshot,
        };
      }

      try {
        const workspaceMemory = await readWorkspaceMemoryContext({
          researchJobId: fresh.branch.thread.researchJobId,
          branchId: fresh.branchId,
          limitPerScope: 12,
        });
        const memoryContext = flattenMemoryForRuntimeContext({
          byScope: workspaceMemory.byScope,
        });
        runtimeContextSnapshot = {
          ...(runtimeContextSnapshot || {}),
          ...memoryContext,
        };
        await this.emitEvent({
          branchId: fresh.branchId,
          agentRunId: fresh.id,
          type: ProcessEventType.PROCESS_LOG,
          message: 'Workspace memory loaded for routing and planning.',
          payload: {
            event: 'run.memory.loaded',
            scopeCounts: {
              workspace_profile: Object.keys(workspaceMemory.byScope.workspace_profile || {}).length,
              deliverable_preferences: Object.keys(workspaceMemory.byScope.deliverable_preferences || {}).length,
              approved_decisions: Object.keys(workspaceMemory.byScope.approved_decisions || {}).length,
              family_defaults: Object.keys(workspaceMemory.byScope.family_defaults || {}).length,
              quality_history: Object.keys(workspaceMemory.byScope.quality_history || {}).length,
            },
          },
        });
      } catch (memoryError) {
        await this.emitEvent({
          branchId: fresh.branchId,
          agentRunId: fresh.id,
          type: ProcessEventType.PROCESS_LOG,
          level: ProcessEventLevel.WARN,
          message: `Workspace memory load failed: ${compactPromptString((memoryError as Error)?.message || memoryError, 160)}`,
          payload: {
            event: 'run.memory.load_failed',
          },
        });
      }

      const pinnedLibraryRefs = mergeLibraryRefs(
        normalizeIdList((fresh.inputOptionsJson as any)?.libraryRefs),
        extractLibraryRefsFromText(triggerMessageRaw),
        extractLibraryRefsFromRuntimeCitations(triggerCitationsRaw),
        extractLibraryRefsFromRuntimeViralBlocks(triggerBlocksRaw)
      );
      if (pinnedLibraryRefs.length > 0) {
        const resolvedRefs = await resolvePortalWorkspaceLibraryRefs(
          fresh.branch.thread.researchJobId,
          pinnedLibraryRefs
        );
        const pinnedItems = resolvedRefs.items.slice(0, 12).map((item) => ({
          libraryRef: item.libraryRef || item.id,
          title: item.title,
          collection: item.collection,
          trustStatus: item.trustStatus || 'low',
          trustScore: typeof item.trustScore === 'number' ? item.trustScore : 0,
          summary: item.summary,
          evidenceHref: item.evidenceHref || undefined,
        }));
        const hasTrustedPinnedItems = pinnedItems.some((item) => item.trustStatus === 'high' || item.trustStatus === 'medium');
        runtimeContextSnapshot = {
          ...(runtimeContextSnapshot || {}),
          libraryPinnedRefs: pinnedItems.map((item) => item.libraryRef),
          libraryPinnedItems: pinnedItems,
          libraryPinnedTrustMode: 'balanced',
          libraryLowTrustOnly: pinnedItems.length > 0 && !hasTrustedPinnedItems,
        };

        if (pinnedItems.length > 0) {
          const hintLines = pinnedItems.map((item, index) => {
            const trust = String(item.trustStatus || 'low').toUpperCase();
            const score = Number(item.trustScore || 0).toFixed(2);
            return `${index + 1}. [${trust} ${score}] ${item.title}: ${item.summary}`;
          });
          triggerMessageForPlanning = `${triggerMessageForPlanning}\n\nPinned library evidence (use these refs first):\n${hintLines.join('\n')}`;
        }

        await this.emitEvent({
          branchId: fresh.branchId,
          agentRunId: fresh.id,
          type: ProcessEventType.PROCESS_LOG,
          message: `Resolved ${resolvedRefs.items.length}/${pinnedLibraryRefs.length} pinned library references.`,
          payload: {
            event: 'LIBRARY_REF_RESOLVED',
            requestedRefs: pinnedLibraryRefs.length,
            resolvedRefs: resolvedRefs.items.length,
            unresolvedRefs: resolvedRefs.unresolvedRefs.length,
          },
        });

        if (resolvedRefs.unresolvedRefs.length > 0) {
          await this.emitEvent({
            branchId: fresh.branchId,
            agentRunId: fresh.id,
            type: ProcessEventType.PROCESS_LOG,
            level: ProcessEventLevel.WARN,
            message: 'Some pinned library references were not found in this workspace and were skipped.',
            payload: {
              event: 'LIBRARY_HEURISTIC_BLOCKED',
              unresolvedRefs: resolvedRefs.unresolvedRefs.slice(0, 20),
            },
          });
        }
      }

      const preGuardIntent = routeRuntimeIntent({
        userMessage: triggerMessageForPlanning,
        ...(runtimeContextSnapshot ? { runtimeContext: runtimeContextSnapshot } : {}),
      });

      if (
        PORTAL_LIBRARY_TRUST_GUARD_ENABLED &&
        pinnedLibraryRefs.length === 0 &&
        requestsExplicitLibraryGrounding(triggerMessageRaw) &&
        preGuardIntent.intent !== 'document_request'
      ) {
        const librarySnapshot = await listPortalWorkspaceLibrary(fresh.branch.thread.researchJobId, {
          version: 'v2',
          limit: 80,
        }).catch(() => ({ items: [], counts: { web: 0, competitors: 0, social: 0, community: 0, news: 0, deliverables: 0 } }));
        const candidateRefs = (Array.isArray(librarySnapshot.items) ? librarySnapshot.items : [])
          .filter((item) => (item.trustStatus || 'low') !== 'low')
          .slice(0, 8);
        if (candidateRefs.length > 0) {
          const candidateLines = candidateRefs
            .map((item, index) => `${index + 1}. @libraryRef[${item.libraryRef || item.id}|${item.title}]`)
            .join('\n');
          const guidance = [
            'Before I make factual claims, please pin the exact library evidence you want me to use.',
            'Reply by copying 1-3 refs from this list (or click "Use in answer" in Library):',
            candidateLines,
          ].join('\n\n');
          await this.persistAssistantMessage({
            branchId: fresh.branchId,
            content: guidance,
            reasoningJson: {
              plan: ['Resolve explicit library refs before synthesis.'],
              tools: ['portal.library.resolve_refs'],
              assumptions: ['No explicit trusted refs were provided in this message.'],
              nextSteps: ['Select the refs to ground the next answer.'],
              evidence: candidateRefs.map((item) => ({
                id: String(item.libraryRef || item.id || ''),
                label: item.title,
                ...(item.evidenceHref ? { url: item.evidenceHref } : {}),
              })),
              runId: fresh.id,
            },
            clientVisible: true,
            contextSnapshot: runtimeContextSnapshot || {},
          });

          await updateAgentRun(fresh.id, {
            status: AgentRunStatus.DONE,
            endedAt: new Date(),
            error: null,
          });

          await this.emitEvent({
            branchId: fresh.branchId,
            agentRunId: fresh.id,
            type: ProcessEventType.DONE,
            message: 'Run paused until explicit library refs are selected.',
            payload: {
              trustedRefsUsed: [],
              lowTrustRefsDeferred: 0,
              policySummary: buildPolicySummary(policy),
              candidateRefsOffered: candidateRefs.length,
            },
          });

          await this.dispatchNextQueuedMessage({
            researchJobId: fresh.branch.thread.researchJobId,
            branchId: fresh.branchId,
            policy,
            mode: 'send',
          });
          return;
        }
      }

      if (plan && runtimeContextSnapshot && !isRecord(plan.runtime?.contextSnapshot)) {
        plan = {
          ...plan,
          runtime: {
            ...(isRecord(plan.runtime) ? plan.runtime : {}),
            continuationDepth: plan.runtime?.continuationDepth ?? 0,
            contextSnapshot: runtimeContextSnapshot,
          },
        };
        await updateAgentRun(fresh.id, { plan });
      }

      const routedIntent = preGuardIntent;
      if (routedIntent.docFamily) {
        await this.emitEvent({
          branchId: fresh.branchId,
          agentRunId: fresh.id,
          type: ProcessEventType.PROCESS_LOG,
          message: `Intent routed to ${routedIntent.docFamily}.`,
          payload: {
            stage: 'intent',
            intent: routedIntent.intent,
            docFamily: routedIntent.docFamily,
            businessArchetype: routedIntent.businessArchetype,
            requiredEvidenceLanes: routedIntent.requiredEvidenceLanes,
            requiredClarifications: routedIntent.requiredClarifications,
            eventV2: {
              version: 2,
              event: 'document.intent_routed',
              phase: 'planning',
              status: 'info',
              runId: fresh.id,
              createdAt: new Date().toISOString(),
            },
          },
        });
      }

      if (!plan) {
        await this.emitEvent({
          branchId: fresh.branchId,
          agentRunId: fresh.id,
          type: ProcessEventType.PROCESS_PROGRESS,
          message: 'Planning run execution.',
          payload: {
            phase: 'planning',
          },
        });

        const previousMessages = await listBranchMessages(fresh.branchId, 40);
        plan = await generatePlannerPlan({
          researchJobId: fresh.branch.thread.researchJobId,
          branchId: fresh.branchId,
          userMessage: triggerMessageForPlanning,
          ...(runtimeContextSnapshot ? { runtimeContext: runtimeContextSnapshot } : {}),
          policy,
          previousMessages: previousMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        });

        if (runtimeContextSnapshot) {
          plan = {
            ...plan,
            runtime: {
              ...(isRecord(plan.runtime) ? plan.runtime : {}),
              continuationDepth: plan.runtime?.continuationDepth ?? 0,
              contextSnapshot: runtimeContextSnapshot,
            },
          };
        }
        await updateAgentRun(fresh.id, { plan });
      }

      const triggerContent = triggerMessageForPlanning;
      let sanitizedToolCalls = sanitizeToolCalls(plan.toolCalls, triggerContent, policy.maxToolRuns);
      if (
        sanitizedToolCalls.length === 0 &&
        shouldForceDiscoveryTools({ triggerType: fresh.triggerType, userMessage: triggerContent })
      ) {
        sanitizedToolCalls = buildFallbackDiscoveryToolCalls(triggerContent, policy.maxToolRuns);
      }
      const enrichmentInjection = maybeInjectDocumentEnrichmentToolCalls({
        toolCalls: sanitizedToolCalls,
        triggerMessage: triggerContent,
        ...(runtimeContextSnapshot ? { runtimeContextSnapshot } : {}),
        maxToolRuns: policy.maxToolRuns,
      });
      sanitizedToolCalls = enrichmentInjection.toolCalls;

      if (runtimeContextSnapshot && enrichmentInjection.coverage) {
        runtimeContextSnapshot = {
          ...runtimeContextSnapshot,
          previousDocumentCoverageScore: Number(runtimeContextSnapshot.documentCoverageScore || 0) || 0,
          documentCoverageScore: enrichmentInjection.coverage.score,
          documentCoverageCounts: enrichmentInjection.coverage.counts,
          documentCoverageTargets: enrichmentInjection.coverage.targets,
          documentCoverageReasons: enrichmentInjection.coverage.reasons,
          documentEnrichmentApplied: enrichmentInjection.enrichmentApplied,
          documentEnrichmentCompleted: false,
          ...(enrichmentInjection.enrichmentApplied
            ? { documentEnrichmentTools: enrichmentInjection.addedTools }
            : {}),
        };
      }

      const sourceScopeEnforcement = enforceToolSourceScope({
        toolCalls: sanitizedToolCalls,
        policy,
        ...(runtimeContextSnapshot ? { runtimeContextSnapshot } : {}),
        maxToolRuns: policy.maxToolRuns,
      });
      sanitizedToolCalls = sourceScopeEnforcement.toolCalls;
      const plannedPreferredFamilies = preferredFamiliesFromLanePriority(plan.runtime?.lanePriority);

      const hasDocumentGenerateCall = sanitizedToolCalls.some(
        (call) => String(call.tool || '').trim().toLowerCase() === 'document.generate'
      );
      if (routedIntent.intent === 'document_request' && !hasDocumentGenerateCall) {
        const inferredDocType =
          routedIntent.docFamily === 'SWOT'
            ? 'SWOT'
            : routedIntent.docFamily === 'PLAYBOOK'
              ? 'PLAYBOOK'
              : routedIntent.docFamily === 'COMPETITOR_AUDIT'
                ? 'COMPETITOR_AUDIT'
                : routedIntent.docFamily === 'CONTENT_CALENDAR'
                  ? 'CONTENT_CALENDAR'
                  : routedIntent.docFamily === 'GO_TO_MARKET'
                    ? 'GO_TO_MARKET'
                    : 'BUSINESS_STRATEGY';
        sanitizedToolCalls = [
          ...sanitizedToolCalls.slice(0, Math.max(0, policy.maxToolRuns - 1)),
          {
            tool: 'document.generate',
            args: {
              docType: inferredDocType,
              depth: 'deep',
              includeCompetitors: true,
              includeEvidenceLinks: true,
              requestedIntent:
                inferredDocType === 'SWOT'
                  ? 'swot_analysis'
                  : inferredDocType === 'PLAYBOOK'
                    ? 'playbook'
                    : inferredDocType === 'COMPETITOR_AUDIT'
                      ? 'competitor_audit'
                      : inferredDocType === 'CONTENT_CALENDAR'
                        ? 'content_calendar'
                        : inferredDocType === 'GO_TO_MARKET'
                          ? 'go_to_market'
                          : 'business_strategy',
            },
          },
        ];
        await this.emitEvent({
          branchId: fresh.branchId,
          agentRunId: fresh.id,
          type: ProcessEventType.PROCESS_LOG,
          message: 'Autopilot routed this request to document generation.',
          payload: {
            stage: 'intent',
            docFamily: routedIntent.docFamily || 'BUSINESS_STRATEGY',
            autopilotInjected: true,
          },
        });
      }

      const initialDiversity = enforceToolFamilyDiversity({
        toolCalls: sanitizedToolCalls,
        policy,
        userMessage: triggerContent,
        ...(runtimeContextSnapshot ? { runtimeContextSnapshot } : {}),
        maxToolRuns: policy.maxToolRuns,
        ...(plannedPreferredFamilies.length ? { preferredFamilies: plannedPreferredFamilies } : {}),
      });
      sanitizedToolCalls = initialDiversity.toolCalls;
      if (initialDiversity.addedFamilies.length > 0) {
        await this.emitEvent({
          branchId: fresh.branchId,
          agentRunId: fresh.id,
          type: ProcessEventType.PROCESS_LOG,
          message: `Expanded exploration methods: ${initialDiversity.addedFamilies.join(', ')}.`,
          payload: {
            stage: 'searching',
            methodFamily: initialDiversity.familiesUsed.join(', '),
            addedFamilies: initialDiversity.addedFamilies,
            docFamily: routedIntent.docFamily || undefined,
            eventV2: {
              version: 2,
              event: 'run.stage_searching',
              phase: 'tools',
              status: 'info',
              runId: fresh.id,
              createdAt: new Date().toISOString(),
            },
          },
        });
      }

      if (sourceScopeEnforcement.blocked.length > 0) {
        for (const blocked of sourceScopeEnforcement.blocked) {
          await this.emitEvent({
            branchId: fresh.branchId,
            agentRunId: fresh.id,
            type: ProcessEventType.PROCESS_LOG,
            level: ProcessEventLevel.WARN,
            message: blocked.reason,
            payload: {
              event: 'CHAT_SOURCE_SCOPE_BLOCKED_TOOL',
              blockedTool: blocked.tool,
              sourceLane: blocked.lane,
              ...(blocked.fallbackTool
                ? {
                    fallbackTool: blocked.fallbackTool.tool,
                    fallbackArgs: blocked.fallbackTool.args,
                  }
                : {}),
              policySummary: buildPolicySummary(policy),
            },
          });
        }
      }

      if (
        enrichmentInjection.enrichmentApplied &&
        runtimeContextSnapshot &&
        runtimeContextSnapshot.documentEnrichmentApplied &&
        !runtimeContextSnapshot.documentEnrichmentStartedAt
      ) {
        runtimeContextSnapshot = {
          ...runtimeContextSnapshot,
          documentEnrichmentStartedAt: new Date().toISOString(),
        };
        await this.emitEvent({
          branchId: fresh.branchId,
          agentRunId: fresh.id,
          type: ProcessEventType.PROCESS_LOG,
          message: 'Evidence is thin for deep document generation; running bounded enrichment first.',
          payload: {
            coverageScore: enrichmentInjection.coverage?.score || null,
            coverageCounts: enrichmentInjection.coverage?.counts || null,
            reasons: enrichmentInjection.coverage?.reasons || [],
            enrichmentTools: enrichmentInjection.addedTools,
            toolName: 'document.generate',
            eventV2: {
              version: 2,
              event: 'document.enrichment_started',
              phase: 'tools',
              status: 'info',
              runId: fresh.id,
              toolName: 'document.generate',
              createdAt: new Date().toISOString(),
            },
          },
        });
      }

      const shouldPersistPlan =
        JSON.stringify(plan.toolCalls) !== JSON.stringify(sanitizedToolCalls) ||
        Boolean(
          runtimeContextSnapshot &&
            enrichmentInjection.coverage &&
            JSON.stringify(plan.runtime?.contextSnapshot || {}) !== JSON.stringify(runtimeContextSnapshot || {})
        );
      if (shouldPersistPlan) {
        plan = {
          ...plan,
          toolCalls: sanitizedToolCalls,
          ...(runtimeContextSnapshot
            ? {
                runtime: {
                  ...(isRecord(plan.runtime) ? plan.runtime : {}),
                  continuationDepth: plan.runtime?.continuationDepth ?? 0,
                  contextSnapshot: runtimeContextSnapshot,
                },
              }
            : {}),
        };
        await updateAgentRun(fresh.id, { plan });
      }

      await updateAgentRun(fresh.id, {
        status: AgentRunStatus.RUNNING,
      });

      await this.emitEvent({
        branchId: fresh.branchId,
        agentRunId: fresh.id,
        type: ProcessEventType.PROCESS_LOG,
        message: 'Planning complete. Executing tool runs.',
        payload: {
          goal: plan.goal,
          plan: plan.plan,
          toolCalls: plan.toolCalls,
          policySummary: buildPolicySummary(policy),
        },
      });

      if (RUNTIME_PROGRESSIVE_LOOPS_ENABLED) {
        const loopIndex = Math.max(1, Number(plan.runtime?.continuationDepth || 0) + 1);
        const loopMax = Math.max(loopIndex, Number(policy.maxAutoContinuations || 0) + 1);
        const docFamily = resolveDocFamilyFromPlan(plan);
        const methodFamily = listToolFamilies(plan.toolCalls).join(', ');
        const lane = pickLaneForLoop(plan.runtime?.lanePriority, loopIndex);
        const queryVariant = pickQueryVariantForLoop(plan.runtime?.queryVariants, loopIndex);
        await this.emitEvent({
          branchId: fresh.branchId,
          agentRunId: fresh.id,
          type: ProcessEventType.PROCESS_LOG,
          message: `Searching sources (loop ${loopIndex}/${loopMax})${methodFamily ? `: ${methodFamily}` : ''}.`,
          payload: {
            stage: 'searching',
            loopIndex,
            loopMax,
            ...(docFamily ? { docFamily } : {}),
            ...(methodFamily ? { methodFamily } : {}),
            ...(lane ? { lane } : {}),
            ...(queryVariant ? { queryVariant } : {}),
            eventV2: {
              version: 2,
              event: 'run.stage_searching',
              phase: 'tools',
              status: 'info',
              runId: fresh.id,
              createdAt: new Date().toISOString(),
            },
          },
        });
      }

      await this.ensureToolRuns(fresh.id, plan.toolCalls, policy.maxToolRuns);

      const pending = (await listToolRuns(fresh.id)).filter((item) => item.status === ToolRunStatus.QUEUED);
      if (pending.length === 0) {
        await this.finalizeRun(fresh.id, policy);
        return;
      }

      await updateAgentRun(fresh.id, {
        status: AgentRunStatus.WAITING_TOOLS,
      });

      await this.executePendingToolRuns(fresh.id, policy);
      await this.finalizeRun(fresh.id, policy);
    });
  }

  async getBranchState(input: { researchJobId: string; branchId: string }) {
    const branch = await getBranch(input.branchId, input.researchJobId);
    if (!branch) throw new Error('Branch not found for this research job');
    await this.scheduleStaleActiveRunRecovery(input.branchId);
    const activeRuns = await listActiveRuns(input.branchId);
    return {
      branch,
      activeRunStatuses: runtimeEnums.ACTIVE_RUN_STATUSES,
      activeRuns,
    };
  }

  async bootstrapBranch(input: {
    researchJobId: string;
    branchId: string;
    policy?: Partial<RunPolicy>;
    initiatedBy?: string;
  }): Promise<{ started: boolean; runId?: string; reason?: string }> {
    const branch = await getBranch(input.branchId, input.researchJobId);
    if (!branch) {
      throw new Error('Branch not found for this research job');
    }

    const activeRuns = await listActiveRuns(input.branchId);
    if (activeRuns.length > 0) {
      return { started: false, reason: 'active_run' };
    }

    const existingMessages = await listBranchMessages(input.branchId, 80);
    const hasClientConversation = existingMessages.some(
      (message) =>
        message.clientVisible !== false &&
        (message.role === ChatBranchMessageRole.USER || message.role === ChatBranchMessageRole.ASSISTANT)
    );
    if (hasClientConversation) {
      return { started: false, reason: 'already_initialized' };
    }

    const workspace = await prisma.researchJob.findUnique({
      where: { id: input.researchJobId },
      select: {
        inputData: true,
        client: { select: { name: true } },
      },
    });
    const websites = extractWorkspaceWebsites(workspace?.inputData);
    const bootstrapContent = buildBootstrapPrompt({
      brandName: workspace?.client?.name || null,
      websites,
    });

    const policy = normalizePolicy(input.policy);
    const bootstrapMessage = await createBranchMessage({
      branchId: input.branchId,
      role: ChatBranchMessageRole.SYSTEM,
      content: bootstrapContent,
      clientVisible: false,
    });

    const run = await createAgentRun({
      branchId: input.branchId,
      triggerType: AgentRunTriggerType.SCHEDULED_LOOP,
      triggerMessageId: bootstrapMessage.id,
      policy,
    });

    await this.emitEvent({
      branchId: input.branchId,
      type: ProcessEventType.PROCESS_STARTED,
      agentRunId: run.id,
      message: 'BAT kickoff started for this workspace.',
      payload: {
        triggerType: run.triggerType,
        triggerMessageId: bootstrapMessage.id,
        initiatedBy: String(input.initiatedBy || 'system').trim() || 'system',
      },
    });

    void this.executeRun(run.id).catch((error) => {
      console.error('[RuntimeRunEngine] bootstrap executeRun failed:', error);
      void this.handleRunFailure({
        runId: run.id,
        branchId: input.branchId,
        message: 'Workspace kickoff run failed unexpectedly.',
        error,
      });
    });

    return { started: true, runId: run.id };
  }
}

export const runtimeRunEngine = new RuntimeRunEngine();

export const __testOnlyRuntimeLoop = {
  toolFamilyForTool,
  listToolFamilies,
  listAvailableToolFamilies,
  requiredFamilyCount,
  enforceToolFamilyDiversity,
  preferredFamiliesFromLanePriority,
  countConsecutiveLowDeltaLoops,
  chooseAlternateFamiliesForStall,
  pickQueryVariantForLoop,
  pickLaneForLoop,
};
