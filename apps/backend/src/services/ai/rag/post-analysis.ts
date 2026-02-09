/**
 * Post Analysis Module
 * 
 * Deep analysis of individual social media posts
 */

import { PostAnalysis, FormatStats, ContentPillar } from './content-intelligence';

/**
 * Analyze content for a single platform
 */
export async function analyzePlatformContent(profile: any): Promise<{
  handle: string;
  totalPosts: number;
  pillars: ContentPillar[];
  topPosts: PostAnalysis[];
  formatBreakdown: FormatStats[];
  avgEngagementRate: number;
  postingFrequency: number;
}> {
  const posts = profile.posts || [];
  
  // Analyze posts
  const postAnalyses = posts.map((post: any) => analyzePost(post));
  
  // Extract pillars
  const pillars = extractContentPillars(postAnalyses);
  
  // Get top posts
  const topPosts = postAnalyses
    .sort((a: PostAnalysis, b: PostAnalysis) => b.engagementRate - a.engagementRate)
    .slice(0, 10);
  
  // Format breakdown
  const formatBreakdown = calculateFormatStats(postAnalyses);
  
  // Avg engagement
  const avgEngagementRate = postAnalyses.reduce((sum: number, p: PostAnalysis) => sum + p.engagementRate, 0) / postAnalyses.length || 0;
  
  // Posting frequency (estimate)
  const postingFrequency = estimatePostingFrequency(posts);

  return {
    handle: profile.handle,
    totalPosts: posts.length,
    pillars,
    topPosts,
    formatBreakdown,
    avgEngagementRate,
    postingFrequency
  };
}

/**
 * Analyze a single post
 */
export function analyzePost(post: any): PostAnalysis {
  const metadata = post.metadata as any || {};
  
  const likes = metadata.likes || post.likesCount || 0;
  const comments = metadata.comments || post.commentsCount || 0;
  const saves = metadata.saves || 0;
  const shares = metadata.shares || post.sharesCount || 0;
  
  const totalEngagement = likes + comments + saves + shares;
  const followers = metadata.followers || 1000; // Fallback
  const engagementRate = (totalEngagement / followers) * 100;
  
  const caption = post.caption || '';
  const hook = caption.split('\n')[0]?.substring(0, 100) || '';
  
  // Count hashtags
  const hashtagMatches = caption.match(/#\w+/g);
  const hashtagCount = hashtagMatches ? hashtagMatches.length : 0;

  return {
    id: post.id,
    caption,
    postedAt: post.postedAt,
    format: post.type || metadata.format || 'unknown',
    likes,
    comments,
    saves,
    shares,
    engagementRate,
    hook,
    hashtagCount,
    captionLength: caption.length
  };
}

/**
 * Extract content pillars from posts using theme analysis
 */
export function extractContentPillars(posts: PostAnalysis[]): ContentPillar[] {
  // Group posts by theme
  const themeGroups: Record<string, PostAnalysis[]> = {};
  
  posts.forEach(post => {
    const theme = classifyTheme(post.caption);
    if (!themeGroups[theme]) {
      themeGroups[theme] = [];
    }
    themeGroups[theme].push(post);
  });

  // Convert to pillars
  return Object.entries(themeGroups)
    .map(([theme, themePosts]: [string, PostAnalysis[]]) => {
      const totalEngagement = themePosts.reduce((sum: number, p: PostAnalysis) => sum + p.engagementRate, 0);
      const avgEngagement = totalEngagement / themePosts.length;
      const topPosts = themePosts.sort((a: PostAnalysis, b: PostAnalysis) => b.engagementRate - a.engagementRate).slice(0, 3);

      return {
        name: theme,
        percentage: (themePosts.length / posts.length) * 100,
        postCount: themePosts.length,
        avgEngagement,
        topPosts,
        themes: [...new Set(themePosts.map((p: PostAnalysis) => extractKeywords(p.caption)).flat())]
      };
    })
    .sort((a: ContentPillar, b: ContentPillar) => b.percentage - a.percentage);
}

/**
 * Classify theme from caption (simple keyword-based)
 * TODO: Replace with AI-based classification
 */
function classifyTheme(caption: string): string {
  const lower = caption.toLowerCase();
  
  if (lower.includes('learn') || lower.includes('how to') || lower.includes('tip') || lower.includes('guide') || lower.includes('tutorial')) {
    return 'Educational';
  }
  if (lower.includes('inspire') || lower.includes('motivat') || lower.includes('believe') || lower.includes('achieve') || lower.includes('success')) {
    return 'Inspirational';
  }
  if (lower.includes('behind') || lower.includes('process') || lower.includes('journey') || lower.includes('story') || lower.includes('day in')) {
    return 'Behind the Scenes';
  }
  if (lower.includes('product') || lower.includes('service') || lower.includes('offer') || lower.includes('new') || lower.includes('launch')) {
    return 'Product/Service';
  }
  if (lower.includes('community') || lower.includes('together') || lower.includes('question') || lower.includes('comment')) {
    return 'Community Engagement';
  }
  if (lower.includes('business') || lower.includes('entrepreneur') || lower.includes('startup') || lower.includes('growth')) {
    return 'Business Strategy';
  }
  if (lower.includes('faith') || lower.includes('islam') || lower.includes('halal') || lower.includes('deen')) {
    return 'Faith & Values';
  }
  
  return 'General Content';
}

/**
 * Extract keywords from caption
 */
function extractKeywords(caption: string): string[] {
  // Simple extraction - get words with 5+ chars, excluding common words
  const commonWords = new Set(['this', 'that', 'with', 'from', 'have', 'your', 'more', 'been', 'like', 'just', 'about', 'what', 'when', 'where']);
  
  return caption
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 5 && !commonWords.has(word))
    .slice(0, 10);
}

/**
 * Calculate format statistics
 */
export function calculateFormatStats(posts: PostAnalysis[]): FormatStats[] {
  const formatGroups: Record<string, PostAnalysis[]> = {};
  
  posts.forEach(post => {
    if (!formatGroups[post.format]) {
      formatGroups[post.format] = [];
    }
    formatGroups[post.format].push(post);
  });

  return Object.entries(formatGroups)
    .map(([format, formatPosts]) => {
      const totalEngagement = formatPosts.reduce((sum, p) => sum + p.engagementRate, 0);
      const avgEngagement = totalEngagement / formatPosts.length;
      const topPost = formatPosts.sort((a, b) => b.engagementRate - a.engagementRate)[0];

      return {
        format,
        count: formatPosts.length,
        percentage: (formatPosts.length / posts.length) * 100,
        avgEngagement,
        topPost
      };
    })
    .sort((a, b) => b.percentage - a.percentage);
}

/**
 * Estimate posting frequency
 */
function estimatePostingFrequency(posts: any[]): number {
  if (posts.length < 2) return 0;
  
  const sortedPosts = posts
    .filter((p: any) => p.postedAt)
    .sort((a: any, b: any) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  
  if (sortedPosts.length < 2) return 0;
  
  const newest = new Date(sortedPosts[0].postedAt);
  const oldest = new Date(sortedPosts[sortedPosts.length - 1].postedAt);
  
  const daysDiff = (newest.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24);
  const weeksDiff = daysDiff / 7;
  
  return weeksDiff > 0 ? Math.round((posts.length / weeksDiff) * 10) / 10 : 0;
}
