/**
 * Data Quality Scoring and Validation
 * 
 * Calculates quality scores for scraped data to detect potential hallucinations.
 */

export interface DataQualityScore {
  source: string;
  score: number; // 0-100
  issues: string[];
  warnings: string[];
  isReliable: boolean;
}

/**
 * Detect if scraped data looks suspicious or fabricated
 */
export function detectSuspiciousData(data: any[], dataType: string): string[] {
  const issues: string[] = [];

  // Check for identical duplicates (scraper might have looped)
  const seenValues = new Set();
  let duplicateCount = 0;
  
  for (const item of data) {
    const key = JSON.stringify(item);
    if (seenValues.has(key)) {
      duplicateCount++;
    }
    seenValues.add(key);
  }
  
  if (duplicateCount > data.length * 0.3) {
    issues.push(`${dataType}: High duplicate rate (${duplicateCount}/${data.length}) - possible scraper loop`);
  }

  // Check for unrealistic numbers
  if (dataType === 'followers') {
    for (const item of data) {
      if (item.followers && item.followers > 10000000) {
        issues.push(`${dataType}: Unrealistic follower count (${item.followers}) for handle ${item.handle}`);
      }
    }
  }

  // Check for missing critical fields
  const missingFields = data.filter(item => {
    if (dataType === 'competitor') {
      return !item.handle || !item.platform;
    }
    if (dataType === 'post') {
      return !item.externalId && !item.url;
    }
    return false;
  });

  if (missingFields.length > 0) {
    issues.push(`${dataType}: ${missingFields.length} items missing critical fields`);
  }

  return issues;
}

/**
 * Cross-reference data from multiple sources
 */
export function crossReferenceData(aiData: any, scrapedData: any[]): string[] {
  const discrepancies: string[] = [];

  if (aiData?.competitors && scrapedData) {
    const aiCompetitors = new Set(
      (aiData.competitors as string[]).map(c => c.toLowerCase().replace('@', ''))
    );
    
    const scrapedHandles = new Set(
      scrapedData.map(c => c.handle?.toLowerCase().replace('@', ''))
    );

    const onlyInAI = [...aiCompetitors].filter(c => !scrapedHandles.has(c));

    if (onlyInAI.length > 5) {
      discrepancies.push(`${onlyInAI.length} AI-suggested competitors not found in scraped data`);
    }
  }

  return discrepancies;
}

/**
 * Calculate data quality score
 */
export function calculateQualityScore(
  data: any[],
  issues: string[],
  warnings: string[],
  expectedCount?: number
): DataQualityScore {
  let score = 100;

  // Penalize for issues (critical problems)
  score -= issues.length * 15;

  // Penalize for warnings (minor problems)
  score -= warnings.length * 5;

  // Penalize if below expected count
  if (expectedCount && data.length < expectedCount) {
    const deficit = expectedCount - data.length;
    score -= (deficit / expectedCount) * 30;
    warnings.push(`Expected ${expectedCount} items, got ${data.length}`);
  }

  // Penalize for very small datasets
  if (data.length < 3 && expectedCount && expectedCount > 3) {
    score -= 20;
    issues.push(`Insufficient data: only ${data.length} items`);
  }

  score = Math.max(0, Math.min(100, score));

  return {
    source: 'calculated',
    score,
    issues,
    warnings,
    isReliable: score >= 70
  };
}
