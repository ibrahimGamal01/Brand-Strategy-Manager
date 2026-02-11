export type ResearchModuleKey =
  | 'client_profiles'
  | 'search_results'
  | 'images'
  | 'videos'
  | 'news'
  | 'search_trends'
  | 'competitors'
  | 'community_insights'
  | 'ai_questions';

export type ResearchModuleAction = 'delete' | 'continue' | 'run_from_start';

export type ResearchJobEventLevel = 'info' | 'warn' | 'error';

export interface ResearchJobEvent {
  id: number;
  researchJobId: string;
  runId: string | null;
  source: string;
  code: string;
  level: ResearchJobEventLevel;
  message: string;
  platform: string | null;
  handle: string | null;
  entityType: string | null;
  entityId: string | null;
  metrics: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ResearchJobEventsResponse {
  events: ResearchJobEvent[];
  nextAfterId: number | null;
}

export type CompetitorSelectionState =
  | 'FILTERED_OUT'
  | 'SHORTLISTED'
  | 'TOP_PICK'
  | 'APPROVED'
  | 'REJECTED';

export type CompetitorAvailabilityStatus =
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'PROFILE_UNAVAILABLE'
  | 'INVALID_HANDLE'
  | 'RATE_LIMITED'
  | 'CONNECTOR_ERROR';

export interface OrchestratedCompetitorProfile {
  id: string;
  platform: 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'facebook' | 'website' | string;
  handle: string;
  normalizedHandle: string;
  profileUrl?: string | null;
  availabilityStatus: CompetitorAvailabilityStatus;
  availabilityReason?: string | null;
  resolverConfidence?: number | null;
  state: CompetitorSelectionState;
  stateReason?: string | null;
  relevanceScore?: number | null;
  discoveredCompetitorId?: string | null;
  discoveredStatus?: 'SUGGESTED' | 'SCRAPING' | 'SCRAPED' | 'FAILED' | 'CONFIRMED' | 'REJECTED' | null;
  evidence?: Record<string, unknown> | null;
  scoreBreakdown?: Record<string, unknown> | null;
}

export interface OrchestratedCompetitorIdentityGroup {
  identityId: string | null;
  canonicalName: string;
  websiteDomain: string | null;
  businessType: string | null;
  audienceSummary: string | null;
  profiles: OrchestratedCompetitorProfile[];
  bestScore: number;
}

export interface CompetitorShortlistResponse {
  success: boolean;
  runId: string | null;
  summary: {
    candidatesDiscovered: number;
    candidatesFiltered: number;
    shortlisted: number;
    topPicks: number;
    profileUnavailableCount?: number;
  };
  platformMatrix: {
    requested: string[];
    detected: string[];
    fromAccounts: string[];
    fromInput: string[];
    fromContext: string[];
    selected: string[];
    websiteDomain: string | null;
  } | null;
  diagnostics: Record<string, unknown> | null;
  topPicks: OrchestratedCompetitorIdentityGroup[];
  shortlist: OrchestratedCompetitorIdentityGroup[];
  filteredOut: OrchestratedCompetitorIdentityGroup[];
}

export interface CompetitorOrchestrationResponse {
  success: boolean;
  runId: string | null;
  started?: boolean;
  alreadyRunning?: boolean;
  message?: string;
  summary: {
    candidatesDiscovered: number;
    candidatesFiltered: number;
    shortlisted: number;
    topPicks: number;
    profileUnavailableCount?: number;
  };
  platformMatrix?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  error?: string;
}
