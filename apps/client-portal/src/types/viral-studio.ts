export type ViralStudioPlatform = "instagram" | "tiktok" | "youtube";

export type BrandDNAProfile = {
  workspaceId: string;
  status: "draft" | "final";
  mission: string;
  valueProposition: string;
  productOrService: string;
  region: string;
  audiencePersonas: string[];
  pains: string[];
  desires: string[];
  objections: string[];
  voiceSliders: {
    bold: number;
    formal: number;
    playful: number;
    direct: number;
  };
  bannedPhrases: string[];
  requiredClaims: string[];
  exemplars: string[];
  summary: string;
  completeness: {
    step1: boolean;
    step2: boolean;
    step3: boolean;
    step4: boolean;
    ready: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

export type ViralStudioIngestionRun = {
  id: string;
  workspaceId: string;
  sourcePlatform: ViralStudioPlatform;
  sourceUrl: string;
  maxVideos: number;
  lookbackDays: number;
  sortBy: "engagement" | "recent" | "views";
  preset: "balanced" | "quick-scan" | "deep-scan";
  attempt: number;
  retryOfRunId?: string;
  status: "queued" | "running" | "partial" | "completed" | "failed";
  progress: {
    found: number;
    downloaded: number;
    analyzed: number;
    ranked: number;
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
};

export type ViralStudioReferenceAsset = {
  id: string;
  workspaceId: string;
  ingestionRunId: string;
  sourcePlatform: ViralStudioPlatform;
  sourceUrl: string;
  caption: string;
  transcriptSummary: string;
  ocrSummary: string;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    postedAt: string;
  };
  scores: {
    engagementRate: number;
    recency: number;
    hookStrength: number;
    retentionProxy: number;
    captionClarity: number;
    composite: number;
  };
  normalizedMetrics: {
    engagementRatePct: number;
    recencyPct: number;
    hookStrengthPct: number;
    retentionProxyPct: number;
    captionClarityPct: number;
  };
  explainability: {
    formulaVersion: "viral-score-v1";
    weightedContributions: {
      engagementRate: number;
      recency: number;
      hookStrength: number;
      retentionProxy: number;
      captionClarity: number;
    };
    topDrivers: string[];
    whyRankedHigh: string[];
  };
  ranking: {
    rank: number;
    rationaleTitle: string;
    rationaleBullets: string[];
  };
  shortlistState: "none" | "pin" | "exclude" | "must-use";
  createdAt: string;
  updatedAt: string;
};

export type ViralStudioGenerationPack = {
  id: string;
  workspaceId: string;
  status: "completed";
  promptTemplateId: string;
  formatTarget: "reel-30" | "reel-60" | "shorts" | "story";
  inputPrompt: string;
  selectedReferenceIds: string[];
  promptContext: {
    template: {
      id: string;
      title: string;
      intent: "hook-script" | "full-script" | "caption" | "cta" | "angle-remix";
    };
    formatTarget: "reel-30" | "reel-60" | "shorts" | "story";
    objective: string;
    audienceSnapshot: string;
    brandSummary: string;
    voiceProfile: string[];
    requiredClaims: string[];
    bannedPhrases: string[];
    referenceNotes: Array<{
      id: string;
      rank: number;
      platform: ViralStudioPlatform;
      rationale: string;
      cue: string;
    }>;
    composedPrompt: string;
  };
  outputs: {
    hooks: string[];
    scripts: {
      short: string;
      medium: string;
      long: string;
    };
    captions: string[];
    ctas: string[];
    angleRemixes: string[];
  };
  qualityCheck: {
    bannedTermHits: string[];
    toneMismatch: boolean;
    duplicates: string[];
    lengthWarnings: string[];
    passed: boolean;
  };
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ViralStudioGenerationSection =
  | "hooks"
  | "scripts.short"
  | "scripts.medium"
  | "scripts.long"
  | "captions"
  | "ctas"
  | "angleRemixes";

export type ViralStudioGenerationRefineMode = "refine" | "regenerate";
export type ViralStudioGenerationFormatTarget = "reel-30" | "reel-60" | "shorts" | "story";

export type ViralStudioDocumentSection = {
  id: string;
  title: string;
  kind: "hooks" | "script" | "captions" | "ctas" | "angles";
  content: string | string[];
};

export type ViralStudioDocument = {
  id: string;
  workspaceId: string;
  title: string;
  linkedGenerationIds: string[];
  sections: ViralStudioDocumentSection[];
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ViralStudioDocumentVersion = {
  id: string;
  workspaceId: string;
  documentId: string;
  author: string;
  summary: string;
  snapshotSections: ViralStudioDocumentSection[];
  createdAt: string;
};

export type ViralStudioPromptTemplate = {
  id: string;
  intent: "hook-script" | "full-script" | "caption" | "cta" | "angle-remix";
  title: string;
  description: string;
  requiredFields: string[];
  outputSchema: string;
  safetyConstraints: string[];
};

export type ViralStudioContractSnapshot = {
  version: "plan1";
  generatedAt: string;
  scoringWeights: {
    engagementRate: number;
    recency: number;
    hookStrength: number;
    retentionProxy: number;
    captionClarity: number;
  };
  stateMachines: Record<
    "onboarding" | "ingestion" | "generation" | "document",
    {
      states: string[];
      transitions: Array<{
        from: string;
        event: string;
        to: string;
        note?: string;
      }>;
    }
  >;
  telemetryEvents: Array<{
    name: string;
    stage: "onboarding" | "ingestion" | "curation" | "generation" | "document" | "platform";
    trigger: string;
    description: string;
  }>;
};
