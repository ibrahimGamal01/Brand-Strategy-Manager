import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { buildPlatformHandles, parseStringList } from '../intake/brain-intake-utils';
import { getPortalWorkspaceIntakeStatus } from './portal-intake';

type IntakePlatform = 'instagram' | 'tiktok' | 'youtube' | 'twitter';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function stringify(value: unknown): string {
  return String(value || '').trim();
}

function normalizeHandle(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function toAccountPlatform(value: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'x' || normalized === 'twitter') return 'x';
  return normalized;
}

function parseList(value: unknown, maxItems = 12): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, maxItems);
  }
  const text = String(value || '').trim();
  if (!text) return [];
  return text
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function stripUndefinedFromJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedFromJson(entry))
      .filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value === undefined ? null : value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue;
    out[key] = stripUndefinedFromJson(entry);
  }
  return out;
}

export async function savePortalWorkspaceIntakeDraft(
  workspaceId: string,
  payload: Record<string, unknown>
): Promise<{ ok: true; workspaceId: string }> {
  const workspace = await prisma.researchJob.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      inputData: true,
    },
  });

  if (!workspace) {
    throw new Error('Workspace not found');
  }

  const status = await getPortalWorkspaceIntakeStatus(workspaceId);
  if (!status) {
    throw new Error('Workspace not found');
  }

  const prefill = status.prefill;
  const nextPayload: Record<string, unknown> = {
    ...prefill,
    ...payload,
    handles:
      payload.handles && typeof payload.handles === 'object'
        ? payload.handles
        : prefill.handles,
  };

  const platformHandlesRaw = buildPlatformHandles(nextPayload);
  const platformHandles: Partial<Record<IntakePlatform, string>> = {};
  for (const [platformRaw, handleRaw] of Object.entries(platformHandlesRaw)) {
    const normalizedPlatform = toAccountPlatform(platformRaw);
    const normalizedHandle = normalizeHandle(handleRaw);
    if (!normalizedHandle) continue;

    if (normalizedPlatform === 'instagram') platformHandles.instagram = normalizedHandle;
    if (normalizedPlatform === 'tiktok') platformHandles.tiktok = normalizedHandle;
    if (normalizedPlatform === 'youtube') platformHandles.youtube = normalizedHandle;
    if (normalizedPlatform === 'x') platformHandles.twitter = normalizedHandle;
  }

  const channels = Object.entries(platformHandles).map(([platform, handle]) => ({
    platform: platform === 'twitter' ? 'x' : platform,
    handle,
  }));
  const primaryChannel = channels[0];

  const servicesList = parseList(nextPayload.servicesList, 20);
  const topProblems = parseList(nextPayload.topProblems, 3);
  const resultsIn90Days = parseList(nextPayload.resultsIn90Days, 2);
  const questionsBeforeBuying = parseList(nextPayload.questionsBeforeBuying, 3);
  const competitorInspirationLinks = parseList(nextPayload.competitorInspirationLinks, 5);
  const topicsToAvoid = parseList(nextPayload.topicsToAvoid, 20);
  const excludedCategories = parseStringList(nextPayload.excludedCategories);
  const secondaryGoals = parseStringList(nextPayload.secondaryGoals);
  const inputData = asRecord(workspace.inputData);

  const nextInputData = stripUndefinedFromJson({
    ...inputData,
    source: 'portal_intro_form_draft',
    intakeVersion: 'portal-v2-draft',
    draftSavedAt: new Date().toISOString(),
    brandName: stringify(nextPayload.name) || undefined,
    niche: stringify(nextPayload.niche),
    businessType: stringify(nextPayload.businessType),
    website: stringify(nextPayload.website),
    description: stringify(nextPayload.oneSentenceDescription),
    businessOverview: stringify(nextPayload.oneSentenceDescription),
    mainOffer: stringify(nextPayload.mainOffer),
    primaryGoal: stringify(nextPayload.primaryGoal),
    secondaryGoals: secondaryGoals.length ? secondaryGoals : undefined,
    futureGoal: stringify(nextPayload.futureGoal),
    engineGoal: stringify(nextPayload.engineGoal),
    operateWhere: stringify(nextPayload.operateWhere),
    wantClientsWhere: stringify(nextPayload.wantClientsWhere),
    idealAudience: stringify(nextPayload.idealAudience),
    targetAudience: stringify(nextPayload.targetAudience),
    geoScope: stringify(nextPayload.geoScope),
    servicesList: servicesList.length ? servicesList : undefined,
    topProblems: topProblems.length ? topProblems : undefined,
    resultsIn90Days: resultsIn90Days.length ? resultsIn90Days : undefined,
    questionsBeforeBuying: questionsBeforeBuying.length ? questionsBeforeBuying : undefined,
    competitorInspirationLinks: competitorInspirationLinks.length
      ? competitorInspirationLinks
      : undefined,
    brandVoiceWords: stringify(nextPayload.brandVoiceWords),
    brandTone: stringify(nextPayload.brandTone),
    topicsToAvoid: topicsToAvoid.length ? topicsToAvoid : undefined,
    constraints: stringify(nextPayload.constraints),
    excludedCategories: excludedCategories.length ? excludedCategories : undefined,
    language: stringify(nextPayload.language),
    planningHorizon: stringify(nextPayload.planningHorizon),
    autonomyLevel: stringify(nextPayload.autonomyLevel) || 'assist',
    budgetSensitivity: stringify(nextPayload.budgetSensitivity),
    handles: Object.keys(platformHandles).length ? platformHandles : undefined,
    channels: channels.length ? channels : undefined,
    platform: primaryChannel?.platform,
    handle: primaryChannel?.handle,
    surfaces: channels.length ? channels.map((item) => item.platform) : undefined,
  });

  await prisma.researchJob.update({
    where: { id: workspaceId },
    data: {
      inputData: toJson(nextInputData),
    },
  });

  return { ok: true, workspaceId };
}
