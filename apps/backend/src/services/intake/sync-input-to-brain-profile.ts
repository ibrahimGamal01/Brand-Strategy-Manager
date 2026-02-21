import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { parseStringList, normalizeWebsiteDomain } from './brain-intake-utils';
import { syncBrainGoals } from './brain-intake-utils';

type BrainProfileWithGoals = Awaited<
  ReturnType<typeof prisma.brainProfile.upsert>
> & { goals: Array<{ id: string }> };

function toJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function parseList(value: unknown, maxItems = 10): string[] {
  if (Array.isArray(value)) {
    return value.map((x: unknown) => String(x || '').trim()).filter(Boolean).slice(0, maxItems);
  }
  const s = String(value || '').trim();
  if (!s) return [];
  const parts = s.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, maxItems);
}

/**
 * Build constraints object from inputData, matching brain-intake's buildMergedConstraints.
 */
function buildConstraintsFromInputData(inputData: Record<string, unknown>): Record<string, unknown> {
  const constraints = (inputData.constraints as Record<string, unknown>) || {};
  const topicsToAvoidRaw =
    inputData.topicsToAvoid ??
    (typeof constraints.topicsToAvoid === 'string'
      ? constraints.topicsToAvoid
      : Array.isArray(constraints.topicsToAvoid)
        ? constraints.topicsToAvoid
        : undefined);
  const topicsToAvoid = parseList(topicsToAvoidRaw, 15);
  const brandVoiceWords = String(
    inputData.brandVoiceWords ?? constraints.brandVoiceWords ?? ''
  ).trim();
  const excludedCategories = parseStringList(
    inputData.excludedCategories ??
      (Array.isArray(constraints.excludedCategories)
        ? constraints.excludedCategories
        : constraints.excludedCategories)
  );
  return {
    ...constraints,
    operatorGoal: String(inputData.engineGoal ?? constraints.operatorGoal ?? '').trim() || undefined,
    businessConstraints: String(constraints.businessConstraints ?? '').trim() || undefined,
    excludedCategories: excludedCategories.length > 0 ? excludedCategories : undefined,
    autonomyLevel: String(inputData.autonomyLevel ?? constraints.autonomyLevel ?? '').trim() || undefined,
    budgetSensitivity: String(inputData.budgetSensitivity ?? constraints.budgetSensitivity ?? '').trim() || undefined,
    brandTone: String(inputData.brandTone ?? constraints.brandTone ?? '').trim() || undefined,
    brandVoiceWords: brandVoiceWords || undefined,
    topicsToAvoid: topicsToAvoid.length > 0 ? topicsToAvoid : undefined,
    language: String(inputData.language ?? constraints.language ?? '').trim() || undefined,
    planningHorizon: String(inputData.planningHorizon ?? constraints.planningHorizon ?? '').trim() || undefined,
  };
}

/**
 * Check if a BrainProfile has no meaningful content (empty or placeholder-only).
 */
export function isBrainProfileEmpty(profile: { businessType?: string | null; primaryGoal?: string | null; targetMarket?: string | null; offerModel?: string | null } | null | undefined): boolean {
  if (!profile) return true;
  const hasBusinessType = String(profile.businessType ?? '').trim().length > 0;
  const hasPrimaryGoal = String(profile.primaryGoal ?? '').trim().length > 0;
  const hasTargetMarket = String(profile.targetMarket ?? '').trim().length > 0;
  const hasOfferModel = String(profile.offerModel ?? '').trim().length > 0;
  return !hasBusinessType && !hasPrimaryGoal && !hasTargetMarket && !hasOfferModel;
}

/** Resolve value from inputData using canonical key first, then aliases. */
function resolveValue(
  id: Record<string, unknown>,
  canonical: string,
  aliases: string[]
): string | null {
  const raw = id[canonical] ?? aliases.map((a) => id[a]).find((v) => v != null && String(v).trim());
  const s = raw != null ? String(raw).trim() : '';
  return s || null;
}

const EXPECTED_INPUT_KEYS = [
  'primaryGoal', 'targetAudience', 'idealAudience', 'businessType', 'mainOffer',
  'website', 'geoScope', 'secondaryGoals', 'resultsIn90Days', 'description',
  'businessOverview', 'brandName', 'niche', 'operateWhere', 'wantClientsWhere',
  'servicesList', 'topProblems', 'questionsBeforeBuying',
];

/** Alias keys that imported data might use instead of canonical keys. */
const ALIAS_KEYS = [
  'goal', 'goals', 'offer', 'main_offer', 'audience', 'ideal_audience', 'type',
  'business_type', 'websiteDomain', 'url', 'domain', 'oneSentenceDescription',
];

/**
 * Check if inputData has any meaningful intake content.
 */
export function hasMeaningfulInputData(inputData: Record<string, unknown> | null | undefined): boolean {
  if (!inputData || typeof inputData !== 'object') return false;
  const id = inputData as Record<string, unknown>;
  const keysToCheck = [...EXPECTED_INPUT_KEYS, ...ALIAS_KEYS];
  for (const k of keysToCheck) {
    const v = id[k];
    if (v != null && String(v).trim().length > 0) return true;
  }
  if (id.handles && typeof id.handles === 'object' && Object.keys(id.handles as object).length > 0) return true;
  if (Array.isArray(id.channels) && id.channels.length > 0) return true;
  return false;
}

/** Return which expected/alias keys exist in inputData with non-empty values. */
export function getInputDataKeysFound(inputData: Record<string, unknown> | null | undefined): string[] {
  if (!inputData || typeof inputData !== 'object') return [];
  const id = inputData as Record<string, unknown>;
  const allKeys = [...EXPECTED_INPUT_KEYS, ...ALIAS_KEYS];
  return allKeys.filter((k) => {
    const v = id[k];
    return v != null && String(v).trim().length > 0;
  });
}

/**
 * Sync ResearchJob.inputData (and Client fallbacks) into Client's BrainProfile.
 * Used when BrainProfile is missing or empty but intake data exists in inputData or Client.
 */
export async function syncInputDataToBrainProfile(
  clientId: string,
  inputData: Record<string, unknown> | null | undefined,
  clientFallbacks?: { businessOverview?: string | null; goalsKpis?: string | null; clientAccounts?: Array<{ platform: string; handle: string }> }
): Promise<BrainProfileWithGoals | null> {
  // Build effective input: merge inputData with Client fallbacks when fields are empty
  const id = { ...(inputData && typeof inputData === 'object' ? (inputData as Record<string, unknown>) : {}) } as Record<string, unknown>;
  if (clientFallbacks) {
    if (!id.primaryGoal && clientFallbacks.goalsKpis) id.primaryGoal = clientFallbacks.goalsKpis;
    if (!id.description && !id.businessOverview && clientFallbacks.businessOverview) {
      id.description = clientFallbacks.businessOverview;
      id.businessOverview = clientFallbacks.businessOverview;
    }
    if ((!id.channels || (Array.isArray(id.channels) && id.channels.length === 0)) && clientFallbacks.clientAccounts?.length) {
      id.channels = clientFallbacks.clientAccounts.map((a) => ({ platform: a.platform, handle: a.handle }));
    }
  }
  // If still no meaningful data, nothing to sync
  const meaningful = hasMeaningfulInputData(id);
  if (process.env.DEBUG_BRAIN_SYNC === '1') {
    const keysPresent = Object.keys(id).filter((k) => {
      const v = id[k];
      return v != null && String(v).trim().length > 0;
    });
    console.debug(`[DEBUG_BRAIN_SYNC] clientId=${clientId} hasMeaningfulInputData=${meaningful} keysPresent=${keysPresent.join(', ')}`);
  }
  if (!meaningful) return null;

  const secondaryGoals = Array.isArray(id.secondaryGoals)
    ? (id.secondaryGoals as unknown[]).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8)
    : parseStringList(id.secondaryGoals).slice(0, 8);
  let primaryGoal = resolveValue(id, 'primaryGoal', ['resultsIn90Days', 'goal', 'goals']) || null;
  if (!primaryGoal && id.resultsIn90Days) {
    primaryGoal =
      Array.isArray(id.resultsIn90Days)
        ? (id.resultsIn90Days as string[]).join(', ').trim()
        : String(id.resultsIn90Days).trim() || null;
  }
  const targetMarket = resolveValue(id, 'targetAudience', ['idealAudience', 'audience', 'ideal_audience']) || null;
  let businessType = resolveValue(id, 'businessType', ['niche', 'type', 'business_type']) || null;
  let offerModel = resolveValue(id, 'mainOffer', ['offer', 'main_offer', 'offerModel', 'engineGoal']) || null;
  const desc = resolveValue(id, 'description', ['businessOverview', 'oneSentenceDescription']) || '';
  if (!businessType && desc) businessType = desc.slice(0, 200);
  if (!offerModel && desc) offerModel = desc.slice(0, 200);
  let geoScope = resolveValue(id, 'geoScope', []) || null;
  if (!geoScope) {
    const operate = resolveValue(id, 'operateWhere', []) || '';
    const want = resolveValue(id, 'wantClientsWhere', []) || '';
    if (operate || want) geoScope = [operate, want].filter(Boolean).join('; ').slice(0, 500) || null;
  }
  const websiteRaw = resolveValue(id, 'website', ['websiteDomain', 'url', 'domain']) || '';
  const websiteDomain = websiteRaw ? normalizeWebsiteDomain(websiteRaw) : null;

  if (process.env.DEBUG_BRAIN_SYNC === '1') {
    console.debug(
      `[DEBUG_BRAIN_SYNC] clientId=${clientId} resolved: businessType=${!!businessType} primaryGoal=${!!primaryGoal} targetMarket=${!!targetMarket} offerModel=${!!offerModel} geoScope=${!!geoScope} websiteDomain=${!!websiteDomain}`
    );
  }

  let channels: Array<{ platform: string; handle: string }> = [];
  if (Array.isArray(id.channels) && id.channels.length > 0) {
    channels = id.channels
      .filter((c: unknown) => c && typeof c === 'object' && (c as any).platform && (c as any).handle)
      .map((c: unknown) => ({
        platform: String((c as any).platform),
        handle: String((c as any).handle),
      }))
      .slice(0, 10);
  } else if (id.handles && typeof id.handles === 'object') {
    const handles = id.handles as Record<string, string>;
    channels = Object.entries(handles)
      .filter(([, h]) => h && String(h).trim())
      .map(([platform, handle]) => ({ platform, handle }))
      .slice(0, 10);
  }

  const mergedConstraints = buildConstraintsFromInputData(id);

  const profile = await prisma.brainProfile.upsert({
    where: { clientId },
    update: {
      businessType: (businessType && businessType.trim()) || null,
      offerModel: (offerModel && offerModel.trim()) || null,
      primaryGoal: (primaryGoal && primaryGoal.trim()) || null,
      targetMarket: (targetMarket && targetMarket.trim()) || null,
      geoScope: (geoScope && geoScope.trim()) || null,
      websiteDomain: websiteDomain || null,
      secondaryGoals: toJson(secondaryGoals),
      channels: toJson(channels),
      constraints: toJson(mergedConstraints),
    },
    create: {
      clientId,
      businessType,
      offerModel,
      primaryGoal,
      secondaryGoals: toJson(secondaryGoals),
      targetMarket,
      geoScope,
      websiteDomain,
      channels: toJson(channels),
      constraints: toJson(mergedConstraints),
    },
    include: { goals: true },
  });

  await syncBrainGoals(profile.id, primaryGoal, secondaryGoals);

  return profile as BrainProfileWithGoals;
}
