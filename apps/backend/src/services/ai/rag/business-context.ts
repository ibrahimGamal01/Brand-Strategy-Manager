/**
 * Business Context Retrieval
 */

import { PrismaClient } from '@prisma/client';
import { DataQualityScore, calculateQualityScore } from './data-quality';

const prisma = new PrismaClient();

export interface BusinessContext {
  name: string;
  handle?: string;
  bio?: string;
  website?: string;
  searchResults: Array<{ title: string; body: string; url: string }>;
  aiAnalysis?: any;
  qualityScore: DataQualityScore;
}

/**
 * Get business context with quality validation
 */
export async function getBusinessContext(researchJobId: string): Promise<BusinessContext> {
  const job = await prisma.researchJob.findUnique({
    where: { id: researchJobId },
    include: {
      client: true,
      rawSearchResults: {
        take: 50,
        orderBy: { createdAt: 'desc' }
      },
      aiBusinessAnalyses: {
        take: 1,
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!job) {
    throw new Error(`Research job ${researchJobId} not found`);
  }

  const issues: string[] = [];
  const warnings: string[] = [];

  // Validate search results
  if (job.rawSearchResults.length === 0) {
    issues.push('No search results found');
  }

  // Check for duplicate URLs (scraper issue)
  const urls = job.rawSearchResults.map(r => r.href);
  const uniqueUrls = new Set(urls);
  if (urls.length !== uniqueUrls.size) {
    warnings.push(`Search results contain ${urls.length - uniqueUrls.size} duplicate URLs`);
  }

  // Validate business name
  if (!job.client.name || job.client.name.length < 2) {
    issues.push('Client name is missing or too short');
  }

  const qualityScore = calculateQualityScore(
    job.rawSearchResults,
    issues,
    warnings,
    20
  );

  return {
    name: job.client.name,
    handle: (job.inputData as any)?.handle,
    bio: (job.inputData as any)?.bio,
    website: (job.inputData as any)?.website || job.client.currentSocialPresence,
    searchResults: job.rawSearchResults.map(r => ({
      title: r.title,
      body: r.body,
      url: r.href
    })),
    aiAnalysis: job.aiBusinessAnalyses[0],
    qualityScore
  };
}
