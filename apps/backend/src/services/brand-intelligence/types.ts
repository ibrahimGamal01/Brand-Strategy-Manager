import { Prisma } from '@prisma/client';

export type BrandIntelligenceModuleKey = 'brand_mentions' | 'community_insights';
export type BrandIntelligenceMode = 'append' | 'replace';
export type BrandMentionsDepth = 'standard' | 'deep';
export type CommunitySource = 'reddit' | 'quora' | 'trustpilot' | 'forum';

export type BrandIntelligenceRunReason =
  | 'manual'
  | 'resume'
  | 'continuity'
  | 'module_action'
  | 'brain_command';

export interface BrandIntelligenceModuleInputs {
  brand_mentions?: {
    depth?: BrandMentionsDepth;
  };
  community_insights?: {
    platforms?: CommunitySource[];
  };
}

export interface BrandIntelligenceOrchestrationInput {
  mode?: BrandIntelligenceMode;
  modules?: BrandIntelligenceModuleKey[];
  moduleInputs?: BrandIntelligenceModuleInputs;
  runReason?: BrandIntelligenceRunReason;
}

export interface BrandIntelligenceContext {
  researchJobId: string;
  clientId: string;
  brandName: string;
  niche: string;
  websiteDomain: string | null;
  businessOverview: string;
  audienceSummary: string;
  handlesByPlatform: Record<string, string>;
  excludedCategories: string[];
  inputData: Record<string, unknown>;
  goalSignals: {
    sales: number;
    engagement: number;
    authority: number;
  };
}

export interface BrandIntelligenceModuleResult {
  module: BrandIntelligenceModuleKey;
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
  perModule: Record<BrandIntelligenceModuleKey, Omit<BrandIntelligenceModuleResult, 'module'>>;
}

export interface BrandIntelligenceOrchestrationResponse {
  runId: string;
  status: 'RUNNING' | 'COMPLETE' | 'FAILED';
  summary: BrandIntelligenceSummary;
  diagnostics: Record<string, unknown>;
}

export interface BrandIntelligenceSummaryResponse {
  runId: string | null;
  status: string | null;
  mode: string | null;
  modules: BrandIntelligenceModuleKey[];
  moduleOrder: BrandIntelligenceModuleKey[];
  runReason: string | null;
  summary: BrandIntelligenceSummary | null;
  diagnostics: Prisma.JsonValue | null;
}

export type BrandIntelligenceServiceError = Error & {
  code?:
    | 'BRAND_INTEL_ALREADY_RUNNING'
    | 'BRAND_INTEL_INVALID_INPUT'
    | 'BRAND_INTEL_NOT_FOUND'
    | 'BRAND_INTEL_SCHEMA_NOT_READY';
  statusCode?: number;
};

export function createBrandIntelligenceError(
  code: NonNullable<BrandIntelligenceServiceError['code']>,
  message: string,
  statusCode: number
): BrandIntelligenceServiceError {
  const error = new Error(message) as BrandIntelligenceServiceError;
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
