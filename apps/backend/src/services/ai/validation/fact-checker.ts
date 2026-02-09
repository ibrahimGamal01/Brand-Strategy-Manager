/**
 * Fact-Checker: Post-Generation Validation Layer
 * 
 * Validates AI-generated content against actual database values
 * to prevent hallucinations and inaccuracies
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface Claim {
  type: 'follower_count' | 'posting_frequency' | 'engagement_rate' | 'percentage' | 'hashtag' | 'quote' | 'market_projection';
  value: string;
  context: string;
  lineNumber?: number;
  handle?: string;
}

export interface Inaccuracy {
  claim: Claim;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  issue: string;
  actualValue?: string;
  suggestedFix?: string;
}

export interface FactCheckResult {
  passed: boolean;
  inaccuracies: Inaccuracy[];
  totalClaims: number;
  verifiedClaims: number;
}

/**
 * Extract claims from generated markdown
 */
export function extractClaims(markdown: string): Claim[] {
  const claims: Claim[] = [];
  const lines = markdown.split('\n');

  lines.forEach((line, index) => {
    // Extract follower counts: "123,456 followers" or "123K followers"
    const followerMatches = line.matchAll(/(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?[KMB])\s+followers/gi);
    for (const match of followerMatches) {
      const handleMatch = line.match(/@(\w+)/);
      claims.push({
        type: 'follower_count',
        value: match[1],
        context: line.trim(),
        lineNumber: index + 1,
        handle: handleMatch ? handleMatch[1] : undefined
      });
    }

    // Extract posting frequencies: "X posts/week", "X/week", "X posts per week"
    const freqMatches = line.matchAll(/(\d+(?:\.\d+)?)\s*(?:posts?\s*)?(?:\/|per\s+)week/gi);
    for (const match of freqMatches) {
      const handleMatch = line.match(/@(\w+)/);
      claims.push({
        type: 'posting_frequency',
        value: match[1],
        context: line.trim(),
        lineNumber: index + 1,
        handle: handleMatch ? handleMatch[1] : undefined
      });
    }

    // Extract engagement rates: "X% engagement" or "X.X%"
    const engagementMatches = line.matchAll(/(\d+(?:\.\d+)?)\s*%\s+engagement/gi);
    for (const match of engagementMatches) {
      const handleMatch = line.match(/@(\w+)/);
      claims.push({
        type: 'engagement_rate',
        value: match[1],
        context: line.trim(),
        lineNumber: index + 1,
        handle: handleMatch ? handleMatch[1] : undefined
      });
    }

    // Extract hashtag campaigns
    const hashtagMatches = line.matchAll(/#(\w+)/g);
    for (const match of hashtagMatches) {
      claims.push({
        type: 'hashtag',
        value: match[1],
        context: line.trim(),
        lineNumber: index + 1
      });
    }

    // Extract market projections: "By 2027", "15% market share"
    if (/by\s+20\d{2}|market\s+share|revenue\s+target/i.test(line)) {
      claims.push({
        type: 'market_projection',
        value: line.trim(),
        context: line.trim(),
        lineNumber: index + 1
      });
    }

    // Extract percentages in competitive context: "X% of competitors"
    const percentMatches = line.matchAll(/(\d+)\s*%\s+of\s+competitors/gi);
    for (const match of percentMatches) {
      claims.push({
        type: 'percentage',
        value: match[1],
        context: line.trim(),
        lineNumber: index + 1
      });
    }
  });

  return claims;
}

/**
 * Verify claims against database
 */
export async function verifyAgainstDatabase(
  claims: Claim[],
  researchJobId: string
): Promise<Inaccuracy[]> {
  const inaccuracies: Inaccuracy[] = [];

  // Get all social profiles for this research job
  const profiles = await prisma.socialProfile.findMany({
    where: { researchJobId },
    include: {
      posts: {
        take: 100,
        orderBy: { postedAt: 'desc' }
      }
    }
  });

  // Create lookup map for quick access
  const profileMap = new Map(profiles.map(p => [p.handle.toLowerCase(), p]));

  for (const claim of claims) {
    switch (claim.type) {
      case 'follower_count':
        if (claim.handle) {
          const profile = profileMap.get(claim.handle.toLowerCase());
          if (profile) {
            const claimedFollowers = parseFollowerCount(claim.value);
            const actualFollowers = profile.followers;

            if (actualFollowers && Math.abs(claimedFollowers - actualFollowers) > actualFollowers * 0.1) {
              inaccuracies.push({
                claim,
                severity: 'CRITICAL',
                issue: `Follower count mismatch for @${claim.handle}`,
                actualValue: actualFollowers.toLocaleString(),
                suggestedFix: `Replace "${claim.value} followers" with "${actualFollowers.toLocaleString()} followers"`
              });
            }
          }
        }
        break;

      case 'posting_frequency':
        if (claim.handle) {
          const profile = profileMap.get(claim.handle.toLowerCase());
          if (profile && profile.posts.length >= 3) {
            const actualFreq = calculateActualPostingFrequency(profile.posts);
            const claimedFreq = parseFloat(claim.value);

            if (actualFreq && Math.abs(claimedFreq - actualFreq) > actualFreq * 0.2) {
              inaccuracies.push({
                claim,
                severity: 'HIGH',
                issue: `Posting frequency mismatch for @${claim.handle}`,
                actualValue: `${actualFreq.toFixed(1)}/week`,
                suggestedFix: `Replace "${claim.value}" with "${actualFreq.toFixed(1)}"`
              });
            }
          }
        }
        break;

      case 'hashtag':
        // Check if hashtag appears in any actual posts
        const hashtagFound = profiles.some(profile =>
          profile.posts.some(post => {
            const caption = post.caption || '';
            return caption.includes(`#${claim.value}`);
          })
        );

        if (!hashtagFound && claim.context.includes('campaign')) {
          inaccuracies.push({
            claim,
            severity: 'HIGH',
            issue: `Hashtag campaign #${claim.value} not found in actual posts`,
            suggestedFix: `Remove mention of #${claim.value} campaign or verify it exists in research data`
          });
        }
        break;

      case 'market_projection':
        // Flag all market projections unless they come from research data
        if (!claim.context.includes('research') && !claim.context.includes('stated')) {
          inaccuracies.push({
            claim,
            severity: 'MEDIUM',
            issue: 'Market projection without source data',
            suggestedFix: 'Remove projection or verify it comes from research data'
          });
        }
        break;
    }
  }

  return inaccuracies;
}

/**
 * Calculate actual posting frequency from posts
 */
function calculateActualPostingFrequency(posts: any[]): number | null {
  if (posts.length < 3) return null;

  const sortedPosts = [...posts]
    .filter(p => p.postedAt)
    .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

  if (sortedPosts.length < 3) return null;

  const oldestPost = new Date(sortedPosts[sortedPosts.length - 1].postedAt);
  const newestPost = new Date(sortedPosts[0].postedAt);
  const daysBetween = Math.max(1, (newestPost.getTime() - oldestPost.getTime()) / (24 * 60 * 60 * 1000));

  return (sortedPosts.length / daysBetween) * 7;
}

/**
 * Parse follower count strings like "123K" or "1.5M"
 */
function parseFollowerCount(value: string): number {
  const num = parseFloat(value.replace(/,/g, ''));
  if (value.toUpperCase().includes('K')) return num * 1000;
  if (value.toUpperCase().includes('M')) return num * 1000000;
  if (value.toUpperCase().includes('B')) return num * 1000000000;
  return num;
}

/**
 * Sanitize content by removing or flagging inaccuracies
 */
export function sanitizeContent(markdown: string, inaccuracies: Inaccuracy[]): string {
  let sanitized = markdown;
  const linesToModify = new Map<number, string>();

  // Group inaccuracies by line number
  for (const inaccuracy of inaccuracies) {
    if (inaccuracy.claim.lineNumber && inaccuracy.suggestedFix) {
      const lineNum = inaccuracy.claim.lineNumber;
      
      if (inaccuracy.severity === 'CRITICAL' || inaccuracy.severity === 'HIGH') {
        // Apply auto-correction for critical/high severity with suggested fixes
        const lines = sanitized.split('\n');
        if (lines[lineNum - 1]) {
          // Apply the suggested fix
          if (inaccuracy.actualValue) {
            lines[lineNum - 1] = lines[lineNum - 1].replace(
              inaccuracy.claim.value,
              inaccuracy.actualValue
            );
          }
        }
        sanitized = lines.join('\n');
      }
    }
  }

  return sanitized;
}

/**
 * Main fact-checking function
 */
export async function factCheck(
  markdown: string,
  researchJobId: string
): Promise<FactCheckResult> {
  const claims = extractClaims(markdown);
  const inaccuracies = await verifyAgainstDatabase(claims, researchJobId);

  return {
    passed: inaccuracies.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH').length === 0,
    inaccuracies,
    totalClaims: claims.length,
    verifiedClaims: claims.length - inaccuracies.length
  };
}
