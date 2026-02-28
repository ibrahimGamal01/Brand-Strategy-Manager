import { buildAgentContext } from '../../ai/chat/chat-tool-runtime';
import { getTool } from '../../ai/chat/tools/tool-registry';
import { buildRuntimeAgentContext } from './context-assembler';
import { createRuntimeMutationAuditEntry } from './mutations/mutation-audit';
import { buildRuntimeMutationOperationsFromIntelToolCall, evaluateRuntimeMutationGuard } from './mutations/mutation-guard';
import { persistRuntimeEvidenceRefs } from '../../evidence/workspace-evidence-service';
import type { RunPolicy, RuntimeContinuation, RuntimeDecision, RuntimeEvidenceItem, RuntimeToolArtifact, RuntimeToolResult } from './types';

const CONFIRMATION_REQUIRED_MUTATION_TOOLS = new Set([
  'intel.stageMutation',
  'intel.applyMutation',
  'intel.undoMutation',
]);

const TOOL_TIMEOUT_OVERRIDES_MS: Record<string, number> = {
  'web.crawl': 120_000,
  'web.fetch': 45_000,
  'search.web': 25_000,
  'document.generate': 180_000,
  'intel.list': 12_000,
  'intel.get': 12_000,
};

const RUNTIME_EVIDENCE_LEDGER_ENABLED = String(process.env.RUNTIME_EVIDENCE_LEDGER_ENABLED || 'false')
  .trim()
  .toLowerCase() === 'true';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveBranchIdFromSyntheticSessionId(syntheticSessionId: string): string {
  const raw = String(syntheticSessionId || '').trim();
  if (!raw) return 'runtime-unknown';
  if (raw.startsWith('runtime-') && raw.length > 'runtime-'.length) {
    return raw.slice('runtime-'.length);
  }
  return raw;
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
    if (docId) {
      return `document.generate created deliverable ${docId}.`;
    }
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
    let mutationGuardWarnings: string[] = [];
    let mutationGuardDecision: RuntimeDecision | null = null;
    let mutationGuardAudit: Record<string, unknown> | null = null;

    if (input.toolName === 'intel.stageMutation') {
      const branchId = resolveBranchIdFromSyntheticSessionId(input.syntheticSessionId);
      const operations = buildRuntimeMutationOperationsFromIntelToolCall(input.toolName, input.args);
      if (!operations.length) {
        mutationGuardWarnings = ['Mutation guard could not infer operations from intel.stageMutation payload.'];
      } else {
        try {
          const runtimeContext = await buildRuntimeAgentContext({
            researchJobId: input.researchJobId,
            branchId,
            syntheticSessionId: input.syntheticSessionId,
            userMessage: input.userMessage,
            actor: {
              userId: input.syntheticSessionId,
              role: 'system',
            },
            permissionsOverride: {
              canMutate: input.policy.allowMutationTools,
            },
          });

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

    const { agentContext } = await buildAgentContext(
      input.researchJobId,
      input.syntheticSessionId,
      input.userMessage
    );

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
