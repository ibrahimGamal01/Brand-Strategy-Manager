/**
 * Main RAG Retriever (Orchestrator)
 * 
 * Coordinates all context retrievers and provides the main API
 */

import { DataQualityScore, crossReferenceData } from './data-quality';
import { BusinessContext, getBusinessContext } from './business-context';
import { AIInsights, getAIInsights } from './ai-insights';
import { CompetitorContext, getCompetitorContext } from './competitor-context';
import { SocialContext, CommunityContext, getSocialContext, getCommunityContext } from './social-community-context';

export interface ResearchContext {
  business: BusinessContext;
  aiInsights: AIInsights;
  competitors: CompetitorContext;
  socialData: SocialContext;
  community: CommunityContext;
  overallQuality: DataQualityScore;
  warnings: string[];
  missingData: string[];
}

/**
 * Main function: Get full research context with comprehensive validation
 */
export async function getFullResearchContext(researchJobId: string): Promise<ResearchContext> {
  console.log(`[RAG] Fetching context for job: ${researchJobId}`);

  const [business, aiInsights, competitors, socialData, community] = await Promise.all([
    getBusinessContext(researchJobId),
    getAIInsights(researchJobId),
    getCompetitorContext(researchJobId),
    getSocialContext(researchJobId),
    getCommunityContext(researchJobId)
  ]);

  const crossRefIssues = crossReferenceData(aiInsights, competitors.all10);

  const allWarnings: string[] = [
    ...business.qualityScore.warnings,
    ...aiInsights.qualityScore.warnings,
    ...competitors.overallQuality.warnings,
    ...socialData.qualityScore.warnings,
    ...community.qualityScore.warnings,
    ...crossRefIssues
  ];

  const allIssues: string[] = [
    ...business.qualityScore.issues,
    ...aiInsights.qualityScore.issues,
    ...competitors.overallQuality.issues,
    ...socialData.qualityScore.issues,
    ...community.qualityScore.issues
  ];

  const missingData: string[] = [];
  
  if (!business.qualityScore.isReliable) {
    missingData.push('Business data is incomplete or unreliable');
  }
  if (!aiInsights.qualityScore.isReliable) {
    missingData.push('AI insights are incomplete');
  }
  if (!competitors.overallQuality.isReliable) {
    missingData.push('Competitor data is incomplete');
  }

  const avgScore = [
    business.qualityScore.score,
    aiInsights.qualityScore.score,
    competitors.overallQuality.score,
    socialData.qualityScore.score,
    community.qualityScore.score
  ].reduce((a, b) => a + b, 0) / 5;

  const overallQuality: DataQualityScore = {
    source: 'overall',
    score: avgScore,
    issues: allIssues,
    warnings: allWarnings,
    isReliable: avgScore >= 70
  };

  console.log(`[RAG] Quality: ${avgScore.toFixed(1)}/100, Issues: ${allIssues.length}, Warnings: ${allWarnings.length}`);

  return {
    business,
    aiInsights,
    competitors,
    socialData,
    community,
    overallQuality,
    warnings: allWarnings,
    missingData
  };
}

/**
 * Format research context for LLM consumption
 * Comprehensive formatting including ALL data sources
 */
export function formatContextForLLM(context: ResearchContext): string {
  // Section 1: Quality Overview
  let output = `# Research Data Quality: ${context.overallQuality.score.toFixed(1)}/100 ${context.overallQuality.isReliable ? '✓ RELIABLE' : '⚠️ NEEDS VALIDATION'}

`;

  // Section 2: Business Context
  output += `## Business Profile
- **Name**: ${context.business.name}
- **Handle**: ${context.business.handle || 'Not available'}
- **Website**: ${context.business.website || 'Not available'}
- **Bio**: ${context.business.bio || 'Not available'}
- **Search Results**: ${context.business.searchResults.length} sources

`;

  // Section 3: AI Strategic Insights (The 12 Questions)
  const aiInsightsCount = Object.keys(context.aiInsights).filter(k => k !== 'qualityScore' && context.aiInsights[k as keyof typeof context.aiInsights]).length;
  output += `## AI Strategic Insights (${aiInsightsCount}/12 Questions Answered)

`;
  
  Object.entries(context.aiInsights)
    .filter(([k, v]) => k !== 'qualityScore' && v)
    .forEach(([key, value]) => {
      output += `### ${key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
${value}

`;
    });

  // Section 4: Competitor Intelligence
  output += `## Competitor Landscape
- **Total Competitors**: ${context.competitors.all10.length}/10
- **Priority Competitors**: ${context.competitors.priority3.length}/3
- **Data Quality**: ${context.competitors.overallQuality.score.toFixed(1)}/100

`;

  if (context.competitors.priority3.length > 0) {
    output += `### Priority Competitors:\n`;
    context.competitors.priority3.forEach((comp, i) => {
      output += `${i + 1}. **@${comp.handle}** (${comp.platform})\n`;
      if (comp.followers) {
        output += `   - Followers: ${comp.followers.toLocaleString()}\n`;
      }
      if (comp.postingFreq) {
        output += `   - Posting Frequency: ${comp.postingFreq}\n`;
      }
      if (comp.engagement) {
        output += `   - Engagement: ${comp.engagement}\n`;
      }
    });
    output += '\n';
  }

  // Section 5: Top-Performing Social Content (CRITICAL FOR STRATEGY)
  const topPostsCount = context.socialData.topPosts.length;
  output += `## Top-Performing Social Content (${topPostsCount} High-Performers Identified)

`;

  if (topPostsCount > 0) {
    // Limit to top 20 posts for context window
    const postsToShow = context.socialData.topPosts.slice(0, 20);
    
    postsToShow.forEach((post, i) => {
      const metadata = post.metadata as any || {};
      const topPerformers = metadata.topPerformers || [];
      const content = post.content || '';
      
      output += `### Post ${i + 1}: ${post.platform} - @${metadata.handle || 'unknown'}
- **Content**: "${content.substring(0, Math.min(150, content.length))}${content.length > 150 ? '...' : ''}"
- **Posted**: ${post.postedAt ? new Date(post.postedAt).toLocaleDateString() : 'Unknown'}
- **Metrics**: ${metadata.likes || 0} likes, ${metadata.comments || 0} comments, ${metadata.shares || 0} shares
- **Engagement Rate**: ${metadata.engagement_rate ? (metadata.engagement_rate * 100).toFixed(2) : 'N/A'}%
- **Top Performer**: ${topPerformers.join(', ')}
${metadata.media_type ? `- **Format**: ${metadata.media_type}` : ''}
${metadata.caption_length ? `- **Caption Length**: ${metadata.caption_length} characters` : ''}

`;
    });
  } else {
    output += `⚠️ No top-performing posts identified. Post ranking may not be calculated yet.

`;
  }

  // Section 6: Community Insights
  if (context.community.insights.length > 0) {
    output += `## Community Insights (${context.community.insights.length} sources)

`;
    context.community.insights.slice(0, 10).forEach((insight, i) => {
      const content = insight.content || '';
      output += `${i + 1}. **${insight.platform}**: ${content.substring(0, Math.min(200, content.length))}${content.length > 200 ? '...' : ''}
`;
    });
    output += '\n';
  }

  // Section 7: Search Trends
  if (context.community.searchTrends.length > 0) {
    output += `## Search Trends (${context.community.searchTrends.length} trends)

`;
    context.community.searchTrends.forEach((trend, i) => {
      output += `${i + 1}. "${trend.query}" - ${trend.volume || 'N/A'} searches
`;
    });
    output += '\n';
  }

  // Section 8: Data Quality Warnings
  if (context.warnings.length > 0) {
    output += `## ⚠️ Data Quality Warnings (${context.warnings.length})
${context.warnings.map(w => `- ${w}`).join('\n')}

`;
  }

  // Section 9: Instructions for AI
  output += `---
## INSTRUCTIONS FOR CONTENT GENERATION
1. **Use SPECIFIC data** from the research above - cite handles, metrics, exact quotes
2. **Reference top-performing posts** when making content recommendations
3. **Base personas on AI insights** from the 12 strategic questions
4. **Leverage competitor intelligence** for Blue Ocean opportunities
5. **Ground all claims in data** - no generic advice
6. **If data is missing**, explicitly state "Not found in research data"
7. **Priority**: Use top-performing posts metadata for format/hook/topic patterns
`;

  return output;
}
