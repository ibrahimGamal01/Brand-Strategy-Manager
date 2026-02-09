/**
 * Content Intelligence RAG Component
 * 
 * Deep analysis of client and competitor content to extract:
 * - Content themes and pillars
 * - Performance patterns
 * - Format effectiveness
 * - Engagement insights
 * - Content gaps and opportunities
 */

import { PrismaClient } from '@prisma/client';
import { DataQualityScore, calculateQualityScore } from './data-quality';
import { analyzePlatformContent, analyzePost, extractContentPillars, calculateFormatStats } from './post-analysis';
import { analyzeCompetitorContent, analyzeCompetitorPosition } from './competitor-analysis';

const prisma = new PrismaClient();

export interface ContentIntelligence {
  client: ClientContentAnalysis;
  competitors: CompetitorContentAnalysis[];
  benchmarks: PerformanceBenchmarks;
  insights: ContentInsights;
  qualityScore: DataQualityScore;
}

export interface ClientContentAnalysis {
  instagram?: PlatformContent;
  tiktok?: PlatformContent;
  crossPlatform: CrossPlatformInsights;
}

export interface PlatformContent {
  handle: string;
  totalPosts: number;
  pillars: ContentPillar[];
  topPosts: PostAnalysis[];
  formatBreakdown: FormatStats[];
  avgEngagementRate: number;
  postingFrequency: number; // posts per week
}

export interface ContentPillar {
  name: string;
  percentage: number;
  postCount: number;
  avgEngagement: number;
  topPosts: PostAnalysis[];
  themes: string[];
}

export interface PostAnalysis {
  id: string;
  caption: string;
  postedAt: Date;
  format: string;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  engagementRate: number;
  hook: string; // First line of caption
  hashtagCount: number;
  captionLength: number;
  theme?: string;
}

export interface FormatStats {
  format: string;
  count: number;
  percentage: number;
  avgEngagement: number;
  topPost: PostAnalysis;
}

export interface CrossPlatformInsights {
  totalPosts: number;
  overallEngagementRate: number;
  bestPerformingPlatform: string;
  contentConsistency: number; // 0-1 score
  multiPlatformPillars: string[]; // Pillars used across platforms
}

export interface CompetitorContentAnalysis {
  handle: string;
  platform: string;
  followers: number;
  totalPosts: number;
  pillars: ContentPillar[];
  topPosts: PostAnalysis[];
  formatBreakdown: FormatStats[];
  avgEngagementRate: number;
  strengths: string[];
  weaknesses: string[];
  opportunities: string[]; // Gaps client can exploit
}

export interface PerformanceBenchmarks {
  avgLikesPerPost: number;
  avgCommentsPerPost: number;
  avgEngagementRate: number;
  topFormats: { format: string; percentage: number; avgEngagement: number }[];
  topThemes: { theme: string; percentage: number; avgEngagement: number }[];
  bestPostingTimes: { dayOfWeek: string; hour: number; avgEngagement: number }[];
}

export interface ContentInsights {
  topOpportunities: Opportunity[];
  contentGaps: Gap[];
  blueOceanAreas: BlueOceanArea[];
  recommendedPillars: RecommendedPillar[];
}

export interface Opportunity {
  type: 'format' | 'theme' | 'timing' | 'platform';
  description: string;
  evidence: string;
  potentialImpact: 'high' | 'medium' | 'low';
}

export interface Gap {
  area: string;
  description: string;
  competitorExamples: string[];
  recommendation: string;
}

export interface BlueOceanArea {
  area: string;
  reasoning: string;
  competitorsCovering: number;
  clientAdvantage: string;
}

export interface RecommendedPillar {
  name: string;
  rationale: string;
  targetAudience: string;
  formatRecommendations: string[];
  exampleTopics: string[];
  expectedEngagement: number;
  dataSupport: string;
}

/**
 * Get comprehensive content intelligence for a research job
 */
export async function getContentIntelligence(researchJobId: string): Promise<ContentIntelligence> {
  console.log(`[Content Intelligence] Analyzing content for research job ${researchJobId.substring(0, 8)}...`);

  // 0. Get research job details to find target handles
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    select: { inputData: true }
  });
  
  const inputData = job?.inputData as any || {};
  const targetHandles = inputData.handles || {};
  const clientInstagramHandle = targetHandles.instagram?.toLowerCase();
  const clientTiktokHandle = targetHandles.tiktok?.toLowerCase();

  // 1. Get client's social profiles
  const allJobProfiles = await prisma.socialProfile.findMany({
    where: {
      researchJobId,
    },
    include: {
      posts: {
        orderBy: { postedAt: 'desc' },
        take: 100 // Get recent posts
      }
    }
  });

  // 2. Get competitor profiles with their social profiles
  const competitorRecords = await prisma.discoveredCompetitor.findMany({
    where: { researchJobId }
  });

  // Get social profiles for competitors
  const competitorProfiles = await Promise.all(
    competitorRecords.map(async (comp) => {
      const socialProfile = await prisma.socialProfile.findFirst({
        where: {
          researchJobId,
          handle: comp.handle,
          platform: comp.platform
        },
        include: {
          posts: {
            orderBy: { postedAt: 'desc' },
            take: 50
          }
        }
      });
      
      return {
        ...comp,
        socialProfile
      };
    })
  );

  // Filter client profiles: Remove any profiles that are actually competitors
  const competitorHandleSet = new Set(competitorRecords.map(c => c.handle.toLowerCase()));
  
  // Potential client profiles (not known competitors)
  const potentialClientProfiles = allJobProfiles.filter(p => !competitorHandleSet.has(p.handle.toLowerCase()));

  // Refine client profile selection:
  // 1. Prioritize handles matching inputData
  // 2. If numeric TikTok ID, take the one with most posts
  
  let instagramProfile = potentialClientProfiles.find(p => p.platform === 'instagram' && p.handle.toLowerCase() === clientInstagramHandle);
  if (!instagramProfile) {
     // Fallback: take the instagram profile with most posts that isn't a competitor
     instagramProfile = potentialClientProfiles
       .filter(p => p.platform === 'instagram')
       .sort((a, b) => b.posts.length - a.posts.length)[0];
  }

  let tiktokProfile = potentialClientProfiles.find(p => p.platform === 'tiktok' && p.handle.toLowerCase() === clientTiktokHandle);
  if (!tiktokProfile) {
     // Fallback: take the tiktok profile with most posts (likely numeric ID)
     tiktokProfile = potentialClientProfiles
       .filter(p => p.platform === 'tiktok')
       .sort((a, b) => b.posts.length - a.posts.length)[0];
  }

  const refinedClientProfiles = [instagramProfile, tiktokProfile].filter(Boolean) as any[];

  // 3. Analyze client content
  const client = await analyzeClientContent(refinedClientProfiles);

  // 4. Analyze competitor content
  const competitors = await analyzeCompetitorContent(competitorProfiles);

  // 5. Calculate benchmarks
  const benchmarks = calculateBenchmarks([...refinedClientProfiles, ...competitorProfiles.map(c => c.socialProfile).filter(Boolean)]);

  // 6. Generate insights
  const insights = generateContentInsights(client, competitors, benchmarks);

  // 7. Quality score
  const allPosts = [...refinedClientProfiles.flatMap(p => p.posts), ...competitorProfiles.flatMap(c => c.socialProfile?.posts || [])];
  const issues: string[] = [];
  const warnings: string[] = [];

  if (allPosts.length === 0) {
    issues.push('No posts found for content analysis');
  }
  if (competitors.length === 0) {
    warnings.push('No competitor content available for comparison');
  }

  const qualityScore = calculateQualityScore(allPosts, issues, warnings);

  console.log(`[Content Intelligence] Analysis complete: ${allPosts.length} posts, ${competitors.length} competitors`);

  return {
    client,
    competitors,
    benchmarks,
    insights,
    qualityScore
  };
}

/**
 * Analyze client's content across platforms
 */
async function analyzeClientContent(profiles: any[]): Promise<ClientContentAnalysis> {
  const instagram = profiles.find(p => p.platform === 'instagram');
  const tiktok = profiles.find(p => p.platform === 'tiktok');

  const instagramContent = instagram ? await analyzePlatformContent(instagram) : undefined;
  const tiktokContent = tiktok ? await analyzePlatformContent(tiktok) : undefined;

  const crossPlatform = analyzeCrossPlatformContent([instagramContent, tiktokContent].filter(Boolean) as PlatformContent[]);

  return {
    instagram: instagramContent,
    tiktok: tiktokContent,
    crossPlatform
  };
}

/**
 * Analyze cross-platform content consistency
 */
function analyzeCrossPlatformContent(platformContents: PlatformContent[]): CrossPlatformInsights {
  const totalPosts = platformContents.reduce((sum, pc) => sum + pc.totalPosts, 0);
  const overallEngagementRate = platformContents.length > 0
    ? platformContents.reduce((sum, pc) => sum + pc.avgEngagementRate, 0) / platformContents.length
    : 0;
  
  const bestPerformingPlatform = platformContents.length > 0
    ? platformContents.sort((a: PlatformContent, b: PlatformContent) => b.avgEngagementRate - a.avgEngagementRate)[0].handle.split('_')[0] || 'N/A'
    : 'N/A';
  
  // Calculate content consistency (how similar are the pillars across platforms)
  const allPillars = platformContents.flatMap(pc => pc.pillars.map(p => p.name));
  const pillarCounts: Record<string, number> = {};
  allPillars.forEach(p => pillarCounts[p] = (pillarCounts[p] || 0) + 1);
  
  const multiPlatformPillars = Object.entries(pillarCounts)
    .filter(([_, count]) => count > 1)
    .map(([pillar]) => pillar);
  
  const contentConsistency = platformContents.length > 1
    ? multiPlatformPillars.length / Math.max(...Object.values(pillarCounts))
    : 1;

  return {
    totalPosts,
    overallEngagementRate,
    bestPerformingPlatform,
    contentConsistency,
    multiPlatformPillars
  };
}

/**
 * Calculate performance benchmarks
 */
function calculateBenchmarks(profiles: any[]): PerformanceBenchmarks {
  const allPosts = profiles.flatMap(p => p.posts || []).map(analyzePost);
  
  const avgLikesPerPost = allPosts.length > 0
    ? allPosts.reduce((sum, p) => sum + p.likes, 0) / allPosts.length
    : 0;
  
  const avgCommentsPerPost = allPosts.length > 0
    ? allPosts.reduce((sum, p) => sum + p.comments, 0) / allPosts.length
    : 0;
  
  const avgEngagementRate = allPosts.length > 0
    ? allPosts.reduce((sum, p) => sum + p.engagementRate, 0) / allPosts.length
    : 0;
  
  // Top formats
  const formatStats = calculateFormatStats(allPosts);
  const topFormats = formatStats.slice(0, 5).map(f => ({
    format: f.format,
    percentage: f.percentage,
    avgEngagement: f.avgEngagement
  }));
  
  // Top themes
  const pillars = extractContentPillars(allPosts);
  const topThemes = pillars.slice(0, 5).map(p => ({
    theme: p.name,
    percentage: p.percentage,
    avgEngagement: p.avgEngagement
  }));
  
  // TODO: Analyze posting times
  const bestPostingTimes: any[] = [];

  return {
    avgLikesPerPost,
    avgCommentsPerPost,
    avgEngagementRate,
    topFormats,
    topThemes,
    bestPostingTimes
  };
}

/**
 * Generate content insights
 */
function generateContentInsights(
  client: ClientContentAnalysis,
  competitors: CompetitorContentAnalysis[],
  benchmarks: PerformanceBenchmarks
): ContentInsights {
  const topOpportunities: Opportunity[] = [];
  const contentGaps: Gap[] = [];
  const blueOceanAreas: BlueOceanArea[] = [];
  const recommendedPillars: RecommendedPillar[] = [];

  // Analyze opportunities
  // TODO: Implement sophisticated opportunity detection

  // For now, return basic structure
  return {
    topOpportunities,
    contentGaps,
    blueOceanAreas,
    recommendedPillars
  };
}

