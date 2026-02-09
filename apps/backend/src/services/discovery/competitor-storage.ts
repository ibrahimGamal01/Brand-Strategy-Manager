import { PrismaClient, DiscoveredCompetitorStatus } from '@prisma/client';
import { AICompetitorSuggestion } from '../ai/competitor-discovery';

const prisma = new PrismaClient();

export interface Competitor {
  handle: string;
  platform: 'instagram' | 'tiktok' | 'twitter' | 'linkedin' | 'youtube';
  discoveryReason?: string;
  reasoning?: string;
  relevanceScore: number;
  competitorType?: string;
}

/**
 * Saves discovered competitors to the database
 * Uses create or update logic since there's no unique constraint
 */
export async function saveDiscoveredCompetitors(
  researchJobId: string,
  competitors: (AICompetitorSuggestion | Competitor)[],
  discoveryMethod: string
): Promise<void> {
  console.log(`[Storage] Saving ${competitors.length} competitors for job ${researchJobId.substring(0, 8)}...`);
  
  try {
    // Check existing competitors to avoid duplicates
    const existing = await prisma.discoveredCompetitor.findMany({
      where: {  researchJobId },
      select: { handle: true, platform: true }
    });
    
    const existingSet = new Set(existing.map(e => `${e.handle.toLowerCase()}:${e.platform}`));
    
    // Filter out duplicates
    const newCompetitors = competitors.filter(comp => 
      !existingSet.has(`${comp.handle.toLowerCase()}:${comp.platform}`)
    );
    
    if (newCompetitors.length === 0) {
      console.log(`[Storage] All ${competitors.length} competitors already exist, skipping`);
      return;
    }
    
    // Create new competitors
    await prisma.discoveredCompetitor.createMany({
      data: newCompetitors.map(comp => ({
        researchJobId,
        handle: comp.handle,
        platform: comp.platform,
        discoveryReason: 
          ('discoveryReason' in comp ? comp.discoveryReason : undefined) ||
          `${discoveryMethod}: ${'reasoning' in comp ? comp.reasoning : 'AI suggestion'}`,
        relevanceScore: comp.relevanceScore,
        status: DiscoveredCompetitorStatus.SUGGESTED
      }))
    });
    
    console.log(`[Storage] ✅ Successfully saved ${newCompetitors.length} new competitors`);
  } catch (error: any) {
    console.error(`[Storage] Failed to save competitors:`, error.message);
    throw error;
  }
}

/**
 * Get all discovered competitors for a research job
 */
export async function getDiscoveredCompetitors(
  researchJobId: string, 
  status?: DiscoveredCompetitorStatus
) {
  return prisma.discoveredCompetitor.findMany({
    where: {
      researchJobId,
      ...(status ? { status } : {})
    },
    orderBy: { relevanceScore: 'desc' }
  });
}

/**
 * Update competitor status (e.g., after scraping completes)
 */
export async function updateCompetitorStatus(
  competitorId: string,
  status: DiscoveredCompetitorStatus
): Promise<void> {
  await prisma.discoveredCompetitor.update({
    where: { id: competitorId },
    data: { status }
  });
}
