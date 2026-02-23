/**
 * Generator Base Class
 * 
 * Common functionality for all template generators
 */

import { openai, OpenAI } from '../openai-client';
import { getFullResearchContext, ResearchContext, formatContextForLLM } from '../rag';
import { validateContent } from '../validation';
import { ValidationResult } from '../types/templates';
import { COST_PROTECTION, costTracker, checkCostLimit } from '../validation/cost-protection';
import { detectIndustry, applyIndustryModifier, IndustryContext } from '../prompts/industry-modifiers';
import { postProcessContent } from './post-processor';
import { resolveModelForTask } from '../model-router';

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface GeneratorConfig {
  sectionType: string;
  systemPrompt: string;
  requiredElements: string[];
  wordCount: { min: number; max: number };
  maxAttempts?: number;
  model?: string;
  temperature?: number;
}

export interface GenerationResult {
  markdown: string;
  validationScore: number;
  passed: boolean;
  attempts: number;
  warnings: string[];
  costUSD: number;
}

interface GenerationAttempt {
  attemptNumber: number;
  markdown: string;
  validation: ValidationResult;
}

export class BaseGenerator {
  protected config: GeneratorConfig;
  protected maxAttempts: number;
  protected model: string;
  protected temperature: number;

  constructor(config: GeneratorConfig) {
    this.config = config;
    this.maxAttempts = config.maxAttempts || 3;
    this.model = resolveModelForTask('content_generation', config.model);
    this.temperature = config.temperature || 0.7;
  }

  /**
   * Main generation method with validation loop
   */
  async generate(researchJobId: string): Promise<GenerationResult> {
    console.log(`[${this.config.sectionType}] Starting generation for job: ${researchJobId}`);

    // Check cost limits
    const costCheck = checkCostLimit();
    if (!costCheck.allowed) {
      throw new Error(`Cost limit reached: ${costCheck.reason}`);
    }

    // Get context
    console.log(`[${this.config.sectionType}] Retrieving research context...`);
    const context = await getFullResearchContext(researchJobId);

    // Detect industry for context-aware prompts
    const industry = detectIndustry(context.business);
    console.log(`[${this.config.sectionType}] Detected industry: ${industry.industry} (${industry.businessModel})`);

    if (!context.overallQuality.isReliable) {
      console.warn(`[${this.config.sectionType}] Data quality: ${context.overallQuality.score}/100`);
    }

    const contextString = formatContextForLLM(context);
    const initialCost = costTracker.getStats().estimatedCostUSD;

    // Generation loop
    const attempts: GenerationAttempt[] = [];
    
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      console.log(`[${this.config.sectionType}] Attempt ${attempt}/${this.maxAttempts}`);

      try {
        // Generate with industry-aware prompts
        const markdown = await this.callOpenAI(
          contextString,
          context,
          industry,
          attempt > 1 ? attempts[attempt - 2] : undefined
        );

        // Validate
        const validation = await validateContent(
          markdown,
          this.config.sectionType,
          this.config.requiredElements,
          this.config.wordCount,
          context
        );

        attempts.push({ attemptNumber: attempt, markdown, validation });

        console.log(`[${this.config.sectionType}] Score: ${validation.score}/100`);

        if (validation.passed) {
          console.log(`[${this.config.sectionType}] ✓ Passed validation`);
          
          // Apply post-processing to clean up contradictions and validate headers
          const { cleaned, issues } = postProcessContent(markdown);
          
          if (issues.length > 0) {
            console.warn(`[${this.config.sectionType}] Header validation issues:`, issues);
          }
          
          // NEW: Fact-checking validation against database
          console.log(`[${this.config.sectionType}] Running fact-checker...`);
          const { factCheck } = await import('../validation/fact-checker');
          const factCheckResult = await factCheck(cleaned, researchJobId);
          
          const criticalInaccuracies = factCheckResult.inaccuracies.filter(
            i => i.severity === 'CRITICAL' || i.severity === 'HIGH'
          );
          
          if (criticalInaccuracies.length > 0) {
            console.warn(`[${this.config.sectionType}] ⚠️ Found ${criticalInaccuracies.length} critical inaccuracies`);
            criticalInaccuracies.slice(0, 3).forEach((inaccuracy, i) => {
              console.warn(`  ${i+1}. [${inaccuracy.severity}] ${inaccuracy.issue}`);
            });
            
            // Auto-correct if we have suggested fixes
            const { sanitizeContent } = await import('../validation/fact-checker');
            const corrected = sanitizeContent(cleaned, factCheckResult.inaccuracies);
            
            console.log(`[${this.config.sectionType}] Auto-corrected critical inaccuracies`);
            
            const finalCost = costTracker.getStats().estimatedCostUSD;
            
            return {
              markdown: corrected,
              validationScore: validation.score,
              passed: true,
              attempts: attempt,
              warnings: [
                ...context.warnings,
                ...issues,
                `Auto-corrected ${criticalInaccuracies.length} inaccuracies in generated content`
              ],
              costUSD: finalCost - initialCost
            };
          } else {
            console.log(`[${this.config.sectionType}] ✓ Passed fact-checking (${factCheckResult.verifiedClaims}/${factCheckResult.totalClaims} claims verified)`);
          }
          
          const finalCost = costTracker.getStats().estimatedCostUSD;
          
          return {
            markdown: cleaned,
            validationScore: validation.score,
            passed: true,
            attempts: attempt,
            warnings: [...context.warnings, ...issues],
            costUSD: finalCost - initialCost
          };
        }

        if (attempt === this.maxAttempts) {
          return this.handleMaxAttemptsReached(attempts, context.warnings, initialCost);
        }

      } catch (error) {
        console.error(`[${this.config.sectionType}] Error:`, error);
        if (attempt === this.maxAttempts) {
          throw error;
        }
      }
    }

    throw new Error('Generation failed unexpectedly');
  }

  /**
   * Call OpenAI API with industry-aware prompts
   */
  protected async callOpenAI(
    contextString: string,
    context: ResearchContext,
    industry: IndustryContext,
    previousAttempt?: GenerationAttempt
  ): Promise<string> {
    
    // Mock mode for testing
    if (COST_PROTECTION.mockMode) {
      console.log(`[${this.config.sectionType}] Using MOCK mode (cost: $0)`);
      return this.generateMockContent(context);
    }

    // Apply industry-specific modifications to system prompt
    const industryAwarePrompt = applyIndustryModifier(
      this.config.systemPrompt,
      industry,
      this.config.sectionType
    );

    const globalPrefix =
      'Never write "Not available in data", "not found in research", or similar disclaimers. ' +
      'If a metric is unknown, omit it or use "—". ' +
      'Never output placeholders (e.g., [Competitor], [Handle], @competitor1) or invented handles. ' +
      'Use only real handles present in VERIFIED COMPETITOR DATA.\n\n';
    const sectionFocusPrefix =
      this.config.sectionType === 'content_analysis' || this.config.sectionType === 'format_recommendations'
        ? 'Prioritize the "Content Intelligence" and "Media Creative Analysis" sections below when making recommendations. Cite specific opportunities, gaps, and creative insights. Verify engagement percentages are plausible (0.1%–15% typical); never use values > 100%.\n\n'
        : '';

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: industryAwarePrompt }
    ];

    // First attempt
    if (!previousAttempt) {
      messages.push({
        role: 'user',
        content: `${globalPrefix}${sectionFocusPrefix}Generate the ${this.config.sectionType} section using this research:\n\n${contextString}`
      });
    }
    // Retry with feedback
    else {
      messages.push({
        role: 'user',
        content: `${globalPrefix}${sectionFocusPrefix}Generate the ${this.config.sectionType} section:\n\n${contextString}`
      });
      messages.push({
        role: 'assistant',
        content: previousAttempt.markdown
      });
      
      const feedback = previousAttempt.validation.feedback.improvements
        .slice(0, 5)
        .map(i => `- ${i.issue}: ${i.suggestion}`)
        .join('\n');
      
      messages.push({
        role: 'user',
        content: `Previous score: ${previousAttempt.validation.score}/100\n\nImprovements needed:\n${feedback}\n\nRegenerate with these fixes.`
      });
    }

    const response = await openai.chat.completions.create({
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.config.sectionType === 'target_audience' 
        ? Math.min(6000, COST_PROTECTION.maxTokensPerCall * 1.5)  // Higher limit for personas to prevent cutoff
        : Math.min(4000, COST_PROTECTION.maxTokensPerCall)
    });

    // Track costs
    if (response.usage) {
      costTracker.addUsage(
        this.model,
        response.usage.prompt_tokens,
        response.usage.completion_tokens
      );
    }

    return (response.choices[0] as any).message?.content || '';
  }

  /**
   * Handle max attempts reached - use best attempt
   */
  protected handleMaxAttemptsReached(
    attempts: GenerationAttempt[],
    contextWarnings: string[],
    initialCost: number
  ): GenerationResult {
    console.warn(`[${this.config.sectionType}] Max attempts reached`);

    const bestAttempt = attempts.reduce((best, current) =>
      current.validation.score > best.validation.score ? current : best
    );

    const finalCost = costTracker.getStats().estimatedCostUSD;

    return {
      markdown: bestAttempt.markdown,
      validationScore: bestAttempt.validation.score,
      passed: false,
      attempts: this.maxAttempts,
      warnings: [
        ...contextWarnings,
        `Content did not pass validation after ${this.maxAttempts} attempts (score: ${bestAttempt.validation.score}/100)`
      ],
      costUSD: finalCost - initialCost
    };
  }

  /**
   * Generate mock content (override in subclasses for specific mocks)
   */
  protected generateMockContent(context: ResearchContext): string {
    return `# Mock ${this.config.sectionType}\n\nThis is mock content for testing.\n\nBusiness: ${context.business.name}`;
  }
}
