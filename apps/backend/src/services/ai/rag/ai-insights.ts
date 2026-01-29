/**
 * AI Insights Retrieval
 */

import { PrismaClient } from '@prisma/client';
import { DataQualityScore, calculateQualityScore } from './data-quality';

const prisma = new PrismaClient();

export interface AIInsights {
  valueProposition?: string;
  targetAudience?: string;
  brandVoice?: string;
  brandPersonality?: string;
  competitorAnalysis?: string;
  nichePosition?: string;
  contentOpportunities?: string;
  painPoints?: string;
  growthStrategy?: string;
  keyDifferentiators?: string;
  contentPillars?: string;
  uniqueStrengths?: string;
  qualityScore: DataQualityScore;
}

/**
 * Get AI insights with quality validation
 */
export async function getAIInsights(researchJobId: string): Promise<AIInsights> {
  const questions = await prisma.aiQuestion.findMany({
    where: {
      researchJobId,
      isAnswered: true
    }
  });

  const issues: string[] = [];
  const warnings: string[] = [];

  if (questions.length < 12) {
    warnings.push(`Only ${questions.length}/12 AI questions answered`);
  }

  const shortAnswers = questions.filter(q => q.answer && q.answer.length < 100);
  if (shortAnswers.length > 0) {
    warnings.push(`${shortAnswers.length} AI answers are suspiciously short (< 100 chars)`);
  }

  const emptyAnswers = questions.filter(q => !q.answer || q.answer.trim().length === 0);
  if (emptyAnswers.length > 0) {
    issues.push(`${emptyAnswers.length} AI questions have no answer`);
  }

  const qualityScore = calculateQualityScore(
    questions,
    issues,
    warnings,
    12
  );

  const insights: any = { qualityScore };

  for (const q of questions) {
    const key = q.questionType.toLowerCase()
      .replace(/_./g, (m) => m.charAt(1).toUpperCase())
      .replace(/^./, (m) => m.toLowerCase());
    
    insights[key] = q.answer;
  }

  return insights as AIInsights;
}
