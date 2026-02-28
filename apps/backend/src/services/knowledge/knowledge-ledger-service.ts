import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

type RuntimeToolResultLike = {
  ok: boolean;
  summary: string;
  continuations?: Array<{
    type: 'auto_continue' | 'manual_continue';
    reason: string;
    suggestedNextTools?: string[];
    suggestedToolCalls?: Array<{ tool: string; args: Record<string, unknown> }>;
  }>;
  raw?: Record<string, unknown>;
};

type RuntimeToolSummaryLike = {
  highlights: string[];
  facts: Array<{ claim: string; evidence: string[] }>;
  openQuestions: string[];
  recommendedContinuations: string[];
};

export type KnowledgeLedgerPayload = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compact(value: unknown, max = 300): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function uniqueStrings(values: unknown[], max = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = compact(value, 300);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeSuggestedToolCalls(results: RuntimeToolResultLike[], summary: RuntimeToolSummaryLike): Array<{ tool: string; args: Record<string, unknown> }> {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const seen = new Set<string>();

  const push = (tool: unknown, args: unknown) => {
    const toolName = compact(tool, 90);
    if (!toolName) return;
    const safeArgs = isRecord(args) ? args : {};
    const key = `${toolName}:${JSON.stringify(safeArgs)}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({ tool: toolName, args: safeArgs });
  };

  for (const result of results) {
    const continuations = Array.isArray(result.continuations) ? result.continuations : [];
    for (const continuation of continuations) {
      if (continuation.type !== 'auto_continue') continue;
      if (Array.isArray(continuation.suggestedToolCalls)) {
        for (const call of continuation.suggestedToolCalls) {
          push(call?.tool, call?.args);
        }
      }
      if (Array.isArray(continuation.suggestedNextTools)) {
        for (const tool of continuation.suggestedNextTools) {
          push(tool, {});
        }
      }
    }
  }

  if (Array.isArray(summary.recommendedContinuations)) {
    for (const tool of summary.recommendedContinuations) {
      push(tool, {});
    }
  }

  return calls.slice(0, 20);
}

function evidenceIdsFromResult(result: RuntimeToolResultLike): string[] {
  const raw = isRecord(result.raw) ? result.raw : {};
  const idsRaw = Array.isArray(raw.runtimeEvidenceRefIds) ? raw.runtimeEvidenceRefIds : [];
  return uniqueStrings(idsRaw, 30);
}

export function buildRuntimeKnowledgeLedger(input: {
  userMessage: string;
  contextSnapshot?: Record<string, unknown>;
  toolSummary: RuntimeToolSummaryLike;
  toolResults: RuntimeToolResultLike[];
}): KnowledgeLedgerPayload {
  const nowIso = new Date().toISOString();
  const context = isRecord(input.contextSnapshot) ? input.contextSnapshot : {};

  const entities: KnowledgeLedgerPayload['entities'] = [];
  const relations: KnowledgeLedgerPayload['relations'] = [];

  const clientName = compact(context.clientName, 140);
  if (clientName) {
    entities.push({ id: 'entity:workspace:client', type: 'brand', name: clientName });
  }

  const websites = Array.isArray(context.websites)
    ? uniqueStrings(context.websites, 6)
    : [];
  websites.forEach((website, idx) => {
    const id = `entity:workspace:website:${idx + 1}`;
    entities.push({ id, type: 'website', name: website });
    if (clientName) {
      relations.push({ from: 'entity:workspace:client', rel: 'HAS_SURFACE', to: id, evidenceRefIds: [] });
    }
  });

  const topCompetitors = Array.isArray(context.topCompetitors)
    ? uniqueStrings(context.topCompetitors, 8)
    : [];
  topCompetitors.forEach((competitor, idx) => {
    const id = `entity:competitor:${idx + 1}`;
    entities.push({ id, type: 'competitor', name: competitor });
    if (clientName) {
      relations.push({ from: 'entity:workspace:client', rel: 'COMPETES_WITH', to: id, evidenceRefIds: [] });
    }
  });

  const facts: KnowledgeLedgerPayload['facts'] = [];
  input.toolResults.forEach((result, index) => {
    const evidenceRefIds = evidenceIdsFromResult(result);
    facts.push({
      id: `fact:tool:${index + 1}`,
      type: result.ok ? 'tool_result' : 'tool_failure',
      value: {
        summary: compact(result.summary, 500),
      },
      confidence: result.ok ? 0.75 : 0.35,
      evidenceRefIds,
      freshnessISO: nowIso,
    });
  });

  input.toolSummary.facts.slice(0, 20).forEach((fact, index) => {
    facts.push({
      id: `fact:summary:${index + 1}`,
      type: 'summary_fact',
      value: {
        claim: compact(fact.claim, 500),
        evidence: uniqueStrings(fact.evidence, 8),
      },
      confidence: 0.7,
      evidenceRefIds: [],
      freshnessISO: nowIso,
    });
  });

  const gaps: KnowledgeLedgerPayload['gaps'] = [];
  input.toolSummary.openQuestions.slice(0, 10).forEach((question) => {
    gaps.push({
      gap: compact(question, 280),
      severity: 'medium',
      recommendedSources: ['web snapshots', 'workspace intelligence', 'competitor evidence'],
    });
  });

  if (!facts.length) {
    gaps.push({
      gap: 'No evidence-backed facts were generated for this run.',
      severity: 'high',
      recommendedSources: ['runtime tools', 'workspace snapshots'],
    });
  }

  return {
    entities,
    facts,
    relations,
    gaps,
    suggestedToolCalls: normalizeSuggestedToolCalls(input.toolResults, input.toolSummary),
  };
}

export async function createKnowledgeLedgerVersion(input: {
  researchJobId: string;
  runId?: string | null;
  source?: string;
  payload: KnowledgeLedgerPayload;
}) {
  return prisma.knowledgeLedgerVersion.create({
    data: {
      researchJobId: input.researchJobId,
      ...(input.runId ? { runId: input.runId } : {}),
      source: compact(input.source || 'runtime', 60) || 'runtime',
      payloadJson: input.payload as unknown as Prisma.JsonObject,
    },
  });
}

export async function getLatestKnowledgeLedgerVersion(input: {
  researchJobId: string;
  runId?: string;
}) {
  return prisma.knowledgeLedgerVersion.findFirst({
    where: {
      researchJobId: input.researchJobId,
      ...(input.runId ? { runId: input.runId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}
