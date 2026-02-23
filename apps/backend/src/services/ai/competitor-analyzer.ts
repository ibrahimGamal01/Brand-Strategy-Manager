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

const COMPETITOR_ANALYZER_MODEL = resolveModelForTask('analysis_quality');

/**
 * Competitor Gap Analysis
 * Compare client's content strategy with competitors
 */

export async function analyzeCompetitorGaps(clientId: string, competitorIds: string[]) {
  console.log(`[CompetitorAnalyzer] Running gap analysis for client ${clientId}`);

  // Fetch client's posts with analyses
  const clientPosts = await prisma.clientPost.findMany({
    where: {
      clientAccount: {
        clientId,
      },
    },
    include: {
      aiAnalyses: true,
      mediaAssets: true,
    },
    take: 50, // Last 50 posts
  });

  // Fetch competitor posts with analyses
  const competitorPosts = await prisma.cleanedPost.findMany({
    where: {
      rawPost: {
        competitor: {
          id: { in: competitorIds },
        },
      },
    },
    include: {
      aiAnalyses: true,
      mediaAssets: true,
    },
    take: 100, // Sample of competitor posts
  });

  // Extract insights from AI analyses
  const clientPillars = extractPillars(clientPosts);
  const competitorPillars = extractPillars(competitorPosts);

  const clientFormats = extractFormats(clientPosts);
  const competitorFormats = extractFormats(competitorPosts);

  const prompt = `Perform a competitive gap analysis:

**Client's Content:**
- Total posts analyzed: ${clientPosts.length}
- Content pillars: ${JSON.stringify(clientPillars)}
- Formats used: ${JSON.stringify(clientFormats)}

**Competitors' Content:**
- Total posts analyzed: ${competitorPosts.length}
- Content pillars: ${JSON.stringify(competitorPillars)}
- Formats used: ${JSON.stringify(competitorFormats)}

Identify:

1. **Content Gaps**: What topics/pillars do competitors cover that client doesn't?
2. **Format Opportunities**: What formats do competitors use successfully that client should try?
3. **Strategic Advantages**: What does client do better than competitors?
4. **Missed Opportunities**: What high-performing competitor strategies could client adopt?
5. **Differentiation Opportunities**: How can client stand out from competitors?
6. **Recommended Actions**: Top 5 specific action items for client

Return comprehensive JSON analysis.`;

  try {
    const openai = getOpenAiClient();
    if (!openai) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    const response = await openai.chat.completions.create({
      model: COMPETITOR_ANALYZER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    });

    const gapAnalysis = JSON.parse(response.choices[0].message.content || '{}');

    console.log(`[CompetitorAnalyzer] Gap analysis complete`);

    return gapAnalysis;
  } catch (error: any) {
    console.error('[CompetitorAnalyzer] Error:', error);
    throw error;
  }
}

/**
 * Compare specific competitor with client
 */
export async function compareWithCompetitor(clientId: string, competitorId: string) {
  // Fetch client data
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      clientAccounts: {
        include: {
          clientPosts: {
            include: { aiAnalyses: true },
            take: 30,
          },
        },
      },
    },
  });

  // Fetch competitor data
  const competitor = await prisma.competitor.findUnique({
    where: { id: competitorId },
    include: {
      rawPosts: {
        include: {
          cleanedPost: {
            include: { aiAnalyses: true },
          },
        },
        take: 30,
      },
    },
  });

  if (!client || !competitor) {
    throw new Error('Client or competitor not found');
  }

  const clientStats = calculateStats(
    client.clientAccounts[0]?.clientPosts || []
  );
  const competitorStats = calculateStats(
    competitor.rawPosts
      .map(rp => rp.cleanedPost)
      .filter(Boolean) as any[]
  );

  const prompt = `Compare these two Instagram accounts:

**Client:**
${JSON.stringify(clientStats, null, 2)}

**Competitor:**
${JSON.stringify(competitorStats, null, 2)}

Provide:
1. **Performance Comparison**: Who performs better and why?
2. **Content Strategy Differences**: Key strategic differences
3. **What Client Can Learn**: Specific takeaways from competitor
4. **Client's Unique Strengths**: What client does better
5. **Recommendations**: 3-5 specific actions

Return JSON.`;

  try {
    const openai = getOpenAiClient();
    if (!openai) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    const response = await openai.chat.completions.create({
      model: COMPETITOR_ANALYZER_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    return JSON.parse(response.choices[0].message.content || '{}');
  } catch (error: any) {
    console.error('[CompetitorAnalyzer] Error comparing:', error);
    throw error;
  }
}

/**
 * Helper: Extract content pillars from posts
 */
function extractPillars(posts: any[]) {
  const pillars: Record<string, number> = {};

  posts.forEach(post => {
    post.aiAnalyses?.forEach((analysis: any) => {
      const pillar = analysis.contentPillarDetected;
      if (pillar) {
        pillars[pillar] = (pillars[pillar] || 0) + 1;
      }
    });
  });

  return pillars;
}

/**
 * Helper: Extract formats from posts
 */
function extractFormats(posts: any[]) {
  const formats: Record<string, number> = {};

  posts.forEach(post => {
    const format = post.format || 'unknown';
    formats[format] = (formats[format] || 0) + 1;
  });

  return formats;
}

/**
 * Helper: Calculate post statistics
 */
function calculateStats(posts: any[]) {
  if (posts.length === 0) {
    return { avgLikes: 0, avgComments: 0, avgEngagement: 0, totalPosts: 0 };
  }

  const totalLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (p.comments || 0), 0);
  const totalEngagement = posts.reduce(
    (sum, p) => sum + (p.engagementRate || 0),
    0
  );

  return {
    avgLikes: Math.round(totalLikes / posts.length),
    avgComments: Math.round(totalComments / posts.length),
    avgEngagement: (totalEngagement / posts.length).toFixed(2),
    totalPosts: posts.length,
    formats: extractFormats(posts),
    pillars: extractPillars(posts),
  };
}

export const competitorAnalyzer = {
  analyzeCompetitorGaps,
  compareWithCompetitor,
};
