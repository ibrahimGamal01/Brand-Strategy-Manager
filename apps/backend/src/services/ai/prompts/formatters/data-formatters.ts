/**
 * Data Formatters for RAG Context
 * 
 * Utilities to format raw research data for LLM consumption
 */

/**
 * Format social posts for LLM analysis
 */
export function formatPostsForLLM(posts: any[]): string {
  if (!posts || posts.length === 0) {
    return "No posts available for analysis.";
  }

  return posts.map((post, idx) => {
    const metadata = post.metadata as any || {};
    
    return `
### Post ${idx + 1}
- **ID**: ${post.id}
- **Caption**: ${post.caption || 'No caption'}
- **Posted**: ${post.postedAt ? new Date(post.postedAt).toLocaleDateString() : 'Unknown'}
- **Likes**: ${metadata.likes || post.likesCount || 0}
- **Comments**: ${metadata.comments || post.commentsCount || 0}
- **Saves**: ${metadata.saves || 0}
- **Shares**: ${metadata.shares || post.sharesCount || 0}
- **Engagement Rate**: ${metadata.engagement_rate || metadata.engagementRate || 0}%
- **Format**: ${post.type || metadata.format || 'Unknown'}
${post.hashtags ? `- **Hashtags**: ${Array.isArray(post.hashtags) ? post.hashtags.join(', ') : post.hashtags}` : ''}
`.trim();
  }).join('\n\n---\n\n');
}

/**
 * Format competitor profiles for LLM analysis
 */
export function formatCompetitorsForLLM(profiles: any[]): string {
  if (!profiles || profiles.length === 0) {
    return "No competitor profiles available.";
  }

  return profiles.map((profile, idx) => {
    return `
### Competitor ${idx + 1}: @${profile.handle}
- **Platform**: ${profile.platform}
- **Followers**: ${profile.followers?.toLocaleString() || 'Unknown'}
- **Following**: ${profile.following?.toLocaleString() || 'Unknown'}
- **Posts**: ${profile.postsCount || 0}
- **Bio**: ${profile.bio || 'No bio'}
- **Last Scraped**: ${profile.lastScrapedAt ? new Date(profile.lastScrapedAt).toLocaleDateString() : 'Never'}
`.trim();
  }).join('\n\n---\n\n');
}

/**
 * Format content pillars analysis from posts
 */
export function formatContentPillarsFromPosts(posts: any[]): string {
  if (!posts || posts.length === 0) {
    return "No posts available for pillar analysis.";
  }

  // Group posts by theme/topic (extracted from captions)
  const themes: Record<string, any[]> = {};
  
  posts.forEach(post => {
    const caption = post.caption || '';
    // Simple theme extraction - could be enhanced with AI
    const theme = extractThemeFromCaption(caption);
    if (!themes[theme]) {
      themes[theme] = [];
    }
    themes[theme].push(post);
  });

  // Calculate metrics per theme
  return Object.entries(themes)
    .map(([theme, themePosts]) => {
      const totalEngagement = themePosts.reduce((sum, post) => {
        const metadata = post.metadata as any || {};
        return sum + (metadata.likes || 0) + (metadata.comments || 0);
      }, 0);
      const avgEngagement = Math.round(totalEngagement / themePosts.length);

      return `
### ${theme}
- **Post Count**: ${themePosts.length} (${Math.round(themePosts.length / posts.length * 100)}%)
- **Avg Engagement**: ${avgEngagement}
- **Top Post**: ${themePosts.sort((a, b) => {
  const aEng = ((a.metadata as any)?.likes || 0) + ((a.metadata as any)?.comments || 0);
  const bEng = ((b.metadata as any)?.likes || 0) + ((b.metadata as any)?.comments || 0);
  return bEng - aEng;
})[0]?.caption?.substring(0, 100)}...
`.trim();
    })
    .join('\n\n');
}

/**
 * Extract theme from post caption (simple keyword-based)
 * TODO: Enhance with AI-based classification
 */
function extractThemeFromCaption(caption: string): string {
  const lower = caption.toLowerCase();
  
  // Educational content
  if (lower.includes('learn') || lower.includes('how to') || lower.includes('tip') || lower.includes('guide')) {
    return 'Educational';
  }
  // Inspirational/Motivational
  if (lower.includes('inspire') || lower.includes('motivat') || lower.includes('believe') || lower.includes('dream')) {
    return 'Inspirational';
  }
  // Behind the scenes
  if (lower.includes('behind') || lower.includes('process') || lower.includes('journey') || lower.includes('story')) {
    return 'Behind the Scenes';
  }
  // Product/Service
  if (lower.includes('product') || lower.includes('service') || lower.includes('offer') || lower.includes('new')) {
    return 'Product/Service';
  }
  // Community/Engagement
  if (lower.includes('community') || lower.includes('together') || lower.includes('you') || lower.includes('question')) {
    return 'Community';
  }
  
  return 'General';
}

/**
 * Format performance benchmarks
 */
export function formatBenchmarks(benchmarks: {
  avgLikes: number;
  avgComments: number;
  avgEngagementRate: number;
  topFormats: { format: string; percentage: number }[];
}): string {
  return `
## Performance Benchmarks

### Average Metrics
- **Likes**: ${Math.round(benchmarks.avgLikes)}
- **Comments**: ${Math.round(benchmarks.avgComments)}
- **Engagement Rate**: ${benchmarks.avgEngagementRate.toFixed(2)}%

### Top Formats
${benchmarks.topFormats.map(f => `- **${f.format}**: ${f.percentage.toFixed(1)}% of content`).join('\n')}
`.trim();
}
