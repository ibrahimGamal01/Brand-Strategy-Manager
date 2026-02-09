/**
 * Competitor Context Retrieval
 */

import { PrismaClient } from '@prisma/client';
import { DataQualityScore, calculateQualityScore, detectSuspiciousData } from './data-quality';

const prisma = new PrismaClient();

export interface CompetitorData {
  handle: string;
  platform: string;
  followers?: number;
  postingFreq?: string;
  formats?: string[];
  engagement?: string;
  discoveryMethod: string;
  isPriority: boolean;
  topPosts?: any[];
  qualityScore: DataQualityScore;
}

export interface CompetitorContext {
  all10: CompetitorData[];
  priority3: CompetitorData[];
  overallQuality: DataQualityScore;
}

/**
 * Get competitor context with quality validation
 * CRITICAL: Filters out client's own social handles to prevent self-comparison
 */
export async function getCompetitorContext(researchJobId: string): Promise<CompetitorContext> {
  // Get client name to filter out client-related handles
  const researchJob = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: { client: true }
  });

  const clientName = researchJob?.client?.name?.toLowerCase() || '';
  
  // Filter function to exclude client-related handles
  const isClientHandle = (handle: string): boolean => {
    const normalizedHandle = handle.toLowerCase().replace(/[@_\s]/g, '');
    const normalizedClient = clientName.replace(/[@_\s]/g, '');
    
    // Exclude if handle contains client name or vice versa
    return normalizedHandle.includes(normalizedClient) || normalizedClient.includes(normalizedHandle);
  };

  // Get discovered competitors (all statuses - SUGGESTED, CONFIRMED, SCRAPED)
  const discoveredCompetitors = await prisma.discoveredCompetitor.findMany({
    where: { 
      researchJobId
      // Removed status filter - get all competitors to match content-intelligence behavior
    },
    orderBy: { relevanceScore: 'desc' },
    take: 20 // Limit to top 20 by relevance
  });

  // CRITICAL: Filter out client handles
  const externalCompetitors = discoveredCompetitors.filter(dc => !isClientHandle(dc.handle));

  console.log(`[Competitor Context] Found ${discoveredCompetitors.length} discovered competitors, ${externalCompetitors.length} after filtering client handles`);

  // Get social profile data for these competitors
  const competitorHandles = externalCompetitors.map(c => c.handle);
  const socialProfiles = await prisma.socialProfile.findMany({
    where: {
      researchJobId,
      handle: { in: competitorHandles }
    },
    include: {
      posts: {
        take: 50, // Increased from 10 to get more comprehensive data
        orderBy: { postedAt: 'desc' }
      }
    }
  });

  // Platform breakdown for debugging
  const platformCounts = socialProfiles.reduce((acc, p) => {
    acc[p.platform] = (acc[p.platform] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log(`[Competitor Context] Retrieved ${socialProfiles.length} social profiles:`, platformCounts);
  console.log(`[Competitor Context] Platform breakdown: Instagram=${platformCounts.instagram || 0}, TikTok=${platformCounts.tiktok || 0}`);

  const issues: string[] = [];
  const warnings: string[] = [];

  if (externalCompetitors.length < 10) {
    warnings.push(`Only ${externalCompetitors.length}/10 external competitors found`);
  }

  if (externalCompetitors.length === 0) {
    issues.push('No external competitors found - only client handles detected');
  }

  const allCompetitors: CompetitorData[] = externalCompetitors.map(dc => {
    // Find corresponding social profile for metrics
    const profile = socialProfiles.find(p => p.handle === dc.handle && p.platform === dc.platform);
    
    const postIssues: string[] = [];
    const postWarnings: string[] = []

;

    const posts = profile?.posts || [];
    
    const postQuality = calculateQualityScore(
      posts,
      postIssues,
      postWarnings,
      5 // expected minimum posts
    );

    // Calculate posting frequency from actual post dates (not profile creation date)
    let postingFreq = 'Unknown';
    if (posts.length >= 3) {
      // Sort posts by date to find date range
      const sortedPosts = [...posts].sort((a, b) => {
        const dateA = a.postedAt ? new Date(a.postedAt).getTime() : 0;
        const dateB = b.postedAt ? new Date(b.postedAt).getTime() : 0;
        return dateB - dateA; // newest first
      });
      
      const oldestDate = sortedPosts[sortedPosts.length - 1].postedAt;
      const newestDate = sortedPosts[0].postedAt;
      
      if (oldestDate && newestDate) {
        const oldestPost = new Date(oldestDate);
        const newestPost = new Date(newestDate);
        const daysBetween = Math.max(1, (newestPost.getTime() - oldestPost.getTime()) / (24 * 60 * 60 * 1000));
        const postsPerWeek = (posts.length / daysBetween) * 7;
        
        // Round to 1 decimal place for cleaner display
        postingFreq = `${Math.round(postsPerWeek * 10) / 10}/week`;
      }
    } else if (posts.length > 0) {
      postingFreq = 'Insufficient data';
    }

    // Calculate engagement from posts
    let engagement = 'Unknown';
    if (posts.length > 0) {
      const postsWithEngagement = posts.filter(p => {
        const metadata = p.metadata as any;
        return metadata?.engagement_rate != null;
      });
      
      if (postsWithEngagement.length > 0) {
        const avgEngagement = postsWithEngagement.reduce((sum, p) => {
          return sum + ((p.metadata as any)?.engagement_rate || 0);
        }, 0) / postsWithEngagement.length;
        engagement = `${(avgEngagement * 100).toFixed(1)}%`;
      }
    }

    return {
      handle: dc.handle,
      platform: dc.platform,
      followers: profile?.followers || undefined,
      postingFreq,
      formats: undefined, // TODO: derive from post metadata
      engagement,
      discoveryMethod: dc.discoveryReason || 'unknown',
      isPriority: dc.relevanceScore ? dc.relevanceScore >= 0.7 : false, // High relevance = priority
      topPosts: posts.map(p => ({
        content: p.caption || '', // Use caption field
        metadata: p.metadata,
        postedAt: p.postedAt
      })),
      qualityScore: postQuality
    };
  });

  // Priority competitors: top 3 by relevance score
  const priority3 = allCompetitors
    .filter(c => c.isPriority)
    .slice(0, 3);
  
  if (priority3.length < 3 && allCompetitors.length >= 3) {
    // If not enough high-priority, take top 3 anyway
    priority3.push(...allCompetitors.filter(c => !c.isPriority).slice(0, 3 - priority3.length));
  }

  if (priority3.length < 3) {
    warnings.push(`Only ${priority3.length}/3 priority competitors available`);
  }

  const overallQuality = calculateQualityScore(
    externalCompetitors,
    issues,
    warnings,
    10
  );

  return {
    all10: allCompetitors.slice(0, 10),
    priority3: priority3.slice(0, 3),
    overallQuality
  };
}
