import { OpenAI } from 'openai';
import fs from 'fs';
import { prisma } from '../../lib/prisma';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
          modelUsed: 'gpt-4o',
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
          modelUsed: 'gpt-4o',
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
          modelUsed: 'gpt-4o',
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
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  return JSON.parse(response.choices[0].message.content || '{}');
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

  const prompt = `Analyze this social media post visual in detail:

1. **Visual Style**: Describe colors, composition, layout, typography (if visible text)
2. **Branding Elements**: What branding is visible? (logos, colors, fonts)
3. **Text Overlays**: What text is shown on the image? (transcribe exactly)
4. **Mood & Aesthetic**: What feeling does this visual create?
5. **Production Quality**:  low/medium/high and why
6. **Visual Hooks**: What grabs attention immediately?
7. **Design Principles**: What design techniques are used? (rule of thirds, contrast, etc.)
8. **Recommended Improvements**: What could make this visually stronger?
9. **Confidence Score**: How clear/analyzable is this image? (0-1)

Return comprehensive JSON with all fields.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
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

  return JSON.parse(response.choices[0].message.content || '{}');
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

    const prompt = `Analyze this post holistically (caption + visual together):

Caption: "${captionText}"

Overall Strategy Analysis:
1. **Main Topic**: Central message combining text and visual
2. **Content Pillar**: Primary category for this content
3. **Target Audience**: Who is this specifically for?
4. **Content Strategy**: What strategy is at play here? (storytelling, education, entertainment, etc.)
5. **Effectiveness Rating**: How well does caption + visual work together? (1-10)
6. **Strategic Recommendations**: How could this be improved strategically?
7. **Confidence Score**: 0-1

Return detailed JSON.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
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

    return JSON.parse(response.choices[0].message.content || '{}');
  } else {
    // Caption only
    const prompt = `Analyze this post strategically:

Caption: "${captionText}"

Overall Strategy:
1. **Main Topic**: Central message
2. **Content Pillar**: Primary category
3. **Target Audience**: Who is this for?
4. **Content Strategy**: What strategy is used?
5. **Effectiveness Rating**: How effective is this? (1-10)
6. **Strategic Recommendations**: Improvements?
7. **Confidence Score**: 0-1

Return detailed JSON.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    return JSON.parse(response.choices[0].message.content || '{}');
  }
}

export const contentAnalyzer = {
  analyzePost,
  analyzeCaptionDeep,
  analyzeVisual,
  analyzeOverall,
};
