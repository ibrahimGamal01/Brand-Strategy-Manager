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

function sanitizeSentence(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .trim();
}

function extractDescriptionFromEvidence(websiteEvidence: string, brandName: string): string {
  const text = String(websiteEvidence || '').trim();
  if (!text) return '';
  const candidates = text
    .split(/[\n.!?]+/)
    .map((row) => sanitizeSentence(row))
    .filter(Boolean)
    .filter((row) => {
      const words = row.split(/\s+/).filter(Boolean);
      return words.length >= 8 && words.length <= 34;
    })
    .filter((row) => row.length >= 60 && row.length <= 240)
    .filter(
      (row) =>
        !/cookie|privacy|terms|copyright|javascript|menu|navigation|login|log in|sign up|subscribe|tip|tips|cart|checkout|home page/i.test(
          row
        )
    );

  const preferred = candidates.find((row) =>
    /(offers|offer|provides|provide|supports|support|helps|help|deliver|delivers|enables|allow|experience|experiences|subscription|program|service|device|platform)/i.test(
      row
    )
  );
  const selected = preferred || '';
  if (!selected) return '';

  const normalized = selected.endsWith('.') ? selected : `${selected}.`;
  if (brandName && !new RegExp(brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(normalized)) {
    return `${brandName} ${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`;
  }
  return normalized;
}

function inferNicheFromEvidence(websiteEvidence: string): string {
  const text = String(websiteEvidence || '').toLowerCase();
  if (!text) return '';
  if (
    /(wellness|wellbeing|healing|nervous system|sleep|biohacking|biophoton|coherence|holistic|stress|calm)/.test(
      text
    )
  ) {
    return 'Wellness / holistic health';
  }
  if (/(marketing|agency|brand strategy|lead generation|content strategy|campaign)/.test(text)) {
    return 'Marketing / brand strategy';
  }
  if (/(saas|software|platform|api|automation|developer)/.test(text)) {
    return 'SaaS / software';
  }
  if (/(ecommerce|shop|store|cart|product catalog|sku)/.test(text)) {
    return 'E-commerce';
  }
  if (/(coaching|consulting|advisor|training|workshop)/.test(text)) {
    return 'Coaching / consulting';
  }
  return '';
}

function uniqueList(values: string[], maxItems: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const item = sanitizeSentence(raw);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

function extractUrlsFromEvidence(websiteEvidence: string): string[] {
  const text = String(websiteEvidence || '');
  const matches = text.match(/https?:\/\/[^\s)]+/gi) || [];
  return uniqueList(matches, 30);
}

function slugToTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname
      .split('/')
      .filter(Boolean)
      .pop();
    if (!segment) return '';
    return segment
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (s) => s.toUpperCase())
      .trim();
  } catch {
    return '';
  }
}

function extractServiceCandidates(websiteEvidence: string): string[] {
  const text = String(websiteEvidence || '');
  if (!text) return [];
  const candidates: string[] = [];

  const namedPatterns = [
    /\bBioHealing Stream\b/gi,
    /\bELUUMIS SKY\b/gi,
    /\bELUUMIS MATTER\b/gi,
    /\bSelf[- ]Healing\b/gi,
    /\bPRO program\b/gi,
  ];
  for (const pattern of namedPatterns) {
    const matches = text.match(pattern) || [];
    candidates.push(...matches);
  }

  const genericMatches =
    text.match(
      /\b[A-Z][A-Za-z0-9&+\-]{2,}(?:\s+[A-Z][A-Za-z0-9&+\-]{2,}){0,4}\s+(?:program|subscription|service|services|device|devices|class|classes|community)\b/g
    ) || [];
  candidates.push(...genericMatches);

  for (const url of extractUrlsFromEvidence(text)) {
    const title = slugToTitle(url);
    if (!title) continue;
    if (!/(program|service|product|subscription|healing|stream|matter|sky|professional|self)/i.test(title)) continue;
    candidates.push(title);
  }

  return uniqueList(candidates, 20);
}

function hasWellnessSignals(websiteEvidence: string): boolean {
  return /(wellness|wellbeing|healing|nervous system|sleep|biohacking|biophoton|coherence|stress|calm|energy)/i.test(
    String(websiteEvidence || '')
  );
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
  const websiteEvidence = String(partialPayload._websiteEvidence || partialPayload.websiteEvidence || '').trim();
  const serviceCandidates = extractServiceCandidates(websiteEvidence);
  const wellnessSignals = hasWellnessSignals(websiteEvidence);
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

  if (missing.has('oneSentenceDescription')) {
    const extractedDescription = extractDescriptionFromEvidence(websiteEvidence, brandName);
    if (extractedDescription) {
      fallback.oneSentenceDescription = extractedDescription;
    } else if (brandName && (mainOffer || primaryGoal)) {
      fallback.oneSentenceDescription = mainOffer
        ? `${brandName} offers ${mainOffer}.`
        : `${brandName} focuses on ${primaryGoal}.`;
    } else if (brandName && normalizedWebsite) {
      fallback.oneSentenceDescription = `${brandName} operates through ${normalizedWebsite}.`;
    }
  }

  if (missing.has('niche')) {
    const inferredNiche = inferNicheFromEvidence(websiteEvidence);
    if (inferredNiche) {
      fallback.niche = inferredNiche;
    }
  }

  if (missing.has('businessType')) {
    if (/subscription|plan|membership|stream/i.test(websiteEvidence)) {
      fallback.businessType = 'Subscription business';
    } else if (/agency|consulting|services/i.test(websiteEvidence)) {
      fallback.businessType = 'Service business';
    }
  }

  if (missing.has('servicesList') && serviceCandidates.length > 0) {
    fallback.servicesList = serviceCandidates.slice(0, 20);
  }

  if (missing.has('mainOffer')) {
    const preferred =
      serviceCandidates.find((entry) => /(stream|subscription|program|service)/i.test(entry)) || serviceCandidates[0];
    if (preferred) fallback.mainOffer = preferred;
  }

  if (missing.has('primaryGoal')) {
    if (/subscription|membership|stream/i.test(websiteEvidence)) {
      fallback.primaryGoal = 'Grow qualified subscription signups from content and website traffic.';
    } else if (wellnessSignals) {
      fallback.primaryGoal = 'Increase qualified leads and booked sessions from educational wellness content.';
    }
  }

  if (missing.has('idealAudience') && wellnessSignals) {
    fallback.idealAudience =
      'Wellness-focused adults seeking stress relief, better sleep, and consistent at-home routines.';
  }

  if (missing.has('topProblems') && wellnessSignals) {
    fallback.topProblems = [
      'Stress and nervous-system overload',
      'Poor sleep and low recovery',
      'Low energy and inconsistent daily wellbeing routines',
    ];
  }

  if (missing.has('resultsIn90Days')) {
    fallback.resultsIn90Days = [
      'Increase qualified lead volume from content',
      'Improve conversion from website visitors into trials, bookings, or subscriptions',
    ];
  }

  if (missing.has('questionsBeforeBuying')) {
    fallback.questionsBeforeBuying = [
      'How does this work and what should I expect from the experience?',
      'How quickly do people typically see meaningful results?',
      'What setup, pricing, and support are included?',
    ];
  }

  if (missing.has('brandVoiceWords') && wellnessSignals) {
    fallback.brandVoiceWords = ['Calm', 'Grounded', 'Empowering', 'Evidence-led'];
  }

  if (missing.has('topicsToAvoid') && wellnessSignals) {
    fallback.topicsToAvoid = ['Medical cure claims', 'Fear-based messaging', 'Political or religious debates'];
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

  const websiteEvidence = String(partialPayload._websiteEvidence || partialPayload.websiteEvidence || '').trim();
  if (websiteEvidence) {
    contextParts.push(`websiteEvidence: ${websiteEvidence}`);
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
