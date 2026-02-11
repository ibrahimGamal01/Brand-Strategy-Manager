import { CompetitorSurface } from './competitor-platform-detector';
import {
  CompetitorDiscoveryMethodAnswerJson,
  CompetitorDiscoveryPolicy,
  CompetitorPolicyEngineInput,
  DiscoveryFocus,
  DiscoveryMethod,
  PolicySource,
  WebsitePolicy,
} from './competitor-policy-types';

const DEFAULT_PRIORITY_BY_FOCUS: Record<DiscoveryFocus, CompetitorSurface[]> = {
  social_first: ['instagram', 'tiktok', 'youtube', 'x', 'linkedin', 'facebook', 'website'],
  hybrid: ['instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'facebook', 'website'],
  web_first: ['website', 'linkedin', 'youtube', 'instagram', 'tiktok', 'x', 'facebook'],
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export function uniqueSurfaces(values: Iterable<CompetitorSurface>): CompetitorSurface[] {
  return Array.from(new Set(values));
}

function normalizeSurface(value: unknown): CompetitorSurface | null {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'instagram') return 'instagram';
  if (raw === 'tiktok') return 'tiktok';
  if (raw === 'youtube') return 'youtube';
  if (raw === 'linkedin') return 'linkedin';
  if (raw === 'x' || raw === 'twitter') return 'x';
  if (raw === 'facebook') return 'facebook';
  if (raw === 'website' || raw === 'web' || raw === 'site') return 'website';
  return null;
}

function normalizeSurfaceList(value: unknown): CompetitorSurface[] {
  if (!Array.isArray(value)) return [];
  return uniqueSurfaces(
    value
      .map((entry) => normalizeSurface(entry))
      .filter((entry): entry is CompetitorSurface => Boolean(entry))
  );
}

function normalizeDiscoveryFocus(value: unknown): DiscoveryFocus | null {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'social_first') return 'social_first';
  if (raw === 'hybrid') return 'hybrid';
  if (raw === 'web_first') return 'web_first';
  return null;
}

function normalizeMethod(value: unknown): DiscoveryMethod | null {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'handle_led') return 'handle_led';
  if (raw === 'niche_led') return 'niche_led';
  if (raw === 'account_led') return 'account_led';
  if (raw === 'mixed') return 'mixed';
  return null;
}

function normalizeWebsitePolicy(value: unknown): WebsitePolicy | null {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'evidence_only') return 'evidence_only';
  if (raw === 'fallback_only') return 'fallback_only';
  if (raw === 'peer_candidate') return 'peer_candidate';
  return null;
}

export function parseQ13Answer(value: unknown): CompetitorDiscoveryMethodAnswerJson | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const discoveryFocus = normalizeDiscoveryFocus(raw.discoveryFocus);
  const method = normalizeMethod(raw.method);
  const websitePolicy = normalizeWebsitePolicy(raw.websitePolicy);
  const surfacePriority = normalizeSurfaceList(raw.surfacePriority);

  if (!discoveryFocus || !method || !websitePolicy || surfacePriority.length === 0) return null;

  return {
    discoveryFocus,
    method,
    surfacePriority,
    websitePolicy,
    minimumSocialForShortlist: clampPositiveInt(Number(raw.minimumSocialForShortlist), 1),
    confidence: clamp01(Number(raw.confidence)),
    rationale: String(raw.rationale || '').trim().slice(0, 500),
  };
}

function countSocialHandles(input: CompetitorPolicyEngineInput): number {
  const fromAccounts = input.clientAccounts
    .map((account) => String(account.handle || '').trim())
    .filter(Boolean).length;

  const handlesRaw = input.inputData?.handles;
  const fromInputHandles =
    handlesRaw && typeof handlesRaw === 'object' && !Array.isArray(handlesRaw)
      ? Object.values(handlesRaw as Record<string, unknown>)
          .map((value) => String(value || '').trim())
          .filter(Boolean).length
      : 0;

  return fromAccounts + fromInputHandles;
}

export function hasWebsiteSignal(input: CompetitorPolicyEngineInput): boolean {
  const fromInput = String(input.inputData?.website || input.inputData?.websiteUrl || input.inputData?.domain || '').trim();
  return Boolean(String(input.websiteDomain || '').trim() || fromInput);
}

function inferDiscoveryFocus(input: CompetitorPolicyEngineInput): DiscoveryFocus {
  const socialHandles = countSocialHandles(input);
  const hasWebsite = hasWebsiteSignal(input);
  const goalsText = [
    String(input.inputData?.primaryGoal || ''),
    String(input.inputData?.secondaryGoals || ''),
    String(input.inputData?.goals || ''),
  ]
    .join(' ')
    .toLowerCase();

  if (/\b(seo|search traffic|website traffic|lead gen|landing page)\b/.test(goalsText) && hasWebsite) {
    return 'web_first';
  }
  if (!hasWebsite && socialHandles > 0) return 'social_first';
  if (hasWebsite && socialHandles === 0) return 'web_first';
  if (socialHandles >= 2 && hasWebsite) return 'hybrid';
  return socialHandles > 0 ? 'social_first' : 'hybrid';
}

function inferMethod(input: CompetitorPolicyEngineInput, focus: DiscoveryFocus): DiscoveryMethod {
  const socialHandles = countSocialHandles(input);
  const niche = String(input.inputData?.niche || input.inputData?.category || '').trim();
  if (socialHandles >= 2) return 'account_led';
  if (socialHandles === 1) return focus === 'web_first' ? 'mixed' : 'handle_led';
  if (niche.length >= 4) return 'niche_led';
  return 'mixed';
}

function inferWebsitePolicy(focus: DiscoveryFocus, contextQualityScore: number): WebsitePolicy {
  if (focus === 'web_first') return 'peer_candidate';
  if (focus === 'hybrid') return contextQualityScore < 0.35 ? 'evidence_only' : 'fallback_only';
  return 'evidence_only';
}

function inferMinimumSocialForShortlist(
  focus: DiscoveryFocus,
  websitePolicy: WebsitePolicy,
  socialHandles: number
): number {
  if (focus === 'web_first') return websitePolicy === 'peer_candidate' ? 0 : 1;
  if (focus === 'hybrid') return socialHandles >= 2 ? 2 : 1;
  return Math.max(1, Math.min(3, socialHandles || 1));
}

export function inferPolicy(input: CompetitorPolicyEngineInput): CompetitorDiscoveryPolicy {
  const contextQualityScore = clamp01(Number(input.contextQualityScore || 0));
  const discoveryFocus = inferDiscoveryFocus(input);
  const method = inferMethod(input, discoveryFocus);
  const websitePolicy = inferWebsitePolicy(discoveryFocus, contextQualityScore);
  const minimumSocialForShortlist = inferMinimumSocialForShortlist(
    discoveryFocus,
    websitePolicy,
    countSocialHandles(input)
  );
  const surfacePriority = DEFAULT_PRIORITY_BY_FOCUS[discoveryFocus];

  return {
    selectedSurfaces: surfacePriority,
    surfacePriority,
    websitePolicy,
    shortlistConstraints: {
      minimumSocialForShortlist,
      websiteFallbackOnlyWhenSocialBelowMinimum: websitePolicy === 'fallback_only',
    },
    policySource: 'inferred',
    discoveryFocus,
    method,
    confidence: contextQualityScore > 0 ? Math.max(0.45, contextQualityScore) : 0.45,
    rationale: 'Inferred from client handles, website presence, goals, and context quality signals.',
  };
}

export function sortByPriority(
  surfaces: CompetitorSurface[],
  priority: CompetitorSurface[]
): CompetitorSurface[] {
  const rank = new Map(priority.map((surface, index) => [surface, index] as const));
  return [...surfaces].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
}

export function buildSelectedSurfaces(
  input: CompetitorPolicyEngineInput,
  basePolicy: CompetitorDiscoveryPolicy,
  source: PolicySource
): CompetitorSurface[] {
  if (source === 'requested_override' && input.requestedSurfaces?.length) {
    return uniqueSurfaces(input.requestedSurfaces);
  }

  const detected = uniqueSurfaces(input.detectedSurfaces || []);
  const accountSurfaces = uniqueSurfaces(
    input.clientAccounts
      .map((account) => normalizeSurface(account.platform))
      .filter((surface): surface is CompetitorSurface => Boolean(surface) && surface !== 'website')
  );
  const includeWebsite =
    hasWebsiteSignal(input) ||
    detected.includes('website') ||
    basePolicy.discoveryFocus === 'web_first' ||
    basePolicy.websitePolicy !== 'evidence_only';

  const priorityWithoutWebsite = basePolicy.surfacePriority.filter((surface) => surface !== 'website');
  const pool = uniqueSurfaces([
    ...accountSurfaces,
    ...sortByPriority(detected.filter((surface) => surface !== 'website'), basePolicy.surfacePriority),
    ...priorityWithoutWebsite,
  ]);
  const maxSurfacesWithoutWebsite =
    basePolicy.discoveryFocus === 'web_first' ? 3 : basePolicy.discoveryFocus === 'hybrid' ? 3 : 2;
  const selectedWithoutWebsite = pool.slice(0, maxSurfacesWithoutWebsite);

  const selected = selectedWithoutWebsite;

  return includeWebsite ? uniqueSurfaces([...selected, 'website']) : selected;
}
