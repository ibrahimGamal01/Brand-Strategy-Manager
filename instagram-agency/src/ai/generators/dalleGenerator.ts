import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const openai = new OpenAI({
  apiKey: config.openaiKey,
});

// Output directory for generated assets
const ASSETS_DIR = path.join(__dirname, '..', '..', '..', 'output', 'assets');

// Ensure assets directory exists
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// Map aspect ratios to DALL-E 3 supported sizes
const ASPECT_RATIO_MAP: Record<string, '1024x1024' | '1024x1792' | '1792x1024'> = {
  '1:1': '1024x1024',
  '9:16': '1024x1792',
  '16:9': '1792x1024',
  '4:5': '1024x1024', // Closest supported size
};

export interface ImageGenerationOptions {
  prompt: string;
  aspectRatio: '1:1' | '9:16' | '16:9' | '4:5';
  quality?: 'standard' | 'hd';
  outputPath?: string;
  postNumber?: number;
  slideNumber?: number;
}

export interface GeneratedImage {
  url: string;
  localPath?: string;
  prompt: string;
  aspectRatio: string;
  size: string;
}

/**
 * Generate a single image using DALL-E 3
 */
export async function generateImage(options: ImageGenerationOptions): Promise<GeneratedImage> {
  const size = ASPECT_RATIO_MAP[options.aspectRatio] || '1024x1024';
  const quality = options.quality || 'standard';
  
  logger.info(`🎨 Generating image: ${options.prompt.slice(0, 50)}...`);
  logger.info(`   Size: ${size}, Quality: ${quality}`);
  
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt: options.prompt,
    n: 1,
    size: size,
    quality: quality,
    response_format: 'url',
  });
  
  const imageUrl = response.data?.[0]?.url;
  
  if (!imageUrl) {
    throw new Error('No image URL returned from DALL-E 3');
  }
  
  let localPath: string | undefined;
  
  // Download and save image if output path specified
  if (options.outputPath) {
    localPath = await downloadImage(imageUrl, options.outputPath);
    logger.success(`💾 Saved: ${localPath}`);
  }
  
  return {
    url: imageUrl,
    localPath,
    prompt: options.prompt,
    aspectRatio: options.aspectRatio,
    size,
  };
}

/**
 * Generate multiple images for a carousel
 */
export async function generateCarouselSlides(
  slides: Array<{ prompt: string; slideNumber: number }>,
  postNumber: number,
  aspectRatio: '1:1' | '4:5' = '1:1',
  quality: 'standard' | 'hd' = 'standard'
): Promise<GeneratedImage[]> {
  const postDir = path.join(ASSETS_DIR, `post_${postNumber}_carousel`);
  
  if (!fs.existsSync(postDir)) {
    fs.mkdirSync(postDir, { recursive: true });
  }
  
  const results: GeneratedImage[] = [];
  
  for (const slide of slides) {
    const outputPath = path.join(postDir, `slide_${slide.slideNumber}.png`);
    
    try {
      const image = await generateImage({
        prompt: slide.prompt,
        aspectRatio,
        quality,
        outputPath,
        postNumber,
        slideNumber: slide.slideNumber,
      });
      
      results.push(image);
      
      // Rate limit: wait between requests
      await sleep(2000);
    } catch (error) {
      logger.error(`Failed to generate slide ${slide.slideNumber}: ${error}`);
    }
  }
  
  return results;
}

/**
 * Generate key frames for a video/reel
 */
export async function generateVideoFrames(
  scenes: Array<{ prompt: string; sceneNumber: number }>,
  postNumber: number,
  quality: 'standard' | 'hd' = 'hd'
): Promise<GeneratedImage[]> {
  const postDir = path.join(ASSETS_DIR, `post_${postNumber}_reel`);
  
  if (!fs.existsSync(postDir)) {
    fs.mkdirSync(postDir, { recursive: true });
  }
  
  const results: GeneratedImage[] = [];
  
  for (const scene of scenes) {
    const outputPath = path.join(postDir, `frame_${scene.sceneNumber}.png`);
    
    try {
      const image = await generateImage({
        prompt: scene.prompt,
        aspectRatio: '9:16', // Vertical for reels
        quality,
        outputPath,
        postNumber,
      });
      
      results.push(image);
      
      // Rate limit: wait between requests
      await sleep(2000);
    } catch (error) {
      logger.error(`Failed to generate frame ${scene.sceneNumber}: ${error}`);
    }
  }
  
  return results;
}

/**
 * Generate a single image post
 */
export async function generateSingleImage(
  prompt: string,
  postNumber: number,
  aspectRatio: '1:1' | '4:5' = '1:1',
  quality: 'standard' | 'hd' = 'hd'
): Promise<GeneratedImage> {
  const postDir = path.join(ASSETS_DIR, `post_${postNumber}_image`);
  
  if (!fs.existsSync(postDir)) {
    fs.mkdirSync(postDir, { recursive: true });
  }
  
  const outputPath = path.join(postDir, 'final.png');
  
  return generateImage({
    prompt,
    aspectRatio,
    quality,
    outputPath,
    postNumber,
  });
}

/**
 * Download image from URL and save to disk
 */
async function downloadImage(url: string, outputPath: string): Promise<string> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  
  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get the assets directory path
 */
export function getAssetsDir(): string {
  return ASSETS_DIR;
}
