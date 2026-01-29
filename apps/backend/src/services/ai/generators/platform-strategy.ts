/**
 * Platform Strategy Generator
 * 
 * Generates the "Part 9: Platform Strategy" section
 */

import { BaseGenerator, GenerationResult } from './base-generator';
import { SYSTEM_PROMPTS } from '../prompts/system-prompts';
import { ResearchContext } from '../rag';

/**
 * Generate Platform Strategy section
 */
export async function generatePlatformStrategy(
  researchJobId: string
): Promise<GenerationResult> {
  console.log(`[Platform Strategy] Starting generation for job: ${researchJobId}`);
  const generator = new PlatformStrategyGenerator();
  return generator.generate(researchJobId);
}

/**
 * Platform Strategy Generator Class
 */
class PlatformStrategyGenerator extends BaseGenerator {
  constructor() {
    super({
      sectionType: 'platform_strategy',
      systemPrompt: SYSTEM_PROMPTS.PLATFORM_STRATEGY,
      requiredElements: [
        'primary_platform',
        'secondary_platform',
        'strategy',
        'kpis'
      ],
      wordCount: { min: 800, max: 1500 },
      model: 'gpt-4o',
      temperature: 0.7
    });
  }

  /**
   * Generate realistic mock platform strategy
   */
  protected generateMockContent(context: ResearchContext): string {
    return `# Part 9: Platform Strategy

## Primary Platform: Instagram

### Strategy
- **Why this platform**: Competitors see 3x engagement here vs Facebook. It is the visual home for the target personas (Ahmed & Fatma) and supports the key formats (Reels & Carousels).
- **Role**: The "Brand Home". The primary portfolio and trust-building channel.
- **Focus Content**: High-aesthetic carousels (Portfolio), Educational Reels (Tips), Stories (Daily updates).
- **Posting Frequency**: 3-4 High-Quality posts per week. Daily Stories.

### KPIs to Watch
- Engagement Rate (Aim for >3%)
- Saves (Indicates reference value)
- DM Inquiries (Lead qualification)

---

## Secondary Platform: LinkedIn

### Strategy
- **Why this platform**: To reach the "Khaled" (Developer) persona and B2B partners.
- **Role**: Corporate Authority & Partnership Channel.
- **Repost Strategy**: Repurpose success stories as "Case Studies" with ROI focus. Share industry news and company milestones.

### KPIs to Watch
- Connection Requests from developers
- Reposts/Shares by industry peers`;
  }
}
