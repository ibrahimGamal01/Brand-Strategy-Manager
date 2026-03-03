export const CANONICAL_DOC_FAMILIES = [
  'SWOT',
  'BUSINESS_STRATEGY',
  'PLAYBOOK',
  'COMPETITOR_AUDIT',
  'CONTENT_CALENDAR',
  'GO_TO_MARKET',
] as const;
export const LEGACY_DOC_TYPE_ALIASES = [
  'STRATEGY_BRIEF',
  'SWOT_ANALYSIS',
  'CONTENT_CALENDAR_LEGACY',
  'GTM_PLAN',
] as const;

export type DocFamily = (typeof CANONICAL_DOC_FAMILIES)[number];
export type LegacyDocTypeAlias = (typeof LEGACY_DOC_TYPE_ALIASES)[number];
export type DocType = DocFamily | LegacyDocTypeAlias;

export type BusinessArchetype =
  | 'b2b_saas'
  | 'ecommerce'
  | 'wellness'
  | 'financial_services'
  | 'professional_services'
  | 'generic';

export type RuntimeIntent =
  | 'chat_answer'
  | 'analysis_request'
  | 'document_request'
  | 'document_edit_request'
  | 'mutation_request';

export type RouterOutput = {
  intent: RuntimeIntent;
  docFamily: DocFamily | null;
  businessArchetype: BusinessArchetype;
  requiredEvidenceLanes: string[];
  requiredClarifications: string[];
};

export function canonicalDocFamily(docType: DocType | string | null | undefined): DocFamily {
  const normalized = String(docType || '').trim().toUpperCase();
  if (normalized === 'SWOT' || normalized === 'SWOT_ANALYSIS') return 'SWOT';
  if (normalized === 'BUSINESS_STRATEGY' || normalized === 'STRATEGY_BRIEF') {
    return 'BUSINESS_STRATEGY';
  }
  if (normalized === 'PLAYBOOK') return 'PLAYBOOK';
  if (normalized === 'CONTENT_CALENDAR' || normalized === 'CONTENT_CALENDAR_LEGACY') return 'CONTENT_CALENDAR';
  if (normalized === 'COMPETITOR_AUDIT') return 'COMPETITOR_AUDIT';
  if (normalized === 'GO_TO_MARKET' || normalized === 'GTM_PLAN') return 'GO_TO_MARKET';
  return 'BUSINESS_STRATEGY';
}

export function normalizeDocType(docType: DocType | string | null | undefined): DocType {
  const normalized = String(docType || '').trim().toUpperCase();
  if ((CANONICAL_DOC_FAMILIES as readonly string[]).includes(normalized)) {
    return normalized as DocType;
  }
  if ((LEGACY_DOC_TYPE_ALIASES as readonly string[]).includes(normalized)) {
    return normalized as DocType;
  }
  return 'BUSINESS_STRATEGY';
}

export function toLegacyDocTypeAlias(docType: DocType | string | null | undefined): LegacyDocTypeAlias {
  const family = canonicalDocFamily(docType);
  if (family === 'SWOT') return 'SWOT_ANALYSIS';
  if (family === 'CONTENT_CALENDAR') return 'CONTENT_CALENDAR_LEGACY';
  if (family === 'GO_TO_MARKET') return 'GTM_PLAN';
  return 'STRATEGY_BRIEF';
}

export type DocumentPlan = {
  docType: DocType;
  title?: string;
  audience?: string;
  timeframeDays?: number;
  depth?: 'short' | 'standard' | 'deep';
  includeCompetitors?: boolean;
  includeEvidenceLinks?: boolean;
  requestedIntent?: string;
};

export type CompetitorRow = {
  handle: string;
  platform: string;
  selectionState: string;
  relevanceScore: number | null;
  availabilityStatus: string;
  profileUrl: string | null;
  reason: string | null;
};

export type TopPostRow = {
  handle: string;
  platform: string;
  caption: string;
  postUrl: string | null;
  postedAt: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number;
};

export type WebSnapshotRow = {
  finalUrl: string;
  statusCode: number | null;
  fetchedAt: string;
  snippet: string;
  relevanceScore?: number;
};

export type NewsRow = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string;
  relevanceScore?: number;
};

export type CommunityInsightRow = {
  source: string;
  url: string;
  summary: string;
  createdAt: string;
  relevanceScore?: number;
};

export type DocumentCoverage = {
  // Legacy alias for consumers that still read "score".
  score: number;
  quantityScore: number;
  relevanceScore: number;
  freshnessScore: number;
  overallScore: number;
  band: 'thin' | 'moderate' | 'strong';
  counts: {
    competitors: number;
    posts: number;
    webSnapshots: number;
    news: number;
    community: number;
  };
  targets: {
    competitors: number;
    posts: number;
    webSnapshots: number;
    news: number;
    community: number;
  };
  relevance: {
    webSnapshots: number;
    news: number;
    community: number;
    overall: number;
    dropped: {
      webSnapshots: number;
      news: number;
      community: number;
    };
  };
  freshnessHours: number | null;
  blockingReasons: string[];
  partialReasons: string[];
  // Legacy combined reasons for compatibility.
  reasons: string[];
  enriched: boolean;
  partial: boolean;
};

export type DocumentPlanRecommendations = {
  quickWins: string[];
  days30: string[];
  days60: string[];
  days90: string[];
  risks: string[];
};

export type DocumentDataPayload = {
  generatedAt: string;
  requestedIntent: string;
  renderedIntent: string;
  clientName: string;
  businessType: string;
  primaryGoal: string;
  targetMarket: string;
  websiteDomain: string;
  audience: string;
  timeframeDays: number;
  competitors: CompetitorRow[];
  topPosts: TopPostRow[];
  webSnapshots: WebSnapshotRow[];
  news: NewsRow[];
  communityInsights: CommunityInsightRow[];
  coverage: DocumentCoverage;
  recommendations: DocumentPlanRecommendations;
};

export type GeneratedDocument = {
  docId: string;
  title: string;
  docType?: DocType;
  requestedIntent?: string;
  renderedIntent?: string;
  mimeType: 'application/pdf';
  storagePath: string;
  sizeBytes: number;
  createdAt: string;
  clientDocumentId: string;
  documentId?: string;
  versionId?: string;
  coverageScore?: number;
  coverageBand?: 'thin' | 'moderate' | 'strong';
  overallScore?: number;
  enrichmentPerformed?: boolean;
  partial?: boolean;
  partialReasons?: string[];
  resumeDocumentId?: string;
};
