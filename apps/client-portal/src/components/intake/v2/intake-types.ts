import { PlatformId } from "../platforms";

export type CompetitorLinkPlatform = PlatformId | "website" | "unknown";

export type CompetitorLinkKind = "competitor" | "inspiration";

export interface CompetitorLinkItem {
  id: string;
  raw: string;
  normalizedUrl: string;
  platform: CompetitorLinkPlatform;
  handle: string;
  hostname: string;
  kind: CompetitorLinkKind;
  valid: boolean;
}

export interface IntakeStateV2 {
  name: string;
  website: string;
  oneSentenceDescription: string;
  niche: string;
  businessType: string;
  operateWhere: string;
  wantClientsWhere: string;
  idealAudience: string;
  targetAudience: string;
  geoScope: string;
  servicesList: string[];
  mainOffer: string;
  primaryGoal: string;
  secondaryGoals: string[];
  futureGoal: string;
  engineGoal: string;
  topProblems: string[];
  resultsIn90Days: string[];
  questionsBeforeBuying: string[];
  brandVoiceWords: string[];
  brandTone: string;
  topicsToAvoid: string[];
  constraints: string;
  excludedCategories: string[];
  language: string;
  planningHorizon: string;
  autonomyLevel: "assist" | "auto";
  budgetSensitivity: string;
  competitorInspirationLinks: string[];
  competitorLinks: CompetitorLinkItem[];
  primaryChannel: PlatformId | "";
  handles: Record<PlatformId, string>;
}

export const INITIAL_INTAKE_STATE_V2: IntakeStateV2 = {
  name: "",
  website: "",
  oneSentenceDescription: "",
  niche: "",
  businessType: "",
  operateWhere: "",
  wantClientsWhere: "",
  idealAudience: "",
  targetAudience: "",
  geoScope: "",
  servicesList: [],
  mainOffer: "",
  primaryGoal: "",
  secondaryGoals: [],
  futureGoal: "",
  engineGoal: "",
  topProblems: [],
  resultsIn90Days: [],
  questionsBeforeBuying: [],
  brandVoiceWords: [],
  brandTone: "",
  topicsToAvoid: [],
  constraints: "",
  excludedCategories: [],
  language: "",
  planningHorizon: "",
  autonomyLevel: "assist",
  budgetSensitivity: "",
  competitorInspirationLinks: [],
  competitorLinks: [],
  primaryChannel: "",
  handles: {
    instagram: "",
    tiktok: "",
    youtube: "",
    twitter: "",
  },
};

export type IntakeWizardStepId = "brand" | "channels" | "offer" | "audience" | "voice";
