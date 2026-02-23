/**
 * Main RAG Retriever (Orchestrator)
 * 
 * Coordinates all context retrievers and provides the main API
 */

import { DataQualityScore, crossReferenceData } from './data-quality';
import { BusinessContext, getBusinessContext } from './business-context';
import { AIInsights, getAIInsights } from './ai-insights';
import { CompetitorContext, CompetitorContextMode, getCompetitorContext } from './competitor-context';
import { SocialContext, CommunityContext, getSocialContext, getCommunityContext } from './social-community-context';
import { ContentIntelligence, getContentIntelligence } from './content-intelligence';
import {
  MediaAnalysisSummary,
  getMediaAnalysisContext,
  formatMediaAnalysisForLLM,
} from './media-analysis-context';
import {
  BrainProfileContext,
  getBrainProfileContext,
} from './brain-profile-context';
import { buildRagReadinessScope } from './readiness-context';
import { getUserSuppliedContexts, formatUserContextForLLM, type UserSuppliedContextEntry } from './user-context';

export interface ResearchContext {
  business: BusinessContext;
  brainProfile: BrainProfileContext;
  aiInsights: AIInsights;
  competitors: CompetitorContext;
  socialData: SocialContext;
  community: CommunityContext;
  contentIntelligence: ContentIntelligence;
  mediaAnalysis: MediaAnalysisSummary;
  userSupplied: UserSuppliedContextEntry[];
  readiness: {
    allowedStatuses: Array<'READY' | 'DEGRADED'>;
    clientCounts: Record<'READY' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN', number>;
    competitorCounts: Record<'READY' | 'DEGRADED' | 'BLOCKED' | 'UNKNOWN', number>;
    hasClientReady: boolean;
    hasCompetitorReady: boolean;
  };
  overallQuality: DataQualityScore;
  warnings: string[];
  missingData: string[];
}

export interface GetFullResearchContextOptions {
  competitorContextMode?: CompetitorContextMode;
}

/**
 * Main function: Get full research context with comprehensive validation
 */
export async function getFullResearchContext(
  researchJobId: string,
  options: GetFullResearchContextOptions = {}
): Promise<ResearchContext> {
  console.log(`[RAG] Fetching context for job: ${researchJobId}`);

  const readinessScope = await buildRagReadinessScope(researchJobId, {
    allowDegraded: process.env.RAG_ALLOW_DEGRADED_CONTEXT === 'true',
  });

  const [business, brainProfile, aiInsights, competitors, socialData, community, contentIntelligence, mediaAnalysis, userSupplied] = await Promise.all([
    getBusinessContext(researchJobId),
    getBrainProfileContext(researchJobId).catch((err) => {
      console.warn('[RAG] Failed to load brain profile context:', err?.message || err);
      return {
        businessType: null,
        offerModel: null,
        primaryGoal: null,
        secondaryGoals: [],
        goals: [],
        targetMarket: null,
        geoScope: null,
        websiteDomain: null,
        channels: [],
        constraints: null,
        hasData: false,
      } as BrainProfileContext;
    }),
    getAIInsights(researchJobId),
    getCompetitorContext(researchJobId, readinessScope, {
      mode: options.competitorContextMode || 'strict',
    }),
    getSocialContext(researchJobId),
    getCommunityContext(researchJobId),
    getContentIntelligence(researchJobId, readinessScope).catch(() => ({
      client: { crossPlatform: { totalPosts: 0, overallEngagementRate: 0, bestPerformingPlatform: 'N/A', contentConsistency: 0, multiPlatformPillars: [] } },
      competitors: [],
      benchmarks: { avgLikesPerPost: 0, avgCommentsPerPost: 0, avgEngagementRate: 0, topFormats: [], topThemes: [], bestPostingTimes: [] },
      insights: { topOpportunities: [], contentGaps: [], blueOceanAreas: [], recommendedPillars: [] },
      qualityScore: { source: 'content-intelligence', score: 0, issues: ['Failed to load'], warnings: [], isReliable: false }
    })),
    getMediaAnalysisContext(researchJobId, {
      allowDegradedSnapshots: process.env.RAG_ALLOW_DEGRADED_CONTEXT === 'true',
      requireScopedCompetitors: true,
      maxClientSnapshots: 8,
      maxCompetitorSnapshots: 24,
      maxPostsPerSnapshot: 120,
    }).catch(() => ({
      client: { total: 0, byType: {}, recommendations: [], visualFixes: [] },
      competitor: { total: 0, byType: {}, recommendations: [], competitorAngles: [], visualFixes: [] },
      recurringRecommendations: [],
      hasData: false,
    })),
    getUserSuppliedContexts(researchJobId).catch(() => [] as UserSuppliedContextEntry[]),
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
  if (!readinessScope.hasClientReady) {
    missingData.push('No readiness-qualified client snapshots');
  }
  if (!readinessScope.hasCompetitorReady) {
    missingData.push('No readiness-qualified competitor snapshots');
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
    brainProfile,
    aiInsights,
    competitors,
    socialData,
    community,
    contentIntelligence,
    mediaAnalysis,
    userSupplied,
    readiness: {
      allowedStatuses: readinessScope.allowedStatuses,
      clientCounts: readinessScope.clientCounts,
      competitorCounts: readinessScope.competitorCounts,
      hasClientReady: readinessScope.hasClientReady,
      hasCompetitorReady: readinessScope.hasCompetitorReady,
    },
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
  // Section 0: User-Supplied Context (HIGHEST PRIORITY - inserted first)
  let output = '';
  if (context.userSupplied.length > 0) {
    output += formatUserContextForLLM(context.userSupplied);
  }

  // Section 1: Quality Overview
  output += `# Research Data Quality: ${context.overallQuality.score.toFixed(1)}/100 ${context.overallQuality.isReliable ? '✓ RELIABLE' : '⚠️ NEEDS VALIDATION'}

`;

  output += `## Snapshot Readiness Gate
- **Allowed Snapshot Statuses**: ${context.readiness.allowedStatuses.join(', ')}
- **Client Snapshots**: READY=${context.readiness.clientCounts.READY}, DEGRADED=${context.readiness.clientCounts.DEGRADED}, BLOCKED=${context.readiness.clientCounts.BLOCKED}
- **Competitor Snapshots**: READY=${context.readiness.competitorCounts.READY}, DEGRADED=${context.readiness.competitorCounts.DEGRADED}, BLOCKED=${context.readiness.competitorCounts.BLOCKED}
- **Readiness Rule**: If competitor READY snapshots are 0, avoid numeric competitor claims and keep recommendations directional.

`;

  // Section 2: Business Context
  const primaryWebsite = context.business.website || (context.brainProfile.hasData ? context.brainProfile.websiteDomain : null) || 'Not available';
  const secondaryWebsite = context.business.website && context.brainProfile.hasData && context.brainProfile.websiteDomain && context.brainProfile.websiteDomain !== context.business.website
    ? context.brainProfile.websiteDomain
    : null;
  const websiteDisplay = secondaryWebsite ? `${primaryWebsite} (also: ${secondaryWebsite})` : primaryWebsite;

  output += `## Business Profile
- **Name**: ${context.business.name}
- **Handle**: ${context.business.handle || 'Not available'}
- **Website**: ${websiteDisplay}
- **Bio**: ${context.business.bio || 'Not available'}
- **Search Results**: ${context.business.searchResults.length} sources

`;

  // Section 2b: Client Intake / BAT Brain (saved intake data - USE THIS when available)
  const bp = context.brainProfile;
  if (bp.hasData) {
    output += `## Client Intake / BAT Brain Profile (SAVED INTAKE DATA - PRIORITY SOURCE)
- **Business Type**: ${bp.businessType || 'Not specified'}
- **Offer Model**: ${bp.offerModel || 'Not specified'}
- **Primary Goal**: ${bp.primaryGoal || 'Not specified'}
- **Target Market**: ${bp.targetMarket || 'Not specified'}
- **Geo Scope**: ${bp.geoScope || 'Not specified'}
- **Website Domain**: ${bp.websiteDomain || 'Not specified'}
- **Secondary Goals**: ${bp.secondaryGoals.length > 0 ? bp.secondaryGoals.join('; ') : 'None'}
- **Structured Goals**: ${bp.goals.length > 0
    ? bp.goals
        .map((goal) => `${goal.goalType} (P${goal.priority})${goal.targetValue ? `: ${goal.targetValue}` : ''}`)
        .join(' | ')
    : 'None'}
- **Channels**: ${bp.channels.length > 0 ? bp.channels.map((c) => `${c.platform}:@${c.handle}`).join(', ') : 'None'}
${bp.constraints && Object.keys(bp.constraints).length > 0 ? `- **Constraints**: ${JSON.stringify(bp.constraints)}` : ''}

`;
  }

  // Section 3: AI Strategic Insights (The 13 Questions)
  const aiInsightsCount = Object.keys(context.aiInsights).filter(k => k !== 'qualityScore' && context.aiInsights[k as keyof typeof context.aiInsights]).length;
  output += `## AI Strategic Insights (${aiInsightsCount}/13 Questions Answered)

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
2. If a metric shows "Unknown", OMIT it or use "—" or "TBD" - never state "Not available in data" or "not found in research" in client-facing copy
3. DO NOT make up posting frequencies, follower counts, or engagement rates
4. DO NOT add metrics not shown in this table
5. This is VERIFIED data - treat it as the single source of truth
6. NEVER admit missing data in the final document - if unknown, omit the metric or phrase generically (e.g. "varies by platform")

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

  // Content Intelligence (client + competitor synthesis, gaps, opportunities, recommended pillars)
  const ci = context.contentIntelligence;
  output += `## Content Intelligence

`;
  output += `### Client Cross-Platform Summary
- **Total posts analyzed**: ${ci.client.crossPlatform.totalPosts}
- **Overall engagement rate**: ${(ci.client.crossPlatform.overallEngagementRate * 100).toFixed(2)}%
- **Best performing platform**: ${ci.client.crossPlatform.bestPerformingPlatform}
- **Content consistency score**: ${(ci.client.crossPlatform.contentConsistency * 100).toFixed(0)}%
- **Multi-platform pillars**: ${ci.client.crossPlatform.multiPlatformPillars.length > 0 ? ci.client.crossPlatform.multiPlatformPillars.join(', ') : 'None identified'}

`;

  if (ci.competitors.length > 0) {
    output += `### Competitor Content Analysis (Synthesized)
`;
    ci.competitors.slice(0, 10).forEach((comp, i) => {
      output += `${i + 1}. **@${comp.handle}** (${comp.platform}): ${comp.totalPosts} posts, ${(comp.avgEngagementRate * 100).toFixed(2)}% avg engagement
`;
      if (comp.strengths.length > 0) output += `   - Strengths: ${comp.strengths.slice(0, 5).join('; ')}\n`;
      if (comp.weaknesses.length > 0) output += `   - Weaknesses: ${comp.weaknesses.slice(0, 3).join('; ')}\n`;
      if (comp.opportunities.length > 0) output += `   - Opportunities for client: ${comp.opportunities.slice(0, 3).join('; ')}\n`;
      if (comp.pillars.length > 0) output += `   - Pillars: ${comp.pillars.map(p => p.name).slice(0, 5).join(', ')}\n`;
      if (comp.formatBreakdown.length > 0) output += `   - Formats: ${comp.formatBreakdown.map(f => `${f.format} ${f.percentage.toFixed(0)}%`).slice(0, 5).join(', ')}\n`;
      output += '\n';
    });
  }

  output += `### Benchmarks
- Avg likes/post: ${ci.benchmarks.avgLikesPerPost.toLocaleString()}; Avg comments/post: ${ci.benchmarks.avgCommentsPerPost.toLocaleString()}; Avg engagement: ${(ci.benchmarks.avgEngagementRate * 100).toFixed(2)}%
`;
  if (ci.benchmarks.topFormats.length > 0) {
    output += `- Top formats: ${ci.benchmarks.topFormats.slice(0, 5).map(f => `${f.format} (${f.percentage.toFixed(0)}%)`).join(', ')}\n`;
  }
  if (ci.benchmarks.topThemes.length > 0) {
    output += `- Top themes: ${ci.benchmarks.topThemes.slice(0, 5).map(t => `${t.theme} (${t.percentage.toFixed(0)}%)`).join(', ')}\n`;
  }
  output += '\n';

  if (ci.insights.topOpportunities.length > 0) {
    output += `### Top Content Opportunities
${ci.insights.topOpportunities.slice(0, 8).map(o => `- [${o.potentialImpact}] ${o.description} (${o.evidence})\n`).join('')}
`;
  }
  if (ci.insights.contentGaps.length > 0) {
    output += `### Content Gaps (client under-indexed)
${ci.insights.contentGaps.slice(0, 6).map(g => `- **${g.area}**: ${g.description}. Competitor examples: ${g.competitorExamples.slice(0, 2).join(', ')}. Recommendation: ${g.recommendation}\n`).join('')}
`;
  }
  if (ci.insights.blueOceanAreas.length > 0) {
    output += `### Blue Ocean Areas
${ci.insights.blueOceanAreas.slice(0, 5).map(b => `- **${b.area}**: ${b.reasoning}. Competitors covering: ${b.competitorsCovering}. Client advantage: ${b.clientAdvantage}\n`).join('')}
`;
  }
  if (ci.insights.recommendedPillars.length > 0) {
    output += `### Recommended Content Pillars (data-backed)
${ci.insights.recommendedPillars.slice(0, 6).map(p => `- **${p.name}**: ${p.rationale}. Audience: ${p.targetAudience}. Formats: ${p.formatRecommendations.slice(0, 3).join(', ')}. Example topics: ${p.exampleTopics.slice(0, 3).join(', ')}\n`).join('')}
`;
  }
  output += `
**Use this section** for Content Analysis, Content Pillars, and Format Recommendations. Cite specific opportunities, gaps, and recommended pillars when making recommendations.

`;

  // Media creative analysis (per-asset AI feedback: hooks, scroll-stopping, actionable fixes)
  output += formatMediaAnalysisForLLM(context.mediaAnalysis);

  // Platform Performance Analysis
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
3. **Base personas on AI insights** from the 13 strategic questions
4. **Leverage competitor intelligence** for Blue Ocean opportunities
5. **Ground all claims in data** - no generic advice
6. **If data is missing**, omit the metric or use "—" or "TBD" - NEVER write "Not available in data", "not found in research", or similar disclaimers in client-facing copy
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

**MISSING DATA**: Never admit missing data in the final document. If a metric is unknown, omit it, use "—", or phrase generically (e.g. "varies by platform"). Phrases like "Not available in data" or "not found in research" fail validation.

**VERIFICATION CHECKPOINT**: Before including any metric, campaign, or projection:
- Can you point to the exact line in the research context above?
- Is it in the VERIFIED COMPETITOR DATA table?
- For hashtags: Does it appear in "Competitor Content Deep Dive" post captions?
- For content patterns: Can you cite specific posts from "Competitor Content Deep Dive"?
- If NO to all → DO NOT INCLUDE IT
`;

  return output;
}
