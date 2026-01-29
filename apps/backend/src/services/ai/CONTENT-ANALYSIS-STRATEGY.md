# Content Analysis Data Strategy

## The Challenge: Limited Social Media Data

**Current State**:
- Instagram scraping: Challenging, requires browser automation or unofficial APIs
- TikTok scraping: Even more difficult, heavy rate limiting
- Need high accuracy for critical content recommendations

---

## Database Reality Check

### What We Actually Have (or Can Get)

**From `raw_social_posts` table**:
```sql
SELECT * FROM raw_social_posts 
WHERE competitor_id IN (SELECT id FROM competitors WHERE is_priority = true)
ORDER BY engagement_rate DESC
LIMIT 20;
```

**Likely Data Quality**:
- ✅ Post captions/descriptions (if scraped)
- ✅ Platform (Instagram/TikTok)
- ⚠️ Engagement metrics (may be partial)
- ⚠️ Post format (Reel/Carousel/Single) - might be missing
- ❌ Full content analysis - needs AI processing

---

## Creative Solutions for Limited Data

### Solution 1: AI-Enhanced Analysis (Recommended)

**What We Do**:
1. Get whatever social post data exists in database
2. Use AI (GPT-4) to analyze captions and infer patterns
3. Generate insights based on textual analysis even without full engagement data

**Example**:
```typescript
// Get posts from database
const posts = await prisma.rawSocialPost.findMany({
  where: { competitorId: { in: priorityCompetitorIds } },
  orderBy: { createdAt: 'desc' },
  take: 50
});

// Even with just captions, AI can analyze:
// - Hook patterns (first line analysis)
// - Topic clustering
// - Keyword frequency
// - Tone and style
// - CTA patterns
```

**Accuracy**: 75-85% (good enough for strategic guidance)

---

### Solution 2: Manual Input Workflow

**For Critical Competitors**:
1. **Admin Dashboard**: Upload top 10-15 posts manually
2. **CSV Import**: Bulk upload post data (caption, format, likes, comments)
3. **Browser Extension**: Click to capture posts while browsing

**Implementation**:
```typescript
// Add manual post input endpoint
POST /api/competitors/:id/posts/manual
{
  caption: string;
  format: 'REEL' | 'CAROUSEL' | 'SINGLE' | 'VIDEO';
  platform: 'INSTAGRAM' | 'TIKTOK';
  likes: number;
  comments: number;
  saves?: number;
  url: string;
}
```

**Accuracy**: 95%+ (human-verified data)

---

### Solution 3: Hybrid Approach (Best Option)

**Combine Multiple Sources**:

1. **Automated Scraping** (what we can get)
   - Profile data: bio, follower count, following
   - Basic post metadata: date, format
   - Captions and hashtags

2. **AI Analysis** (fill in gaps)
   - Infer engagement patterns from caption quality
   - Analyze hook patterns from text
   - Cluster topics from keywords

3. **Manual Verification** (critical posts only)
   - Top 3-5 posts per competitor verified manually
   - Engagement metrics entered by human
   - Format confirmed

**Workflow**:
```
Automated Scrape → AI Analysis → Manual Verification (10%) → Generate Content Playbook
```

**Accuracy**: 85-90% overall, 95%+ for critical insights

---

## Content Analysis Generator Strategy

### Input Requirements (Flexible)

**Minimum Required** (Graceful Degradation):
```typescript
interface MinimumDataRequirement {
  competitors: Array<{
    handle: string;
    platform: string;
    posts: Array<{
      caption: string;  // ⚠️ MUST HAVE
      format?: string;  // Optional, can infer from caption
      likes?: number;   // Optional, AI estimates patterns
      comments?: number;
      date?: Date;
    }>;
  }>;
}
```

**What AI Can Do With Just Captions**:
- ✅ Hook pattern analysis (first sentence parsing)
- ✅ Topic extraction (keyword clustering)
- ✅ Tone analysis (language patterns)
- ✅ CTA identification (call-to-action parsing)
- ✅ Format inference (carousel posts often have "swipe →")
- ⚠️ Estimated engagement (based on hook quality, topic relevance)

### Data Quality Warnings

**Generator Will Document**:
```typescript
interface ContentAnalysisMetadata {
  dataQuality: {
    totalPostsAnalyzed: number;
    postsWithEngagementData: number;
    postsWithFormatData: number;
    dataCompletenessScore: number; // 0-100
    warnings: string[];
  };
  analysisMethod: 'FULL_DATA' | 'PARTIAL_DATA' | 'AI_INFERRED';
  confidenceScore: number; // 0-100
}
```

**In Generated Markdown**:
```markdown
## Data Quality Note

This analysis is based on:
- 47 posts analyzed (captions only)
- 12 posts with full engagement metrics
- AI-inferred patterns from caption analysis
- **Confidence Score: 82/100**

⚠️ Recommendations are strategic guidance based on available data. 
For high-stakes content decisions, verify patterns with manual research.
```

---

## Alternative Data Sources

### 1. Competitor AI Analysis (Already Have!)

**From `ai_questions` table**:
```sql
SELECT answer FROM ai_questions
WHERE research_job_id = ? 
AND question_key = 'CONTENT_OPPORTUNITIES';
```

This AI has already analyzed competitors and can provide:
- Content gap analysis
- Format recommendations
- Topic opportunities

**Use This**: Even if social scraping failed, AI analysis provides strategic direction.

---

### 2. Community Insights

**From `community_insights` table**:
```sql
SELECT * FROM community_insights
WHERE research_job_id = ?
AND source LIKE '%reddit%' OR source LIKE '%forum%';
```

What audience talks about = what content should cover.

---

### 3. Search Trends

**From `search_trends` table**:
```sql
SELECT keyword, interest_over_time 
FROM search_trends
WHERE research_job_id = ?
ORDER BY interest_over_time DESC;
```

Rising searches = trending content topics.

---

## Implementation: Content Analysis Generator

### Data Pipeline

```typescript
async function gatherContentAnalysisData(jobId: string) {
  // 1. Try to get social posts
  const posts = await prisma.rawSocialPost.findMany({
    where: { 
      competitor: { researchJobId: jobId, isPriority: true }
    }
  });

  // 2. Get AI content analysis
  const aiContentAnalysis = await prisma.aiQuestion.findFirst({
    where: {
      researchJobId: jobId,
      questionKey: 'CONTENT_OPPORTUNITIES'
    }
  });

  // 3. Get community insights for topics
  const communityTopics = await prisma.communityInsight.findMany({
    where: { researchJobId: jobId }
  });

  // 4. Calculate data quality
  const quality = {
    totalPosts: posts.length,
    postsWithMetrics: posts.filter(p => p.likes != null).length,
    hasAIAnalysis: !!aiContentAnalysis,
    hasCommunityData: communityTopics.length > 0,
    score: calculateQualityScore(posts, aiContentAnalysis, communityTopics)
  };

  return { posts, aiContentAnalysis, communityTopics, quality };
}
```

### Generation Strategy

```typescript
async function generateWithAvailableData(data) {
  if (data.quality.score >= 70) {
    // Full analysis possible
    return generateFullContentAnalysis(data);
  } else if (data.quality.score >= 40) {
    // Hybrid: AI analysis + limited data
    return generateHybridAnalysis(data);
  } else {
    // Fallback: AI strategic guidance only
    return generateStrategicGuidance(data);
  }
}
```

---

## Recommended Next Steps

### Short-term (Use What We Have)

1. **Build Content Analysis Generator** that works with:
   - Whatever social post data exists
   - AI CONTENT_OPPORTUNITIES analysis
   - Community insights for topics
   - Search trends for keyword opportunities

2. **Document Data Quality** in every output
   - Transparency about data limitations
   - Confidence scores
   - Warnings when inferences are used

3. **AI-Enhanced Pattern Detection**
   - Use GPT-4 to analyze caption patterns
   - Infer hooks, topics, CTAs from text
   - Generate playbook from textual analysis

### Long-term (Improve Data Collection)

1. **Manual Input Interface**
   ```
   Admin Panel → "Add Top Posts" button
   - Paste Instagram URL
   - Enter metrics manually
   - Save to database
   ```

2. **Browser Extension (Future)**
   - Click posts while browsing
   - Auto-capture to database
   - Human-in-loop data collection

3. **Upgraded Scrapers**
   - Puppeteer for Instagram (headless browser)
   - TikTok unofficial API wrappers
   - Rate limiting and proxy rotation

---

## Bottom Line

**For Week 2 (NOW)**:
✅ Build generator that works with partial data
✅ Use AI to fill gaps intelligently
✅ Document data quality transparently
✅ Provide strategic value even with limited metrics

**For Week 3-4 (LATER)**:
🔄 Add manual post input workflow
🔄 Improve scrapers with Puppeteer
🔄 Build browser extension for data capture

**The generator will produce valuable insights regardless of data completeness, but will clearly communicate confidence levels.**
