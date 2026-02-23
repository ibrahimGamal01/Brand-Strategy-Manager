/**
 * Business Understanding Generator
 * 
 * Generates the "Part 1: Understanding the Business" section
 * using RAG context and system prompts.
 */

import OpenAI from 'openai';
import { getFullResearchContext, formatContextForLLM } from '../../rag';
import { SYSTEM_PROMPTS } from '../../prompts/system-prompts';
import { validateContent } from '../../validation';
import { COST_PROTECTION, costTracker, checkCostLimit } from '../../validation/cost-protection';
import { GenerationResult, GenerationAttempt } from './types';
import { generateMockBusinessUnderstanding } from './mock';
import { resolveModelForTask } from '../../model-router';

let openaiClient: OpenAI | null = null;
function getOpenAiClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

const MAX_ATTEMPTS = 3;
const BUSINESS_UNDERSTANDING_MODEL = resolveModelForTask('content_generation');

/**
 * Generate Business Understanding section with validation loop
 */
export async function generateBusinessUnderstanding(
  researchJobId: string
): Promise<GenerationResult> {
  
  console.log(`[Generator] Starting Business Understanding for job: ${researchJobId}`);

  // Check cost limits
  const costCheck = checkCostLimit();
  if (!costCheck.allowed) {
    throw new Error(`Cost limit reached: ${costCheck.reason}`);
  }

  // Get research context
  console.log('[Generator] Retrieving research context...');
  const context = await getFullResearchContext(researchJobId);
  const initialCost = costTracker.getStats().estimatedCostUSD;

  if (!context.overallQuality.isReliable) {
    console.warn(`[Generator] Data quality below threshold: ${context.overallQuality.score}/100`);
  }

  // Format for LLM
  const contextString = formatContextForLLM(context);

  const attempts: GenerationAttempt[] = [];
  let finalResult: GenerationResult | null = null;

  // Generation loop with validation
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[Generator] Attempt ${attempt}/${MAX_ATTEMPTS}`);

    try {
      // Generate content
      const markdown = await callOpenAI(
        contextString,
        attempt > 1 ? attempts[attempt - 2] : undefined
      );

      // Validate
      const validation = await validateContent(
        markdown,
        'business_understanding',
        [
          'specific_products_services',
          'customer_segments_with_examples',
          'business_model',
          'market_position',
          'value_proposition',
          'brand_voice'
        ],
        { min: 2000, max: 3000 },
        context
      );

      attempts.push({
        attemptNumber: attempt,
        markdown,
        validationScore: validation.score,
        feedback: validation.feedback.improvements.map(i => i.issue)
      });

      console.log(`[Generator] Validation score: ${validation.score}/100`);

      if (validation.passed) {
        console.log('[Generator] ✓ Content passed validation');
        const currentCost = costTracker.getStats().estimatedCostUSD;
        finalResult = {
          markdown,
          validationScore: validation.score,
          passed: true,
          attempts: attempt,
          warnings: context.warnings,
          costUSD: currentCost - initialCost
        };
        break;
      } else {
        console.log(`[Generator] Content needs improvement (${validation.feedback.improvements.length} issues)`);
        
        if (attempt === MAX_ATTEMPTS) {
          console.warn('[Generator] Max attempts reached, using best attempt');
          
          // Use best attempt
          const bestAttempt = attempts.reduce((best, current) => 
            current.validationScore > best.validationScore ? current : best
          );
          
          const currentCost = costTracker.getStats().estimatedCostUSD;

          finalResult = {
            markdown: bestAttempt.markdown,
            validationScore: bestAttempt.validationScore,
            passed: false,
            attempts: MAX_ATTEMPTS,
            warnings: [
              ...context.warnings,
              `Content did not pass validation after ${MAX_ATTEMPTS} attempts (score: ${bestAttempt.validationScore}/100)`
            ],
            costUSD: currentCost - initialCost
          };
        }
      }

    } catch (error) {
      console.error(`[Generator] Error on attempt ${attempt}:`, error);
      
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Failed to generate content after ${MAX_ATTEMPTS} attempts: ${error}`);
      }
    }
  }

  if (!finalResult) {
    throw new Error('Generation failed - no result produced');
  }

  // Log cost summary
  const costStats = costTracker.getStats();
  console.log(`[Generator] Total cost: $${costStats.estimatedCostUSD.toFixed(4)}`);

  return finalResult;
}

/**
 * Call OpenAI API to generate content
 */
async function callOpenAI(
  contextString: string,
  previousAttempt?: GenerationAttempt
): Promise<string> {
  
  const openai = getOpenAiClient();
  if (!openai) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  
  // Use mock in development
  if (COST_PROTECTION.mockMode) {
    console.log('[Generator] Using MOCK mode (cost: $0)');
    return generateMockBusinessUnderstanding();
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: SYSTEM_PROMPTS.BUSINESS_UNDERSTANDING
    }
  ];

  // First attempt
  if (!previousAttempt) {
    messages.push({
      role: 'user',
      content: `Generate the Business Understanding section using this research data:\n\n${contextString}`
    });
  } 
  // Retry with feedback
  else {
    messages.push({
      role: 'user',
      content: `Generate the Business Understanding section using this research data:\n\n${contextString}`
    });
    messages.push({
      role: 'assistant',
      content: previousAttempt.markdown
    });
    messages.push({
      role: 'user',
      content: `The previous attempt scored ${previousAttempt.validationScore}/100. Issues found:\n${previousAttempt.feedback.join('\n')}\n\nPlease regenerate with improvements addressing these issues.`
    });
  }

  const response = await openai.chat.completions.create({
    model: BUSINESS_UNDERSTANDING_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: Math.min(4000, COST_PROTECTION.maxTokensPerCall)
  });

  // Track costs
  if (response.usage) {
    costTracker.addUsage(
      BUSINESS_UNDERSTANDING_MODEL,
      response.usage.prompt_tokens,
      response.usage.completion_tokens
    );
  }

  return response.choices[0].message.content || '';
}
