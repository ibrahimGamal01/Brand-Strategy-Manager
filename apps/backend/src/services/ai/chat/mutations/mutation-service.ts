import { Prisma, type ChatMutationKind } from '@prisma/client';
import type { AgentContext } from '../agent-context';
import { prisma } from '../../../../lib/prisma';
import type { MutationKind, MutationPreview, MutationRequest } from './mutation-types';

const SUPPORTED_SECTION = 'competitors';
const COMPETITOR_ALLOWED_FIELDS = new Set([
  'handle',
  'platform',
  'profileUrl',
  'discoveryReason',
  'relevanceScore',
  'status',
  'postsScraped',
  'selectionState',
  'selectionReason',
  'availabilityStatus',
  'availabilityReason',
  'displayOrder',
  'evidence',
  'scoreBreakdown',
]);

const COMPETITOR_NUMERIC_FIELDS = new Set(['relevanceScore', 'postsScraped', 'displayOrder']);

function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeKind(kind: MutationKind): ChatMutationKind {
  if (kind === 'create') return 'CREATE';
  if (kind === 'update') return 'UPDATE';
  if (kind === 'delete') return 'DELETE';
  return 'CLEAR';
}

function sanitizeCompetitorData(data: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!COMPETITOR_ALLOWED_FIELDS.has(key)) continue;
    if (value === undefined) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (COMPETITOR_NUMERIC_FIELDS.has(key)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) out[key] = parsed;
      continue;
    }
    out[key] = value;
  }

  return out;
}

function buildCompetitorWhere(
  researchJobId: string,
  where?: Record<string, unknown>,
): Record<string, unknown> {
  const baseWhere: Record<string, unknown> = { researchJobId };
  if (!where) return baseWhere;

  const scalarKeys = ['id', 'handle', 'platform', 'selectionState', 'status', 'availabilityStatus', 'competitorId'];
  for (const key of scalarKeys) {
    const value = where[key];
    if (typeof value === 'string' && value.trim()) {
      baseWhere[key] = value.trim();
    }
  }

  return baseWhere;
}

function buildWarnings(kind: MutationKind, matchedCount: number): string[] {
  const warnings: string[] = [];
  if (kind === 'delete' || kind === 'clear') {
    warnings.push('This operation is destructive and cannot be auto-applied.');
  }
  if (matchedCount === 0 && kind !== 'create') {
    warnings.push('No records matched the mutation criteria.');
  }
  if (matchedCount > 20) {
    warnings.push(`Large scope detected: ${matchedCount} rows matched.`);
  }
  return warnings;
}

function buildAfterSample(params: {
  kind: MutationKind;
  beforeSample: Record<string, unknown>[];
  data: Record<string, unknown>;
}): Record<string, unknown>[] {
  if (params.kind === 'create') {
    return [toJsonSafe(params.data)];
  }
  if (params.kind === 'update') {
    return params.beforeSample.slice(0, 5).map((row) => ({ ...row, ...params.data }));
  }
  return [];
}

export async function stageMutation(
  context: AgentContext,
  request: MutationRequest,
): Promise<MutationPreview> {
  const section = String(request.section || '').trim().toLowerCase();
  if (section !== SUPPORTED_SECTION) {
    throw new Error(`Unsupported mutation section: ${section}. Currently only "${SUPPORTED_SECTION}" is enabled.`);
  }

  const kind = request.kind;
  const safeData = sanitizeCompetitorData(request.data || {});
  const where = buildCompetitorWhere(context.researchJobId, request.where);

  let matchedRows: Record<string, unknown>[] = [];
  if (kind === 'clear') {
    matchedRows = (await prisma.discoveredCompetitor.findMany({
      where: { researchJobId: context.researchJobId },
      orderBy: { discoveredAt: 'desc' },
    })) as unknown as Record<string, unknown>[];
  } else if (kind === 'create') {
    matchedRows = [];
  } else {
    matchedRows = (await prisma.discoveredCompetitor.findMany({
      where,
      orderBy: { discoveredAt: 'desc' },
    })) as unknown as Record<string, unknown>[];
  }

  const beforeSample = toJsonSafe(matchedRows.slice(0, 5));
  const afterSample = buildAfterSample({ kind, beforeSample, data: safeData });
  const warnings = buildWarnings(kind, matchedRows.length);

  const previewDraft = {
    mutationId: 'pending',
    kind,
    section,
    matchedCount: matchedRows.length,
    beforeSample,
    afterSample,
    warnings,
    requiresConfirmation: true as const,
  };

  const mutation = await prisma.chatMutation.create({
    data: {
      researchJobId: context.researchJobId,
      sessionId: context.sessionId,
      kind: normalizeKind(kind),
      section,
      requestJson: toJsonSafe({ ...request, section, data: safeData }) as Prisma.InputJsonValue,
      previewJson: toJsonSafe(previewDraft) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return {
    ...previewDraft,
    mutationId: mutation.id,
  };
}
