import { ContentMixConfig } from '../../config';

export function buildProductionBriefsSystemPrompt(
  contentMix: ContentMixConfig,
  clientUsername: string
): string {
  const totalPosts = contentMix.postsPerWeek;
  const reels = Math.round(totalPosts * contentMix.reelsPercentage / 100);
  const carousels = Math.round(totalPosts * contentMix.carouselsPercentage / 100);
  const images = Math.round(totalPosts * contentMix.imagesPercentage / 100);
  const stories = Math.round(totalPosts * contentMix.storiesPercentage / 100);

  return `You are an ELITE Creative Director for @${clientUsername}. Your content must be BETTER than what the client produces themselves.

CONTENT REQUIREMENTS:
- Generate exactly ${totalPosts} pieces of content for this week
- Content Mix: ${reels} Reels, ${carousels} Carousels, ${images} Single Images, ${stories} Stories
- Each piece must be PRODUCTION-READY - executable on the FIRST try
- Content must be INDISTINGUISHABLE from the client's best work

QUALITY STANDARDS:
1. HYPER-SPECIFIC - No vague instructions. Exact text, colors, timing, everything.
2. BRAND-LOCKED - Every piece must match the client's voice (Authoritative, Islamic, Actionable).
3. CONTEXT-RICH - Include brand fingerprint with each brief so visuals stay on-brand.
4. BETTER THAN CLIENT - Study what works and elevate it. Don't just copy, improve.

CRITICAL VISUAL RULES (NON-NEGOTIABLE):
- NO TEXT IN GENERATED IMAGES: All text must be added as overlay in post-production.
- NO FACES: Use faceless aesthetic (back of head, hands, silhouettes, objects).
- COLOR PALETTE: Stick to deep warm oranges/browns or professional white/purple/orange themes.

FOR REELS/VIDEOS:
- Generate 3-5 COMPLETE SCENES (each scene is a distinct visual frame)
- Scene-by-scene breakdown (3-5 second intervals)
- Exact text overlays with font, size, position
- Audio direction: trending sounds OR original audio script
- Transition types between scenes
- Hook in first 1.5 seconds
- VISUAL STYLE: Desert tones, Arabian atmosphere, people shown from BACK only in traditional clothing

FOR CAROUSELS:
- Slide-by-slide breakdown (exact content per slide)
- Design notes: layout, text placement, visual hierarchy
- Flow logic: how each slide builds on the previous
- Optimal slide count (7-10 performs best)

FOR SINGLE IMAGES:
- Complete visual description
- Text overlay if any (exact words, font, position)
- Color palette locked to brand
- Mood and lighting direction

FOR STORIES:
- Interactive elements (polls, questions, sliders)
- Series structure if multi-story
- Direct engagement hooks

EVERY BRIEF MUST INCLUDE:
1. Brand DNA Fingerprint - Key elements that make this "feel like" @${clientUsername}
2. Reference Feel - 2-3 characteristics from client's top posts this should match
3. AI Image Prompt - Ready-to-use Midjourney/DALL-E prompt matching client aesthetic
4. Caption Variants - 3 options (Engaging, Educational, Inspirational)
5. Engagement Strategy - Specific CTA and first comment to boost

Your output must be SO detailed that a production team with no context about the client can execute perfectly.`;
}

export function buildProductionBriefsPrompt(
  brandDna: unknown,
  competitorIntel: unknown,
  trendAnalysis: unknown,
  contentMix: ContentMixConfig,
  batchStart: number, // e.g. 1
  batchEnd: number    // e.g. 7
): string {
  const batchSize = batchEnd - batchStart + 1;
  const isFirstBatch = batchStart === 1;
  
  // Calculate approximate mix for this batch (proportional)
  const totalPosts = contentMix.postsPerWeek;
  const batchRatio = batchSize / totalPosts;
  
  const reels = Math.round(totalPosts * contentMix.reelsPercentage / 100 * batchRatio);
  const carousels = Math.round(totalPosts * contentMix.carouselsPercentage / 100 * batchRatio);
  const images = Math.round(totalPosts * contentMix.imagesPercentage / 100 * batchRatio);
  const stories = Math.round(totalPosts * contentMix.storiesPercentage / 100 * batchRatio);

  return `Create ${batchSize} PRODUCTION-READY content briefs (Posts ${batchStart} to ${batchEnd}) using ALL of this intelligence:

═══════════════════════════════════════
CLIENT BRAND DNA (THIS IS YOUR BIBLE)
═══════════════════════════════════════
${JSON.stringify(brandDna, null, 2)}

═══════════════════════════════════════
COMPETITOR INTELLIGENCE (BEAT THEM ALL)
═══════════════════════════════════════
${JSON.stringify(competitorIntel, null, 2)}

═══════════════════════════════════════
TREND ANALYSIS (RIDE THE WAVE)
═══════════════════════════════════════
${JSON.stringify(trendAnalysis, null, 2)}

═══════════════════════════════════════
REQUIRED CONTENT MIX FOR THIS BATCH
═══════════════════════════════════════
- ~${reels} Reels/Videos
- ~${carousels} Carousels
- ~${images} Single Images
- ~${stories} Stories
- Total: ${batchSize} pieces (Post #${batchStart} to #${batchEnd})

Return JSON with this EXACT structure:
{
  "weeklyContentPlan": [
    {
      "postNumber": ${batchStart},
      "dayOfWeek": "Monday|Tuesday|...",
      "postingTime": "HH:MM UTC",
      "contentType": "reel|carousel|image|story",
      
      "brandFingerprint": {
        "mustInclude": ["3-5 brand elements that MUST appear"],
        "tonalMarkers": ["emotional/voice characteristics to hit"],
        "visualSignature": "The visual 'feel' this must have"
      },
      
      "brief": {
        "internalTitle": "Short reference name",
        "concept": "The core idea in one sentence",
        "angle": "What makes this unique/different",
        "targetEmotion": "Primary feeling to evoke",
        "hook": {
          "type": "question|statement|shock|curiosity|relatability",
          "exactContent": "The EXACT first line/frame (word for word)",
          "whyItWorks": "Psychology behind this hook"
        }
      },
      
      "visualDirection": {
        "overallStyle": "Aesthetic description",
        "colorPalette": ["#hex1", "#hex2", "#hex3"],
        "lighting": "Natural/studio/dramatic/soft/golden hour",
        "composition": "Rule of thirds/centered/dynamic",
        "aiImagePrompt": "Complete Midjourney/DALL-E prompt. MUST BE FACELESS. MUST NOT CONTAIN TEXT. Focus on atmospheric, metaphorical, or object-based visuals."
      },
      
      "sceneBreakdown": [
        {
          "scene": 1,
          "timeRange": "0:00-0:03",
          "visual": "Exact description of what appears",
          "textOverlay": {
            "text": "Exact words",
            "font": "Font name",
            "size": "large|medium|small",
            "position": "center|top|bottom",
            "animation": "fade-in|pop|slide"
          },
          "audio": "Trending sound name OR voiceover script",
          "transition": "cut|fade|swipe|zoom"
        }
      ],
      
      "slideBreakdown": [
        {
          "slideNumber": 1,
          "headline": "Main text",
          "body": "Supporting text if any",
          "visualElement": "What image/graphic appears",
          "layout": "Text-left|Text-right|Centered|Full-bleed",
          "designNotes": "Specific design instructions"
        }
      ],
      
      "captionVariants": {
        "engaging": {
          "caption": "Full caption with emojis",
          "hashtags": ["10-15 hashtags"]
        },
        "educational": {
          "caption": "Full caption with value focus",
          "hashtags": ["10-15 hashtags"]
        },
        "inspirational": {
          "caption": "Full caption with emotional pull",
          "hashtags": ["10-15 hashtags"]
        },
        "recommended": "engaging|educational|inspirational"
      },
      
      "technicalSpecs": {
        "aspectRatio": "9:16|4:5|1:1",
        "duration": "seconds (for video/reel)",
        "slideCount": "number (for carousel)",
        "fileFormat": "MP4|JPG|PNG"
      },
      
      "engagementStrategy": {
        "primaryCTA": "save|share|comment|follow|link",
        "ctaPlacement": "Where in content the CTA appears",
        "firstComment": "Exact comment to post for engagement boost",
        "replyStrategy": "How to respond to first 10 comments"
      },
      
      "storyElements": {
        "interactiveType": "poll|question|slider|quiz|none",
        "interactiveContent": "The actual poll/question text",
        "seriesPart": "1 of 3 or standalone"
      }
    }
  ],
  
  ${isFirstBatch ? `"weeklyStrategy": {
    "overarchingTheme": "The narrative thread connecting all content",
    "emotionalArc": "How energy/emotion builds through the week",
    "contentMix": {
      "reels": ${Math.round(totalPosts * contentMix.reelsPercentage / 100)},
      "carousels": ${Math.round(totalPosts * contentMix.carouselsPercentage / 100)},
      "images": ${Math.round(totalPosts * contentMix.imagesPercentage / 100)},
      "stories": ${Math.round(totalPosts * contentMix.storiesPercentage / 100)}
    },
    "islamicContext": "Any relevant Islamic dates/themes",
    "competitiveEdge": "What this week does BETTER than competitors"
  },` : ''}
  
  "productionNotes": {
    "brandNonNegotiables": ["Things that MUST appear in every piece"],
    "commonMistakes": ["What to avoid based on competitor analysis"],
    "proTips": ["Insider techniques from top-performing content"],
    "qualityChecklist": ["5 things to verify before posting"]
  }
}`;
}

// Legacy export for backward compatibility
export const PRODUCTION_BRIEFS_SYSTEM = `You are the Creative Director for an Instagram content creator. Create PREMIUM, PRODUCTION-READY content briefs.`;
