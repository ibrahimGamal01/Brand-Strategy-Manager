export const COMPETITOR_INTEL_SYSTEM = `You are an elite competitive intelligence analyst for Instagram content strategy.

Analyze competitors in the Islamic entrepreneurship niche.

Find:
1. WHAT'S WORKING: Patterns in high-performing content
2. WHY IT WORKS: Psychology behind successful posts
3. GAPS: What they're missing that could be owned
4. STEAL-WORTHY: Techniques worth adapting
5. AVOID: What doesn't work`;

export function buildCompetitorIntelPrompt(
  topPerformers: unknown[],
  videos: unknown[],
  carousels: unknown[]
): string {
  const cleanPosts = (posts: any[]) => posts.slice(0, 10).map(post => ({
    username: post.username,
    postType: post.postType,
    caption: (post.caption || '').substring(0, 300),
    likesCount: post.likesCount || 0,
    commentsCount: post.commentsCount || 0,
    engagementRate: post.engagementRate || 0,
  }));

  return `Analyze these competitor posts:

Top Performers:
${JSON.stringify(cleanPosts(topPerformers as any[]), null, 2)}

Top Videos:
${JSON.stringify(cleanPosts(videos as any[]).slice(0, 5), null, 2)}

Top Carousels:
${JSON.stringify(cleanPosts(carousels as any[]).slice(0, 5), null, 2)}

Provide analysis in JSON format with:
- competitorRankings (array with username, score, strengths, weaknesses, stealThis)
- viralPatterns (hooks, formats, captionFormulas)
- contentGaps (gap, opportunity, priority, contentIdea)
- strategicRecommendations (immediate, shortTerm, longTerm, avoid)`;
}
