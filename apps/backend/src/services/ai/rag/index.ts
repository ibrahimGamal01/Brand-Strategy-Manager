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
import { ContentIntelligence, getContentIntelligence } from './content-intelligence';

export interface ResearchContext {
  business: BusinessContext;
  aiInsights: AIInsights;
  competitors: CompetitorContext;
  socialData: SocialContext;
  community: CommunityContext;
  contentIntelligence: ContentIntelligence; // NEW: Deep content analysis
  overallQuality: DataQualityScore;
  warnings: string[];
  missingData: string[];
}

/**
 * Main function: Get full research context with comprehensive validation
 */
export async function getFullResearchContext(researchJobId: string): Promise<ResearchContext> {
  console.log(`[RAG] Fetching context for job: ${researchJobId}`);

  const [business, aiInsights, competitors, socialData, community, contentIntelligence] = await Promise.all([
    getBusinessContext(researchJobId),
    getAIInsights(researchJobId),
    getCompetitorContext(researchJobId),
    getSocialContext(researchJobId),
    getCommunityContext(researchJobId),
    getContentIntelligence(researchJobId).catch(() => ({
      client: { crossPlatform: { totalPosts: 0, overallEngagementRate: 0, bestPerformingPlatform: 'N/A', contentConsistency: 0, multiPlatformPillars: [] } },
      competitors: [],
      benchmarks: { avgLikesPerPost: 0, avgCommentsPerPost: 0, avgEngagementRate: 0, topFormats: [], topThemes: [], bestPostingTimes: [] },
      insights: { topOpportunities: [], contentGaps: [], blueOceanAreas: [], recommendedPillars: [] },
      qualityScore: { source: 'content-intelligence', score: 0, issues: ['Failed to load'], warnings: [], isReliable: false }
    }))
  ]);

  const crossRefIssues = crossReferenceData(aiInsights, competitors.all10);

  const allWarnings: string[] = [
    ...business.qualityScore.warnings,
    ...aiInsights.qualityScore.warnings,
    ...competitors.overallQuality.warnings,
    ...socialData.qualityScore.warnings,
    ...community.qualityScore.warnings,
    ...contentIntelligence.qualityScore.warnings,
    ...crossRefIssues
  ];

  const allIssues: string[] = [
    ...business.qualityScore.issues,
    ...aiInsights.qualityScore.issues,
    ...competitors.overallQuality.issues,
    ...socialData.qualityScore.issues,
    ...community.qualityScore.issues,
    ...contentIntelligence.qualityScore.issues
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
    community.qualityScore.score,
    contentIntelligence.qualityScore.score
  ].reduce((a, b) => a + b, 0) / 6; // Now divided by 6

  const overallQuality: DataQualityScore = {
    source: 'overall',
    score: avgScore,
    issues: allIssues,
    warnings: allWarnings,
    isReliable: avgScore >= 70
  };

  console.log(`[RAG] Quality: ${avgScore.toFixed(1)}/100, Issues: ${allIssues.length}, Warnings: ${allWarnings.length}`)

  return {
    business,
    aiInsights,
    competitors,
    socialData,
    community,
    contentIntelligence,
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

  // Section 4: VERIFIED COMPETITOR DATA (Critical for preventing hallucinations)
  output += `## ⚠️ VERIFIED COMPETITOR DATA - USE THESE EXACT NUMBERS ⚠️

### Competitor Metrics Table (VERIFIED FROM DATABASE)

`;

  // Add platform summary
  const instagramCount = context.competitors.all10.filter(c => c.platform.toLowerCase() === 'instagram').length;
  const tiktokCount = context.competitors.all10.filter(c => c.platform.toLowerCase() === 'tiktok').length;
  
  output += `**Platform Distribution**: ${instagramCount} Instagram, ${tiktokCount} TikTok\n\n`;
  
  output += `| Handle | Platform | Followers | Posts/Week | Avg Engagement |
|--------|----------|-----------|------------|----------------|
`;

  // Add verified metrics for all competitors
  if (context.competitors.all10.length > 0) {
    context.competitors.all10.forEach(comp => {
      const followers = comp.followers ? comp.followers.toLocaleString() : 'Unknown';
      const postingFreq = comp.postingFreq || 'Unknown';
      const engagement = comp.engagement || 'Unknown';
      output += `| @${comp.handle} | ${comp.platform} | ${followers} | ${postingFreq} | ${engagement} |\n`;
    });
  } else {
    output += `| (No competitors found) | - | - | - | - |\n`;
  }

  output += `
**CRITICAL INSTRUCTIONS FOR USING THIS DATA**:
1. When mentioning ANY competitor metric, use ONLY the numbers from this table
2. If a metric shows "Unknown", write "Not available in data" - DO NOT estimate
3. DO NOT make up posting frequencies, follower counts, or engagement rates
4. DO NOT add metrics not shown in this table
5. This is VERIFIED data - treat it as the single source of truth

`;

  // Section 5: Competitor Intelligence (narrative context)
  output += `## Competitor Landscape Context
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

  // NEW Section: Detailed Competitor Posts (Instagram & TikTok)
  output += `## Competitor Content Deep Dive\n\n`;
  output += `This section provides detailed post-level data from Instagram and TikTok competitors to inform content strategy.\n\n`;

  // Get detailed post data for each priority competitor
  if (context.competitors.priority3.length > 0) {
    context.competitors.priority3.forEach((comp, compIndex) => {
      if (comp.topPosts && comp.topPosts.length > 0) {
        output += `### ${compIndex + 1}. @${comp.handle} (${comp.platform}) - Recent Posts\n\n`;
        
        // Show up to 15 most recent posts per priority competitor
        const postsToShow = comp.topPosts.slice(0, 15);
        
        postsToShow.forEach((post, postIndex) => {
          const metadata = post.metadata as any || {};
          const caption = post.content || '';
          const mediaType = metadata.media_type || metadata.type || 'unknown';
          const likes = metadata.likes || metadata.like_count || 0;
          const comments = metadata.comments || metadata.comment_count || 0;
          const shares = metadata.shares || metadata.share_count || 0;
          const views = metadata.views || metadata.view_count || metadata.play_count || 0;
          const engagementRate = metadata.engagement_rate || 0;
          
          output += `#### Post ${postIndex + 1}: ${post.postedAt ? new Date(post.postedAt).toLocaleDateString() : 'Unknown date'}\n`;
          output += `- **Media Type**: ${mediaType}\n`;
          output += `- **Caption**: "${caption.substring(0, 300)}${caption.length > 300 ? '...' : ''}"\n`;
          output += `- **Metrics**: ${likes.toLocaleString()} likes, ${comments} comments`;
          if (shares > 0) output += `, ${shares} shares`;
          if (views > 0) output += `, ${views.toLocaleString()} views`;
          output += `\n`;
          if (engagementRate > 0) {
            output += `- **Engagement Rate**: ${(engagementRate * 100).toFixed(2)}%\n`;
          }
          
          // Extract hashtags from caption
          const hashtags = caption.match(/#\w+/g);
          if (hashtags && hashtags.length > 0) {
            output += `- **Hashtags**: ${hashtags.slice(0, 10).join(' ')}\n`;
          }
          
          output += `\n`;
        });
        
        output += `\n`;
      }
    });
  }

  // Section for ALL competitors' content patterns (not just priority 3)
  if (context.competitors.all10.length > 0) {
    output += `### All Competitors - Content Format Breakdown\n\n`;
    
    // Group by platform for clearer organization
    const instagramCompetitors = context.competitors.all10.filter(c => c.platform.toLowerCase() === 'instagram');
    const tiktokCompetitors = context.competitors.all10.filter(c => c.platform.toLowerCase() === 'tiktok');
    
    if (instagramCompetitors.length > 0) {
      output += `#### Instagram Competitors (${instagramCompetitors.length})\n`;
      instagramCompetitors.forEach((comp, idx) => {
        if (comp.topPosts && comp.topPosts.length >= 5) {
          const posts = comp.topPosts;
          const mediaTypes = posts.map(p => (p.metadata as any)?.media_type || (p.metadata as any)?.type).filter(Boolean);
          const mediaTypeCounts = mediaTypes.reduce((acc, type) => {
            acc[type as string] = ((acc[type as string] as number) || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          const totalPosts = posts.length;
          const formatBreakdown = Object.entries(mediaTypeCounts)
            .map(([type, count]) => `${type}: ${(((count as number) / totalPosts) * 100).toFixed(0)}%`)
            .join(', ');
          
          output += `- **@${comp.handle}** (${totalPosts} posts analyzed): ${formatBreakdown || 'Unknown formats'}\n`;
        }
      });
      output += `\n`;
    }
    
    if (tiktokCompetitors.length > 0) {
      output += `#### TikTok Competitors (${tiktokCompetitors.length})\n`;
      tiktokCompetitors.forEach((comp, idx) => {
        if (comp.topPosts && comp.topPosts.length >= 5) {
          const posts = comp.topPosts;
          const mediaTypes = posts.map(p => (p.metadata as any)?.media_type || (p.metadata as any)?.type).filter(Boolean);
          const mediaTypeCounts = mediaTypes.reduce((acc, type) => {
            acc[type as string] = ((acc[type as string] as number) || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          const totalPosts = posts.length;
          const formatBreakdown = Object.entries(mediaTypeCounts)
            .map(([type, count]) => `${type}: ${(((count as number) / totalPosts) * 100).toFixed(0)}%`)
            .join(', ');
          
          output += `- **@${comp.handle}** (${totalPosts} posts analyzed): ${formatBreakdown || 'Unknown formats'}\n`;
        }
      });
      output += `\n`;
    }
  }

  // NEW Section: Platform Performance Analysis
  if (context.socialData.platformMetrics.length > 0) {
    output += `## Platform Performance Analysis\n\n`;
    output += `### Platform Comparison Table\n\n`;
    output += `| Platform | Competitors | Avg Followers | Avg Engagement | Total Posts |\n`;
    output += `|----------|-------------|---------------|----------------|-------------|\n`;
    
    context.socialData.platformMetrics.forEach(platform => {
      const avgEng = platform.avgEngagementRate > 0 
        ? `${(platform.avgEngagementRate * 100).toFixed(1)}%` 
        : 'N/A';
      output += `| ${platform.platform} | ${platform.profileCount} | ${platform.avgFollowers.toLocaleString()} | ${avgEng} | ${platform.totalPosts} |\n`;
    });
    
    output += '\n';
    
    // Top performers by platform
    context.socialData.platformMetrics.forEach(platform => {
      if (platform.topPerformers.length > 0) {
        output += `### ${platform.platform} - Top Performers\n\n`;
        platform.topPerformers.forEach((performer, i) => {
          const engRate = performer.engagementRate > 0 
            ? `${(performer.engagementRate * 100).toFixed(1)}%` 
            : 'N/A';
          const postsFreq = performer.postsPerWeek > 0 
            ? `${performer.postsPerWeek}/week` 
            : 'Unknown';
          output += `${i + 1}. **@${performer.handle}**: ${performer.followers.toLocaleString()} followers, ${engRate} engagement, ${postsFreq}\n`;
        });
        output += '\n';
      }
    });
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

  // Section 9: Instructions for AI with explicit forbidden claims
  output += `---
## INSTRUCTIONS FOR CONTENT GENERATION
1. **Use SPECIFIC data** from the research above - cite handles, metrics, exact quotes
2. **Reference top-performing posts** when making content recommendations
3. **Base personas on AI insights** from the 12 strategic questions
4. **Leverage competitor intelligence** for Blue Ocean opportunities
5. **Ground all claims in data** - no generic advice
6. **If data is missing**, explicitly state "Not found in research data"
7. **Priority**: Use top-performing posts metadata for format/hook/topic patterns
8. **CRITICAL**: Use ONLY metrics from "VERIFIED COMPETITOR DATA" table above
9. **NEW**: Use "Competitor Content Deep Dive" section for detailed Instagram/TikTok post analysis
   - This section shows actual captions, hashtags, media types, and engagement for each competitor
   - When analyzing content formats, reference the specific posts shown
   - When identifying hashtags, use ONLY those appearing in actual post captions
   - When describing content patterns, cite specific post examples

## ⛔ FORBIDDEN CLAIMS - NEVER GENERATE THESE ⛔
1. **Market share projections** (e.g., "capture 15% market share by 2027") - UNLESS explicitly stated in research
2. **Hashtag campaigns** (e.g., "#FaithfulFounders") - UNLESS the hashtag appears in actual post content in "Competitor Content Deep Dive"
3. **Customer testimonials or quotes** - UNLESS they appear verbatim in research data with attribution
4. **Follower counts or engagement rates** - UNLESS from the VERIFIED COMPETITOR DATA table
5. **Posting frequencies** - UNLESS from the VERIFIED COMPETITOR DATA table
6. **Revenue targets or financial projections** - UNLESS explicitly in research
7. **Specific year goals** (e.g., "By 2027...") - UNLESS stated by client in research
8. **Made-up statistics** (e.g., "85% of users prefer...") - UNLESS from actual research data
9. **Content format percentages** - UNLESS from "Content Format Breakdown" section

**VERIFICATION CHECKPOINT**: Before including any metric, campaign, or projection:
- Can you point to the exact line in the research context above?
- Is it in the VERIFIED COMPETITOR DATA table?
- For hashtags: Does it appear in "Competitor Content Deep Dive" post captions?
- For content patterns: Can you cite specific posts from "Competitor Content Deep Dive"?
- If NO to all → DO NOT INCLUDE IT
`;

  return output;
}
