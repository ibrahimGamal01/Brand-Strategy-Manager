import { WorkspaceIntakeFormData } from "@/lib/runtime-api";
import { PlatformId } from "../platforms";
import { extractHandleFromUrlOrRaw } from "../social-handles-fields";
import {
  IntakeFieldMetaMap,
  IntakeFieldSource,
  IntakeStateV2,
  INITIAL_INTAKE_STATE_V2,
  IntakeWizardStepId,
  IntakeTrackableField,
} from "./intake-types";
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

function normalizeHandlesV2(
  rawValue: unknown,
  fallbackHandles?: Record<PlatformId, string>
): IntakeStateV2["handlesV2"] {
  const source =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : {};
  const out: IntakeStateV2["handlesV2"] = {
    instagram: { primary: "", handles: [] },
    tiktok: { primary: "", handles: [] },
    youtube: { primary: "", handles: [] },
    linkedin: { primary: "", handles: [] },
    twitter: { primary: "", handles: [] },
  };

  const platforms: PlatformId[] = ["instagram", "tiktok", "youtube", "linkedin", "twitter"];
  for (const platform of platforms) {
    const bucketRaw =
      source[platform] && typeof source[platform] === "object" && !Array.isArray(source[platform])
        ? (source[platform] as Record<string, unknown>)
        : {};
    const list = splitList(bucketRaw.handles, 5)
      .map((entry) => extractHandleFromUrlOrRaw(platform, entry))
      .filter(Boolean);
    const deduped = Array.from(new Set(list)).slice(0, 5);
    const fallbackHandle = extractHandleFromUrlOrRaw(platform, fallbackHandles?.[platform] || "");
    if (fallbackHandle && !deduped.includes(fallbackHandle)) {
      deduped.unshift(fallbackHandle);
    }
    const primaryCandidate = extractHandleFromUrlOrRaw(platform, String(bucketRaw.primary || ""));
    const primary = deduped.includes(primaryCandidate) ? primaryCandidate : deduped[0] || "";
    out[platform] = {
      primary,
      handles: deduped,
    };
  }

  return out;
}

function toPrimaryHandlesFromV2(
  handlesV2: IntakeStateV2["handlesV2"]
): Record<PlatformId, string> {
  return {
    instagram: handlesV2.instagram.primary || "",
    tiktok: handlesV2.tiktok.primary || "",
    youtube: handlesV2.youtube.primary || "",
    linkedin: handlesV2.linkedin.primary || "",
    twitter: handlesV2.twitter.primary || "",
  };
}

function flattenChannelsFromHandlesV2(
  handlesV2: IntakeStateV2["handlesV2"]
): Array<{ platform: PlatformId; handle: string }> {
  const rows: Array<{ platform: PlatformId; handle: string }> = [];
  const platforms: PlatformId[] = ["instagram", "tiktok", "youtube", "linkedin", "twitter"];
  for (const platform of platforms) {
    const bucket = handlesV2[platform];
    if (!bucket) continue;
    const ordered = bucket.primary
      ? [bucket.primary, ...bucket.handles.filter((entry) => entry !== bucket.primary)]
      : bucket.handles;
    for (const handle of ordered.slice(0, 5)) {
      rows.push({ platform, handle });
    }
  }
  return rows;
}

export function fromPrefillToV2(prefill?: WorkspaceIntakeFormData): IntakeStateV2 {
  if (!prefill) return { ...INITIAL_INTAKE_STATE_V2 };

  const legacyHandles = {
    ...INITIAL_INTAKE_STATE_V2.handles,
    ...(prefill.handles || {}),
  };
  const handlesV2 = normalizeHandlesV2(prefill.handlesV2, legacyHandles);
  const handles = toPrimaryHandlesFromV2(handlesV2);

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
    handlesV2,
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

export function ensureNormalizedHandlesV2(
  handlesV2: IntakeStateV2["handlesV2"]
): IntakeStateV2["handlesV2"] {
  const platforms: PlatformId[] = ["instagram", "tiktok", "youtube", "linkedin", "twitter"];
  const normalized: IntakeStateV2["handlesV2"] = {
    instagram: { primary: "", handles: [] },
    tiktok: { primary: "", handles: [] },
    youtube: { primary: "", handles: [] },
    linkedin: { primary: "", handles: [] },
    twitter: { primary: "", handles: [] },
  };
  for (const platform of platforms) {
    const bucket = handlesV2[platform];
    const list = Array.from(
      new Set(
        (Array.isArray(bucket?.handles) ? bucket.handles : [])
          .map((entry) => extractHandleFromUrlOrRaw(platform, entry))
          .filter(Boolean)
      )
    ).slice(0, 5);
    const primary = extractHandleFromUrlOrRaw(platform, bucket?.primary || "");
    normalized[platform] = {
      primary: list.includes(primary) ? primary : list[0] || "",
      handles: list,
    };
  }
  return normalized;
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
  const normalizedHandlesV2 = ensureNormalizedHandlesV2(state.handlesV2);
  const normalizedHandles = toPrimaryHandlesFromV2(normalizedHandlesV2);
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
    handlesV2: normalizedHandlesV2,
  };
}

export function toSubmitPayloadV2(state: IntakeStateV2): Record<string, unknown> {
  const normalizedHandlesV2 = ensureNormalizedHandlesV2(state.handlesV2);
  const normalizedHandles = toPrimaryHandlesFromV2(normalizedHandlesV2);
  const channelsUnordered = flattenChannelsFromHandlesV2(normalizedHandlesV2).map((entry) => ({
    platform: entry.platform === "twitter" ? "x" : entry.platform,
    handle: entry.handle,
  }));
  const channels = state.primaryChannel
    ? [
        ...channelsUnordered.filter((row) => row.platform === (state.primaryChannel === "twitter" ? "x" : state.primaryChannel)),
        ...channelsUnordered.filter((row) => row.platform !== (state.primaryChannel === "twitter" ? "x" : state.primaryChannel)),
      ]
    : channelsUnordered;
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
  channels: ["primaryChannel", "handles", "handlesV2"],
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

type SuggestScope = "step" | "global";
type OverwritePolicy = "missing_only" | "missing_or_low_signal";

const OVERWRITABLE_LOW_SIGNAL_KEYS = new Set<keyof IntakeStateV2>([
  "oneSentenceDescription",
  "mainOffer",
  "primaryGoal",
  "niche",
  "idealAudience",
  "targetAudience",
  "operateWhere",
  "wantClientsWhere",
  "brandTone",
  "constraints",
  "engineGoal",
]);

function isFilledValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((entry) => isFilledValue(entry));
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function isLowSignalText(value: unknown): boolean {
  const text = String(value || "").trim();
  if (!text) return false;
  if (text.length < 22) return true;
  if (/operates?\s+through\s+https?:\/\//i.test(text)) return true;
  if (/https?:\/\/[^\s]+/.test(text) && text.length < 90) return true;
  if (/official website|visit .* for more/i.test(text)) return true;
  return false;
}

function isLowSignalFieldValue(key: keyof IntakeStateV2, value: unknown): boolean {
  if (LIST_FIELD_KEYS.includes(key)) {
    const list = splitList(value, LIST_FIELD_MAX_ITEMS[key] ?? 20);
    if (!list.length) return false;
    return list.every((entry) => isLowSignalText(entry));
  }
  if (!OVERWRITABLE_LOW_SIGNAL_KEYS.has(key)) return false;
  return isLowSignalText(value);
}

function resolveAllowedFields(step: IntakeWizardStepId, scope: SuggestScope): Set<string> {
  if (scope === "global") {
    const all = new Set<string>();
    for (const fields of Object.values(STEP_FIELD_MAP)) {
      for (const field of fields) {
        all.add(String(field));
      }
    }
    return all;
  }
  return new Set(getStepFields(step).map(String));
}

function toTrackableFieldKey(key: keyof IntakeStateV2): IntakeTrackableField | null {
  if (key === "competitorLinks" || key === "handles") return null;
  return key as IntakeTrackableField;
}

export function applySuggestedToState(
  state: IntakeStateV2,
  suggested: Record<string, unknown>,
  step: IntakeWizardStepId,
  options?: {
    scope?: SuggestScope;
    overwritePolicy?: OverwritePolicy;
    fieldMeta?: IntakeFieldMetaMap;
    nowIso?: string;
  }
): { next: IntakeStateV2; suggestedKeys: Set<string>; nextFieldMeta: IntakeFieldMetaMap } {
  const scope = options?.scope || "step";
  const overwritePolicy = options?.overwritePolicy || "missing_only";
  const allowed = resolveAllowedFields(step, scope);
  const nowIso = options?.nowIso || new Date().toISOString();
  const nextFieldMeta: IntakeFieldMetaMap = { ...(options?.fieldMeta || {}) };
  const next: IntakeStateV2 = { ...state };
  const suggestedKeys = new Set<string>();

  for (const [rawKey, rawValue] of Object.entries(suggested || {})) {
    if (!allowed.has(rawKey)) continue;

    const key = rawKey as keyof IntakeStateV2;
    const currentValue = next[key];
    const trackableKey = toTrackableFieldKey(key);
    const metaSource: IntakeFieldSource | undefined = trackableKey ? nextFieldMeta[trackableKey]?.source : undefined;
    const isUserLocked = metaSource === "user";
    const currentFilled = isFilledValue(currentValue);
    const canReplaceLowSignal =
      overwritePolicy === "missing_or_low_signal" &&
      !isUserLocked &&
      currentFilled &&
      isLowSignalFieldValue(key, currentValue);
    const shouldApply = !currentFilled || canReplaceLowSignal;
    if (!shouldApply) continue;

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
        nextFieldMeta.websites = {
          source: "ai",
          lastUpdatedAt: nowIso,
        };
        nextFieldMeta.socialReferences = {
          source: "ai",
          lastUpdatedAt: nowIso,
        };
        if (!nextFieldMeta.website && next.website) {
          nextFieldMeta.website = {
            source: "ai",
            lastUpdatedAt: nowIso,
          };
        }
        continue;
      }

      if (key === "socialReferences") {
        const mergedSocialReferences = normalizeSocialReferenceList(
          [rawValue, next.socialReferences, next.websites, next.website],
          12
        );
        next.socialReferences = mergedSocialReferences;
        suggestedKeys.add(rawKey);
        nextFieldMeta.socialReferences = {
          source: "ai",
          lastUpdatedAt: nowIso,
        };
        continue;
      }

      const listValue = splitList(rawValue, LIST_FIELD_MAX_ITEMS[key] ?? 20);
      (next[key] as unknown) = listValue;
      if (key === "competitorInspirationLinks") {
        next.competitorLinks = buildLinkItems(listValue);
      }
      suggestedKeys.add(rawKey);
      if (trackableKey) {
        nextFieldMeta[trackableKey] = {
          source: "ai",
          lastUpdatedAt: nowIso,
        };
      }
      continue;
    }

    if (key === "autonomyLevel") {
      next.autonomyLevel = String(rawValue || "").toLowerCase() === "auto" ? "auto" : "assist";
      suggestedKeys.add(rawKey);
      if (trackableKey) {
        nextFieldMeta[trackableKey] = {
          source: "ai",
          lastUpdatedAt: nowIso,
        };
      }
      continue;
    }

    if (key === "handles" || key === "primaryChannel" || key === "competitorLinks") {
      continue;
    }

    (next[key] as unknown) = normalizeText(rawValue);
    suggestedKeys.add(rawKey);
    if (trackableKey) {
      nextFieldMeta[trackableKey] = {
        source: "ai",
        lastUpdatedAt: nowIso,
      };
    }
  }

  return { next, suggestedKeys, nextFieldMeta };
}

export function applySuggestedHandles(
  state: IntakeStateV2,
  suggestedHandles?: Record<string, string>
): { next: IntakeStateV2; suggestedPlatforms: Set<string> } {
  if (!suggestedHandles || typeof suggestedHandles !== "object") {
    return { next: state, suggestedPlatforms: new Set<string>() };
  }

  const handlesV2 = ensureNormalizedHandlesV2(state.handlesV2);
  const suggestedPlatforms = new Set<string>();

  for (const [platform, handle] of Object.entries(suggestedHandles)) {
    if (!["instagram", "tiktok", "youtube", "twitter", "linkedin"].includes(platform)) continue;
    const key = platform as PlatformId;
    const existing = extractHandleFromUrlOrRaw(key, handlesV2[key].primary || "");
    if (existing.length > 0) continue;
    const normalized = extractHandleFromUrlOrRaw(key, normalizeText(handle));
    if (!normalized) continue;
    const bucket = handlesV2[key];
    if (!bucket.handles.includes(normalized)) {
      bucket.handles = [normalized, ...bucket.handles].slice(0, 5);
    }
    bucket.primary = bucket.primary || normalized;
    handlesV2[key] = bucket;
    suggestedPlatforms.add(key);
  }

  const normalizedHandlesV2 = ensureNormalizedHandlesV2(handlesV2);
  const normalizedHandles = toPrimaryHandlesFromV2(normalizedHandlesV2);
  const nextPrimaryChannel = state.primaryChannel || pickPrimaryChannel(normalizedHandles);
  return {
    next: {
      ...state,
      handles: normalizedHandles,
      handlesV2: normalizedHandlesV2,
      primaryChannel: nextPrimaryChannel,
    },
    suggestedPlatforms,
  };
}
