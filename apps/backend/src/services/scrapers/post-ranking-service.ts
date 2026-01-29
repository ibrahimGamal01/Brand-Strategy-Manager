/**
 * Post Ranking Service
 * 
 * Takes scraped posts and calculates multi-dimensional rankings
 * to identify top performers for AI analysis
 */

import { rankPosts, getTopPerformingPosts, RankingCriteria } from '../ai/rag/post-ranker';

export interface PostWithMetrics {
  externalId: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  playsCount: number;
  postedAt?: string | Date;
  type?: string;
  [key: string]: any;
}

export interface RankedPostMetadata {
  // Original metrics
  likes: number;
  comments: number;
  shares: number;
  views: number;
  format: string;
  
  // Rankings
  rankings: {
    engagementRate?: { value: number; rank: number; isTop5: boolean };
    totalEngagement?: { value: number; rank: number; isTop5: boolean };
    reach?: { value: number; rank: number; isTop5: boolean };
    virality?: { value: number; rank: number; isTop5: boolean };
    conversation?: { value: number; rank: number; isTop5: boolean };
    balanced?: { value: number; rank: number; isTop5: boolean };
  };
  
  // Top performer flags (for quick filtering)
  topPerformers: string[]; // ['engagement_rate', 'reach', 'balanced']
  
  // Analysis metadata
  analysisVersion: string;
  analyzedAt: string;
}

/**
 * Calculate rankings for all posts from a profile
 */
export function calculatePostRankings(
  posts: PostWithMetrics[],
  followerCount: number,
  platform: string
): Map<string, RankedPostMetadata> {
  
  console.log(`[PostRanking] Analyzing ${posts.length} posts (${followerCount} followers)`);
  
  if (posts.length === 0) {
    console.log(`[PostRanking] No posts to rank`);
    return new Map();
  }
  
  // Convert to format expected by post-ranker
  const postsForRanking = posts.map(p => ({
    id: p.externalId,
    likesCount: p.likesCount || 0,
    commentsCount: p.commentsCount || 0,
    sharesCount: p.sharesCount || 0,
    viewsCount: p.viewsCount || p.playsCount || 0,
    playsCount: p.playsCount || 0,
    postedAt: p.postedAt ? new Date(p.postedAt) : new Date(),
  }));
  
  // Get rankings across all criteria
  const criteria: RankingCriteria[] = [
    'ENGAGEMENT_RATE',
    'TOTAL_ENGAGEMENT',
    'REACH',
    'VIRALITY',
    'CONVERSATION',
    'BALANCED'
  ];
  
  const allRankings = criteria.map(criterion => ({
    criterion,
    ranked: rankPosts(postsForRanking as any, followerCount, criterion)
  }));
  
  // Build metadata map
  const metadataMap = new Map<string, RankedPostMetadata>();
  
  for (const post of posts) {
    const rankings: RankedPostMetadata['rankings'] = {};
    const topPerformers: string[] = [];
    
    // Collect rankings from each criterion
    for (const { criterion, ranked } of allRankings) {
      const rankedPost = ranked.find(r => r.post.id === post.externalId);
      
      if (rankedPost) {
        const key = criterionToKey(criterion);
        const isTop5 = rankedPost.rank <= 5;
        
        rankings[key] = {
          value: rankedPost.score,
          rank: rankedPost.rank,
          isTop5
        };
        
        if (isTop5) {
          topPerformers.push(camelToSnake(key));
        }
      }
    }
    
    metadataMap.set(post.externalId, {
      likes: post.likesCount || 0,
      comments: post.commentsCount || 0,
      shares: post.sharesCount || 0,
      views: post.viewsCount || post.playsCount || 0,
      format: post.type || 'unknown',
      rankings,
      topPerformers,
      analysisVersion: '1.0',
      analyzedAt: new Date().toISOString()
    });
  }
  
  const topCount = Array.from(metadataMap.values())
    .filter(m => m.topPerformers.length > 0).length;
  
  console.log(`[PostRanking] Identified ${topCount}/${posts.length} top performing posts`);
  
  return metadataMap;
}

// Helper functions
function criterionToKey(criterion: RankingCriteria): keyof RankedPostMetadata['rankings'] {
  const map: Record<RankingCriteria, keyof RankedPostMetadata['rankings']> = {
    'ENGAGEMENT_RATE': 'engagementRate',
    'TOTAL_ENGAGEMENT': 'totalEngagement',
    'REACH': 'reach',
    'VIRALITY': 'virality',
    'CONVERSATION': 'conversation',
    'RECENCY': 'engagementRate', // Fallback to engagement rate
    'SAVES': 'engagementRate', // Fallback to engagement rate
    'BALANCED': 'balanced'
  };
  return map[criterion];
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}
