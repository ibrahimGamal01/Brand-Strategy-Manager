import { callOpenAI, callOpenAIMini, listCachedResponses } from './openai';
import { RateLimiter } from '../utils/rateLimiter';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ProcessedData } from '../scrapers/processor';

// Import prompts
import { BRAND_DNA_SYSTEM, buildBrandDnaPrompt } from './prompts/brandDna';
import { COMPETITOR_INTEL_SYSTEM, buildCompetitorIntelPrompt } from './prompts/competitorIntel';
import { TREND_ANALYSIS_SYSTEM, buildTrendAnalysisPrompt } from './prompts/trendAnalysis';
import { PRODUCTION_BRIEFS_SYSTEM, buildProductionBriefsPrompt, buildProductionBriefsSystemPrompt } from './prompts/productionBriefs';
import { QA_CHECK_SYSTEM, buildQaCheckPrompt } from './prompts/qaCheck';
import { CONTENT_CALENDAR_SYSTEM, buildContentCalendarPrompt } from './prompts/contentCalendar';
import { STYLE_ANALYSIS_SYSTEM, buildStyleAnalysisPrompt } from './prompts/styleAnalysis';
import { generateAllContent, GenerationSummary } from './generators';

export interface PipelineResult {
  brandDna: unknown;
  competitorIntel: unknown;
  trendAnalysis: unknown;
  productionBriefs: unknown;
  qaCheck: unknown;
  contentCalendar: unknown;
  styleAnalysis: unknown;
  contentGeneration: GenerationSummary | null;
}

export async function runAIPipeline(data: ProcessedData, options?: { generateImages?: boolean }): Promise<PipelineResult> {
  const rateLimiter = new RateLimiter(config.rateLimitMs);
  const generateImages = options?.generateImages ?? false;
  const totalSteps = generateImages ? 8 : 6;
  
  // Show what's already cached
  const cached = listCachedResponses();
  if (cached.length > 0) {
    logger.info(`📦 Found ${cached.length} cached responses: ${cached.join(', ')}`);
    logger.info('Cached steps will be SKIPPED (no API call)');
  }
  
  logger.info('');
  logger.info('🚀 Starting AI Pipeline');
  logger.info(`⏱️  Rate limit: ${config.rateLimitMs / 1000}s (${(config.rateLimitMs / 60000).toFixed(1)} min) between calls`);
  logger.info('💾 All successful responses are saved immediately');
  logger.info('');
  
  // Step 1: Client Brand DNA Analysis
  logger.step(1, totalSteps, 'Client Brand DNA Analysis');
  await rateLimiter.wait();
  const brandDna = await callOpenAI(
    BRAND_DNA_SYSTEM,
    buildBrandDnaPrompt(data.clientPosts),
    { 
      stepName: 'step_1_brand_dna',
      temperature: 0.7, 
      maxTokens: 6000,
    }
  );
  
  // Step 2: Competitor Intelligence
  logger.step(2, totalSteps, 'Competitor Intelligence Analysis');
  await rateLimiter.wait();
  const competitorIntel = await callOpenAI(
    COMPETITOR_INTEL_SYSTEM,
    buildCompetitorIntelPrompt(data.topPerformers, data.byType.videos, data.byType.carousels),
    { 
      stepName: 'step_2_competitor_intel',
      temperature: 0.8, 
      maxTokens: 6000,
    }
  );
  
  // Step 3: Trend Analysis
  logger.step(3, totalSteps, 'Trend Analysis');
  await rateLimiter.wait();
  const trendAnalysis = await callOpenAI(
    TREND_ANALYSIS_SYSTEM,
    buildTrendAnalysisPrompt(brandDna, competitorIntel),
    { 
      stepName: 'step_3_trend_analysis',
      temperature: 0.7, 
      maxTokens: 4000,
    }
  );
  
  // Step 4: Production Briefs (Batched)
  logger.step(4, totalSteps, 'Production Briefs Generation (Batched)');
  
  const totalPosts = config.contentMix.postsPerWeek;
  const batchSize = 7; // Max posts per request to avoid token limits
  const batches = Math.ceil(totalPosts / batchSize);
  
  let allBriefs: any[] = [];
  let weeklyStrategy: any = null;
  let productionNotes: any = null;
  
  for (let i = 0; i < batches; i++) {
    const startPost = i * batchSize + 1;
    const endPost = Math.min((i + 1) * batchSize, totalPosts);
    
    logger.info(`Generating batch ${i + 1}/${batches} (Posts ${startPost}-${endPost})...`);
    await rateLimiter.wait();
    
    const batchResult: any = await callOpenAI(
      buildProductionBriefsSystemPrompt(config.contentMix, config.client.username),
      buildProductionBriefsPrompt(brandDna, competitorIntel, trendAnalysis, config.contentMix, startPost, endPost),
      { 
        stepName: `step_4_production_briefs_batch_${i + 1}`,
        temperature: 0.85, 
        maxTokens: 12000,
      }
    );
    
    if (batchResult?.weeklyContentPlan) {
      allBriefs = [...allBriefs, ...batchResult.weeklyContentPlan];
    }
    
    // Capture strategy and notes from the first batch
    if (i === 0) {
      weeklyStrategy = batchResult?.weeklyStrategy;
      productionNotes = batchResult?.productionNotes;
    }
  }
  
  const productionBriefs = {
    weeklyContentPlan: allBriefs,
    weeklyStrategy,
    productionNotes
  };
  
  // Step 5: QA Check (using mini model - higher rate limits)
  logger.step(5, totalSteps, 'Quality Assurance Check');
  await rateLimiter.wait();
  const qaCheck = await callOpenAIMini(
    QA_CHECK_SYSTEM,
    buildQaCheckPrompt(productionBriefs, brandDna),
    { 
      stepName: 'step_5_qa_check',
      temperature: 0.6, 
      maxTokens: 4000,
    }
  );
  
  // Step 6: Content Calendar (using mini model - higher rate limits)
  logger.step(6, totalSteps, 'Content Calendar Generation');
  await rateLimiter.wait();
  const contentCalendar = await callOpenAIMini(
    CONTENT_CALENDAR_SYSTEM,
    buildContentCalendarPrompt(productionBriefs),
    { 
      stepName: 'step_6_content_calendar',
      temperature: 0.6, 
      maxTokens: 4000,
    }
  );
  
  let styleAnalysis: unknown = null;
  let contentGeneration: GenerationSummary | null = null;
  
  if (generateImages) {
    // Step 7: Style Analysis
    logger.step(7, totalSteps, 'Visual Style Extraction');
    await rateLimiter.wait();
    styleAnalysis = await callOpenAI(
      STYLE_ANALYSIS_SYSTEM,
      buildStyleAnalysisPrompt(data.clientPosts),
      { 
        stepName: 'step_7_style_analysis',
        temperature: 0.7, 
        maxTokens: 6000,
      }
    );
    
    // Step 8: Image Generation (DALL-E 3)
    logger.step(8, totalSteps, 'Image Generation (DALL-E 3)');
    logger.info('🎨 Generating images from production briefs...');
    
    try {
      contentGeneration = await generateAllContent(
        productionBriefs,
        styleAnalysis as any,
        { quality: 'standard', maxPosts: 3 } // Start with 3 posts for testing
      );
      
      logger.success(`✅ Generated ${contentGeneration.totalImages} images for ${contentGeneration.successful} posts`);
    } catch (error) {
      logger.error(`Image generation failed: ${error}`);
      contentGeneration = null;
    }
  }
  
  logger.info('');
  logger.info('✨ AI Pipeline complete!');
  
  return {
    brandDna,
    competitorIntel,
    trendAnalysis,
    productionBriefs,
    qaCheck,
    contentCalendar,
    styleAnalysis,
    contentGeneration,
  };
}
