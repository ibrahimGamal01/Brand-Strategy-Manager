import { buildAgentContext } from '../../ai/chat/chat-tool-runtime';
import { getTool } from '../../ai/chat/tools/tool-registry';
import type { RunPolicy, RuntimeContinuation, RuntimeDecision, RuntimeEvidenceItem, RuntimeToolArtifact, RuntimeToolResult } from './types';

const CONFIRMATION_REQUIRED_MUTATION_TOOLS = new Set([
  'intel.stageMutation',
  'intel.applyMutation',
  'intel.undoMutation',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiresMutationConfirmation(toolName: string): boolean {
  return CONFIRMATION_REQUIRED_MUTATION_TOOLS.has(toolName);
}

function resolveToolTimeoutMs(toolName: string, policyTimeoutMs: number): number {
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

function normalizeArtifacts(raw: Record<string, unknown>): RuntimeToolArtifact[] {
  const artifacts = raw.artifacts;
  if (!Array.isArray(artifacts)) return [];
  const normalized: RuntimeToolArtifact[] = [];

  for (const item of artifacts) {
    if (!isRecord(item)) continue;
    const kind = String(item.kind || '').trim();
    const id = String(item.id || '').trim();
    if (!kind || !id) continue;
    normalized.push({
      kind,
      id,
      ...(typeof item.section === 'string' ? { section: item.section } : {}),
    });
  }

  return normalized;
}

function normalizeEvidence(raw: Record<string, unknown>): RuntimeEvidenceItem[] {
  const evidence = raw.evidence;
  if (Array.isArray(evidence)) {
    const normalized: RuntimeEvidenceItem[] = [];

    for (const item of evidence) {
      if (!isRecord(item)) continue;
      const kind = String(item.kind || 'url').trim();
      const label = String(item.label || item.title || '').trim();
      if (!label) continue;
      normalized.push({
        kind,
        label,
        ...(typeof item.url === 'string' ? { url: item.url } : {}),
      });
    }

    if (normalized.length) return normalized;
  }

  if (Array.isArray(raw.items)) {
    const derived: RuntimeEvidenceItem[] = [];
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
      derived.push({
        kind: 'item',
        label,
        ...(url ? { url } : {}),
      });
    }
    return derived;
  }

  return [];
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

      return {
        type,
        reason,
        suggestedNextTools,
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
    .map((warning) => String(warning || '').trim())
    .filter(Boolean)
    .slice(0, 8);
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

  if (Array.isArray(raw.items) && raw.items.length > 0) {
    return `${toolName} returned ${raw.items.length} item(s).`;
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
    const artifacts = normalizeArtifacts(asRecord);
    const evidence = normalizeEvidence(asRecord);
    const continuations = normalizeContinuations(asRecord);
    const decisions = normalizeDecisions(asRecord);
    const warnings = normalizeWarnings(asRecord);

    return {
      ok: true,
      summary,
      artifacts,
      evidence,
      continuations,
      decisions,
      warnings,
      raw: asRecord,
    };
  } catch (error: any) {
    return {
      ok: false,
      summary: `Tool ${input.toolName} failed.`,
      artifacts: [],
      evidence: [],
      continuations: [],
      decisions: [],
      warnings: [String(error?.message || 'Tool execution failed')],
    };
  }
}
