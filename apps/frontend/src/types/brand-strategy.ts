// Root Entity
export interface Client {
  id: string;
  name: string;
  businessOverview: string;
  productsServices: string[];
  website: string;
}

// Workflow Unit
export type JobStatus = 'PENDING' | 'SCRAPING' | 'ANALYZING' | 'COMPLETE';

export interface ResearchJob {
  id: string;
  clientId: string;
  status: JobStatus;
  competitorsToFind: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  progress: {
    stage: number;
    label: string;
    percentage: number;
  };
}

// Stage 1: Raw Intelligence
export interface RawSearchResult {
  id: string;
  query: string;
  title: string;
  href: string;
  body: string;
  source: 'duckduckgo' | 'google';
  createdAt: string;
}

export interface DdgImageResult {
  id: string;
  thumbnailUrl: string;
  imageUrl: string;
  sourceUrl: string;
  title: string;
  isDownloaded: boolean;
}

export interface DdgVideoResult {
  id: string;
  thumbnailUrl: string;
  url: string;
  sourceUrl: string;
  title: string;
  duration: string;
  isDownloaded: boolean;
}

export type Platform = 'instagram' | 'tiktok' | 'twitter' | 'linkedin';
export type CompetitorStatus = 'SUGGESTED' | 'CONFIRMED';

export interface DiscoveredCompetitor {
  id: string;
  handle: string;
  platform: Platform;
  status: CompetitorStatus;
  relevanceScore: number;
  profileImageUrl?: string;
  followerCount?: number;
}

// Stage 2: Ingested Assets
export type MediaType = 'VIDEO' | 'IMAGE';

export interface MediaAsset {
  id: string;
  mediaType: MediaType;
  blobStoragePath: string;
  thumbnailPath: string;
  originalUrl: string;
  title?: string;
  isYoutube?: boolean;
}

export type Sentiment = 'Positive' | 'Negative' | 'Neutral';

export interface CommunityInsight {
  id: string;
  content: string;
  source: string;
  sentiment: Sentiment;
  painPoints: string[];
  marketingHooks: string[];
  createdAt: string;
}

// Stage 3: Strategic Output
export interface AiBusinessAnalysis {
  id: string;
  targetAudience: string;
  brandPersonality: string;
  uniqueStrengths: string[];
  competitiveAdvantage: string;
  marketPositioning: string;
}

export interface Persona {
  id: string;
  name: string;
  role: string;
  age: string;
  painPoints: string[];
  goals: string[];
  avatar?: string;
}

export interface ContentPillar {
  id: string;
  name: string;
  rationale: string;
  emotionalConnection: string;
  contentTypes: string[];
}

// Combined Research Data
export interface ResearchData {
  client: Client;
  job: ResearchJob;
  rawSearchResults: RawSearchResult[];
  imageResults: DdgImageResult[];
  videoResults: DdgVideoResult[];
  competitors: DiscoveredCompetitor[];
  mediaAssets: MediaAsset[];
  communityInsights: CommunityInsight[];
  aiAnalysis?: AiBusinessAnalysis;
  personas: Persona[];
  contentPillars: ContentPillar[];
}
