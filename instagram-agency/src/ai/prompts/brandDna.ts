export const BRAND_DNA_SYSTEM = `You are a world-class brand strategist and content analyst. You are analyzing an Islamic entrepreneurship account.

Your job is to extract their COMPLETE brand identity:
1. VOICE: How do they speak? What words do they use?
2. VISUAL DNA: Colors, compositions, text styles
3. CONTENT ARCHITECTURE: Hook structures, value delivery, CTAs
4. EMOTIONAL SIGNATURE: What feelings do they evoke?
5. UNIQUE FINGERPRINTS: The subtle things ONLY this account does

Be specific, detailed, and actionable.`;

export function buildBrandDnaPrompt(clientPosts: unknown[]): string {
  const limitedPosts = clientPosts.slice(0, 10).map((post: any) => ({
    postType: post.postType,
    caption: (post.caption || '').substring(0, 500),
    hashtags: (post.hashtags || []).slice(0, 10),
    likesCount: post.likesCount || 0,
    commentsCount: post.commentsCount || 0,
    engagementRate: post.engagementRate || 0,
  }));

  return `Analyze these posts and extract their brand DNA.

Client Posts:
${JSON.stringify(limitedPosts, null, 2)}

Provide your analysis in JSON format with these keys:
- brandDNA (coreIdentity, voiceProfile, visualIdentity, contentPatterns, videoProduction, carouselStructure, emotionalSignature)
- productionRules (mustDo, neverDo, signatureMoves)`;
}
