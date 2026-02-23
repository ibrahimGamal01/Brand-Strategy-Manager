export type ResearchModuleKey =
  | 'client_profiles'
  | 'search_results'
  | 'brand_mentions'
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

export interface MediaAnalysisScopeSummary {
  runId: string;
  status: 'RUNNING' | 'COMPLETE' | 'SKIPPED' | 'FAILED';
  downloadedTotal: number;
  qualifiedForAi: number;
  analysisWindow: number;
  analyzedInWindow: number;
  attemptedAssets: number;
  succeeded: number;
  failed: number;
  skippedReason: string | null;
  startedAt: string;
  completedAt: string | null;
}

export type BrandIntelligenceModuleKey = 'brand_mentions' | 'community_insights';

export interface BrandIntelligenceModuleResult {
  success: boolean;
  collected: number;
  filtered: number;
  persisted: number;
  updated: number;
  skipped: number;
  failed: number;
  warnings: string[];
  diagnostics?: Record<string, unknown>;
}

export interface BrandIntelligenceSummary {
  modules: BrandIntelligenceModuleKey[];
  moduleOrder: BrandIntelligenceModuleKey[];
  totals: {
    collected: number;
    filtered: number;
    persisted: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  perModule: Record<BrandIntelligenceModuleKey, BrandIntelligenceModuleResult>;
}

export interface BrandIntelligenceOrchestrationResponse {
  success: boolean;
  runId: string;
  status: 'RUNNING' | 'COMPLETE' | 'FAILED';
  summary: BrandIntelligenceSummary;
  diagnostics: Record<string, unknown>;
  error?: string;
  code?: string;
}

export interface BrandIntelligenceSummaryResponse {
  success: boolean;
  runId: string | null;
  status: string | null;
  mode: string | null;
  modules: BrandIntelligenceModuleKey[];
  moduleOrder: BrandIntelligenceModuleKey[];
  runReason: string | null;
  summary: BrandIntelligenceSummary | null;
  diagnostics: Record<string, unknown> | null;
  error?: string;
  code?: string;
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

export type CompetitorType =
  | 'DIRECT'
  | 'INDIRECT'
  | 'ADJACENT'
  | 'MARKETPLACE'
  | 'MEDIA'
  | 'INFLUENCER'
  | 'COMMUNITY'
  | 'UNKNOWN';

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
  competitorType?: CompetitorType | null;
  typeConfidence?: number | null;
  entityFlags?: string[];
  relevanceScore?: number | null;
  discoveredCompetitorId?: string | null;
  discoveredStatus?: 'SUGGESTED' | 'SCRAPING' | 'SCRAPED' | 'FAILED' | 'CONFIRMED' | 'REJECTED' | null;
  sourceType?: 'client_inspiration' | 'orchestrated' | 'manual' | string;
  scrapeEligible?: boolean;
  blockerReasonCode?: string | null;
  readinessStatus?: 'READY' | 'DEGRADED' | 'BLOCKED' | null;
  lastStateTransitionAt?: string;
  pipelineStage?:
    | 'CLIENT_INPUTS'
    | 'DISCOVERED_CANDIDATES'
    | 'SCRAPE_QUEUE'
    | 'SCRAPED_READY'
    | 'BLOCKED';
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
  controlMode?: 'auto' | 'manual';
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
  stageBuckets?: {
    clientInputs: OrchestratedCompetitorIdentityGroup[];
    discoveredCandidates: OrchestratedCompetitorIdentityGroup[];
    scrapeQueue: OrchestratedCompetitorIdentityGroup[];
    scrapedReady: OrchestratedCompetitorIdentityGroup[];
    blocked: OrchestratedCompetitorIdentityGroup[];
  };
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
