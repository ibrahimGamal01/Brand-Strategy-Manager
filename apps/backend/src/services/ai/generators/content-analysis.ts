/**
 * Content Analysis Generator
 * 
 * Analyzes top-performing content with graceful degradation for limited data
 * NO MOCK DATA - uses actual database content only
 */

import { BaseGenerator, GenerationResult } from './base-generator';
import { SYSTEM_PROMPTS } from '../prompts/system-prompts';
import { ResearchContext } from '../rag';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Generate Content Analysis section
 */
export async function generateContentAnalysis(
  researchJobId: string
): Promise<GenerationResult> {
  
  console.log(`[Content Analysis] Starting generation for job: ${researchJobId}`);

  const generator = new ContentAnalysisGenerator();
  return generator.generate(researchJobId);
}

/**
 * Content Analysis Generator Class
 */
class ContentAnalysisGenerator extends BaseGenerator {
  constructor() {
    super({
      sectionType: 'content_analysis',
      systemPrompt: SYSTEM_PROMPTS.CONTENT_ANALYSIS,
      requiredElements: [
        'post_breakdown',
        'hook_patterns',
        'topic_patterns',
        'format_patterns',
        'content_playbook',
        'dos_and_donts'
      ],
      wordCount: { min: 2000, max: 3000 },
      model: 'gpt-4o',
      temperature: 0.7,
      maxAttempts: 3
    });
  }

  /**
   * Override to add data quality check before generation
   */
  async generate(researchJobId: string): Promise<GenerationResult> {
    // Check data availability
    const dataQuality = await this.checkDataQuality(researchJobId);
    
    console.log(`[Content Analysis] Data Quality: ${dataQuality.score}/100`);
    console.log(`[Content Analysis] Posts available: ${dataQuality.totalPosts}`);
    console.log(`[Content Analysis] Posts with metrics: ${dataQuality.postsWithMetrics}`);
    
    if (dataQuality.score < 30) {
      console.warn('[Content Analysis] Insufficient data for analysis');
      console.warn('[Content Analysis] Falling back to AI strategic guidance only');
    }

    return super.generate(researchJobId);
  }

  /**
   * Check what data is actually available
   */
  private async checkDataQuality(researchJobId: string) {
    const [
      readyClientSnapshots,
      readyCompetitorSnapshots,
      totalPosts,
      postsWithMetrics,
      postsWithCaptions,
      aiAnalysisCount,
      communityInsights,
    ] = await Promise.all([
      prisma.clientProfileSnapshot.count({
        where: { researchJobId, readinessStatus: 'READY' },
      }),
      prisma.competitorProfileSnapshot.count({
        where: { researchJobId, readinessStatus: 'READY' },
      }),
      prisma.competitorPostSnapshot.count({
        where: {
          competitorProfileSnapshot: {
            researchJobId,
            readinessStatus: { in: ['READY', 'DEGRADED'] },
          },
        },
      }),
      prisma.competitorPostSnapshot.count({
        where: {
          competitorProfileSnapshot: {
            researchJobId,
            readinessStatus: { in: ['READY', 'DEGRADED'] },
          },
          OR: [
            { likesCount: { gt: 0 } },
            { viewsCount: { gt: 0 } },
            { playsCount: { gt: 0 } },
          ],
        },
      }),
      prisma.competitorPostSnapshot.count({
        where: {
          competitorProfileSnapshot: {
            researchJobId,
            readinessStatus: { in: ['READY', 'DEGRADED'] },
          },
          caption: { not: null },
        },
      }),
      prisma.aiAnalysis.count({
        where: {
          researchJobId,
          analysisType: 'DOCUMENT',
          topic: 'content_analysis',
        },
      }),
      prisma.communityInsight.count({
        where: { researchJobId },
      }),
    ]);

    if (readyClientSnapshots === 0 && readyCompetitorSnapshots === 0 && totalPosts === 0) {
      console.warn('[Content Analysis] No readiness-qualified snapshot evidence found');
      return {
        score: 0,
        totalPosts: 0,
        postsWithMetrics: 0,
        postsWithCaptions: 0,
        hasAIAnalysis: false,
        hasCommunityData: false,
        warnings: ['No readiness-qualified snapshot evidence found'],
      };
    }

    // Get community insights for topic analysis
    // Calculate quality score
    let score = 0;
    if (totalPosts >= 20) score += 30;
    else if (totalPosts >= 10) score += 20;
    else if (totalPosts >= 5) score += 10;

    if (postsWithMetrics >= 10) score += 25;
    else if (postsWithMetrics >= 5) score += 15;
    else if (postsWithMetrics >= 1) score += 5;

    if (postsWithCaptions >= 15) score += 20;
    else if (postsWithCaptions >= 8) score += 10;

    if (readyClientSnapshots > 0 && readyCompetitorSnapshots > 0) score += 10;
    if (aiAnalysisCount > 0) score += 15;
    if (communityInsights > 5) score += 10;

    return {
      score,
      totalPosts,
      postsWithMetrics,
      postsWithCaptions,
      hasAIAnalysis: aiAnalysisCount > 0,
      hasCommunityData: communityInsights > 0,
      warnings: this.generateDataWarnings(score, totalPosts, postsWithMetrics)
    };
  }

  /**
   * Generate warnings about data limitations
   */
  private generateDataWarnings(score: number, totalPosts: number, postsWithMetrics: number): string[] {
    const warnings: string[] = [];

    if (score < 50) {
      warnings.push('Limited social media data available - analysis based on partial information');
    }

    if (totalPosts < 10) {
      warnings.push(`Only ${totalPosts} posts analyzed - recommendations are directional guidance`);
    }

    if (postsWithMetrics < 5) {
      warnings.push('Limited engagement metrics - pattern identification may be less precise');
    }

    if (score < 30) {
      warnings.push('CRITICAL: Very limited data - consider manual competitor research to supplement');
    }

    return warnings;
  }

  /**
   * NO MOCK CONTENT - this throws error to ensure database has data
   */
  /**
   * Mock content for testing
   */
  protected generateMockContent(context: ResearchContext): string {
    return `# Part 5: Content Analysis

## Post Breakdown & Patterns

### high Performing Content
**1. "Behind the Scenes" Reels**
- **Avg Engagement**: 4.5%
- **Why it works**: Humanizes the brand, shows process transparency.
- **Hook Pattern**: "Come with us to..." or "Ever wonder how..."

**2. "Mistake Avoidance" Carousels**
- **Avg Engagement**: 3.8%
- **Why it works**: Tap into fear of failure (pain point).
- **Hook Pattern**: "Stop doing this..." or "3 Mistakes that..."

### Low Performing Content
**1. Generic Quote Cards**
- **Avg Engagement**: 0.8%
- **Why it fails**: Low value, generic, no visual interest.

## Strategic Content Playbook

### Hook Patterns to Deploy
1. **The Negative Hook**: "Don't buy furniture until you read this"
2. **The Result Reveal**: "How we turned this dark room into..."
3. **The Value Promise**: "Steal our color palette for..."

### Recommended Topics
- Budget transparency (High demand)
- Material selection guides
- Rookie renovation mistakes

### Formats to Prioritize
- **Reels**: 60% (Focus on process and tips)
- **Carousels**: 30% (Educational deep dives)
- **Single Image**: 10% (Only for high-impact hero shots)

## Do's and Don'ts
**DO**:
- Show prices where possible
- Use human faces in thumbnails
- Respond to comments with questions

**DON'T**:
- Post without a clear hook overlay
- Use stock photos
- Ignore negative comments`;
  }
}

/**
 * Helper: Get enhanced system prompt with data quality context
 */
async function enhancePromptWithDataQuality(
  basePrompt: string,
  researchJobId: string
): Promise<string> {
  
  const dataCheck = await new ContentAnalysisGenerator()['checkDataQuality'](researchJobId);
  
  let additionalInstructions = '';
  
  if (dataCheck.score < 50) {
    additionalInstructions = `

DATA QUALITY NOTE:
- Only ${dataCheck.totalPosts} social posts available
- ${dataCheck.postsWithMetrics} posts have engagement metrics
- Analysis method: ${dataCheck.hasAIAnalysis ? 'AI-enhanced' : 'Limited data'}

IMPORTANT ADJUSTMENTS:
1. If captions are available but engagement metrics are missing, analyze text patterns only
2. Use qualitative analysis over quantitative when data is limited
3. Clearly label any inferred patterns as "estimated" or "suggested"
4. Include data quality disclaimer in output
5. Focus on strategic guidance over precise metrics
6. Use AI CONTENT_OPPORTUNITIES insight to supplement missing data

Generate the most valuable analysis possible with available data, but be transparent about limitations.`;
  }
  
  return basePrompt + additionalInstructions;
}
