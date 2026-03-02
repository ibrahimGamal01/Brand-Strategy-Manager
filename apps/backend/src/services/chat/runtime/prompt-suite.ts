import { openai, OpenAI } from '../../ai/openai-client';
import { resolveModelForTask } from '../../ai/model-router';
import type { RunPolicy, RuntimeDecision, RuntimePlan, RuntimeToolCall, RuntimeToolResult } from './types';
import { TOOL_REGISTRY } from '../../ai/chat/tools/tool-registry';

type PlannerInput = {
  researchJobId: string;
  branchId: string;
  userMessage: string;
  runtimeContext?: Record<string, unknown>;
  policy: RunPolicy;
  previousMessages: Array<{ role: string; content: string }>;
};

type ToolDigestInput = {
  userMessage: string;
  plan: RuntimePlan;
  toolResults: RuntimeToolResult[];
};

export type ToolDigestOutput = {
  highlights: string[];
  facts: Array<{
    claim: string;
    evidence: string[];
  }>;
  openQuestions: string[];
  recommendedContinuations: string[];
};

type WriterInput = {
  userMessage: string;
  plan: RuntimePlan;
  policy: RunPolicy;
  toolDigest: ToolDigestOutput;
  toolResults: RuntimeToolResult[];
  runtimeContext?: Record<string, unknown>;
  evidenceLedger?: EvidenceLedgerOutput;
};

type EvidenceLedgerInput = {
  userMessage: string;
  plan: RuntimePlan;
  policy: RunPolicy;
  toolDigest: ToolDigestOutput;
  toolResults: RuntimeToolResult[];
  runtimeContext?: Record<string, unknown>;
};

export type EvidenceLedgerOutput = {
  entities: Array<{
    id: string;
    type: string;
    name: string;
    aliases?: string[];
  }>;
  facts: Array<{
    id: string;
    type: string;
    value: Record<string, unknown>;
    confidence: number;
    evidenceRefIds: string[];
    freshnessISO: string;
  }>;
  relations: Array<{
    from: string;
    rel: string;
    to: string;
    evidenceRefIds: string[];
  }>;
  gaps: Array<{
    gap: string;
    severity: 'low' | 'medium' | 'high';
    recommendedSources: string[];
  }>;
  suggestedToolCalls: Array<{ tool: string; args: Record<string, unknown> }>;
};

type WriterOutput = {
  response: string;
  model: {
    requested: string;
    used: string;
    fallbackUsed: boolean;
    fallbackFrom?: string;
  };
  reasoning: {
    plan: string[];
    tools: string[];
    assumptions: string[];
    nextSteps: string[];
    evidence: Array<{ id: string; label: string; url?: string }>;
    quality?: {
      intent: 'competitor_brief' | 'general';
      passed: boolean;
      notes?: string[];
    };
  };
  actions: Array<{
    label: string;
    action: string;
    payload?: Record<string, unknown>;
  }>;
  decisions: RuntimeDecision[];
};

type ValidatorInput = {
  userMessage: string;
  plan: RuntimePlan;
  policy: RunPolicy;
  writerOutput: WriterOutput;
  toolResults: RuntimeToolResult[];
};

type ValidatorOutput = {
  pass: boolean;
  issues: Array<{
    code: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
  suggestedFixes: string[];
};

const ALLOWED_PLANNER_TOOL_NAMES = TOOL_REGISTRY.map((tool) => tool.name).sort();
const SUPPORTED_TOOL_NAMES = new Set(TOOL_REGISTRY.map((tool) => tool.name));
const PROMPT_STEP_TIMEOUT_MS = Number.isFinite(Number(process.env.RUNTIME_PROMPT_STEP_TIMEOUT_MS))
  ? Math.max(15_000, Math.min(180_000, Math.floor(Number(process.env.RUNTIME_PROMPT_STEP_TIMEOUT_MS))))
  : 60_000;
const GENERIC_TOOL_SUMMARY_RE =
  /^(listed \d+ item\(s\)|fetched \d+ item\(s\)|no item found|intel\.(list|get) returned \d+ row\(s\)|\w+ returned \d+ item\(s\)|\w+ completed successfully\.?)$/i;

const TOOL_NAME_ALIASES: Record<string, { tool: string; args: Record<string, unknown> }> = {
  competitoranalysis: { tool: 'orchestration.run', args: { targetCount: 12, mode: 'append' } },
  competitoraudit: { tool: 'orchestration.run', args: { targetCount: 12, mode: 'append' } },
  competitorfinderv3: { tool: 'competitors.discover_v3', args: { mode: 'standard' } },
  discovercompetitorsv3: { tool: 'competitors.discover_v3', args: { mode: 'standard' } },
  widecompetitordiscovery: { tool: 'competitors.discover_v3', args: { mode: 'wide' } },
  deepcompetitordiscovery: { tool: 'competitors.discover_v3', args: { mode: 'deep' } },
  searchweb: { tool: 'search.web', args: { provider: 'auto', count: 10 } },
  bravesearch: { tool: 'search.web', args: { provider: 'brave', count: 10 } },
  scraplyscan: { tool: 'research.gather', args: { depth: 'deep', includeScrapling: true, includeAccountContext: true } },
};

type JsonRequestResult = {
  parsed: Record<string, unknown> | null;
  requestedModel: string;
  usedModel: string;
  fallbackUsed: boolean;
};

type CompetitorCandidate = {
  handle: string;
  platform: string;
  selectionState: string;
  competitorType: string;
  relevanceScore: number;
  selectionReason: string;
  discoveryReason: string;
};

type WriterQualityResult = {
  intent: 'competitor_brief' | 'general';
  passed: boolean;
  notes?: string[];
};

const MAX_WRITER_ACTIONS = 8;
const WRITER_ACTIONS_REQUIRING_DOCUMENT_ID = new Set([
  'document.read',
  'document.propose_edit',
  'document.apply_edit',
  'document.export',
]);
const WRITER_ACTION_ALIASES: Record<string, string> = {
  'document.open_file': 'document.open',
  'document.open_result': 'document.open',
  'document.download_file': 'document.download',
  'document.download_result': 'document.download',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeActionPayloadValue(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value.slice(0, 8_000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) {
    const entries = value
      .slice(0, 24)
      .map((entry) => sanitizeActionPayloadValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
    return entries;
  }
  if (!isRecord(value)) return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 24)) {
    const key = String(rawKey || '').trim().slice(0, 72);
    if (!key) continue;
    const nextValue = sanitizeActionPayloadValue(rawValue, depth + 1);
    if (nextValue === undefined) continue;
    sanitized[key] = nextValue;
  }
  return sanitized;
}

function normalizeWriterActionName(value: unknown): string {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return '';
  const withoutSlash = trimmed.replace(/^\/+/, '');
  const normalized = withoutSlash
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_./-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.+/g, '.')
    .replace(/^[_\-.]+/, '')
    .slice(0, 120);
  const alias = WRITER_ACTION_ALIASES[normalized];
  return alias || normalized;
}

export function sanitizeWriterActions(value: unknown, maxActions = MAX_WRITER_ACTIONS): WriterOutput['actions'] {
  if (!Array.isArray(value)) return [];
  const cap = Number.isFinite(Number(maxActions))
    ? Math.max(1, Math.min(MAX_WRITER_ACTIONS, Math.floor(Number(maxActions))))
    : MAX_WRITER_ACTIONS;
  const sanitized: WriterOutput['actions'] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const label = String(entry.label || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    const action = normalizeWriterActionName(entry.action);
    if (!label || !action) continue;
    if (!/^[a-z0-9][a-z0-9_./-]{0,119}$/i.test(action)) continue;

    const payloadRaw = sanitizeActionPayloadValue(entry.payload);
    const payload = isRecord(payloadRaw) ? payloadRaw : undefined;
    const documentId = String(payload?.documentId || payload?.docId || '').trim();
    if (WRITER_ACTIONS_REQUIRING_DOCUMENT_ID.has(action) && !documentId) continue;

    sanitized.push({
      label,
      action,
      ...(payload ? { payload } : {}),
    });
    if (sanitized.length >= cap) break;
  }
  return sanitized;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  const candidates: string[] = [text];
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const object = text.match(/\{[\s\S]*\}/);
  if (object?.[0]) {
    candidates.push(object[0].trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // keep trying
    }
  }

  return null;
}

function normalizeStringArray(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeToolCalls(value: unknown, max = 8): RuntimeToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: RuntimeToolCall[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    const tool = String(item.tool || item.name || '').trim();
    if (!tool) continue;
    const args = isRecord(item.args) ? item.args : {};
    const dependsOn = normalizeStringArray(item.dependsOn, 8);
    calls.push({
      tool,
      args,
      ...(dependsOn.length ? { dependsOn } : {}),
    });
    if (calls.length >= max) break;
  }

  return calls;
}

function dedupeToolCalls(calls: RuntimeToolCall[], max = 8): RuntimeToolCall[] {
  const seen = new Set<string>();
  const out: RuntimeToolCall[] = [];
  for (const call of calls) {
    const key = `${call.tool}:${JSON.stringify(call.args || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(call);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeDecisions(value: unknown, max = 8): RuntimeDecision[] {
  if (!Array.isArray(value)) return [];
  const decisions: RuntimeDecision[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = String(item.id || '').trim();
    const title = String(item.title || '').trim();
    if (!id || !title) continue;

    const options: Array<{ value: string; label?: string }> = [];
    if (Array.isArray(item.options)) {
      for (const option of item.options) {
        if (typeof option === 'string') {
          const valuePart = option.trim();
          if (valuePart) options.push({ value: valuePart });
          continue;
        }
        if (!isRecord(option)) continue;
        const valuePart = String(option.value || option.label || '').trim();
        if (!valuePart) continue;
        options.push({
          value: valuePart,
          ...(typeof option.label === 'string' ? { label: option.label } : {}),
        });
      }
    }

    if (!options.length) continue;

    decisions.push({
      id,
      title,
      options,
      ...(typeof item.default === 'string' ? { default: item.default } : {}),
      blocking: Boolean(item.blocking),
    });

    if (decisions.length >= max) break;
  }

  return decisions;
}

function completionText(response: OpenAI.Chat.Completions.ChatCompletion): string {
  return String(response.choices?.[0]?.message?.content || '').trim();
}

function normalizeModelName(value: unknown): string {
  return String(value || '').trim();
}

function canonicalModelName(value: unknown): string {
  const normalized = normalizeModelName(value).toLowerCase();
  if (!normalized) return '';
  if (normalized.startsWith('gpt-5.2')) return 'gpt-5.2';
  if (normalized.startsWith('gpt-5-mini')) return 'gpt-5-mini';
  if (normalized.startsWith('gpt-5')) return 'gpt-5';
  if (normalized.startsWith('gpt-4o-mini')) return 'gpt-4o-mini';
  if (normalized.startsWith('gpt-4o')) return 'gpt-4o';
  return normalized;
}

function modelNamesMatch(left: string, right: string): boolean {
  const a = canonicalModelName(left);
  const b = canonicalModelName(right);
  if (!a || !b) return false;
  return a === b;
}

function buildModelTelemetry(requestedModel: string, usedModel: string): WriterOutput['model'] {
  const requested = normalizeModelName(requestedModel) || 'unknown';
  const used = normalizeModelName(usedModel) || requested;
  const fallbackUsed = !modelNamesMatch(requested, used);
  return {
    requested,
    used,
    fallbackUsed,
    ...(fallbackUsed ? { fallbackFrom: requested } : {}),
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

async function requestJson(
  task: Parameters<typeof openai.bat.chatCompletion>[0],
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens = 900
): Promise<JsonRequestResult> {
  const requestedModel = resolveModelForTask(task);
  const completion = (await withTimeout(
    openai.bat.chatCompletion(task, {
      messages,
      max_completion_tokens: maxTokens,
    }) as Promise<OpenAI.Chat.Completions.ChatCompletion>,
    PROMPT_STEP_TIMEOUT_MS,
    `Prompt task ${task}`
  )) as OpenAI.Chat.Completions.ChatCompletion;

  const usedModelPrimary = normalizeModelName(completion.model) || requestedModel;
  const text = completionText(completion);
  const parsed = extractJsonObject(text);
  if (parsed) {
    return {
      parsed,
      requestedModel,
      usedModel: usedModelPrimary,
      fallbackUsed: !modelNamesMatch(requestedModel, usedModelPrimary),
    };
  }

  // One repair attempt for malformed JSON output.
  const repairCompletion = (await withTimeout(
    openai.bat.chatCompletion('analysis_fast', {
      messages: [
        {
          role: 'system',
          content:
            'You repair malformed JSON. Return one valid JSON object only with no markdown and no explanation.',
        },
        {
          role: 'user',
          content: text,
        },
      ],
      max_completion_tokens: maxTokens,
    }) as Promise<OpenAI.Chat.Completions.ChatCompletion>,
    PROMPT_STEP_TIMEOUT_MS,
    `Prompt task ${task} (repair)`
  )) as OpenAI.Chat.Completions.ChatCompletion;

  const usedModelRepair = normalizeModelName(repairCompletion.model) || resolveModelForTask('analysis_fast');
  return {
    parsed: extractJsonObject(completionText(repairCompletion)),
    requestedModel,
    usedModel: usedModelRepair,
    fallbackUsed: !modelNamesMatch(requestedModel, usedModelRepair),
  };
}

function compactDigestText(value: unknown, max = 180): string {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function toolSummaryIsGeneric(summary: string): boolean {
  const normalized = compactDigestText(summary, 260);
  if (!normalized) return true;
  return GENERIC_TOOL_SUMMARY_RE.test(normalized);
}

function previewLabelFromRow(row: unknown): string {
  if (!isRecord(row)) return '';
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const candidates = [
    row.title,
    row.headline,
    row.handle,
    row.canonicalName,
    row.domain,
    row.query,
    row.url,
    row.finalUrl,
    row.profileUrl,
    row.href,
    metadata.title,
    row.summary,
    row.content,
    row.body,
  ];
  for (const candidate of candidates) {
    const next = compactDigestText(candidate, 160);
    if (next) return next;
  }
  return '';
}

function extractRawPreviewLabels(raw: unknown, max = 3): string[] {
  if (!isRecord(raw)) return [];
  const rows = Array.isArray(raw.items)
    ? raw.items
    : Array.isArray(raw.data)
      ? raw.data
      : isRecord(raw.item)
        ? [raw.item]
        : [];
  if (!rows.length) return [];
  return rows
    .map((row) => previewLabelFromRow(row))
    .filter(Boolean)
    .slice(0, max);
}

function mergeSummaryWithExamples(summary: string, examples: string[]): string {
  const base = compactDigestText(summary, 260);
  if (!examples.length) return base;
  if (toolSummaryIsGeneric(base)) {
    return `Evidence highlights: ${examples.join('; ')}.`;
  }
  return `${base} Examples: ${examples.join('; ')}.`;
}

export function buildToolDigest(input: ToolDigestInput): ToolDigestOutput {
  const highlights = input.toolResults
    .slice(0, 6)
    .map((result) => {
      const summary = String(result.summary || '').trim();
      const examples = extractRawPreviewLabels(result.raw, 3);
      return mergeSummaryWithExamples(summary, examples);
    })
    .filter(Boolean);

  const facts = input.toolResults
    .flatMap((result) => {
      const summary = String(result.summary || '').trim();
      const examples = extractRawPreviewLabels(result.raw, 3);
      const claim = mergeSummaryWithExamples(summary, examples);
      const evidence = result.evidence
        .slice(0, 4)
        .map((item) => compactDigestText(item.label, 180))
        .filter(Boolean);
      if (!claim) return [];
      if (!evidence.length && examples.length) {
        return [{ claim, evidence: examples.map((entry) => compactDigestText(entry, 180)).filter(Boolean).slice(0, 3) }];
      }
      return [{ claim, evidence }];
    })
    .slice(0, 10);

  return {
    highlights: highlights.length ? highlights : ['No tool results were required for this response.'],
    facts,
    openQuestions: [],
    recommendedContinuations: input.toolResults
      .flatMap((result) => result.continuations)
      .flatMap((continuation) => [
        ...(continuation.suggestedNextTools || []),
        ...((continuation.suggestedToolCalls || []).map((call) => String(call.tool || '').trim()).filter(Boolean)),
      ])
      .slice(0, 6),
  };
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectWriterIntent(message: string): 'competitor_brief' | 'general' {
  const normalized = String(message || '').toLowerCase();
  if (!/\bcompetitor|rival|alternative\b/.test(normalized)) return 'general';

  const hasActionVerb =
    /\b(give|list|rank|name|show|identify|find|provide|outline|write|compare|analy[sz]e|audit|map)\b/.test(
      normalized
    );
  const hasMetaSufficiency =
    /\b(is there|do we have|do you have|enough|sufficient|missing|lack|whether)\b/.test(normalized) &&
    /\b(evidence|workspace|context|data)\b/.test(normalized);
  const hasBriefSignals =
    /\b(top\s*\d+|top five|top 5|best competitors?|direct competitors?|competitor brief|competitor analysis)\b/.test(
      normalized
    ) ||
    /\bwhy (each|they|these)\b/.test(normalized) ||
    /\b(positioning gap|market gap|white\s*space|whitespace|angle)\b/.test(normalized);

  if (hasMetaSufficiency && !hasActionVerb) return 'general';
  return hasBriefSignals ? 'competitor_brief' : 'general';
}

function inferPlatformFromUrl(value: unknown): string {
  const raw = String(value || '').toLowerCase();
  if (!raw) return '';
  if (raw.includes('instagram.com')) return 'instagram';
  if (raw.includes('tiktok.com')) return 'tiktok';
  if (raw.includes('linkedin.com')) return 'linkedin';
  if (raw.includes('youtube.com') || raw.includes('youtu.be')) return 'youtube';
  if (raw.includes('x.com') || raw.includes('twitter.com')) return 'x';
  return '';
}

function reduceToRootDomain(hostname: string): string {
  const host = String(hostname || '').trim().toLowerCase().replace(/^www\./, '');
  if (!host) return '';
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const secondLevelTlds = new Set([
    'co.uk',
    'org.uk',
    'ac.uk',
    'gov.uk',
    'com.au',
    'net.au',
    'org.au',
    'co.nz',
    'com.br',
    'com.mx',
    'com.eg',
    'co.in',
    'co.jp',
  ]);
  const tail = parts.slice(-2).join('.');
  if (secondLevelTlds.has(tail) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function normalizeHandle(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    const host = String(parsed.hostname || '').trim().toLowerCase().replace(/^www\./, '');
    const pathParts = parsed.pathname
      .split('/')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (host.includes('instagram.com') || host.includes('tiktok.com') || host.includes('x.com') || host.includes('twitter.com')) {
      const first = String(pathParts[0] || '').replace(/^@+/, '').trim().toLowerCase();
      if (first && !['p', 'reel', 'reels', 'video', 'videos', 'explore', 'home'].includes(first)) {
        return first.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      }
    }
    if (host.includes('youtube.com')) {
      const first = String(pathParts[pathParts[0] === '@' ? 1 : 0] || '').replace(/^@+/, '').trim().toLowerCase();
      if (first && !['watch', 'shorts', 'channel', 'c'].includes(first)) {
        return first.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      }
    }
    if (host) return reduceToRootDomain(host);
  } catch {
    // Fall through to text normalization below.
  }
  const normalized = raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^@+/, '')
    .split(/[?#]/)[0]
    .split('/')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized;
}

function normalizeHostname(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const hostname = String(new URL(candidate).hostname || '').trim().toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function extractRuntimeWebsiteHosts(runtimeContext?: Record<string, unknown>): string[] {
  if (!isRecord(runtimeContext)) return [];
  const websites = Array.isArray(runtimeContext.websites)
    ? runtimeContext.websites.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const hosts = new Set<string>();
  for (const website of websites) {
    const host = normalizeHostname(website);
    if (host) hosts.add(host);
  }
  return Array.from(hosts);
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

function normalizeScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed <= 1) return Math.max(0, Math.min(100, parsed * 100));
  return Math.max(0, Math.min(100, parsed));
}

function stateRank(value: string): number {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'APPROVED') return 6;
  if (normalized === 'TOP_PICK') return 5;
  if (normalized === 'SHORTLISTED') return 4;
  if (normalized === 'DISCOVERED') return 3;
  if (normalized === 'SUGGESTED') return 2;
  return 1;
}

function typeRank(value: string): number {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'DIRECT') return 4;
  if (normalized === 'INDIRECT') return 3;
  if (normalized === 'ADJACENT') return 2;
  return 1;
}

function extractRowsFromRaw(raw: Record<string, unknown>): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const pushRows = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item)) rows.push(item);
      }
      return;
    }
    if (isRecord(value)) rows.push(value);
  };

  pushRows(raw.items);
  pushRows(raw.data);
  pushRows(raw.item);
  pushRows(raw.topCandidates);
  pushRows(raw.shortlist);
  pushRows(raw.topPicks);
  pushRows(raw.candidates);
  return rows;
}

function extractCompetitorCandidates(
  toolResults: RuntimeToolResult[],
  runtimeContext?: Record<string, unknown>
): CompetitorCandidate[] {
  const byKey = new Map<string, CompetitorCandidate>();
  const workspaceHosts = extractRuntimeWebsiteHosts(runtimeContext);
  const isWorkspaceHost = (host: string): boolean =>
    Boolean(host) && workspaceHosts.some((workspaceHost) => host === workspaceHost || host.endsWith(`.${workspaceHost}`));
  const scoreFromRank = (rank: number): number => Math.max(12, 100 - Math.max(0, rank - 1) * 9);

  const upsert = (candidate: CompetitorCandidate) => {
    const key = candidate.handle;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      return;
    }
    const currentScore =
      stateRank(existing.selectionState) * 100 + typeRank(existing.competitorType) * 20 + existing.relevanceScore;
    const nextScore =
      stateRank(candidate.selectionState) * 100 + typeRank(candidate.competitorType) * 20 + candidate.relevanceScore;
    if (nextScore > currentScore) {
      byKey.set(key, candidate);
      return;
    }
    if (nextScore === currentScore && existing.platform === 'unknown' && candidate.platform !== 'unknown') {
      byKey.set(key, {
        ...existing,
        ...candidate,
      });
    }
  };

  for (const result of toolResults) {
    if (!isRecord(result.raw)) continue;
    const raw = result.raw;
    const section = String(raw.section || '').trim().toLowerCase();
    const query = String(raw.query || '').trim();
    const normalizedQuery = query.toLowerCase();
    const isSearchCompetitorIntent = /\b(competitor|alternative|alternatives|rival|vs|similar)\b/.test(normalizedQuery);
    const relevantSection =
      section === 'competitors' || section === 'competitor_accounts' || section === 'competitor_entities';

    const rows = extractRowsFromRaw(raw);
    rows.forEach((row, index) => {
      const profileUrl = String(row.profileUrl || row.url || row.href || '').trim();
      const hostFromRow = normalizeHostname(profileUrl || row.finalUrl || row.domain || row.site || '');
      if (hostFromRow && isWorkspaceHost(hostFromRow)) return;

      const identity =
        row.handle ||
        row.normalizedHandle ||
        row.username ||
        row.canonicalName ||
        row.domain ||
        row.name ||
        hostFromRow;
      const handle = normalizeHandle(identity);
      const platform = String(row.platform || inferPlatformFromUrl(profileUrl) || '').trim().toLowerCase();
      if (!handle || handle.length < 2) return;

      const explicitType = String(row.competitorType || row.type || '')
        .trim()
        .toUpperCase();
      const explicitState = String(row.selectionState || row.state || row.status || '')
        .trim()
        .toUpperCase();
      const hasScoringHints =
        row.selectionState != null || row.competitorType != null || row.relevanceScore != null || row.score != null;
      if (!relevantSection && !isSearchCompetitorIntent && !hasScoringHints) return;

      const rank = Number(row.rank);
      const inferredRelevance =
        normalizeScore(row.relevanceScore || row.score || row.totalScore) ||
        (Number.isFinite(rank) ? scoreFromRank(rank) : scoreFromRank(index + 1));
      const inferredType =
        explicitType ||
        (isSearchCompetitorIntent ? 'DIRECT' : relevantSection ? 'DIRECT' : 'UNKNOWN');
      const inferredState =
        explicitState ||
        (isSearchCompetitorIntent ? 'SHORTLISTED' : relevantSection ? 'DISCOVERED' : 'SUGGESTED');
      const fallbackReason = isSearchCompetitorIntent
        ? `Candidate appeared in web competitor query${query ? `: ${compactDigestText(query, 120)}` : ''}.`
        : '';

      upsert({
        handle,
        platform: platform || 'unknown',
        selectionState: inferredState,
        competitorType: inferredType,
        relevanceScore: inferredRelevance,
        selectionReason: String(row.selectionReason || row.stateReason || row.reason || '').trim() || fallbackReason,
        discoveryReason: String(row.discoveryReason || row.reason || '').trim(),
      });
    });
  }

  const contextTop = isRecord(runtimeContext) && Array.isArray(runtimeContext.topCompetitors)
    ? runtimeContext.topCompetitors
    : [];
  for (const entry of contextTop) {
    const handle = normalizeHandle(entry);
    if (!handle) continue;
    upsert({
      handle,
      platform: 'unknown',
      selectionState: 'TOP_PICK',
      competitorType: 'UNKNOWN',
      relevanceScore: 50,
      selectionReason: 'Top competitor from workspace context.',
      discoveryReason: '',
    });
  }

  return Array.from(byKey.values())
    .sort((left, right) => {
      const leftScore = stateRank(left.selectionState) * 100 + typeRank(left.competitorType) * 20 + left.relevanceScore;
      const rightScore =
        stateRank(right.selectionState) * 100 + typeRank(right.competitorType) * 20 + right.relevanceScore;
      return rightScore - leftScore;
    })
    .slice(0, 12);
}

function candidateDirectnessReason(candidate: CompetitorCandidate): string {
  const reasons: string[] = [];
  if (candidate.competitorType && candidate.competitorType !== 'UNKNOWN') {
    reasons.push(`type=${candidate.competitorType.toLowerCase()}`);
  }
  if (candidate.selectionState) {
    reasons.push(`state=${candidate.selectionState.toLowerCase()}`);
  }
  if (candidate.relevanceScore > 0) {
    reasons.push(`relevance=${Math.round(candidate.relevanceScore)}/100`);
  }
  const rationale = candidate.selectionReason || candidate.discoveryReason;
  if (rationale) reasons.push(rationale);
  if (!reasons.length) return 'Mapped as a close substitute in the current workspace competitor set.';
  return reasons.join('; ');
}

function derivePositioningGap(candidates: CompetitorCandidate[]): string {
  if (!candidates.length) {
    return 'No verified direct-competitor set yet. Biggest gap is to lock a validated direct list before positioning decisions.';
  }
  const directCount = candidates.filter((candidate) => candidate.competitorType === 'DIRECT').length;
  const unknownCount = candidates.filter((candidate) => candidate.competitorType === 'UNKNOWN').length;
  if (unknownCount >= Math.ceil(candidates.length / 2)) {
    return 'Most competitors are weakly typed. Positioning gap: own a tightly-defined ICP + outcome promise while others stay broad.';
  }
  if (directCount >= 3) {
    return 'Direct players cluster around similar broad messaging. Positioning gap: narrow to one high-intent segment and lead with proof-backed outcomes.';
  }
  return 'Set appears mixed between direct and adjacent players. Positioning gap: claim the direct category explicitly with sharper problem-outcome language.';
}

function buildCompetitorSufficiencyDirectiveResponse(input: {
  userMessage: string;
  toolResults: RuntimeToolResult[];
  runtimeContext?: Record<string, unknown>;
}): string | null {
  const message = String(input.userMessage || '');
  const normalized = message.toLowerCase();
  const asksCompetitorSufficiency =
    /\bcompetitor\b/.test(normalized) &&
    /\b(top\s*\d+|top five|top 5)\b/.test(normalized) &&
    /\b(enough|sufficient|trustworthy)\b/.test(normalized);
  if (!asksCompetitorSufficiency) return null;

  const competitorCount = extractCompetitorCandidates(input.toolResults, input.runtimeContext).length;
  const verdict = competitorCount >= 5 ? 'YES' : 'NO';
  const strictOneLine =
    /\b(exactly one line|single line|only one line|no extra text)\b/.test(normalized) &&
    /\b(yes|no)\b/.test(normalized);
  const token =
    (message.match(/\b[A-Z][A-Z0-9_-]{3,24}\b/g) || []).find(
      (entry) => !['YES', 'NO', 'TOP', 'DIRECT', 'COMPETITOR', 'BRIEF'].includes(entry)
    ) || '';

  if (strictOneLine) {
    return token ? `${token} ${verdict}` : verdict;
  }

  return verdict === 'YES'
    ? `Yes, current workspace evidence is sufficient for a trustworthy top-5 direct competitor brief (${competitorCount} competitors captured).`
    : `No, current workspace evidence is not sufficient for a trustworthy top-5 direct competitor brief (${competitorCount} competitors captured).`;
}

function buildCompetitorBriefResponse(
  userMessage: string,
  toolResults: RuntimeToolResult[],
  runtimeContext?: Record<string, unknown>
): string {
  const candidates = extractCompetitorCandidates(toolResults, runtimeContext).slice(0, 5);
  if (!candidates.length) {
    return [
      'I checked current workspace evidence, but I do not have enough validated direct competitors yet to produce a trustworthy top-5 brief.',
      'Next best move: run/refresh competitor discovery, then I will return top direct competitors with why each is direct and a clear positioning gap.',
    ].join('\n\n');
  }

  const lines = candidates.map((candidate, index) => {
    const platformPart = candidate.platform && candidate.platform !== 'unknown' ? ` (${candidate.platform})` : '';
    return `${index + 1}. @${candidate.handle}${platformPart}: ${candidateDirectnessReason(candidate)}`;
  });

  const gap = derivePositioningGap(candidates);
  const lead = /\bpositioning gap\b/i.test(userMessage)
    ? 'Here is the direct-competitor brief with explicit rationale and positioning gap.'
    : 'Here are the strongest direct competitors from current workspace evidence and why they are direct.';

  return [lead, `Top competitors:\n${lines.join('\n')}`, `Positioning gap:\n${gap}`].join('\n\n');
}

function assessCompetitorBriefQuality(response: string, competitors: CompetitorCandidate[]): WriterQualityResult {
  const normalized = String(response || '').trim();
  if (!normalized) {
    return {
      intent: 'competitor_brief',
      passed: false,
      notes: ['Response was empty.'],
    };
  }

  const topHandles = competitors.slice(0, 5).map((candidate) => candidate.handle).filter(Boolean);
  let handleMentions = 0;
  for (const handle of topHandles) {
    const pattern = new RegExp(`(^|[^a-z0-9_])@?${escapeRegExp(handle)}([^a-z0-9_]|$)`, 'i');
    if (pattern.test(normalized)) handleMentions += 1;
  }
  const fallbackHandleMentions = (normalized.match(/@[a-z0-9._-]{2,40}/gi) || []).length;
  const hasCompetitorNames = handleMentions >= Math.min(3, Math.max(1, topHandles.length)) || fallbackHandleMentions >= 3;
  const hasDirectnessRationale =
    /\b(direct|because|overlap|fit|audience|offer|category|state=|type=|relevance=)\b/i.test(normalized);
  const hasGap = /\b(positioning gap|market gap|gap|whitespace|white\s*space|opportunity)\b/i.test(normalized);

  const notes: string[] = [];
  if (!hasCompetitorNames) notes.push('Missing enough named competitors.');
  if (!hasDirectnessRationale) notes.push('Missing directness rationale.');
  if (!hasGap) notes.push('Missing explicit positioning gap.');

  return {
    intent: 'competitor_brief',
    passed: notes.length === 0,
    ...(notes.length ? { notes } : {}),
  };
}

export function applyWriterQualityGate(input: {
  userMessage: string;
  response: string;
  toolResults: RuntimeToolResult[];
  runtimeContext?: Record<string, unknown>;
}): { response: string; quality: WriterQualityResult } {
  const intent = detectWriterIntent(input.userMessage);
  if (intent !== 'competitor_brief') {
    const raw = String(input.response || '').trim();
    const genericSignals =
      (raw.match(/\bloaded\s+\d+\s+record\(s\)\b/gi) || []).length +
      (raw.match(/\btool completed successfully\b/gi) || []).length +
      (raw.match(/\bauto-continuing based on tool suggestions\b/gi) || []).length;
    const hasLowSignal = genericSignals >= 2 || raw.length < 80;
    if (!hasLowSignal) {
      return {
        response: input.response,
        quality: {
          intent: 'general',
          passed: true,
        },
      };
    }

    const highlights = input.toolResults
      .map((result) => String(result.summary || '').trim())
      .filter(Boolean)
      .slice(0, 4);
    const evidenceLinks = input.toolResults
      .flatMap((result) => result.evidence || [])
      .map((entry) => String(entry.url || entry.label || '').trim())
      .filter(Boolean)
      .slice(0, 3);
    const clientName = String((input.runtimeContext || {}).clientName || '').trim();
    const rewritten = [
      clientName ? `I reviewed the latest workspace evidence for ${clientName}.` : 'I reviewed the latest workspace evidence.',
      highlights.length
        ? `What changed:\n${highlights.map((line, index) => `${index + 1}. ${line}`).join('\n')}`
        : 'The latest run completed with fresh evidence updates.',
      evidenceLinks.length
        ? `Evidence references:\n${evidenceLinks.map((line, index) => `${index + 1}. ${line}`).join('\n')}`
        : '',
      'Tell me which direction you want next: deeper research, concise summary, or a client-ready deliverable.',
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      response: rewritten,
      quality: {
        intent: 'general',
        passed: false,
        notes: ['Rewritten low-signal response to improve clarity and usefulness.'],
      },
    };
  }

  const competitors = extractCompetitorCandidates(input.toolResults, input.runtimeContext);
  const quality = assessCompetitorBriefQuality(input.response, competitors);
  if (quality.passed) {
    return { response: input.response, quality };
  }

  const rewritten = buildCompetitorBriefResponse(input.userMessage, input.toolResults, input.runtimeContext);
  const recheck = assessCompetitorBriefQuality(rewritten, competitors);
  return {
    response: rewritten,
    quality: {
      intent: 'competitor_brief',
      passed: recheck.passed,
      notes: [
        ...(quality.notes || []),
        'Rewritten to enforce competitor brief completeness.',
      ],
    },
  };
}

function fallbackEvidenceLedger(input: EvidenceLedgerInput): EvidenceLedgerOutput {
  const nowIso = new Date().toISOString();
  const context = isRecord(input.runtimeContext) ? input.runtimeContext : {};
  const entities: EvidenceLedgerOutput['entities'] = [];
  const relations: EvidenceLedgerOutput['relations'] = [];

  const clientName = String(context.clientName || '').trim();
  if (clientName) {
    entities.push({ id: 'entity:workspace:client', type: 'brand', name: clientName });
  }

  const websites = Array.isArray(context.websites)
    ? context.websites.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  for (let index = 0; index < websites.length; index += 1) {
    const id = `entity:workspace:website:${index + 1}`;
    entities.push({ id, type: 'website', name: websites[index] });
    if (clientName) {
      relations.push({ from: 'entity:workspace:client', rel: 'HAS_SURFACE', to: id, evidenceRefIds: [] });
    }
  }

  const facts: EvidenceLedgerOutput['facts'] = input.toolResults.slice(0, 24).map((result, index) => {
    const raw = isRecord(result.raw) ? result.raw : {};
    const evidenceRefIds = Array.isArray(raw.runtimeEvidenceRefIds)
      ? raw.runtimeEvidenceRefIds.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 20)
      : [];
    return {
      id: `fact:tool:${index + 1}`,
      type: result.ok ? 'tool_result' : 'tool_failure',
      value: {
        summary: String(result.summary || '').trim(),
      },
      confidence: result.ok ? 0.75 : 0.35,
      evidenceRefIds,
      freshnessISO: nowIso,
    };
  });

  for (let index = 0; index < Math.min(20, input.toolDigest.facts.length); index += 1) {
    const item = input.toolDigest.facts[index];
    facts.push({
      id: `fact:summary:${index + 1}`,
      type: 'summary_fact',
      value: {
        claim: String(item.claim || '').trim(),
        evidence: Array.isArray(item.evidence)
          ? item.evidence.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 8)
          : [],
      },
      confidence: 0.7,
      evidenceRefIds: [],
      freshnessISO: nowIso,
    });
  }

  const gaps: EvidenceLedgerOutput['gaps'] = input.toolDigest.openQuestions
    .map((question) => String(question || '').trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((gap) => ({
      gap,
      severity: 'medium' as const,
      recommendedSources: ['workspace evidence', 'web snapshots', 'competitor records'],
    }));

  const suggestedToolCalls: EvidenceLedgerOutput['suggestedToolCalls'] = [];
  const seen = new Set<string>();
  const pushSuggestedCall = (toolRaw: unknown, argsRaw: unknown) => {
    const tool = String(toolRaw || '').trim();
    if (!tool) return;
    const args = isRecord(argsRaw) ? argsRaw : {};
    const key = `${tool}:${JSON.stringify(args)}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestedToolCalls.push({ tool, args });
  };

  for (const result of input.toolResults) {
    for (const continuation of result.continuations || []) {
      if (continuation.type !== 'auto_continue') continue;
      for (const call of continuation.suggestedToolCalls || []) {
        pushSuggestedCall(call.tool, call.args);
      }
      for (const name of continuation.suggestedNextTools || []) {
        pushSuggestedCall(name, {});
      }
    }
  }
  for (const name of input.toolDigest.recommendedContinuations || []) {
    pushSuggestedCall(name, {});
  }

  return {
    entities,
    facts,
    relations,
    gaps,
    suggestedToolCalls: suggestedToolCalls.slice(0, 20),
  };
}

function prefersConciseOutput(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  if (!normalized.trim()) return false;
  return /\b(concise|brief|short|tl;dr|tldr|in short|summarize quickly|quick summary)\b/.test(normalized);
}

function findFirstUrl(message: string): string | undefined {
  const fullUrl = message.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (fullUrl) return fullUrl;
  const bareDomain = message.match(/\b([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)]*)?)\b/i)?.[1];
  return bareDomain ? `https://${bareDomain}` : undefined;
}

function findReferencedCrawlRunId(message: string): string | null {
  const directId = message.match(/\b(crawl-[a-z0-9-]+)\b/i);
  if (directId?.[1]) return directId[1].toLowerCase();

  const labeled = message.match(/\bcrawl\s*run[:\s#-]*([a-z0-9-]+)/i);
  if (!labeled?.[1]) return null;
  const candidate = labeled[1].trim().toLowerCase();
  if (!candidate) return null;
  return candidate.startsWith('crawl-') ? candidate : `crawl-${candidate}`;
}

function extractLibraryMentions(message: string): Array<{ ref: string; title: string }> {
  const mentions: Array<{ ref: string; title: string }> = [];
  const raw = String(message || '');
  const patterns = [
    /@libraryRef\[([^\]|]+)\|([^\]]+)\]/gi,
    /@library\[([^\]|]+)\|([^\]]+)\]/gi,
  ];
  for (const matcher of patterns) {
    let current = matcher.exec(raw);
    while (current) {
      const ref = String(current[1] || '').trim();
      const title = String(current[2] || '').trim();
      if (ref && title) {
        mentions.push({ ref, title });
      }
      current = matcher.exec(raw);
    }
  }
  return mentions;
}

function withLibraryMentionHints(message: string): string {
  const mentions = extractLibraryMentions(message);
  if (!mentions.length) return message;
  const hints = mentions.map((entry) => `Use pinned library evidence: ${entry.title}`).join('\n');
  return `${message}\n${hints}`;
}

function parseSlashCommand(message: string): { command: string; argsJson: Record<string, unknown> | null } | null {
  const match = String(message || '').trim().match(/^\/([a-z0-9_./-]+)(?:\s+([\s\S]+))?$/i);
  if (!match?.[1]) return null;
  const command = match[1].trim().toLowerCase();
  const argsRaw = String(match[2] || '').trim();
  if (!argsRaw) return { command, argsJson: null };
  if (argsRaw.startsWith('{') && argsRaw.endsWith('}')) {
    try {
      const parsed = JSON.parse(argsRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { command, argsJson: parsed as Record<string, unknown> };
      }
    } catch {
      // Ignore JSON parse failure for free-form slash commands.
    }
  }
  return { command, argsJson: null };
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

function normalizeToolAliasKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9._/-]/g, '')
    .replace(/[./_-]+/g, '');
}

function inferToolCallsFromMessage(message: string): RuntimeToolCall[] {
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
    messageWithMentions
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
  const hasDocumentGenerationIntent = hasDocumentKeyword && hasDocumentGenerateVerb;
  const defaultDocumentArgs: Record<string, unknown> = {
    docType: 'STRATEGY_BRIEF',
    depth: 'standard',
    includeCompetitors: true,
    includeEvidenceLinks: true,
  };
  const hasDocumentSignals = /\b(document|doc|proposal|draft|uploaded file|attachment)\b/.test(normalized);
  const hasDocumentEditIntent = /\b(edit|rewrite|refine|improve|change|update|replace)\b/.test(normalized);
  const hasDocumentReadIntent =
    /\b(summarize|summarise|read|review|outline|extract|what does it say)\b/.test(normalized) || hasEvidenceReferenceIntent;
  const hasDocumentExportIntent = /\b(export|download|pdf|docx|markdown|md)\b/.test(normalized);
  const documentEditDirective = extractDocumentEditDirective(originalMessage);

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
    const competitorQueryTarget = extractCompetitorQueryTarget(originalMessage);
    const competitorSearchQuery = competitorQueryTarget
      ? `${competitorQueryTarget} competitors alternatives`
      : 'direct competitors alternatives';
    pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
    pushIfMissing('intel.list', { section: 'competitor_accounts', limit: 20 });
    pushIfMissing('search.web', {
      query: competitorSearchQuery,
      count: 10,
      provider: 'auto',
    });
    pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
    if (hasDeepInvestigationIntent || hasRunIntent || hasFindIntent || hasV3DiscoveryIntent) {
      // Keep deep discovery optional for first-pass competitor briefs to avoid long-running stalls.
      pushIfMissing('competitors.discover_v3', {
        mode: hasDeepInvestigationIntent ? 'deep' : 'standard',
        maxCandidates: hasDeepInvestigationIntent ? 120 : 60,
        maxEnrich: hasDeepInvestigationIntent ? 10 : 6,
      });
    }
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
      query: messageWithMentions,
      depth: hasDeepInvestigationIntent ? 'deep' : 'standard',
      includeScrapling: true,
      includeAccountContext: true,
    });
  }
  if (/intake|onboard|kickoff|audit|workspace|strategy|investigat|analy[sz]e/.test(normalized)) {
    pushIfMissing('intel.list', { section: 'web_snapshots', limit: 20 });
    pushIfMissing('intel.list', { section: 'competitors', limit: 12 });
    pushIfMissing('intel.list', { section: 'community_insights', limit: 10 });
    pushIfMissing('evidence.posts', { platform: 'any', sort: 'engagement', limit: 8 });
    pushIfMissing('evidence.news', { limit: 8 });
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
    pushIfMissing('search.web', { query: originalMessage, count: 10, provider: 'auto' });
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
  if (hasDocumentKeyword) {
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
    (hasDocumentSignals || hasDocumentEditIntent || hasDocumentReadIntent || hasDocumentExportIntent)
  ) {
    const primaryDocumentId = referencedDocumentIds[0];
    if (hasDocumentEditIntent) {
      const editArgs: Record<string, unknown> = {
        documentId: primaryDocumentId,
        instruction: originalMessage,
      };
      if (documentEditDirective.quotedText) {
        editArgs.quotedText = documentEditDirective.quotedText;
      }
      if (documentEditDirective.replacementText !== undefined) {
        editArgs.replacementText = documentEditDirective.replacementText;
      }
      pushIfMissing('document.propose_edit', editArgs);
      if (documentEditDirective.quotedText && documentEditDirective.replacementText === undefined) {
        pushIfMissing('document.search', {
          documentId: primaryDocumentId,
          query: documentEditDirective.quotedText,
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
    // Library references are resolved explicitly before planning; skip heuristic retrieval.
  }

  return calls;
}

function fallbackPlannerPlan(message: string, policy: RunPolicy): RuntimePlan {
  const toolCalls = inferToolCallsFromMessage(message);
  const concise = prefersConciseOutput(message);
  const mode = policy.responseMode || 'balanced';
  const depthFromMode: 'fast' | 'deep' =
    mode === 'fast' ? 'fast' : mode === 'deep' || mode === 'pro' ? 'deep' : concise ? 'fast' : 'deep';
  return {
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
      depth: depthFromMode,
      tone: 'friendly',
    },
    runtime: {
      continuationDepth: 0,
    },
  };
}

function fallbackWriter(input: WriterInput): WriterOutput {
  const requestedModel = resolveModelForTask('workspace_chat_writer');
  const mode = input.policy.responseMode || 'balanced';
  const concise = input.policy.targetLength === 'short' || mode === 'fast' || prefersConciseOutput(input.userMessage);
  const deepMode = input.policy.targetLength === 'long' || mode === 'deep' || mode === 'pro';
  const evidence = input.toolResults
    .flatMap((result) => result.evidence)
    .slice(0, concise ? 8 : deepMode ? 20 : 14)
    .map((item, idx) => ({
      id: `e-${idx + 1}`,
      label: item.label,
      ...(item.url ? { url: item.url } : {}),
    }));

  const topHighlights = input.toolDigest.highlights
    .map((item) => String(item || '').trim())
    .map((line) =>
      line
        .replace(/\bloaded\s+\d+\s+record\(s\)\s+from\s+([a-z0-9_]+)/gi, 'Reviewed workspace evidence from $1')
        .replace(/\btool completed successfully\b/gi, 'Tool run completed')
        .trim()
    )
    .filter(Boolean)
    .filter((line) => !/^auto-continuing based on tool suggestions\.?$/i.test(line))
    .slice(0, concise ? 4 : deepMode ? 10 : 8);
  const topFacts = input.toolDigest.facts
    .map((fact) => {
      const claim = String(fact.claim || '').trim();
      if (!claim) return '';
      const evidenceSnippet = fact.evidence
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, concise ? 2 : 3);
      return evidenceSnippet.length ? `${claim} (${evidenceSnippet.join('; ')})` : claim;
    })
    .filter(Boolean)
    .slice(0, concise ? 3 : deepMode ? 9 : 7);
  const topWarnings = Array.from(
    new Set(
      input.toolResults
        .flatMap((result) => result.warnings)
        .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
  ).slice(0, concise ? 2 : deepMode ? 6 : 4);
  const hasToolResults = input.toolResults.length > 0;
  const runtimeContext = isRecord(input.runtimeContext) ? input.runtimeContext : {};
  const directiveResponse = buildCompetitorSufficiencyDirectiveResponse({
    userMessage: input.userMessage,
    toolResults: input.toolResults,
    runtimeContext,
  });
  const contextSummary: string[] = [];
  const clientName = String(runtimeContext.clientName || '').trim();
  const websites = Array.isArray(runtimeContext.websites)
    ? runtimeContext.websites.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const competitorsCount = Number(runtimeContext.competitorsCount || 0);
  const candidateCompetitorsCount = Number(runtimeContext.candidateCompetitorsCount || 0);
  const webSnapshotsCount = Number(runtimeContext.webSnapshotsCount || 0);

  if (clientName) contextSummary.push(`Workspace: ${clientName}.`);
  if (websites.length) contextSummary.push(`Known website(s): ${websites.join(', ')}.`);
  if (Number.isFinite(webSnapshotsCount) && webSnapshotsCount > 0) {
    contextSummary.push(`Stored web snapshots: ${webSnapshotsCount}.`);
  }
  if (Number.isFinite(competitorsCount) && competitorsCount > 0) {
    contextSummary.push(`Discovered competitors: ${competitorsCount}.`);
  }
  if (Number.isFinite(candidateCompetitorsCount) && candidateCompetitorsCount > 0) {
    contextSummary.push(`Candidate competitors pending review: ${candidateCompetitorsCount}.`);
  }

  const responseSections: string[] = [];
  if (directiveResponse) {
    responseSections.push(directiveResponse);
  } else if (!hasToolResults) {
    if (contextSummary.length) {
      responseSections.push(`Grounded workspace snapshot:\n${contextSummary.map((line, idx) => `${idx + 1}. ${line}`).join('\n')}`);
    }
    if (concise) {
      responseSections.push(
        'I do not have fresh tool output attached to this message yet, so I cannot verify claims from this run.'
      );
      responseSections.push('Share a URL or crawl run id and I will immediately return an evidence-backed summary.');
    } else {
      responseSections.push(
        'I do not have fresh tool output attached to this message yet, so I cannot responsibly make factual claims from this run.'
      );
      responseSections.push(
        'If you share a URL, crawl run id, or ask me to fetch/crawl now, I can produce a grounded answer that includes what was found, what it likely means for your strategy, and what to do next.'
      );
      responseSections.push(
        'If you want, I can also run a broader pass (web + social + news) and deliver a fuller narrative instead of a narrow point lookup.'
      );
    }
  } else {
    if (topHighlights.length > 0) {
      responseSections.push(topHighlights[0]);
    } else {
      responseSections.push('I reviewed the latest workspace evidence and compiled the most relevant takeaways.');
    }

    if (topHighlights.length > 1) {
      const findingLimit = concise ? 3 : 6;
      responseSections.push(
        `${concise ? 'Key findings' : 'What stands out most'}:\n${topHighlights
          .slice(1, 1 + findingLimit)
          .map((item, idx) => `${idx + 1}. ${item}`)
          .join('\n')}`
      );
    }

    if (topFacts.length > 0) {
      responseSections.push(
        `${concise ? 'Evidence references' : 'Evidence I used for this answer'}:\n${topFacts
          .map((item, idx) => `${idx + 1}. ${item}`)
          .join('\n')}`
      );
    }

    if (topWarnings.length > 0) {
      responseSections.push(
        `${concise ? 'Caveats' : 'What to keep in mind'}:\n${topWarnings.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}`
      );
    }

    if (input.policy.strictValidation || mode === 'pro') {
      responseSections.push(
        'Validation summary:\n1. Claims are constrained to evidence observed in this run.\n2. Any uncertain area is surfaced explicitly.\n3. Mutation-like actions remain approval-gated.'
      );
    }

    if (!concise) {
      responseSections.push(
        'If you want, I can now turn this into a concrete deliverable next (for example: a post concept, testing plan, or client-ready brief) using the same evidence set.'
      );
    }
  }

  const nextSteps = hasToolResults
    ? concise
      ? ['Tell me which finding to prioritize first.', 'Say "go deeper" if you want an expanded strategic pass.']
      : [
          ...input.toolDigest.openQuestions.slice(0, 3).map((item) => String(item || '').trim()).filter(Boolean),
          'Tell me which angle to deepen first: strategy implications, content ideas, or execution plan.',
          'If helpful, I can draft the next output directly from this evidence (post prompt, campaign brief, or PDF).',
        ].slice(0, 5)
    : concise
      ? ['Provide a URL or crawl run id to inspect next.']
      : [
          'Provide one URL or crawl run id and I will run a grounded pass.',
          'Tell me if you want a narrow answer (single source) or a broad answer (web + social + news).',
      ];
  const hasCompetitorSignals = /\bcompetitor|adjacent|substitute|inspiration\b/i.test(String(input.userMessage || ''));
  const allowWebSearch = input.policy.sourceScope.webSearch !== false;
  const actions: WriterOutput['actions'] = [
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

  const fallbackResponse = responseSections.filter((section) => section.trim().length > 0).join('\n\n');
  const qualityGate = applyWriterQualityGate({
    userMessage: input.userMessage,
    response: fallbackResponse,
    toolResults: input.toolResults,
    runtimeContext,
  });

  return {
    response: qualityGate.response,
    model: buildModelTelemetry(requestedModel, 'heuristic-fallback'),
    reasoning: {
      plan: input.plan.plan,
      tools: input.plan.toolCalls.map((call) => call.tool),
      assumptions: hasToolResults
        ? ['Only evidence collected in this branch run is used for factual claims.']
        : ['No tool results were available in this run.'],
      nextSteps,
      evidence,
      quality: qualityGate.quality,
    },
    actions: sanitizeWriterActions(actions, MAX_WRITER_ACTIONS),
    decisions: [],
  };
}

function fallbackValidator(): ValidatorOutput {
  return {
    pass: false,
    issues: [
      {
        code: 'VALIDATOR_UNAVAILABLE',
        severity: 'high',
        message: 'Validator fallback executed because the validation stage was unavailable.',
      },
    ],
    suggestedFixes: ['Retry this run or ask for a shorter answer to reduce validation timeout risk.'],
  };
}

export async function generatePlannerPlan(input: PlannerInput): Promise<RuntimePlan> {
  const fallback = fallbackPlannerPlan(input.userMessage, input.policy);
  const conciseRequested = prefersConciseOutput(input.userMessage);
  const disallowedTools = [
    ...(input.policy.sourceScope.webSearch ? [] : ['search.web', 'research.gather', 'competitors.discover_v3', 'evidence.news']),
    ...(input.policy.sourceScope.liveWebsiteCrawl ? [] : ['web.crawl', 'web.fetch']),
    ...(input.policy.sourceScope.socialIntel ? [] : ['evidence.posts', 'evidence.videos', 'orchestration.run']),
  ];

  const systemPrompt = [
    'You are BAT Planner (Agency Operator).',
    'Return strict JSON only.',
    'No markdown. No prose outside JSON.',
    'Always produce a plan and tool calls when evidence is needed.',
    'Never claim findings without evidence-producing tools.',
    'Prefer at least two evidence lanes when possible (web+social, web+community, etc.).',
    'Default response depth should be deep and comfortable for real users.',
    'Only choose fast depth when the user explicitly asks for concise/brief output.',
    'When the user asks for deeper research on people/accounts/handles or names DDG/Scraply, include research.gather.',
    'Use intel.get only when you have section + id/target. For overviews, use intel.list.',
    'Mutation tools require explicit approvals and should be represented via decisionRequests.',
    `Response mode for this run: ${input.policy.responseMode}.`,
    `Target response length: ${input.policy.targetLength}.`,
    `Strict validation: ${input.policy.strictValidation ? 'enabled' : 'disabled'}.`,
    `Source scope: ${JSON.stringify(input.policy.sourceScope)}.`,
    'If runtime context includes libraryPinnedRefs, treat those refs as the only admissible evidence set for factual synthesis.',
    'If runtime context indicates libraryLowTrustOnly=true, do not synthesize facts; request confirmation or fresher refs first.',
    'If the user asks for library-grounded/cited output and no pinned refs exist, ask for explicit ref selection before synthesis.',
    `Disallowed tool names for this run: ${disallowedTools.length ? disallowedTools.join(', ') : 'none'}.`,
    'Never emit a tool listed as disallowed. If disallowed tools are needed, choose allowed fallback tools.',
    `Only use tool names from this allowlist: ${ALLOWED_PLANNER_TOOL_NAMES.join(', ')}`,
    'JSON schema:',
    '{',
    '  "goal": "string",',
    '  "plan": ["step"],',
    '  "toolCalls": [{"tool":"name","args":{},"dependsOn":[]}],',
    '  "needUserInput": false,',
    '  "decisionRequests": [{"id":"...","title":"...","options":["..."],"default":"...","blocking":true}],',
    '  "responseStyle": {"depth":"fast|normal|deep","tone":"direct|friendly"}',
    '}',
  ].join('\n');

  const userPrompt = [
    `ResearchJob: ${input.researchJobId}`,
    `Branch: ${input.branchId}`,
    `Policy: ${JSON.stringify(input.policy)}`,
    `Runtime context snapshot: ${JSON.stringify(input.runtimeContext || {})}`,
    `User message: ${input.userMessage}`,
    `Recent branch messages: ${JSON.stringify(input.previousMessages.slice(-12))}`,
  ].join('\n\n');

  try {
    const { parsed } = await requestJson('workspace_chat_planner', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 900);

    if (!parsed) return fallback;

    const planSteps = normalizeStringArray(parsed.plan, 12);
    const plannerToolCalls = normalizeToolCalls(parsed.toolCalls, input.policy.maxToolRuns);
    const hasDeepResearchIntent =
      /\b(investigat|research|analy[sz]e|profile|account|person|people|creator|founder|handle)\b/i.test(input.userMessage) &&
      /\b(deep|deeper|thorough|full|comprehensive|detailed|ddg|duckduckgo|scraply|scrapling)\b/i.test(input.userMessage);
    const hasCompetitorBriefIntent = detectWriterIntent(input.userMessage) === 'competitor_brief';
    const fallbackResearchCall = fallback.toolCalls.find((entry) => entry.tool === 'research.gather');
    const plannerHasResearchGather = plannerToolCalls.some((entry) => entry.tool === 'research.gather');
    const mergedToolCalls = plannerToolCalls.length
      ? dedupeToolCalls(
          [
            ...(hasDeepResearchIntent && fallbackResearchCall && !plannerHasResearchGather ? [fallbackResearchCall] : []),
            ...plannerToolCalls,
          ],
          input.policy.maxToolRuns
        )
      : fallback.toolCalls;
    const plannerHasCompetitorEvidenceCall = mergedToolCalls.some(
      (entry) =>
        entry.tool === 'competitors.discover_v3' ||
        entry.tool === 'orchestration.run' ||
        entry.tool === 'search.web'
    );
    const mergedWithCompetitorDiscovery =
      hasCompetitorBriefIntent && !plannerHasCompetitorEvidenceCall
        ? dedupeToolCalls(
            [
              {
                tool: 'search.web',
                args: {
                  query: `${
                    extractCompetitorQueryTarget(input.userMessage) || compactDigestText(input.userMessage, 80)
                  } competitors alternatives`,
                  count: 10,
                  provider: 'auto',
                },
              },
              ...mergedToolCalls,
            ],
            input.policy.maxToolRuns
          )
        : mergedToolCalls;
    const filteredToolCalls = mergedWithCompetitorDiscovery.filter((call) => !disallowedTools.includes(call.tool));
    const decisions = normalizeDecisions(parsed.decisionRequests, 8);

    const defaultDepthFromMode =
      input.policy.responseMode === 'fast' ? 'fast' : input.policy.responseMode === 'balanced' ? 'normal' : 'deep';
    const defaultDepth = conciseRequested ? 'fast' : defaultDepthFromMode;
    const depthRaw = String((isRecord(parsed.responseStyle) ? parsed.responseStyle.depth : '') || defaultDepth).toLowerCase();
    const toneRaw = String((isRecord(parsed.responseStyle) ? parsed.responseStyle.tone : '') || 'direct').toLowerCase();

    const depth: 'fast' | 'normal' | 'deep' =
      conciseRequested
        ? 'fast'
        : depthRaw === 'fast' || depthRaw === 'deep'
          ? (depthRaw as 'fast' | 'deep')
          : 'deep';
    const tone: 'direct' | 'friendly' = toneRaw === 'friendly' ? 'friendly' : 'direct';

    return {
      goal: String(parsed.goal || fallback.goal),
      plan: planSteps.length ? planSteps : fallback.plan,
      toolCalls: filteredToolCalls.length ? filteredToolCalls : fallback.toolCalls.filter((call) => !disallowedTools.includes(call.tool)),
      needUserInput: Boolean(parsed.needUserInput),
      decisionRequests: decisions,
      responseStyle: { depth, tone },
      runtime: {
        continuationDepth: 0,
      },
    };
  } catch (error) {
    console.warn('[Runtime PromptSuite] Planner failed, using fallback:', (error as Error).message);
    return fallback;
  }
}

export async function buildEvidenceLedger(input: EvidenceLedgerInput): Promise<EvidenceLedgerOutput> {
  if (!input.toolResults.length) {
    return fallbackEvidenceLedger(input);
  }

  const systemPrompt = [
    'You are BAT Evidence Builder.',
    'Return strict JSON only.',
    'Use only provided runtime context and tool outputs.',
    `Source scope for this run: ${JSON.stringify(input.policy.sourceScope)}.`,
    'Do not infer facts from sources that are outside the provided scope.',
    'Every high-value fact must include evidenceRefIds when available.',
    'JSON schema:',
    '{',
    '  "entities": [{"id":"...","type":"...","name":"...","aliases":["..."]}],',
    '  "facts": [{"id":"...","type":"...","value":{},"confidence":0.0,"evidenceRefIds":["..."],"freshnessISO":"..."}],',
    '  "relations": [{"from":"...","rel":"...","to":"...","evidenceRefIds":["..."]}],',
    '  "gaps": [{"gap":"...","severity":"low|medium|high","recommendedSources":["..."]}],',
    '  "suggestedToolCalls": [{"tool":"tool.name","args":{}}]',
    '}',
  ].join('\\n');

  const payload = {
    userMessage: input.userMessage,
    policy: {
      responseMode: input.policy.responseMode,
      targetLength: input.policy.targetLength,
      strictValidation: input.policy.strictValidation,
      sourceScope: input.policy.sourceScope,
    },
    runtimeContext: input.runtimeContext || {},
    plan: input.plan,
    toolDigest: input.toolDigest,
    toolResults: input.toolResults,
  };

  try {
    const { parsed } = await requestJson('analysis_fast', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(payload) },
    ], 2000);

    if (!parsed) return fallbackEvidenceLedger(input);

    const entities = Array.isArray(parsed.entities)
      ? parsed.entities
          .map((entry, index) => {
            if (!isRecord(entry)) return null;
            const id = String(entry.id || `entity:${index + 1}`).trim();
            const type = String(entry.type || 'entity').trim();
            const name = String(entry.name || '').trim();
            if (!id || !type || !name) return null;
            const aliases = normalizeStringArray(entry.aliases, 8);
            return {
              id,
              type,
              name,
              ...(aliases.length ? { aliases } : {}),
            };
          })
          .filter(
            (entry): entry is { id: string; type: string; name: string; aliases?: string[] } => Boolean(entry)
          )
          .slice(0, 80)
      : [];

    const facts = Array.isArray(parsed.facts)
      ? parsed.facts
          .map((entry, index) => {
            if (!isRecord(entry)) return null;
            const id = String(entry.id || `fact:${index + 1}`).trim();
            const type = String(entry.type || 'fact').trim();
            const value = isRecord(entry.value) ? entry.value : {};
            const confidence = Number(entry.confidence);
            const evidenceRefIds = normalizeStringArray(entry.evidenceRefIds, 30);
            const freshnessISO = String(entry.freshnessISO || new Date().toISOString()).trim();
            if (!id || !type) return null;
            return {
              id,
              type,
              value,
              confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
              evidenceRefIds,
              freshnessISO,
            };
          })
          .filter(
            (
              entry
            ): entry is {
              id: string;
              type: string;
              value: Record<string, unknown>;
              confidence: number;
              evidenceRefIds: string[];
              freshnessISO: string;
            } => Boolean(entry)
          )
          .slice(0, 120)
      : [];

    const relations = Array.isArray(parsed.relations)
      ? parsed.relations
          .map((entry) => {
            if (!isRecord(entry)) return null;
            const from = String(entry.from || '').trim();
            const rel = String(entry.rel || '').trim();
            const to = String(entry.to || '').trim();
            if (!from || !rel || !to) return null;
            return {
              from,
              rel,
              to,
              evidenceRefIds: normalizeStringArray(entry.evidenceRefIds, 30),
            };
          })
          .filter(
            (entry): entry is { from: string; rel: string; to: string; evidenceRefIds: string[] } => Boolean(entry)
          )
          .slice(0, 120)
      : [];

    const gaps = Array.isArray(parsed.gaps)
      ? parsed.gaps
          .map((entry) => {
            if (!isRecord(entry)) return null;
            const gap = String(entry.gap || '').trim();
            if (!gap) return null;
            const severityRaw = String(entry.severity || 'medium').trim().toLowerCase();
            const severity = severityRaw === 'low' || severityRaw === 'high' ? severityRaw : 'medium';
            return {
              gap,
              severity: severity as 'low' | 'medium' | 'high',
              recommendedSources: normalizeStringArray(entry.recommendedSources, 8),
            };
          })
          .filter(
            (
              entry
            ): entry is { gap: string; severity: 'low' | 'medium' | 'high'; recommendedSources: string[] } =>
              Boolean(entry)
          )
          .slice(0, 40)
      : [];

    const suggestedToolCalls = Array.isArray(parsed.suggestedToolCalls)
      ? parsed.suggestedToolCalls
          .map((entry) => {
            if (!isRecord(entry)) return null;
            const tool = String(entry.tool || '').trim();
            if (!tool) return null;
            return {
              tool,
              args: isRecord(entry.args) ? entry.args : {},
            };
          })
          .filter((entry): entry is { tool: string; args: Record<string, unknown> } => Boolean(entry))
          .slice(0, 20)
      : [];

    return {
      entities,
      facts,
      relations,
      gaps,
      suggestedToolCalls,
    };
  } catch (error) {
    console.warn('[Runtime PromptSuite] Evidence ledger builder failed, using fallback:', (error as Error).message);
    return fallbackEvidenceLedger(input);
  }
}

export async function writeClientResponse(input: WriterInput): Promise<WriterOutput> {
  const fallback = fallbackWriter(input);
  const conciseRequested = prefersConciseOutput(input.userMessage);

  const systemPrompt = [
    'You are BAT Writer (client-facing communicator).',
    'Return strict JSON only.',
    'Do not include chain-of-thought.',
    'Response must be actionable, thorough, and evidence-grounded.',
    'Do not be terse. Provide enough detail to be directly usable.',
    'Default to a comfortable, high-context response with substantial detail.',
    'Only be concise when the user explicitly asks for concise/brief output.',
    `Concise mode for this request: ${conciseRequested ? 'true' : 'false'}.`,
    `Response mode: ${input.policy.responseMode}.`,
    `Target length: ${input.policy.targetLength}.`,
    `Strict validation: ${input.policy.strictValidation ? 'enabled' : 'disabled'}.`,
    `Source scope: ${JSON.stringify(input.policy.sourceScope)}.`,
    'If runtimeContext.libraryPinnedRefs exists, every key factual claim must map to those refs.',
    'If runtimeContext.libraryLowTrustOnly=true, ask for confirmation or fresher refs and avoid direct factual assertions.',
    'If the user asked for evidence/library grounding and no pinned refs are present, ask the user to select refs first.',
    'Mode behavior:',
    '- fast: short answer and single next action.',
    '- balanced: clear structure with moderate detail.',
    '- deep: richer reasoning artifacts and wider evidence integration.',
    '- pro: deep + strict caveats + explicit validation summary.',
    'Synthesize evidence into clear narrative and recommendations; do not just output sparse bullet points.',
    'Never output internal IDs, run IDs, or raw system identifiers.',
    'Avoid mechanical phrasing like "Loaded X records" unless the user explicitly asked for raw logs.',
    'Use the runtime workspace context to ground baseline facts before asking for missing information.',
    'Use the evidenceLedger as the primary 3D fact source before writing the 2D response.',
    'If runtime context contains websites/snapshots/competitors, do not claim that data is unavailable or inaccessible.',
    'Never include scaffolding labels like "Fork from here", "How BAT got here", "Tools used", "Assumptions", or "Evidence".',
    'Must include recommendation, evidence-backed why, and next steps.',
    'JSON schema:',
    '{',
    '  "response": "string",',
    '  "reasoning": {',
    '    "plan": ["..."],',
    '    "tools": ["tool.name"],',
    '    "assumptions": ["..."],',
    '    "nextSteps": ["..."],',
    '    "evidence": [{"id":"...","label":"...","url":"..."}]',
    '  },',
    '  "actions": [{"label":"...","action":"...","payload":{}}],',
    '  "decisions": [{"id":"...","title":"...","options":["..."],"default":"...","blocking":true}]',
    '}',
  ].join('\n');

  const writerPayload = {
    userMessage: input.userMessage,
    policy: {
      responseMode: input.policy.responseMode,
      targetLength: input.policy.targetLength,
      strictValidation: input.policy.strictValidation,
      sourceScope: input.policy.sourceScope,
    },
    runtimeContext: input.runtimeContext || {},
    evidenceLedger: input.evidenceLedger || null,
    plan: input.plan,
    toolDigest: input.toolDigest,
    toolResults: input.toolResults,
  };

  try {
    const writerRequest = await requestJson('workspace_chat_writer', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(writerPayload) },
    ], 2200);
    const parsed = writerRequest.parsed;

    if (!parsed) return fallback;

    const reasoningRaw = isRecord(parsed.reasoning) ? parsed.reasoning : {};
    const evidenceRaw = Array.isArray(reasoningRaw.evidence) ? reasoningRaw.evidence : [];

    const evidence = evidenceRaw
      .map((entry) => {
        if (!isRecord(entry)) return null;
        const id = String(entry.id || '').trim();
        const label = String(entry.label || '').trim();
        if (!id || !label) return null;
        return {
          id,
          label,
          ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
        };
      })
      .filter((entry): entry is { id: string; label: string; url?: string } => Boolean(entry))
      .slice(0, 20);

    const actions = sanitizeWriterActions(parsed.actions, MAX_WRITER_ACTIONS);

    const qualityGate = applyWriterQualityGate({
      userMessage: input.userMessage,
      response: String(parsed.response || fallback.response),
      toolResults: input.toolResults,
      runtimeContext: isRecord(input.runtimeContext) ? input.runtimeContext : {},
    });

    return {
      response: qualityGate.response,
      model: buildModelTelemetry(writerRequest.requestedModel, writerRequest.usedModel),
      reasoning: {
        plan: normalizeStringArray(reasoningRaw.plan, 12),
        tools: normalizeStringArray(reasoningRaw.tools, 12),
        assumptions: normalizeStringArray(reasoningRaw.assumptions, 10),
        nextSteps: normalizeStringArray(reasoningRaw.nextSteps, 10),
        evidence,
        quality: qualityGate.quality,
      },
      actions,
      decisions: normalizeDecisions(parsed.decisions, 8),
    };
  } catch (error) {
    console.warn('[Runtime PromptSuite] Writer failed, using fallback:', (error as Error).message);
    return fallback;
  }
}

export async function validateClientResponse(input: ValidatorInput): Promise<ValidatorOutput> {
  const fallback = fallbackValidator();

  const systemPrompt = [
    'You are BAT Validator (trust and safety).',
    'Return strict JSON only.',
    'Check grounding, fallback quality, mutation confirmations, and response completeness.',
    `Strict validation mode: ${input.policy.strictValidation ? 'enabled' : 'disabled'}.`,
    `Source scope for this run: ${JSON.stringify(input.policy.sourceScope)}.`,
    'When strict validation is enabled, fail if claims lack evidence references.',
    'Fail if the response makes factual claims while runtime context indicates libraryLowTrustOnly=true.',
    'Fail if user requested evidence/library grounding but response does not request explicit ref selection when refs are missing.',
    'Always check source-scope compliance for the proposed response and actions.',
    'JSON schema:',
    '{',
    '  "pass": true,',
    '  "issues": [{"code":"...","severity":"low|medium|high","message":"..."}],',
    '  "suggestedFixes": ["..."]',
    '}',
  ].join('\n');

  try {
    const { parsed } = await requestJson('workspace_chat_validator', [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          userMessage: input.userMessage,
          policy: {
            responseMode: input.policy.responseMode,
            targetLength: input.policy.targetLength,
            strictValidation: input.policy.strictValidation,
            sourceScope: input.policy.sourceScope,
          },
          plan: input.plan,
          writerOutput: input.writerOutput,
          toolResults: input.toolResults,
        }),
      },
    ], 700);

    if (!parsed) return fallback;

    const issuesRaw = Array.isArray(parsed.issues) ? parsed.issues : [];
    const issues = issuesRaw
      .map((issue) => {
        if (!isRecord(issue)) return null;
        const code = String(issue.code || '').trim();
        const message = String(issue.message || '').trim();
        if (!code || !message) return null;
        const severityRaw = String(issue.severity || 'low').trim().toLowerCase();
        const severity: 'low' | 'medium' | 'high' =
          severityRaw === 'high' || severityRaw === 'medium' ? (severityRaw as 'high' | 'medium') : 'low';
        return { code, message, severity };
      })
      .filter((issue): issue is { code: string; severity: 'low' | 'medium' | 'high'; message: string } => Boolean(issue))
      .slice(0, 12);

    return {
      pass: Boolean(parsed.pass),
      issues,
      suggestedFixes: normalizeStringArray(parsed.suggestedFixes, 10),
    };
  } catch (error) {
    console.warn('[Runtime PromptSuite] Validator failed, using fallback:', (error as Error).message);
    return fallback;
  }
}
