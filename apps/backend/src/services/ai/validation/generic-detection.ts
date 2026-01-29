/**
 * Generic Phrase Detection
 * 
 * Detects and provides alternatives for vague/generic content
 */

import { GenericPhraseDetection } from '../types/templates';

const GENERIC_PHRASES = [
  { phrase: 'industry-leading', category: 'vague_superiority' },
  { phrase: 'cutting-edge', category: 'vague_superiority' },
  { phrase: 'innovative', category: 'vague_superiority' },
  { phrase: 'best-in-class', category: 'vague_superiority' },
  { phrase: 'world-class', category: 'vague_superiority' },
  { phrase: 'state-of-the-art', category: 'vague_superiority' },
  { phrase: 'comprehensive solution', category: 'vague_offering' },
  { phrase: 'full-service', category: 'vague_offering' },
  { phrase: 'end-to-end', category: 'vague_offering' },
  { phrase: 'seamless experience', category: 'vague_benefit' },
  { phrase: 'exceptional quality', category: 'vague_benefit' },
  { phrase: 'unparalleled service', category: 'vague_benefit' },
  { phrase: 'proven track record', category: 'unsupported_claim' },
  { phrase: 'years of experience', category: 'vague_credential' },
  { phrase: 'trusted by', category: 'vague_social_proof' },
  { phrase: 'leading provider', category: 'vague_position' }
];

/**
 * Detect generic phrases and suggest data-backed alternatives
 */
export function detectGenericPhrases(content: string): GenericPhraseDetection[] {
  const detections: GenericPhraseDetection[] = [];

  for (const { phrase, category } of GENERIC_PHRASES) {
    const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
    const matches = content.match(regex);
    
    if (matches) {
      let betterAlternative = '';
      let dataSource = '';

      switch (category) {
        case 'vague_superiority':
          betterAlternative = `Replace with specific differentiation. Example: "Unlike competitors who charge per revision, offers unlimited design revisions" (from VALUE_PROPOSITION)`;
          dataSource = 'ai_VALUE_PROPOSITION or competitor_analysis';
          break;
        
        case 'vague_offering':
          betterAlternative = `List specific services. Example: "3D rendering, MEP coordination, custom furniture manufacturing" (from business data)`;
          dataSource = 'business_overview or web_search_results';
          break;
        
        case 'vague_benefit':
          betterAlternative = `Quantify it. Example: "95% accuracy guarantee between renders and delivered space" (from research)`;
          dataSource = 'value_proposition or testimonials';
          break;
        
        case 'unsupported_claim':
          betterAlternative = `Provide evidence. Example: "Completed 47 residential projects in 2023" (from business data)`;
          dataSource = 'business_data or search_results';
          break;
        
        case 'vague_credential':
          betterAlternative = `Be specific. Example: "Founded in 2018 with 6 years of construction experience" (from research)`;
          dataSource = 'business_history or founder_background';
          break;
        
        case 'vague_social_proof':
          betterAlternative = `Name them. Example: "Trusted by 47 clients in New Cairo and Sheikh Zayed" (from client data)`;
          dataSource = 'client_list or testimonials';
          break;
      }

      detections.push({
        phrase: matches[0],
        betterAlternative,
        dataSource
      });
    }
  }

  return detections;
}
