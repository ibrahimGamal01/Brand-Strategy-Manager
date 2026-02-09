/**
 * Target Audience Generator (Personas)
 * 
 * Generates 2-4 detailed personas using JTBD framework
 */

import { GenerationResult } from '../base-generator';
import { TargetAudienceGenerator } from './generator';

/**
 * Generate Target Audience section with personas
 */
export async function generateTargetAudience(
  researchJobId: string
): Promise<GenerationResult> {
  
  console.log(`[Target Audience] Starting generation for job: ${researchJobId}`);

  const generator = new TargetAudienceGenerator();
  return generator.generate(researchJobId);
}
