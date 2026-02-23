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
};

export type GeneratedDocument = {
  docId: string;
  title: string;
  mimeType: 'application/pdf';
  storagePath: string;
  sizeBytes: number;
  createdAt: string;
  clientDocumentId: string;
};
