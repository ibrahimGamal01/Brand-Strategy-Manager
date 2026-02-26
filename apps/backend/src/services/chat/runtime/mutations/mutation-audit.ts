import { createHash } from 'node:crypto';
import type { RuntimeAgentContext } from '../agent-context';
import type { RuntimeMutationOperation, RuntimeMutationRisk } from './mutation-types';

export type RuntimeMutationAuditEntry = {
  auditId: string;
  createdAt: string;
  researchJobId: string;
  branchId: string;
  syntheticSessionId: string;
  runId?: string;
  actor: {
    userId?: string;
    role: RuntimeAgentContext['actor']['role'];
  };
  risk: RuntimeMutationRisk;
  operations: RuntimeMutationOperation[];
  sourceTool?: string;
  status: 'blocked' | 'staged' | 'applied' | 'undone' | 'failed';
  reason?: string;
};

function hashAuditSeed(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 12);
}

export function createRuntimeMutationAuditEntry(input: {
  context: Pick<RuntimeAgentContext, 'researchJobId' | 'branchId' | 'syntheticSessionId' | 'actor'>;
  runId?: string;
  risk: RuntimeMutationRisk;
  operations: RuntimeMutationOperation[];
  sourceTool?: string;
  status: RuntimeMutationAuditEntry['status'];
  reason?: string;
}): RuntimeMutationAuditEntry {
  const createdAt = new Date().toISOString();
  const seed = JSON.stringify({
    createdAt,
    researchJobId: input.context.researchJobId,
    branchId: input.context.branchId,
    sourceTool: input.sourceTool,
    operations: input.operations,
    status: input.status,
  });

  return {
    auditId: `mut_audit_${hashAuditSeed(seed)}`,
    createdAt,
    researchJobId: input.context.researchJobId,
    branchId: input.context.branchId,
    syntheticSessionId: input.context.syntheticSessionId,
    ...(input.runId ? { runId: input.runId } : {}),
    actor: {
      ...(input.context.actor.userId ? { userId: input.context.actor.userId } : {}),
      role: input.context.actor.role,
    },
    risk: input.risk,
    operations: input.operations,
    ...(input.sourceTool ? { sourceTool: input.sourceTool } : {}),
    status: input.status,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

