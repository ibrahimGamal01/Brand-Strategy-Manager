import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { isLikelyPlaceholderDiscoveryContext } from '../discovery/discovery-context-sanitizer';
import { resumeResearchJob } from '../social/research-resume';
import {
  buildPlatformHandles,
  getProfileUrl,
  normalizeWebsiteDomain,
  parseStringList,
  syncBrainGoals,
} from './brain-intake-utils';

export interface BrainIntakeResult {
  success: boolean;
  isExisting: boolean;
  client: any;
  researchJob: {
    id: string;
    status: string;
  };
  handles: Record<string, string>;
  message: string;
}

function toJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function buildMergedConstraints(payload: any, excludedCategories: string[]): Record<string, unknown> {
  return {
    ...(payload.constraints && typeof payload.constraints === 'object' ? payload.constraints : {}),
    operatorGoal: String(payload.engineGoal || payload.operatorGoal || '').trim() || undefined,
    businessConstraints: String(payload.businessConstraints || '').trim() || undefined,
    excludedCategories,
    autonomyLevel: String(payload.autonomyLevel || '').trim() || undefined,
    budgetSensitivity: String(payload.budgetSensitivity || '').trim() || undefined,
    brandTone: String(payload.brandTone || '').trim() || undefined,
    language: String(payload.language || '').trim() || undefined,
    planningHorizon: String(payload.planningHorizon || '').trim() || undefined,
  };
}

async function findOrCreateClient(
  payload: any,
  platformHandles: Record<string, string>
): Promise<{ client: any; isExistingClient: boolean }> {
  const name = String(payload.name || '').trim();
  let client: any = null;
  let isExistingClient = false;

  for (const [platform, handle] of Object.entries(platformHandles)) {
    const account = await prisma.clientAccount.findFirst({
      where: { platform, handle },
      include: { client: true },
    });
    if (account?.client) {
      client = account.client;
      isExistingClient = true;
      break;
    }
  }

  if (!client) {
    client = await prisma.client.create({
      data: {
        name,
        businessOverview: payload.businessOverview || payload.futureGoal || null,
        goalsKpis: payload.primaryGoal || null,
      },
    });
    return { client, isExistingClient };
  }

  const incomingOverview = String(payload.businessOverview || payload.futureGoal || '').trim();
  const existingOverview = String(client.businessOverview || '').trim();
  const shouldReplacePlaceholderOverview =
    Boolean(incomingOverview) && isLikelyPlaceholderDiscoveryContext(existingOverview);

  client = await prisma.client.update({
    where: { id: client.id },
    data: {
      name: name || client.name,
      businessOverview: incomingOverview
        ? incomingOverview
        : shouldReplacePlaceholderOverview
          ? null
          : client.businessOverview,
      goalsKpis: String(payload.primaryGoal || '').trim() || client.goalsKpis,
    },
  });

  return { client, isExistingClient };
}

async function upsertClientAccounts(clientId: string, platformHandles: Record<string, string>): Promise<void> {
  for (const [platform, handle] of Object.entries(platformHandles)) {
    await prisma.clientAccount.upsert({
      where: { clientId_platform_handle: { clientId, platform, handle } },
      update: { profileUrl: getProfileUrl(platform, handle) },
      create: { clientId, platform, handle, profileUrl: getProfileUrl(platform, handle) },
    });
  }
}

async function upsertBrainProfile(payload: any, clientId: string): Promise<{ secondaryGoals: string[] }> {
  const secondaryGoals = parseStringList(payload.secondaryGoals);
  const excludedCategories = parseStringList(
    payload.excludedCategories ||
      (payload.constraints && typeof payload.constraints === 'object'
        ? (payload.constraints as Record<string, unknown>).excludedCategories
        : undefined)
  );

  const mergedConstraints = buildMergedConstraints(payload, excludedCategories);

  const profile = await prisma.brainProfile.upsert({
    where: { clientId },
    update: {
      businessType: String(payload.businessType || '').trim() || null,
      offerModel: String(payload.offerModel || '').trim() || null,
      primaryGoal: String(payload.primaryGoal || '').trim() || null,
      secondaryGoals,
      targetMarket: String(payload.targetAudience || '').trim() || null,
      geoScope: String(payload.geoScope || '').trim() || null,
      websiteDomain: normalizeWebsiteDomain(payload.website || payload.websiteDomain),
      channels: payload.channels && Array.isArray(payload.channels) ? payload.channels : [],
      constraints: toJson(mergedConstraints),
    },
    create: {
      clientId,
      businessType: String(payload.businessType || '').trim() || null,
      offerModel: String(payload.offerModel || '').trim() || null,
      primaryGoal: String(payload.primaryGoal || '').trim() || null,
      secondaryGoals,
      targetMarket: String(payload.targetAudience || '').trim() || null,
      geoScope: String(payload.geoScope || '').trim() || null,
      websiteDomain: normalizeWebsiteDomain(payload.website || payload.websiteDomain),
      channels: payload.channels && Array.isArray(payload.channels) ? payload.channels : [],
      constraints: toJson(mergedConstraints),
    },
  });

  await syncBrainGoals(profile.id, String(payload.primaryGoal || '').trim() || null, secondaryGoals);
  return { secondaryGoals };
}

export async function processBrainIntake(payload: any): Promise<BrainIntakeResult> {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('name is required');

  const platformHandles = buildPlatformHandles(payload);
  if (Object.keys(platformHandles).length === 0) {
    throw new Error('At least one social handle/channel is required');
  }

  const primaryPlatform = Object.keys(platformHandles)[0];
  const primaryHandle = platformHandles[primaryPlatform];
  const forceNew = Boolean(payload.forceNew);

  const { client, isExistingClient } = await findOrCreateClient(payload, platformHandles);
  await upsertClientAccounts(client.id, platformHandles);

  const { secondaryGoals } = await upsertBrainProfile(payload, client.id);
  const mergedConstraints = buildMergedConstraints(
    payload,
    parseStringList(
      payload.excludedCategories ||
        (payload.constraints && typeof payload.constraints === 'object'
          ? (payload.constraints as Record<string, unknown>).excludedCategories
          : undefined)
    )
  );

  const recentJob = !forceNew
    ? await prisma.researchJob.findFirst({
        where: {
          clientId: client.id,
          startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          status: {
            in: [
              'PENDING',
              'SCRAPING_CLIENT',
              'DISCOVERING_COMPETITORS',
              'SCRAPING_COMPETITORS',
              'ANALYZING',
              'COMPLETE',
            ],
          },
        },
        orderBy: { startedAt: 'desc' },
      })
    : null;

  if (recentJob) {
    return {
      success: true,
      isExisting: true,
      client,
      researchJob: { id: recentJob.id, status: recentJob.status },
      handles: platformHandles,
      message: `Existing research job reused: ${recentJob.id}`,
    };
  }

  const researchJob = await prisma.researchJob.create({
    data: {
      clientId: client.id,
      status: 'PENDING',
      startedAt: new Date(),
      inputData: toJson({
        handle: primaryHandle,
        platform: primaryPlatform,
        handles: platformHandles,
        channels: payload.channels || [],
        brandName: name,
        niche: String(payload.niche || payload.businessType || '').trim(),
        businessType: String(payload.businessType || '').trim(),
        website: String(payload.website || payload.websiteDomain || '').trim(),
        primaryGoal: String(payload.primaryGoal || '').trim(),
        secondaryGoals,
        futureGoal: String(payload.futureGoal || '').trim(),
        targetAudience: String(payload.targetAudience || '').trim(),
        geoScope: String(payload.geoScope || '').trim(),
        language: String(payload.language || '').trim(),
        planningHorizon: String(payload.planningHorizon || '').trim(),
        autonomyLevel: String(payload.autonomyLevel || '').trim() || 'assist',
        budgetSensitivity: String(payload.budgetSensitivity || '').trim(),
        brandTone: String(payload.brandTone || '').trim(),
        constraints: mergedConstraints,
        intakeVersion: 'v2',
      }),
    },
  });

  void resumeResearchJob(researchJob.id).catch((error) => {
    console.error(`[API] Intake orchestration failed for job ${researchJob.id}:`, error);
  });

  return {
    success: true,
    isExisting: isExistingClient,
    client,
    researchJob: { id: researchJob.id, status: researchJob.status },
    handles: platformHandles,
    message: 'Client intake initialized',
  };
}
