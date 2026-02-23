import { BaseGenerator } from '../base-generator';
import { SYSTEM_PROMPTS } from '../../prompts/system-prompts';
import { ResearchContext } from '../../rag';
import { MOCK_TARGET_AUDIENCE } from './mock';

/**
 * Target Audience Generator Class
 */
export class TargetAudienceGenerator extends BaseGenerator {
  constructor() {
    super({
      sectionType: 'target_audience',
      systemPrompt: SYSTEM_PROMPTS.TARGET_AUDIENCE,
      requiredElements: [
        'personas',
        'demographics',
        'jtbd_framework',
        'pain_points',
        'goals',
        'fears',
        'motivators',
        'blockers',
        'content_preferences'
      ],
      wordCount: { min: 1500, max: 2500 },
      temperature: 0.7
    });
  }

  /**
   * Generate mock personas for testing
   */
  protected generateMockContent(context: ResearchContext): string {
    return MOCK_TARGET_AUDIENCE;
  }
}
