import { Prisma, type ChatMutationKind } from '@prisma/client';
import type { AgentContext } from '../agent-context';
import { prisma } from '../../../../lib/prisma';
import type {
  ApplyMutationRequest,
  ApplyMutationResult,
  MutationKind,
  MutationPreview,
  MutationRequest,
  UndoMutationRequest,
  UndoMutationResult,
} from './mutation-types';
import {
  CREATED_MARKER,
  assertToken,
  createConfirmToken,
  createUndoToken,
  toCompetitorCreateData,
  toCompetitorUpdateData,
  toJsonSafe,
} from './mutation-utils';

type MutationContext = Pick<AgentContext, 'researchJobId' | 'sessionId'>;

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

function normalizeKind(kind: MutationKind): ChatMutationKind {
  if (kind === 'create') return 'CREATE';
  if (kind === 'update') return 'UPDATE';
  if (kind === 'delete') return 'DELETE';
  return 'CLEAR';
}

function parseKind(kind: ChatMutationKind): MutationKind {
  if (kind === 'CREATE') return 'create';
  if (kind === 'UPDATE') return 'update';
  if (kind === 'DELETE') return 'delete';
  return 'clear';
}

function sanitizeCompetitorData(data: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!COMPETITOR_ALLOWED_FIELDS.has(key) || value === undefined) continue;
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

function buildCompetitorWhere(researchJobId: string, where?: Record<string, unknown>): Record<string, unknown> {
  const scopedWhere: Record<string, unknown> = { researchJobId };
  if (!where) return scopedWhere;

  const scalarKeys = ['id', 'handle', 'platform', 'selectionState', 'status', 'availabilityStatus', 'competitorId'];
  for (const key of scalarKeys) {
    const value = where[key];
    if (typeof value === 'string' && value.trim()) scopedWhere[key] = value.trim();
  }
  return scopedWhere;
}

function buildWarnings(kind: MutationKind, matchedCount: number): string[] {
  const warnings: string[] = [];
  if (kind === 'delete' || kind === 'clear') warnings.push('This operation is destructive and cannot be auto-applied.');
  if (matchedCount === 0 && kind !== 'create') warnings.push('No records matched the mutation criteria.');
  if (matchedCount > 20) warnings.push(`Large scope detected: ${matchedCount} rows matched.`);
  return warnings;
}

function buildAfterSample(kind: MutationKind, beforeSample: Record<string, unknown>[], data: Record<string, unknown>): Record<string, unknown>[] {
  if (kind === 'create') return [toJsonSafe(data)];
  if (kind === 'update') return beforeSample.slice(0, 5).map((row) => ({ ...row, ...data }));
  return [];
}

function parseStoredRequest(value: Prisma.JsonValue): MutationRequest {
  const request = (value || {}) as Record<string, unknown>;
  return {
    section: String(request.section || ''),
    kind: String(request.kind || 'update').toLowerCase() as MutationKind,
    where: typeof request.where === 'object' && request.where && !Array.isArray(request.where)
      ? (request.where as Record<string, unknown>)
      : undefined,
    data: typeof request.data === 'object' && request.data && !Array.isArray(request.data)
      ? (request.data as Record<string, unknown>)
      : undefined,
  };
}

async function getScopedMutation(context: MutationContext, mutationId: string) {
  const mutation = await prisma.chatMutation.findUnique({
    where: { id: mutationId },
    include: { undoSnapshots: true },
  });
  if (!mutation) throw new Error('Mutation not found.');
  if (mutation.researchJobId !== context.researchJobId || mutation.sessionId !== context.sessionId) {
    throw new Error('Mutation is not scoped to this chat session.');
  }
  return mutation;
}

export async function stageMutation(context: MutationContext, request: MutationRequest): Promise<MutationPreview> {
  const section = String(request.section || '').trim().toLowerCase();
  if (section !== SUPPORTED_SECTION) {
    throw new Error(`Unsupported mutation section: ${section}. Currently only "${SUPPORTED_SECTION}" is enabled.`);
  }

  const kind = request.kind;
  const safeData = sanitizeCompetitorData(request.data || {});
  const where = buildCompetitorWhere(context.researchJobId, request.where);

  const matchedRows = kind === 'create'
    ? []
    : await prisma.discoveredCompetitor.findMany({
        where: kind === 'clear' ? { researchJobId: context.researchJobId } : where,
        orderBy: { discoveredAt: 'desc' },
      });

  const beforeSample = toJsonSafe(matchedRows.slice(0, 5) as unknown as Record<string, unknown>[]);
  const afterSample = buildAfterSample(kind, beforeSample, safeData);
  const warnings = buildWarnings(kind, matchedRows.length);

  const mutation = await prisma.chatMutation.create({
    data: {
      researchJobId: context.researchJobId,
      sessionId: context.sessionId,
      kind: normalizeKind(kind),
      section,
      requestJson: toJsonSafe({ ...request, section, data: safeData }) as Prisma.InputJsonValue,
      previewJson: toJsonSafe({ beforeSample, afterSample, warnings }) as Prisma.InputJsonValue,
    },
  });

  return {
    mutationId: mutation.id,
    kind,
    section,
    confirmToken: createConfirmToken(mutation),
    matchedCount: matchedRows.length,
    beforeSample,
    afterSample,
    warnings,
    requiresConfirmation: true,
  };
}

export async function applyMutation(context: MutationContext, request: ApplyMutationRequest): Promise<ApplyMutationResult> {
  const mutation = await getScopedMutation(context, request.mutationId);
  assertToken(request.confirmToken, createConfirmToken(mutation), 'confirm token');

  const mutationRequest = parseStoredRequest(mutation.requestJson);
  const kind = parseKind(mutation.kind);
  const where = buildCompetitorWhere(context.researchJobId, mutationRequest.where);
  const safeData = sanitizeCompetitorData(mutationRequest.data || {});

  const matchedRows = kind === 'create'
    ? []
    : await prisma.discoveredCompetitor.findMany({
        where: kind === 'clear' ? { researchJobId: context.researchJobId } : where,
      });

  const appliedAt = new Date();
  const changedCount = await prisma.$transaction(async (tx) => {
    if (kind === 'create') {
      const handle = typeof safeData.handle === 'string' ? safeData.handle.trim() : '';
      const platform = typeof safeData.platform === 'string' ? safeData.platform.trim() : '';
      if (!handle || !platform) {
        throw new Error('Create mutation requires data.handle and data.platform.');
      }

      const created = await tx.discoveredCompetitor.create({
        data: {
          researchJobId: context.researchJobId,
          handle,
          platform,
          ...safeData,
        } as Prisma.DiscoveredCompetitorUncheckedCreateInput,
      });

      await tx.chatMutationUndoSnapshot.create({
        data: {
          mutationId: mutation.id,
          modelName: 'discoveredCompetitor',
          recordId: created.id,
          beforeJson: { [CREATED_MARKER]: true } as Prisma.InputJsonValue,
        },
      });
      return 1;
    }

    if (matchedRows.length) {
      await tx.chatMutationUndoSnapshot.createMany({
        data: matchedRows.map((row) => ({
          mutationId: mutation.id,
          modelName: 'discoveredCompetitor',
          recordId: row.id,
          beforeJson: toJsonSafe(row) as Prisma.InputJsonValue,
        })),
      });
    }

    if (kind === 'update') {
      const update = await tx.discoveredCompetitor.updateMany({
        where,
        data: safeData,
      });
      return update.count;
    }

    const deleted = await tx.discoveredCompetitor.deleteMany({
      where: kind === 'clear' ? { researchJobId: context.researchJobId } : where,
    });
    return deleted.count;
  });

  const updated = await prisma.chatMutation.update({
    where: { id: mutation.id },
    data: { appliedAt },
  });

  return {
    mutationId: mutation.id,
    kind,
    section: mutation.section,
    changedCount,
    undoToken: createUndoToken({ id: updated.id, sessionId: updated.sessionId, kind: updated.kind, appliedAt }),
    appliedAt: appliedAt.toISOString(),
  };
}

export async function undoMutation(context: MutationContext, request: UndoMutationRequest): Promise<UndoMutationResult> {
  const mutation = await getScopedMutation(context, request.mutationId);
  if (!mutation.appliedAt) throw new Error('Mutation has not been applied yet.');
  if (mutation.undoneAt) throw new Error('Mutation was already undone.');

  assertToken(
    request.undoToken,
    createUndoToken({ id: mutation.id, sessionId: mutation.sessionId, kind: mutation.kind, appliedAt: mutation.appliedAt }),
    'undo token',
  );

  const snapshots = mutation.undoSnapshots;
  const restoredCount = await prisma.$transaction(async (tx) => {
    let restored = 0;
    for (const snapshot of snapshots) {
      if (snapshot.modelName !== 'discoveredCompetitor') continue;
      const before = (snapshot.beforeJson || {}) as Record<string, unknown>;
      if (before[CREATED_MARKER]) {
        await tx.discoveredCompetitor.deleteMany({ where: { id: snapshot.recordId, researchJobId: context.researchJobId } });
        restored += 1;
        continue;
      }

      if (!before.id || !before.researchJobId) continue;
      await tx.discoveredCompetitor.upsert({
        where: { id: snapshot.recordId },
        create: toCompetitorCreateData(before),
        update: toCompetitorUpdateData(before),
      });
      restored += 1;
    }
    return restored;
  });

  const undoneAt = new Date();
  await prisma.chatMutation.update({
    where: { id: mutation.id },
    data: { undoneAt },
  });

  return {
    mutationId: mutation.id,
    restoredCount,
    undoneAt: undoneAt.toISOString(),
  };
}
