import { CompetitorAvailabilityStatus, CompetitorCandidateState, CompetitorSelectionState } from '@prisma/client';

const SCRAPE_PLATFORMS = new Set(['instagram', 'tiktok']);
const SUPPORTED_SOCIAL_INPUTS = new Set([
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'x',
  'facebook',
]);

function normalizePlatform(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function isScrapePlatform(platform: unknown): platform is 'instagram' | 'tiktok' {
  return SCRAPE_PLATFORMS.has(normalizePlatform(platform));
}

export function normalizeInputType(platformOrInputType: unknown): string | null {
  const normalized = normalizePlatform(platformOrInputType);
  if (!normalized) return null;
  if (normalized === 'website') return 'website';
  if (SUPPORTED_SOCIAL_INPUTS.has(normalized)) return normalized;
  return null;
}

export function deriveCandidateEligibility(input: {
  platformOrInputType: unknown;
  availabilityStatus?: CompetitorAvailabilityStatus | null;
}): {
  inputType: string | null;
  scrapeEligible: boolean;
  blockerReasonCode: string | null;
} {
  const inputType = normalizeInputType(input.platformOrInputType);
  const availabilityStatus = input.availabilityStatus || null;

  if (inputType === 'website') {
    return {
      inputType,
      scrapeEligible: false,
      blockerReasonCode: 'WEBSITE_ONLY_REQUIRES_SURFACE_RESOLUTION',
    };
  }

  if (!isScrapePlatform(inputType)) {
    return {
      inputType,
      scrapeEligible: false,
      blockerReasonCode: 'UNSUPPORTED_SCRAPE_PLATFORM',
    };
  }

  if (availabilityStatus === 'PROFILE_UNAVAILABLE') {
    return {
      inputType,
      scrapeEligible: false,
      blockerReasonCode: 'PROFILE_UNAVAILABLE',
    };
  }

  if (availabilityStatus === 'INVALID_HANDLE') {
    return {
      inputType,
      scrapeEligible: false,
      blockerReasonCode: 'INVALID_HANDLE',
    };
  }

  return {
    inputType,
    scrapeEligible: true,
    blockerReasonCode: null,
  };
}

export function deriveClientInspirationStates(platformOrInputType: unknown): {
  candidateState: CompetitorCandidateState;
  selectionState: CompetitorSelectionState;
} {
  const normalized = normalizeInputType(platformOrInputType);
  if (normalized === 'website') {
    return {
      candidateState: 'SHORTLISTED',
      selectionState: 'SHORTLISTED',
    };
  }
  return {
    candidateState: 'TOP_PICK',
    selectionState: 'TOP_PICK',
  };
}
