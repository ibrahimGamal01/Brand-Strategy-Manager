import { applyMutation, stageMutation, undoMutation } from '../../../ai/chat/mutations/mutation-service';
import type {
  ApplyMutationRequest,
  ApplyMutationResult,
  MutationPreview,
  MutationRequest,
  UndoMutationRequest,
  UndoMutationResult,
} from '../../../ai/chat/mutations/mutation-types';
import type { RuntimeAgentContext } from '../agent-context';
import { createRuntimeMutationAuditEntry } from './mutation-audit';
import {
  buildRuntimeMutationOperationsFromIntelToolCall,
  evaluateRuntimeMutationGuard,
} from './mutation-guard';

type RuntimeMutationContext = Pick<
  RuntimeAgentContext,
  'researchJobId' | 'syntheticSessionId' | 'permissions' | 'actor' | 'branchId'
> & {
  runId?: string;
};

type RuntimeMutationGuardOutcome = {
  blocked: boolean;
  reason?: string;
  warnings: string[];
  audit: ReturnType<typeof createRuntimeMutationAuditEntry>;
};

function evaluateStageGuard(
  context: RuntimeMutationContext,
  request: MutationRequest
): RuntimeMutationGuardOutcome {
  const operations = buildRuntimeMutationOperationsFromIntelToolCall('intel.stageMutation', {
    section: request.section,
    kind: request.kind,
    where: request.where,
    data: request.data,
  });

  const guard = evaluateRuntimeMutationGuard({
    context: {
      permissions: context.permissions,
      actor: context.actor,
    },
    operations,
  });

  if (!guard.ok) {
    return {
      blocked: true,
      reason: guard.issues.map((issue) => issue.message).join(' | '),
      warnings: guard.warnings,
      audit: createRuntimeMutationAuditEntry({
        context,
        runId: context.runId,
        risk: guard.risk,
        operations,
        sourceTool: 'intel.stageMutation',
        status: 'blocked',
        reason: guard.issues.map((issue) => issue.code).join(','),
      }),
    };
  }

  return {
    blocked: false,
    warnings: guard.warnings,
    audit: createRuntimeMutationAuditEntry({
      context,
      runId: context.runId,
      risk: guard.risk,
      operations,
      sourceTool: 'intel.stageMutation',
      status: 'staged',
    }),
  };
}

export async function stageRuntimeMutationWithGuard(
  context: RuntimeMutationContext,
  request: MutationRequest
): Promise<
  | {
      ok: false;
      reason: string;
      warnings: string[];
      audit: ReturnType<typeof createRuntimeMutationAuditEntry>;
    }
  | {
      ok: true;
      preview: MutationPreview;
      warnings: string[];
      audit: ReturnType<typeof createRuntimeMutationAuditEntry>;
    }
> {
  const guard = evaluateStageGuard(context, request);
  if (guard.blocked) {
    return {
      ok: false,
      reason: guard.reason || 'Mutation blocked by guard.',
      warnings: guard.warnings,
      audit: guard.audit,
    };
  }

  const preview = await stageMutation(
    {
      researchJobId: context.researchJobId,
      sessionId: context.syntheticSessionId,
    },
    request
  );

  return {
    ok: true,
    preview,
    warnings: guard.warnings,
    audit: guard.audit,
  };
}

export async function applyRuntimeMutation(
  context: Pick<RuntimeMutationContext, 'researchJobId' | 'syntheticSessionId'>,
  request: ApplyMutationRequest
): Promise<ApplyMutationResult> {
  return applyMutation(
    {
      researchJobId: context.researchJobId,
      sessionId: context.syntheticSessionId,
    },
    request
  );
}

export async function undoRuntimeMutation(
  context: Pick<RuntimeMutationContext, 'researchJobId' | 'syntheticSessionId'>,
  request: UndoMutationRequest
): Promise<UndoMutationResult> {
  return undoMutation(
    {
      researchJobId: context.researchJobId,
      sessionId: context.syntheticSessionId,
    },
    request
  );
}

