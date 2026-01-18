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
    const { stdout: interestOut } = await execAsync(interestCmd);
    const interestData = JSON.parse(interestOut);
    
    if (interestData.error) {
      console.error(`[SearchTrends] Interest API error: ${interestData.error}`);
      return;
    }
    
    // 2. Fetch Related Queries
    const relatedCmd = `python3 ${scriptPath} related_queries "${uniqueKeywords.join('" "')}"`;
    const { stdout: relatedOut } = await execAsync(relatedCmd);
    const relatedData = JSON.parse(relatedOut);

    if (relatedData.error) {
      console.error(`[SearchTrends] Related API error: ${relatedData.error}`);
      return;
    }
    
    // 3. Save to DB
    for (const keyword of uniqueKeywords) {
      // Extract specific data for this keyword
      // Interest data structure depends on pytrends output, assuming simple mapping here
      // Real pytrends output usually has keyword as key or column
      
      // Filter interest data for this keyword
      // The script returns { date: { keyword: value, ... }, ... }
      // We want to transform it to { date: value } for this keyword
      const keywordInterest: Record<string, number> = {};
      for (const [date, values] of Object.entries(interestData)) {
        if (values && typeof values === 'object' && keyword in (values as any)) {
          keywordInterest[date] = (values as any)[keyword];
        }
      }
      
      const keywordRelated = relatedData[keyword] || {};
      
      await prisma.searchTrend.create({
        data: {
          researchJobId,
          keyword,
          region: 'US', // Default
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
