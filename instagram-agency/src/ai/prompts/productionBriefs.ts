export const PRODUCTION_BRIEFS_SYSTEM = `You are the Creative Director for an Instagram content creator. Create 7 PREMIUM, PRODUCTION-READY content briefs.

CRITICAL REQUIREMENTS:
1. HYPER-SPECIFIC - Exact text overlays, timing, colors, fonts
2. BRAND-PERFECT - Match their voice, aesthetic, and emotional signature
3. PRODUCTION-READY - Scene-by-scene (video) / Slide-by-slide (carousel)
4. STRATEGICALLY VARIED - Mix of formats across the week
5. CAPTION VARIANTS - Provide 3 caption options per post (A/B testing)
6. VISUAL CONCEPTS - Include Midjourney-style prompts for each visual
7. ISLAMIC CALENDAR AWARE - Incorporate relevant Islamic context (Jummah, etc.)

Each brief should be SO detailed that a production team can execute it perfectly on the FIRST try.`;

export function buildProductionBriefsPrompt(
  brandDna: unknown,
  competitorIntel: unknown,
  trendAnalysis: unknown
): string {
  return `Create 7 PREMIUM production briefs using ALL of this intelligence:

CLIENT BRAND DNA:
${JSON.stringify(brandDna, null, 2)}

COMPETITOR INTELLIGENCE:
${JSON.stringify(competitorIntel, null, 2)}

TREND ANALYSIS:
${JSON.stringify(trendAnalysis, null, 2)}

Return JSON with:
{
  "weeklyContentPlan": [
    {
      "day": 1,
      "postingTime": "HH:MM UTC",
      "contentType": "video|carousel|single_image",
      "brief": {
        "title": "Internal name",
        "concept": "Core idea",
        "angle": "Unique hook",
        "targetEmotion": "Primary feeling",
        "hook": {"type": "...", "content": "Exact first 3 seconds/line"}
      },
      "visualDirection": {
        "style": "Overall aesthetic",
        "colorPalette": ["#hex1", "#hex2"],
        "midjourneyPrompt": "Detailed visual prompt for AI image generation",
        "moodReference": "Reference to similar aesthetic"
      },
      "sceneBreakdown": [
        {"scene": 1, "duration": "0:00-0:03", "visual": "...", "textOverlay": {}, "audio": "..."}
      ],
      "slideBreakdown": [
        {"slide": 1, "headline": "...", "body": "...", "visualElement": "...", "designNotes": "..."}
      ],
      "captionVariants": {
        "optionA": "Full caption - ENGAGING style",
        "optionB": "Full caption - EDUCATIONAL style",
        "optionC": "Full caption - INSPIRATIONAL style",
        "recommended": "A|B|C"
      },
      "hashtags": {
        "primary": ["top 5 must-use"],
        "secondary": ["5 niche hashtags"],
        "trending": ["3 trending hashtags"]
      },
      "technicalSpecs": {
        "aspectRatio": "9:16|1:1|4:5",
        "duration": "seconds for videos",
        "slideCount": "for carousels"
      },
      "engagementStrategy": {
        "ctaType": "save|share|comment|follow",
        "firstComment": "Engagement-boosting comment to post"
      }
    }
  ],
  "weeklyStrategy": {
    "theme": "Overarching narrative",
    "contentMix": {"videos": N, "carousels": N, "images": N},
    "emotionalArc": "How the week builds",
    "islamicContext": "Relevant Islamic events/themes"
  },
  "productionNotes": {
    "mustRemember": ["Critical brand elements"],
    "commonMistakes": ["What to avoid"],
    "proTips": ["Insider techniques"]
  }
}`;
}
