import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  buildPlatformHandles,
  getProfileUrl,
  normalizeWebsiteDomain,
  parseStringList,
  syncBrainGoals,
} from '../intake/brain-intake-utils';
import { evaluatePendingQuestionSets } from '../intake/question-workflow';
import { suggestIntakeCompletion } from '../intake/suggest-intake-completion';
import { resumeResearchJob } from '../social/research-resume';
import { resolveIntakeWebsites, seedPortalIntakeWebsites, parseWebsiteList } from './portal-intake-websites';

type IntakePlatform = 'instagram' | 'tiktok' | 'youtube' | 'twitter';

type IntakeHandles = Record<IntakePlatform, string>;

export type PortalWorkspaceIntakePrefill = {
  name: string;
  website: string;
  websites: string[];
  oneSentenceDescription: string;
  niche: string;
  businessType: string;
  operateWhere: string;
  wantClientsWhere: string;
  idealAudience: string;
  targetAudience: string;
  geoScope: string;
  servicesList: string;
  mainOffer: string;
  primaryGoal: string;
  secondaryGoals: string;
  futureGoal: string;
  engineGoal: string;
  topProblems: string;
  resultsIn90Days: string;
  questionsBeforeBuying: string;
  brandVoiceWords: string;
  brandTone: string;
  topicsToAvoid: string;
  constraints: string;
  excludedCategories: string;
  language: string;
  planningHorizon: string;
  autonomyLevel: 'assist' | 'auto';
  budgetSensitivity: string;
  competitorInspirationLinks: string;
  handles: IntakeHandles;
};

export type PortalWorkspaceIntakeStatus = {
  workspaceId: string;
  required: boolean;
  completed: boolean;
  readyForChat: boolean;
  source: string;
  updatedAt: string;
  prefill: PortalWorkspaceIntakePrefill;
  pendingQuestionSets: Array<{
    id: string;
    title: string;
    description?: string;
    questionCount: number;
  }>;
};

export type PortalWorkspaceIntakeSubmitResult = {
  success: true;
  workspaceId: string;
  client: {
    id: string;
    name: string;
  };
  researchJob: {
    id: string;
    status: string;
  };
  handles: Record<string, string>;
  pendingQuestionSets: PortalWorkspaceIntakeStatus['pendingQuestionSets'];
  message: string;
};

type WorkspaceWithClient = Prisma.ResearchJobGetPayload<{
  include: {
    client: {
      include: {
        clientAccounts: true;
        brainProfile: true;
      };
    };
  };
}>;

const EMPTY_HANDLES: IntakeHandles = {
  instagram: '',
  tiktok: '',
  youtube: '',
  twitter: '',
};

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

function joinLines(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .join('\n');
  }
  return stringify(value);
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

function fromAccountPlatform(value: string): IntakePlatform | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'instagram') return 'instagram';
  if (normalized === 'tiktok') return 'tiktok';
  if (normalized === 'youtube') return 'youtube';
  if (normalized === 'x' || normalized === 'twitter') return 'twitter';
  return null;
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

function collectHandles(job: WorkspaceWithClient): IntakeHandles {
  const handles: IntakeHandles = { ...EMPTY_HANDLES };
  const input = asRecord(job.inputData);
  const inputHandles = asRecord(input.handles);

  for (const [platformRaw, handleRaw] of Object.entries(inputHandles)) {
    const platform = fromAccountPlatform(platformRaw);
    if (!platform) continue;
    const handle = normalizeHandle(handleRaw);
    if (!handle) continue;
    handles[platform] = handle;
  }

  const channels = Array.isArray(input.channels) ? input.channels : [];
  for (const row of channels) {
    const rowRecord = asRecord(row);
    const platform = fromAccountPlatform(stringify(rowRecord.platform));
    if (!platform) continue;
    const handle = normalizeHandle(rowRecord.handle);
    if (!handle) continue;
    handles[platform] = handle;
  }

  for (const account of job.client.clientAccounts) {
    const platform = fromAccountPlatform(account.platform);
    if (!platform) continue;
    const handle = normalizeHandle(account.handle);
    if (!handle) continue;
    handles[platform] = handle;
  }

  return handles;
}

function hasRequiredIntakeData(prefill: PortalWorkspaceIntakePrefill): boolean {
  const hasName = stringify(prefill.name).length > 0;
  const hasChannel = Object.values(prefill.handles).some((handle) => normalizeHandle(handle).length > 0);
  const hasWebsite =
    stringify(prefill.website).length > 0 || parseWebsiteList(prefill.websites, 1).length > 0;
  return hasName && (hasChannel || hasWebsite);
}

function buildConstraintObject(
  payload: Record<string, unknown>,
  existingConstraints: Record<string, unknown>
): Record<string, unknown> {
  const excludedCategories = parseStringList(
    payload.excludedCategories ?? existingConstraints.excludedCategories
  );
  const topicsToAvoid = parseList(
    payload.topicsToAvoid ?? existingConstraints.topicsToAvoid,
    20
  );

  return {
    ...existingConstraints,
    operatorGoal: stringify(payload.engineGoal) || stringify(payload.operatorGoal) || undefined,
    businessConstraints: stringify(payload.constraints) || undefined,
    excludedCategories: excludedCategories.length ? excludedCategories : undefined,
    autonomyLevel: stringify(payload.autonomyLevel) || undefined,
    budgetSensitivity: stringify(payload.budgetSensitivity) || undefined,
    brandTone: stringify(payload.brandTone) || undefined,
    brandVoiceWords: stringify(payload.brandVoiceWords) || undefined,
    topicsToAvoid: topicsToAvoid.length ? topicsToAvoid : undefined,
    language: stringify(payload.language) || undefined,
    planningHorizon: stringify(payload.planningHorizon) || undefined,
  };
}

function buildPrefill(job: WorkspaceWithClient): PortalWorkspaceIntakePrefill {
  const input = asRecord(job.inputData);
  const profile = job.client.brainProfile;
  const constraints = asRecord(profile?.constraints);
  const websites = parseWebsiteList([input.website, input.websites], 8);
  const primaryWebsite = websites[0] || stringify(input.website);

  return {
    name: stringify(input.brandName) || job.client.name || '',
    website: primaryWebsite,
    websites,
    oneSentenceDescription:
      stringify(input.description) || stringify(input.businessOverview) || stringify(job.client.businessOverview),
    niche: stringify(input.niche),
    businessType: stringify(input.businessType) || stringify(profile?.businessType),
    operateWhere: stringify(input.operateWhere),
    wantClientsWhere: stringify(input.wantClientsWhere),
    idealAudience: stringify(input.idealAudience),
    targetAudience: stringify(input.targetAudience) || stringify(profile?.targetMarket),
    geoScope: stringify(input.geoScope) || stringify(profile?.geoScope),
    servicesList: joinLines(input.servicesList),
    mainOffer: stringify(input.mainOffer) || stringify(profile?.offerModel),
    primaryGoal: stringify(input.primaryGoal) || stringify(profile?.primaryGoal),
    secondaryGoals: joinLines(input.secondaryGoals || profile?.secondaryGoals),
    futureGoal: stringify(input.futureGoal),
    engineGoal: stringify(input.engineGoal || constraints.operatorGoal),
    topProblems: joinLines(input.topProblems),
    resultsIn90Days: joinLines(input.resultsIn90Days),
    questionsBeforeBuying: joinLines(input.questionsBeforeBuying),
    brandVoiceWords: stringify(input.brandVoiceWords || constraints.brandVoiceWords),
    brandTone: stringify(input.brandTone || constraints.brandTone),
    topicsToAvoid: joinLines(input.topicsToAvoid || constraints.topicsToAvoid),
    constraints: stringify(input.businessConstraints || constraints.businessConstraints),
    excludedCategories: joinLines(input.excludedCategories || constraints.excludedCategories),
    language: stringify(input.language || constraints.language),
    planningHorizon: stringify(input.planningHorizon || constraints.planningHorizon),
    autonomyLevel: stringify(input.autonomyLevel || constraints.autonomyLevel) === 'auto' ? 'auto' : 'assist',
    budgetSensitivity: stringify(input.budgetSensitivity || constraints.budgetSensitivity),
    competitorInspirationLinks: joinLines(input.competitorInspirationLinks),
    handles: collectHandles(job),
  };
}

async function getWorkspaceWithClient(workspaceId: string): Promise<WorkspaceWithClient | null> {
  return prisma.researchJob.findUnique({
    where: { id: workspaceId },
    include: {
      client: {
        include: {
          clientAccounts: true,
          brainProfile: true,
        },
      },
    },
  });
}

function summarizeQuestionSets(
  sets: Awaited<ReturnType<typeof evaluatePendingQuestionSets>>
): PortalWorkspaceIntakeStatus['pendingQuestionSets'] {
  return sets.map((set) => ({
    id: set.id,
    title: set.title,
    ...(set.description ? { description: set.description } : {}),
    questionCount: set.questions.length,
  }));
}

export async function getPortalWorkspaceIntakeStatus(
  workspaceId: string
): Promise<PortalWorkspaceIntakeStatus | null> {
  const workspace = await getWorkspaceWithClient(workspaceId);
  if (!workspace) return null;

  const prefill = buildPrefill(workspace);
  const completed = hasRequiredIntakeData(prefill);
  const pendingSets = completed ? await evaluatePendingQuestionSets(workspaceId) : [];
  const input = asRecord(workspace.inputData);

  return {
    workspaceId,
    required: !completed,
    completed,
    readyForChat: completed,
    source: stringify(input.source) || 'portal_intro_form',
    updatedAt: workspace.client.updatedAt.toISOString(),
    prefill,
    pendingQuestionSets: summarizeQuestionSets(pendingSets),
  };
}

export async function suggestPortalWorkspaceIntakeCompletion(
  workspaceId: string,
  partialPayload: Record<string, unknown>
) {
  const workspace = await getWorkspaceWithClient(workspaceId);
  if (!workspace) {
    throw new Error('Workspace not found');
  }
  const prefill = buildPrefill(workspace);
  const payload = {
    ...prefill,
    ...partialPayload,
    handles:
      partialPayload.handles && typeof partialPayload.handles === 'object'
        ? partialPayload.handles
        : prefill.handles,
  };
  try {
    return await suggestIntakeCompletion(payload);
  } catch (error) {
    console.warn(
      `[PortalIntake] Suggestion fallback for workspace ${workspaceId}:`,
      (error as Error)?.message || String(error)
    );
    return {
      suggested: {},
      filledByUser: [],
      confirmationRequired: false,
      confirmationReasons: ['AI_UNAVAILABLE'],
    };
  }
}

export async function submitPortalWorkspaceIntake(
  workspaceId: string,
  payload: Record<string, unknown>
): Promise<PortalWorkspaceIntakeSubmitResult> {
  const workspace = await getWorkspaceWithClient(workspaceId);
  if (!workspace) {
    throw new Error('Workspace not found');
  }

  const existingPrefill = buildPrefill(workspace);
  const nextPayload: Record<string, unknown> = {
    ...existingPrefill,
    ...payload,
    handles:
      payload.handles && typeof payload.handles === 'object'
        ? payload.handles
        : existingPrefill.handles,
  };

  const mergedName = stringify(nextPayload.name) || workspace.client.name;
  if (!mergedName) {
    throw new Error('name is required');
  }

  const platformHandlesRaw = buildPlatformHandles(nextPayload);
  const platformHandles: Record<string, string> = {};
  for (const [platformRaw, handleRaw] of Object.entries(platformHandlesRaw)) {
    const normalizedPlatform = toAccountPlatform(platformRaw);
    const normalizedHandle = normalizeHandle(handleRaw);
    if (!normalizedPlatform || !normalizedHandle) continue;
    platformHandles[normalizedPlatform] = normalizedHandle;
  }

  const { websites, primaryWebsite } = resolveIntakeWebsites(nextPayload);
  const website = primaryWebsite || stringify(nextPayload.website) || stringify(nextPayload.websiteDomain);
  const hasWebsite = websites.length > 0 || website.length > 0;
  if (!Object.keys(platformHandles).length && !hasWebsite) {
    throw new Error('Provide at least one social handle/channel or a website');
  }

  const existingConstraints = asRecord(workspace.client.brainProfile?.constraints);
  const mergedConstraints = buildConstraintObject(nextPayload, existingConstraints);

  const secondaryGoals = parseStringList(nextPayload.secondaryGoals);
  const channels = Object.entries(platformHandles).map(([platform, handle]) => ({
    platform,
    handle,
  }));
  const oneSentenceDescription =
    stringify(nextPayload.oneSentenceDescription) ||
    stringify(nextPayload.description) ||
    stringify(nextPayload.businessOverview);
  const primaryGoal = stringify(nextPayload.primaryGoal);

  const servicesList = parseList(nextPayload.servicesList, 20);
  const topProblems = parseList(nextPayload.topProblems, 3);
  const resultsIn90Days = parseList(nextPayload.resultsIn90Days, 2);
  const questionsBeforeBuying = parseList(nextPayload.questionsBeforeBuying, 3);
  const competitorInspirationLinks = parseList(nextPayload.competitorInspirationLinks, 5);
  const topicsToAvoid = parseList(nextPayload.topicsToAvoid, 20);
  const excludedCategories = parseStringList(nextPayload.excludedCategories);
  const inputData = asRecord(workspace.inputData);

  const updatedClient = await prisma.client.update({
    where: { id: workspace.client.id },
    data: {
      name: mergedName,
      businessOverview: oneSentenceDescription || workspace.client.businessOverview,
      goalsKpis: primaryGoal || workspace.client.goalsKpis,
    },
  });

  for (const [platform, handle] of Object.entries(platformHandles)) {
    await prisma.clientAccount.upsert({
      where: {
        clientId_platform_handle: {
          clientId: workspace.client.id,
          platform,
          handle,
        },
      },
      update: {
        profileUrl: getProfileUrl(platform, handle),
      },
      create: {
        clientId: workspace.client.id,
        platform,
        handle,
        profileUrl: getProfileUrl(platform, handle),
      },
    });
  }

  const brainProfile = await prisma.brainProfile.upsert({
    where: { clientId: workspace.client.id },
    update: {
      businessType: stringify(nextPayload.businessType) || null,
      offerModel: stringify(nextPayload.mainOffer) || stringify(nextPayload.offerModel) || null,
      primaryGoal: primaryGoal || null,
      secondaryGoals: toJson(secondaryGoals),
      targetMarket: stringify(nextPayload.targetAudience) || null,
      geoScope: stringify(nextPayload.geoScope) || null,
    websiteDomain: normalizeWebsiteDomain(website),
      channels: toJson(channels),
      constraints: toJson(stripUndefinedFromJson(mergedConstraints)),
    },
    create: {
      clientId: workspace.client.id,
      businessType: stringify(nextPayload.businessType) || null,
      offerModel: stringify(nextPayload.mainOffer) || stringify(nextPayload.offerModel) || null,
      primaryGoal: primaryGoal || null,
      secondaryGoals: toJson(secondaryGoals),
      targetMarket: stringify(nextPayload.targetAudience) || null,
      geoScope: stringify(nextPayload.geoScope) || null,
    websiteDomain: normalizeWebsiteDomain(website),
      channels: toJson(channels),
      constraints: toJson(stripUndefinedFromJson(mergedConstraints)),
    },
  });

  await syncBrainGoals(brainProfile.id, primaryGoal || null, secondaryGoals);

  const primaryPlatform = channels[0]?.platform || undefined;
  const primaryHandle = channels[0]?.handle || undefined;
  const surfaces =
    channels.length > 0
      ? channels.map((row) => row.platform)
      : websites.length > 0
        ? ['web']
        : undefined;
  const updatedInputData = stripUndefinedFromJson({
    ...inputData,
    source: 'portal_intro_form',
    intakeVersion: 'portal-v1',
    brandName: mergedName,
    niche: stringify(nextPayload.niche),
    businessType: stringify(nextPayload.businessType),
    website,
    websites: websites.length ? websites : undefined,
    primaryGoal,
    secondaryGoals,
    futureGoal: stringify(nextPayload.futureGoal),
    targetAudience: stringify(nextPayload.targetAudience),
    geoScope: stringify(nextPayload.geoScope),
    language: stringify(nextPayload.language),
    planningHorizon: stringify(nextPayload.planningHorizon),
    autonomyLevel: stringify(nextPayload.autonomyLevel) || 'assist',
    budgetSensitivity: stringify(nextPayload.budgetSensitivity),
    brandTone: stringify(nextPayload.brandTone),
    constraints: stripUndefinedFromJson(mergedConstraints),
    description: oneSentenceDescription || undefined,
    businessOverview: oneSentenceDescription || undefined,
    operateWhere: stringify(nextPayload.operateWhere),
    wantClientsWhere: stringify(nextPayload.wantClientsWhere),
    idealAudience: stringify(nextPayload.idealAudience),
    servicesList: servicesList.length ? servicesList : undefined,
    mainOffer: stringify(nextPayload.mainOffer),
    topProblems: topProblems.length ? topProblems : undefined,
    resultsIn90Days: resultsIn90Days.length ? resultsIn90Days : undefined,
    questionsBeforeBuying: questionsBeforeBuying.length ? questionsBeforeBuying : undefined,
    competitorInspirationLinks: competitorInspirationLinks.length
      ? competitorInspirationLinks
      : undefined,
    brandVoiceWords: stringify(nextPayload.brandVoiceWords),
    topicsToAvoid: topicsToAvoid.length ? topicsToAvoid : undefined,
    excludedCategories: excludedCategories.length ? excludedCategories : undefined,
    handles: platformHandles,
    channels,
    platform: primaryPlatform,
    handle: primaryHandle,
    surfaces,
    engineGoal: stringify(nextPayload.engineGoal),
  });

  await prisma.researchJob.update({
    where: { id: workspaceId },
    data: {
      inputData: toJson(updatedInputData),
      startedAt: workspace.startedAt || new Date(),
    },
  });

  if (competitorInspirationLinks.length > 0) {
    const { seedTopPicksFromInspirationLinks } = await import('../discovery/seed-intake-competitors');
    await seedTopPicksFromInspirationLinks(workspaceId, competitorInspirationLinks).catch((error) => {
      console.error(`[PortalIntake] Failed to seed competitor inspiration links for ${workspaceId}:`, error);
    });
  }

  if (websites.length > 0) {
    void seedPortalIntakeWebsites(workspaceId, websites).catch((error) => {
      console.error(`[PortalIntake] Failed to seed website scraping for ${workspaceId}:`, error);
    });
  }

  void resumeResearchJob(workspaceId).catch((error) => {
    console.error(`[PortalIntake] Failed to resume research job ${workspaceId}:`, error);
  });

  const pendingSets = await evaluatePendingQuestionSets(workspaceId);

  return {
    success: true,
    workspaceId,
    client: {
      id: updatedClient.id,
      name: updatedClient.name,
    },
    researchJob: {
      id: workspaceId,
      status: workspace.status,
    },
    handles: platformHandles,
    pendingQuestionSets: summarizeQuestionSets(pendingSets),
    message: 'Workspace intake saved. Smart workflow is running.',
  };
}
