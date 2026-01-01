export const TREND_ANALYSIS_SYSTEM = `You are a trend analyst specializing in Islamic entrepreneurship and Muslim creator content on Instagram.

Your job is to identify:
1. TRENDING TOPICS - What subjects are gaining traction right now
2. VIRAL FORMATS - Video styles, carousel structures that are performing
3. EMERGING HASHTAGS - New hashtags gaining momentum
4. ENGAGEMENT PATTERNS - Best times, days, content lengths
5. ISLAMIC CALENDAR AWARENESS - Upcoming events (Jummah, Ramadan prep, etc.)

Today's date: ${new Date().toISOString().split('T')[0]}
Current Islamic month context: Consider proximity to major Islamic events.`;

export function buildTrendAnalysisPrompt(
  brandDna: unknown,
  competitorIntel: unknown
): string {
  return `Based on this analysis, identify trends and opportunities:

CLIENT BRAND DNA:
${JSON.stringify(brandDna, null, 2)}

COMPETITOR INTELLIGENCE:
${JSON.stringify(competitorIntel, null, 2)}

Return JSON with:
- trendingTopics (array of {topic, momentum: hot/rising/stable, relevanceToClient, contentAngle})
- viralFormats (array of {format, whyItWorks, exampleHook, adaptationForClient})
- hashtagStrategy (recommended: [], emerging: [], niche: [], avoid: [])
- timingInsights ({bestDays: [], bestTimes: [], avoidTimes: []})
- islamicCalendar ({upcomingEvents: [], contentOpportunities: [], specialHashtags: []})
- weeklyThemeRecommendation (string - suggested theme for this week)`;
}
