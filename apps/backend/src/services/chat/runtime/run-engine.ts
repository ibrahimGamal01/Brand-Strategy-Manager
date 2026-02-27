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
  popNextQueuedMessage,
  runtimeEnums,
  updateAgentRun,
  updateToolRun,
} from './repository';
import { executeToolWithContract } from './tool-contract';
import {
  generatePlannerPlan,
  summarizeToolResults,
  validateClientResponse,
  writeClientResponse,
} from './prompt-suite';
import type { RunPolicy, RuntimeDecision, RuntimePlan, RuntimeToolCall, RuntimeToolResult, SendMessageMode } from './types';
import { TOOL_REGISTRY } from '../../ai/chat/tools/tool-registry';

type SendMessageInput = {
  researchJobId: string;
  branchId: string;
  userId: string;
  content: string;
  mode?: SendMessageMode;
  policy?: Partial<RunPolicy>;
};

type SendMessageResult = {
  branchId: string;
  queued: boolean;
  queueItemId?: string;
  runId?: string;
  userMessageId?: string;
};

const DEFAULT_POLICY: RunPolicy = {
  autoContinue: true,
  maxAutoContinuations: 1,
  maxToolRuns: 4,
  toolConcurrency: 3,
  allowMutationTools: false,
  maxToolMs: 30_000,
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
  rundeepresearch: { tool: 'research.gather', args: { depth: 'deep', includeScrapling: true, includeAccountContext: true } },
  deepresearch: { tool: 'research.gather', args: { depth: 'deep', includeScrapling: true, includeAccountContext: true } },
  ddgsearch: { tool: 'research.gather', args: { depth: 'standard', includeScrapling: false, includeAccountContext: true } },
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
  opportunitysummarizer: {
    tool: 'document.plan',
    args: {
      docType: 'STRATEGY_BRIEF',
      depth: 'standard',
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
  ? Math.max(5_000, Math.min(120_000, Math.floor(Number(process.env.RUNTIME_PROMPT_STAGE_TIMEOUT_MS))))
  : 30_000;
const MAX_PROMPT_TOOL_RESULTS = 12;
const MAX_PROMPT_ARRAY_ITEMS = 10;
const MAX_PROMPT_OBJECT_KEYS = 18;
const MAX_PROMPT_STRING_CHARS = 320;
const SCHEDULED_RUN_PREEMPTION_ENABLED = String(process.env.RUNTIME_PREEMPT_SCHEDULED_RUNS || 'true')
  .trim()
  .toLowerCase() !== 'false';

export function normalizePolicy(raw?: Partial<RunPolicy> | null): RunPolicy {
  const policy = {
    ...DEFAULT_POLICY,
    ...(raw || {}),
  };

  const maxAutoContinuationsRaw = Number(policy.maxAutoContinuations);
  const maxToolRunsRaw = Number(policy.maxToolRuns);
  const toolConcurrencyRaw = Number(policy.toolConcurrency);
  const maxToolMsRaw = Number(policy.maxToolMs);

  return {
    autoContinue: Boolean(policy.autoContinue),
    maxAutoContinuations: Number.isFinite(maxAutoContinuationsRaw)
      ? Math.max(0, Math.min(4, Math.floor(maxAutoContinuationsRaw)))
      : DEFAULT_POLICY.maxAutoContinuations,
    maxToolRuns: Number.isFinite(maxToolRunsRaw)
      ? Math.max(1, Math.min(8, Math.floor(maxToolRunsRaw)))
      : DEFAULT_POLICY.maxToolRuns,
    toolConcurrency: Number.isFinite(toolConcurrencyRaw)
      ? Math.max(1, Math.min(3, Math.floor(toolConcurrencyRaw)))
      : DEFAULT_POLICY.toolConcurrency,
    allowMutationTools: Boolean(policy.allowMutationTools),
    maxToolMs: Number.isFinite(maxToolMsRaw)
      ? Math.max(1_000, Math.min(180_000, Math.floor(maxToolMsRaw)))
      : DEFAULT_POLICY.maxToolMs,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

type RuntimeToolSummary = Awaited<ReturnType<typeof summarizeToolResults>>;
type RuntimeWriterOutput = Awaited<ReturnType<typeof writeClientResponse>>;
type RuntimeValidatorOutput = Awaited<ReturnType<typeof validateClientResponse>>;

function fallbackToolSummary(toolResults: RuntimeToolResult[]): RuntimeToolSummary {
  return {
    highlights: toolResults.slice(0, 6).map((result) => compactPromptString(result.summary, 220)).filter(Boolean),
    facts: toolResults
      .flatMap((result) =>
        result.evidence.slice(0, 2).map((evidence) => ({
          claim: compactPromptString(result.summary, 220),
          evidence: [compactPromptString(evidence.label, 220)].filter(Boolean),
        }))
      )
      .slice(0, 10)
      .filter((item) => item.claim),
    openQuestions: [],
    recommendedContinuations: toolResults
      .flatMap((result) => result.continuations)
      .flatMap((entry) => entry.suggestedNextTools || [])
      .map((tool) => compactPromptString(tool, 80))
      .filter(Boolean)
      .slice(0, 8),
  };
}

function fallbackWriterOutput(input: {
  toolSummary: RuntimeToolSummary;
  toolResults: RuntimeToolResult[];
  plan: RuntimePlan;
}): RuntimeWriterOutput {
  const highlights = input.toolSummary.highlights.filter(Boolean).slice(0, 3);
  const response = highlights.length
    ? `${highlights[0]}\n\n${highlights
        .slice(1)
        .map((item, index) => `${index + 1}. ${item}`)
        .join('\n')}`
    : 'I reviewed the available workspace evidence and compiled the latest findings.';

  return {
    response,
    reasoning: {
      plan: input.plan.plan.slice(0, 8),
      tools: input.plan.toolCalls.map((entry) => entry.tool).slice(0, 8),
      assumptions: ['This response uses the most recent tool outputs available in this run.'],
      nextSteps: ['Confirm whether to continue with a deeper pass on the same evidence.'],
      evidence: input.toolResults
        .flatMap((result) => result.evidence)
        .slice(0, 8)
        .map((entry, index) => ({
          id: `e-${index + 1}`,
          label: compactPromptString(entry.label, 220),
          ...(entry.url ? { url: compactPromptString(entry.url, 260) } : {}),
        })),
    },
    actions: [],
    decisions: [],
  };
}

function fallbackValidatorOutput(): RuntimeValidatorOutput {
  return {
    pass: true,
    issues: [],
    suggestedFixes: [],
  };
}

function normalizeToolAliasKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
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

function extractLibraryMentions(message: string): Array<{ id: string; title: string }> {
  const raw = String(message || '');
  const mentions: Array<{ id: string; title: string }> = [];
  const matcher = /@library\[([^\]|]+)\|([^\]]+)\]/gi;
  let current = matcher.exec(raw);
  while (current) {
    const id = String(current[1] || '').trim();
    const title = String(current[2] || '').trim();
    if (id && title) {
      mentions.push({ id, title });
    }
    current = matcher.exec(raw);
  }
  return mentions;
}

function withLibraryMentionHints(message: string): string {
  const mentions = extractLibraryMentions(message);
  if (!mentions.length) return message;
  const hints = mentions.map((entry) => `Use evidence from: ${entry.title}`).join('\n');
  return `${message}\n${hints}`;
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

function shouldIncludeOperationalTrace(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return (
    /\b(tool execution trace|execution trace|run trace|validation note|debug log|debug info|internal trace)\b/.test(
      normalized
    ) || /\bshow\b.*\btrace\b/.test(normalized)
  );
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

  if (tool === 'document.plan') {
    if (!String(normalized.docType || '').trim()) normalized.docType = 'STRATEGY_BRIEF';
    if (!String(normalized.depth || '').trim()) normalized.depth = 'standard';
    if (typeof normalized.includeCompetitors !== 'boolean') normalized.includeCompetitors = true;
    if (typeof normalized.includeEvidenceLinks !== 'boolean') normalized.includeEvidenceLinks = true;
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

    const key = `${toolName}:${JSON.stringify(normalizedArgs)}`;
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
    const key = `${call.tool}:${JSON.stringify(normalizedArgs)}`;
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

function normalizeRunPlan(value: unknown): RuntimePlan | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.plan) || !Array.isArray(value.toolCalls)) return null;

  const responseStyle = isRecord(value.responseStyle)
    ? value.responseStyle
    : { depth: 'normal', tone: 'direct' };

  const depth = responseStyle.depth === 'deep' || responseStyle.depth === 'fast' ? responseStyle.depth : 'normal';
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
    runtime: isRecord(value.runtime) && typeof value.runtime.continuationDepth === 'number'
      ? {
          continuationDepth: Math.max(0, Math.floor(value.runtime.continuationDepth)),
        }
      : { continuationDepth: 0 },
  };
}

export function inferToolCallsFromMessage(message: string): RuntimeToolCall[] {
  const originalMessage = String(message || '');
  const messageWithMentions = withLibraryMentionHints(originalMessage);
  const normalized = messageWithMentions.toLowerCase();
  const calls: RuntimeToolCall[] = [];
  const firstUrl = findFirstUrl(messageWithMentions);
  const referencedCrawlRunId = findReferencedCrawlRunId(messageWithMentions);
  const libraryMentions = extractLibraryMentions(originalMessage);
  const slashCommand = parseSlashCommand(originalMessage);

  const pushIfMissing = (tool: string, args: Record<string, unknown>) => {
    const key = `${tool}:${JSON.stringify(args)}`;
    const exists = calls.some((entry) => `${entry.tool}:${JSON.stringify(entry.args)}` === key);
    if (!exists) calls.push({ tool, args });
  };

  const hasCompetitorSignals = /\b(competitor|rival|alternative|inspiration|accounts?|handles?)\b/.test(normalized);
  const hasAddIntent = /\b(add|include|save|insert|append|import|update)\b/.test(normalized);
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
  const hasCompetitorDiscoveryIntent =
    /\b(competitor discovery|discover competitors|competitor investigation|competitor set)\b/.test(normalized) ||
    (/\bcompetitor\b/.test(normalized) && /\b(discovery|discover|investigat|analy[sz]e)\b/.test(normalized));
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

  if (slashCommand) {
    if (slashCommand.command === 'show_sources') {
      pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
      pushIfMissing('intel.list', { section: 'web_sources', limit: 10 });
      pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
      pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
      pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
      pushIfMissing('evidence.news', { limit: 8 });
    } else if (slashCommand.command === 'generate_pdf') {
      pushIfMissing('document.plan', {
        docType: 'STRATEGY_BRIEF',
        depth: 'standard',
        includeCompetitors: true,
        includeEvidenceLinks: true,
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

  if (
    ((hasAddIntent && hasCompetitorSignals) ||
      /competitors?\s*(?:\/|or)\s*inspiration/i.test(messageWithMentions) ||
      /\bcompetitor(?:s)?\b/.test(normalized)) &&
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

  if (hasRunIntent && hasCompetitorDiscoveryIntent) {
    pushIfMissing('orchestration.run', { targetCount: 12, mode: 'append' });
  }

  if (hasCompetitorStatusIntent) {
    pushIfMissing('orchestration.status', {});
  }

  if (hasDeepInvestigationIntent || hasResearchSignal) {
    pushIfMissing('research.gather', {
      query: messageWithMentions,
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

  if (/news|press|mention/.test(normalized)) {
    pushIfMissing('evidence.news', { limit: 8 });
  }

  if (/video|youtube/.test(normalized)) {
    pushIfMissing('evidence.videos', { limit: 8 });
  }

  if (/post|example|tiktok|instagram|social/.test(normalized)) {
    pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
  }

  if (/report|pdf|brief|document/.test(normalized)) {
    pushIfMissing('document.plan', {
      docType: 'STRATEGY_BRIEF',
      depth: 'standard',
      includeCompetitors: true,
      includeEvidenceLinks: true,
    });
  }

  if (libraryMentions.length) {
    pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
  }

  return calls;
}

export function buildPlanFromMessage(message: string): RuntimePlan {
  const toolCalls = inferToolCallsFromMessage(message);

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
      depth: toolCalls.length ? 'normal' : 'fast',
      tone: 'friendly',
    },
    runtime: {
      continuationDepth: 0,
    },
  };

  return plan;
}

function buildExecutedToolsSection(
  toolRuns: Array<{
    toolName: string;
    status: ToolRunStatus;
    resultJson: unknown;
  }>
): string {
  if (!toolRuns.length) return 'No tools executed in this run.';
  const lines = toolRuns.map((run, index) => {
    const result = isRecord(run.resultJson) ? run.resultJson : null;
    const summary = String(result?.summary || '').trim();
    const artifactCount = Array.isArray(result?.artifacts) ? result.artifacts.length : 0;
    const evidenceCount = Array.isArray(result?.evidence) ? result.evidence.length : 0;
    const warningCount = Array.isArray(result?.warnings) ? result.warnings.length : 0;
    const statusRaw = String(run.status || '').toUpperCase();
    const statusLabel =
      statusRaw === 'DONE'
        ? 'done'
        : statusRaw === 'FAILED'
          ? 'failed'
          : statusRaw === 'CANCELLED'
            ? 'cancelled'
            : statusRaw.toLowerCase();
    const details = [
      summary,
      artifactCount ? `${artifactCount} artifact(s)` : '',
      evidenceCount ? `${evidenceCount} evidence link(s)` : '',
      warningCount ? `${warningCount} warning(s)` : '',
    ].filter(Boolean);
    return `${index + 1}. ${run.toolName} (${statusLabel})${details.length ? ` — ${details.join(' • ')}` : ''}`;
  });

  return `Tool execution trace:\n${lines.join('\n')}`;
}

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function shortArtifactId(value: unknown): string {
  const raw = String(value || '').trim();
  return raw ? raw.slice(0, 8) : '';
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
      const snapshotId = shortArtifactId(result.snapshotId);
      const finalUrl = String(result.finalUrl || '').trim();
      if (snapshotId || finalUrl) {
        pushLine(
          `Web library updated: saved page snapshot${snapshotId ? ` ${snapshotId}` : ''}${finalUrl ? ` from ${finalUrl}` : ''}.`,
          'web'
        );
      }
      continue;
    }

    if (toolRun.toolName === 'web.crawl') {
      const persisted = toNumber(result.persisted);
      const runId = shortArtifactId(result.runId);
      if ((persisted !== null && persisted > 0) || runId) {
        pushLine(
          `Web library updated: crawl${runId ? ` ${runId}` : ''} captured ${persisted !== null ? Math.max(0, Math.floor(persisted)) : 0} page snapshot(s).`,
          'web'
        );
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
      const docId = shortArtifactId(result.docId);
      if (docId) {
        pushLine(`Deliverables library updated: generated document ${docId}.`, 'deliverables');
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
  const next = results
    .flatMap((result) => result.continuations)
    .filter((item) => item.type === 'auto_continue')
    .flatMap((item) => item.suggestedNextTools || []);

  return Array.from(new Set(next.map((tool) => tool.trim()).filter(Boolean)));
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

export class RuntimeRunEngine {
  private readonly branchLocks = new Map<string, Promise<void>>();

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
      }).catch((error) => {
        console.error('[RuntimeRunEngine] Failed to process next queued message:', error);
      });
    });

    return true;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const branch = await getBranch(input.branchId, input.researchJobId);
    if (!branch) {
      throw new Error('Branch not found for this research job');
    }

    const mode = input.mode || 'send';
    const content = String(input.content || '').trim();
    if (!content) {
      throw new Error('Message content is required');
    }

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
          content,
        });

        await this.emitEvent({
          branchId: input.branchId,
          type: ProcessEventType.PROCESS_LOG,
          message: 'Message queued because a run is already in progress.',
          payload: {
            queueItemId: queueItem.id,
            position: queueItem.position,
            reason: 'active_run',
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
        content,
      });

      await this.emitEvent({
        branchId: input.branchId,
        type: ProcessEventType.PROCESS_LOG,
        message: 'Message queued for later execution.',
        payload: {
          queueItemId: queueItem.id,
          position: queueItem.position,
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
      content,
      clientVisible: true,
    });

    const run = await createAgentRun({
      branchId: input.branchId,
      triggerType: AgentRunTriggerType.USER_MESSAGE,
      triggerMessageId: userMessage.id,
      policy: normalizePolicy(input.policy),
    });

    await this.emitEvent({
      branchId: input.branchId,
      type: ProcessEventType.PROCESS_STARTED,
      agentRunId: run.id,
      message: 'Agent run started from user message.',
      payload: {
        triggerType: run.triggerType,
        triggerMessageId: userMessage.id,
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
      isRecord(targetRun.policyJson) ? (targetRun.policyJson as Partial<RunPolicy>) : undefined
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

    const contract = await executeToolWithContract({
      researchJobId: run.branch.thread.researchJobId,
      syntheticSessionId: `runtime-${run.branchId}`,
      userMessage,
      toolName: toolRun.toolName,
      args,
      policy,
    });

    await updateToolRun(toolRunId, {
      status: contract.ok ? ToolRunStatus.DONE : ToolRunStatus.FAILED,
      result: contract,
      endedAt: new Date(),
      producedArtifacts: contract.artifacts,
    });

    await createBranchMessage({
      branchId: run.branchId,
      role: ChatBranchMessageRole.TOOL,
      content: `${toolRun.toolName}: ${contract.summary}`,
      citationsJson: contract.evidence,
      clientVisible: false,
    });

    await this.emitEvent({
      branchId: run.branchId,
      agentRunId: runId,
      toolRunId,
      type: contract.ok ? ProcessEventType.PROCESS_RESULT : ProcessEventType.FAILED,
      level: contract.ok ? ProcessEventLevel.INFO : ProcessEventLevel.WARN,
      message: contract.summary,
      payload: {
        toolName: toolRun.toolName,
        warnings: contract.warnings,
        decisions: contract.decisions,
      },
    });

    for (const warning of contract.warnings) {
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

    const triggerMessage = run.triggerMessage?.content || 'Continue with available results.';
    const plan = normalizeRunPlan(run.planJson) || buildPlanFromMessage(triggerMessage);
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

    const blockingDecisions = collectBlockingDecisions(toolResults);
    if (blockingDecisions.length > 0) {
      await createBranchMessage({
        branchId: run.branchId,
        role: ChatBranchMessageRole.ASSISTANT,
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

      await this.dispatchNextQueuedMessage({
        researchJobId: run.branch.thread.researchJobId,
        branchId: run.branchId,
        policy,
        mode: 'interrupt',
      });
      return;
    }

    const promptToolResults = compactToolResultsForPrompt(toolResults);
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

    if (await isRunCancelled('summarization')) return;

    const toolSummary = await withTimeout(
      summarizeToolResults({
        userMessage: effectiveUserMessage,
        plan,
        toolResults: promptToolResults,
      }),
      RUNTIME_PROMPT_STAGE_TIMEOUT_MS,
      'summarizeToolResults'
    ).catch(async (error: any) => {
      await this.emitEvent({
        branchId: run.branchId,
        agentRunId: run.id,
        type: ProcessEventType.PROCESS_LOG,
        level: ProcessEventLevel.WARN,
        message: `Summarization fallback used: ${compactPromptString(error?.message || error, 220)}`,
      });
      return fallbackToolSummary(promptToolResults);
    });

    const continuationDepth = plan.runtime?.continuationDepth ?? 0;
    const continuationTools = collectContinuationTools(toolResults);
    const continuationFromSummary = toolSummary.recommendedContinuations
      .map((tool) => tool.trim())
      .filter((tool) => /^[a-z_]+\.[a-z_]+$/i.test(tool));
    const nextToolSuggestions = Array.from(new Set([...continuationTools, ...continuationFromSummary]));
    const continuationCalls = sanitizeToolCalls(
      nextToolSuggestions.slice(0, policy.maxToolRuns).map((tool) => ({
        tool,
        args: {},
      })),
      triggerMessage,
      policy.maxToolRuns
    );

    if (
      policy.autoContinue &&
      continuationCalls.length > 0 &&
      continuationDepth < policy.maxAutoContinuations
    ) {
      const nextPlan: RuntimePlan = {
        ...plan,
        runtime: {
          continuationDepth: continuationDepth + 1,
        },
        toolCalls: continuationCalls,
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
          tools: continuationCalls.map((call) => call.tool),
        },
      });

      await this.ensureToolRuns(run.id, nextPlan.toolCalls, policy.maxToolRuns);
      await updateAgentRun(run.id, { status: AgentRunStatus.WAITING_TOOLS });
      await this.executePendingToolRuns(run.id, policy);
      await this.finalizeRun(run.id, policy);
      return;
    }

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

    const writerOutput = await withTimeout(
      writeClientResponse({
        userMessage: effectiveUserMessage,
        plan,
        toolSummary,
        toolResults: promptToolResults,
      }),
      RUNTIME_PROMPT_STAGE_TIMEOUT_MS,
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
        toolSummary,
        toolResults: promptToolResults,
        plan,
      });
    });

    if (await isRunCancelled('validation')) return;

    const validatorOutput = await withTimeout(
      validateClientResponse({
        userMessage: effectiveUserMessage,
        plan,
        writerOutput,
        toolResults: promptToolResults,
      }),
      RUNTIME_PROMPT_STAGE_TIMEOUT_MS,
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

    const hasHighIssue = validatorOutput.issues.some((issue) => issue.severity === 'high');
    const validatorNote = hasHighIssue
      ? `Validation note: ${validatorOutput.issues.map((issue) => issue.message).join(' | ')}`
      : '';

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

    const includeOperationalTrace = shouldIncludeOperationalTrace(effectiveUserMessage);
    const toolTraceSection = includeOperationalTrace
      ? buildExecutedToolsSection(
          toolRuns.map((toolRun) => ({
            toolName: toolRun.toolName,
            status: toolRun.status,
            resultJson: toolRun.resultJson,
          }))
        )
      : '';
    const libraryUpdates = buildLibraryUpdatesSection(
      toolRuns.map((toolRun) => ({
        toolName: toolRun.toolName,
        status: toolRun.status,
        resultJson: toolRun.resultJson,
      }))
    );

    const finalResponseContent = [
      stripLegacyBoilerplateResponse(writerOutput.response),
      includeOperationalTrace ? toolTraceSection : '',
      includeOperationalTrace ? validatorNote : '',
      libraryUpdates.hasUpdates ? libraryUpdates.text : '',
    ]
      .filter((section) => String(section || '').trim().length > 0)
      .join('\n\n');

    const actionButtons = [...writerOutput.actions];
    if (libraryUpdates.hasUpdates && !actionButtons.some((action) => action.action === 'open_library')) {
      actionButtons.unshift({
        label: 'Open library',
        action: 'open_library',
        ...(libraryUpdates.collection ? { payload: { collection: libraryUpdates.collection } } : {}),
      });
    }

    if (await isRunCancelled('response_persist')) return;

    await createBranchMessage({
      branchId: run.branchId,
      role: ChatBranchMessageRole.ASSISTANT,
      content: finalResponseContent,
      blocksJson:
        actionButtons.length || finalDecisions.length
          ? {
              type: 'action_buttons',
              actions: actionButtons,
              decisions: finalDecisions,
            }
          : undefined,
      reasoningJson: writerOutput.reasoning,
      citationsJson: writerOutput.reasoning.evidence,
      clientVisible: true,
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

      const policy = normalizePolicy(isRecord(fresh.policyJson) ? (fresh.policyJson as Partial<RunPolicy>) : undefined);

      if (!fresh.startedAt) {
        await updateAgentRun(fresh.id, {
          startedAt: new Date(),
        });
      }

      let plan = normalizeRunPlan(fresh.planJson);
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
          userMessage: fresh.triggerMessage?.content || 'Continue workflow',
          policy: {
            allowMutationTools: policy.allowMutationTools,
            maxToolRuns: policy.maxToolRuns,
            maxAutoContinuations: policy.maxAutoContinuations,
          },
          previousMessages: previousMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        });
        await updateAgentRun(fresh.id, { plan });
      }

      const triggerContent = fresh.triggerMessage?.content || 'Continue workflow';
      let sanitizedToolCalls = sanitizeToolCalls(plan.toolCalls, triggerContent, policy.maxToolRuns);
      if (
        sanitizedToolCalls.length === 0 &&
        shouldForceDiscoveryTools({ triggerType: fresh.triggerType, userMessage: triggerContent })
      ) {
        sanitizedToolCalls = buildFallbackDiscoveryToolCalls(triggerContent, policy.maxToolRuns);
      }

      if (JSON.stringify(plan.toolCalls) !== JSON.stringify(sanitizedToolCalls)) {
        plan = {
          ...plan,
          toolCalls: sanitizedToolCalls,
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
        },
      });

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
