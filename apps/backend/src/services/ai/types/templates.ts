/**
 * Template Type Definitions for Brand Strategy Generation
 * 
 * These interfaces define the exact structure and requirements for each
 * section of the brand strategy document.
 */

// ============================================
// SHARED TYPES
// ============================================

export interface WordCountRange {
  min: number;
  max: number;
}

export interface SectionDefinition {
  id: string;
  title: string;
  wordCount: WordCountRange;
  requiredElements: string[];
  dataSources: string[];
  validationRules?: string[];
}

// ============================================
// TEMPLATE 1: BUSINESS UNDERSTANDING
// ============================================

export interface BusinessUnderstandingTemplate {
  templateId: 'business_understanding';
  sections: {
    businessOverview: {
      id: 'business_overview';
      title: 'Business Overview';
      wordCount: WordCountRange;
      requiredElements: [
        'specific_products_services',
        'customer_segments_with_examples',
        'business_model',
        'market_position'
      ];
      dataSources: ['web_search', 'social_profiles', 'ai_business_analysis'];
    };
    valueProposition: {
      id: 'value_proposition';
      title: 'Unique Value Proposition';
      wordCount: WordCountRange;
      requiredElements: [
        'gain_creators',
        'pain_relievers',
        'unfair_advantage',
        'positioning_critique'
      ];
      dataSources: ['ai_VALUE_PROPOSITION', 'competitor_data', 'community_insights'];
    };
    brandStory: {
      id: 'brand_story';
      title: 'Brand Story & Mission';
      wordCount: WordCountRange;
      requiredElements: [
        'origin_story_if_available',
        'vision_mission_specific',
        'brand_purpose',
        'emotional_connection'
      ];
      dataSources: ['web_search', 'social_profiles'];
    };
    brandVoicePersonality: {
      id: 'brand_voice_personality';
      title: 'Brand Voice & Personality';
      wordCount: WordCountRange;
      requiredElements: [
        'tone_dimensions',
        'jungian_archetypes',
        'brand_enemy',
        'dos_and_donts'
      ];
      dataSources: ['ai_BRAND_VOICE', 'ai_BRAND_PERSONALITY', 'social_captions'];
    };
    currentPresence: {
      id: 'current_presence';
      title: 'Current Social Presence';
      wordCount: WordCountRange;
      requiredElements: [
        'platforms_and_metrics',
        'content_formats',
        'strengths_and_weaknesses'
      ];
      dataSources: ['social_profiles', 'social_posts'];
    };
  };
  totalWordCount: WordCountRange;
}

// ============================================
// TEMPLATE 2: TARGET AUDIENCE
// ============================================

export interface PersonaDemographics {
  role: string;
  ageRange: string;
  lifestyle: string;
  onlinePresence: string;
}

export interface JTBDFramework {
  situation: string;
  motivation: string;
  outcome: string;
}

export interface PainPoint {
  surface: string;
  deeper: string;
  existential: string;
}

export interface Motivators {
  push: string[];
  pull: string[];
}

export interface ContentPreferences {
  formats: string[];
  topics: string[];
  tone: string;
}

export interface Persona {
  name: string;
  demographics: PersonaDemographics;
  jtbdFramework: JTBDFramework;
  painPoints: PainPoint[];
  goals: string[];
  fears: string[];
  motivators: Motivators;
  blockers: string[];
  contentPreferences: ContentPreferences;
  quote?: string;
}

export interface TargetAudienceTemplate {
  templateId: 'target_audience';
  personas: Persona[];
  personaCount: { min: number; max: number };
  totalWordCount: WordCountRange;
  dataSources: ['ai_TARGET_AUDIENCE', 'ai_PAIN_POINTS', 'community_insights', 'social_audience_data'];
}

// ============================================
// TEMPLATE 3: INDUSTRY OVERVIEW
// ============================================

export interface CompetitorRow {
  handle: string;
  platforms: string[];
  followers: number;
  postingFreq: string;
  formats: string[];
  pillars: string[];
  engagement: string;
  discoveryMethod: string;
}

export interface IndustryOverviewTemplate {
  templateId: 'industry_overview';
  competitorTable: {
    columns: string[];
    rows: CompetitorRow[];
    requiredMetrics: string[];
  };
  landscapeAnalysis: {
    wordCount: WordCountRange;
    requiredElements: [
      'market_saturation_assessment',
      'dominant_players',
      'emerging_players',
      'platform_distribution',
      'format_trends'
    ];
  };
  patternIdentification: {
    wordCount: WordCountRange;
    requiredElements: [
      'sameness_trap',
      'common_pillars',
      'format_homogeneity',
      'engagement_patterns'
    ];
  };
  strategicImplications: {
    wordCount: WordCountRange;
    requiredElements: [
      'red_ocean_areas',
      'blue_ocean_opportunities',
      'actionable_insights'
    ];
  };
  totalWordCount: WordCountRange;
  dataSources: ['all_10_competitors', 'ai_COMPETITOR_ANALYSIS', 'social_posts'];
}

// ============================================
// TEMPLATE 4: PRIORITY COMPETITOR ANALYSIS
// ============================================

export interface ContentPillar {
  name: string;
  percentage: number;
  examples: string[];
  performance: string;
}

export interface PostMetrics {
  likes: number;
  comments: number;
  saves?: number;
  engagementRate: number;
}

export interface PostAnalysis {
  format: string;
  hook: string;
  painPoint: string;
  goalTapped: string;
  whyItWorked: string;
}

export interface TopPost {
  description: string;
  metrics: PostMetrics;
  analysis: PostAnalysis;
}

export interface CompetitorProfile {
  handle: string;
  platform: string;
  metrics: {
    followers: number;
    postingFrequency: string;
    bio: string;
  };
}

export interface CompetitorAnalysis {
  profile: CompetitorProfile;
  contentStrategy: {
    wordCount: WordCountRange;
    pillars: ContentPillar[];
    formatBreakdown: Record<string, number>;
  };
  topPosts: TopPost[];
  strengthsWeaknesses: {
    wordCount: WordCountRange;
    strengths: string[];
    weaknesses: string[];
    vulnerabilities: string[];
  };
}

export interface BlueOceanSynthesis {
  wordCount: WordCountRange;
  eliminate: string[];
  reduce: string[];
  raise: string[];
  create: string[];
  competitiveGaps: string[];
}

export interface PriorityCompetitorTemplate {
  templateId: 'priority_competitor';
  competitors: CompetitorAnalysis[];
  blueOceanSynthesis: BlueOceanSynthesis;
  competitorCount: 3;
  totalWordCount: WordCountRange;
  dataSources: ['priority_competitors', 'social_posts', 'ai_analyses', 'ai_NICHE_POSITION'];
}

// ============================================
// TEMPLATE 5: CONTENT ANALYSIS
// ============================================

export interface AnalyzedPost {
  title: string;
  metrics: {
    format: string;
    likes: number;
    comments: number;
    saves?: number;
    engagementRate: number;
  };
  analysis: {
    topic: string;
    pillar: string;
    hook: string;
    keywords: string[];
    painPoint: string;
    goalTapped: string;
    formatExecution: string;
    whyItPerformed: string;
  };
}

export interface CompetitorPosts {
  competitor: string;
  posts: AnalyzedPost[];
}

export interface ContentPatterns {
  formatPatterns: string[];
  hookPatterns: string[];
  structurePatterns: string[];
  topicPatterns: string[];
  keywordPatterns: string[];
}

export interface WinningFormula {
  format: string;
  hook: string;
  length: string;
  topic: string;
  cta: string;
}

export interface ContentAnalysisTemplate {
  templateId: 'content_analysis';
  postBreakdown: CompetitorPosts[];
  patternIdentification: {
    wordCount: WordCountRange;
    patterns: ContentPatterns;
  };
  contentPlaybook: {
    wordCount: WordCountRange;
    winningFormula: WinningFormula;
    dos: string[];
    donts: string[];
  };
  totalWordCount: WordCountRange;
  dataSources: ['top_social_posts', 'ai_content_analyses', 'engagement_metrics'];
}

// ============================================
// VALIDATION TYPES
// ============================================

export interface ValidationImprovement {
  issue: string;
  suggestion: string;
  example?: string;
}

export interface GenericPhraseDetection {
  phrase: string;
  betterAlternative: string;
  dataSource?: string;
}

export interface ValidationFeedback {
  strengths: string[];
  improvements: ValidationImprovement[];
  missingElements: string[];
  genericPhrases: GenericPhraseDetection[];
}

export interface ValidationResult {
  score: number;
  passed: boolean;
  feedback: ValidationFeedback;
  nextAttemptGuidance?: string;
}
