import { CompetitorSurface } from './competitor-platform-detector';

export type DiscoveryFocus = 'social_first' | 'hybrid' | 'web_first';
export type DiscoveryMethod = 'handle_led' | 'niche_led' | 'account_led' | 'mixed';
export type WebsitePolicy = 'evidence_only' | 'fallback_only' | 'peer_candidate';
export type PolicySource = 'ai_q13' | 'inferred' | 'requested_override';

export interface CompetitorDiscoveryMethodAnswerJson {
  discoveryFocus: DiscoveryFocus;
  method: DiscoveryMethod;
  surfacePriority: CompetitorSurface[];
  websitePolicy: WebsitePolicy;
  minimumSocialForShortlist: number;
  confidence: number;
  rationale: string;
}

export interface CompetitorDiscoveryPolicy {
  selectedSurfaces: CompetitorSurface[];
  surfacePriority: CompetitorSurface[];
  websitePolicy: WebsitePolicy;
  shortlistConstraints: {
    minimumSocialForShortlist: number;
    websiteFallbackOnlyWhenSocialBelowMinimum: boolean;
  };
  policySource: PolicySource;
  discoveryFocus: DiscoveryFocus;
  method: DiscoveryMethod;
  confidence: number;
  rationale: string;
}

export interface CompetitorPolicyEngineInput {
  requestedSurfaces?: CompetitorSurface[];
  detectedSurfaces?: CompetitorSurface[];
  clientAccounts: Array<{ platform: string; handle?: string | null }>;
  websiteDomain?: string | null;
  inputData?: Record<string, unknown>;
  q13AnswerJson?: unknown;
  contextQualityScore?: number;
}
