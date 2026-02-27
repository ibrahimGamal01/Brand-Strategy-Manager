import { CompetitorType } from '@prisma/client';
import type { SearchResultItem } from '../../search/search-provider';

export type CompetitorDiscoveryV3Mode = 'wide' | 'standard' | 'deep';

export type CompetitorDiscoveryLane =
  | 'category'
  | 'alternatives'
  | 'directories'
  | 'social'
  | 'community'
  | 'people';

export interface DiscoverCompetitorsV3Seed {
  name?: string;
  url?: string;
  handle?: string;
}

export interface DiscoverCompetitorsV3Input {
  mode?: CompetitorDiscoveryV3Mode;
  seedCompetitors?: DiscoverCompetitorsV3Seed[];
  lanes?: CompetitorDiscoveryLane[];
  maxCandidates?: number;
  maxEnrich?: number;
  locales?: string[];
  includePeople?: boolean;
}

export interface MarketFingerprint {
  brandName: string;
  niche: string;
  categoryKeywords: string[];
  problemKeywords: string[];
  audienceKeywords: string[];
  geoMarkets: string[];
  offerTypes: string[];
  seedCompetitors: DiscoverCompetitorsV3Seed[];
}

export interface LaneQuery {
  lane: CompetitorDiscoveryLane;
  query: string;
  locale: string;
}

export interface CompetitorDiscoveryV3Evidence {
  lane: CompetitorDiscoveryLane;
  query: string;
  rank: number;
  source: string;
  url: string;
  title: string;
  snippet: string;
  provider: string;
}

export interface CompetitorDiscoveryV3Candidate {
  key: string;
  name: string;
  platform: string;
  handle: string;
  normalizedHandle: string;
  profileUrl: string;
  websiteDomain: string | null;
  competitorType: CompetitorType;
  relationshipLabel: 'direct' | 'adjacent' | 'indirect' | 'inspiration' | 'community';
  score: number;
  scoreBreakdown: Record<string, number>;
  evidence: CompetitorDiscoveryV3Evidence[];
  laneHits: CompetitorDiscoveryLane[];
}

export interface CompetitorDiscoveryV3SearchHit {
  lane: CompetitorDiscoveryLane;
  query: string;
  locale: string;
  provider: string;
  item: SearchResultItem;
}
