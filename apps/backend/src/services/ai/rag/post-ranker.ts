/**
 * Post Performance Ranking System
 * 
 * "Top performing posts" means different things for different use cases:
 * - Engagement: Best for understanding what resonates
 * - Reach: Best for viral potential
 * - Comments: Best for conversation-starters
 * - Cultural fit: Best for brand voice
 * 
 * This module provides multi-dimensional ranking.
 */

import { SocialPost } from '@prisma/client';

export type RankingCriteria = 
  | 'ENGAGEMENT_RATE'    // Likes + comments / followers
  | 'TOTAL_ENGAGEMENT'   // Raw likes + comments + shares
  | 'REACH'              // Views / plays
  | 'VIRALITY'           // Shares / views
  | 'CONVERSATION'       // Comments / likes ratio
  | 'SAVES'              // Bookmark rate (Instagram)
  | 'RECENCY'            // Recent posts weighted higher
  | 'BALANCED';          // Weighted average of all metrics

export interface RankedPost {
  post: SocialPost;
  score: number;
  rank: number;
  criteria: RankingCriteria;
  breakdown: {
    engagementRate?: number;
    totalEngagement?: number;
    reach?: number;
    virality?: number;
    conversation?: number;
    recency?: number;
  };
}

/**
 * Rank posts by multiple criteria
 */
export function rankPosts(
  posts: SocialPost[],
  followerCount: number,
  criteria: RankingCriteria = 'BALANCED'
): RankedPost[] {
  const rankedPosts = posts.map(post => {
    const breakdown = calculateBreakdown(post, followerCount);
    const score = calculateScore(breakdown, criteria);
    
    return {
      post,
      score,
      rank: 0, // Will be set after sorting
      criteria,
      breakdown
    };
  });

  // Sort by score (highest first)
  rankedPosts.sort((a, b) => b.score - a.score);

  // Assign ranks
  rankedPosts.forEach((rp, index) => {
    rp.rank = index + 1;
  });

  return rankedPosts;
}

/**
 * Get top N posts across MULTIPLE criteria
 * Returns diverse set of high performers
 */
export function getTopPerformingPosts(
  posts: SocialPost[],
  followerCount: number,
  count: number = 10
): {
  topEngagement: RankedPost[];
  topReach: RankedPost[];
  topConversation: RankedPost[];
  topViral: RankedPost[];
  balanced: RankedPost[];
  summary: string;
} {
  return {
    topEngagement: rankPosts(posts, followerCount, 'ENGAGEMENT_RATE').slice(0, count),
    topReach: rankPosts(posts, followerCount, 'REACH').slice(0, count),
    topConversation: rankPosts(posts, followerCount, 'CONVERSATION').slice(0, count),
    topViral: rankPosts(posts, followerCount, 'VIRALITY').slice(0, count),
    balanced: rankPosts(posts, followerCount, 'BALANCED').slice(0, count),
    summary: generateSummary(posts, followerCount, count)
  };
}

/**
 * Calculate all performance metrics for a post
 */
function calculateBreakdown(post: SocialPost, followerCount: number) {
  const likes = post.likesCount || 0;
  const comments = post.commentsCount || 0;
  const shares = post.sharesCount || 0;
  const views = post.viewsCount || post.playsCount || 0;
  const saves = 0; // TODO: Add saves field to schema if needed

  const totalEngagement = likes + comments + shares + saves;
  const engagementRate = followerCount > 0 ? (totalEngagement / followerCount) * 100 : 0;
  const reach = views;
  const virality = views > 0 ? (shares / views) * 100 : 0;
  const conversation = likes > 0 ? (comments / likes) * 100 : 0;
  
  // Recency score (newer = higher)
  const daysSincePost = post.postedAt 
    ? Math.floor((Date.now() - new Date(post.postedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 999;
  const recency = Math.max(0, 100 - daysSincePost); // 100 for today, 0 for 100+ days ago

  return {
    engagementRate,
    totalEngagement,
    reach,
    virality,
    conversation,
    recency
  };
}

/**
 * Calculate final score based on criteria
 */
function calculateScore(
  breakdown: ReturnType<typeof calculateBreakdown>,
  criteria: RankingCriteria
): number {
  switch (criteria) {
    case 'ENGAGEMENT_RATE':
      return breakdown.engagementRate;
      
    case 'TOTAL_ENGAGEMENT':
      return breakdown.totalEngagement;
      
    case 'REACH':
      return breakdown.reach;
      
    case 'VIRALITY':
      return breakdown.virality;
      
    case 'CONVERSATION':
      return breakdown.conversation;
      
    case 'RECENCY':
      return breakdown.recency;
      
    case 'BALANCED':
      // Weighted average of all metrics (normalized 0-100)
      const normalized = {
        engagement: Math.min(100, breakdown.engagementRate * 10), // 10% engagement = 100 score
        reach: Math.min(100, breakdown.reach / 1000), // 100K views = 100 score
        virality: breakdown.virality,
        conversation: breakdown.conversation,
        recency: breakdown.recency
      };
      
      return (
        normalized.engagement * 0.35 +  // 35% weight on engagement
        normalized.reach * 0.25 +        // 25% weight on reach
        normalized.virality * 0.15 +     // 15% weight on virality
        normalized.conversation * 0.15 + // 15% weight on conversation
        normalized.recency * 0.10        // 10% weight on recency
      );
      
    default:
      return 0;
  }
}

/**
 * Generate human-readable summary
 */
function generateSummary(posts: SocialPost[], followerCount: number, topN: number): string {
  const ranked = rankPosts(posts, followerCount, 'BALANCED');
  const top = ranked.slice(0, topN);
  
  const avgEngagement = top.reduce((sum, rp) => sum + (rp.breakdown.engagementRate || 0), 0) / top.length;
  const totalReach = top.reduce((sum, rp) => sum + (rp.breakdown.reach || 0), 0);
  
  return `
Top ${topN} performing posts analysis:
- Average engagement rate: ${avgEngagement.toFixed(2)}%
- Total reach: ${totalReach.toLocaleString()} views
- Posts analyzed: ${posts.length}
- Follower count: ${followerCount.toLocaleString()}
  `.trim();
}

/**
 * Format ranked posts for RAG/LLM consumption
 */
export function formatTopPostsForRAG(
  topPosts: ReturnType<typeof getTopPerformingPosts>,
  includeAll: boolean = false
): string {
  const sections: string[] = [];

  // Balanced top performers (always include)
  sections.push(`## Top 10 Balanced Performers (Multi-Metric)`);
  sections.push(formatPostList(topPosts.balanced));

  if (includeAll) {
    sections.push(`\n## Top 10 by Engagement Rate`);
    sections.push(formatPostList(topPosts.topEngagement));

    sections.push(`\n## Top 10 by Reach (Views)`);
    sections.push(formatPostList(topPosts.topReach));

    sections.push(`\n## Top 10 by Conversation (Comments/Likes)`);
    sections.push(formatPostList(topPosts.topConversation));

    sections.push(`\n## Top 10 by Virality (Shares)`);
    sections.push(formatPostList(topPosts.topViral));
  }

  sections.push(`\n## Summary`);
  sections.push(topPosts.summary);

  return sections.join('\n');
}

function formatPostList(rankedPosts: RankedPost[]): string {
  return rankedPosts.map((rp, index) => {
    const post = rp.post;
    const caption = post.caption?.substring(0, 100) || 'No caption';
    const breakdown = rp.breakdown;
    
    return `
${index + 1}. "${caption}${caption.length > 100 ? '...' : ''}"
   - Engagement Rate: ${breakdown.engagementRate?.toFixed(2)}%
   - Likes: ${post.likesCount?.toLocaleString() || 0} | Comments: ${post.commentsCount?.toLocaleString() || 0}
   - Views: ${(post.viewsCount || post.playsCount || 0).toLocaleString()}
   - Posted: ${post.postedAt ? new Date(post.postedAt).toLocaleDateString() : 'Unknown'}
   - Score: ${rp.score.toFixed(1)}
    `.trim();
  }).join('\n\n');
}
