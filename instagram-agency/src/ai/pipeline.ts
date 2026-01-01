import { callOpenAI, callOpenAIMini, listCachedResponses } from './openai';
import { RateLimiter } from '../utils/rateLimiter';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ProcessedData } from '../scrapers/processor';

// Import prompts
import { BRAND_DNA_SYSTEM, buildBrandDnaPrompt } from './prompts/brandDna';
import { COMPETITOR_INTEL_SYSTEM, buildCompetitorIntelPrompt } from './prompts/competitorIntel';
import { TREND_ANALYSIS_SYSTEM, buildTrendAnalysisPrompt } from './prompts/trendAnalysis';
import { PRODUCTION_BRIEFS_SYSTEM, buildProductionBriefsPrompt } from './prompts/productionBriefs';
import { QA_CHECK_SYSTEM, buildQaCheckPrompt } from './prompts/qaCheck';
import { CONTENT_CALENDAR_SYSTEM, buildContentCalendarPrompt } from './prompts/contentCalendar';

export interface PipelineResult {
  brandDna: unknown;
  competitorIntel: unknown;
  trendAnalysis: unknown;
  productionBriefs: unknown;
  qaCheck: unknown;
  contentCalendar: unknown;
}

export async function runAIPipeline(data: ProcessedData): Promise<PipelineResult> {
  const rateLimiter = new RateLimiter(config.rateLimitMs);
  const totalSteps = 6;
  
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
  
  // Step 4: Production Briefs (largest request)
  logger.step(4, totalSteps, 'Production Briefs Generation');
  await rateLimiter.wait();
  const productionBriefs = await callOpenAI(
    PRODUCTION_BRIEFS_SYSTEM,
    buildProductionBriefsPrompt(brandDna, competitorIntel, trendAnalysis),
    { 
      stepName: 'step_4_production_briefs',
      temperature: 0.85, 
      maxTokens: 12000,
    }
  );
  
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
  
  logger.info('');
  logger.info('✨ AI Pipeline complete!');
  
  return {
    brandDna,
    competitorIntel,
    trendAnalysis,
    productionBriefs,
    qaCheck,
    contentCalendar,
  };
}
