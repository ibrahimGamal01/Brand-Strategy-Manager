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
 */
export async function getCompetitorContext(researchJobId: string): Promise<CompetitorContext> {
  const competitors = await prisma.competitor.findMany({
    where: { 
      client: {
        researchJobs: {
          some: { id: researchJobId }
        }
      }
    },
    include: {
      rawPosts: {
        include: {
          cleanedPost: {
            include: {
              aiAnalyses: true
            }
          }
        },
        take: 10,
        orderBy: { scrapedAt: 'desc' }
      }
    }
  });

  const issues: string[] = [];
  const warnings: string[] = [];

  if (competitors.length < 10) {
    warnings.push(`Only ${competitors.length}/10 competitors found`);
  }

  const suspiciousIssues = detectSuspiciousData(competitors, 'competitor');
  issues.push(...suspiciousIssues);

  const noHandle = competitors.filter(c => !c.handle);
  if (noHandle.length > 0) {
    issues.push(`${noHandle.length} competitors missing handle`);
  }

  const unrealistic = competitors.filter(c => 
    c.followerCount && (c.followerCount > 50000000 || c.followerCount < 0)
  );
  if (unrealistic.length > 0) {
    warnings.push(`${unrealistic.length} competitors have suspicious follower counts`);
  }

  const allCompetitors: CompetitorData[] = competitors.map(c => {
    const postIssues: string[] = [];
    const postWarnings: string[] = [];

    if (c.isPriority && c.rawPosts.length === 0) {
      postIssues.push('Priority competitor has no posts');
    }

    const postQuality = calculateQualityScore(
      c.rawPosts,
      postIssues,
      postWarnings,
      c.isPriority ? 10 : 0
    );

    return {
      handle: c.handle,
      platform: c.platform,
      followers: c.followerCount || undefined,
      postingFreq: c.postingFrequency || undefined,
      formats: c.mostUsedFormats as string[] || undefined,
      engagement: c.engagementLevel || undefined,
      discoveryMethod: 'database',
      isPriority: c.isPriority,
      topPosts: c.rawPosts.map(p => p.cleanedPost).filter(Boolean),
      qualityScore: postQuality
    };
  });

  const priority3 = allCompetitors.filter(c => c.isPriority).slice(0, 3);
  
  if (priority3.length < 3) {
    issues.push(`Only ${priority3.length}/3 priority competitors available`);
  }

  const overallQuality = calculateQualityScore(
    competitors,
    issues,
    warnings,
    10
  );

  return {
    all10: allCompetitors.slice(0, 10),
    priority3,
    overallQuality
  };
}
