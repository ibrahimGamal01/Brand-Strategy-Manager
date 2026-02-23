/**
 * Buyer Journey Generator
 * 
 * Generates the "Part 8: Buyer Journey Mapping" section
 */

import { BaseGenerator, GenerationResult } from './base-generator';
import { SYSTEM_PROMPTS } from '../prompts/system-prompts';
import { ResearchContext } from '../rag';

/**
 * Generate Buyer Journey section
 */
export async function generateBuyerJourney(
  researchJobId: string
): Promise<GenerationResult> {
  console.log(`[Buyer Journey] Starting generation for job: ${researchJobId}`);
  const generator = new BuyerJourneyGenerator();
  return generator.generate(researchJobId);
}

/**
 * Buyer Journey Generator Class
 */
class BuyerJourneyGenerator extends BaseGenerator {
  constructor() {
    super({
      sectionType: 'buyer_journey',
      systemPrompt: SYSTEM_PROMPTS.BUYER_JOURNEY,
      requiredElements: [
        'stage_1',
        'stage_2',
        'stage_3',
        'user_questions',
        'strategic_response'
      ],
      wordCount: { min: 800, max: 1500 },
      temperature: 0.7
    });
  }

  /**
   * Generate realistic mock journey for testing
   */
  protected generateMockContent(context: ResearchContext): string {
    return `# Part 8: Buyer Journey Mapping

## Stage 1: Awareness
**User Mindset**: "I have a problem but don't know the solution."

### User Questions
1. "Why does my apartment look so cluttered?"
2. "How much does it cost to finish a villa in New Cairo?"
3. "Is it better to hire an architect or a contractor?"

### Strategic Response
- **Goal**: Validate their pain points and introduce the "Integrated Design-Build" concept as the solution.
- **Relevant Pillars**: "The Trust Builder", "Social Proof".
- **Best Formats**: "Mistake Avoidance" Reels, Before/After photos (shock value).

---

## Stage 2: Consideration
**User Mindset**: "I know the solution types, comparing options."

### User Questions
1. "How do I know the manufacturing quality of Ghowiba?"
2. "What if the final result looks different from the 3D?"
3. "Why are they more expensive than a freelancer?"

### Strategic Response
- **Goal**: Build authority and prove the value of the premium price. Differentiate via the "Accuracy Guarantee".
- **Relevant Pillars**: "The Problem Solver", "The Taste Maker".
- **Best Formats**: Educational Carousels, Site Progress Reels, Material Close-ups.

---

## Stage 3: Decision
**User Mindset**: "I'm ready to buy, just need reassurance."

### User Questions
1. "Can I see a contract example?"
2. "What is the payment schedule?"
3. "Do they have a warranty?"

### Strategic Response
- **Goal**: Eliminate risk and objection handling.
- **Relevant Pillars**: "Social Proof", "The Trust Builder".
- **Best Formats**: Client Testimonials, Founder Q&A (Talking Head), Case Study breakdowns.`;
  }
}
