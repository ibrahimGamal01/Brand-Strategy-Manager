/**
 * Content Generator
 * Main orchestrator for generating all content from production briefs
 */

import { logger } from '../../utils/logger';
import { 
  generateSingleImage, 
  generateCarouselSlides, 
  generateVideoFrames,
  GeneratedImage,
  getAssetsDir 
} from './dalleGenerator';
import { 
  buildDallePrompt, 
  buildScenePrompts, 
  buildSlidePrompts,
  BrandStyleDNA 
} from './imagePromptBuilder';
import fs from 'fs';
import path from 'path';

export interface ContentGenerationResult {
  postNumber: number;
  contentType: string;
  images: GeneratedImage[];
  status: 'success' | 'partial' | 'failed';
  error?: string;
}

export interface GenerationSummary {
  totalPosts: number;
  successful: number;
  partial: number;
  failed: number;
  totalImages: number;
  assetsPath: string;
  results: ContentGenerationResult[];
}

/**
 * Generate all content from production briefs
 */
export async function generateAllContent(
  productionBriefs: any,
  styleAnalysis: BrandStyleDNA,
  options: {
    quality?: 'standard' | 'hd';
    maxPosts?: number;
    skipExisting?: boolean;
  } = {}
): Promise<GenerationSummary> {
  const weeklyPlan = productionBriefs?.weeklyContentPlan || [];
  const quality = options.quality || 'standard';
  const maxPosts = options.maxPosts || weeklyPlan.length;
  
  logger.info(`🎨 Starting content generation for ${Math.min(maxPosts, weeklyPlan.length)} posts`);
  logger.info(`   Quality: ${quality}`);
  logger.info(`   Output: ${getAssetsDir()}`);
  
  const results: ContentGenerationResult[] = [];
  let totalImages = 0;
  
  for (let i = 0; i < Math.min(maxPosts, weeklyPlan.length); i++) {
    const post = weeklyPlan[i];
    const postNumber = post.postNumber || (i + 1);
    
    logger.info(`\n📸 Post ${postNumber}/${weeklyPlan.length}: ${post.contentType}`);
    
    try {
      let result: ContentGenerationResult;
      
      switch (post.contentType) {
        case 'reel':
        case 'video':
          result = await generateReelContent(post, postNumber, styleAnalysis, quality);
          break;
          
        case 'carousel':
          result = await generateCarouselContent(post, postNumber, styleAnalysis, quality);
          break;
          
        case 'image':
        case 'single_image':
          result = await generateImageContent(post, postNumber, styleAnalysis, quality);
          break;
          
        case 'story':
          result = await generateStoryContent(post, postNumber, styleAnalysis, quality);
          break;
          
        default:
          logger.warn(`Unknown content type: ${post.contentType}, treating as image`);
          result = await generateImageContent(post, postNumber, styleAnalysis, quality);
      }
      
      results.push(result);
      totalImages += result.images.length;
      
      // Rate limit between posts
      await sleep(3000);
      
    } catch (error) {
      logger.error(`Failed to generate post ${postNumber}: ${error}`);
      results.push({
        postNumber,
        contentType: post.contentType,
        images: [],
        status: 'failed',
        error: String(error),
      });
    }
  }
  
  const summary: GenerationSummary = {
    totalPosts: results.length,
    successful: results.filter(r => r.status === 'success').length,
    partial: results.filter(r => r.status === 'partial').length,
    failed: results.filter(r => r.status === 'failed').length,
    totalImages,
    assetsPath: getAssetsDir(),
    results,
  };
  
  // Save summary
  const summaryPath = path.join(getAssetsDir(), 'generation_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  logger.success(`\n✅ Generation complete! Summary saved to: ${summaryPath}`);
  
  return summary;
}

/**
 * Generate content for a reel/video
 */
async function generateReelContent(
  post: any,
  postNumber: number,
  styleAnalysis: BrandStyleDNA,
  quality: 'standard' | 'hd'
): Promise<ContentGenerationResult> {
  const scenes = post.sceneBreakdown || [];
  const visualDirection = post.visualDirection || {};
  
  if (scenes.length === 0) {
    // If no scenes, generate a single cover frame
    const prompt = buildDallePrompt(
      visualDirection.aiImagePrompt || post.brief?.concept || 'Motivational content for Muslim entrepreneurs',
      visualDirection,
      styleAnalysis,
      'reel'
    );
    
    const image = await generateSingleImage(prompt, postNumber, '9:16' as any, quality);
    
    return {
      postNumber,
      contentType: 'reel',
      images: [image],
      status: 'success',
    };
  }
  
  // Generate key frames for each scene
  const scenePrompts = buildScenePrompts(scenes, visualDirection, styleAnalysis);
  const images = await generateVideoFrames(scenePrompts, postNumber, quality);
  
  return {
    postNumber,
    contentType: 'reel',
    images,
    status: images.length === scenes.length ? 'success' : 'partial',
  };
}

/**
 * Generate content for a carousel
 */
async function generateCarouselContent(
  post: any,
  postNumber: number,
  styleAnalysis: BrandStyleDNA,
  quality: 'standard' | 'hd'
): Promise<ContentGenerationResult> {
  const slides = post.slideBreakdown || [];
  const visualDirection = post.visualDirection || {};
  
  if (slides.length === 0) {
    // If no slides defined, generate 3 generic slides
    const basePrompt = visualDirection.aiImagePrompt || post.brief?.concept || '';
    const defaultSlides = [
      { slideNumber: 1, visualElement: `Cover slide: ${basePrompt}` },
      { slideNumber: 2, visualElement: `Main content: ${basePrompt}` },
      { slideNumber: 3, visualElement: `Call to action: ${basePrompt}` },
    ];
    
    const slidePrompts = buildSlidePrompts(defaultSlides, visualDirection, styleAnalysis);
    const images = await generateCarouselSlides(slidePrompts, postNumber, '1:1', quality);
    
    return {
      postNumber,
      contentType: 'carousel',
      images,
      status: images.length > 0 ? 'success' : 'failed',
    };
  }
  
  const slidePrompts = buildSlidePrompts(slides, visualDirection, styleAnalysis);
  const images = await generateCarouselSlides(slidePrompts, postNumber, '1:1', quality);
  
  return {
    postNumber,
    contentType: 'carousel',
    images,
    status: images.length === slides.length ? 'success' : 'partial',
  };
}

/**
 * Generate content for a single image post
 */
async function generateImageContent(
  post: any,
  postNumber: number,
  styleAnalysis: BrandStyleDNA,
  quality: 'standard' | 'hd'
): Promise<ContentGenerationResult> {
  const visualDirection = post.visualDirection || {};
  
  const prompt = buildDallePrompt(
    visualDirection.aiImagePrompt || post.brief?.concept || 'Inspiring quote for Muslim entrepreneurs',
    visualDirection,
    styleAnalysis,
    'image'
  );
  
  const image = await generateSingleImage(prompt, postNumber, '1:1', quality);
  
  return {
    postNumber,
    contentType: 'image',
    images: [image],
    status: 'success',
  };
}

/**
 * Generate content for a story
 */
async function generateStoryContent(
  post: any,
  postNumber: number,
  styleAnalysis: BrandStyleDNA,
  quality: 'standard' | 'hd'
): Promise<ContentGenerationResult> {
  const visualDirection = post.visualDirection || {};
  
  const prompt = buildDallePrompt(
    visualDirection.aiImagePrompt || post.brief?.concept || 'Interactive story for Muslim entrepreneurs',
    visualDirection,
    styleAnalysis,
    'story'
  );
  
  // Stories are vertical like reels
  const image = await generateSingleImage(prompt, postNumber, '9:16' as any, quality);
  
  return {
    postNumber,
    contentType: 'story',
    images: [image],
    status: 'success',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
