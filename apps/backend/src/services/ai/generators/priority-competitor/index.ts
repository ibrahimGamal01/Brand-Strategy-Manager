/**
 * Priority Competitor Generator
 * 
 * Deep analysis of 3 priority competitors with Blue Ocean synthesis
 */

import { GenerationResult } from '../base-generator';
import { PriorityCompetitorGenerator } from './generator';

/**
 * Generate Priority Competitor Analysis section
 */
export async function generatePriorityCompetitor(
  researchJobId: string
): Promise<GenerationResult> {
  
  console.log(`[Priority Competitor] Starting generation for job: ${researchJobId}`);

  const generator = new PriorityCompetitorGenerator();
  return generator.generate(researchJobId);
}
