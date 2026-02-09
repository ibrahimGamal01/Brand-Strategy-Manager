/**
 * Section Connector
 * Adds smooth transitions between document sections
 */

const SECTION_BRIDGES: Record<string, string> = {
  businessUnderstanding: "With this foundation established, let's dive deep into who this brand serves.",
  targetAudience: "Now that we understand the audience, let's analyze the competitive landscape.",
  industryOverview: "Understanding the broader market context, we can now focus on priority competitors.",
  priorityCompetitor: "With competitive insights in hand, let's examine the content that's actually working.",
  contentAnalysis: "From these performance patterns, we can distill strategic content pillars.",
  contentPillars: "Now let's define the optimal formats to bring these pillars to life.",
  formatRecommendations: "With formats defined, let's map content to the buyer's journey.",
  buyerJourney: "Finally, let's determine the platform strategy to maximize reach and impact."
};

/**
 * Add transition sentences between sections
 */
export function addSectionTransitions(sections: Record<string, string>): Record<string, string> {
  const connected = { ...sections };
  const sectionOrder = Object.keys(SECTION_BRIDGES);
  
  sectionOrder.forEach((key, index) => {
    if (connected[key] && index < sectionOrder.length - 1) {
      // Add transition at the end of current section
      const bridge = SECTION_BRIDGES[key];
      connected[key] = `${connected[key].trim()}\n\n---\n\n*${bridge}*\n`;
    }
  });
  
  return connected;
}

/**
 * Remove transitions (for regeneration scenarios)
 */
export function removeTransitions(content: string): string {
  // Remove the bridge sentences we add
  return content.replace(/\n\n---\n\n\*[^*]+\*\n$/gm, '');
}
