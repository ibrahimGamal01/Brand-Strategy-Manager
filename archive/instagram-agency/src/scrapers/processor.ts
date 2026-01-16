import { InstagramPost } from './apify';
import { logger } from '../utils/logger';

export interface ProcessedPost {
  source: 'client' | 'competitor';
  username: string;
  postId: string;
  postType: 'video' | 'carousel' | 'single_image';
  caption: string;
  hashtags: string[];
  likesCount: number;
  commentsCount: number;
  engagementRate: number;
  timestamp: string;
  displayUrl: string;
  videoUrl: string | null;
}

export interface ProcessedData {
  clientPosts: ProcessedPost[];
  competitorPosts: ProcessedPost[];
  topPerformers: ProcessedPost[];
  byType: {
    videos: ProcessedPost[];
    carousels: ProcessedPost[];
    images: ProcessedPost[];
  };
}

function determinePostType(post: InstagramPost): 'video' | 'carousel' | 'single_image' {
  if (post.type === 'Video' || post.videoUrl) return 'video';
  if (post.childPosts && post.childPosts.length > 1) return 'carousel';
  return 'single_image';
}

function calculateEngagementRate(post: InstagramPost): number {
  if (!post.likesCount || !post.ownerFollowerCount) return 0;
  const engagement = post.likesCount + (post.commentsCount || 0);
  return parseFloat(((engagement / post.ownerFollowerCount) * 100).toFixed(2));
}

function processPost(post: InstagramPost, source: 'client' | 'competitor'): ProcessedPost {
  return {
    source,
    username: post.ownerUsername || '',
    postId: post.id,
    postType: determinePostType(post),
    caption: post.caption || '',
    hashtags: post.hashtags || [],
    likesCount: post.likesCount || 0,
    commentsCount: post.commentsCount || 0,
    engagementRate: calculateEngagementRate(post),
    timestamp: post.timestamp,
    displayUrl: post.displayUrl,
    videoUrl: post.videoUrl || null,
  };
}

export function processClientData(posts: InstagramPost[]): ProcessedPost[] {
  logger.info(`Processing ${posts.length} client posts`);
  
  const processed = posts.map(post => processPost(post, 'client'));
  processed.sort((a, b) => b.engagementRate - a.engagementRate);
  
  return processed;
}

export function processCompetitorData(posts: InstagramPost[]): ProcessedPost[] {
  logger.info(`Processing ${posts.length} competitor posts`);
  
  const processed = posts.map(post => processPost(post, 'competitor'));
  processed.sort((a, b) => b.engagementRate - a.engagementRate);
  
  return processed;
}

export function combineData(
  clientPosts: ProcessedPost[],
  competitorPosts: ProcessedPost[]
): ProcessedData {
  const allPosts = [...competitorPosts];
  
  return {
    clientPosts,
    competitorPosts,
    topPerformers: allPosts.slice(0, 15),
    byType: {
      videos: allPosts.filter(p => p.postType === 'video').slice(0, 10),
      carousels: allPosts.filter(p => p.postType === 'carousel').slice(0, 10),
      images: allPosts.filter(p => p.postType === 'single_image').slice(0, 10),
    },
  };
}
