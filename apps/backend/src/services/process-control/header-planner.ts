import { prisma } from '../../lib/prisma';
import type { ProcessRunTargetInput } from './request-compiler';
import {
  listBusinessStrategyCoreSectionKeys,
  listBusinessStrategyNichePacks,
  type BusinessStrategyNichePackDefinition,
  type BusinessStrategyNichePackId,
} from './standards-registry';

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
  }
  const single = normalizeText(value);
  return single ? [single] : [];
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function rankNichePack(
  packs: BusinessStrategyNichePackDefinition[],
  signalText: string
): { pack: BusinessStrategyNichePackDefinition | null; score: number } {
  const haystack = signalText.toLowerCase();
  let bestPack: BusinessStrategyNichePackDefinition | null = null;
  let bestScore = 0;

  for (const pack of packs) {
    let score = 0;
    for (const keyword of pack.signalKeywords) {
      const normalizedKeyword = keyword.toLowerCase();
      if (!normalizedKeyword) continue;
      if (haystack.includes(normalizedKeyword)) {
        score += normalizedKeyword.includes(' ') ? 3 : 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestPack = pack;
    }
  }

  return {
    pack: bestScore > 0 ? bestPack : null,
    score: bestScore,
  };
}

export type HeaderPlannerDecision = {
  ruleId: string;
  objective: string;
  targets: ProcessRunTargetInput[];
  coreSectionKeys: string[];
  nicheSectionKeys: string[];
  selectedNichePackId: BusinessStrategyNichePackId | null;
  evidenceRefs: string[];
  inputSnapshot: Record<string, unknown>;
};

export async function planBusinessStrategyHeaders(input: {
  workspaceId: string;
  objective: string;
}): Promise<HeaderPlannerDecision> {
  const workspaceId = normalizeText(input.workspaceId);
  const objective = normalizeText(input.objective) || 'Draft a near-complete business strategy in the background.';
  if (!workspaceId) {
    throw new Error('workspaceId is required for header planning');
  }

  const workspace = await prisma.researchJob.findUnique({
    where: { id: workspaceId },
    select: {
      inputData: true,
      client: {
        select: {
          name: true,
        },
      },
      workspaceEvidenceRefs: {
        select: { id: true, refId: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      webSources: {
        where: { isActive: true },
        select: { id: true, domain: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      },
      discoveredCompetitors: {
        where: { isActive: true },
        select: { id: true },
        take: 10,
      },
    },
  });

  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found for header planning`);
  }

  const inputData = asRecord(workspace.inputData);
  const coreSectionKeys = listBusinessStrategyCoreSectionKeys();
  const nichePacks = listBusinessStrategyNichePacks();

  const signalParts = dedupe([
    normalizeText(workspace.client?.name),
    normalizeText(inputData.niche),
    normalizeText(inputData.businessType),
    normalizeText(inputData.oneSentenceDescription),
    normalizeText(inputData.mainOffer),
    ...asTextList(inputData.servicesList),
    ...asTextList(inputData.topProblems),
    objective,
  ]);
  const signalText = signalParts.join(' | ');

  const ranked = rankNichePack(nichePacks, signalText);
  const nicheSectionKeys = ranked.pack ? [...ranked.pack.sectionKeys] : [];
  const selectedSectionKeys = dedupe([...coreSectionKeys, ...nicheSectionKeys]);

  const evidenceRefs = dedupe([
    ...workspace.workspaceEvidenceRefs.map((item) => normalizeText(item.refId) || item.id),
    ...workspace.webSources.map((item) => item.id),
  ]);

  const ruleId = ranked.pack
    ? `header-planner/core-plus-niche/${ranked.pack.id}/v1`
    : 'header-planner/core-only/default/v1';

  return {
    ruleId,
    objective,
    targets: [
      {
        artifactType: 'BUSINESS_STRATEGY',
        sections: selectedSectionKeys,
        objective,
      },
    ],
    coreSectionKeys,
    nicheSectionKeys,
    selectedNichePackId: ranked.pack?.id || null,
    evidenceRefs,
    inputSnapshot: {
      businessType: normalizeText(inputData.businessType),
      niche: normalizeText(inputData.niche),
      oneSentenceDescription: normalizeText(inputData.oneSentenceDescription),
      objective,
      signalParts,
      nicheCandidateCount: nichePacks.length,
      selectedNicheScore: ranked.score,
      evidenceRefCount: evidenceRefs.length,
      activeCompetitorCount: workspace.discoveredCompetitors.length,
    },
  };
}
