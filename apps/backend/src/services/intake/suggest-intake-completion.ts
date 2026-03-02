/**
 * Suggest completion for partial intro form payload using OpenAI.
 * Returns suggested values only for fields the user did not fill.
 * When website is present and Instagram is empty, discovers client social from website (domain-first) and validates.
 * No DB writes; stateless.
 */

import { discoverClientSocialFromWebsite } from './discover-client-social.js';
import { validateSuggestedProfileIsClient } from './validate-client-profile.js';
import { openai as openaiClient, OpenAI } from '../ai/openai-client';
import {
  normalizeHandleFromUrlOrHandle,
  normalizeSocialHandlePlatform,
} from '../handles/platform-handle';

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
const INTAKE_LIST_KEYS = new Set<IntakeKey>([
  'websites',
  'servicesList',
  'secondaryGoals',
  'topProblems',
  'resultsIn90Days',
  'questionsBeforeBuying',
  'brandVoiceWords',
  'topicsToAvoid',
  'excludedCategories',
  'competitorInspirationLinks',
]);

export type IntakeKey = (typeof INTAKE_KEYS)[number];
export type IntakeSuggestionStep = 'brand' | 'channels' | 'offer' | 'audience' | 'voice';

const STEP_KEY_MAP: Record<IntakeSuggestionStep, readonly IntakeKey[]> = {
  brand: ['name', 'website', 'websites', 'oneSentenceDescription', 'niche', 'businessType'],
  channels: [],
  offer: ['mainOffer', 'servicesList', 'primaryGoal', 'budgetSensitivity', 'secondaryGoals', 'futureGoal'],
  audience: [
    'idealAudience',
    'targetAudience',
    'operateWhere',
    'wantClientsWhere',
    'topProblems',
    'resultsIn90Days',
    'questionsBeforeBuying',
  ],
  voice: [
    'brandVoiceWords',
    'topicsToAvoid',
    'constraints',
    'competitorInspirationLinks',
    'language',
    'planningHorizon',
    'autonomyLevel',
    'brandTone',
    'engineGoal',
  ],
};

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
    linkedin?: SuggestedHandleValidationItem;
    youtube?: SuggestedHandleValidationItem;
    twitter?: SuggestedHandleValidationItem;
  };
  suggestedHandleCandidates?: SuggestedHandleCandidate[];
  warnings?: string[];
  /** Whether the user must confirm channels before starting orchestration. */
  confirmationRequired: boolean;
  /** Machine-readable reason codes for confirmation blocking. */
  confirmationReasons: string[];
}

export interface SuggestedHandleCandidate {
  platform: 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'linkedin';
  handle: string;
  profileUrl?: string;
  confidence: number;
  reason: string;
  source: string;
  isLikelyClient: boolean;
}

function normalizeHandle(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/^@+/, '').toLowerCase();
  return s;
}

const PRIMARY_CHANNELS = ['instagram', 'tiktok', 'youtube', 'twitter', 'x', 'linkedin'] as const;
const HIGH_CONFIDENCE_THRESHOLD = 0.75;
const AUTO_APPLY_HANDLE_THRESHOLD = Number(process.env.SUGGEST_HANDLE_AUTO_APPLY_THRESHOLD || 0.82);
const TIKTOK_SUGGESTION_CONFIDENCE = Number(
  process.env.TIKTOK_SUGGESTION_CONFIDENCE_THRESHOLD || 0.7
);
const SOCIAL_VALIDATION_CANDIDATE_LIMIT = Number(process.env.SUGGEST_SOCIAL_VALIDATION_LIMIT || 6);
const SOCIAL_VALIDATION_MIN_CONFIDENCE = Number(process.env.SUGGEST_SOCIAL_VALIDATION_MIN_CONFIDENCE || 0.6);
const ENABLE_CROSS_PLATFORM_GUESS = String(process.env.SUGGEST_CROSS_PLATFORM_GUESS || '')
  .trim()
  .toLowerCase() === 'true';
const AUTO_APPLY_DISCOVERED_HANDLES = String(process.env.SUGGEST_AUTO_APPLY_DISCOVERED_HANDLES || '')
  .trim()
  .toLowerCase() === 'true';
const DISCOVERED_HANDLE_AUTO_APPLY_MIN_CONFIDENCE = Number(
  process.env.SUGGEST_DISCOVERED_HANDLE_AUTO_APPLY_MIN_CONFIDENCE || 0.9
);

function containsUrl(value: string): boolean {
  return /https?:\/\/|(?:^|\s)(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(String(value || ''));
}

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

function parseSuggestionStep(value: unknown): IntakeSuggestionStep | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'brand' || raw === 'channels' || raw === 'offer' || raw === 'audience' || raw === 'voice') {
    return raw;
  }
  return undefined;
}

function filterMissingKeysForStep(
  missingKeys: IntakeKey[],
  step?: IntakeSuggestionStep
): IntakeKey[] {
  if (!step) return missingKeys;
  const allowed = new Set<string>(STEP_KEY_MAP[step]);
  return missingKeys.filter((key) => allowed.has(key));
}

function sanitizeSentence(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .trim();
}

function isLowSignalAutofillText(value: unknown): boolean {
  const text = sanitizeSentence(String(value || ''));
  if (!text) return false;
  if (text.length < 24) return true;
  if (/(operates through|through https?:\/\/|visit .* for more|official website)/i.test(text)) return true;
  if (/^([a-z0-9][a-z0-9\s._-]{1,40})\s+(is|offers|operates)\s+through\s+https?:\/\//i.test(text)) return true;
  return false;
}

function isNoisySuggestionItem(value: string): boolean {
  const text = sanitizeSentence(String(value || ''));
  if (!text) return true;
  if (
    /(chatgpt|jailbreak|prompt injection|mp3|download music|lyrics|torrent|casino|betting|porn|adult|logo design services|buy followers|cheap seo|free download)/i.test(
      text
    )
  ) {
    return true;
  }
  if (/^buy\s+/i.test(text) && /services?/i.test(text)) return true;
  return false;
}

function sanitizeListSuggestion(value: unknown, maxItems = 20): string[] {
  return parseLooseList(value, maxItems).filter(
    (entry) => !isLowSignalAutofillText(entry) && !isNoisySuggestionItem(entry)
  );
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
    .filter((row) => !containsUrl(row))
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

function parseLooseList(value: unknown, maxItems = 20): string[] {
  if (Array.isArray(value)) {
    return uniqueList(
      value.map((entry) => sanitizeSentence(String(entry || ''))).filter(Boolean),
      maxItems
    );
  }

  const text = sanitizeSentence(String(value || ''));
  if (!text) return [];
  return uniqueList(
    text
      .split(/[\n,;|]+/)
      .map((entry) => sanitizeSentence(entry))
      .filter(Boolean),
    maxItems
  );
}

function parseStringCandidates(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  const text = String(value || '').trim();
  if (!text) return [];
  const urls = text.match(/https?:\/\/[^\s)]+/gi) || [];
  if (urls.length > 0) return urls.map((entry) => entry.trim()).filter(Boolean);
  return text
    .split(/[\n,;|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function inferSocialPlatformFromReference(
  rawValue: string
): SuggestedHandleCandidate['platform'] | null {
  const lower = String(rawValue || '').toLowerCase();
  if (lower.includes('instagram.com/')) return 'instagram';
  if (lower.includes('tiktok.com/')) return 'tiktok';
  if (lower.includes('youtube.com/') || lower.includes('youtu.be/')) return 'youtube';
  if (lower.includes('linkedin.com/')) return 'linkedin';
  if (lower.includes('x.com/') || lower.includes('twitter.com/')) return 'twitter';
  return null;
}

function profileUrlFromHandle(platform: SuggestedHandleCandidate['platform'], handle: string): string {
  const normalized = normalizeHandle(handle);
  if (!normalized) return '';
  if (platform === 'instagram') return `https://www.instagram.com/${normalized}`;
  if (platform === 'tiktok') return `https://www.tiktok.com/@${normalized}`;
  if (platform === 'youtube') return `https://www.youtube.com/@${normalized}`;
  if (platform === 'linkedin') return `https://www.linkedin.com/in/${normalized}`;
  return `https://x.com/${normalized}`;
}

function candidateKey(candidate: Pick<SuggestedHandleCandidate, 'platform' | 'handle'>): string {
  return `${candidate.platform}:${normalizeHandle(candidate.handle)}`;
}

function parseUserSocialReferenceCandidates(payload: Record<string, unknown>): SuggestedHandleCandidate[] {
  const rawValues = parseStringCandidates(payload.socialReferences);
  const candidates: SuggestedHandleCandidate[] = [];
  for (const raw of rawValues) {
    const platformFromString = normalizeSocialHandlePlatform(raw);
    const inferredPlatform = inferSocialPlatformFromReference(raw);
    const normalizedPlatform =
      platformFromString === 'x'
        ? 'twitter'
        : platformFromString && platformFromString !== 'facebook'
          ? platformFromString
          : inferredPlatform;
    if (!normalizedPlatform) continue;
    if (
      normalizedPlatform !== 'instagram' &&
      normalizedPlatform !== 'tiktok' &&
      normalizedPlatform !== 'youtube' &&
      normalizedPlatform !== 'twitter' &&
      normalizedPlatform !== 'linkedin'
    ) {
      continue;
    }
    const parserPlatform = normalizedPlatform === 'twitter' ? 'x' : normalizedPlatform;
    const handle = normalizeHandleFromUrlOrHandle(raw, parserPlatform);
    if (!handle) continue;
    candidates.push({
      platform: normalizedPlatform,
      handle,
      profileUrl: profileUrlFromHandle(normalizedPlatform, handle) || raw,
      confidence: 0.98,
      reason: 'Detected directly from social profile URL provided in websites stage.',
      source: 'user_provided_social_url',
      isLikelyClient: true,
    });
  }
  return candidates;
}

function mergeHandleCandidates(
  candidates: SuggestedHandleCandidate[],
  limit = 15
): SuggestedHandleCandidate[] {
  const map = new Map<string, SuggestedHandleCandidate>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const existing = map.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      map.set(key, candidate);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

function deriveServiceCandidatesFromDescription(description: string): string[] {
  const text = sanitizeSentence(description);
  if (!text) return [];

  const candidates: string[] = [];
  const verbMatch = text.match(
    /\b(?:offer|offers|provide|provides|deliver|delivers|sell|sells|include|includes|focus(?:es)? on)\b\s+([^.!?]+)/i
  );
  if (verbMatch?.[1]) {
    const split = verbMatch[1]
      .split(/\s*(?:,|\/|\+|\band\b|\bor\b)\s*/i)
      .map((entry) => sanitizeSentence(entry))
      .filter((entry) => entry.length >= 3);
    candidates.push(...split);
  }

  const titleLike =
    text.match(/\b[A-Z][A-Za-z0-9&+\-]{2,}(?:\s+[A-Z][A-Za-z0-9&+\-]{2,}){0,4}\b/g) || [];
  candidates.push(...titleLike);

  return uniqueList(candidates, 20);
}

function deriveMainOfferFromDescription(description: string): string {
  const text = sanitizeSentence(description);
  if (!text) return '';
  const clause =
    text.match(
      /\b(?:offer|offers|provide|provides|deliver|delivers|sell|sells|focus(?:es)? on)\b\s+([^.!?]+)/i
    )?.[1] || '';
  const cleaned = sanitizeSentence(clause).replace(/^(an?|the)\s+/i, '');
  if (cleaned.length >= 6) return cleaned;
  if (text.length <= 120) return text.replace(/\.$/, '');
  return '';
}

function deriveAudienceFromDescription(description: string): string {
  const text = sanitizeSentence(description);
  if (!text) return '';
  const audience = text.match(/\bfor\s+([^.!?]+)/i)?.[1] || '';
  const cleaned = sanitizeSentence(audience).replace(/\b(via|through|using)\b.*$/i, '');
  if (cleaned.length >= 8) return cleaned;
  return '';
}

function inferNicheFromContext(websiteEvidence: string, oneSentenceDescription: string): string {
  const byEvidence = inferNicheFromEvidence(websiteEvidence);
  if (byEvidence) return byEvidence;
  return inferNicheFromEvidence(oneSentenceDescription);
}

function derivePrimaryGoal(websiteEvidence: string, oneSentenceDescription: string, mainOffer: string): string {
  const text = `${websiteEvidence}\n${oneSentenceDescription}\n${mainOffer}`.toLowerCase();
  if (!text.trim()) return '';
  if (/subscription|membership|stream|plan/.test(text)) {
    return 'Grow qualified subscription signups from content and website traffic.';
  }
  if (/book|booking|call|consult|appointment|demo|session/.test(text)) {
    return 'Increase qualified bookings and consultation requests from content.';
  }
  if (/shop|ecommerce|e-commerce|device|product|purchase|checkout/.test(text)) {
    return 'Increase qualified product purchases driven by educational content.';
  }
  if (/agency|service|services|consulting/.test(text)) {
    return 'Increase qualified inbound leads and close-ready conversations from content.';
  }
  return 'Increase qualified leads and conversions from content and website traffic.';
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
  const ddgEvidence = String(partialPayload._ddgEvidence || partialPayload.ddgEvidence || '').trim();
  const evidenceContext = [websiteEvidence, ddgEvidence].filter(Boolean).join('\n').trim();
  const oneSentenceDescription = sanitizeSentence(
    String(
      partialPayload.oneSentenceDescription ||
        partialPayload.description ||
        partialPayload.businessOverview ||
        ''
    )
  );
  const serviceCandidates = uniqueList(
    [
      ...extractServiceCandidates(evidenceContext),
      ...deriveServiceCandidatesFromDescription(oneSentenceDescription),
      ...parseLooseList(partialPayload.servicesList, 20),
    ],
    20
  );
  const wellnessSignals = hasWellnessSignals(evidenceContext);
  const brandName = String(partialPayload.name || '').trim() || deriveBrandNameFromWebsite(normalizedWebsite);
  const mainOffer =
    String(partialPayload.mainOffer || '').trim() || deriveMainOfferFromDescription(oneSentenceDescription);
  const primaryGoal = String(partialPayload.primaryGoal || '').trim();
  const targetAudience = sanitizeSentence(String(partialPayload.targetAudience || ''));
  const idealAudienceInput = sanitizeSentence(String(partialPayload.idealAudience || ''));
  const brandTone = sanitizeSentence(String(partialPayload.brandTone || ''));
  const constraints = sanitizeSentence(String(partialPayload.constraints || ''));

  if (normalizedWebsite) {
    if (missing.has('website')) fallback.website = normalizedWebsite;
    if (missing.has('websites')) fallback.websites = [normalizedWebsite];
  }

  if (brandName && missing.has('name')) {
    fallback.name = brandName;
  }

  if (missing.has('oneSentenceDescription')) {
    const extractedDescription = extractDescriptionFromEvidence(evidenceContext, brandName);
    if (extractedDescription && !isLowSignalAutofillText(extractedDescription) && !containsUrl(extractedDescription)) {
      fallback.oneSentenceDescription = extractedDescription;
    } else if (brandName && (mainOffer || primaryGoal)) {
      const audienceLabel = sanitizeSentence(targetAudience || idealAudienceInput || '');
      if (mainOffer) {
        fallback.oneSentenceDescription = audienceLabel
          ? `${brandName} helps ${audienceLabel} through ${mainOffer}.`
          : `${brandName} delivers ${mainOffer} to drive measurable outcomes.`;
      } else {
        fallback.oneSentenceDescription = `${brandName} focuses on ${primaryGoal}.`;
      }
    } else if (brandName) {
      fallback.oneSentenceDescription = `${brandName} helps clients achieve measurable outcomes through focused offers and clear execution.`;
    }
  }

  if (missing.has('niche')) {
    const inferredNiche = inferNicheFromContext(evidenceContext, oneSentenceDescription);
    if (inferredNiche) {
      fallback.niche = inferredNiche;
    }
  }

  if (missing.has('businessType')) {
    if (/subscription|plan|membership|stream/i.test(evidenceContext)) {
      fallback.businessType = 'Subscription business';
    } else if (/shop|store|checkout|cart|product|device/i.test(`${evidenceContext}\n${oneSentenceDescription}`)) {
      fallback.businessType = 'Product business';
    } else if (/agency|consulting|services/i.test(evidenceContext)) {
      fallback.businessType = 'Service business';
    }
  }

  if (missing.has('servicesList')) {
    if (serviceCandidates.length > 0) {
      fallback.servicesList = serviceCandidates.slice(0, 20);
    } else if (mainOffer) {
      fallback.servicesList = [mainOffer];
    }
  }

  if (missing.has('mainOffer')) {
    const preferred = serviceCandidates.find((entry) =>
      /(stream|subscription|program|service|product|course|membership|device)/i.test(entry)
    );
    const fallbackOffer = preferred || serviceCandidates[0] || mainOffer;
    const normalizedOffer = sanitizeSentence(fallbackOffer);
    if (normalizedOffer && !containsUrl(normalizedOffer) && !isLowSignalAutofillText(normalizedOffer)) {
      fallback.mainOffer = normalizedOffer;
    }
  }

  if (missing.has('primaryGoal')) {
    const derivedPrimaryGoal = derivePrimaryGoal(evidenceContext, oneSentenceDescription, mainOffer);
    if (derivedPrimaryGoal) {
      fallback.primaryGoal = derivedPrimaryGoal;
    }
  }

  if (missing.has('idealAudience')) {
    if (idealAudienceInput) {
      fallback.idealAudience = idealAudienceInput;
    } else if (targetAudience) {
      fallback.idealAudience = targetAudience;
    } else {
      const fromDescription = deriveAudienceFromDescription(oneSentenceDescription);
      if (fromDescription) {
        fallback.idealAudience = fromDescription;
      } else if (wellnessSignals) {
        fallback.idealAudience =
          'Wellness-focused adults seeking stress relief, better sleep, and consistent at-home routines.';
      }
    }
  }

  if (missing.has('targetAudience')) {
    if (targetAudience) {
      fallback.targetAudience = targetAudience;
    } else if (idealAudienceInput) {
      fallback.targetAudience = idealAudienceInput;
    } else {
      const fromDescription = deriveAudienceFromDescription(oneSentenceDescription);
      if (fromDescription) fallback.targetAudience = fromDescription;
    }
  }

  if (missing.has('topProblems')) {
    if (wellnessSignals) {
      fallback.topProblems = [
        'Stress and nervous-system overload',
        'Poor sleep and low recovery',
        'Low energy and inconsistent daily wellbeing routines',
      ];
    } else {
      fallback.topProblems = [
        'Lack of clarity on what the offer does and who it is for',
        'Low trust before buying or booking',
        'Inconsistent conversion from content into qualified actions',
      ];
    }
  }

  if (missing.has('resultsIn90Days')) {
    fallback.resultsIn90Days = [
      'Increase qualified lead volume from content',
      'Improve conversion from website visitors into trials, bookings, or subscriptions',
    ];
  }

  if (missing.has('questionsBeforeBuying')) {
    const offerLabel = sanitizeSentence(mainOffer).toLowerCase();
    fallback.questionsBeforeBuying = [
      offerLabel
        ? `How does ${offerLabel} work and what should I expect?`
        : 'How does this work and what should I expect from the experience?',
      'How quickly do people typically see meaningful results?',
      'What setup, pricing, and support are included?',
    ];
  }

  if (missing.has('brandVoiceWords')) {
    const toneWords = parseLooseList(brandTone, 6);
    if (toneWords.length > 0) {
      fallback.brandVoiceWords = toneWords.slice(0, 5);
    } else if (wellnessSignals) {
      fallback.brandVoiceWords = ['Calm', 'Grounded', 'Empowering', 'Evidence-led'];
    } else {
      fallback.brandVoiceWords = ['Clear', 'Practical', 'Trustworthy', 'Actionable'];
    }
  }

  if (missing.has('topicsToAvoid')) {
    if (/medical|diagnosis|claim|politic|religion|conspiracy|fear/i.test(constraints)) {
      fallback.topicsToAvoid = parseLooseList(constraints, 8);
    } else if (wellnessSignals) {
      fallback.topicsToAvoid = ['Medical cure claims', 'Fear-based messaging', 'Political or religious debates'];
    } else {
      fallback.topicsToAvoid = ['Unverifiable claims', 'Fear-based messaging', 'Off-brand controversy'];
    }
  }

  if (missing.has('brandTone')) {
    if (Array.isArray(fallback.brandVoiceWords) && fallback.brandVoiceWords.length > 0) {
      fallback.brandTone = String(fallback.brandVoiceWords.slice(0, 3).join(', '));
    } else if (brandTone) {
      fallback.brandTone = brandTone;
    }
  }

  if (missing.has('engineGoal')) {
    const operatorGoal = sanitizeSentence(String(fallback.primaryGoal || primaryGoal || ''));
    if (operatorGoal) fallback.engineGoal = operatorGoal;
  }

  if (missing.has('futureGoal') && (fallback.primaryGoal || primaryGoal)) {
    fallback.futureGoal = 'Scale this into a repeatable growth engine after the first 90 days.';
  }

  if (missing.has('secondaryGoals')) {
    fallback.secondaryGoals = uniqueList(
      [
        'Improve conversion rates across website and landing pages',
        'Increase qualified audience trust signals and proof content',
      ],
      5
    );
  }

  if (missing.has('planningHorizon')) {
    fallback.planningHorizon = '90 days';
  }

  if (missing.has('language')) {
    fallback.language = 'English';
  }

  if (missing.has('budgetSensitivity')) {
    fallback.budgetSensitivity = 'medium';
  }

  if (missing.has('autonomyLevel')) {
    fallback.autonomyLevel = 'assist';
  }

  if (missing.has('operateWhere') && /global|worldwide|remote|online/i.test(`${evidenceContext}\n${oneSentenceDescription}`)) {
    fallback.operateWhere = 'Global (online)';
  }

  if (missing.has('wantClientsWhere')) {
    const fromAudience = sanitizeSentence(String(fallback.idealAudience || targetAudience || idealAudienceInput));
    if (/us|united states|canada|uk|australia|english/i.test(fromAudience)) {
      fallback.wantClientsWhere = 'US and English-speaking markets';
    }
  }

  if (missing.has('geoScope') && (fallback.operateWhere || fallback.wantClientsWhere)) {
    fallback.geoScope = sanitizeSentence(
      String(fallback.wantClientsWhere || fallback.operateWhere || partialPayload.geoScope || '')
    );
  }

  if (missing.has('constraints') && constraints) {
    fallback.constraints = constraints;
  }

  if (missing.has('excludedCategories') && Array.isArray(partialPayload.excludedCategories)) {
    const categories = parseLooseList(partialPayload.excludedCategories, 12);
    if (categories.length > 0) fallback.excludedCategories = categories;
  }

  if (missing.has('competitorInspirationLinks')) {
    const existingCompetitors = parseLooseList(partialPayload.competitorInspirationLinks, 5);
    if (existingCompetitors.length > 0) fallback.competitorInspirationLinks = existingCompetitors;
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

function normalizeSuggestedShape(
  suggested: Record<string, unknown>,
  missingKeys: IntakeKey[]
): Record<string, unknown> {
  const allowed = new Set<IntakeKey>(missingKeys);
  const normalized: Record<string, unknown> = {};
  for (const key of missingKeys) {
    const raw = suggested[key];
    if (raw === undefined || raw === null) continue;
    if (!allowed.has(key)) continue;

    if (INTAKE_LIST_KEYS.has(key)) {
      const maxItems = key === 'resultsIn90Days' ? 2 : key === 'topProblems' ? 3 : key === 'questionsBeforeBuying' ? 3 : key === 'competitorInspirationLinks' ? 5 : 20;
      const values = parseLooseList(raw, maxItems);
      if (values.length > 0) {
        normalized[key] = values;
      }
      continue;
    }

    if (key === 'autonomyLevel') {
      const mode = String(raw || '')
        .trim()
        .toLowerCase();
      normalized[key] = mode === 'auto' ? 'auto' : 'assist';
      continue;
    }

    if (key === 'budgetSensitivity') {
      const sensitivity = String(raw || '')
        .trim()
        .toLowerCase();
      if (['low', 'mid', 'high'].includes(sensitivity)) {
        normalized[key] = sensitivity;
      } else if (sensitivity) {
        normalized[key] = 'mid';
      }
      continue;
    }

    const text = Array.isArray(raw)
      ? sanitizeSentence(raw.map((entry) => String(entry || '').trim()).filter(Boolean).join(' / '))
      : sanitizeSentence(String(raw || ''));
    if (text) normalized[key] = text;
  }
  return normalized;
}

export async function suggestIntakeCompletion(
  partialPayload: Record<string, unknown>,
  options?: { step?: IntakeSuggestionStep }
): Promise<SuggestIntakeCompletionResult> {
  const hasOpenAi = Boolean(
    String(process.env.OPENAI_API_KEY || '').trim() || String(process.env.OPENAI_API_KEY_FALLBACK || '').trim()
  );
  const warnings = new Set<string>();
  const suggestionStep = options?.step || parseSuggestionStep(partialPayload.step);

  const filledByUser: string[] = [];
  const contextParts: string[] = [];

  for (const key of INTAKE_KEYS) {
    const raw = partialPayload[key];
    if (isFilled(raw)) {
      filledByUser.push(key);
      const display = Array.isArray(raw) ? (raw as unknown[]).join(', ') : String(raw);
      contextParts.push(`${key}: ${display}`);
    }
  }

  const websiteEvidence = String(partialPayload._websiteEvidence || partialPayload.websiteEvidence || '').trim();
  const ddgEvidence = String(partialPayload._ddgEvidence || partialPayload.ddgEvidence || '').trim();
  if (websiteEvidence) contextParts.push(`websiteEvidence: ${websiteEvidence}`);
  if (ddgEvidence) contextParts.push(`ddgEvidence: ${ddgEvidence}`);

  const contextStr = contextParts.join('\n');
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

  let missingKeys = INTAKE_KEYS.filter((k) => !filledByUser.includes(k));
  missingKeys = filterMissingKeysForStep(missingKeys, suggestionStep);

  const fallbackSuggested = buildFallbackSuggestions(partialPayload, missingKeys, website);
  let suggested: Record<string, unknown> = {
    ...fallbackSuggested,
  };

  if (missingKeys.length > 0 && hasOpenAi && contextParts.length > 0) {
    const stepLabel = suggestionStep ? suggestionStep.toUpperCase() : 'GLOBAL';
    const stepRules = suggestionStep === 'brand'
      ? `Brand step: produce a specific one-sentence description with outcome + audience. Never include raw URLs in prose fields.`
      : suggestionStep === 'channels'
        ? `Channels step: never invent handles. Only suggest channels grounded in evidence or explicit social references.`
        : suggestionStep === 'offer'
          ? `Offer step: produce concrete offer and services phrasing, never generic placeholder copy.`
          : suggestionStep === 'audience'
            ? `Audience step: define a clear target segment, pains, and intent in practical language.`
            : suggestionStep === 'voice'
              ? `Voice step: propose strong, brand-safe voice and guardrails with realistic constraints.`
              : `Global step: keep suggestions practical and conversion-focused.`;
    const systemPrompt = `You are BAT's intake strategist. Generate polished, specific, evidence-grounded suggestions for missing intake fields.
Rules:
- Output strict JSON only. No markdown.
- Return only the missing keys requested.
- Never use boilerplate like "operates through <url>" unless there is no meaningful evidence.
- Prefer concrete offers/services/audience language based on context evidence.
- Lists must be arrays of strings.
- Keep tone professional, confident, and human.
${stepRules}`;

    const userPrompt = `Step: ${stepLabel}
Context:
${contextStr}

Missing keys:
${missingKeys.join(', ')}

Return a single JSON object with only these keys.`;

    try {
      const response = (await openaiClient.bat.chatCompletion('intake_completion', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 1800,
      })) as OpenAI.Chat.Completions.ChatCompletion;

      const raw = response.choices[0]?.message?.content || '{}';
      const aiSuggestedRaw = keepOnlyMissingKeys(JSON.parse(raw) as Record<string, unknown>, missingKeys);
      const aiSuggested = normalizeSuggestedShape(aiSuggestedRaw, missingKeys);
      suggested = {
        ...suggested,
        ...aiSuggested,
      };
    } catch (error: unknown) {
      console.warn('[SuggestIntake] AI completion fallback:', (error as Error)?.message || String(error));
      warnings.add('AI_UNAVAILABLE');
      suggested = keepOnlyMissingKeys(suggested, missingKeys);
    }
  } else if (!hasOpenAi) {
    warnings.add('AI_NOT_CONFIGURED');
  }

  suggested = normalizeSuggestedShape(keepOnlyMissingKeys(suggested, missingKeys), missingKeys);

  const lowSignalKeys = (['oneSentenceDescription', 'mainOffer', 'primaryGoal'] as const).filter((key) =>
    isLowSignalAutofillText(suggested[key])
  );
  if (lowSignalKeys.length > 0) {
    warnings.add('LOW_SIGNAL_COPY');
    for (const key of lowSignalKeys) {
      const fallbackValue = fallbackSuggested[key];
      if (fallbackValue && !isLowSignalAutofillText(fallbackValue)) {
        suggested[key] = fallbackValue;
      } else {
        delete suggested[key];
      }
    }
  }

  const mainOffer = sanitizeSentence(String(suggested.mainOffer || ''));
  if (mainOffer && !isLowSignalAutofillText(mainOffer) && !containsUrl(mainOffer)) {
    suggested.mainOffer = mainOffer;
  } else if (missingKeys.includes('mainOffer')) {
    const fallbackOffer = sanitizeSentence(String(fallbackSuggested.mainOffer || ''));
    if (fallbackOffer && !containsUrl(fallbackOffer) && !isLowSignalAutofillText(fallbackOffer)) {
      suggested.mainOffer = fallbackOffer;
    } else {
      delete suggested.mainOffer;
    }
  }

  const oneSentenceDescription = sanitizeSentence(String(suggested.oneSentenceDescription || ''));
  if (oneSentenceDescription) {
    if (containsUrl(oneSentenceDescription) || isLowSignalAutofillText(oneSentenceDescription)) {
      const fallbackDescription = sanitizeSentence(String(fallbackSuggested.oneSentenceDescription || ''));
      if (fallbackDescription && !containsUrl(fallbackDescription) && !isLowSignalAutofillText(fallbackDescription)) {
        suggested.oneSentenceDescription = fallbackDescription;
      } else {
        delete suggested.oneSentenceDescription;
      }
    } else {
      suggested.oneSentenceDescription = oneSentenceDescription;
    }
  }

  if (missingKeys.includes('servicesList')) {
    const aiServices = sanitizeListSuggestion(suggested.servicesList, 20);
    const fallbackServices = sanitizeListSuggestion(fallbackSuggested.servicesList, 20);
    const combinedServices = uniqueList(
      [...aiServices, ...fallbackServices].filter((entry) => !containsUrl(entry)),
      20
    );
    if (combinedServices.length > 0) {
      suggested.servicesList = combinedServices;
    } else {
      delete suggested.servicesList;
    }
  }

  const suggestedHandles: Record<string, string> = {};
  const suggestedHandleValidation: SuggestIntakeCompletionResult['suggestedHandleValidation'] = {};
  const shouldSuggestHandles = !suggestionStep || suggestionStep === 'channels';
  const handleCandidates: SuggestedHandleCandidate[] = shouldSuggestHandles
    ? parseUserSocialReferenceCandidates(partialPayload)
    : [];
  const hasUserProvidedSocialCandidate = handleCandidates.some(
    (candidate) => candidate.source === 'user_provided_social_url'
  );
  const discoveredCandidateMinConfidence = hasUserProvidedSocialCandidate ? 0.7 : 0.55;
  const allowDiscoveryWithProvidedSocialRefs =
    String(process.env.SUGGEST_SOCIAL_DISCOVERY_WITH_USER_REFS || '')
      .trim()
      .toLowerCase() === 'true';
  const shouldRunDomainDiscovery =
    shouldSuggestHandles &&
    Boolean(website) &&
    (!hasUserProvidedSocialCandidate || allowDiscoveryWithProvidedSocialRefs);

  if (shouldRunDomainDiscovery) {
    try {
      const discovered = await discoverClientSocialFromWebsite(website, name);
      if (Array.isArray(discovered.candidates)) {
        for (const candidate of discovered.candidates) {
          const confidence = Number(candidate.confidence || 0.55);
          if (confidence < discoveredCandidateMinConfidence) continue;
          handleCandidates.push({
            platform: candidate.platform,
            handle: candidate.handle,
            profileUrl: candidate.profileUrl,
            confidence,
            reason: String(candidate.reason || 'Discovered from domain-first social search.'),
            source: String(candidate.source || 'ddg_social_search'),
            isLikelyClient: Boolean(candidate.isLikelyClient),
          });
        }
      } else {
        if (discovered.instagram) {
          if (0.62 >= discoveredCandidateMinConfidence) {
            handleCandidates.push({
              platform: 'instagram',
              handle: discovered.instagram,
              profileUrl: profileUrlFromHandle('instagram', discovered.instagram),
              confidence: 0.62,
              reason: 'Discovered from domain-first social search.',
              source: 'ddg_social_search',
              isLikelyClient: false,
            });
          }
        }
        if (discovered.tiktok) {
          if (0.62 >= discoveredCandidateMinConfidence) {
            handleCandidates.push({
              platform: 'tiktok',
              handle: discovered.tiktok,
              profileUrl: profileUrlFromHandle('tiktok', discovered.tiktok),
              confidence: 0.62,
              reason: 'Discovered from domain-first social search.',
              source: 'ddg_social_search',
              isLikelyClient: false,
            });
          }
        }
      }
    } catch (error) {
      console.warn(
        '[SuggestIntake] discoverClientSocialFromWebsite failed:',
        (error as Error)?.message || String(error)
      );
    }
  }

  const instagramHandle = normalizeHandle(handles.instagram);
  const tiktokHandle = normalizeHandle(handles.tiktok);
  if (
    shouldSuggestHandles &&
    ENABLE_CROSS_PLATFORM_GUESS &&
    instagramHandle &&
    !tiktokHandle &&
    !hasUserProvidedSocialCandidate
  ) {
    handleCandidates.push({
      platform: 'tiktok',
      handle: instagramHandle,
      profileUrl: profileUrlFromHandle('tiktok', instagramHandle),
      confidence: TIKTOK_SUGGESTION_CONFIDENCE,
      reason: 'Instagram and TikTok handles often match for the same brand.',
      source: 'cross_platform_guess',
      isLikelyClient: false,
    });
  }

  const uniqueCandidates = mergeHandleCandidates(handleCandidates);
  const candidatesToValidate = new Set(
    uniqueCandidates
      .filter(
        (candidate) =>
          candidate.source !== 'user_provided_social_url' &&
          Number(candidate.confidence || 0) >= SOCIAL_VALIDATION_MIN_CONFIDENCE
      )
      .slice(0, Math.max(1, SOCIAL_VALIDATION_CANDIDATE_LIMIT))
      .map((candidate) => candidateKey(candidate))
  );
  for (const candidate of uniqueCandidates) {
    const existingHandle = normalizeHandle(handles[candidate.platform]);
    if (existingHandle) continue;
    const shouldValidate = candidate.source !== 'user_provided_social_url' && candidatesToValidate.has(candidateKey(candidate));
    if (shouldValidate) {
      try {
        const validation = await validateSuggestedProfileIsClient({
          handle: candidate.handle,
          platform: candidate.platform === 'twitter' ? 'x' : candidate.platform,
          clientWebsite: website,
          clientName: name,
        });
        candidate.isLikelyClient = validation.isLikelyClient;
        candidate.confidence = Math.max(candidate.confidence, Number(validation.confidence || 0));
        candidate.reason = validation.reason || candidate.reason;
      } catch (error) {
        console.warn('[SuggestIntake] candidate validation failed:', (error as Error)?.message || String(error));
      }
    }

    const validationItem: SuggestedHandleValidationItem = {
      handle: candidate.handle,
      isLikelyClient: candidate.isLikelyClient,
      confidence: candidate.confidence,
      reason: candidate.reason,
    };
    if (candidate.platform === 'instagram' && !suggestedHandleValidation.instagram) {
      suggestedHandleValidation.instagram = validationItem;
    }
    if (candidate.platform === 'tiktok' && !suggestedHandleValidation.tiktok) {
      suggestedHandleValidation.tiktok = validationItem;
    }
    if (candidate.platform === 'linkedin' && !suggestedHandleValidation.linkedin) {
      suggestedHandleValidation.linkedin = validationItem;
    }
    if (candidate.platform === 'youtube' && !suggestedHandleValidation.youtube) {
      suggestedHandleValidation.youtube = validationItem;
    }
    if (candidate.platform === 'twitter' && !suggestedHandleValidation.twitter) {
      suggestedHandleValidation.twitter = validationItem;
    }

    const isUserProvided = candidate.source === 'user_provided_social_url';
    const discoveredAutoApplyAllowed =
      AUTO_APPLY_DISCOVERED_HANDLES &&
      candidate.isLikelyClient &&
      Number(candidate.confidence || 0) >= Math.max(AUTO_APPLY_HANDLE_THRESHOLD, DISCOVERED_HANDLE_AUTO_APPLY_MIN_CONFIDENCE);
    if (isUserProvided || discoveredAutoApplyAllowed) {
      suggestedHandles[candidate.platform] = candidate.handle;
    }
  }

  const hasUserPrimaryHandle = hasPrimaryHandle(handles);
  const hasHighConfidenceSuggestedPrimary = uniqueCandidates.some(
    (candidate) =>
      PRIMARY_CHANNELS.includes(candidate.platform as (typeof PRIMARY_CHANNELS)[number]) &&
      candidate.isLikelyClient &&
      Number(candidate.confidence || 0) >= HIGH_CONFIDENCE_THRESHOLD
  );
  const hasLowConfidenceSuggestion = uniqueCandidates.some(
    (candidate) => Number(candidate.confidence || 0) < HIGH_CONFIDENCE_THRESHOLD
  );
  if (shouldSuggestHandles && uniqueCandidates.length > 0 && !hasHighConfidenceSuggestedPrimary) {
    warnings.add('NO_HIGH_CONFIDENCE_CHANNELS');
  }

  const confirmationReasons: string[] = [];
  if (shouldSuggestHandles && !hasUserPrimaryHandle && !hasHighConfidenceSuggestedPrimary && !hasWebsite) {
    confirmationReasons.push('MISSING_PRIMARY_CHANNEL');
  }
  if (shouldSuggestHandles && hasLowConfidenceSuggestion) {
    confirmationReasons.push('LOW_CONFIDENCE_SUGGESTION');
  }
  for (const warningCode of warnings) {
    if (warningCode === 'AI_UNAVAILABLE' || warningCode === 'AI_NOT_CONFIGURED') {
      confirmationReasons.push(warningCode);
    }
  }

  return {
    suggested,
    filledByUser,
    ...(Object.keys(suggestedHandles).length > 0 ? { suggestedHandles } : {}),
    ...(Object.keys(suggestedHandleValidation).length > 0 ? { suggestedHandleValidation } : {}),
    ...(uniqueCandidates.length > 0 ? { suggestedHandleCandidates: uniqueCandidates } : {}),
    ...(warnings.size > 0 ? { warnings: Array.from(warnings) } : {}),
    confirmationRequired: confirmationReasons.length > 0,
    confirmationReasons: Array.from(new Set(confirmationReasons)),
  };
}
