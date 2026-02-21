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
import { existsSync } from 'fs';

const prisma = new PrismaClient();
const execAsync = promisify(exec);
const MAX_TRENDS_ERROR_SNIPPET = 3000;

function resolveGoogleTrendsScriptPath(): string {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'scripts/google_trends.py'),
    path.join(cwd, 'apps/backend/scripts/google_trends.py'),
    path.resolve(cwd, '../backend/scripts/google_trends.py'),
    path.resolve(__dirname, '../../../scripts/google_trends.py'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`google_trends.py not found. Checked: ${candidates.join(', ')}`);
}

function trimForLog(text: string, maxLength: number = MAX_TRENDS_ERROR_SNIPPET): string {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(-maxLength)} (truncated)`;
}

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
  
  let scriptPath = '';
  try {
    scriptPath = resolveGoogleTrendsScriptPath();
  } catch (error: any) {
    console.error(`[SearchTrends] ${error?.message || 'google_trends.py missing'}`);
    return;
  }
  
  try {
    // 1. Fetch Interest Over Time
    const interestCmd = `python3 ${scriptPath} interest_over_time "${uniqueKeywords.join('" "')}"`;
    console.log(`[SearchTrends] Running: ${interestCmd}`);
    const { stdout: interestOut, stderr: interestErr } = await execAsync(interestCmd);
    if (interestErr) {
      console.warn(`[SearchTrends] interest_over_time stderr: ${trimForLog(interestErr)}`);
    }
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
    const { stdout: relatedOut, stderr: relatedErr } = await execAsync(relatedCmd);
    if (relatedErr) {
      console.warn(`[SearchTrends] related_queries stderr: ${trimForLog(relatedErr)}`);
    }
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
