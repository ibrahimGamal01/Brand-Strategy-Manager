// import { OpenAI } from 'openai';
import fs from 'fs';
import { prisma } from '../../lib/prisma';

import { openai } from './openai-client';
import { resolveModelForTask } from './model-router';

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CONTENT_ANALYZER_MODEL = resolveModelForTask('analysis_quality');

/**
 * Deep content analysis - NOT just validation
 * Analyzes caption + visual together for comprehensive insights
 */

export async function analyzePost(
  post: { id: string; caption: string | null },
  mediaPath?: string
): Promise<string[]> {
  const analysisIds: string[] = [];

  try {
    // Analysis 1: Caption Analysis (if exists)
    if (post.caption) {
      const captionAnalysis = await analyzeCaptionDeep(post.caption);
      
      const analysis = await prisma.aiAnalysis.create({
        data: {
          clientPostId: post.id,
          analysisType: 'CAPTION',
          modelUsed: CONTENT_ANALYZER_MODEL,
          topic: captionAnalysis.topic,
          contentPillarDetected: captionAnalysis.content_pillar,
          keywordsHooks: JSON.stringify(captionAnalysis.keywords_hooks),
          painPointAddressed: captionAnalysis.pain_point,
          goalAddressed: captionAnalysis.goal,
          hookAnalysis: captionAnalysis.hook_pattern,
          fullResponse: captionAnalysis,
          confidenceScore: captionAnalysis.confidence_score || 0.8,
        },
      });

      analysisIds.push(analysis.id);
      console.log(`[ContentAnalyzer] Caption analysis saved: ${analysis.id}`);
    }

    // Analysis 2: Visual Analysis (if media exists)
    if (mediaPath && fs.existsSync(mediaPath)) {
      const visualAnalysis = await analyzeVisual(mediaPath);

      const analysis = await prisma.aiAnalysis.create({
        data: {
          clientPostId: post.id,
          analysisType: 'VISUAL',
          modelUsed: CONTENT_ANALYZER_MODEL,
          visualStyleNotes: JSON.stringify(visualAnalysis.visual_style),
          hookAnalysis: visualAnalysis.visual_hooks,
          fullResponse: visualAnalysis,
          confidenceScore: visualAnalysis.confidence_score || 0.8,
        },
      });

      analysisIds.push(analysis.id);
      console.log(`[ContentAnalyzer] Visual analysis saved: ${analysis.id}`);
    }

    // Analysis 3: Overall Content Strategy
    if (post.caption || mediaPath) {
      const overallAnalysis = await analyzeOverall(post.caption, mediaPath);

      const analysis = await prisma.aiAnalysis.create({
        data: {
          clientPostId: post.id,
          analysisType: 'OVERALL',
          modelUsed: CONTENT_ANALYZER_MODEL,
          topic: overallAnalysis.main_topic,
          contentPillarDetected: overallAnalysis.content_pillar,
          fullResponse: overallAnalysis,
          confidenceScore: overallAnalysis.confidence_score || 0.8,
        },
      });

      analysisIds.push(analysis.id);
      console.log(`[ContentAnalyzer] Overall analysis saved: ${analysis.id}`);
    }

    return analysisIds;
  } catch (error: any) {
    console.error(`[ContentAnalyzer] Error analyzing post:`, error);
    throw error;
  }
}

/**
 * Deep caption analysis
 */
async function analyzeCaptionDeep(caption: string) {
  const prompt = `You are a social media content strategist. Analyze this Instagram caption:

"${caption}"

Provide detailed analysis in this EXACT JSON structure:
{
  "topic": "2-3 sentence description of what this post is about",
  "content_pillar": "one of: education, entertainment, inspiration, promotion, authority",  
  "keywords_hooks": ["key phrase 1", "key phrase 2", ...],
  "pain_point": "customer problem addressed, or null if none",
  "goal": "aspiration/desire tapped into, or null if none",
  "emotional_tone": "primary emotion evoked",
  "call_to_action": "what action is requested, or null if none",
  "target_audience": "specific description of who this speaks to",
  "hook_pattern": "how the first line grabs attention",
  "confidence_score": 0.0-1.0
}

Be specific and grounded in the actual caption text. Return ONLY valid JSON.`;

  const response = await openai.chat.completions.create({
    model: CONTENT_ANALYZER_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  return JSON.parse((response.choices[0] as any).message?.content || '{}');
}

/**
 * Visual analysis using GPT-4 Vision
 */
async function analyzeVisual(mediaPath: string) {
  // Read image
  const imageData = fs.readFileSync(mediaPath);
  const base64Image = imageData.toString('base64');
  const extension = mediaPath.split('.').pop()?.toLowerCase() || 'jpg';
  const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';

  const prompt = `You are a social media marketing strategist for an agency. Evaluate this asset as you would for a client or competitor audit.

Analyze this social media post visual. Return JSON with:
- platform_format: string (e.g. "Reels", "Feed", "Story", "TikTok").
- hook_strength: number 1-10 (how strong is the visual hook).
- scroll_stopping: object with "yes" or "no" and "why" (short reason).
- on_brand_estimate: string (does this feel on-brand for a typical client; or "unknown" if no brand context).
- actionable_visual_fixes: array of 2-4 concrete, specific steps to improve the visual.
- visual_style: object (colors, composition, layout, typography if visible).
- brand_elements_present: what branding is visible (logos, colors, fonts).
- text_overlay: transcribe any text on the image.
- mood_aesthetic: feeling the visual creates.
- production_quality: low/medium/high with brief why.
- visual_hooks: what grabs attention immediately.
- composition: balance, rule of thirds, layout; color_use: palette, contrast; typography: readability, hierarchy.
- cta_clarity: how clear is the call-to-action if any.
- psychological_triggers: any used.
- confidence_score: number 0-1.`;

  const response = await openai.chat.completions.create({
    model: CONTENT_ANALYZER_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}` },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  return JSON.parse((response.choices[0] as any).message?.content || '{}');
}

/**
 * Overall content strategy analysis (combining caption + visual)
 */
async function analyzeOverall(caption: string | null, mediaPath?: string) {
  let captionText = caption || '';
  let visualContext = '';

  // If we have media, get quick visual summary
  if (mediaPath && fs.existsSync(mediaPath)) {
    const imageData = fs.readFileSync(mediaPath);
    const base64Image = imageData.toString('base64');
    const extension = mediaPath.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';

    visualContext = 'Visual context available';

    const prompt = `You are a social media marketing strategist for an agency. Analyze this post holistically (caption + visual together).

Caption: "${captionText}"

Return JSON with:
- performance_estimate: object with "score" (1-10, engagement potential) and "reason" (short explanation).
- one_line_recommendation: string (next post idea or A/B test suggestion—one concrete, actionable line).
- strategic_recommendations: array of 2-4 specific, actionable bullets (no filler; things to do or test).
- main_topic: central message combining text and visual.
- content_pillar: primary category (education/entertainment/inspiration/promotion/authority).
- target_audience: who this is specifically for.
- content_strategy: what strategy is at play (storytelling, education, etc.).
- effectiveness_rating: 1-10 (how well caption + visual work together).
- creative_and_design_summary: composition, color, hierarchy, cta_clarity, brand_consistency.
- confidence_score: number 0-1.`;

    const response = await openai.chat.completions.create({
      model: CONTENT_ANALYZER_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    return JSON.parse((response.choices[0] as any).message?.content || '{}');
  } else {
    // Caption only
    const prompt = `You are a social media marketing strategist for an agency. Analyze this post strategically.

Caption: "${captionText}"

Return JSON with:
- performance_estimate: object with "score" (1-10, engagement potential) and "reason" (short explanation).
- one_line_recommendation: string (next post idea or A/B test suggestion—one concrete, actionable line).
- strategic_recommendations: array of 2-4 specific, actionable bullets (no filler).
- main_topic: central message.
- content_pillar: primary category.
- target_audience: who this is for.
- content_strategy: what strategy is used.
- effectiveness_rating: 1-10.
- creative_and_design_summary: brief summary if caption-only.
- confidence_score: number 0-1.`;

    const response = await openai.chat.completions.create({
      model: CONTENT_ANALYZER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    return JSON.parse((response.choices[0] as any).message?.content || '{}');
  }
}

export const contentAnalyzer = {
  analyzePost,
  analyzeCaptionDeep,
  analyzeVisual,
  analyzeOverall,
};
