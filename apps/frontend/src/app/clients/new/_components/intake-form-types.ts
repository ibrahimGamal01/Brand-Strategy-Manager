import { PlatformId } from './platforms';

export interface IntakeFormState {
  // Identity
  name: string;
  website: string;
  oneSentenceDescription: string;
  niche: string;
  businessType: string;
  // Where & who
  operateWhere: string;
  wantClientsWhere: string;
  idealAudience: string;
  targetAudience: string;
  geoScope: string;
  // Offer
  servicesList: string;
  mainOffer: string;
  primaryGoal: string;
  secondaryGoals: string;
  futureGoal: string;
  engineGoal: string;
  // Problems & results
  topProblems: string;
  resultsIn90Days: string;
  // Objections
  questionsBeforeBuying: string;
  // Voice & constraints
  brandVoiceWords: string;
  brandTone: string;
  topicsToAvoid: string;
  constraints: string;
  excludedCategories: string;
  language: string;
  planningHorizon: string;
  autonomyLevel: 'assist' | 'auto';
  budgetSensitivity: string;
  // Channels & inspiration
  competitorInspirationLinks: string;
  handles: Record<PlatformId, string>;
}

export const INITIAL_INTAKE_FORM_STATE: IntakeFormState = {
  name: '',
  website: '',
  oneSentenceDescription: '',
  niche: '',
  businessType: '',
  operateWhere: '',
  wantClientsWhere: '',
  idealAudience: '',
  targetAudience: '',
  geoScope: '',
  servicesList: '',
  mainOffer: '',
  primaryGoal: '',
  secondaryGoals: '',
  futureGoal: '',
  engineGoal: '',
  topProblems: '',
  resultsIn90Days: '',
  questionsBeforeBuying: '',
  brandVoiceWords: '',
  brandTone: '',
  topicsToAvoid: '',
  constraints: '',
  excludedCategories: '',
  language: '',
  planningHorizon: '',
  autonomyLevel: 'assist',
  budgetSensitivity: '',
  competitorInspirationLinks: '',
  handles: {
    instagram: '',
    tiktok: '',
    youtube: '',
    twitter: '',
  },
};
