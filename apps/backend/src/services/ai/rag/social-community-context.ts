/**
 * Social and Community Context Retrieval
 */

import { PrismaClient } from '@prisma/client';
import { DataQualityScore, calculateQualityScore } from './data-quality';

const prisma = new PrismaClient();

export interface SocialContext {
  profiles: any[];
  posts: any[];
  topPosts: any[];  // Filtered top performers
  trends: any[];
  platformMetrics: PlatformMetrics[];  // NEW: Aggregated metrics by platform
  qualityScore: DataQualityScore;
}

export interface PlatformMetrics {
  platform: string;
  profileCount: number;
  totalFollowers: number;
  avgFollowers: number;
  totalPosts: number;
  avgEngagementRate: number;
  topPerformers: {
    handle: string;
    followers: number;
    engagementRate: number;
    postsPerWeek: number;
  }[];
}

export interface CommunityContext {
  insights: any[];
  searchTrends: any[];
  qualityScore: DataQualityScore;
}

/**
 * Get social data context with quality validation
 */
export async function getSocialContext(researchJobId: string): Promise<SocialContext> {
  // Get ALL posts through SocialProfile -> ResearchJob relationship
  const allPosts = await prisma.socialPost.findMany({
    where: {
      socialProfile: {
        researchJobId
      }
    },
    orderBy: { postedAt: 'desc' }
  });

  // NEW: Filter to top performers only
  const topPosts = allPosts.filter(p => {
    if (!p.metadata || typeof p.metadata !== 'object') return false;
    const meta = p.metadata as any;
    return meta.topPerformers && meta.topPerformers.length > 0;
  });

  const trends = await prisma.socialTrend.findMany({
    where: { researchJobId },
    take: 20
  });

  const issues: string[] = [];
  const warnings: string[] = [];

  if (allPosts.length === 0) {
    issues.push('No social posts found for competitors');
  } else if (topPosts.length === 0) {
    warnings.push('No top-performing posts identified - rankings may not be calculated yet');
  }
  
  const reductionPercent = allPosts.length > 0 
    ? Math.round((1 - topPosts.length / allPosts.length) * 100)
    : 0;
  
  if (topPosts.length > 0) {
    console.log(`[RAG] Filtered to ${topPosts.length}/${allPosts.length} top posts (${reductionPercent}% reduction)`);
  }

  const postsWithoutMetrics = allPosts.filter(p => 
    !p.metadata || (typeof p.metadata === 'object' && !('likes' in p.metadata))
  );
  
  if (allPosts.length > 0 && postsWithoutMetrics.length > allPosts.length * 0.5) {
    warnings.push(`${postsWithoutMetrics.length}/${allPosts.length} posts missing engagement metrics`);
  }

  const qualityScore = calculateQualityScore(
    topPosts.length > 0 ? topPosts : allPosts,  // Use top posts if available
    issues,
    warnings
  );

  // NEW: Aggregate metrics by platform
  const profiles = await prisma.socialProfile.findMany({
    where: { researchJobId }
  });

  const platformMetrics = aggregatePlatformMetrics(profiles, allPosts);

  return {
    profiles,
    posts: allPosts,      // Keep all posts for reference
    topPosts: topPosts,   // NEW: Filtered top performers
    trends,
    platformMetrics,      // NEW: Aggregated platform data
    qualityScore
  };
}

/**
 * Aggregate platform metrics from profiles and posts
 */
function aggregatePlatformMetrics(profiles: any[], posts: any[]): PlatformMetrics[] {
  const platformGroups = profiles.reduce((acc: Record<string, any[]>, profile: any) => {
    const platform = profile.platform;
    if (!acc[platform]) {
      acc[platform] = [];
    }
    acc[platform].push(profile);
    return acc;
  }, {} as Record<string, any[]>);

  return Object.entries(platformGroups).map(([platform, platformProfiles]: [string, any[]]) => {
    const validProfiles = platformProfiles.filter((p: any) => p.followers && p.followers > 0);
    const totalFollowers = validProfiles.reduce((sum: number, p: any) => sum + (p.followers || 0), 0);
    const avgFollowers = validProfiles.length > 0 ? Math.round(totalFollowers / validProfiles.length) : 0;

    // Calculate engagement rates from posts
    const platformPosts = posts.filter((post: any) => {
      const handle = (post.metadata as any)?.handle;
      return platformProfiles.some((p: any) => p.handle === handle);
    });

    const engagementRates = platformPosts
      .map((post: any) => {
        const metadata = post.metadata as any;
        return metadata?.engagement_rate || 0;
      })
      .filter((rate: number) => rate > 0);

    const avgEngagementRate = engagementRates.length > 0
      ? engagementRates.reduce((sum: number, rate: number) => sum + rate, 0) / engagementRates.length
      : 0;

    // Identify top performers
    const topPerformers = validProfiles
      .sort((a: any, b: any) => (b.followers || 0) - (a.followers || 0))
      .slice(0, 3)
      .map((profile: any) => {
        const profilePosts = platformPosts.filter((p: any) => (p.metadata as any)?.handle === profile.handle);
        const profileEngagement = profilePosts
          .map((p: any) => (p.metadata as any)?.engagement_rate || 0)
          .filter((r: number) => r > 0);
        const avgEngagement = profileEngagement.length > 0
          ? profileEngagement.reduce((sum: number, r: number) => sum + r, 0) / profileEngagement.length
          : 0;

        // Estimate posts per week
        const postsPerWeek = profile.postsCount && profile.lastScrapedAt
          ? estimatePostsPerWeek(profile)
          : 0;

        return {
          handle: profile.handle,
          followers: profile.followers || 0,
          engagementRate: avgEngagement,
          postsPerWeek
        };
      });

    return {
      platform,
      profileCount: platformProfiles.length,
      totalFollowers,
      avgFollowers,
      totalPosts: platformPosts.length,
      avgEngagementRate,
      topPerformers
    };
  });
}

/**
 * Estimate posts per week from profile data
 */
function estimatePostsPerWeek(profile: any): number {
  if (!profile.postsCount || !profile.createdAt) return 0;
  
  const now = new Date();
  const created = new Date(profile.createdAt);
  const weeksActive = Math.max(1, (now.getTime() - created.getTime()) / (7 * 24 * 60 * 60 * 1000));
  
  return Math.round((profile.postsCount / weeksActive) * 10) / 10; // Round to 1 decimal
}

/**
 * Get community context with quality validation
 */
export async function getCommunityContext(researchJobId: string): Promise<CommunityContext> {
  const insights = await prisma.communityInsight.findMany({
    where: { researchJobId },
    take: 50
  });

  const searchTrends = await prisma.searchTrend.findMany({
    where: { researchJobId },
    take: 10
  });

  const issues: string[] = [];
  const warnings: string[] = [];

  if (insights.length === 0) {
    warnings.push('No community insights found');
  }

  if (searchTrends.length === 0) {
    warnings.push('No search trends found');
  }

  const qualityScore = calculateQualityScore(
    [...insights, ...searchTrends],
    issues,
    warnings
  );

  return {
    insights,
    searchTrends,
    qualityScore
  };
}
