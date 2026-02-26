import {
  AgentRunStatus,
  AgentRunTriggerType,
  ChatBranchMessageRole,
  ChatBranchStatus,
  MessageQueueItemStatus,
  Prisma,
  ProcessEventLevel,
  ProcessEventType,
  ToolRunStatus,
} from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import type { RunPolicy, RuntimePlan } from './types';

const ACTIVE_RUN_STATUSES: AgentRunStatus[] = [
  AgentRunStatus.QUEUED,
  AgentRunStatus.RUNNING,
  AgentRunStatus.WAITING_TOOLS,
  AgentRunStatus.WAITING_USER,
];

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function listThreads(researchJobId: string, includeArchived = false) {
  return prisma.chatThread.findMany({
    where: {
      researchJobId,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    include: {
      branches: {
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getThread(researchJobId: string, threadId: string) {
  return prisma.chatThread.findFirst({
    where: { id: threadId, researchJobId },
    include: {
      branches: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function createThreadWithMainBranch(input: {
  researchJobId: string;
  title: string;
  createdBy: string;
}) {
  return prisma.$transaction(async (tx) => {
    const thread = await tx.chatThread.create({
      data: {
        researchJobId: input.researchJobId,
        title: input.title,
      },
    });

    const mainBranch = await tx.chatBranch.create({
      data: {
        threadId: thread.id,
        name: 'Main',
        createdBy: input.createdBy,
        status: ChatBranchStatus.ACTIVE,
      },
    });

    const updatedThread = await tx.chatThread.update({
      where: { id: thread.id },
      data: { pinnedBranchId: mainBranch.id },
      include: {
        branches: { orderBy: { createdAt: 'asc' } },
      },
    });

    return { thread: updatedThread, mainBranch };
  });
}

export async function getBranch(branchId: string, researchJobId?: string) {
  return prisma.chatBranch.findFirst({
    where: {
      id: branchId,
      ...(researchJobId
        ? {
            thread: {
              researchJobId,
            },
          }
        : {}),
    },
    include: {
      thread: true,
    },
  });
}

export async function listBranches(threadId: string, includeArchived = false) {
  return prisma.chatBranch.findMany({
    where: {
      threadId,
      ...(includeArchived ? {} : { status: ChatBranchStatus.ACTIVE }),
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createBranch(input: {
  threadId: string;
  name: string;
  createdBy: string;
  forkedFromBranchId?: string | null;
  forkedFromMessageId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const branch = await tx.chatBranch.create({
      data: {
        threadId: input.threadId,
        name: input.name,
        createdBy: input.createdBy,
        forkedFromBranchId: input.forkedFromBranchId ?? null,
        forkedFromMessageId: input.forkedFromMessageId ?? null,
        status: ChatBranchStatus.ACTIVE,
      },
    });

    if (input.forkedFromBranchId) {
      const sourceMessages = await tx.chatBranchMessage.findMany({
        where: { branchId: input.forkedFromBranchId },
        orderBy: { createdAt: 'asc' },
      });

      let messagesToCopy = sourceMessages;
      if (input.forkedFromMessageId) {
        const forkIndex = sourceMessages.findIndex((message) => message.id === input.forkedFromMessageId);
        if (forkIndex >= 0) {
          messagesToCopy = sourceMessages.slice(0, forkIndex + 1);
        }
      }

      const sourceToClonedId = new Map<string, string>();
      const toInputJson = (value: Prisma.JsonValue | null): Prisma.InputJsonValue | undefined => {
        if (value === null) return undefined;
        return value as Prisma.InputJsonValue;
      };

      for (const message of messagesToCopy) {
        const cloned = await tx.chatBranchMessage.create({
          data: {
            branchId: branch.id,
            role: message.role,
            content: message.content,
            blocksJson: toInputJson(message.blocksJson),
            citationsJson: toInputJson(message.citationsJson),
            reasoningJson: toInputJson(message.reasoningJson),
            parentMessageId: message.parentMessageId
              ? sourceToClonedId.get(message.parentMessageId) || null
              : null,
            clientVisible: message.clientVisible,
          },
        });

        sourceToClonedId.set(message.id, cloned.id);
      }
    }

    await tx.chatThread.update({
      where: { id: input.threadId },
      data: { updatedAt: new Date() },
    });

    return branch;
  });
}

export async function pinThreadBranch(threadId: string, branchId: string) {
  return prisma.chatThread.update({
    where: { id: threadId },
    data: {
      pinnedBranchId: branchId,
    },
  });
}

export async function listBranchMessages(branchId: string, limit = 200) {
  return prisma.chatBranchMessage.findMany({
    where: { branchId },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(500, limit)),
  });
}

export async function createBranchMessage(input: {
  branchId: string;
  role: ChatBranchMessageRole;
  content: string;
  blocksJson?: unknown;
  citationsJson?: unknown;
  reasoningJson?: unknown;
  parentMessageId?: string | null;
  clientVisible?: boolean;
}) {
  return prisma.chatBranchMessage.create({
    data: {
      branchId: input.branchId,
      role: input.role,
      content: input.content,
      blocksJson: input.blocksJson === undefined ? undefined : toJson(input.blocksJson),
      citationsJson: input.citationsJson === undefined ? undefined : toJson(input.citationsJson),
      reasoningJson: input.reasoningJson === undefined ? undefined : toJson(input.reasoningJson),
      parentMessageId: input.parentMessageId ?? null,
      clientVisible: input.clientVisible ?? true,
    },
  });
}

export async function getBranchMessage(messageId: string) {
  return prisma.chatBranchMessage.findUnique({
    where: { id: messageId },
  });
}

export async function createAgentRun(input: {
  branchId: string;
  triggerType: AgentRunTriggerType;
  triggerMessageId?: string | null;
  policy: RunPolicy;
  plan?: RuntimePlan | null;
}) {
  return prisma.agentRun.create({
    data: {
      branchId: input.branchId,
      triggerType: input.triggerType,
      triggerMessageId: input.triggerMessageId ?? null,
      status: AgentRunStatus.QUEUED,
      policyJson: toJson(input.policy),
      planJson: input.plan ? toJson(input.plan) : undefined,
    },
    include: {
      branch: {
        include: {
          thread: true,
        },
      },
      triggerMessage: true,
      toolRuns: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function getAgentRun(runId: string) {
  return prisma.agentRun.findUnique({
    where: { id: runId },
    include: {
      branch: {
        include: {
          thread: true,
        },
      },
      triggerMessage: true,
      toolRuns: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function listActiveRuns(branchId: string) {
  return prisma.agentRun.findMany({
    where: {
      branchId,
      status: { in: ACTIVE_RUN_STATUSES },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      toolRuns: true,
    },
  });
}

export async function updateAgentRun(
  runId: string,
  data: {
    status?: AgentRunStatus;
    plan?: RuntimePlan | null;
    policy?: Record<string, unknown> | null;
    error?: string | null;
    startedAt?: Date | null;
    endedAt?: Date | null;
  }
) {
  return prisma.agentRun.update({
    where: { id: runId },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.plan !== undefined
        ? {
            planJson: data.plan === null ? Prisma.JsonNull : toJson(data.plan),
          }
        : {}),
      ...(data.policy !== undefined
        ? {
            policyJson: data.policy === null ? Prisma.JsonNull : toJson(data.policy),
          }
        : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
      ...(data.startedAt !== undefined ? { startedAt: data.startedAt } : {}),
      ...(data.endedAt !== undefined ? { endedAt: data.endedAt } : {}),
    },
  });
}

export async function createToolRun(input: {
  agentRunId: string;
  toolName: string;
  args: Record<string, unknown>;
}) {
  return prisma.toolRun.create({
    data: {
      agentRunId: input.agentRunId,
      toolName: input.toolName,
      argsJson: toJson(input.args),
      status: ToolRunStatus.QUEUED,
    },
  });
}

export async function listToolRuns(runId: string) {
  return prisma.toolRun.findMany({
    where: { agentRunId: runId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function updateToolRun(
  toolRunId: string,
  data: {
    status?: ToolRunStatus;
    result?: unknown;
    startedAt?: Date | null;
    endedAt?: Date | null;
    cost?: unknown;
    producedArtifacts?: unknown;
  }
) {
  return prisma.toolRun.update({
    where: { id: toolRunId },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.result !== undefined
        ? {
            resultJson: data.result === null ? Prisma.JsonNull : toJson(data.result),
          }
        : {}),
      ...(data.startedAt !== undefined ? { startedAt: data.startedAt } : {}),
      ...(data.endedAt !== undefined ? { endedAt: data.endedAt } : {}),
      ...(data.cost !== undefined
        ? {
            costJson: data.cost === null ? Prisma.JsonNull : toJson(data.cost),
          }
        : {}),
      ...(data.producedArtifacts !== undefined
        ? {
            producedArtifactsJson: data.producedArtifacts === null ? Prisma.JsonNull : toJson(data.producedArtifacts),
          }
        : {}),
    },
  });
}

export async function createProcessEvent(input: {
  branchId: string;
  type: ProcessEventType;
  message: string;
  level?: ProcessEventLevel;
  agentRunId?: string | null;
  toolRunId?: string | null;
  payload?: unknown;
}) {
  return prisma.processEvent.create({
    data: {
      branchId: input.branchId,
      type: input.type,
      level: input.level || ProcessEventLevel.INFO,
      message: input.message,
      agentRunId: input.agentRunId ?? null,
      toolRunId: input.toolRunId ?? null,
      payloadJson: input.payload === undefined ? undefined : toJson(input.payload),
    },
  });
}

export async function listProcessEvents(branchId: string, options?: { afterId?: string; limit?: number }) {
  const limit = Math.max(1, Math.min(500, options?.limit ?? 100));

  if (!options?.afterId) {
    const rows = await prisma.processEvent.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.reverse();
  }

  const after = await prisma.processEvent.findUnique({
    where: { id: options.afterId },
    select: { createdAt: true },
  });

  return prisma.processEvent.findMany({
    where: {
      branchId,
      ...(after ? { createdAt: { gt: after.createdAt } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

export async function enqueueMessage(input: {
  branchId: string;
  userId: string;
  content: string;
}) {
  const maxPosition = await prisma.messageQueueItem.aggregate({
    where: {
      branchId: input.branchId,
      status: MessageQueueItemStatus.QUEUED,
    },
    _max: {
      position: true,
    },
  });

  const nextPosition = (maxPosition._max.position ?? 0) + 1;

  return prisma.messageQueueItem.create({
    data: {
      branchId: input.branchId,
      userId: input.userId,
      content: input.content,
      position: nextPosition,
      status: MessageQueueItemStatus.QUEUED,
    },
  });
}

export async function listQueue(branchId: string) {
  return prisma.messageQueueItem.findMany({
    where: {
      branchId,
      status: MessageQueueItemStatus.QUEUED,
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function cancelQueueItem(branchId: string, itemId: string) {
  const updated = await prisma.messageQueueItem.updateMany({
    where: {
      id: itemId,
      branchId,
      status: MessageQueueItemStatus.QUEUED,
    },
    data: {
      status: MessageQueueItemStatus.CANCELLED,
    },
  });

  if (updated.count === 0) {
    const exists = await prisma.messageQueueItem.findFirst({
      where: { id: itemId, branchId },
      select: { id: true },
    });
    if (!exists) {
      throw new Error('Queue item not found for this branch');
    }
  }

  return listQueue(branchId);
}

export async function reorderQueue(branchId: string, orderedIds: string[]) {
  const queue = await listQueue(branchId);
  const queueIdSet = new Set(queue.map((item) => item.id));
  const filtered = orderedIds.filter((id) => queueIdSet.has(id));

  const missing = queue.filter((item) => !filtered.includes(item.id)).map((item) => item.id);
  const finalOrder = [...filtered, ...missing];

  await prisma.$transaction(
    finalOrder.map((id, idx) =>
      prisma.messageQueueItem.update({
        where: { id },
        data: { position: idx + 1 },
      })
    )
  );

  return listQueue(branchId);
}

export async function markQueueItemStatus(itemId: string, status: MessageQueueItemStatus) {
  return prisma.messageQueueItem.update({
    where: { id: itemId },
    data: { status },
  });
}

export async function popNextQueuedMessage(branchId: string) {
  const next = await prisma.messageQueueItem.findFirst({
    where: {
      branchId,
      status: MessageQueueItemStatus.QUEUED,
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });

  if (!next) return null;

  const updated = await prisma.messageQueueItem.update({
    where: { id: next.id },
    data: {
      status: MessageQueueItemStatus.SENT,
    },
  });

  return updated;
}

export async function cancelActiveRuns(branchId: string) {
  return prisma.agentRun.updateMany({
    where: {
      branchId,
      status: { in: ACTIVE_RUN_STATUSES },
    },
    data: {
      status: AgentRunStatus.CANCELLED,
      endedAt: new Date(),
      error: 'Cancelled by interrupt',
    },
  });
}

export async function cancelActiveToolRuns(branchId: string) {
  return prisma.toolRun.updateMany({
    where: {
      agentRun: {
        branchId,
        status: { in: ACTIVE_RUN_STATUSES },
      },
      status: { in: [ToolRunStatus.QUEUED, ToolRunStatus.RUNNING] },
    },
    data: {
      status: ToolRunStatus.CANCELLED,
      endedAt: new Date(),
    },
  });
}

export const runtimeEnums = {
  ACTIVE_RUN_STATUSES,
};
