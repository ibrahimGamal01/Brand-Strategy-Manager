import { BaseGenerator } from '../base-generator';
import { SYSTEM_PROMPTS } from '../../prompts/system-prompts';
import { ResearchContext } from '../../rag';
import { MOCK_PRIORITY_COMPETITOR } from './mock';

/**
 * Priority Competitor Generator Class
 */
export class PriorityCompetitorGenerator extends BaseGenerator {
  constructor() {
    super({
      sectionType: 'priority_competitor',
      systemPrompt: SYSTEM_PROMPTS.PRIORITY_COMPETITOR,
      requiredElements: [
        'competitor_profiles',
        'content_strategy',
        'content_pillars',
        'top_posts',
        'strengths_weaknesses',
        'blue_ocean_eliminate',
        'blue_ocean_reduce',
        'blue_ocean_raise',
        'blue_ocean_create',
        'competitive_gaps'
      ],
      wordCount: { min: 2500, max: 4000 },
      model: 'gpt-4o',
      temperature: 0.7,
      maxAttempts: 3
    });
  }

  protected generateMockContent(context: ResearchContext): string {
    return MOCK_PRIORITY_COMPETITOR;
  }
}
