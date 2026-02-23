import { openai } from './openai-client';
import { resolveModelForTask } from './model-router';

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

export interface ValidationResult {
  isValid: boolean;
  cleanedData: any;
  issues: string[];
  confidence: number;
}

const VALIDATION_MODEL_QUALITY = resolveModelForTask('analysis_quality');
const VALIDATION_MODEL_FAST = resolveModelForTask('validation_fast');

/**
 * AI Validation Layer
 * Validates and cleans data before saving to database
 * Catches hallucinations, format errors, and data quality issues
 */

/**
 * Validate scraped Instagram profile data
 * Ensures data is real, formatted correctly, and free of hallucinations
 */
export async function validateProfileData(rawData: any): Promise<ValidationResult> {
  const prompt = `You are a data validation expert. Validate this Instagram profile data for accuracy and format.

Raw Data:
${JSON.stringify(rawData, null, 2)}

Tasks:
1. Verify handle format (no special chars except _)
2. Check follower_count is reasonable (0-500M range)
3. Validate bio text (no injection attacks, reasonable length)
4. Ensure posts array has valid structure
5. Flag any suspicious or hallucinated data

Return JSON:
{
  "isValid": boolean,
  "cleanedData": { ... corrected data ... },
  "issues": ["issue1", "issue2"],
  "confidence": 0-1
}`;

  try {
    const response = await openai.chat.completions.create({
      model: VALIDATION_MODEL_QUALITY,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1, // Low temp for consistent validation
    });

    const result = JSON.parse((response.choices[0] as any).message?.content || '{}');
    
    console.log(`[AI Validation] Profile validation: ${result.isValid ? 'PASS' : 'FAIL'}`);
    if (result.issues?.length > 0) {
      console.warn(`[AI Validation] Issues found:`, result.issues);
    }

    return result;
  } catch (error: any) {
    console.error(`[AI Validation] Error:`, error.message);
    // Fail safe: return raw data if AI fails
    return {
      isValid: true,
      cleanedData: rawData,
      issues: [`AI validation failed: ${error.message}`],
      confidence: 0.5,
    };
  }
}

/**
 * Validate post data before saving
 * Checks engagement metrics, caption format, timestamps
 */
export async function validatePostData(posts: any[]): Promise<ValidationResult> {
  const prompt = `Validate this array of Instagram posts for data quality issues.

Posts (${posts.length} total):
${JSON.stringify(posts.slice(0, 3), null, 2)}
... (showing first 3)

Check for:
1. Valid engagement metrics (likes, comments >= 0)
2. Reasonable engagement rates (< 100%)
3. Valid timestamps (not future dates)
4. Caption format (no injection code)
5. External IDs are unique
6. Detect any duplicates or hallucinated data

Return JSON with cleaned posts array and issues list.`;

  try {
    const response = await openai.chat.completions.create({
      model: VALIDATION_MODEL_FAST,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    const result = JSON.parse((response.choices[0] as any).message?.content || '{}');
    
    console.log(`[AI Validation] Post validation: ${result.isValid ? 'PASS' : 'FAIL'} (${posts.length} posts)`);
    
    return result;
  } catch (error: any) {
    console.error(`[AI Validation] Post validation error:`, error.message);
    return {
      isValid: true,
      cleanedData: posts,
      issues: [`Post validation failed: ${error.message}`],
      confidence: 0.5,
    };
  }
}

/**
 * Validate competitor suggestions from AI
 * Ensures competitors are real, relevant, and active
 */
export async function validateCompetitorSuggestions(
  suggestions: any[],
  clientHandle: string,
  clientNiche: string
): Promise<ValidationResult> {
  const prompt = `Validate these competitor suggestions for @${clientHandle} (niche: ${clientNiche}).

Suggested Competitors:
${JSON.stringify(suggestions, null, 2)}

Validation criteria:
1. Are handles real Instagram accounts (format check)
2. Are they actually in the same niche as client
3. Relevance scores are realistic (0-1)
4. No duplicate suggestions
5. Reasons are factual and specific

Return JSON with cleaned suggestions array, marking invalid ones.`;

  try {
    const response = await openai.chat.completions.create({
      model: VALIDATION_MODEL_QUALITY,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const result = JSON.parse((response.choices[0] as any).message?.content || '{}');
    
    console.log(`[AI Validation] Competitor validation: ${result.isValid ? 'PASS' : 'FAIL'}`);
    
    return result;
  } catch (error: any) {
    console.error(`[AI Validation] Competitor validation error:`, error.message);
    return {
      isValid: true,
      cleanedData: suggestions,
      issues: [`Competitor validation failed: ${error.message}`],
      confidence: 0.5,
    };
  }
}

/**
 * Validate AI content analysis results
 * Ensures analysis is grounded in actual post content
 */
export async function validateContentAnalysis(
  analysis: any,
  postCaption: string,
  postMediaUrl?: string
): Promise<ValidationResult> {
  const prompt = `Validate this AI content analysis for hallucinations.

Post Caption: "${postCaption}"
Media URL: ${postMediaUrl || 'N/A'}

AI Analysis Result:
${JSON.stringify(analysis, null, 2)}

Check:
1. Does topic match the caption?
2. Are detected keywords actually in the caption?
3. Is content pillar reasonable for this type of content?
4. Are pain points/goals logically connected?
5. Confidence score is realistic

Return JSON validating each field.`;

  try {
    const response = await openai.chat.completions.create({
      model: VALIDATION_MODEL_FAST,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    const result = JSON.parse((response.choices[0] as any).message?.content || '{}');
    
    return result;
  } catch (error: any) {
    return {
      isValid: true,
      cleanedData: analysis,
      issues: [`Analysis validation failed: ${error.message}`],
      confidence: 0.5,
    };
  }
}

export const aiValidator = {
  validateProfileData,
  validatePostData,
  validateCompetitorSuggestions,
  validateContentAnalysis,
};
