export type DocType = 'STRATEGY_BRIEF' | 'COMPETITOR_AUDIT' | 'CONTENT_CALENDAR';

export type DocumentPlan = {
  docType: DocType;
  title?: string;
  audience?: string;
  timeframeDays?: number;
  depth?: 'short' | 'standard' | 'deep';
  includeCompetitors?: boolean;
  includeEvidenceLinks?: boolean;
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
};

export type NewsRow = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string;
};

export type CommunityInsightRow = {
  source: string;
  url: string;
  summary: string;
  createdAt: string;
};

export type DocumentCoverage = {
  score: number;
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
  freshnessHours: number | null;
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
  mimeType: 'application/pdf';
  storagePath: string;
  sizeBytes: number;
  createdAt: string;
  clientDocumentId: string;
  documentId?: string;
  versionId?: string;
  coverageScore?: number;
  coverageBand?: 'thin' | 'moderate' | 'strong';
  enrichmentPerformed?: boolean;
  partial?: boolean;
  resumeDocumentId?: string;
};
