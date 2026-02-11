import { PlatformId } from './platforms';

export interface IntakeFormState {
  name: string;
  niche: string;
  businessType: string;
  website: string;
  primaryGoal: string;
  secondaryGoals: string;
  futureGoal: string;
  engineGoal: string;
  targetAudience: string;
  geoScope: string;
  language: string;
  planningHorizon: string;
  autonomyLevel: 'assist' | 'auto';
  budgetSensitivity: string;
  brandTone: string;
  constraints: string;
  excludedCategories: string;
  handles: Record<PlatformId, string>;
}

export const INITIAL_INTAKE_FORM_STATE: IntakeFormState = {
  name: '',
  niche: '',
  businessType: '',
  website: '',
  primaryGoal: '',
  secondaryGoals: '',
  futureGoal: '',
  engineGoal: '',
  targetAudience: '',
  geoScope: '',
  language: '',
  planningHorizon: '',
  autonomyLevel: 'assist',
  budgetSensitivity: '',
  brandTone: '',
  constraints: '',
  excludedCategories: '',
  handles: {
    instagram: '',
    tiktok: '',
    youtube: '',
    twitter: '',
  },
};

