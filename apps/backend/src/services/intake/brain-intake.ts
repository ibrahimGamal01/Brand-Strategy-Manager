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
  const topicsToAvoidRaw =
    payload.topicsToAvoid ??
    (payload.constraints && typeof payload.constraints === 'object'
      ? (payload.constraints as Record<string, unknown>).topicsToAvoid
      : undefined);
  const topicsToAvoid =
    typeof topicsToAvoidRaw === 'string'
      ? topicsToAvoidRaw.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean)
      : Array.isArray(topicsToAvoidRaw)
        ? topicsToAvoidRaw.map((x: unknown) => String(x || '').trim()).filter(Boolean)
        : parseStringList(topicsToAvoidRaw);
  const brandVoiceWords = String(payload.brandVoiceWords || '').trim() ||
    (payload.constraints && typeof payload.constraints === 'object'
      ? String((payload.constraints as Record<string, unknown>).brandVoiceWords || '').trim()
      : '');
  return {
    ...(payload.constraints && typeof payload.constraints === 'object' ? payload.constraints : {}),
    operatorGoal: String(payload.engineGoal || payload.operatorGoal || '').trim() || undefined,
    businessConstraints: String(payload.businessConstraints || '').trim() || undefined,
    excludedCategories,
    autonomyLevel: String(payload.autonomyLevel || '').trim() || undefined,
    budgetSensitivity: String(payload.budgetSensitivity || '').trim() || undefined,
    brandTone: String(payload.brandTone || '').trim() || undefined,
    brandVoiceWords: brandVoiceWords || undefined,
    topicsToAvoid: topicsToAvoid.length > 0 ? topicsToAvoid : undefined,
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
        businessOverview:
          String(payload.oneSentenceDescription || payload.description || payload.businessOverview || payload.futureGoal || '').trim() || null,
        goalsKpis: payload.primaryGoal || null,
      },
    });
    return { client, isExistingClient };
  }

  const incomingOverview = String(
    payload.oneSentenceDescription || payload.description || payload.businessOverview || payload.futureGoal || ''
  ).trim();
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

  function parseList(value: unknown, maxItems = 10): string[] {
    if (Array.isArray(value)) {
      return value.map((x: unknown) => String(x || '').trim()).filter(Boolean).slice(0, maxItems);
    }
    const s = String(value || '').trim();
    if (!s) return [];
    const parts = s.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean);
    return parts.slice(0, maxItems);
  }

  const servicesList = parseList(payload.servicesList, 20);
  const topProblems = parseList(payload.topProblems, 3);
  const resultsIn90Days = parseList(payload.resultsIn90Days, 2);
  const questionsBeforeBuying = parseList(payload.questionsBeforeBuying, 3);
  const competitorInspirationLinks = parseList(payload.competitorInspirationLinks, 3);
  const topicsToAvoidList =
    (mergedConstraints.topicsToAvoid as string[] | undefined)?.length
      ? (mergedConstraints.topicsToAvoid as string[])
      : parseList(payload.topicsToAvoid, 15);

  const competitorInspirationLinksEarly = competitorInspirationLinks;

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

  function buildInputData() {
    return toJson({
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
      description: String(payload.oneSentenceDescription || payload.description || '').trim() || undefined,
      businessOverview: String(
        payload.oneSentenceDescription || payload.businessOverview || payload.futureGoal || ''
      ).trim() || undefined,
      operateWhere: String(payload.operateWhere || '').trim() || undefined,
      wantClientsWhere: String(payload.wantClientsWhere || '').trim() || undefined,
      idealAudience: String(payload.idealAudience || '').trim() || undefined,
      servicesList: servicesList.length > 0 ? servicesList : undefined,
      mainOffer: String(payload.mainOffer || '').trim() || undefined,
      topProblems: topProblems.length > 0 ? topProblems : undefined,
      resultsIn90Days: resultsIn90Days.length > 0 ? resultsIn90Days : undefined,
      questionsBeforeBuying: questionsBeforeBuying.length > 0 ? questionsBeforeBuying : undefined,
      competitorInspirationLinks:
        competitorInspirationLinks.length > 0 ? competitorInspirationLinks : undefined,
      brandVoiceWords: String(payload.brandVoiceWords || '').trim() || undefined,
      topicsToAvoid: topicsToAvoidList.length > 0 ? topicsToAvoidList : undefined,
    });
  }

  if (recentJob) {
    await prisma.researchJob.update({
      where: { id: recentJob.id },
      data: { inputData: buildInputData() },
    });
    if (competitorInspirationLinksEarly.length > 0) {
      const existingClientInspirationCount = await prisma.competitorCandidateProfile.count({
        where: {
          researchJobId: recentJob.id,
          source: 'client_inspiration',
        },
      });
      if (existingClientInspirationCount === 0) {
        const { seedTopPicksFromInspirationLinks } = await import(
          '../discovery/seed-intake-competitors'
        );
        await seedTopPicksFromInspirationLinks(recentJob.id, competitorInspirationLinksEarly).catch(
          (err) => {
            console.error(`[API] Seed intake competitors (reused job) failed for ${recentJob.id}:`, err);
          }
        );
      }
    }
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
      inputData: buildInputData(),
    },
  });

  if (competitorInspirationLinks.length > 0) {
    const { seedTopPicksFromInspirationLinks } = await import(
      '../discovery/seed-intake-competitors'
    );
    await seedTopPicksFromInspirationLinks(researchJob.id, competitorInspirationLinks).catch(
      (err) => {
        console.error(`[API] Seed intake competitors failed for job ${researchJob.id}:`, err);
      }
    );
  }

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
