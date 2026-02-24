import { Prisma, type ChatMutationKind } from '@prisma/client';
import type { AgentContext } from '../agent-context';
import { SECTION_CONFIG } from '../../../../routes/intelligence-crud-config';
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
  toJsonSafe,
} from './mutation-utils';
import {
  ensureRequired,
  getDelegate,
  resolveScope,
  resolveSection,
  sanitizeData,
  sanitizeWhere,
  scopedWhere,
  touchMutationMetadata,
} from './mutation-section-utils';
type MutationContext = Pick<AgentContext, 'researchJobId' | 'sessionId'>;
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
function parseStoredRequest(value: Prisma.JsonValue): MutationRequest {
  const request = (value || {}) as Record<string, unknown>;
  return {
    section: String(request.section || ''),
    kind: String(request.kind || 'update').toLowerCase() as MutationKind,
    where:
      typeof request.where === 'object' && request.where && !Array.isArray(request.where)
        ? (request.where as Record<string, unknown>)
        : undefined,
    data:
      typeof request.data === 'object' && request.data && !Array.isArray(request.data)
        ? (request.data as Record<string, unknown>)
        : undefined,
  };
}
function buildWarnings(params: {
  kind: MutationKind;
  matchedCount: number;
  hasWhere: boolean;
  dataCount: number;
}): string[] {
  const warnings: string[] = [];
  if (params.kind === 'delete' || params.kind === 'clear') {
    warnings.push('This operation is destructive and requires confirmation.');
  }
  if (params.kind !== 'create' && !params.hasWhere && params.kind !== 'clear') {
    warnings.push('No where filter supplied. This may affect many rows.');
  }
  if (params.kind !== 'create' && params.matchedCount === 0) {
    warnings.push('No records matched the mutation criteria.');
  }
  if (params.matchedCount > 20) {
    warnings.push(`Large scope detected: ${params.matchedCount} rows matched.`);
  }
  if (params.kind === 'update' && params.dataCount === 0) {
    warnings.push('No editable fields were provided for update.');
  }
  return warnings;
}
function buildAfterSample(
  kind: MutationKind,
  beforeSample: Record<string, unknown>[],
  data: Record<string, unknown>,
): Record<string, unknown>[] {
  if (kind === 'create') return [toJsonSafe(data)];
  if (kind === 'update') return beforeSample.slice(0, 5).map((row) => ({ ...row, ...data }));
  return [];
}
function findSectionByModelName(modelName: string): string | null {
  const entry = Object.entries(SECTION_CONFIG).find(([, config]) => String(config.model) === modelName);
  return entry ? entry[0] : null;
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
  const { key: section, config } = resolveSection(request.section);
  const scope = await resolveScope(context.researchJobId);
  const kind = request.kind;
  const parsed = sanitizeData(section, config, request.data || {});
  const requiredMissing = kind === 'create' ? ensureRequired(config, parsed.data) : [];
  if (requiredMissing.length) {
    parsed.errors.push(...requiredMissing.map((field) => `Missing required field: ${field}`));
  }
  if (parsed.errors.length) {
    throw new Error(parsed.errors.join('; '));
  }
  const whereFilter = sanitizeWhere(config, request.where);
  const baseWhere = scopedWhere(config, scope, true);
  const queryWhere = kind === 'clear' ? baseWhere : { ...baseWhere, ...whereFilter };
  const delegate = getDelegate(config);
  const matchedRows =
    kind === 'create'
      ? []
      : await delegate.findMany({
          where: queryWhere,
          orderBy: config.orderBy ? { [config.orderBy.field]: config.orderBy.direction } : { updatedAt: 'desc' },
          take: 200,
        });
  const beforeSample = toJsonSafe(matchedRows.slice(0, 5) as Record<string, unknown>[]);
  const afterSample = buildAfterSample(kind, beforeSample, parsed.data);
  const warnings = buildWarnings({
    kind,
    matchedCount: matchedRows.length,
    hasWhere: Object.keys(whereFilter).length > 0,
    dataCount: Object.keys(parsed.data).length,
  });
  const mutation = await prisma.chatMutation.create({
    data: {
      researchJobId: context.researchJobId,
      sessionId: context.sessionId,
      kind: normalizeKind(kind),
      section,
      requestJson: toJsonSafe({ section, kind, where: whereFilter, data: parsed.data }) as Prisma.InputJsonValue,
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
  const { key: section, config } = resolveSection(mutationRequest.section);
  const scope = await resolveScope(context.researchJobId);
  const kind = parseKind(mutation.kind);
  const parsed = sanitizeData(section, config, mutationRequest.data || {});
  if (parsed.errors.length) {
    throw new Error(parsed.errors.join('; '));
  }
  const whereFilter = sanitizeWhere(config, mutationRequest.where);
  const baseWhere = scopedWhere(config, scope, true);
  const queryWhere = kind === 'clear' ? baseWhere : { ...baseWhere, ...whereFilter };
  const delegate = getDelegate(config);
  const matchedRows =
    kind === 'create'
      ? []
      : await delegate.findMany({
          where: queryWhere,
          take: 200,
        });
  const actor = 'chat';
  const appliedAt = new Date();
  const changedCount = await prisma.$transaction(async (tx) => {
    const txDelegate = (tx as Record<string, any>)[String(config.model)];
    if (kind === 'create') {
      const createData = touchMutationMetadata({ ...parsed.data }, actor);
      if (config.scope === 'client') createData.clientId = scope.clientId;
      else createData.researchJobId = scope.researchJobId;
      if (section === 'competitors') {
        createData.handle = String(createData.handle || '').replace(/^@+/, '').trim().toLowerCase();
        createData.platform = String(createData.platform || '').trim().toLowerCase();
        if (!createData.handle || !createData.platform) {
          throw new Error('Competitor create requires handle + platform.');
        }
        const competitor = await tx.competitor.upsert({
          where: {
            clientId_platform_handle: {
              clientId: scope.clientId,
              platform: String(createData.platform),
              handle: String(createData.handle),
            },
          },
          update: {},
          create: {
            clientId: scope.clientId,
            platform: String(createData.platform),
            handle: String(createData.handle),
          },
        });
        createData.competitorId = competitor.id;
      }
      const created = await txDelegate.create({ data: createData });
      await tx.chatMutationUndoSnapshot.create({
        data: {
          mutationId: mutation.id,
          modelName: String(config.model),
          recordId: created.id,
          beforeJson: { [CREATED_MARKER]: true } as Prisma.InputJsonValue,
        },
      });
      return 1;
    }
    if (matchedRows.length) {
      await tx.chatMutationUndoSnapshot.createMany({
        data: matchedRows.map((row: Record<string, unknown>) => ({
          mutationId: mutation.id,
          modelName: String(config.model),
          recordId: String(row.id),
          beforeJson: toJsonSafe(row) as Prisma.InputJsonValue,
        })),
      });
    }
    if (kind === 'update') {
      const updateData = touchMutationMetadata({ ...parsed.data }, actor);
      const update = await txDelegate.updateMany({
        where: queryWhere,
        data: updateData,
      });
      return Number(update.count || 0);
    }
    if (config.supportsCuration) {
      const archiveData = touchMutationMetadata(
        {
          isActive: false,
          archivedAt: new Date(),
          archivedBy: actor,
        },
        actor,
      );
      const archived = await txDelegate.updateMany({
        where: queryWhere,
        data: archiveData,
      });
      return Number(archived.count || 0);
    }
    const deleted = await txDelegate.deleteMany({ where: queryWhere });
    return Number(deleted.count || 0);
  });
  const updated = await prisma.chatMutation.update({
    where: { id: mutation.id },
    data: { appliedAt },
  });
  return {
    mutationId: mutation.id,
    kind,
    section,
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
  const scope = await resolveScope(context.researchJobId);
  const restoredCount = await prisma.$transaction(async (tx) => {
    let restored = 0;
    for (const snapshot of mutation.undoSnapshots) {
      const section = findSectionByModelName(snapshot.modelName);
      if (!section) continue;
      const config = SECTION_CONFIG[section];
      const txDelegate = (tx as Record<string, any>)[String(config.model)];
      if (!txDelegate) continue;
      const before = (snapshot.beforeJson || {}) as Record<string, unknown>;
      if (before[CREATED_MARKER]) {
        await txDelegate.deleteMany({ where: { id: snapshot.recordId } });
        restored += 1;
        continue;
      }
      if (before.researchJobId && before.researchJobId !== context.researchJobId) continue;
      if (config.scope === 'client' && before.clientId && before.clientId !== scope.clientId) continue;
      const rowId = String(before.id || snapshot.recordId || '').trim();
      if (!rowId) continue;
      const { id: _id, ...rest } = before;
      await txDelegate.upsert({
        where: { id: rowId },
        create: toJsonSafe(before),
        update: toJsonSafe(rest),
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
