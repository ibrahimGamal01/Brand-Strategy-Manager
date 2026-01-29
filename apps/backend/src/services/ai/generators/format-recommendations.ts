/**
 * Format Recommendations Generator
 * 
 * Generates the "Part 7: Format Recommendations" section
 */

import { BaseGenerator, GenerationResult } from './base-generator';
import { SYSTEM_PROMPTS } from '../prompts/system-prompts';
import { ResearchContext } from '../rag';

/**
 * Generate Format Recommendations section
 */
export async function generateFormatRecommendations(
  researchJobId: string
): Promise<GenerationResult> {
  console.log(`[Format Recommendations] Starting generation for job: ${researchJobId}`);
  const generator = new FormatRecommendationsGenerator();
  return generator.generate(researchJobId);
}

/**
 * Format Recommendations Generator Class
 */
class FormatRecommendationsGenerator extends BaseGenerator {
  constructor() {
    super({
      sectionType: 'format_recommendations',
      systemPrompt: SYSTEM_PROMPTS.FORMAT_RECOMMENDATIONS,
      requiredElements: [
        'primary_format',
        'strategic_rationale',
        'pros_cons',
        'execution_details'
      ],
      wordCount: { min: 800, max: 1500 },
      model: 'gpt-4o',
      temperature: 0.7
    });
  }

  /**
   * Generate realistic mock formats for testing
   */
  protected generateMockContent(context: ResearchContext): string {
    return `# Part 7: Format Recommendations

## Primary Format: Before/After Transformation Reels

### Strategic Rationale
- **Why Recommended**: This is the top performing format across all 3 key competitors, driving average engagement of 5.2% vs industry average of 1.5%.
- **Primary Purpose**: Immediate Trust & Proof of Competence.
- **Expected Performance**: 10K+ views per reel, high save rate (reference utility).

### Pros & Cons
- **Pros**: Visually arresting, high shareability, effectively communicates "turnkey" value.
- **Cons**: Requires high-quality footage of finished projects (professional videography needed).

### Execution Details
- **Client Requirement**: Allow videographer access 1 day before handover.
- **Best For**: "Social Proof" pillar.

---

## Secondary Format: Educational "Mistake Avoidance" Carousels

### Strategic Rationale
- **Why Recommended**: Addresses the "Trust Barrier" and "Confusion" pain points. Competitor @designstudiocairo grew 20% last month using this format.
- **Primary Purpose**: Authority & Education.
- **Expected Performance**: High save rate, strong community discussion in comments.

### Pros & Cons
- **Pros**: Low production cost (graphic design only), positions brand as expert ally.
- **Cons**: Requires deep subject matter expertise inputs.

### Execution Details
- **Client Requirement**: Brief approval of technical tips.
- **Best For**: "The Problem Solver" pillar.

---

## Tertiary Format: Site Progress / Process Reels (ASMR Style)

### Strategic Rationale
- **Why Recommended**: Taps into the "Craftsmanship" archetype. Shows the "how" behind the "wow".
- **Primary Purpose**: Authenticity & Transparency.
- **Expected Performance**: Steady engagement, appeals to "The Detail-Oriented" persona (Fatma).

### Pros & Cons
- **Pros**: Can be shot on iPhone, high volume output possible.
- **Cons**: Needs consistent site visits.

### Execution Details
- **Client Requirement**: Site engineers to capture raw clips.
- **Best For**: "The Trust Builder" pillar.`;
  }
}
