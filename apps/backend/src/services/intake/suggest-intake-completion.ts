/**
 * Suggest completion for partial intro form payload using OpenAI.
 * Returns suggested values only for fields the user did not fill.
 * When website is present and Instagram is empty, discovers client social from website (domain-first) and validates.
 * No DB writes; stateless.
 */

import OpenAI from 'openai';
import { discoverClientSocialFromWebsite } from './discover-client-social.js';
import { validateSuggestedProfileIsClient } from './validate-client-profile.js';
import { resolveModelForTask } from '../ai/model-router';

let openaiClient: OpenAI | null = null;
function getOpenAiClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

const INTAKE_KEYS = [
  'name',
  'website',
  'websites',
  'oneSentenceDescription',
  'niche',
  'businessType',
  'operateWhere',
  'wantClientsWhere',
  'idealAudience',
  'targetAudience',
  'geoScope',
  'servicesList',
  'mainOffer',
  'primaryGoal',
  'secondaryGoals',
  'futureGoal',
  'engineGoal',
  'topProblems',
  'resultsIn90Days',
  'questionsBeforeBuying',
  'brandVoiceWords',
  'brandTone',
  'topicsToAvoid',
  'constraints',
  'excludedCategories',
  'language',
  'planningHorizon',
  'autonomyLevel',
  'budgetSensitivity',
  'competitorInspirationLinks',
] as const;

export type IntakeKey = (typeof INTAKE_KEYS)[number];

function isFilled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0 && value.some((x) => isFilled(x));
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export interface SuggestedHandleValidationItem {
  handle: string;
  isLikelyClient: boolean;
  confidence: number;
  reason: string;
}

export interface SuggestIntakeCompletionResult {
  suggested: Record<string, unknown>;
  filledByUser: string[];
  /** Suggested social handles (from discovery or TikTok-from-Instagram) for user to confirm. */
  suggestedHandles?: Record<string, string>;
  /** Validation for each suggested handle so UI can show "Likely your account" or "Please confirm." */
  suggestedHandleValidation?: {
    instagram?: SuggestedHandleValidationItem;
    tiktok?: SuggestedHandleValidationItem;
  };
  /** Whether the user must confirm channels before starting orchestration. */
  confirmationRequired: boolean;
  /** Machine-readable reason codes for confirmation blocking. */
  confirmationReasons: string[];
}

function normalizeHandle(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/^@+/, '').toLowerCase();
  return s;
}

const PRIMARY_CHANNELS = ['instagram', 'tiktok', 'youtube', 'twitter', 'x'] as const;
const HIGH_CONFIDENCE_THRESHOLD = 0.75;
const TIKTOK_SUGGESTION_CONFIDENCE = Number(
  process.env.TIKTOK_SUGGESTION_CONFIDENCE_THRESHOLD || 0.7
);

function hasPrimaryHandle(handles: Record<string, unknown>): boolean {
  return PRIMARY_CHANNELS.some((platform) => normalizeHandle(handles[platform]).length > 0);
}

function hasWebsiteProvided(partialPayload: Record<string, unknown>): boolean {
  const website = String(partialPayload.website || '').trim();
  if (website.length > 0) return true;
  if (Array.isArray(partialPayload.websites)) {
    return partialPayload.websites.some((entry) => String(entry || '').trim().length > 0);
  }
  if (typeof partialPayload.websites === 'string') {
    return partialPayload.websites.trim().length > 0;
  }
  return false;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join(' ');
}

function deriveBrandNameFromWebsite(website: string): string {
  const source = String(website || '').trim();
  if (!source) return '';
  try {
    const parsed = new URL(source.startsWith('http') ? source : `https://${source}`);
    const host = parsed.hostname.replace(/^www\./i, '');
    const root = host.split('.')[0] || '';
    if (!root) return '';
    return titleCase(root.replace(/[-_]+/g, ' ').trim());
  } catch {
    return '';
  }
}

function buildFallbackSuggestions(
  partialPayload: Record<string, unknown>,
  missingKeys: IntakeKey[],
  website: string
): Record<string, unknown> {
  const fallback: Record<string, unknown> = {};
  const missing = new Set<string>(missingKeys);
  const normalizedWebsite = website.trim();
  const brandName = String(partialPayload.name || '').trim() || deriveBrandNameFromWebsite(normalizedWebsite);
  const mainOffer = String(partialPayload.mainOffer || '').trim();
  const primaryGoal = String(partialPayload.primaryGoal || '').trim();

  if (normalizedWebsite) {
    if (missing.has('website')) fallback.website = normalizedWebsite;
    if (missing.has('websites')) fallback.websites = [normalizedWebsite];
  }

  if (brandName && missing.has('name')) {
    fallback.name = brandName;
  }

  if (missing.has('oneSentenceDescription') && brandName && (mainOffer || primaryGoal)) {
    fallback.oneSentenceDescription = mainOffer
      ? `${brandName} offers ${mainOffer}.`
      : `${brandName} focuses on ${primaryGoal}.`;
  }

  return fallback;
}

function keepOnlyMissingKeys(
  suggested: Record<string, unknown>,
  missingKeys: IntakeKey[]
): Record<string, unknown> {
  const allowed = new Set<string>(missingKeys);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(suggested || {})) {
    if (!allowed.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export async function suggestIntakeCompletion(
  partialPayload: Record<string, unknown>
): Promise<SuggestIntakeCompletionResult> {
  const openai = getOpenAiClient();

  const filledByUser: string[] = [];
  const contextParts: string[] = [];

  for (const key of INTAKE_KEYS) {
    const raw = partialPayload[key];
    if (isFilled(raw)) {
      filledByUser.push(key);
      const display =
        Array.isArray(raw) ? (raw as unknown[]).join(', ') : String(raw);
      contextParts.push(`${key}: ${display}`);
    }
  }

  if (contextParts.length === 0) {
    return {
      suggested: {},
      filledByUser: [],
      confirmationRequired: true,
      confirmationReasons: ['MISSING_PRIMARY_CHANNEL'],
    };
  }

  const contextStr = contextParts.join('\n');
  const missingKeys = INTAKE_KEYS.filter((k) => !filledByUser.includes(k));
  const handles =
    partialPayload.handles && typeof partialPayload.handles === 'object'
      ? (partialPayload.handles as Record<string, unknown>)
      : {};
  const hasWebsite = hasWebsiteProvided(partialPayload);
  const websiteCandidates = Array.isArray(partialPayload.websites)
    ? partialPayload.websites
    : typeof partialPayload.websites === 'string'
      ? [partialPayload.websites]
      : [];
  const websiteFromList = websiteCandidates.find((entry) => String(entry || '').trim().length > 0);
  const website = String(websiteFromList || partialPayload.website || '').trim();
  const name = String(partialPayload.name || '').trim();

  if (missingKeys.length === 0) {
    const confirmationReasons =
      hasPrimaryHandle(handles) || hasWebsite ? [] : ['MISSING_PRIMARY_CHANNEL'];
    return {
      suggested: {},
      filledByUser: [...INTAKE_KEYS],
      confirmationRequired: confirmationReasons.length > 0,
      confirmationReasons,
    };
  }

  let suggested: Record<string, unknown> = buildFallbackSuggestions(partialPayload, missingKeys, website);

  if (openai && contextParts.length > 0) {
    const systemPrompt = `You are a brand strategy assistant. Given partial business intake form data, suggest plausible values ONLY for the missing fields. Return a JSON object with exactly the keys listed in the "Missing keys" section. Rules:
- Do not suggest values for fields the user already provided.
- For list fields (websites, servicesList, topProblems, resultsIn90Days, questionsBeforeBuying, secondaryGoals, excludedCategories, competitorInspirationLinks) return an array of strings.
- For single-line fields return a string. Keep suggestions concise and consistent with the provided context.
- competitorInspirationLinks: return an empty array or leave out if you cannot suggest real URLs.
- brandVoiceWords: 3-5 words only. topicsToAvoid: short list or comma-separated.
- Be professional and aligned with the business context.`;

    const userPrompt = `Context (fields the user already filled):
${contextStr}

Missing keys to suggest (return JSON only with these keys): ${missingKeys.join(', ')}

Return a single JSON object. No explanation.`;

    try {
      const response = await openai.chat.completions.create({
        model: resolveModelForTask('intake_completion'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 1500,
      });

      const raw = response.choices[0]?.message?.content || '{}';
      const aiSuggested = keepOnlyMissingKeys(JSON.parse(raw) as Record<string, unknown>, missingKeys);
      suggested = {
        ...suggested,
        ...aiSuggested,
      };
    } catch (error: unknown) {
      console.warn('[SuggestIntake] AI completion fallback:', (error as Error)?.message || String(error));
      suggested = keepOnlyMissingKeys(suggested, missingKeys);
    }
  } else {
    suggested = keepOnlyMissingKeys(suggested, missingKeys);
  }

  const suggestedHandles: Record<string, string> = {};
  const suggestedHandleValidation: SuggestIntakeCompletionResult['suggestedHandleValidation'] = {};
  const instagramHandle = normalizeHandle(handles.instagram);
  const tiktokHandle = normalizeHandle(handles.tiktok);

  // Discover client Instagram/TikTok from website when user left them empty (domain-first search; never infer from brand name).
  if (website && !instagramHandle) {
    try {
      const discovered = await discoverClientSocialFromWebsite(website, name);
      if (discovered.instagram) {
        suggestedHandles.instagram = discovered.instagram;
        const validation = await validateSuggestedProfileIsClient({
          handle: discovered.instagram,
          platform: 'instagram',
          clientWebsite: website,
          clientName: name,
        });
        suggestedHandleValidation.instagram = {
          handle: discovered.instagram,
          isLikelyClient: validation.isLikelyClient,
          confidence: validation.confidence,
          reason: validation.reason,
        };
      }
      if (discovered.tiktok && !tiktokHandle) {
        suggestedHandles.tiktok = discovered.tiktok;
        const validation = await validateSuggestedProfileIsClient({
          handle: discovered.tiktok,
          platform: 'tiktok',
          clientWebsite: website,
          clientName: name,
        });
        suggestedHandleValidation.tiktok = {
          handle: discovered.tiktok,
          isLikelyClient: validation.isLikelyClient,
          confidence: validation.confidence,
          reason: validation.reason,
        };
      }
    } catch (err: unknown) {
      console.warn('[SuggestIntake] Discover/validate client social failed:', (err as Error)?.message);
    }
  }

  // Suggest TikTok from Instagram when user already filled Instagram (many brands use same handle),
  // but only if we can validate with decent confidence.
  if (instagramHandle && !tiktokHandle && !suggestedHandles.tiktok) {
    try {
      const validation = await validateSuggestedProfileIsClient({
        handle: instagramHandle,
        platform: 'tiktok',
        clientWebsite: website,
        clientName: name,
      });
      suggestedHandleValidation.tiktok = {
        handle: instagramHandle,
        isLikelyClient: validation.isLikelyClient,
        confidence: validation.confidence,
        reason: validation.reason,
      };
      if (validation.isLikelyClient && validation.confidence >= TIKTOK_SUGGESTION_CONFIDENCE) {
        suggestedHandles.tiktok = instagramHandle;
      }
    } catch (err: unknown) {
      console.warn('[SuggestIntake] TikTok-from-Instagram validation failed:', (err as Error)?.message);
    }
  }

  const hasUserPrimaryHandle = hasPrimaryHandle(handles);
  const suggestedValidations = Object.values(suggestedHandleValidation || {}).filter(Boolean) as SuggestedHandleValidationItem[];
  const hasHighConfidenceSuggestedPrimary = suggestedValidations.some(
    (item) => item.isLikelyClient && Number(item.confidence || 0) >= HIGH_CONFIDENCE_THRESHOLD
  );
  const hasLowConfidenceSuggestion = suggestedValidations.some(
    (item) => !item.isLikelyClient || Number(item.confidence || 0) < HIGH_CONFIDENCE_THRESHOLD
  );
  const hasUnvalidatedSuggestedPrimary = Object.keys(suggestedHandles).some((platform) => {
    if (!PRIMARY_CHANNELS.includes(platform as (typeof PRIMARY_CHANNELS)[number])) return false;
    if (hasUserPrimaryHandle) return false;
    if (platform === 'instagram' && suggestedHandleValidation.instagram) return false;
    if (platform === 'tiktok' && suggestedHandleValidation.tiktok) return false;
    return true;
  });

  const confirmationReasons: string[] = [];
  if (!hasUserPrimaryHandle && !hasHighConfidenceSuggestedPrimary && !hasWebsite) {
    confirmationReasons.push('MISSING_PRIMARY_CHANNEL');
  }
  if (hasLowConfidenceSuggestion || hasUnvalidatedSuggestedPrimary) {
    confirmationReasons.push('LOW_CONFIDENCE_SUGGESTION');
  }

  const result: SuggestIntakeCompletionResult = {
    suggested,
    filledByUser,
    ...(Object.keys(suggestedHandles).length > 0 ? { suggestedHandles } : {}),
    ...(Object.keys(suggestedHandleValidation).length > 0 ? { suggestedHandleValidation } : {}),
    confirmationRequired: confirmationReasons.length > 0,
    confirmationReasons,
  };
  return result;
}
