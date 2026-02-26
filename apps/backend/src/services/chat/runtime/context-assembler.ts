import { randomUUID } from 'node:crypto';
import { CompetitorCandidateState, ProcessEventType, type Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import {
  BuildRuntimeAgentContextInput,
  RuntimeAgentContext,
  RuntimeActorRole,
  createRuntimeModuleLinks,
  defaultRuntimePermissions,
} from './agent-context';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function trimSnippet(value: unknown, maxChars = 220): string | undefined {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function toIntakeDraft(
  answers: Array<{ questionSetId: string; questionKey: string; answer: Prisma.JsonValue; createdAt: Date }>
) {
  const draft: Record<string, unknown> = {};
  const sorted = [...answers].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const seen = new Set<string>();
  for (const answer of sorted) {
    const key = `${answer.questionSetId}::${answer.questionKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    draft[answer.questionKey] = answer.answer as unknown;
  }
  return draft;
}

function parsePendingDecisionItems(events: Array<{ payloadJson: Prisma.JsonValue | null }>) {
  const map = new Map<string, RuntimeAgentContext['runtime']['pendingDecisions'][number]>();
  for (const event of events) {
    const payload = isRecord(event.payloadJson) ? event.payloadJson : null;
    if (!payload || !Array.isArray(payload.decisions)) continue;
    for (const rawDecision of payload.decisions) {
      if (!isRecord(rawDecision)) continue;
      const id = String(rawDecision.id || '').trim();
      const title = String(rawDecision.title || '').trim();
      if (!id || !title) continue;
      const options = Array.isArray(rawDecision.options)
        ? rawDecision.options
            .map((entry) => {
              if (typeof entry === 'string') {
                const value = entry.trim();
                return value ? { value } : null;
              }
              if (!isRecord(entry)) return null;
              const value = String(entry.value || entry.label || '').trim();
              if (!value) return null;
              const label = String(entry.label || '').trim();
              return { value, ...(label ? { label } : {}) };
            })
            .filter((entry): entry is { value: string; label?: string } => Boolean(entry))
        : [];
      if (!options.length) continue;
      if (!map.has(id)) {
        map.set(id, { id, title, options });
      }
    }
  }
  return Array.from(map.values());
}

function resolveActor(input: BuildRuntimeAgentContextInput): RuntimeAgentContext['actor'] {
  const requestedRole = String(input.actor?.role || '').trim().toLowerCase();
  const role: RuntimeActorRole =
    requestedRole === 'admin' || requestedRole === 'client' || requestedRole === 'system'
      ? (requestedRole as RuntimeActorRole)
      : 'system';

  return {
    role,
    ...(input.actor?.userId ? { userId: String(input.actor.userId) } : {}),
    ...(input.actor?.orgId ? { orgId: String(input.actor.orgId) } : {}),
    ...(input.actor?.clientId ? { clientId: String(input.actor.clientId) } : {}),
  };
}

export async function buildRuntimeAgentContext(input: BuildRuntimeAgentContextInput): Promise<RuntimeAgentContext> {
  const actor = resolveActor(input);
  const appOrigin = process.env.APP_ORIGIN || process.env.FRONTEND_URL || 'https://brand-strategy-manager-frontend.vercel.app';
  const links = createRuntimeModuleLinks(appOrigin, input.researchJobId);
  const nowISO = new Date().toISOString();

  const [
    branch,
    workspace,
    intakeAnswers,
    discoveredCompetitors,
    candidateCompetitors,
    webSources,
    webSnapshots,
    queuedMessages,
    pendingDecisionEvents,
    steerMessages,
  ] = await Promise.all([
    prisma.chatBranch.findUnique({
      where: { id: input.branchId },
      select: { id: true, threadId: true },
    }),
    prisma.researchJob.findUnique({
      where: { id: input.researchJobId },
      select: {
        id: true,
        clientId: true,
        inputData: true,
        client: {
          select: {
            name: true,
            brainProfile: {
              select: {
                businessType: true,
                offerModel: true,
                primaryGoal: true,
                channels: true,
                constraints: true,
                goals: {
                  select: {
                    goalType: true,
                    targetValue: true,
                    priority: true,
                  },
                  orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
                  take: 10,
                },
              },
            },
          },
        },
      },
    }),
    prisma.clientIntakeAnswer.findMany({
      where: { researchJobId: input.researchJobId },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: {
        questionSetId: true,
        questionKey: true,
        answer: true,
        createdAt: true,
      },
    }),
    prisma.discoveredCompetitor.findMany({
      where: { researchJobId: input.researchJobId },
      orderBy: [{ selectionState: 'asc' }, { relevanceScore: 'desc' }, { updatedAt: 'desc' }],
      take: 20,
      select: {
        id: true,
        handle: true,
        platform: true,
        selectionState: true,
        relevanceScore: true,
        profileUrl: true,
        availabilityStatus: true,
        updatedAt: true,
      },
    }),
    prisma.competitorCandidateProfile.findMany({
      where: {
        researchJobId: input.researchJobId,
        state: { in: [CompetitorCandidateState.TOP_PICK, CompetitorCandidateState.SHORTLISTED, CompetitorCandidateState.DISCOVERED] },
      },
      orderBy: [{ state: 'asc' }, { relevanceScore: 'desc' }, { updatedAt: 'desc' }],
      take: 20,
      select: {
        id: true,
        handle: true,
        platform: true,
        state: true,
        relevanceScore: true,
        profileUrl: true,
        availabilityStatus: true,
        blockerReasonCode: true,
        updatedAt: true,
      },
    }),
    prisma.webSource.findMany({
      where: { researchJobId: input.researchJobId },
      orderBy: { updatedAt: 'desc' },
      take: 16,
      select: {
        id: true,
        url: true,
        domain: true,
        sourceType: true,
        updatedAt: true,
      },
    }),
    prisma.webPageSnapshot.findMany({
      where: { researchJobId: input.researchJobId },
      orderBy: { fetchedAt: 'desc' },
      take: 16,
      select: {
        id: true,
        finalUrl: true,
        statusCode: true,
        cleanText: true,
        fetchedAt: true,
      },
    }),
    prisma.messageQueueItem.findMany({
      where: { branchId: input.branchId, status: 'QUEUED' },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: 40,
      select: {
        id: true,
        content: true,
        createdAt: true,
        position: true,
      },
    }),
    prisma.processEvent.findMany({
      where: {
        branchId: input.branchId,
        type: ProcessEventType.DECISION_REQUIRED,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { payloadJson: true },
    }),
    prisma.chatBranchMessage.findMany({
      where: {
        branchId: input.branchId,
        role: 'SYSTEM',
        content: { startsWith: 'STEER_NOTE::' },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { content: true },
    }),
  ]);

  const clientDocuments = workspace?.clientId
    ? await prisma.clientDocument.findMany({
        where: { clientId: workspace.clientId },
        orderBy: { uploadedAt: 'desc' },
        take: 12,
        select: {
          id: true,
          fileName: true,
          uploadedAt: true,
          extractedText: true,
        },
      })
    : [];

  const permissions = {
    ...defaultRuntimePermissions(actor.role),
    ...(input.permissionsOverride || {}),
  };

  const inputData = isRecord(workspace?.inputData) ? workspace.inputData : {};
  const intakeDraft = toIntakeDraft(intakeAnswers);
  const discoveredCount = discoveredCompetitors.length;
  const candidateCount = candidateCompetitors.length;
  const topPicks = discoveredCompetitors.filter((entry) => entry.selectionState === 'TOP_PICK');

  const sections: RuntimeAgentContext['intelligence']['sections'] = {
    competitors: {
      section: 'competitors',
      total: discoveredCount,
      rows: discoveredCompetitors.map((entry) => ({
        id: entry.id,
        handle: entry.handle,
        platform: entry.platform,
        selectionState: entry.selectionState,
        relevanceScore: entry.relevanceScore,
        profileUrl: entry.profileUrl,
        availabilityStatus: entry.availabilityStatus,
      })),
      lastUpdatedAt: toIso(discoveredCompetitors[0]?.updatedAt),
    },
    competitor_accounts: {
      section: 'competitor_accounts',
      total: candidateCount,
      rows: candidateCompetitors.map((entry) => ({
        id: entry.id,
        handle: entry.handle,
        platform: entry.platform,
        state: entry.state,
        relevanceScore: entry.relevanceScore,
        profileUrl: entry.profileUrl,
        availabilityStatus: entry.availabilityStatus,
        blockerReasonCode: entry.blockerReasonCode,
      })),
      lastUpdatedAt: toIso(candidateCompetitors[0]?.updatedAt),
    },
    web_sources: {
      section: 'web_sources',
      total: webSources.length,
      rows: webSources.map((entry) => ({
        id: entry.id,
        url: entry.url,
        domain: entry.domain,
        sourceType: entry.sourceType,
      })),
      lastUpdatedAt: toIso(webSources[0]?.updatedAt),
    },
    web_snapshots: {
      section: 'web_snapshots',
      total: webSnapshots.length,
      rows: webSnapshots.map((entry) => ({
        id: entry.id,
        finalUrl: entry.finalUrl,
        statusCode: entry.statusCode,
        fetchedAt: toIso(entry.fetchedAt),
      })),
      lastUpdatedAt: toIso(webSnapshots[0]?.fetchedAt),
    },
  };

  const pendingDecisions = parsePendingDecisionItems(pendingDecisionEvents);
  const steerNotes = steerMessages
    .map((entry) => String(entry.content || '').replace(/^STEER_NOTE::/i, '').trim())
    .filter(Boolean);

  const branchId = branch?.id || input.branchId;
  const threadId = branch?.threadId;

  return {
    researchJobId: input.researchJobId,
    ...(threadId ? { threadId } : {}),
    branchId,
    ...(input.runId ? { runId: input.runId } : {}),
    syntheticSessionId: input.syntheticSessionId,
    userMessage: input.userMessage,
    actor: {
      ...actor,
      ...(workspace?.clientId ? { clientId: workspace.clientId } : {}),
    },
    permissions,
    workspace: {
      ...(workspace?.clientId ? { clientId: workspace.clientId } : {}),
      ...(workspace?.client?.name ? { clientName: workspace.client.name } : {}),
      inputData,
      intakeDraft,
      goals:
        workspace?.client?.brainProfile?.goals?.map((goal) => ({
          goalType: goal.goalType,
          ...(goal.targetValue ? { targetValue: goal.targetValue } : {}),
          ...(typeof goal.priority === 'number' ? { priority: goal.priority } : {}),
        })) || [],
      ...(workspace?.client?.brainProfile?.primaryGoal
        ? { brandVoice: String(workspace.client.brainProfile.primaryGoal) }
        : {}),
    },
    intelligence: {
      sections,
    },
    evidence: {
      webSnapshots: webSnapshots.map((entry) => ({
        id: entry.id,
        ...(entry.finalUrl ? { finalUrl: entry.finalUrl } : {}),
        ...(typeof entry.statusCode === 'number' ? { statusCode: entry.statusCode } : {}),
        ...(toIso(entry.fetchedAt) ? { fetchedAt: toIso(entry.fetchedAt) } : {}),
        ...(trimSnippet(entry.cleanText) ? { snippet: trimSnippet(entry.cleanText) } : {}),
      })),
      webSources: webSources.map((entry) => ({
        id: entry.id,
        url: entry.url,
        ...(entry.domain ? { domain: entry.domain } : {}),
        ...(entry.sourceType ? { sourceType: entry.sourceType } : {}),
        ...(toIso(entry.updatedAt) ? { updatedAt: toIso(entry.updatedAt) } : {}),
      })),
      documents: clientDocuments.map((entry) => ({
        id: entry.id,
        fileName: entry.fileName,
        ...(toIso(entry.uploadedAt) ? { uploadedAt: toIso(entry.uploadedAt) } : {}),
        hasExtractedText: Boolean(String(entry.extractedText || '').trim()),
      })),
      competitors: {
        discovered: discoveredCount,
        candidates: candidateCount,
        topPicks: topPicks.map((entry) => ({
          id: entry.id,
          handle: entry.handle,
          platform: entry.platform,
          relevanceScore: entry.relevanceScore,
          profileUrl: entry.profileUrl,
        })),
      },
    },
    runtime: {
      queuedMessages: queuedMessages.map((entry) => ({
        id: entry.id,
        content: entry.content,
        createdAt: entry.createdAt.toISOString(),
        position: entry.position,
      })),
      pendingDecisions,
      steerNotes,
    },
    links,
    rag: {
      ...(workspace?.client?.brainProfile
        ? {
            brainProfile: {
              businessType: workspace.client.brainProfile.businessType,
              offerModel: workspace.client.brainProfile.offerModel,
              primaryGoal: workspace.client.brainProfile.primaryGoal,
              channels: workspace.client.brainProfile.channels,
              constraints: workspace.client.brainProfile.constraints,
            },
          }
        : {}),
      competitorSummary: {
        discoveredCount,
        candidateCount,
        topPickCount: topPicks.length,
      },
      lastArtifacts: [
        ...webSnapshots.slice(0, 6).map((entry) => ({
          kind: 'web_snapshot',
          id: entry.id,
          label: entry.finalUrl || entry.id,
          ...(entry.finalUrl ? { href: entry.finalUrl } : {}),
        })),
        ...clientDocuments.slice(0, 4).map((entry) => ({
          kind: 'client_document',
          id: entry.id,
          label: entry.fileName,
        })),
      ],
    },
    trace: {
      requestId: input.requestId || randomUUID(),
      ...(input.runId ? { runId: input.runId } : {}),
    },
    nowISO,
  };
}
