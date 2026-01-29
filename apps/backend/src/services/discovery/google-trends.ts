/**
 * Google Trends Service
 * 
 * Interfaces with google_trends.py to fetch macro market data.
 * Saves results to SearchTrend model.
 */

import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const prisma = new PrismaClient();
const execAsync = promisify(exec);

export interface SearchTrendResult {
  keyword: string;
  interestOverTime: Record<string, any>;
  relatedQueries: {
    top: Array<{ query: string; value: number }>;
    rising: Array<{ query: string; value: number }>;
  };
}

/**
 * Fetch and save search trends for a list of keywords
 */
export async function analyzeSearchTrends(
  researchJobId: string,
  keywords: string[]
): Promise<void> {
  if (!keywords || keywords.length === 0) return;
  
  // Dedup and limit
  const uniqueKeywords = Array.from(new Set(keywords.map(k => k.trim()))).slice(0, 5);
  console.log(`[SearchTrends] Analyzing: ${uniqueKeywords.join(', ')}`);
  
  const scriptPath = path.join(process.cwd(), 'scripts/google_trends.py');
  
  try {
    // 1. Fetch Interest Over Time
    const interestCmd = `python3 ${scriptPath} interest_over_time "${uniqueKeywords.join('" "')}"`;
    console.log(`[SearchTrends] Running: ${interestCmd}`);
    const { stdout: interestOut } = await execAsync(interestCmd);
    const interestResponse = JSON.parse(interestOut);
    
    if (interestResponse.error) {
      console.error(`[SearchTrends] Interest API error: ${interestResponse.error}`);
      // Save empty data so we know we tried
      for (const keyword of uniqueKeywords) {
        await prisma.searchTrend.create({
          data: {
            researchJobId,
            keyword,
            region: 'US',
            timeframe: 'today 12-m',
            interestOverTime: {},
            relatedQueries: {},
          },
        });
      }
      return;
    }
    
    // Extract data (Python returns {data: ..., keywords: ...})
    const interestData = interestResponse.data || {};
    
    // 2. Fetch Related Queries
    const relatedCmd = `python3 ${scriptPath} related_queries "${uniqueKeywords.join('" "')}"`;
    console.log(`[SearchTrends] Running: ${relatedCmd}`);
    const { stdout: relatedOut } = await execAsync(relatedCmd);
    const relatedResponse = JSON.parse(relatedOut);

    if (relatedResponse.error) {
      console.error(`[SearchTrends] Related API error: ${relatedResponse.error}`);
      // Save with empty related queries
      for (const keyword of uniqueKeywords) {
        const keywordInterest: Record<string, number> = {};
        for (const [date, values] of Object.entries(interestData)) {
          if (values && typeof values === 'object' && keyword in (values as any)) {
            keywordInterest[date] = (values as any)[keyword];
          }
        }
        
        await prisma.searchTrend.create({
          data: {
            researchJobId,
            keyword,
            region: 'US',
            timeframe: 'today 12-m',
            interestOverTime: keywordInterest,
            relatedQueries: {},
          },
        });
      }
      return;
    }
    
    // Extract data (Python returns {data: {keyword: {...}}, keywords: ...})
    const relatedData = relatedResponse.data || {};
    
    // 3. Save to DB
    for (const keyword of uniqueKeywords) {
      // Extract interest data for this keyword
      // interestData structure: { "2025-01-01T00:00:00": { "keyword1": 50, "keyword2": 30 }, ... }
      const keywordInterest: Record<string, number> = {};
      for (const [date, values] of Object.entries(interestData)) {
        if (values && typeof values === 'object' && keyword in (values as any)) {
          keywordInterest[date] = (values as any)[keyword];
        }
      }
      
      // Extract related queries for this keyword
      const keywordRelated = relatedData[keyword] || { top: [], rising: [] };
      
      await prisma.searchTrend.create({
        data: {
          researchJobId,
          keyword,
          region: 'US',
          timeframe: 'today 12-m',
          interestOverTime: keywordInterest,
          relatedQueries: keywordRelated,
        },
      });
      
      console.log(`[SearchTrends] Saved trends for "${keyword}"`);
    }
    
  } catch (error: any) {
    console.error(`[SearchTrends] Failed to analyze trends: ${error.message}`);
    // Don't throw, just log - this is additive data
  }
}
