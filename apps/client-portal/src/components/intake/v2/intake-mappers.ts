import { WorkspaceIntakeFormData } from "@/lib/runtime-api";
import { PlatformId } from "../platforms";
import { buildChannelsFromHandles, extractHandleFromUrlOrRaw } from "../social-handles-fields";
import { IntakeStateV2, INITIAL_INTAKE_STATE_V2, IntakeWizardStepId } from "./intake-types";
import { buildLinkItems, toLinkStrings } from "./link-utils";

export type SuggestedHandleCandidate = {
  platform: "instagram" | "tiktok" | "youtube" | "twitter" | "linkedin";
  handle: string;
  profileUrl?: string;
  confidence: number;
  reason: string;
  source: string;
  isLikelyClient: boolean;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

const SOCIAL_HOST_MARKERS = [
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "x.com",
  "twitter.com",
  "facebook.com",
  "linkedin.com",
];

function isSocialHost(hostname: string): boolean {
  const host = String(hostname || "").toLowerCase();
  return SOCIAL_HOST_MARKERS.some((marker) => host.includes(marker));
}

function normalizeWebsiteCandidate(rawValue: string): string {
  let candidate = String(rawValue || "").trim();
  if (!candidate) return "";

  candidate = candidate
    .replace(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/i, "$2")
    .replace(/[)\],;.!]+$/g, "");

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (!hostname) return "";
    if (/[, ]/.test(hostname)) return "";
    if (isSocialHost(hostname)) return "";
    parsed.hash = "";
    const normalized = parsed.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return "";
  }
}

function normalizeSocialReferenceCandidate(rawValue: string): string {
  let candidate = String(rawValue || "").trim();
  if (!candidate) return "";

  candidate = candidate
    .replace(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/i, "$2")
    .replace(/[)\],;.!]+$/g, "");

  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (!hostname) return "";
    if (/[, ]/.test(hostname)) return "";
    if (!isSocialHost(hostname)) return "";
    parsed.hash = "";
    const normalized = parsed.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return "";
  }
}

function extractWebsiteCandidates(value: unknown): string[] {
  const text = String(value || "").trim();
  if (!text) return [];

  const candidates: string[] = [];
  const markdownLinkMatches = text.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi) || [];
  for (const match of markdownLinkMatches) {
    const extracted = match.match(/\((https?:\/\/[^)]+)\)/i)?.[1];
    if (extracted) candidates.push(extracted);
  }

  const urlMatches = text.match(/https?:\/\/[^\s),;]+/gi) || [];
  candidates.push(...urlMatches);

  const domainMatches = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[\w\-./?%&=]*)?/gi) || [];
  candidates.push(...domainMatches);

  if (!candidates.length && !/\s/.test(text)) {
    candidates.push(text);
  }

  return candidates;
}

function normalizeWebsiteList(values: unknown, maxItems = 8): string[] {
  return classifyWebsiteInputs(values, maxItems, maxItems).crawlWebsites;
}

function normalizeSocialReferenceList(values: unknown, maxItems = 12): string[] {
  return classifyWebsiteInputs(values, maxItems, maxItems).socialReferences;
}

export function classifyStateWebsiteInputs(
  state: Pick<IntakeStateV2, "website" | "websites" | "socialReferences">
): { crawlWebsites: string[]; socialReferences: string[] } {
  return classifyWebsiteInputs([state.website, state.websites, state.socialReferences], 8, 12);
}

function classifyWebsiteInputs(
  values: unknown,
  maxWebsiteItems = 8,
  maxSocialItems = 12
): { crawlWebsites: string[]; socialReferences: string[] } {
  const chunks = Array.isArray(values) ? values : [values];
  const crawlWebsites: string[] = [];
  const socialReferences: string[] = [];
  const seenWebsites = new Set<string>();
  const seenSocial = new Set<string>();

  for (const chunk of chunks) {
    for (const candidate of extractWebsiteCandidates(chunk)) {
      const normalized = normalizeWebsiteCandidate(candidate);
      if (normalized) {
        const key = normalized.toLowerCase();
        if (!seenWebsites.has(key)) {
          seenWebsites.add(key);
          crawlWebsites.push(normalized);
          if (crawlWebsites.length >= maxWebsiteItems) break;
        }
        continue;
      }

      const socialReference = normalizeSocialReferenceCandidate(candidate);
      if (!socialReference) continue;
      const socialKey = socialReference.toLowerCase();
      if (seenSocial.has(socialKey)) continue;
      seenSocial.add(socialKey);
      socialReferences.push(socialReference);
      if (socialReferences.length >= maxSocialItems) break;
    }
  }

  return {
    crawlWebsites,
    socialReferences,
  };
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

  const classifiedWebInputs = classifyWebsiteInputs(
    [prefill.website, prefill.websites, prefill.socialReferences],
    8,
    12
  );
  const websiteStrings = classifiedWebInputs.crawlWebsites;
  const socialReferences = classifiedWebInputs.socialReferences;
  const websiteValue = normalizeText(prefill.website);
  const normalizedWebsiteValue = normalizeWebsiteList([websiteValue], 1)[0] || "";
  const competitorStrings = splitList(prefill.competitorInspirationLinks, 5);

  return {
    ...INITIAL_INTAKE_STATE_V2,
    name: normalizeText(prefill.name),
    website: normalizedWebsiteValue || websiteStrings[0] || "",
    websites: websiteStrings,
    socialReferences,
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
    linkedin: extractHandleFromUrlOrRaw("linkedin", handles.linkedin),
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
  const classifiedWebInputs = classifyStateWebsiteInputs(state);
  const websites = classifiedWebInputs.crawlWebsites;
  const socialReferences = classifiedWebInputs.socialReferences;

  return {
    name: state.name,
    website: websites[0] || state.website,
    websites,
    socialReferences,
    includeSocialProfileCrawl: state.includeSocialProfileCrawl,
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
  "websites",
  "socialReferences",
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

const LIST_FIELD_MAX_ITEMS: Partial<Record<keyof IntakeStateV2, number>> = {
  websites: 5,
  socialReferences: 12,
  servicesList: 20,
  secondaryGoals: 10,
  topProblems: 3,
  resultsIn90Days: 2,
  questionsBeforeBuying: 3,
  brandVoiceWords: 20,
  topicsToAvoid: 20,
  excludedCategories: 15,
  competitorInspirationLinks: 5,
};

const STEP_FIELD_MAP: Record<IntakeWizardStepId, Array<keyof IntakeStateV2>> = {
  brand: ["name", "website", "websites", "socialReferences", "oneSentenceDescription", "niche", "businessType"],
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
      if (key === "websites") {
        const classifiedWebInputs = classifyWebsiteInputs(
          [rawValue, next.socialReferences, next.website],
          8,
          12
        );
        next.websites = classifiedWebInputs.crawlWebsites;
        next.socialReferences = classifiedWebInputs.socialReferences;
        next.website = next.website || classifiedWebInputs.crawlWebsites[0] || "";
        suggestedKeys.add(rawKey);
        continue;
      }

      if (key === "socialReferences") {
        const mergedSocialReferences = normalizeSocialReferenceList(
          [rawValue, next.socialReferences, next.websites, next.website],
          12
        );
        next.socialReferences = mergedSocialReferences;
        suggestedKeys.add(rawKey);
        continue;
      }

      const listValue = splitList(rawValue, LIST_FIELD_MAX_ITEMS[key] ?? 20);
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
    if (!["instagram", "tiktok", "youtube", "twitter", "linkedin"].includes(platform)) continue;
    const key = platform as PlatformId;
    const existing = extractHandleFromUrlOrRaw(key, handles[key]);
    if (existing.length > 0) continue;
    handles[key] = normalizeText(handle);
    suggestedPlatforms.add(key);
  }

  const normalizedHandles = ensureNormalizedHandles(handles);
  const nextPrimaryChannel = state.primaryChannel || pickPrimaryChannel(normalizedHandles);
  return {
    next: {
      ...state,
      handles,
      primaryChannel: nextPrimaryChannel,
    },
    suggestedPlatforms,
  };
}
