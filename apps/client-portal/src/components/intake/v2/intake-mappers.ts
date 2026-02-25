import { WorkspaceIntakeFormData } from "@/lib/runtime-api";
import { PlatformId } from "../platforms";
import { buildChannelsFromHandles, extractHandleFromUrlOrRaw } from "../social-handles-fields";
import { IntakeStateV2, INITIAL_INTAKE_STATE_V2, IntakeWizardStepId } from "./intake-types";
import { buildLinkItems, toLinkStrings } from "./link-utils";

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function splitList(value: unknown, maxItems = 20): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean).slice(0, maxItems);
  }

  const raw = normalizeText(value);
  if (!raw) return [];

  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function pickPrimaryChannel(handles: Record<PlatformId, string>): PlatformId | "" {
  const available = (Object.keys(handles) as PlatformId[]).filter(
    (platform) => extractHandleFromUrlOrRaw(platform, handles[platform]).length > 0
  );

  return available[0] || "";
}

export function fromPrefillToV2(prefill?: WorkspaceIntakeFormData): IntakeStateV2 {
  if (!prefill) return { ...INITIAL_INTAKE_STATE_V2 };

  const handles = {
    ...INITIAL_INTAKE_STATE_V2.handles,
    ...(prefill.handles || {}),
  };

  const competitorStrings = splitList(prefill.competitorInspirationLinks, 5);

  return {
    ...INITIAL_INTAKE_STATE_V2,
    name: normalizeText(prefill.name),
    website: normalizeText(prefill.website),
    oneSentenceDescription: normalizeText(prefill.oneSentenceDescription),
    niche: normalizeText(prefill.niche),
    businessType: normalizeText(prefill.businessType),
    operateWhere: normalizeText(prefill.operateWhere),
    wantClientsWhere: normalizeText(prefill.wantClientsWhere),
    idealAudience: normalizeText(prefill.idealAudience),
    targetAudience: normalizeText(prefill.targetAudience),
    geoScope: normalizeText(prefill.geoScope),
    servicesList: splitList(prefill.servicesList, 20),
    mainOffer: normalizeText(prefill.mainOffer),
    primaryGoal: normalizeText(prefill.primaryGoal),
    secondaryGoals: splitList(prefill.secondaryGoals, 10),
    futureGoal: normalizeText(prefill.futureGoal),
    engineGoal: normalizeText(prefill.engineGoal),
    topProblems: splitList(prefill.topProblems, 3),
    resultsIn90Days: splitList(prefill.resultsIn90Days, 2),
    questionsBeforeBuying: splitList(prefill.questionsBeforeBuying, 3),
    brandVoiceWords: splitList(prefill.brandVoiceWords, 20),
    brandTone: normalizeText(prefill.brandTone),
    topicsToAvoid: splitList(prefill.topicsToAvoid, 20),
    constraints: normalizeText(prefill.constraints),
    excludedCategories: splitList(prefill.excludedCategories, 15),
    language: normalizeText(prefill.language),
    planningHorizon: normalizeText(prefill.planningHorizon),
    autonomyLevel: prefill.autonomyLevel === "auto" ? "auto" : "assist",
    budgetSensitivity: normalizeText(prefill.budgetSensitivity),
    competitorInspirationLinks: competitorStrings,
    competitorLinks: buildLinkItems(competitorStrings),
    primaryChannel: pickPrimaryChannel(handles),
    handles,
  };
}

export function ensureNormalizedHandles(handles: Record<PlatformId, string>): Record<PlatformId, string> {
  return {
    instagram: extractHandleFromUrlOrRaw("instagram", handles.instagram),
    tiktok: extractHandleFromUrlOrRaw("tiktok", handles.tiktok),
    youtube: extractHandleFromUrlOrRaw("youtube", handles.youtube),
    twitter: extractHandleFromUrlOrRaw("twitter", handles.twitter),
  };
}

function withCompetitorLinks(state: IntakeStateV2): IntakeStateV2 {
  const links = state.competitorLinks.length ? state.competitorLinks : buildLinkItems(state.competitorInspirationLinks);
  return {
    ...state,
    competitorLinks: links.slice(0, 5),
    competitorInspirationLinks: toLinkStrings(links).slice(0, 5),
  };
}

export function toSuggestPayloadV2(state: IntakeStateV2): Record<string, unknown> {
  const normalizedHandles = ensureNormalizedHandles(state.handles);
  const withLinks = withCompetitorLinks(state);

  return {
    name: state.name,
    website: state.website,
    oneSentenceDescription: state.oneSentenceDescription,
    niche: state.niche,
    businessType: state.businessType,
    operateWhere: state.operateWhere,
    wantClientsWhere: state.wantClientsWhere,
    idealAudience: state.idealAudience,
    targetAudience: state.targetAudience,
    geoScope: state.geoScope,
    servicesList: state.servicesList,
    mainOffer: state.mainOffer,
    primaryGoal: state.primaryGoal,
    secondaryGoals: state.secondaryGoals,
    futureGoal: state.futureGoal,
    engineGoal: state.engineGoal,
    topProblems: state.topProblems,
    resultsIn90Days: state.resultsIn90Days,
    questionsBeforeBuying: state.questionsBeforeBuying,
    brandVoiceWords: state.brandVoiceWords,
    brandTone: state.brandTone,
    topicsToAvoid: state.topicsToAvoid,
    constraints: state.constraints,
    excludedCategories: state.excludedCategories,
    language: state.language,
    planningHorizon: state.planningHorizon,
    autonomyLevel: state.autonomyLevel,
    budgetSensitivity: state.budgetSensitivity,
    competitorInspirationLinks: withLinks.competitorInspirationLinks,
    handles: normalizedHandles,
  };
}

export function toSubmitPayloadV2(state: IntakeStateV2): Record<string, unknown> {
  const normalizedHandles = ensureNormalizedHandles(state.handles);
  const channels = buildChannelsFromHandles(normalizedHandles);
  const withLinks = withCompetitorLinks(state);

  return {
    ...toSuggestPayloadV2(withLinks),
    competitorInspirationLinks: withLinks.competitorInspirationLinks,
    channels,
    handle: channels[0]?.handle,
    platform: channels[0]?.platform,
    surfaces: channels.map((item) => item.platform),
    constraints: {
      operatorGoal: state.engineGoal,
      businessConstraints: state.constraints,
      excludedCategories: state.excludedCategories,
      autonomyLevel: state.autonomyLevel,
      budgetSensitivity: state.budgetSensitivity,
      brandTone: state.brandTone,
      brandVoiceWords: state.brandVoiceWords.join(", "),
      topicsToAvoid: state.topicsToAvoid,
      language: state.language,
      planningHorizon: state.planningHorizon,
    },
  };
}

export const LIST_FIELD_KEYS: Array<keyof IntakeStateV2> = [
  "servicesList",
  "secondaryGoals",
  "topProblems",
  "resultsIn90Days",
  "questionsBeforeBuying",
  "brandVoiceWords",
  "topicsToAvoid",
  "excludedCategories",
  "competitorInspirationLinks",
];

const STEP_FIELD_MAP: Record<IntakeWizardStepId, Array<keyof IntakeStateV2>> = {
  brand: ["name", "website", "oneSentenceDescription", "niche", "businessType"],
  channels: ["primaryChannel", "handles"],
  offer: ["mainOffer", "servicesList", "primaryGoal", "budgetSensitivity", "secondaryGoals", "futureGoal"],
  audience: [
    "idealAudience",
    "targetAudience",
    "operateWhere",
    "wantClientsWhere",
    "topProblems",
    "resultsIn90Days",
    "questionsBeforeBuying",
  ],
  voice: [
    "brandVoiceWords",
    "topicsToAvoid",
    "constraints",
    "competitorInspirationLinks",
    "competitorLinks",
    "language",
    "planningHorizon",
    "autonomyLevel",
    "brandTone",
    "engineGoal",
  ],
};

export function getStepFields(step: IntakeWizardStepId): Array<keyof IntakeStateV2> {
  return STEP_FIELD_MAP[step];
}

export function applySuggestedToState(
  state: IntakeStateV2,
  suggested: Record<string, unknown>,
  step: IntakeWizardStepId
): { next: IntakeStateV2; suggestedKeys: Set<string> } {
  const allowed = new Set(getStepFields(step).map(String));
  const next: IntakeStateV2 = { ...state };
  const suggestedKeys = new Set<string>();

  for (const [rawKey, rawValue] of Object.entries(suggested || {})) {
    if (!allowed.has(rawKey)) continue;

    const key = rawKey as keyof IntakeStateV2;
    if (LIST_FIELD_KEYS.includes(key)) {
      const listValue = splitList(rawValue, key === "competitorInspirationLinks" ? 5 : 20);
      (next[key] as unknown) = listValue;
      if (key === "competitorInspirationLinks") {
        next.competitorLinks = buildLinkItems(listValue);
      }
      suggestedKeys.add(rawKey);
      continue;
    }

    if (key === "autonomyLevel") {
      next.autonomyLevel = String(rawValue || "").toLowerCase() === "auto" ? "auto" : "assist";
      suggestedKeys.add(rawKey);
      continue;
    }

    if (key === "handles" || key === "primaryChannel" || key === "competitorLinks") {
      continue;
    }

    (next[key] as unknown) = normalizeText(rawValue);
    suggestedKeys.add(rawKey);
  }

  return { next, suggestedKeys };
}

export function applySuggestedHandles(
  state: IntakeStateV2,
  suggestedHandles?: Record<string, string>
): { next: IntakeStateV2; suggestedPlatforms: Set<string> } {
  if (!suggestedHandles || typeof suggestedHandles !== "object") {
    return { next: state, suggestedPlatforms: new Set<string>() };
  }

  const handles = { ...state.handles };
  const suggestedPlatforms = new Set<string>();

  for (const [platform, handle] of Object.entries(suggestedHandles)) {
    if (!["instagram", "tiktok", "youtube", "twitter"].includes(platform)) continue;
    const key = platform as PlatformId;
    handles[key] = normalizeText(handle);
    suggestedPlatforms.add(key);
  }

  const normalizedHandles = ensureNormalizedHandles(handles);
  return {
    next: {
      ...state,
      handles,
      primaryChannel: pickPrimaryChannel(normalizedHandles),
    },
    suggestedPlatforms,
  };
}
