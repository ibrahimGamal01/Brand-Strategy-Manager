import { OpenAI } from 'openai';
import { prisma } from '../../lib/prisma';
import { resolveModelForTask } from './model-router';

let openaiClient: OpenAI | null = null;
function getOpenAiClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

const BRAND_ANALYSIS_MODEL = resolveModelForTask('analysis_quality');
const BRAND_MENTION_MODEL = resolveModelForTask('analysis_fast');

interface BrandMention {
  id: string;
  url: string;
  title: string | null;
  snippet: string | null;
  fullText: string | null;
  sourceType: string | null;
}

/**
 * Analyze brand mentions from web search results
 */
export async function analyzeBrandMentions(clientId: string, mentions: BrandMention[]) {
  if (mentions.length === 0) {
    console.log('[BrandAnalyzer] No mentions to analyze');
    return null;
  }

  console.log(`[BrandAnalyzer] Analyzing ${mentions.length} brand mentions`);

  // Prepare mention summaries for AI
  const mentionSummaries = mentions.map(m => ({
    source: m.url,
    type: m.sourceType,
    title: m.title,
    snippet: m.snippet,
    content_sample: m.fullText?.slice(0, 500), // First 500 chars
  }));

  const prompt = `Analyze these web mentions about a brand:

${JSON.stringify(mentionSummaries, null, 2)}

Extract comprehensive brand insights:

1. **Overall Sentiment**: What's the general sentiment? (positive/neutral/negative/mixed)
2. **Sentiment Breakdown**: Percentage distribution of sentiment
3. **Common Themes**: What topics appear repeatedly? (list top 5-10)
4. **Customer Pain Points**: What problems/frustrations are mentioned?
5. **Competitive Advantages**: What do people praise about the brand?
6. **Weaknesses/Complaints**: What criticisms appear?
7. **Target Audience Characteristics**: Who's talking about this brand?
8. **Content Opportunities**: What topics people want to see more of?
9. **Unanswered Questions**: What questions do people have?
10. **Competitive Context**: How is the brand compared to others?
11. **Confidence Score**: How reliable is this analysis? (0-1)

Return detailed JSON with all fields.`;

  try {
    const openai = getOpenAiClient();
    if (!openai) throw new Error('OPENAI_API_KEY not configured');
    const response = await openai.chat.completions.create({
      model: BRAND_ANALYSIS_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const analysis = JSON.parse(response.choices[0].message.content || '{}');

    console.log(`[BrandAnalyzer] Analysis complete. Sentiment: ${analysis.overall_sentiment}`);

    // Save aggregated analysis to one of the mentions
    // (or create a separate table for aggregated brand insights)
    if (mentions[0]) {
      await prisma.aiAnalysis.create({
        data: {
          brandMentionId: mentions[0].id,
          analysisType: 'OVERALL',
          modelUsed: BRAND_ANALYSIS_MODEL,
          topic: 'Brand Sentiment Analysis',
          fullResponse: analysis,
          confidenceScore: analysis.confidence_score || 0.8,
        },
      });
    }

    return analysis;
  } catch (error: any) {
    console.error('[BrandAnalyzer] Error:', error);
    throw error;
  }
}

/**
 * Analyze sentiment of a single brand mention
 */
export async function analyzeSingleMention(mention: BrandMention) {
  if (!mention.fullText || mention.fullText.length < 50) {
    return null;
  }

  const prompt = `Analyze the sentiment and key points of this web content about a brand:

Title: ${mention.title}
URL: ${mention.url}
Content: ${mention.fullText.slice(0, 2000)}

Extract:
1. **Sentiment**: positive/neutral/negative
2. **Key Points**: Main points mentioned (bullet list)
3. **Brand Perception**: How is the brand portrayed?
4. **Actionable Insights**: What can the brand learn from this?

Return JSON.`;

  try {
    const openai = getOpenAiClient();
    if (!openai) throw new Error('OPENAI_API_KEY not configured');
    const response = await openai.chat.completions.create({
      model: BRAND_MENTION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const analysis = JSON.parse(response.choices[0].message.content || '{}');

    // Save analysis
    await prisma.aiAnalysis.create({
      data: {
        brandMentionId: mention.id,
        analysisType: 'CONTENT',
        modelUsed: BRAND_MENTION_MODEL,
        topic: mention.title || 'Brand Mention',
        fullResponse: analysis,
        confidenceScore: 0.75,
      },
    });

    return analysis;
  } catch (error: any) {
    console.error(`[BrandAnalyzer] Error analyzing mention ${mention.id}:`, error);
    return null;
  }
}

export const brandAnalyzer = {
  analyzeBrandMentions,
  analyzeSingleMention,
};
