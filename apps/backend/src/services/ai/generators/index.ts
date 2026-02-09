/**
 * Main Generator Orchestrator
 * 
 * Coordinates all 5 template generators
 */

import { generateBusinessUnderstanding } from './business-understanding';
import { generateTargetAudience } from './target-audience';
import { generateIndustryOverview } from './industry-overview';
import { generatePriorityCompetitor } from './priority-competitor';
import { generateContentAnalysis } from './content-analysis';
import { generateContentPillars } from './content-pillars';
import { generateFormatRecommendations } from './format-recommendations';
import { generateBuyerJourney } from './buyer-journey';
import { generatePlatformStrategy } from './platform-strategy';
import { GenerationResult } from './base-generator';
import { addSectionTransitions } from './section-connector';
import { validateDocument } from './document-validator';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface StrategyDocumentResult {
  researchJobId: string;
  sections: {
    businessUnderstanding?: GenerationResult;
    targetAudience?: GenerationResult;
    industryOverview?: GenerationResult;
    priorityCompetitor?: GenerationResult;
    contentAnalysis?: GenerationResult;
    contentPillars?: GenerationResult;
    formatRecommendations?: GenerationResult;
    buyerJourney?: GenerationResult;
    platformStrategy?: GenerationResult;
  };
  overallScore: number;
  totalCost: number;
  generationTime: number;
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
}

/**
 * Generate all sections of the brand strategy document
 */
export async function generateStrategyDocument(
  researchJobId: string,
  sections: string[] = ['all']
): Promise<StrategyDocumentResult> {
  
  console.log(`[Orchestrator] Starting strategy document generation`);
  console.log(`[Orchestrator] Research Job: ${researchJobId}`);
  console.log(`[Orchestrator] Sections: ${sections.join(', ')}\n`);

  const startTime = Date.now();
  const result: StrategyDocumentResult = {
    researchJobId,
    sections: {} as any,
    overallScore: 0,
    totalCost: 0,
    generationTime: 0,
    status: 'PARTIAL'
  };

  const shouldGenerate = (section: string) =>
    sections.includes('all') || sections.includes(section);

  try {
    // Generate Business Understanding
    if (shouldGenerate('businessUnderstanding')) {
      console.log('[Orchestrator] Generating Business Understanding...\n');
      result.sections.businessUnderstanding = await generateBusinessUnderstanding(researchJobId);
    }

    // Generate Target Audience
    if (shouldGenerate('targetAudience')) {
      console.log('[Orchestrator] Generating Target Audience...\n');
      result.sections.targetAudience = await generateTargetAudience(researchJobId);
    }

    // Generate Industry Overview
    if (shouldGenerate('industryOverview')) {
      console.log('[Orchestrator] Generating Industry Overview...\n');
      result.sections.industryOverview = await generateIndustryOverview(researchJobId);
    }

    // Generate Priority Competitor
    if (shouldGenerate('priorityCompetitor')) {
      console.log('[Orchestrator] Generating Priority Competitor Analysis...\n');
      result.sections.priorityCompetitor = await generatePriorityCompetitor(researchJobId);
    }

    // Generate Content Analysis
    if (shouldGenerate('contentAnalysis')) {
      console.log('[Orchestrator] Generating Content Analysis...\n');
      result.sections.contentAnalysis = await generateContentAnalysis(researchJobId);
    }

    // Generate Content Pillars
    if (shouldGenerate('contentPillars')) {
      console.log('[Orchestrator] Generating Content Pillars...\n');
      result.sections.contentPillars = await generateContentPillars(researchJobId);
    }

    // Generate Format Recommendations
    if (shouldGenerate('formatRecommendations')) {
      console.log('[Orchestrator] Generating Format Recommendations...\n');
      result.sections.formatRecommendations = await generateFormatRecommendations(researchJobId);
    }

    // Generate Buyer Journey
    if (shouldGenerate('buyerJourney')) {
      console.log('[Orchestrator] Generating Buyer Journey...\n');
      result.sections.buyerJourney = await generateBuyerJourney(researchJobId);
    }

    // Generate Platform Strategy
    if (shouldGenerate('platformStrategy')) {
      console.log('[Orchestrator] Generating Platform Strategy...\n');
      result.sections.platformStrategy = await generatePlatformStrategy(researchJobId);
    }

    // Extract markdown from each section for transition processing
    const sectionMarkdown: Record<string, string> = {};
    Object.entries(result.sections).forEach(([key, value]) => {
      if (value && value.markdown) {
        sectionMarkdown[key] = value.markdown;
      }
    });

    // Add smooth transitions between sections
    const connectedSections = addSectionTransitions(sectionMarkdown);

    // Update sections with connected markdown
    Object.entries(connectedSections).forEach(([key, markdown]) => {
      if (result.sections[key as keyof typeof result.sections]) {
        result.sections[key as keyof typeof result.sections]!.markdown = markdown;
      }
    });

    // Calculate overall metrics
    const completedSections = Object.values(result.sections).filter(Boolean);
    const totalScore = completedSections.reduce((sum, s) => sum + s.validationScore, 0);
    const totalCost = completedSections.reduce((sum, s) => sum + s.costUSD, 0);

    result.overallScore = completedSections.length > 0 ? totalScore / completedSections.length : 0;
    result.totalCost = totalCost;
    result.generationTime = (Date.now() - startTime) / 1000;
    result.status = completedSections.length >= 9 ? 'COMPLETE' : 'PARTIAL';

    console.log('\n[Orchestrator] Generation Complete');
    console.log(`  Sections: ${completedSections.length}/9`);
    console.log(`  Overall Score: ${result.overallScore.toFixed(1)}/100`);
    console.log(`  Total Cost: $${result.totalCost.toFixed(4)}`);
    console.log(`  Time: ${result.generationTime.toFixed(1)}s\n`);

    // Run 2-pass validation
    console.log('[Orchestrator] Running 2-pass document validation...');
    const validationResult = await validateDocument(researchJobId, result.sections, 80);
    
    if (!validationResult.passed) {
      console.error(`[Orchestrator] ⚠️  VALIDATION FAILED`);
      console.error(`  Critical Issues: ${validationResult.issues.filter(i => i.severity === 'CRITICAL').length}`);
      console.error(`  High Issues: ${validationResult.issues.filter(i => i.severity === 'HIGH').length}`);
      console.error(`  Quality Score: ${validationResult.overallScore.toFixed(1)}/100 (min: 80)`);
      
      // Log top 3 issues for debugging
      validationResult.issues.slice(0, 3).forEach((issue, i) => {
        console.error(`  ${i+1}. [${issue.severity}] ${issue.section}: ${issue.issue}`);
      });
      
      // Store validation results but don't block return
      result.status = 'PARTIAL'; // Downgrade status
    } else {
      console.log('[Orchestrator] ✅ Validation PASSED - Document is client-ready');
    }

    return result;

  } catch (error) {
    console.error('[Orchestrator] Error:', error);
    result.status = 'FAILED';
    throw error;
  }
}

/**
 * Save generated document to database
 */
export async function saveStrategyDocument(result: StrategyDocumentResult): Promise<string> {
  console.log('[Orchestrator] Saving to database...');

  // TODO: Implement database save
  // This will be implemented when we add the StrategyDocument model to Prisma schema

  console.log('[Orchestrator] Database save not yet implemented');
  return 'pending';
}
