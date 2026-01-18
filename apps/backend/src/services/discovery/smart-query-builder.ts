/**
 * Fixed Comprehensive Query Builder
 * 
 * Replaces the "smart" learning approach with battle-tested, comprehensive queries.
 * These queries cover all research dimensions and cost nothing extra.
 * 
 * Categories:
 * 1. Brand Context - Who are they, website, socials
 * 2. Competitors - Alternatives, similar accounts
 * 3. VoC / Reviews - Reddit, reviews, complaints
 * 4. Business Intel - Founder, revenue, business model
 * 5. Content Themes - Top posts, viral content
 * 6. Audience - Who follows them
 * 7. Trends - Industry trends
 * 8. Pain Points - Problems, complaints
 */

export interface FixedQueries {
  all: string[];              // All queries combined
  brandContext: string[];
  competitors: string[];
  voc: string[];              // Voice of Customer
  businessIntel: string[];
  contentThemes: string[];
  audience: string[];
  trends: string[];
  painPoints: string[];
}

/**
 * Generate comprehensive fixed queries for a brand/handle
 */
export function buildFixedQueries(handle: string, niche?: string, brandName?: string): FixedQueries {
  const h = handle.replace('@', '');
  const brand = brandName || h;
  const n = niche || 'business';
  
  const brandContext = [
    `"${h}"`,
    `"${h}" website`,
    `"${h}" instagram`,
    `"${h}" tiktok`,
    `"${h}" who is`,
    `"${h}" about`,
    `"${brand}" official`,
  ];
  
  const competitors = [
    `"${h}" vs`,
    `"${h}" similar to`,
    `"${h}" alternative`,
    `"${h}" competitors`,
    `accounts like "${h}"`,
    `best ${n} accounts instagram`,
    `top ${n} influencers`,
    `${n} creators to follow`,
  ];
  
  const voc = [
    `site:reddit.com "${h}"`,
    `site:reddit.com "@${h}"`,
    `"${h}" review`,
    `"${h}" worth it`,
    `"${h}" experience`,
    `"${h}" honest opinion`,
    `"${brand}" testimonial`,
  ];
  
  const businessIntel = [
    `"${h}" founder`,
    `"${h}" owner`,
    `"${h}" CEO`,
    `"${brand}" revenue`,
    `"${brand}" business model`,
    `"${h}" how they make money`,
    `"${h}" monetization`,
    `"${h}" interview`,
  ];
  
  const contentThemes = [
    `"${h}" top posts`,
    `"${h}" viral`,
    `"${h}" best content`,
    `"${h}" most liked`,
    `"${h}" popular reels`,
  ];
  
  const audience = [
    `"${h}" followers`,
    `who follows "${h}"`,
    `"${h}" target audience`,
    `"${h}" fanbase`,
    `"${h}" community`,
  ];
  
  const trends = [
    `${n} trends 2025`,
    `${n} growth`,
    `${n} future`,
    `${n} market size`,
    `${n} industry analysis`,
  ];
  
  const painPoints = [
    `"${h}" problem`,
    `"${h}" scam`,
    `"${h}" complaint`,
    `"${h}" sucks`,
    `"${h}" fake`,
    `"${h}" controversy`,
    `site:reddit.com "${h}" problem`,
  ];
  
  // Combine all queries
  const all = [
    ...brandContext,
    ...competitors,
    ...voc,
    ...businessIntel,
    ...contentThemes,
    ...audience,
    ...trends,
    ...painPoints,
  ];
  
  console.log(`[QueryBuilder] Generated ${all.length} fixed queries for @${h} in "${n}"`);
  
  return {
    all,
    brandContext,
    competitors,
    voc,
    businessIntel,
    contentThemes,
    audience,
    trends,
    painPoints,
  };
}

/**
 * Get Reddit-specific queries for VoC mining
 */
export function buildRedditQueries(handle: string, niche?: string): string[] {
  const h = handle.replace('@', '');
  const n = niche || 'business';
  
  return [
    `site:reddit.com "${h}"`,
    `site:reddit.com "@${h}"`,
    `site:reddit.com "${h}" review`,
    `site:reddit.com "${h}" worth it`,
    `site:reddit.com "${h}" vs`,
    `site:reddit.com "${h}" alternative`,
    `site:reddit.com ${n} advice`,
    `site:reddit.com best ${n}`,
  ];
}

/**
 * Get platform-specific search queries
 */
export function buildPlatformQueries(handle: string): Record<string, string[]> {
  const h = handle.replace('@', '');
  
  return {
    instagram: [
      `site:instagram.com "${h}"`,
      `"${h}" instagram`,
    ],
    tiktok: [
      `site:tiktok.com "${h}"`,
      `"${h}" tiktok`,
      `"${h}" tiktok account`,
    ],
    youtube: [
      `site:youtube.com "${h}"`,
      `"${h}" youtube channel`,
      `"${h}" youtube`,
    ],
    twitter: [
      `site:twitter.com "${h}"`,
      `site:x.com "${h}"`,
      `"${h}" twitter`,
    ],
    linkedin: [
      `site:linkedin.com "${h}"`,
      `"${h}" linkedin`,
    ],
  };
}

// Legacy export for backward compatibility
export class SmartQueryBuilder {
  public buildQueries(brandName: string, _initialData: any) {
    const queries = buildFixedQueries(brandName);
    return {
      competitorQueries: queries.competitors,
      founderQueries: queries.businessIntel.slice(0, 4),
      trendQueries: queries.trends,
      techQueries: queries.businessIntel.slice(4),
      newsQueries: queries.brandContext,
    };
  }
}
