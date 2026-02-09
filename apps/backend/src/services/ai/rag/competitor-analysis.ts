/**
 * Competitor Analysis Module
 * 
 * Analyze competitor content strategy and positioning
 */

import { CompetitorContentAnalysis, PlatformContent, PostAnalysis, FormatStats, ContentPillar } from './content-intelligence';
import { analyzePlatformContent } from './post-analysis';

/**
 * Analyze competitor content
 */
export async function analyzeCompetitorContent(competitors: any[]): Promise<CompetitorContentAnalysis[]> {
  return Promise.all(
    competitors
      .filter(c => c.socialProfile)
      .map(async (comp: any) => {
        const profile = comp.socialProfile;
        const platformContent = await analyzePlatformContent(profile);
        
        // Identify strengths/weaknesses/opportunities
        const { strengths, weaknesses, opportunities } = analyzeCompetitorPosition(platformContent);

        return {
          handle: comp.handle,
          platform: comp.platform,
          followers: profile.followers || 0,
          totalPosts: platformContent.totalPosts,
          pillars: platformContent.pillars,
          topPosts: platformContent.topPosts,
          formatBreakdown: platformContent.formatBreakdown,
          avgEngagementRate: platformContent.avgEngagementRate,
          strengths,
          weaknesses,
          opportunities
        };
      })
  );
}

/**
 * Analyze competitor's position
 */
export function analyzeCompetitorPosition(content: PlatformContent | {
  handle: string;
  totalPosts: number;
  pillars: ContentPillar[];
  topPosts: PostAnalysis[];
  formatBreakdown: FormatStats[];
  avgEngagementRate: number;
  postingFrequency: number;
}): {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
} {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];

  // High engagement = strength
  if (content.avgEngagementRate > 5) {
    strengths.push(`High engagement rate (${content.avgEngagementRate.toFixed(2)}%)`);
  } else if (content.avgEngagementRate < 2) {
    weaknesses.push(`Low engagement rate (${content.avgEngagementRate.toFixed(2)}%)`);
    opportunities.push('Create more engaging content in same niche');
  }

  // Posting frequency
  if (content.postingFrequency > 5) {
    strengths.push(`Consistent posting (${content.postingFrequency}/week)`);
  } else if (content.postingFrequency < 2) {
    weaknesses.push(`Infrequent posting (${content.postingFrequency}/week)`);
    opportunities.push('Outpace with higher posting frequency');
  }

  // Pillar diversity
  if (content.pillars.length > 5) {
    weaknesses.push(`Too many pillars (${content.pillars.length}) - diluted focus`);
    opportunities.push('Focus on 3-4 specific pillars');
  } else if (content.pillars.length < 2) {
    weaknesses.push('Limited content variety');
  }

  return { strengths, weaknesses, opportunities };
}
