/**
 * Image Prompt Builder
 * Transforms production brief prompts into optimized DALL-E 3 prompts
 * by injecting brand style DNA
 */

export interface BrandStyleDNA {
  brandVisualDNA?: {
    primaryColors?: Array<{ hex: string; name: string }>;
    secondaryColors?: Array<{ hex: string; name: string }>;
    lighting?: { primaryStyle: string; contrast: string; saturation: string };
    composition?: { primaryStyle: string; whitespaceUsage: string };
    imageStyle?: { realism: string; moodBoard?: string[] };
    islamicElements?: { useGeometricPatterns: boolean; patternStyle: string };
  };
  aiImagePromptModifiers?: {
    styleKeywords?: string[];
    qualityModifiers?: string[];
    avoidKeywords?: string[];
  };
}

export interface BriefVisualDirection {
  overallStyle?: string;
  colorPalette?: string[];
  lighting?: string;
  composition?: string;
  aiImagePrompt?: string;
}

/**
 * Build an optimized DALL-E 3 prompt from a production brief
 */
export function buildDallePrompt(
  briefPrompt: string,
  visualDirection: BriefVisualDirection,
  brandStyle: BrandStyleDNA,
  contentType: 'reel' | 'carousel' | 'image' | 'story'
): string {
  const parts: string[] = [];
  
  // Start with the base prompt from brief
  parts.push(briefPrompt || visualDirection.aiImagePrompt || '');
  
  // Add visual direction details
  if (visualDirection.overallStyle) {
    parts.push(`Style: ${visualDirection.overallStyle}`);
  }
  
  // Add color palette - Force DESERT/ARABIAN palette
  // Desert Palette: Golden Sand, Terracotta, Warm Sunset
  const desertPalette = ['#D4A574', '#8B4513', '#CD853F', '#C45D3C', '#FFD700']; // Sand, Terracotta, Peru, Rust, Gold
  
  // ALWAYS use desert palette for brand consistency
  parts.push(`Color palette: Desert Warm Tones - Golden Sand (#D4A574), Terracotta (#8B4513), Sunset Orange (#C45D3C). Maintain a warm, Arabian desert atmosphere.`);
  
  // Add lighting
  if (visualDirection.lighting) {
    parts.push(`Lighting: ${visualDirection.lighting}`);
  } else if (brandStyle.brandVisualDNA?.lighting?.primaryStyle) {
    parts.push(`Lighting: ${brandStyle.brandVisualDNA.lighting.primaryStyle}`);
  }
  
  // Add composition
  if (visualDirection.composition) {
    parts.push(`Composition: ${visualDirection.composition}`);
  }
  
  // Add Islamic elements if needed
  if (brandStyle.brandVisualDNA?.islamicElements?.useGeometricPatterns) {
    parts.push(`Include subtle ${brandStyle.brandVisualDNA.islamicElements.patternStyle || 'Islamic geometric'} patterns`);
  }
  
  // Add style keywords from brand DNA
  if (brandStyle.aiImagePromptModifiers?.styleKeywords) {
    parts.push(brandStyle.aiImagePromptModifiers.styleKeywords.join(', '));
  }
  
  // Add quality modifiers
  const qualityModifiers = brandStyle.aiImagePromptModifiers?.qualityModifiers || [
    'professional quality',
    'high detail',
    'Instagram-ready',
    '4K',
  ];
  parts.push(qualityModifiers.join(', '));
  
  // Add content-type specific modifiers
  switch (contentType) {
    case 'reel':
    case 'story':
      parts.push('vertical format, 9:16 aspect ratio, clean edges for text overlay');
      break;
    case 'carousel':
      parts.push('square or 4:5 format, consistent style for series');
      break;
    case 'image':
      parts.push('standalone impactful visual, square format');
      break;
  }
  
  // CRITICAL: Strict negative prompts for No Text and No Faces
  const avoidList = [
    'text', 'writing', 'letters', 'words', 'typography', 'watermarks', 'logos', 'signatures', // STRICT NO TEXT
    'human faces', 'eyes', 'mouth', 'nose', 'facial features', 'front facing people', // STRICT NO FACES
    'blurry', 'low quality', 'distorted'
  ];
  
  // Add Arabian/Islamic faceless styling
  parts.push('People should be shown from the BACK or side, wearing traditional Arabian/Islamic clothing (thobe, abaya, hijab). NO faces visible.');
  parts.push('Environment: Desert landscape, warm golden lighting, sand dunes, Arabian architecture, mosque silhouettes.');
  parts.push('Do NOT include any text or writing in the image. The image must be text-free.');
  parts.push(`Avoid: ${avoidList.join(', ')}`);
  
  return parts.filter(p => p.trim()).join('. ');
}

/**
 * Build prompts for each scene in a video/reel
 */
export function buildScenePrompts(
  scenes: Array<{
    scene: number;
    visual: string;
    textOverlay?: { text: string };
  }>,
  visualDirection: BriefVisualDirection,
  brandStyle: BrandStyleDNA
): Array<{ prompt: string; sceneNumber: number }> {
  return scenes.map(scene => ({
    sceneNumber: scene.scene,
    prompt: buildDallePrompt(
      scene.visual,
      visualDirection,
      brandStyle,
      'reel'
    ),
  }));
}

/**
 * Build prompts for each slide in a carousel
 */
export function buildSlidePrompts(
  slides: Array<{
    slideNumber: number;
    headline?: string;
    body?: string;
    visualElement?: string;
    designNotes?: string;
  }>,
  visualDirection: BriefVisualDirection,
  brandStyle: BrandStyleDNA
): Array<{ prompt: string; slideNumber: number }> {
  return slides.map(slide => {
    const visualDescription = [
      slide.visualElement,
      slide.headline ? `featuring headline "${slide.headline}"` : '',
      slide.designNotes,
    ].filter(Boolean).join('. ');
    
    return {
      slideNumber: slide.slideNumber,
      prompt: buildDallePrompt(
        visualDescription,
        visualDirection,
        brandStyle,
        'carousel'
      ),
    };
  });
}
