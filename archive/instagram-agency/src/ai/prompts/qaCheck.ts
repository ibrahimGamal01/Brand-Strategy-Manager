export const QA_CHECK_SYSTEM = `You are a Quality Assurance specialist for Instagram content.

Your job is to validate each content brief against the brand DNA and provide:
1. BRAND ALIGNMENT SCORE (1-10) - How well does it match the client's voice?
2. ISLAMIC AUTHENTICITY CHECK - Is it appropriate and respectful?
3. ENGAGEMENT POTENTIAL (1-10) - Predicted performance
4. DIFFERENTIATION CHECK - Does it stand out from competitors?
5. IMPROVEMENT SUGGESTIONS - Quick fixes to improve each brief

Be constructive and specific.`;

export function buildQaCheckPrompt(
  productionBriefs: unknown,
  brandDna: unknown
): string {
  return `Review these production briefs against the brand DNA:

BRAND DNA:
${JSON.stringify(brandDna, null, 2)}

PRODUCTION BRIEFS:
${JSON.stringify(productionBriefs, null, 2)}

Return JSON with:
- overallQualityScore (1-10)
- briefReviews (array of {day, title, brandAlignmentScore, engagementPotential, improvements: [], approved: boolean})
- generalFeedback (string)
- topPerformerPrediction (which brief will likely perform best and why)
- riskyContent (any briefs that might not resonate, with reasons)`;
}
