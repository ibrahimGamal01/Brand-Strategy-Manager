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
  qualityScore: DataQualityScore;
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

  return {
    profiles: [],
    posts: allPosts,      // Keep all posts for reference
    topPosts: topPosts,   // NEW: Filtered top performers
    trends,
    qualityScore
  };
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
