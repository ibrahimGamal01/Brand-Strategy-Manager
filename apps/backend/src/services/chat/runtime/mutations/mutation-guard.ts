import { createHash } from 'node:crypto';
import { SECTION_CONFIG } from '../../../../routes/intelligence-crud-config';
import type { RuntimeAgentContext } from '../agent-context';
import type { RuntimeDecision } from '../types';
import type {
  RuntimeMutationGuardIssue,
  RuntimeMutationGuardResult,
  RuntimeMutationOperation,
  RuntimeMutationRisk,
} from './mutation-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function mutationDecisionId(operations: RuntimeMutationOperation[]): string {
  const hash = createHash('sha1')
    .update(JSON.stringify(operations))
    .digest('hex')
    .slice(0, 10);
  return `mutation_guard_${hash}`;
}

function computeRiskScore(operations: RuntimeMutationOperation[]): number {
  let score = 0;
  for (const op of operations) {
    if (op.op === 'delete_row' || op.op === 'delete_rows' || op.op === 'clear_section') {
      score += 4;
      continue;
    }

    if (op.op === 'create_row') {
      score += 2;
      const fieldCount = Object.keys(op.values || {}).length;
      if (fieldCount > 6) score += 1;
      continue;
    }

    if (op.op === 'update_rows') {
      score += 3;
      if (!op.where || Object.keys(op.where).length === 0) score += 2;
      const fieldCount = Object.keys(op.patch || {}).length;
      if (fieldCount > 6) score += 1;
      continue;
    }

    if (op.op === 'update_row') {
      score += 2;
      const fieldCount = Object.keys(op.patch || {}).length;
      if (fieldCount > 6) score += 1;
      continue;
    }

    if (op.op === 'append_list' || op.op === 'remove_list_items') {
      score += 2;
      if ((op.values || []).length > 10) score += 1;
    }
  }

  if (operations.length > 6) score += 2;
  return score;
}

function riskFromScore(score: number): RuntimeMutationRisk {
  if (score >= 7) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function pushIssue(
  issues: RuntimeMutationGuardIssue[],
  code: string,
  message: string,
  operationIndex?: number
) {
  issues.push({
    code,
    message,
    ...(typeof operationIndex === 'number' ? { operationIndex } : {}),
  });
}

function validateSectionAndFields(input: {
  operation: RuntimeMutationOperation;
  operationIndex: number;
  context: Pick<RuntimeAgentContext, 'permissions'>;
  issues: RuntimeMutationGuardIssue[];
}) {
  const sectionKey = String(input.operation.section || '').trim();
  if (!sectionKey) {
    pushIssue(input.issues, 'MISSING_SECTION', 'Mutation operation is missing section name.', input.operationIndex);
    return;
  }

  const sectionConfig = SECTION_CONFIG[sectionKey];
  if (!sectionConfig) {
    pushIssue(input.issues, 'UNSUPPORTED_SECTION', `Unsupported mutation section "${sectionKey}".`, input.operationIndex);
    return;
  }

  if (!input.context.permissions.allowedSections.includes(sectionKey)) {
    pushIssue(
      input.issues,
      'SECTION_NOT_ALLOWED',
      `Section "${sectionKey}" is not allowed for this actor.`,
      input.operationIndex
    );
  }

  const immutable = new Set(sectionConfig.immutableFields || []);
  const editable = new Set(
    (sectionConfig.allowedFields || []).filter((field) => !immutable.has(field))
  );

  const checkPatch = (payload: Record<string, unknown>) => {
    const keys = Object.keys(payload || {});
    if (!keys.length) {
      pushIssue(
        input.issues,
        'EMPTY_PATCH',
        `Mutation operation for "${sectionKey}" has no editable fields.`,
        input.operationIndex
      );
      return;
    }

    for (const field of keys) {
      if (immutable.has(field)) {
        pushIssue(
          input.issues,
          'IMMUTABLE_FIELD',
          `Field "${field}" in "${sectionKey}" is immutable and cannot be changed.`,
          input.operationIndex
        );
        continue;
      }
      if (!editable.has(field)) {
        pushIssue(
          input.issues,
          'FIELD_NOT_ALLOWED',
          `Field "${field}" is not allowed in section "${sectionKey}".`,
          input.operationIndex
        );
      }
    }
  };

  if (input.operation.op === 'create_row') {
    checkPatch(nonEmptyRecord(input.operation.values));
    return;
  }

  if (input.operation.op === 'update_row' || input.operation.op === 'update_rows') {
    checkPatch(nonEmptyRecord(input.operation.patch));
    return;
  }

  if (input.operation.op === 'append_list' || input.operation.op === 'remove_list_items') {
    const field = String(input.operation.field || '').trim();
    if (!field) {
      pushIssue(
        input.issues,
        'MISSING_FIELD',
        `List mutation in "${sectionKey}" must provide a field name.`,
        input.operationIndex
      );
      return;
    }
    if (immutable.has(field)) {
      pushIssue(
        input.issues,
        'IMMUTABLE_FIELD',
        `Field "${field}" in "${sectionKey}" is immutable and cannot be changed.`,
        input.operationIndex
      );
      return;
    }
    if (!editable.has(field)) {
      pushIssue(
        input.issues,
        'FIELD_NOT_ALLOWED',
        `Field "${field}" is not allowed in section "${sectionKey}".`,
        input.operationIndex
      );
    }
  }
}

export function buildRuntimeMutationOperationsFromIntelToolCall(
  toolName: string,
  args: Record<string, unknown>
): RuntimeMutationOperation[] {
  if (toolName !== 'intel.stageMutation') return [];

  const section = String(args.section || '').trim();
  const kind = String(args.kind || '').trim().toLowerCase();
  const where = nonEmptyRecord(args.where);
  const data = nonEmptyRecord(args.data);

  if (!section || !kind) return [];

  if (kind === 'create') {
    return [{ op: 'create_row', section, values: data }];
  }
  if (kind === 'update') {
    const id = String(where.id || '').trim();
    if (id) {
      return [{ op: 'update_row', section, id, patch: data }];
    }
    return [{ op: 'update_rows', section, where, patch: data }];
  }
  if (kind === 'delete') {
    const id = String(where.id || '').trim();
    if (id) {
      return [{ op: 'delete_row', section, id }];
    }
    return [{ op: 'delete_rows', section, where }];
  }
  if (kind === 'clear') {
    return [{ op: 'clear_section', section }];
  }
  return [];
}

export function evaluateRuntimeMutationGuard(input: {
  context: Pick<RuntimeAgentContext, 'permissions' | 'actor'>;
  operations: RuntimeMutationOperation[];
}): RuntimeMutationGuardResult {
  const issues: RuntimeMutationGuardIssue[] = [];
  const warnings: string[] = [];

  if (!input.operations.length) {
    return {
      ok: false,
      risk: 'low',
      issues: [{ code: 'NO_OPERATIONS', message: 'No mutation operations were provided.' }],
      warnings,
      requiresDecision: false,
      allowedOperations: [],
    };
  }

  if (!input.context.permissions.canMutate) {
    pushIssue(issues, 'MUTATION_FORBIDDEN', 'Actor does not have permission to mutate intelligence.');
  }

  input.operations.forEach((operation, index) => {
    validateSectionAndFields({
      operation,
      operationIndex: index,
      context: input.context,
      issues,
    });
  });

  const riskScore = computeRiskScore(input.operations);
  const risk = riskFromScore(riskScore);
  const hasBlockingIssues = issues.length > 0;

  if (risk === 'high') {
    warnings.push('High-risk mutation detected. Explicit approval is recommended.');
  }
  if (input.context.actor.role === 'client' && risk !== 'low') {
    warnings.push('Client-scoped mutation requires explicit review before execution.');
  }

  const requiresDecision = risk === 'high';
  const decision: RuntimeDecision | undefined = requiresDecision
    ? {
        id: mutationDecisionId(input.operations),
        title: 'This mutation can impact a broad set of workspace data. Continue?',
        options: [
          { value: 'approve', label: 'Approve mutation' },
          { value: 'reject', label: 'Cancel mutation' },
        ],
        default: 'reject',
        blocking: true,
      }
    : undefined;

  return {
    ok: !hasBlockingIssues,
    risk,
    issues,
    warnings,
    requiresDecision,
    ...(decision ? { decision } : {}),
    allowedOperations: hasBlockingIssues ? [] : input.operations,
  };
}

