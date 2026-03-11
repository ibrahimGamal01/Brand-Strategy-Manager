export type ViralStudioPlatform = "instagram" | "tiktok" | "youtube";

export type ViralStudioReferenceVisual = {
  posterUrl?: string;
  thumbnailUrl?: string;
  mediaKind?: "video" | "image";
  palette?: string[];
  eyebrow?: string;
  headline?: string;
  footer?: string;
};

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
  provenance?: Record<
    string,
    {
      source: string;
      confidence: number;
      sourceEvidence: ViralStudioSourceEvidence[];
      updatedAt: string;
    }
  >;
  autofillStatus?: "none" | "previewed" | "applied";
  createdAt: string;
  updatedAt: string;
  persistedAt?: string;
  storageMode?: "memory" | "dual" | "db";
};

export type ViralStudioIngestionRun = {
  id: string;
  workspaceId: string;
  sourcePlatform: ViralStudioPlatform;
  sourceUrl: string;
  maxVideos: number;
  lookbackDays: number;
  sortBy: "engagement" | "recent" | "views";
  preset: "balanced" | "quick-scan" | "deep-scan" | "data-max";
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
  persistedAt?: string;
  eventCount?: number;
  storageMode?: "memory" | "dual" | "db";
  assetRef?: string;
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
  visual?: ViralStudioReferenceVisual;
  shortlistState: "none" | "pin" | "exclude" | "must-use";
  createdAt: string;
  updatedAt: string;
  persistedAt?: string;
  storageMode?: "memory" | "dual" | "db";
  assetRef?: string;
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
  persistedAt?: string;
  revisionCount?: number;
  storageMode?: "memory" | "dual" | "db";
  assetRef?: string;
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

export type ViralStudioPlannerStage =
  | "design_analysis"
  | "design_selection"
  | "content_strategy"
  | "content_selection"
  | "format_selection"
  | "format_generation"
  | "document_save";

export type ViralStudioContentType =
  | "short_video"
  | "carousel"
  | "story_sequence"
  | "static_post"
  | "caption_set"
  | "cta_set";

export type ViralStudioPlannerSession = {
  id: string;
  workspaceId: string;
  stage: ViralStudioPlannerStage;
  shortlistedReferenceIds: string[];
  approvedDesignDirectionId?: string;
  approvedContentDirectionId?: string;
  selectedContentType?: ViralStudioContentType;
  latestFormatGenerationId?: string;
  createdAt: string;
  updatedAt: string;
  persistedAt?: string;
  storageMode?: "memory" | "dual" | "db";
};

export type ViralStudioDesignDirectionCandidate = {
  id: string;
  workspaceId: string;
  sessionId: string;
  orderIndex: number;
  archetypeName: string;
  sourceReferenceIds: string[];
  summary: string;
  layoutPattern: string;
  typographyCharacter: string;
  colorPaletteSummary: string;
  motionPacingNotes: string;
  hookFramingPattern: string;
  onScreenTextStyle: string;
  proofStructure: string;
  ctaPresentationStyle: string;
  bestFor: string[];
  whyGrouped: string[];
  pros: string[];
  risks: string[];
  thumbnailCluster: Array<{
    referenceId: string;
    platform: ViralStudioPlatform;
    label: string;
    mediaUrl?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  persistedAt?: string;
  storageMode?: "memory" | "dual" | "db";
};

export type ViralStudioApprovedDesignDirection = ViralStudioDesignDirectionCandidate & {
  candidateId: string;
  approvedAt: string;
};

export type ViralStudioContentDirectionCandidate = {
  id: string;
  workspaceId: string;
  sessionId: string;
  approvedDesignDirectionId: string;
  orderIndex: number;
  title: string;
  coreAudience: string;
  targetedPain: string;
  targetedDesire: string;
  bigPromise: string;
  proofAngle: string;
  objectionHandling: string;
  ctaIntent: string;
  toneStance: string;
  recommendedUseCases: string[];
  whyFitsDesign: string[];
  sourceReferenceIds: string[];
  createdAt: string;
  updatedAt: string;
  persistedAt?: string;
  storageMode?: "memory" | "dual" | "db";
};

export type ViralStudioApprovedContentDirection = ViralStudioContentDirectionCandidate & {
  candidateId: string;
  approvedAt: string;
};

export type ViralStudioFormatGenerationResult = {
  title: string;
  summary: string;
  contentType: ViralStudioContentType;
  approvedDesignDirectionId: string;
  approvedContentDirectionId: string;
  sourceReferenceIds: string[];
  designDetails: {
    layoutStructure: string[];
    typographyTreatment: string;
    onScreenTextGuidance: string[];
    pacingOrFrameStructure: string[];
    visualCompositionNotes: string[];
    assetSuggestions: string[];
  };
  contentDetails: {
    hook: string;
    narrativeBeats: string[];
    proofPlacement: string;
    cta: string;
    captionGuidance: string[];
    variantIdeas: string[];
  };
};

export type ViralStudioFormatGenerationJob = {
  id: string;
  workspaceId: string;
  sessionId: string;
  approvedDesignDirectionId: string;
  approvedContentDirectionId: string;
  contentType: ViralStudioContentType;
  status: "completed";
  generationPackId: string;
  selectedReferenceIds: string[];
  result: ViralStudioFormatGenerationResult;
  createdAt: string;
  updatedAt: string;
  persistedAt?: string;
  storageMode?: "memory" | "dual" | "db";
};

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
  persistedAt?: string;
  versionCount?: number;
  storageMode?: "memory" | "dual" | "db";
  assetRef?: string;
};

export type ViralStudioDocumentVersion = {
  id: string;
  workspaceId: string;
  documentId: string;
  author: string;
  summary: string;
  basedOnVersionId?: string;
  snapshotSections: ViralStudioDocumentSection[];
  createdAt: string;
  persistedAt?: string;
  versionNumber?: number;
  storageMode?: "memory" | "dual" | "db";
  assetRef?: string;
};

export type ViralStudioDocumentVersionComparison = {
  leftVersionId: string;
  rightVersionId: string;
  totalSections: number;
  changedSections: number;
  sectionDiffs: Array<{
    sectionKey: string;
    title: string;
    changed: boolean;
    leftPreview: string;
    rightPreview: string;
  }>;
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

export type ViralStudioTelemetrySnapshot = {
  workspaceId: string;
  funnel: {
    onboardingFinalized: boolean;
    ingestionsStarted: number;
    ingestionsCompleted: number;
    ingestionsFailed: number;
    generationsCompleted: number;
    documentsVersioned: number;
    exports: number;
  };
  errorClasses: Record<string, number>;
  latencyMs: {
    ingestionAvg: number;
    generationAvg: number;
    documentAvg: number;
  };
  recent: Array<{
    name: string;
    stage: "onboarding" | "ingestion" | "curation" | "generation" | "document" | "platform";
    status: "ok" | "error";
    durationMs: number;
    at: string;
  }>;
};

export type ViralStudioIngestionEvent = {
  id: number;
  workspaceId: string;
  ingestionRunId: string;
  type: string;
  status?: string;
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type ViralStudioStorageModeDiagnostics = {
  workspaceId: string;
  mode: "memory" | "dual" | "db";
  readStrategy: "memory-first" | "db-first";
  readsFromDb: boolean;
  writesToDb: boolean;
  writesToMemory: boolean;
  gatedDbRead: boolean;
  env: {
    VIRAL_STUDIO_PERSISTENCE_MODE: string;
    VIRAL_STUDIO_DB_READ_WORKSPACES: string;
  };
  counts: Record<string, number>;
};

export type ViralStudioSourceEvidence = {
  source:
    | "intake"
    | "website_snapshot"
    | "ddg"
    | "social_reference"
    | "inspiration_link"
    | "system";
  label: string;
  snippet?: string;
  url?: string;
};

export type ViralStudioAutofillFieldKey =
  | "mission"
  | "valueProposition"
  | "productOrService"
  | "region"
  | "audiencePersonas"
  | "pains"
  | "desires"
  | "objections"
  | "voiceSliders"
  | "bannedPhrases"
  | "requiredClaims"
  | "exemplars"
  | "summary";

export type ViralStudioBrandDnaAutofillPreview = {
  workspaceId: string;
  generatedAt: string;
  workflowStage:
    | "intake_pending"
    | "intake_complete"
    | "studio_autofill_review"
    | "extraction"
    | "curation"
    | "generation"
    | "chat_execution";
  autofillStatus: "none" | "previewed" | "applied";
  suggestionConfidence: number;
  sourceEvidence: ViralStudioSourceEvidence[];
  suggestedFields: ViralStudioAutofillFieldKey[];
  fieldSuggestions: Partial<
    Record<
      ViralStudioAutofillFieldKey,
      {
        field: ViralStudioAutofillFieldKey;
        value:
          | string
          | string[]
          | {
              bold: number;
              formal: number;
              playful: number;
              direct: number;
            };
        confidence: number;
        rationale: string;
        sourceEvidence: ViralStudioSourceEvidence[];
      }
    >
  >;
  coverage: {
    suggestedCount: number;
    evidenceCount: number;
    blockedFields: ViralStudioAutofillFieldKey[];
  };
};

export type ViralStudioWorkflowStatus = {
  workspaceId: string;
  workflowStage:
    | "intake_pending"
    | "intake_complete"
    | "studio_autofill_review"
    | "extraction"
    | "curation"
    | "generation"
    | "chat_execution";
  flow: Array<
    | "intake_complete"
    | "studio_autofill_review"
    | "extraction"
    | "curation"
    | "generation"
    | "chat_execution"
  >;
  intakeCompleted: boolean;
  brandDnaReady: boolean;
  autofillStatus: "none" | "previewed" | "applied";
  suggestionConfidence: number;
  sourceEvidence: ViralStudioSourceEvidence[];
  counts: {
    ingestions: number;
    references: number;
    prioritizedReferences: number;
    generations: number;
    documents: number;
  };
  latest: {
    ingestionStatus?: "queued" | "running" | "partial" | "completed" | "failed";
    generationId?: string;
    generationAssetRef?: string;
    documentId?: string;
    documentAssetRef?: string;
  };
};

export type ViralStudioSuggestedSource = {
  platform: ViralStudioPlatform;
  sourceUrl: string;
  source: "intake_handle" | "intake_social_reference" | "inspiration_link";
  confidence: number;
  label: string;
};
