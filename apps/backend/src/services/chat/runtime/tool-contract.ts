import { buildAgentContext } from '../../ai/chat/chat-tool-runtime';
import { getTool } from '../../ai/chat/tools/tool-registry';
import { buildRuntimeAgentContext } from './context-assembler';
import type { RuntimeAgentContext } from './agent-context';
import { createRuntimeMutationAuditEntry } from './mutations/mutation-audit';
import { buildRuntimeMutationOperationsFromIntelToolCall, evaluateRuntimeMutationGuard } from './mutations/mutation-guard';
import { persistRuntimeEvidenceRefs } from '../../evidence/workspace-evidence-service';
import { prisma } from '../../../lib/prisma';
import type { RunPolicy, RuntimeContinuation, RuntimeDecision, RuntimeEvidenceItem, RuntimeToolArtifact, RuntimeToolResult } from './types';
import type { AgentContext } from '../../ai/chat/agent-context';

const CONFIRMATION_REQUIRED_MUTATION_TOOLS = new Set([
  'intel.stageMutation',
  'intel.applyMutation',
  'intel.undoMutation',
]);

const TOOL_TIMEOUT_OVERRIDES_MS: Record<string, number> = {
  'web.crawl': 120_000,
  'web.fetch': 45_000,
  'search.web': 25_000,
  'document.generate': 90_000,
  'document.export': 90_000,
  'document.ingest': 120_000,
  'intel.list': 12_000,
  'intel.get': 12_000,
};

const RUNTIME_EVIDENCE_LEDGER_ENABLED = String(process.env.RUNTIME_EVIDENCE_LEDGER_ENABLED || 'false')
  .trim()
  .toLowerCase() === 'true';

const WEB_SEARCH_TOOLS = new Set(['search.web', 'research.gather', 'competitors.discover_v3', 'evidence.news']);
const LIVE_CRAWL_TOOLS = new Set(['web.crawl', 'web.fetch']);
const SOCIAL_INTEL_TOOLS = new Set(['evidence.posts', 'evidence.videos', 'orchestration.run']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toToolAgentContext(runtimeContext: RuntimeAgentContext): AgentContext {
  return {
    researchJobId: runtimeContext.researchJobId,
    sessionId: runtimeContext.syntheticSessionId,
    userMessage: runtimeContext.userMessage,
    chatRag: {
      researchContext: {} as any,
      researchContextText: '',
      recentMessages: [],
      historySummary: null,
      pinnedBlocks: [],
      viewedBlocks: [],
      selectedDesigns: [],
      recentAttachments: [],
      sourceHandles: [],
    },
    userContexts: [],
    links: runtimeContext.links,
    runtime: {
      nowIso: runtimeContext.nowISO,
      requestId: runtimeContext.trace.requestId,
    },
  };
}

function resolveBranchIdFromSyntheticSessionId(syntheticSessionId: string): string {
  const raw = String(syntheticSessionId || '').trim();
  if (!raw) return 'runtime-unknown';
  if (raw.startsWith('runtime-') && raw.length > 'runtime-'.length) {
    return raw.slice('runtime-'.length);
  }
  return raw;
}

function normalizeHostname(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return String(new URL(candidate).hostname || '').trim().toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isWithinWorkspaceHost(url: string, hosts: string[]): boolean {
  const hostname = normalizeHostname(url);
  if (!hostname) return false;
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function extractWorkspaceWebsiteHosts(inputData: unknown): string[] {
  if (!isRecord(inputData)) return [];
  const candidates: string[] = [];
  if (typeof inputData.website === 'string') {
    candidates.push(inputData.website);
  }
  if (Array.isArray(inputData.websites)) {
    candidates.push(...inputData.websites.map((entry) => String(entry || '')));
  }
  const hosts = new Set<string>();
  for (const candidate of candidates) {
    const hostname = normalizeHostname(candidate);
    if (!hostname) continue;
    hosts.add(hostname);
  }
  return Array.from(hosts);
}

async function evaluateSourceScopeBlock(input: {
  researchJobId: string;
  toolName: string;
  args: Record<string, unknown>;
  policy: RunPolicy;
}): Promise<{ blocked: boolean; reason?: string }> {
  const sourceScope = input.policy.sourceScope;

  if (!sourceScope.webSearch && WEB_SEARCH_TOOLS.has(input.toolName)) {
    return {
      blocked: true,
      reason: `Tool ${input.toolName} blocked because web_search is disabled.`,
    };
  }

  if (!sourceScope.socialIntel && SOCIAL_INTEL_TOOLS.has(input.toolName)) {
    return {
      blocked: true,
      reason: `Tool ${input.toolName} blocked because social_intel is disabled.`,
    };
  }

  if (!sourceScope.liveWebsiteCrawl && LIVE_CRAWL_TOOLS.has(input.toolName)) {
    const workspace = await prisma.researchJob.findUnique({
      where: { id: input.researchJobId },
      select: { inputData: true },
    });
    const hosts = extractWorkspaceWebsiteHosts(workspace?.inputData);
    if (!hosts.length) {
      return {
        blocked: true,
        reason: `Tool ${input.toolName} blocked because live_website_crawl is disabled.`,
      };
    }

    if (input.toolName === 'web.fetch') {
      const url = String(input.args.url || '').trim();
      if (!url || !isWithinWorkspaceHost(url, hosts)) {
        return {
          blocked: true,
          reason: `Tool ${input.toolName} blocked because the URL is outside known workspace websites while live_website_crawl is disabled.`,
        };
      }
    }

    if (input.toolName === 'web.crawl') {
      const urls = Array.isArray(input.args.startUrls)
        ? input.args.startUrls.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
      if (!urls.length || urls.some((url) => !isWithinWorkspaceHost(url, hosts))) {
        return {
          blocked: true,
          reason: `Tool ${input.toolName} blocked because requested crawl targets are outside known workspace websites while live_website_crawl is disabled.`,
        };
      }
    }
  }

  return { blocked: false };
}

function mergeWarnings(...groups: string[][]): string[] {
  const deduped = new Set<string>();
  for (const group of groups) {
    for (const warning of group) {
      const normalized = String(warning || '').trim();
      if (!normalized) continue;
      deduped.add(normalized);
    }
  }
  return Array.from(deduped);
}

function requiresMutationConfirmation(toolName: string): boolean {
  return CONFIRMATION_REQUIRED_MUTATION_TOOLS.has(toolName);
}

function resolveToolTimeoutMs(toolName: string, policyTimeoutMs: number): number {
  const override = TOOL_TIMEOUT_OVERRIDES_MS[String(toolName || '').trim()];
  if (typeof override === 'number' && Number.isFinite(override)) {
    return Math.max(policyTimeoutMs, override);
  }
  // Deep discovery tools can require longer wall time due to DDG subprocesses and multi-page crawls.
  if (toolName === 'research.gather') {
    return Math.max(policyTimeoutMs, 180_000);
  }
  return policyTimeoutMs;
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

function normalizeArtifacts(raw: Record<string, unknown>, toolName: string): RuntimeToolArtifact[] {
  const normalized: RuntimeToolArtifact[] = [];
  const seen = new Set<string>();

  const pushArtifact = (kindRaw: unknown, idRaw: unknown, sectionRaw?: unknown) => {
    const kind = String(kindRaw || '').trim();
    const id = String(idRaw || '').trim();
    if (!kind || !id) return;
    const section = String(sectionRaw || '').trim();
    const key = `${kind}:${id}:${section}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({
      kind,
      id,
      ...(section ? { section } : {}),
    });
  };

  const artifacts = raw.artifacts;
  if (Array.isArray(artifacts)) {
    for (const item of artifacts) {
      if (!isRecord(item)) continue;
      pushArtifact(item.kind, item.id, item.section);
    }
  }

  // Some tools return mutation identifiers without explicit artifacts.
  if (toolName === 'web.fetch') {
    pushArtifact('web_source', raw.sourceId, 'web_sources');
    pushArtifact('web_snapshot', raw.snapshotId, 'web_snapshots');
  }
  if (toolName === 'web.crawl') {
    pushArtifact('crawl_run', raw.runId, 'web_snapshots');
  }
  if (toolName === 'web.extract') {
    pushArtifact('web_extraction', raw.extractionRunId, 'web_extraction_runs');
  }
  if (toolName === 'document.generate') {
    pushArtifact('deliverable', raw.docId, 'deliverables');
    pushArtifact('workspace_document', raw.documentId, 'deliverables');
    pushArtifact('workspace_document_version', raw.versionId, 'deliverables');
  }
  if (toolName === 'document.ingest' || toolName === 'document.read' || toolName === 'document.search') {
    pushArtifact('workspace_document', raw.documentId, 'deliverables');
    pushArtifact('workspace_document_version', raw.versionId, 'deliverables');
  }
  if (toolName === 'document.propose_edit') {
    pushArtifact('workspace_document', raw.documentId, 'deliverables');
    pushArtifact('workspace_document_version', raw.baseVersionId, 'deliverables');
  }
  if (toolName === 'document.apply_edit') {
    pushArtifact('workspace_document', raw.documentId, 'deliverables');
    pushArtifact('workspace_document_version', raw.versionId, 'deliverables');
  }
  if (toolName === 'document.export') {
    pushArtifact('workspace_document', raw.documentId, 'deliverables');
    pushArtifact('workspace_document_version', raw.versionId, 'deliverables');
    pushArtifact('workspace_document_export', raw.exportId, 'deliverables');
  }

  return normalized;
}

function normalizeEvidence(raw: Record<string, unknown>): RuntimeEvidenceItem[] {
  const normalized: RuntimeEvidenceItem[] = [];
  const seen = new Set<string>();

  const pushEvidence = (entry: RuntimeEvidenceItem) => {
    const label = String(entry.label || '').trim();
    if (!label) return;
    const key = `${entry.kind}:${label}:${String(entry.url || '').trim()}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(entry);
  };

  const pushRecordEvidence = (item: Record<string, unknown>, kind: string) => {
    const label = String(
      item.title ||
        item.name ||
        item.handle ||
        item.finalUrl ||
        item.url ||
        item.href ||
        item.profileUrl ||
        item.id ||
        ''
    ).trim();
    if (!label) return;
    const url =
      typeof item.url === 'string'
        ? item.url
        : typeof item.href === 'string'
          ? item.href
          : typeof item.finalUrl === 'string'
            ? item.finalUrl
            : typeof item.profileUrl === 'string'
              ? item.profileUrl
              : typeof item.internalLink === 'string'
                ? item.internalLink
                : undefined;
    pushEvidence({
      kind,
      label,
      ...(url ? { url } : {}),
    });
  };

  const evidence = raw.evidence;
  if (Array.isArray(evidence)) {
    for (const item of evidence) {
      if (!isRecord(item)) continue;
      const kind = String(item.kind || 'url').trim();
      const label = String(item.label || item.title || '').trim();
      if (!label) continue;
      pushEvidence({
        kind,
        label,
        ...(typeof item.url === 'string' ? { url: item.url } : {}),
        ...(typeof item.refId === 'string' ? { refId: item.refId } : {}),
        ...(typeof item.status === 'string' ? { status: item.status as RuntimeEvidenceItem['status'] } : {}),
        ...(typeof item.provider === 'string' ? { provider: item.provider } : {}),
        ...(Number.isFinite(Number(item.confidence)) ? { confidence: Number(item.confidence) } : {}),
        ...(typeof item.contentHash === 'string' ? { contentHash: item.contentHash } : {}),
        ...(typeof item.runId === 'string' ? { runId: item.runId } : {}),
      });
    }
  }

  if (Array.isArray(raw.items)) {
    for (const item of raw.items.slice(0, 8)) {
      if (!isRecord(item)) continue;
      const label = String(item.title || item.captionSnippet || item.handle || item.id || '').trim();
      if (!label) continue;
      const url =
        typeof item.url === 'string'
          ? item.url
          : typeof item.permalink === 'string'
            ? item.permalink
            : typeof item.internalLink === 'string'
              ? item.internalLink
              : undefined;
      pushEvidence({
        kind: 'item',
        label,
        ...(url ? { url } : {}),
        ...(typeof item.id === 'string' ? { refId: item.id } : {}),
        ...(typeof item.contentHash === 'string' ? { contentHash: item.contentHash } : {}),
      });
    }
  }

  if (Array.isArray(raw.data)) {
    for (const item of raw.data.slice(0, 12)) {
      if (!isRecord(item)) continue;
      pushRecordEvidence(item, 'record');
    }
  }

  if (isRecord(raw.item)) {
    pushRecordEvidence(raw.item, 'record');
  }

  const section = String(raw.section || '').trim();
  const deepLink = typeof raw.deepLink === 'string' ? raw.deepLink.trim() : '';
  if (deepLink) {
    pushEvidence({
      kind: 'internal',
      label: section ? `Open ${section} in Intelligence` : 'Open in Intelligence',
      url: deepLink,
    });
  }

  const internalLink = typeof raw.internalLink === 'string' ? raw.internalLink.trim() : '';
  if (internalLink) {
    pushEvidence({
      kind: 'internal',
      label: section ? `Open ${section} detail` : 'Open in workspace',
      url: internalLink,
    });
  }

  return normalized.slice(0, 20);
}

function normalizeContinuations(raw: Record<string, unknown>): RuntimeContinuation[] {
  if (!Array.isArray(raw.continuations)) return [];
  return raw.continuations
    .map((item) => {
      if (!isRecord(item)) return null;
      const type = item.type === 'manual_continue' ? 'manual_continue' : 'auto_continue';
      const reason = String(item.reason || '').trim();
      if (!reason) return null;
      const suggestedNextTools = Array.isArray(item.suggestedNextTools)
        ? item.suggestedNextTools
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
        : undefined;
      const suggestedToolCalls = Array.isArray(item.suggestedToolCalls)
        ? item.suggestedToolCalls
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
        : undefined;

      return {
        type,
        reason,
        ...(suggestedNextTools && suggestedNextTools.length ? { suggestedNextTools } : {}),
        ...(suggestedToolCalls && suggestedToolCalls.length ? { suggestedToolCalls } : {}),
      } as RuntimeContinuation;
    })
    .filter((item): item is RuntimeContinuation => Boolean(item));
}

function normalizeDecisions(raw: Record<string, unknown>): RuntimeDecision[] {
  if (!Array.isArray(raw.decisions)) return [];
  const decisions: RuntimeDecision[] = [];

  for (const item of raw.decisions) {
    if (!isRecord(item)) continue;
    const id = String(item.id || '').trim();
    const title = String(item.title || '').trim();
    if (!id || !title) continue;

    const options: Array<{ value: string; label?: string }> = [];
    if (Array.isArray(item.options)) {
      for (const entry of item.options) {
        if (typeof entry === 'string') {
          const value = entry.trim();
          if (value) options.push({ value });
          continue;
        }
        if (!isRecord(entry)) continue;
        const value = String(entry.value || entry.label || '').trim();
        if (!value) continue;
        options.push({ value, ...(typeof entry.label === 'string' ? { label: entry.label } : {}) });
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
  }

  return decisions;
}

function normalizeWarnings(raw: Record<string, unknown>): string[] {
  if (!Array.isArray(raw.warnings)) return [];
  return raw.warnings
    .map((warning) => String(warning || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeFailureWarning(error: unknown): string {
  const raw = String((error as any)?.message || 'Tool execution failed');
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  const compact = String(firstLine || raw || 'Tool execution failed').replace(/\s+/g, ' ').trim();
  if (!compact) return 'Tool execution failed';
  return compact.length > 260 ? `${compact.slice(0, 257)}...` : compact;
}

function summarize(raw: Record<string, unknown>, toolName: string): string {
  const genericSummary = /^(tool completed successfully\.?|tool returned \d+ item\(s\)\.?)/i;
  if (typeof raw.summary === 'string' && raw.summary.trim() && !genericSummary.test(raw.summary.trim())) {
    return raw.summary.trim();
  }

  if (typeof raw.summaryText === 'string' && raw.summaryText.trim()) {
    return raw.summaryText.trim();
  }

  if (isRecord(raw.summary)) {
    const shortlisted = Number(raw.summary.shortlisted);
    const topPicks = Number(raw.summary.topPicks);
    if (Number.isFinite(shortlisted) || Number.isFinite(topPicks)) {
      const shortlistText = Number.isFinite(shortlisted) ? `${Math.max(0, Math.floor(shortlisted))} shortlisted` : '';
      const topPickText = Number.isFinite(topPicks) ? `${Math.max(0, Math.floor(topPicks))} top picks` : '';
      return `Tool completed competitor discovery${[shortlistText, topPickText].filter(Boolean).length ? ` (${[shortlistText, topPickText].filter(Boolean).join(', ')})` : ''}.`;
    }
  }

  if (typeof raw.reason === 'string' && raw.reason.trim()) {
    return raw.reason.trim();
  }

  if (toolName === 'intel.list') {
    const count = Number(raw.count);
    const section = String(raw.section || '').trim();
    if (Number.isFinite(count)) {
      return `intel.list returned ${Math.max(0, Math.floor(count))} row(s) from ${section || 'requested section'}.`;
    }
  }

  if (toolName === 'intel.get') {
    const section = String(raw.section || '').trim();
    if (isRecord(raw.item)) {
      return `intel.get fetched 1 item from ${section || 'requested section'}.`;
    }
  }

  if (toolName === 'web.crawl') {
    const persisted = Number(raw.persisted);
    const runId = String(raw.runId || '').trim();
    if (Number.isFinite(persisted)) {
      return `web.crawl persisted ${Math.max(0, Math.floor(persisted))} page snapshot(s)${runId ? ` (runId=${runId})` : ''}.`;
    }
  }

  if (toolName === 'web.fetch') {
    const snapshotId = String(raw.snapshotId || '').trim();
    const statusCode = Number(raw.statusCode);
    if (snapshotId) {
      return `web.fetch saved snapshot ${snapshotId}${Number.isFinite(statusCode) ? ` (status ${Math.floor(statusCode)})` : ''}.`;
    }
  }

  if (toolName === 'web.extract') {
    const extractionRunId = String(raw.extractionRunId || '').trim();
    if (extractionRunId) {
      return `web.extract completed extraction run ${extractionRunId}.`;
    }
  }

  if (toolName === 'document.generate') {
    const docId = String(raw.docId || '').trim();
    const runtimeDocumentId = String(raw.documentId || '').trim();
    if (docId) {
      return runtimeDocumentId
        ? `document.generate created deliverable ${docId} and synced runtime document ${runtimeDocumentId}.`
        : `document.generate created deliverable ${docId}.`;
    }
    if (runtimeDocumentId) {
      return `document.generate synced runtime document ${runtimeDocumentId}.`;
    }
  }

  if (toolName === 'document.ingest') {
    const docs = Array.isArray(raw.documents) ? raw.documents : [];
    if (docs.length > 0) {
      return `document.ingest processed ${docs.length} uploaded document(s).`;
    }
  }

  if (toolName === 'document.read') {
    const title = String(raw.title || '').trim();
    const version = Number(raw.versionNumber);
    if (title) {
      return `document.read loaded ${title}${Number.isFinite(version) ? ` (v${Math.floor(version)})` : ''}.`;
    }
  }

  if (toolName === 'document.search') {
    const hits = Array.isArray(raw.hits) ? raw.hits.length : 0;
    if (hits > 0) {
      return `document.search found ${hits} relevant section(s).`;
    }
  }

  if (toolName === 'document.propose_edit') {
    const anchor = isRecord(raw.anchor) ? raw.anchor : null;
    const anchorMatched = anchor ? Boolean(anchor.matched) : null;
    if (anchorMatched === false) {
      return 'document.propose_edit could not match the requested quoted text in the current version.';
    }
    const changed = Boolean(raw.changed);
    return changed ? 'document.propose_edit prepared a change proposal.' : 'document.propose_edit found no effective changes.';
  }

  if (toolName === 'document.apply_edit') {
    const version = Number(raw.versionNumber);
    if (Number.isFinite(version)) {
      return `document.apply_edit created version ${Math.floor(version)}.`;
    }
  }

  if (toolName === 'document.export') {
    const format = String(raw.format || '').trim().toUpperCase();
    const exportId = String(raw.exportId || '').trim();
    if (exportId) {
      return `document.export generated ${format || 'document'} export ${exportId}.`;
    }
  }

  if (toolName === 'document.compare_versions') {
    return 'document.compare_versions summarized differences between versions.';
  }

  if (Number.isFinite(Number(raw.count)) && String(raw.section || '').trim()) {
    return `${toolName} returned ${Math.max(0, Math.floor(Number(raw.count)))} row(s) from ${String(raw.section).trim()}.`;
  }

  if (isRecord(raw.item)) {
    return `${toolName} returned one record.`;
  }

  if (Array.isArray(raw.items) && raw.items.length > 0) {
    return `${toolName} returned ${raw.items.length} item(s).`;
  }

  if (Array.isArray(raw.data) && raw.data.length > 0) {
    return `${toolName} returned ${raw.data.length} record(s).`;
  }

  return `${toolName} completed successfully.`;
}

export async function executeToolWithContract(input: {
  researchJobId: string;
  syntheticSessionId: string;
  userMessage: string;
  toolName: string;
  args: Record<string, unknown>;
  policy: RunPolicy;
  runId?: string;
}): Promise<RuntimeToolResult> {
  const tool = getTool(input.toolName);
  if (!tool) {
    return {
      ok: false,
      summary: `Unknown tool: ${input.toolName}`,
      artifacts: [],
      evidence: [],
      continuations: [],
      decisions: [],
      warnings: [`Tool ${input.toolName} is not registered.`],
    };
  }

  const sourceScopeEvaluation = await evaluateSourceScopeBlock({
    researchJobId: input.researchJobId,
    toolName: input.toolName,
    args: input.args,
    policy: input.policy,
  });
  if (sourceScopeEvaluation.blocked) {
    return {
      ok: false,
      summary: `Tool ${input.toolName} blocked by selected source scope.`,
      artifacts: [],
      evidence: [],
      continuations: [
        {
          type: 'auto_continue',
          reason: 'Use existing workspace intelligence as fallback.',
          suggestedToolCalls: [
            {
              tool: 'intel.list',
              args: { section: 'web_sources', limit: 12 },
            },
          ],
        },
      ],
      decisions: [],
      warnings: [String(sourceScopeEvaluation.reason || 'Blocked by selected source scope.')],
      raw: {
        sourceScopeBlocked: true,
        toolName: input.toolName,
      },
    };
  }

  if (tool.mutate && !input.policy.allowMutationTools && requiresMutationConfirmation(tool.name)) {
    return {
      ok: false,
      summary: `Tool ${input.toolName} requires confirmation before mutation.`,
      artifacts: [],
      evidence: [],
      continuations: [],
      decisions: [
        {
          id: `decision_${input.toolName}`,
          title: `Approve mutation tool \"${input.toolName}\"?`,
          options: [{ value: 'approve' }, { value: 'reject' }],
          default: 'reject',
          blocking: true,
        },
      ],
      warnings: ['Mutation tools are blocked by current auto-continue policy.'],
    };
  }

  try {
    const branchId = resolveBranchIdFromSyntheticSessionId(input.syntheticSessionId);
    let runtimeContext: RuntimeAgentContext | null = null;
    let runtimeContextWarning: string | null = null;
    try {
      runtimeContext = await buildRuntimeAgentContext({
        researchJobId: input.researchJobId,
        branchId,
        syntheticSessionId: input.syntheticSessionId,
        userMessage: input.userMessage,
        ...(input.runId ? { runId: input.runId } : {}),
        actor: {
          userId: input.syntheticSessionId,
          role: 'system',
        },
        permissionsOverride: {
          canMutate: input.policy.allowMutationTools,
        },
      });
    } catch (runtimeContextError: any) {
      runtimeContextWarning = `Runtime context assembly failed: ${String(
        runtimeContextError?.message || runtimeContextError || 'unknown error'
      )}`;
    }

    let mutationGuardWarnings: string[] = [];
    let mutationGuardDecision: RuntimeDecision | null = null;
    let mutationGuardAudit: Record<string, unknown> | null = null;
    if (runtimeContextWarning) {
      mutationGuardWarnings = mergeWarnings([runtimeContextWarning]);
    }

    if (input.toolName === 'intel.stageMutation') {
      const operations = buildRuntimeMutationOperationsFromIntelToolCall(input.toolName, input.args);
      if (!operations.length) {
        mutationGuardWarnings = ['Mutation guard could not infer operations from intel.stageMutation payload.'];
      } else if (!runtimeContext) {
        mutationGuardWarnings = mergeWarnings([
          ...mutationGuardWarnings,
          'Mutation guard context unavailable; mutation risk evaluation may be incomplete.',
        ]);
      } else {
        try {
          const guard = evaluateRuntimeMutationGuard({
            context: {
              permissions: runtimeContext.permissions,
              actor: runtimeContext.actor,
            },
            operations,
          });

          mutationGuardWarnings = guard.warnings;
          mutationGuardDecision = guard.requiresDecision && guard.decision ? guard.decision : null;
          mutationGuardAudit = createRuntimeMutationAuditEntry({
            context: runtimeContext,
            runId: runtimeContext.runId,
            risk: guard.risk,
            operations,
            sourceTool: input.toolName,
            status: guard.ok ? 'staged' : 'blocked',
            ...(guard.ok
              ? {}
              : {
                  reason: guard.issues.map((issue) => issue.code).join(','),
                }),
          });

          if (!guard.ok) {
            return {
              ok: false,
              summary: 'Mutation guard blocked intel.stageMutation request.',
              artifacts: [],
              evidence: [],
              continuations: [],
              decisions: mutationGuardDecision ? [mutationGuardDecision] : [],
              warnings: mergeWarnings(
                mutationGuardWarnings,
                guard.issues.map((issue) => issue.message)
              ),
              ...(mutationGuardAudit ? { raw: { runtimeMutationAudit: mutationGuardAudit } } : {}),
            };
          }
        } catch (guardError: any) {
          mutationGuardWarnings = mergeWarnings([
            `Mutation guard context assembly failed: ${String(guardError?.message || guardError || 'unknown error')}`,
          ]);
        }
      }
    }

    const agentContext: AgentContext = runtimeContext
      ? toToolAgentContext(runtimeContext)
      : (
          await buildAgentContext(
            input.researchJobId,
            input.syntheticSessionId,
            input.userMessage
          )
        ).agentContext;

    const rawResult = await withTimeout(
      tool.execute(agentContext, input.args),
      resolveToolTimeoutMs(input.toolName, input.policy.maxToolMs),
      `Tool ${input.toolName}`
    );

    const asRecord = isRecord(rawResult) ? rawResult : { value: rawResult as unknown };

    const summary = summarize(asRecord, input.toolName);
    const artifacts = normalizeArtifacts(asRecord, input.toolName);
    const evidence = normalizeEvidence(asRecord);
    const continuations = normalizeContinuations(asRecord);
    const decisions = normalizeDecisions(asRecord);
    if (mutationGuardDecision && !decisions.some((decision) => decision.id === mutationGuardDecision?.id)) {
      decisions.unshift(mutationGuardDecision);
    }
    const warnings = mergeWarnings(normalizeWarnings(asRecord), mutationGuardWarnings);
    let raw: Record<string, unknown> = mutationGuardAudit
      ? {
          ...asRecord,
          runtimeMutationAudit: mutationGuardAudit,
        }
      : asRecord;

    if (RUNTIME_EVIDENCE_LEDGER_ENABLED) {
      try {
        const persistedEvidence = await persistRuntimeEvidenceRefs({
          researchJobId: input.researchJobId,
          toolName: input.toolName,
          defaultRunId: input.runId || null,
          evidence,
          rawEvidenceRefs: isRecord(asRecord) ? asRecord.evidenceRefs : undefined,
          artifacts,
        });
        if (persistedEvidence.evidenceRefIds.length > 0) {
          raw = {
            ...raw,
            runtimeEvidenceRefIds: persistedEvidence.evidenceRefIds,
          };
        }
      } catch (evidenceError) {
        warnings.push(
          `Runtime evidence persistence failed: ${normalizeFailureWarning(evidenceError)}`
        );
      }
    }

    return {
      ok: true,
      summary,
      artifacts,
      evidence,
      continuations,
      decisions,
      warnings,
      raw,
    };
  } catch (error: any) {
    return {
      ok: false,
      summary: `Tool ${input.toolName} failed.`,
      artifacts: [],
      evidence: [],
      continuations: [],
      decisions: [],
      warnings: [normalizeFailureWarning(error)],
    };
  }
}
