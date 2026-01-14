import { ContentMixConfig } from '../../config';

export const STYLE_ANALYSIS_SYSTEM = `You are a Visual Brand Analyst specializing in Instagram content. 
Your job is to analyze existing posts and extract a precise visual DNA that can be used to generate new, consistent content.

Be EXTREMELY specific with colors (provide exact hex codes), typography descriptions, and composition patterns.
This analysis will be used to prompt AI image generators, so precision is critical.`;

export function buildStyleAnalysisPrompt(clientPosts: unknown[]): string {
  // Filter to only posts with media
  const postsWithMedia = (clientPosts as any[]).filter(p => 
    p.displayUrl || p.videoUrl
  );

  return `Analyze these ${postsWithMedia.length} Instagram posts from the client and extract their VISUAL BRAND DNA.

═══════════════════════════════════════
CLIENT'S EXISTING POSTS
═══════════════════════════════════════
${JSON.stringify(postsWithMedia.map(p => ({
  postType: p.postType,
  displayUrl: p.displayUrl,
  caption: p.caption?.slice(0, 200),
  likesCount: p.likesCount,
})), null, 2)}

Based on the captions and content themes, analyze and extract the visual patterns.

Return JSON with this structure:
{
  "brandVisualDNA": {
    "primaryColors": [
      {"hex": "#XXXXXX", "name": "descriptive name", "usage": "backgrounds/text/accents"}
    ],
    "secondaryColors": [
      {"hex": "#XXXXXX", "name": "descriptive name", "usage": "highlights/borders"}
    ],
    "colorPaletteNotes": "Specific observations about color combinations (e.g. 'Deep Orange + Brown' or 'White + Purple')",
    
    "typography": {
      "headlineStyle": "bold/light/script/modern/traditional",
      "preferredFonts": ["Font suggestions based on aesthetic"],
      "textPlacement": "centered/left-aligned/overlay-bottom/overlay-top",
      "textShadow": true | false,
      "textBackgroundBox": true | false
    },
    
    "composition": {
      "primaryStyle": "minimalist/busy/balanced/asymmetric",
      "whitespaceUsage": "heavy/moderate/minimal",
      "gridPattern": "rule-of-thirds/centered/dynamic",
      "borderStyle": "none/thin-white/thick-colored/rounded"
    },
    
    "lighting": {
      "primaryStyle": "natural/studio/dramatic/soft/golden-hour",
      "contrast": "high/medium/low",
      "saturation": "vibrant/muted/desaturated"
    },
    
    "islamicElements": {
      "useGeometricPatterns": true | false,
      "patternStyle": "arabesque/geometric/calligraphy/subtle",
      "frequencyOfIslamicMotifs": "every-post/occasionally/rarely"
    },
    
    "imageStyle": {
      "realism": "photorealistic/illustrated/mixed",
      "subjects": "objects/abstract/nature/technology (NOTE: Verify if faces are used or avoided)",
      "faceless": true, // Check if the brand avoids showing human faces
      "backgroundStyle": "solid-color/gradient/textured/photography",
      "moodBoard": ["3-5 aesthetic keywords that define the look"]
    },
    
    "contentTypeStyles": {
      "reels": {
        "openingFrame": "text-overlay/action-shot/question",
        "transitionStyle": "cut/fade/zoom/swipe",
        "textAnimations": "fade-in/pop/slide"
      },
      "carousels": {
        "slideCount": "typical number of slides",
        "slideFlow": "numbered/story-based/tip-by-tip",
        "coverSlideStyle": "bold-headline/question/visual"
      },
      "singleImages": {
        "preferredFormat": "quote-card/photo/infographic",
        "textOverlayUsage": "always/sometimes/never"
      }
    }
  },
  
  "aiImagePromptModifiers": {
    "styleKeywords": ["5-7 keywords to append to every image prompt"],
    "qualityModifiers": ["professional", "high detail", "instagram-ready"],
    "avoidKeywords": ["things to exclude from prompts"],
    "aspectRatioPreferences": {
      "reels": "9:16",
      "carousels": "4:5 or 1:1",
      "posts": "1:1 or 4:5"
    }
  },
  
  "examplePromptTemplate": "A complete example DALL-E prompt that captures this brand's style"
}`;
}
