import type { DocumentParseResult } from './types';

export type ParseQuality = {
  score: number;
  needsReview: boolean;
  reasons: string[];
};

export function scoreParseQuality(result: DocumentParseResult): ParseQuality {
  const reasons: string[] = [];
  const textLength = String(result.text || '').trim().length;
  const sectionCount = result.sections.length;
  const warningCount = result.warnings.length;
  const hasTables = Array.isArray(result.tables) && result.tables.length > 0;

  let score = 0.5;
  if (textLength > 500) score += 0.22;
  else if (textLength > 150) score += 0.12;
  else reasons.push('Extracted text is very short.');

  if (sectionCount >= 3) score += 0.12;
  else if (sectionCount <= 1) reasons.push('Section structure is limited.');

  if (hasTables) score += 0.08;
  if (warningCount > 0) {
    score -= Math.min(0.22, warningCount * 0.04);
    reasons.push(`${warningCount} parser warning(s) detected.`);
  }

  if (result.needsReview) {
    score -= 0.2;
    reasons.push('Parser flagged this document for manual review.');
  }

  const normalizedScore = Math.max(0, Math.min(1, Number(score.toFixed(3))));
  const needsReview = normalizedScore < 0.62 || result.needsReview === true;

  if (needsReview && reasons.length === 0) {
    reasons.push('Parse confidence below threshold.');
  }

  return {
    score: normalizedScore,
    needsReview,
    reasons,
  };
}
