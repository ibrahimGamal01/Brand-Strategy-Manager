/**
 * Content Pillars Generator
 * 
 * Generates the "Part 6: Strategic Content Pillars" section
 */

import { BaseGenerator, GenerationResult } from './base-generator';
import { SYSTEM_PROMPTS } from '../prompts/system-prompts';
import { ResearchContext } from '../rag';

/**
 * Generate Content Pillars section
 */
export async function generateContentPillars(
  researchJobId: string
): Promise<GenerationResult> {
  console.log(`[Content Pillars] Starting generation for job: ${researchJobId}`);
  const generator = new ContentPillarsGenerator();
  return generator.generate(researchJobId);
}

/**
 * Content Pillars Generator Class
 */
class ContentPillarsGenerator extends BaseGenerator {
  constructor() {
    super({
      sectionType: 'content_pillars',
      systemPrompt: SYSTEM_PROMPTS.CONTENT_PILLARS,
      requiredElements: [
        'strategic_foundation',
        'purpose',
        'why_it_matters',
        'target_persona',
        'execution',
        'competitor_validation'
      ],
      wordCount: { min: 800, max: 1500 },
      temperature: 0.7
    });
  }

  /**
   * Generate realistic mock pillars for testing
   */
  protected generateMockContent(context: ResearchContext): string {
    return `# Part 6: Strategic Content Pillars

## Pillar 1: The Trust Builder (Process Transparency)

### Strategic Foundation
- **Purpose**: Demystify the design-build process to eliminate fear of the unknown.
- **Why It Matters**: Addresses the #1 pain point of "Coordination Nightmare" and "Timeline Uncertainty". Shows competence rather than just claiming it.
- **Target Persona**: Ahmed (Ambitious Villa Owner) who fears losing control.

### Execution
- **Example Hooks**:
  - "Why 90% of villa renovations go over budget (and how we stop it)"
  - "Watch us transform this shell into a luxury home in 60 seconds"
- **Competitor Validation**: @designstudiocairo's top performing reel (12K views) was a time-lapse of a reception finishing. We take this further by adding voiceover explanation.
- **Emotional Connection**: Reassurance, safety, professional competence.

---

## Pillar 2: The Taste Maker (Curated Luxury)

### Strategic Foundation
- **Purpose**: Establish authority in "Modern Luxury" aesthetics.
- **Why It Matters**: Validates the "Instagram-worthy" goal of Fatma and the ROI goal of Khaled.
- **Target Persona**: Fatma (Restaurant Owner) and Karim (Investor).

### Execution
- **Example Hooks**:
  - "3 details that make a room look expensive"
  - "Stop using this material if you want a premium look"
- **Competitor Validation**: @modernegypt gets 5% engagement on "Material Board" carousels.
- **Emotional Connection**: Aspiration, pride, belonging to the elite.

---

## Pillar 3: The Problem Solver (Education)

### Strategic Foundation
- **Purpose**: Position Ghowiba as the technical expert, not just a decorator.
- **Why It Matters**: Differentiates from "beautification" firms. Solves "Expectation-Reality" gap.
- **Target Persona**: Karim (Investor) who cares about technical specs and longevity.

### Execution
- **Example Hooks**:
  - "The hidden cost of cheap plumbing"
  - "Why we refuse to work without a MEP plan"
- **Competitor Validation**: High engagement on competitor posts discussing technical mistakes.
- **Emotional Connection**: Smart, savvy, protected.

---

## Pillar 4: Social Proof (Success Stories)

### Strategic Foundation
- **Purpose**: Validate claims with real human evidence.
- **Why It Matters**: Overcomes the "Trust Barrier".
- **Target Persona**: All personas.

### Execution
- **Example Hooks**:
  - "What a 5M EGP renovation actually looks like"
  - "Client Reaction: See the moment they walked in"
- **Competitor Validation**: Testimonials are industry standard but often boring. We make them story-driven.
- **Emotional Connection**: Relief, shared joy, envy.`;
  }
}
