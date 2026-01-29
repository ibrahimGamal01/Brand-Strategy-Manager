/**
 * AI-Powered Validation (with cost protection)
 */

import OpenAI from 'openai';
import { ValidationImprovement } from '../types/templates';
import { COST_PROTECTION, costTracker, getMockAIResponse, checkCostLimit } from './cost-protection';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Use AI to validate quality (RESPECTS COST PROTECTION)
 */
export async function aiValidation(
  content: string,
  sectionType: string,
  researchContext: string
): Promise<{ score: number; strengths: string[]; improvements: ValidationImprovement[] }> {
  
  // COST PROTECTION: Check if we should block this call
  const costCheck = checkCostLimit();
  if (!costCheck.allowed) {
    console.warn(`[Validator] Blocked AI call: ${costCheck.reason}`);
    return {
      score: 50,
      strengths: [],
      improvements: [{
        issue: 'Cost limit reached',
        suggestion: costCheck.reason || 'Budget exceeded',
        example: ''
      }]
    };
  }

  // COST PROTECTION: Use mock in development/testing
  if (COST_PROTECTION.mockMode) {
    console.log('[Validator] Using MOCK AI response (cost: $0)');
    const mockResponse = getMockAIResponse(content);
    return JSON.parse(mockResponse.choices[0].message.content);
  }

  const prompt = `Review this ${sectionType} section and provide constructive feedback.

CONTENT:
${content}

CONTEXT:
${researchContext.substring(0, 1500)}

Return JSON:
{
  "score": <0-100>,
  "strengths": ["what was done well"],
  "improvements": [{"issue": "problem", "suggestion": "fix", "example": "concrete example"}]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful content quality advisor.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: Math.min(800, COST_PROTECTION.maxTokensPerCall)
    });

    // Track costs
    if (response.usage) {
      costTracker.addUsage(
        'gpt-4o-mini',
        response.usage.prompt_tokens,
        response.usage.completion_tokens
      );
    }

    const result = JSON.parse(response.choices[0].message.content || '{}');
    
    return {
      score: result.score || 50,
      strengths: result.strengths || [],
      improvements: result.improvements || []
    };
  } catch (error) {
    console.error('[Validator] AI validation failed:', error);
    return {
      score: 50,
      strengths: [],
      improvements: [{
        issue: 'AI validation unavailable',
        suggestion: 'Manual review required',
        example: ''
      }]
    };
  }
}
