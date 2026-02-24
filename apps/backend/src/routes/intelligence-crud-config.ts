import { prisma } from '../lib/prisma';

export type ScopeType = 'researchJob' | 'client';

export type SectionConfig = {
  model: keyof typeof prisma;
  scope: ScopeType;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  allowedFields: string[];
  requiredOnCreate?: string[];
  immutableFields?: string[];
  identityFields?: string[];
  enumFields?: Record<string, Set<string>>;
  numberFields?: string[];
  booleanFields?: string[];
  dateFields?: string[];
  jsonArrayFields?: string[];
  supportsCuration: boolean;
};

const COMPETITOR_SELECTION_STATE_VALUES = new Set(['FILTERED_OUT', 'SHORTLISTED', 'TOP_PICK', 'APPROVED', 'REJECTED']);
const COMPETITOR_TYPE_VALUES = new Set(['DIRECT', 'INDIRECT', 'ADJACENT', 'MARKETPLACE', 'MEDIA', 'INFLUENCER', 'COMMUNITY', 'UNKNOWN']);
const MEDIA_TYPE_VALUES = new Set(['IMAGE', 'VIDEO', 'AUDIO']);
const MEDIA_SOURCE_TYPE_VALUES = new Set(['CLIENT_POST_SNAPSHOT', 'COMPETITOR_POST_SNAPSHOT']);
const WEB_SOURCE_TYPE_VALUES = new Set(['CLIENT_SITE', 'COMPETITOR_SITE', 'ARTICLE', 'REVIEW', 'FORUM', 'DOC', 'OTHER']);
const WEB_DISCOVERY_VALUES = new Set(['DDG', 'USER', 'SCRAPLING_CRAWL', 'CHAT_TOOL', 'IMPORT']);
const WEB_FETCH_MODE_VALUES = new Set(['AUTO', 'HTTP', 'DYNAMIC', 'STEALTH']);
const AI_QUESTION_TYPE_VALUES = new Set([
  'VALUE_PROPOSITION',
  'TARGET_AUDIENCE',
  'CONTENT_PILLARS',
  'BRAND_VOICE',
  'BRAND_PERSONALITY',
  'COMPETITOR_ANALYSIS',
  'NICHE_POSITION',
  'UNIQUE_STRENGTHS',
  'CONTENT_OPPORTUNITIES',
  'GROWTH_STRATEGY',
  'PAIN_POINTS',
  'KEY_DIFFERENTIATORS',
  'CUSTOM',
  'COMPETITOR_DISCOVERY_METHOD',
]);

export const SECTION_CONFIG: Record<string, SectionConfig> = {
  client_profiles: {
    model: 'clientAccount',
    scope: 'client',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['platform', 'handle', 'profileUrl', 'followerCount', 'followingCount', 'bio', 'profileImageUrl', 'lastScrapedAt'],
    requiredOnCreate: ['platform', 'handle'],
    immutableFields: ['platform', 'handle'],
    identityFields: ['platform', 'handle'],
    numberFields: ['followerCount', 'followingCount'],
    dateFields: ['lastScrapedAt'],
    supportsCuration: true,
  },
  competitors: {
    model: 'discoveredCompetitor',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['handle', 'platform', 'profileUrl', 'discoveryReason', 'relevanceScore', 'status', 'postsScraped', 'selectionState', 'selectionReason', 'competitorType', 'typeConfidence', 'entityFlags', 'availabilityStatus', 'availabilityReason', 'displayOrder', 'evidence', 'scoreBreakdown'],
    requiredOnCreate: ['handle', 'platform'],
    immutableFields: ['handle', 'platform'],
    identityFields: ['platform', 'handle'],
    enumFields: { selectionState: COMPETITOR_SELECTION_STATE_VALUES, competitorType: COMPETITOR_TYPE_VALUES },
    numberFields: ['relevanceScore', 'postsScraped', 'displayOrder', 'typeConfidence'],
    jsonArrayFields: ['entityFlags'],
    supportsCuration: true,
  },
  search_results: {
    model: 'rawSearchResult',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['query', 'source', 'title', 'href', 'body', 'isProcessed', 'extractedData', 'seenCount', 'lastSeenAt'],
    requiredOnCreate: ['query', 'title', 'href', 'body'],
    immutableFields: ['href'],
    identityFields: ['href'],
    numberFields: ['seenCount'],
    booleanFields: ['isProcessed'],
    dateFields: ['lastSeenAt'],
    supportsCuration: true,
  },
  images: {
    model: 'ddgImageResult',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['query', 'title', 'imageUrl', 'thumbnailUrl', 'sourceUrl', 'width', 'height'],
    requiredOnCreate: ['query', 'title', 'imageUrl', 'sourceUrl'],
    immutableFields: ['imageUrl'],
    identityFields: ['imageUrl'],
    numberFields: ['width', 'height'],
    supportsCuration: true,
  },
  videos: {
    model: 'ddgVideoResult',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['query', 'title', 'description', 'url', 'embedUrl', 'duration', 'publisher', 'uploader', 'viewCount', 'thumbnailUrl', 'publishedAt'],
    requiredOnCreate: ['query', 'title', 'url'],
    immutableFields: ['url'],
    identityFields: ['url'],
    numberFields: ['viewCount'],
    supportsCuration: true,
  },
  news: {
    model: 'ddgNewsResult',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['query', 'title', 'body', 'url', 'source', 'imageUrl', 'publishedAt'],
    requiredOnCreate: ['query', 'title', 'url'],
    immutableFields: ['url'],
    identityFields: ['url'],
    supportsCuration: true,
  },
  brand_mentions: {
    model: 'brandMention',
    scope: 'client',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['url', 'title', 'snippet', 'fullText', 'sourceType', 'availabilityStatus', 'availabilityReason', 'resolverConfidence', 'evidence'],
    requiredOnCreate: ['url'],
    immutableFields: ['url'],
    identityFields: ['url'],
    numberFields: ['resolverConfidence'],
    supportsCuration: true,
  },
  media_assets: {
    model: 'mediaAsset',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['mediaType', 'sourceType', 'sourceId', 'externalMediaId', 'originalUrl', 'blobStoragePath', 'fileSizeBytes', 'durationSeconds', 'width', 'height', 'thumbnailPath', 'isDownloaded', 'downloadedAt', 'downloadError'],
    enumFields: { mediaType: MEDIA_TYPE_VALUES, sourceType: MEDIA_SOURCE_TYPE_VALUES },
    numberFields: ['fileSizeBytes', 'durationSeconds', 'width', 'height'],
    booleanFields: ['isDownloaded'],
    dateFields: ['downloadedAt'],
    supportsCuration: true,
  },
  search_trends: {
    model: 'searchTrend',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['keyword', 'region', 'timeframe', 'interestOverTime', 'relatedQueries', 'relatedTopics'],
    requiredOnCreate: ['keyword', 'region', 'timeframe'],
    immutableFields: ['keyword', 'region', 'timeframe'],
    identityFields: ['keyword', 'region', 'timeframe'],
    jsonArrayFields: ['relatedQueries', 'relatedTopics'],
    supportsCuration: true,
  },
  community_insights: {
    model: 'communityInsight',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['source', 'url', 'content', 'sentiment', 'painPoints', 'desires', 'marketingHooks', 'metric', 'metricValue', 'sourceQuery', 'evidence'],
    requiredOnCreate: ['source', 'url', 'content'],
    immutableFields: ['url'],
    identityFields: ['url'],
    numberFields: ['metricValue'],
    jsonArrayFields: ['painPoints', 'desires', 'marketingHooks'],
    supportsCuration: true,
  },
  ai_questions: {
    model: 'aiQuestion',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['questionType', 'question', 'answer', 'answerJson', 'contextUsed', 'promptUsed', 'modelUsed', 'tokensUsed', 'durationMs', 'isAnswered', 'answeredAt'],
    requiredOnCreate: ['questionType', 'question'],
    immutableFields: ['questionType'],
    identityFields: ['questionType'],
    enumFields: { questionType: AI_QUESTION_TYPE_VALUES },
    numberFields: ['tokensUsed', 'durationMs'],
    booleanFields: ['isAnswered'],
    dateFields: ['answeredAt'],
    supportsCuration: true,
  },
  web_sources: {
    model: 'webSource',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['url', 'domain', 'sourceType', 'discoveredBy'],
    requiredOnCreate: ['url'],
    immutableFields: ['url'],
    identityFields: ['url'],
    enumFields: { sourceType: WEB_SOURCE_TYPE_VALUES, discoveredBy: WEB_DISCOVERY_VALUES },
    supportsCuration: true,
  },
  web_snapshots: {
    model: 'webPageSnapshot',
    scope: 'researchJob',
    orderBy: { field: 'fetchedAt', direction: 'desc' },
    allowedFields: ['webSourceId', 'fetcherUsed', 'finalUrl', 'statusCode', 'contentHash', 'htmlPath', 'textPath', 'cleanText', 'metadata', 'fetchedAt'],
    requiredOnCreate: ['webSourceId'],
    immutableFields: ['webSourceId'],
    enumFields: { fetcherUsed: WEB_FETCH_MODE_VALUES },
    numberFields: ['statusCode'],
    dateFields: ['fetchedAt'],
    supportsCuration: true,
  },
  web_extraction_recipes: {
    model: 'webExtractionRecipe',
    scope: 'researchJob',
    orderBy: { field: 'updatedAt', direction: 'desc' },
    allowedFields: ['name', 'targetDomain', 'schema', 'createdBy'],
    requiredOnCreate: ['name', 'schema'],
    immutableFields: ['name'],
    identityFields: ['name', 'targetDomain'],
    supportsCuration: true,
  },
  web_extraction_runs: {
    model: 'webExtractionRun',
    scope: 'researchJob',
    orderBy: { field: 'createdAt', direction: 'desc' },
    allowedFields: ['recipeId', 'snapshotId', 'extracted', 'confidence', 'warnings'],
    requiredOnCreate: ['recipeId', 'snapshotId', 'extracted'],
    immutableFields: ['recipeId', 'snapshotId'],
    numberFields: ['confidence'],
    jsonArrayFields: ['warnings'],
    supportsCuration: true,
  },
};
