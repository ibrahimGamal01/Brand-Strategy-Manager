import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma';

export type ViralStudioPlatform = 'instagram' | 'tiktok' | 'youtube';
export type IngestionSortBy = 'engagement' | 'recent' | 'views';
export type IngestionStatus = 'queued' | 'running' | 'partial' | 'completed' | 'failed';
export type IngestionPreset = 'balanced' | 'quick-scan' | 'deep-scan';
export type ShortlistAction = 'pin' | 'exclude' | 'must-use' | 'clear';
export type ShortlistState = 'none' | 'pin' | 'exclude' | 'must-use';

export type BrandDnaStatus = 'draft' | 'final';

export type BrandDnaVoiceSliders = {
  bold: number;
  formal: number;
  playful: number;
  direct: number;
};

export type BrandDnaCompleteness = {
  step1: boolean;
  step2: boolean;
  step3: boolean;
  step4: boolean;
  ready: boolean;
};

export type BrandDNAProfile = {
  workspaceId: string;
  status: BrandDnaStatus;
  mission: string;
  valueProposition: string;
  productOrService: string;
  region: string;
  audiencePersonas: string[];
  pains: string[];
  desires: string[];
  objections: string[];
  voiceSliders: BrandDnaVoiceSliders;
  bannedPhrases: string[];
  requiredClaims: string[];
  exemplars: string[];
  summary: string;
  completeness: BrandDnaCompleteness;
  createdAt: string;
  updatedAt: string;
};

export type UpsertBrandDNAInput = Partial<{
  status: BrandDnaStatus;
  mission: string;
  valueProposition: string;
  productOrService: string;
  region: string;
  audiencePersonas: string[];
  pains: string[];
  desires: string[];
  objections: string[];
  voiceSliders: Partial<BrandDnaVoiceSliders>;
  bannedPhrases: string[];
  requiredClaims: string[];
  exemplars: string[];
  summary: string;
}>;

export type BrandDnaSummaryResult = {
  summary: string;
  bullets: string[];
};

export type IngestionRun = {
  id: string;
  workspaceId: string;
  sourcePlatform: ViralStudioPlatform;
  sourceUrl: string;
  maxVideos: number;
  lookbackDays: number;
  sortBy: IngestionSortBy;
  preset: IngestionPreset;
  attempt: number;
  retryOfRunId?: string;
  status: IngestionStatus;
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

export type CreateIngestionRunInput = {
  sourcePlatform: ViralStudioPlatform;
  sourceUrl: string;
  maxVideos?: number;
  lookbackDays?: number;
  sortBy?: IngestionSortBy;
  preset?: IngestionPreset;
};

export type ReferenceAsset = {
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
    formulaVersion: 'viral-score-v1';
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
  shortlistState: ShortlistState;
  createdAt: string;
  updatedAt: string;
};

export type ReferenceListFilters = {
  ingestionRunId?: string;
  shortlistOnly?: boolean;
  includeExcluded?: boolean;
};

export type PromptTemplate = {
  id: string;
  intent: 'hook-script' | 'full-script' | 'caption' | 'cta' | 'angle-remix';
  title: string;
  description: string;
  requiredFields: string[];
  outputSchema: string;
  safetyConstraints: string[];
};

export type GenerationSection =
  | 'hooks'
  | 'scripts.short'
  | 'scripts.medium'
  | 'scripts.long'
  | 'captions'
  | 'ctas'
  | 'angleRemixes';

export type GenerationRefineMode = 'refine' | 'regenerate';
export type GenerationFormatTarget = 'reel-30' | 'reel-60' | 'shorts' | 'story';

export type GenerationPromptContext = {
  template: {
    id: string;
    title: string;
    intent: PromptTemplate['intent'];
  };
  formatTarget: GenerationFormatTarget;
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

export type GenerationPack = {
  id: string;
  workspaceId: string;
  status: 'completed';
  promptTemplateId: string;
  formatTarget: GenerationFormatTarget;
  inputPrompt: string;
  selectedReferenceIds: string[];
  promptContext: GenerationPromptContext;
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

export type CreateGenerationPackInput = {
  templateId?: string;
  prompt?: string;
  selectedReferenceIds?: string[];
  formatTarget?: GenerationFormatTarget;
};

export type RefineGenerationInput = {
  section: GenerationSection;
  instruction?: string;
  mode?: GenerationRefineMode;
};

export type StudioDocumentSection = {
  id: string;
  title: string;
  kind: 'hooks' | 'script' | 'captions' | 'ctas' | 'angles';
  content: string | string[];
};

export type StudioDocument = {
  id: string;
  workspaceId: string;
  title: string;
  linkedGenerationIds: string[];
  sections: StudioDocumentSection[];
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudioDocumentVersion = {
  id: string;
  workspaceId: string;
  documentId: string;
  author: string;
  summary: string;
  snapshotSections: StudioDocumentSection[];
  createdAt: string;
};

export type CreateStudioDocumentInput = {
  title?: string;
  generationId: string;
};

export type CreateStudioDocumentVersionInput = {
  author?: string;
  summary?: string;
};

export type ExportStudioDocumentFormat = 'markdown' | 'json';

export type ExportStudioDocumentResult = {
  format: ExportStudioDocumentFormat;
  fileName: string;
  contentType: string;
  content: string;
};

export type TelemetryEventDefinition = {
  name: string;
  stage: 'onboarding' | 'ingestion' | 'curation' | 'generation' | 'document' | 'platform';
  trigger: string;
  description: string;
};

export type StateTransitionDefinition = {
  from: string;
  event: string;
  to: string;
  note?: string;
};

export type ViralStudioContractSnapshot = {
  version: 'plan1';
  generatedAt: string;
  scoringWeights: {
    engagementRate: number;
    recency: number;
    hookStrength: number;
    retentionProxy: number;
    captionClarity: number;
  };
  stateMachines: Record<
    'onboarding' | 'ingestion' | 'generation' | 'document',
    {
      states: string[];
      transitions: StateTransitionDefinition[];
    }
  >;
  telemetryEvents: TelemetryEventDefinition[];
};

type WorkspaceViralStudioStore = {
  brandDna: BrandDNAProfile | null;
  ingestions: Map<string, IngestionRun>;
  references: Map<string, ReferenceAsset>;
  generations: Map<string, GenerationPack>;
  documents: Map<string, StudioDocument>;
  documentVersions: Map<string, StudioDocumentVersion[]>;
};

const DEFAULT_SCORING_WEIGHTS = {
  engagementRate: 0.35,
  recency: 0.2,
  hookStrength: 0.2,
  retentionProxy: 0.15,
  captionClarity: 0.1,
} as const;

const DEFAULT_INGESTION_POLICY = {
  maxVideos: 50,
  lookbackDays: 180,
  sortBy: 'engagement' as IngestionSortBy,
  preset: 'balanced' as IngestionPreset,
} as const;

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'hook-script',
    intent: 'hook-script',
    title: 'Hook Script',
    description: 'Generate strong opening hooks inspired by top references.',
    requiredFields: ['audience', 'goal', 'tone'],
    outputSchema: 'hooks[]',
    safetyConstraints: ['respect banned phrases', 'avoid unverifiable claims'],
  },
  {
    id: 'full-script',
    intent: 'full-script',
    title: 'Full Script',
    description: 'Generate short, medium, and long script variants.',
    requiredFields: ['offer', 'audience', 'brand voice'],
    outputSchema: 'scripts.short, scripts.medium, scripts.long',
    safetyConstraints: ['respect required claims', 'keep CTA explicit'],
  },
  {
    id: 'caption',
    intent: 'caption',
    title: 'Caption',
    description: 'Generate conversion-oriented caption variants.',
    requiredFields: ['platform', 'audience pain', 'offer angle'],
    outputSchema: 'captions[]',
    safetyConstraints: ['avoid all-caps spam', 'no banned terms'],
  },
  {
    id: 'cta',
    intent: 'cta',
    title: 'CTA',
    description: 'Generate direct call-to-action options.',
    requiredFields: ['goal', 'offer'],
    outputSchema: 'ctas[]',
    safetyConstraints: ['no misleading urgency'],
  },
  {
    id: 'angle-remix',
    intent: 'angle-remix',
    title: 'Angle Remix',
    description: 'Remix winning ideas into new creative angles.',
    requiredFields: ['references', 'brand voice'],
    outputSchema: 'angleRemixes[]',
    safetyConstraints: ['avoid duplicate phrasing'],
  },
];

const TELEMETRY_EVENTS: TelemetryEventDefinition[] = [
  {
    name: 'viral_studio_onboarding_viewed',
    stage: 'onboarding',
    trigger: 'On module open before Brand DNA completion',
    description: 'Tracks first-view funnel entry for onboarding.',
  },
  {
    name: 'viral_studio_brand_dna_saved',
    stage: 'onboarding',
    trigger: 'Brand DNA draft save',
    description: 'Tracks draft saves in the 4-step DNA flow.',
  },
  {
    name: 'viral_studio_brand_dna_finalized',
    stage: 'onboarding',
    trigger: 'Brand DNA marked final',
    description: 'Tracks completion conversion of onboarding.',
  },
  {
    name: 'viral_studio_ingestion_started',
    stage: 'ingestion',
    trigger: 'Ingestion run create request',
    description: 'Tracks extraction starts by platform.',
  },
  {
    name: 'viral_studio_ingestion_completed',
    stage: 'ingestion',
    trigger: 'Ingestion run reaches completed',
    description: 'Tracks completion reliability and speed.',
  },
  {
    name: 'viral_studio_ingestion_failed',
    stage: 'ingestion',
    trigger: 'Ingestion run reaches failed',
    description: 'Tracks extraction failures.',
  },
  {
    name: 'viral_studio_reference_shortlisted',
    stage: 'curation',
    trigger: 'Reference state set to pin/must-use/exclude',
    description: 'Tracks curation behavior before generation.',
  },
  {
    name: 'viral_studio_generation_requested',
    stage: 'generation',
    trigger: 'Generation request accepted',
    description: 'Tracks generation starts.',
  },
  {
    name: 'viral_studio_generation_completed',
    stage: 'generation',
    trigger: 'Generation pack stored',
    description: 'Tracks generation success.',
  },
  {
    name: 'viral_studio_generation_refined',
    stage: 'generation',
    trigger: 'Refine endpoint invoked',
    description: 'Tracks iterative edits.',
  },
  {
    name: 'viral_studio_document_created',
    stage: 'document',
    trigger: 'Document created from generation',
    description: 'Tracks document persistence conversion.',
  },
  {
    name: 'viral_studio_document_version_created',
    stage: 'document',
    trigger: 'Version snapshot created',
    description: 'Tracks versioning usage.',
  },
  {
    name: 'viral_studio_document_exported',
    stage: 'document',
    trigger: 'Export request fulfilled',
    description: 'Tracks export behavior and format preference.',
  },
  {
    name: 'viral_studio_contracts_viewed',
    stage: 'platform',
    trigger: 'Contracts endpoint fetched',
    description: 'Tracks Plan 1 system-contract usage.',
  },
];

const workspaceStores = new Map<string, WorkspaceViralStudioStore>();
const BRAND_DNA_SCOPE = 'workspace_profile';
const BRAND_DNA_BRANCH = 'global';
const BRAND_DNA_KEY = 'viral_studio_brand_dna';

function toIsoNow(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function cleanString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanString(entry))
    .filter(Boolean)
    .slice(0, maxItems);
}

function toShortHash(input: string): number {
  const digest = crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
  return Number.parseInt(digest, 16);
}

function ensureWorkspaceStore(workspaceId: string): WorkspaceViralStudioStore {
  const normalized = cleanString(workspaceId);
  const existing = workspaceStores.get(normalized);
  if (existing) return existing;
  const created: WorkspaceViralStudioStore = {
    brandDna: null,
    ingestions: new Map<string, IngestionRun>(),
    references: new Map<string, ReferenceAsset>(),
    generations: new Map<string, GenerationPack>(),
    documents: new Map<string, StudioDocument>(),
    documentVersions: new Map<string, StudioDocumentVersion[]>(),
  };
  workspaceStores.set(normalized, created);
  return created;
}

function resolveVoiceSliders(
  partial: Partial<BrandDnaVoiceSliders> | undefined,
  fallback?: BrandDnaVoiceSliders
): BrandDnaVoiceSliders {
  const base = fallback || {
    bold: 55,
    formal: 40,
    playful: 45,
    direct: 65,
  };
  return {
    bold: clamp(Number(partial?.bold ?? base.bold), 0, 100),
    formal: clamp(Number(partial?.formal ?? base.formal), 0, 100),
    playful: clamp(Number(partial?.playful ?? base.playful), 0, 100),
    direct: clamp(Number(partial?.direct ?? base.direct), 0, 100),
  };
}

function createEmptyBrandDna(workspaceId: string): BrandDNAProfile {
  const timestamp = toIsoNow();
  const profile: Omit<BrandDNAProfile, 'completeness'> = {
    workspaceId,
    status: 'draft',
    mission: '',
    valueProposition: '',
    productOrService: '',
    region: '',
    audiencePersonas: [],
    pains: [],
    desires: [],
    objections: [],
    voiceSliders: resolveVoiceSliders(undefined),
    bannedPhrases: [],
    requiredClaims: [],
    exemplars: [],
    summary: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    ...profile,
    completeness: resolveBrandDnaCompleteness(profile),
  };
}

function resolveBrandDnaCompleteness(profile: Omit<BrandDNAProfile, 'completeness'>): BrandDnaCompleteness {
  const step1 = Boolean(
    profile.mission &&
      profile.valueProposition &&
      profile.productOrService &&
      profile.region
  );
  const step2 = profile.audiencePersonas.length > 0 && (profile.pains.length > 0 || profile.desires.length > 0);
  const step3 = profile.bannedPhrases.length > 0 || profile.requiredClaims.length > 0;
  const step4 = profile.exemplars.length > 0 && Boolean(profile.summary);
  return {
    step1,
    step2,
    step3,
    step4,
    ready: step1 && step2 && step3 && step4,
  };
}

function mergeBrandDna(
  workspaceId: string,
  input: UpsertBrandDNAInput,
  existing: BrandDNAProfile | null
): BrandDNAProfile {
  const now = toIsoNow();
  const base = existing || createEmptyBrandDna(workspaceId);
  const draft: Omit<BrandDNAProfile, 'completeness'> = {
    workspaceId,
    status: base.status,
    mission: cleanString(input.mission ?? base.mission),
    valueProposition: cleanString(input.valueProposition ?? base.valueProposition),
    productOrService: cleanString(input.productOrService ?? base.productOrService),
    region: cleanString(input.region ?? base.region),
    audiencePersonas: input.audiencePersonas ? cleanArray(input.audiencePersonas, 8) : base.audiencePersonas,
    pains: input.pains ? cleanArray(input.pains, 12) : base.pains,
    desires: input.desires ? cleanArray(input.desires, 12) : base.desires,
    objections: input.objections ? cleanArray(input.objections, 12) : base.objections,
    voiceSliders: resolveVoiceSliders(input.voiceSliders, base.voiceSliders),
    bannedPhrases: input.bannedPhrases ? cleanArray(input.bannedPhrases, 24) : base.bannedPhrases,
    requiredClaims: input.requiredClaims ? cleanArray(input.requiredClaims, 24) : base.requiredClaims,
    exemplars: input.exemplars ? cleanArray(input.exemplars, 12) : base.exemplars,
    summary: cleanString(input.summary ?? base.summary),
    createdAt: base.createdAt,
    updatedAt: now,
  };

  const completeness = resolveBrandDnaCompleteness(draft);
  const requestedStatus = input.status || base.status;
  return {
    ...draft,
    status: requestedStatus === 'final' && completeness.ready ? 'final' : 'draft',
    completeness,
  };
}

function fromPersistedBrandDna(workspaceId: string, value: unknown): BrandDNAProfile | null {
  const record = asRecord(value);
  const next = mergeBrandDna(
    workspaceId,
    {
      status: cleanString(record.status) === 'final' ? 'final' : 'draft',
      mission: cleanString(record.mission),
      valueProposition: cleanString(record.valueProposition),
      productOrService: cleanString(record.productOrService),
      region: cleanString(record.region),
      audiencePersonas: cleanArray(record.audiencePersonas, 8),
      pains: cleanArray(record.pains, 12),
      desires: cleanArray(record.desires, 12),
      objections: cleanArray(record.objections, 12),
      voiceSliders: asRecord(record.voiceSliders),
      bannedPhrases: cleanArray(record.bannedPhrases, 24),
      requiredClaims: cleanArray(record.requiredClaims, 24),
      exemplars: cleanArray(record.exemplars, 12),
      summary: cleanString(record.summary),
    },
    null
  );

  if (
    !next.mission &&
    !next.valueProposition &&
    !next.productOrService &&
    !next.region &&
    !next.summary &&
    next.exemplars.length === 0
  ) {
    return null;
  }

  return {
    ...next,
    createdAt: cleanString(record.createdAt) || next.createdAt,
    updatedAt: cleanString(record.updatedAt) || next.updatedAt,
  };
}

async function loadPersistedBrandDna(workspaceId: string): Promise<BrandDNAProfile | null> {
  const row = await prisma.workspaceMemorySnapshot.findUnique({
    where: {
      researchJobId_branchId_scope_key: {
        researchJobId: workspaceId,
        branchId: BRAND_DNA_BRANCH,
        scope: BRAND_DNA_SCOPE,
        key: BRAND_DNA_KEY,
      },
    },
    select: {
      valueJson: true,
    },
  });
  if (!row) return null;
  return fromPersistedBrandDna(workspaceId, row.valueJson);
}

async function persistBrandDna(workspaceId: string, profile: BrandDNAProfile): Promise<void> {
  await prisma.workspaceMemorySnapshot.upsert({
    where: {
      researchJobId_branchId_scope_key: {
        researchJobId: workspaceId,
        branchId: BRAND_DNA_BRANCH,
        scope: BRAND_DNA_SCOPE,
        key: BRAND_DNA_KEY,
      },
    },
    update: {
      valueJson: profile as any,
      confidence: 0.95,
    },
    create: {
      researchJobId: workspaceId,
      branchId: BRAND_DNA_BRANCH,
      scope: BRAND_DNA_SCOPE,
      key: BRAND_DNA_KEY,
      valueJson: profile as any,
      confidence: 0.95,
      sourceRunId: null,
    },
  });
}

export function createBrandDnaSummary(input: Partial<{
  mission: string;
  valueProposition: string;
  productOrService: string;
  region: string;
  audiencePersonas: string[];
  pains: string[];
  desires: string[];
  voiceSliders: Partial<BrandDnaVoiceSliders>;
}>): BrandDnaSummaryResult {
  const mission = cleanString(input.mission) || 'Grow brand impact with consistent high-converting content.';
  const valueProposition = cleanString(input.valueProposition) || 'Clear differentiation and practical marketing execution.';
  const productOrService = cleanString(input.productOrService) || 'Offer';
  const region = cleanString(input.region) || 'Global';
  const persona = cleanArray(input.audiencePersonas, 8)[0] || 'target audience';
  const pain = cleanArray(input.pains, 12)[0] || 'inconsistent performance';
  const desire = cleanArray(input.desires, 12)[0] || 'predictable growth';
  const voice = resolveVoiceSliders(input.voiceSliders);

  const toneParts: string[] = [];
  if (voice.bold >= 60) toneParts.push('bold');
  if (voice.formal >= 60) toneParts.push('professional');
  if (voice.playful >= 60) toneParts.push('playful');
  if (voice.direct >= 60) toneParts.push('direct');
  if (toneParts.length === 0) toneParts.push('balanced');

  const summary = `${mission} ${productOrService} is positioned for ${persona} in ${region}, solving ${pain} and guiding them toward ${desire}. Messaging style should remain ${toneParts.join(', ')} while reinforcing: ${valueProposition}.`;

  return {
    summary,
    bullets: [
      `Audience focus: ${persona}`,
      `Primary tension: ${pain}`,
      `Desired outcome: ${desire}`,
      `Voice profile: ${toneParts.join(', ')}`,
    ],
  };
}

function getTemplateById(templateId?: string): PromptTemplate {
  const normalized = cleanString(templateId);
  if (!normalized) return PROMPT_TEMPLATES[0];
  const matched = PROMPT_TEMPLATES.find((template) => template.id === normalized);
  return matched || PROMPT_TEMPLATES[0];
}

function computeCompositeScore(input: {
  engagementRate: number;
  recency: number;
  hookStrength: number;
  retentionProxy: number;
  captionClarity: number;
}): number {
  return Number(
    (
      input.engagementRate * DEFAULT_SCORING_WEIGHTS.engagementRate +
      input.recency * DEFAULT_SCORING_WEIGHTS.recency +
      input.hookStrength * DEFAULT_SCORING_WEIGHTS.hookStrength +
      input.retentionProxy * DEFAULT_SCORING_WEIGHTS.retentionProxy +
      input.captionClarity * DEFAULT_SCORING_WEIGHTS.captionClarity
    ).toFixed(4)
  );
}

function toPct(value: number): number {
  return Number((clamp(value, 0, 1) * 100).toFixed(1));
}

function buildReferenceExplainability(input: {
  engagementRate: number;
  recency: number;
  hookStrength: number;
  retentionProxy: number;
  captionClarity: number;
  composite: number;
}): {
  normalizedMetrics: ReferenceAsset['normalizedMetrics'];
  explainability: ReferenceAsset['explainability'];
  rationaleTitle: string;
  rationaleBullets: string[];
} {
  const weightedContributions = {
    engagementRate: Number((input.engagementRate * DEFAULT_SCORING_WEIGHTS.engagementRate).toFixed(4)),
    recency: Number((input.recency * DEFAULT_SCORING_WEIGHTS.recency).toFixed(4)),
    hookStrength: Number((input.hookStrength * DEFAULT_SCORING_WEIGHTS.hookStrength).toFixed(4)),
    retentionProxy: Number((input.retentionProxy * DEFAULT_SCORING_WEIGHTS.retentionProxy).toFixed(4)),
    captionClarity: Number((input.captionClarity * DEFAULT_SCORING_WEIGHTS.captionClarity).toFixed(4)),
  };

  const labelMap: Record<keyof typeof weightedContributions, string> = {
    engagementRate: 'Engagement-rate momentum',
    recency: 'Recency advantage',
    hookStrength: 'Hook strength',
    retentionProxy: 'Retention proxy',
    captionClarity: 'Caption clarity',
  };
  const sortedContributions = Object.entries(weightedContributions)
    .map(([key, value]) => ({
      key: key as keyof typeof weightedContributions,
      value,
      label: labelMap[key as keyof typeof weightedContributions],
    }))
    .sort((a, b) => b.value - a.value);

  const topDrivers = sortedContributions
    .slice(0, 3)
    .map((item) => `${item.label}: ${(item.value * 100).toFixed(1)} pts`);
  const primary = sortedContributions[0]?.label || 'Engagement-rate momentum';
  const secondary = sortedContributions[1]?.label || 'Hook strength';

  return {
    normalizedMetrics: {
      engagementRatePct: toPct(input.engagementRate),
      recencyPct: toPct(input.recency),
      hookStrengthPct: toPct(input.hookStrength),
      retentionProxyPct: toPct(input.retentionProxy),
      captionClarityPct: toPct(input.captionClarity),
    },
    explainability: {
      formulaVersion: 'viral-score-v1',
      weightedContributions,
      topDrivers,
      whyRankedHigh: [
        `Composite viral score ${(input.composite * 100).toFixed(1)} / 100 using weighted normalization across engagement, recency, hook, retention proxy, and caption clarity.`,
        `${primary} and ${secondary} are the strongest drivers for this asset.`,
        `Metric profile: engagement ${toPct(input.engagementRate)}%, recency ${toPct(input.recency)}%, hook ${toPct(input.hookStrength)}%, retention ${toPct(input.retentionProxy)}%, caption ${toPct(input.captionClarity)}%.`,
      ],
    },
    rationaleTitle: `${primary} + ${secondary}`,
    rationaleBullets: [
      `${primary} contribution ${((sortedContributions[0]?.value || 0) * 100).toFixed(1)} pts.`,
      `${secondary} contribution ${((sortedContributions[1]?.value || 0) * 100).toFixed(1)} pts.`,
      `Composite score ${(input.composite * 100).toFixed(1)} after weighted normalization.`,
    ],
  };
}

function buildSyntheticReference(input: {
  workspaceId: string;
  run: IngestionRun;
  index: number;
  total: number;
}): ReferenceAsset {
  const seed = toShortHash(`${input.run.sourceUrl}:${input.index}:${input.run.id}`);
  const views = 15000 + (seed % 940000);
  const likes = Math.floor(views * (0.01 + ((seed >> 3) % 500) / 10000));
  const comments = Math.floor(views * (0.001 + ((seed >> 6) % 90) / 10000));
  const shares = Math.floor(views * (0.0009 + ((seed >> 7) % 80) / 10000));
  const recencyDays = (seed % Math.max(10, input.run.lookbackDays)) + 1;
  const postedAt = new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000).toISOString();
  const engagementRateRaw = (likes + comments + shares) / Math.max(1, views);
  const engagementRate = clamp(engagementRateRaw * 8, 0, 1);
  const recency = clamp(1 - recencyDays / Math.max(1, input.run.lookbackDays), 0, 1);
  const hookStrength = clamp(((seed >> 2) % 100) / 100, 0, 1);
  const retentionProxy = clamp(((seed >> 4) % 100) / 100, 0, 1);
  const captionClarity = clamp(((seed >> 8) % 100) / 100, 0, 1);
  const composite = computeCompositeScore({
    engagementRate,
    recency,
    hookStrength,
    retentionProxy,
    captionClarity,
  });
  const explanation = buildReferenceExplainability({
    engagementRate,
    recency,
    hookStrength,
    retentionProxy,
    captionClarity,
    composite,
  });

  return {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    ingestionRunId: input.run.id,
    sourcePlatform: input.run.sourcePlatform,
    sourceUrl: `${input.run.sourceUrl}/video-${input.index + 1}`,
    caption: `High-performing ${input.run.sourcePlatform} angle ${input.index + 1}: lead with an audience pain, then promise a measurable transformation in under 15 seconds.`,
    transcriptSummary:
      'Opens with a direct hook, names one concrete pain, demonstrates a quick before/after contrast, closes with action.',
    ocrSummary: 'On-screen text emphasizes urgency, social proof, and a clear CTA.',
    metrics: {
      views,
      likes,
      comments,
      shares,
      postedAt,
    },
    scores: {
      engagementRate,
      recency,
      hookStrength,
      retentionProxy,
      captionClarity,
      composite,
    },
    normalizedMetrics: explanation.normalizedMetrics,
    explainability: explanation.explainability,
    ranking: {
      rank: input.total - input.index,
      rationaleTitle: explanation.rationaleTitle,
      rationaleBullets: [
        ...explanation.rationaleBullets,
        `Recency window: ${recencyDays} days from publish date.`,
      ],
    },
    shortlistState: 'none',
    createdAt: toIsoNow(),
    updatedAt: toIsoNow(),
  };
}

function sortReferencesForOutput(references: ReferenceAsset[]): ReferenceAsset[] {
  const sorted = [...references].sort((a, b) => {
    if (b.scores.composite !== a.scores.composite) return b.scores.composite - a.scores.composite;
    return b.metrics.views - a.metrics.views;
  });
  return sorted.map((item, index) => ({
    ...item,
    ranking: {
      ...item.ranking,
      rank: index + 1,
    },
  }));
}

function runQualityGate(outputs: GenerationPack['outputs'], profile: BrandDNAProfile | null): GenerationPack['qualityCheck'] {
  const fullText = [
    ...outputs.hooks,
    outputs.scripts.short,
    outputs.scripts.medium,
    outputs.scripts.long,
    ...outputs.captions,
    ...outputs.ctas,
    ...outputs.angleRemixes,
  ]
    .join('\n')
    .toLowerCase();

  const bannedTermHits = (profile?.bannedPhrases || []).filter((phrase) => {
    const normalized = cleanString(phrase).toLowerCase();
    return normalized ? fullText.includes(normalized) : false;
  });

  const mergedShortTexts = [...outputs.hooks, ...outputs.captions, ...outputs.ctas, ...outputs.angleRemixes].map((line) =>
    cleanString(line).toLowerCase()
  );
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const item of mergedShortTexts) {
    if (!item) continue;
    if (seen.has(item)) {
      duplicates.push(item.slice(0, 80));
      continue;
    }
    seen.add(item);
  }

  const lengthWarnings: string[] = [];
  if (outputs.scripts.short.length > 420) lengthWarnings.push('Short script exceeds recommended length (420 chars).');
  if (outputs.scripts.medium.length > 900) lengthWarnings.push('Medium script exceeds recommended length (900 chars).');
  if (outputs.scripts.long.length > 1600) lengthWarnings.push('Long script exceeds recommended length (1600 chars).');

  const toneMismatch =
    (profile?.voiceSliders.formal || 0) >= 75 &&
    /yo\b|crazy deal\b|insane\b/i.test(fullText);

  return {
    bannedTermHits,
    toneMismatch,
    duplicates,
    lengthWarnings,
    passed: bannedTermHits.length === 0 && !toneMismatch,
  };
}

function buildDocumentSectionsFromGeneration(generation: GenerationPack): StudioDocumentSection[] {
  return [
    {
      id: crypto.randomUUID(),
      title: 'Hooks',
      kind: 'hooks',
      content: generation.outputs.hooks,
    },
    {
      id: crypto.randomUUID(),
      title: 'Short Script',
      kind: 'script',
      content: generation.outputs.scripts.short,
    },
    {
      id: crypto.randomUUID(),
      title: 'Medium Script',
      kind: 'script',
      content: generation.outputs.scripts.medium,
    },
    {
      id: crypto.randomUUID(),
      title: 'Long Script',
      kind: 'script',
      content: generation.outputs.scripts.long,
    },
    {
      id: crypto.randomUUID(),
      title: 'Captions',
      kind: 'captions',
      content: generation.outputs.captions,
    },
    {
      id: crypto.randomUUID(),
      title: 'CTAs',
      kind: 'ctas',
      content: generation.outputs.ctas,
    },
    {
      id: crypto.randomUUID(),
      title: 'Angle Remixes',
      kind: 'angles',
      content: generation.outputs.angleRemixes,
    },
  ];
}

function buildMarkdownDocument(document: StudioDocument, versions: StudioDocumentVersion[]): string {
  const lines: string[] = [];
  lines.push(`# ${document.title}`);
  lines.push('');
  lines.push(`- Workspace: ${document.workspaceId}`);
  lines.push(`- Document ID: ${document.id}`);
  lines.push(`- Updated At: ${document.updatedAt}`);
  lines.push(`- Current Version: ${document.currentVersionId || 'none'}`);
  lines.push('');

  for (const section of document.sections) {
    lines.push(`## ${section.title}`);
    if (Array.isArray(section.content)) {
      for (const line of section.content) {
        lines.push(`- ${line}`);
      }
    } else {
      lines.push(section.content);
    }
    lines.push('');
  }

  if (versions.length > 0) {
    lines.push('## Version Timeline');
    for (const version of versions) {
      lines.push(`- ${version.createdAt} • ${version.author} • ${version.summary} • ${version.id}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function updateStoredReferencesWithSortedOrder(store: WorkspaceViralStudioStore, references: ReferenceAsset[]) {
  for (const reference of references) {
    store.references.set(reference.id, reference);
  }
}

function pickReferenceSelection(
  workspaceId: string,
  store: WorkspaceViralStudioStore,
  inputIds?: string[]
): ReferenceAsset[] {
  const requestedIds = Array.isArray(inputIds) ? inputIds.map((value) => cleanString(value)).filter(Boolean) : [];
  if (requestedIds.length > 0) {
    const direct = requestedIds
      .map((id) => store.references.get(id))
      .filter((value): value is ReferenceAsset => Boolean(value))
      .filter((value) => value.shortlistState !== 'exclude');
    if (direct.length > 0) return direct.slice(0, 8);
  }

  const sorted = listReferenceAssets(workspaceId, { includeExcluded: false });
  const mustUse = sorted.filter((item) => item.shortlistState === 'must-use');
  const pinned = sorted.filter((item) => item.shortlistState === 'pin');
  const fallback = sorted.filter((item) => item.shortlistState === 'none');
  return [...mustUse, ...pinned, ...fallback].slice(0, 8);
}

function voiceProfileFromBrand(profile: BrandDNAProfile | null): string[] {
  if (!profile) return ['balanced'];
  const labels: string[] = [];
  if (profile.voiceSliders.bold >= 60) labels.push('bold');
  if (profile.voiceSliders.formal >= 60) labels.push('professional');
  if (profile.voiceSliders.playful >= 60) labels.push('playful');
  if (profile.voiceSliders.direct >= 60) labels.push('direct');
  if (labels.length === 0) labels.push('balanced');
  return labels;
}

function formatTargetLabel(target: GenerationFormatTarget): string {
  if (target === 'reel-60') return '60s reel';
  if (target === 'shorts') return 'YouTube Shorts';
  if (target === 'story') return 'Story sequence';
  return '30s reel';
}

function applyGuardrailsToLine(value: string, profile: BrandDNAProfile | null): string {
  let next = cleanString(value);
  for (const phrase of profile?.bannedPhrases || []) {
    const normalized = cleanString(phrase);
    if (!normalized) continue;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(escaped, 'gi'), '[blocked phrase]');
  }
  return next;
}

function buildGenerationPromptContext(input: {
  template: PromptTemplate;
  profile: BrandDNAProfile | null;
  selectedReferences: ReferenceAsset[];
  prompt: string;
  formatTarget: GenerationFormatTarget;
}): GenerationPromptContext {
  const profile = input.profile;
  const audienceSnapshot =
    cleanString(profile?.audiencePersonas?.[0]) ||
    cleanString(profile?.desires?.[0]) ||
    cleanString(profile?.pains?.[0]) ||
    'growth-focused audience';
  const brandSummary =
    cleanString(profile?.summary) ||
    cleanString(profile?.mission) ||
    cleanString(profile?.valueProposition) ||
    'Brand-centered messaging with measurable outcomes.';
  const referenceNotes = input.selectedReferences.slice(0, 6).map((reference) => ({
    id: reference.id,
    rank: reference.ranking.rank,
    platform: reference.sourcePlatform,
    rationale: reference.ranking.rationaleTitle,
    cue: reference.explainability.topDrivers[0] || reference.ranking.rationaleBullets[0] || 'strong opening + clear CTA',
  }));
  const objective = cleanString(input.prompt) || input.template.description;
  const voiceProfile = voiceProfileFromBrand(profile);
  const composedPrompt = [
    `Template: ${input.template.title} (${input.template.intent})`,
    `Format target: ${formatTargetLabel(input.formatTarget)}`,
    `Objective: ${objective}`,
    `Audience: ${audienceSnapshot}`,
    `Brand summary: ${brandSummary}`,
    `Voice: ${voiceProfile.join(', ')}`,
    `Required claims: ${(profile?.requiredClaims || []).join(' | ') || 'none'}`,
    `Banned phrases: ${(profile?.bannedPhrases || []).join(' | ') || 'none'}`,
    `Reference cues: ${
      referenceNotes.map((entry) => `#${entry.rank} ${entry.platform} ${entry.rationale}`).join(' || ') || 'none'
    }`,
  ].join('\n');

  return {
    template: {
      id: input.template.id,
      title: input.template.title,
      intent: input.template.intent,
    },
    formatTarget: input.formatTarget,
    objective,
    audienceSnapshot,
    brandSummary,
    voiceProfile,
    requiredClaims: [...(profile?.requiredClaims || [])],
    bannedPhrases: [...(profile?.bannedPhrases || [])],
    referenceNotes,
    composedPrompt,
  };
}

function buildHooksFromContext(
  context: GenerationPromptContext,
  selectedReferences: ReferenceAsset[],
  profile: BrandDNAProfile | null,
  instruction?: string
): string[] {
  const lines: string[] = [];
  const claim = context.requiredClaims[0];
  const instructionSuffix = cleanString(instruction);
  const source = selectedReferences.length > 0 ? selectedReferences : [];
  for (let index = 0; index < Math.max(5, source.length); index += 1) {
    const reference = source[index];
    const cue = reference?.ranking?.rationaleTitle || `angle ${index + 1}`;
    const base = `Hook ${index + 1}: ${context.audienceSnapshot} still battling ${profile?.pains?.[0] || 'inconsistent performance'}? Use ${cue.toLowerCase()} to move toward ${profile?.desires?.[0] || 'predictable growth'} in a ${formatTargetLabel(context.formatTarget)}.`;
    const withClaim = claim ? `${base} ${claim}.` : base;
    lines.push(applyGuardrailsToLine(instructionSuffix ? `${withClaim} Focus: ${instructionSuffix}.` : withClaim, profile));
    if (lines.length >= 5) break;
  }
  while (lines.length < 5) {
    lines.push(
      applyGuardrailsToLine(
        `Hook ${lines.length + 1}: Name one bottleneck, show a practical shift, and close with one next step for ${context.audienceSnapshot}.`,
        profile
      )
    );
  }
  return lines;
}

function buildScriptsFromContext(
  context: GenerationPromptContext,
  profile: BrandDNAProfile | null,
  instruction?: string
): GenerationPack['outputs']['scripts'] {
  const requiredClaim = context.requiredClaims[0];
  const instructionLine = cleanString(instruction) ? `\nRefinement direction: ${cleanString(instruction)}.` : '';
  const short = applyGuardrailsToLine(
    [
      `Open with the pain: ${profile?.pains?.[0] || 'inconsistent lead quality'}.`,
      `Bridge to transformation: ${context.brandSummary}.`,
      `Deliver a direct CTA for ${context.audienceSnapshot}.`,
      requiredClaim ? `Required claim: ${requiredClaim}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    profile
  );
  const medium = applyGuardrailsToLine(
    [
      `Beat 1 (0-4s): pattern interrupt tailored for ${context.audienceSnapshot}.`,
      `Beat 2 (5-12s): prove the shift with one concrete mechanism from reference cues.`,
      `Beat 3 (13-22s): clarify offer and who it is for.`,
      `Beat 4 (23-30s): CTA aligned to ${context.objective}.`,
      requiredClaim ? `Claim constraint: ${requiredClaim}.` : '',
      `Tone: ${context.voiceProfile.join(', ')}.`,
    ]
      .filter(Boolean)
      .join('\n') + instructionLine,
    profile
  );
  const long = applyGuardrailsToLine(
    [
      `Scene map for ${formatTargetLabel(context.formatTarget)}:`,
      `1) Hook with urgency tied to ${profile?.pains?.[0] || 'performance drag'}.`,
      `2) Show a before/after narrative anchored in reference rationale.`,
      `3) Explain operating principle behind the result.`,
      `4) Present offer boundaries and credibility markers.`,
      `5) Close with one measurable action CTA.`,
      requiredClaim ? `Required claim to include verbatim: ${requiredClaim}.` : 'No mandatory claim configured.',
      `Voice profile: ${context.voiceProfile.join(', ')}.`,
    ].join('\n') + instructionLine,
    profile
  );

  return { short, medium, long };
}

function buildCaptionsFromContext(
  context: GenerationPromptContext,
  profile: BrandDNAProfile | null,
  instruction?: string
): string[] {
  const directive = cleanString(instruction);
  const lines = [
    `If ${context.audienceSnapshot} wants momentum, this is the framework: ${context.brandSummary}.`,
    `Winning creative is a repeatable system. Start with the hook, prove the shift, and close with a direct ask.`,
    `Built from high-performing references, remixed for your brand voice: ${context.voiceProfile.join(', ')}.`,
  ];
  if (directive) {
    lines[0] = `${lines[0]} Direction: ${directive}.`;
  }
  return lines.map((line) => applyGuardrailsToLine(line, profile));
}

function buildCtasFromContext(
  context: GenerationPromptContext,
  profile: BrandDNAProfile | null,
  instruction?: string
): string[] {
  const directive = cleanString(instruction);
  const primary = directive || context.objective;
  return [
    applyGuardrailsToLine(`Comment "PLAYBOOK" and we will send the exact ${formatTargetLabel(context.formatTarget)} framework.`, profile),
    applyGuardrailsToLine(`Save this and execute one step in the next 24 hours, then track the response delta.`, profile),
    applyGuardrailsToLine(`DM "SYSTEM" for a tailored action plan around ${primary.toLowerCase()}.`, profile),
  ];
}

function buildAngleRemixesFromContext(
  context: GenerationPromptContext,
  profile: BrandDNAProfile | null,
  instruction?: string
): string[] {
  const directive = cleanString(instruction);
  const base = [
    'Contrarian remix: debunk the common tactic, then reveal the working system.',
    'Case remix: show one compressed before/after arc in under 30 seconds.',
    'Checklist remix: 3 avoidable mistakes and one correction that compounds.',
  ];
  if (directive) {
    base[0] = `${base[0]} Priority: ${directive}.`;
  }
  return base.map((line) => applyGuardrailsToLine(line, profile));
}

function buildOutputsFromPromptContext(input: {
  context: GenerationPromptContext;
  selectedReferences: ReferenceAsset[];
  profile: BrandDNAProfile | null;
  instruction?: string;
}): GenerationPack['outputs'] {
  return {
    hooks: buildHooksFromContext(input.context, input.selectedReferences, input.profile, input.instruction),
    scripts: buildScriptsFromContext(input.context, input.profile, input.instruction),
    captions: buildCaptionsFromContext(input.context, input.profile, input.instruction),
    ctas: buildCtasFromContext(input.context, input.profile, input.instruction),
    angleRemixes: buildAngleRemixesFromContext(input.context, input.profile, input.instruction),
  };
}

function updateSingleGenerationSection(input: {
  section: GenerationSection;
  mode: GenerationRefineMode;
  outputs: GenerationPack['outputs'];
  regenerated: GenerationPack['outputs'];
  instruction: string;
}): GenerationPack['outputs'] {
  const next = clone(input.outputs);
  if (input.section === 'hooks') {
    next.hooks =
      input.mode === 'regenerate'
        ? input.regenerated.hooks
        : next.hooks.map((line, index) => (index === 0 ? `${line} Refinement: ${input.instruction}` : line));
    return next;
  }
  if (input.section === 'scripts.short') {
    next.scripts.short =
      input.mode === 'regenerate'
        ? input.regenerated.scripts.short
        : `${next.scripts.short}\n\nRefinement: ${input.instruction}`;
    return next;
  }
  if (input.section === 'scripts.medium') {
    next.scripts.medium =
      input.mode === 'regenerate'
        ? input.regenerated.scripts.medium
        : `${next.scripts.medium}\n\nRefinement: ${input.instruction}`;
    return next;
  }
  if (input.section === 'scripts.long') {
    next.scripts.long =
      input.mode === 'regenerate'
        ? input.regenerated.scripts.long
        : `${next.scripts.long}\n\nRefinement: ${input.instruction}`;
    return next;
  }
  if (input.section === 'captions') {
    next.captions =
      input.mode === 'regenerate'
        ? input.regenerated.captions
        : next.captions.map((line, index) => (index === 0 ? `${line} (${input.instruction})` : line));
    return next;
  }
  if (input.section === 'ctas') {
    next.ctas =
      input.mode === 'regenerate'
        ? input.regenerated.ctas
        : next.ctas.map((line, index) => (index === 0 ? `${line} (${input.instruction})` : line));
    return next;
  }
  next.angleRemixes =
    input.mode === 'regenerate'
      ? input.regenerated.angleRemixes
      : next.angleRemixes.map((line, index) => (index === 0 ? `${line} (${input.instruction})` : line));
  return next;
}

function refreshIngestionRun(
  run: IngestionRun,
  patch: Partial<Omit<IngestionRun, 'id' | 'workspaceId' | 'sourcePlatform' | 'sourceUrl' | 'createdAt'>>
): IngestionRun {
  return {
    ...run,
    ...patch,
    progress: patch.progress ? { ...patch.progress } : { ...run.progress },
    updatedAt: toIsoNow(),
  };
}

function isTerminalIngestionStatus(status: IngestionStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'partial';
}

function resolveIngestionPreset(preset?: IngestionPreset): {
  preset: IngestionPreset;
  maxVideos: number;
  lookbackDays: number;
  sortBy: IngestionSortBy;
} {
  const normalized = cleanString(preset) as IngestionPreset;
  if (normalized === 'quick-scan') {
    return {
      preset: 'quick-scan',
      maxVideos: 24,
      lookbackDays: 90,
      sortBy: 'engagement',
    };
  }
  if (normalized === 'deep-scan') {
    return {
      preset: 'deep-scan',
      maxVideos: 80,
      lookbackDays: 270,
      sortBy: 'engagement',
    };
  }
  return {
    preset: DEFAULT_INGESTION_POLICY.preset,
    maxVideos: DEFAULT_INGESTION_POLICY.maxVideos,
    lookbackDays: DEFAULT_INGESTION_POLICY.lookbackDays,
    sortBy: DEFAULT_INGESTION_POLICY.sortBy,
  };
}

function buildIngestionOutcome(run: IngestionRun): {
  status: 'completed' | 'partial' | 'failed';
  found: number;
  downloaded: number;
  analyzed: number;
  ranked: number;
  referenceCount: number;
  error?: string;
} {
  const seed = toShortHash(
    `${run.sourcePlatform}|${run.sourceUrl}|${run.maxVideos}|${run.lookbackDays}|${run.attempt}`
  );
  const found = clamp(Math.floor(run.maxVideos * (0.52 + (seed % 34) / 100)), 8, run.maxVideos);
  const downloaded = clamp(found - (seed % 5), 5, found);
  const analyzed = clamp(downloaded - ((seed >> 2) % 6), 3, downloaded);
  const rankedRaw = clamp(analyzed - ((seed >> 4) % 3), 2, analyzed);
  const rollout = Math.min(99, (seed % 100) + Math.max(0, run.attempt - 1) * 14);

  if (rollout < 12) {
    const ranked = clamp(Math.floor(rankedRaw * 0.35), 0, rankedRaw);
    const referenceCount = ranked > 0 ? ranked : 0;
    return {
      status: 'failed',
      found,
      downloaded: clamp(Math.floor(downloaded * 0.64), 0, downloaded),
      analyzed: clamp(Math.floor(analyzed * 0.42), 0, analyzed),
      ranked,
      referenceCount,
      error: 'Media analysis timeout on multiple videos. Retry to resume from processed items.',
    };
  }

  if (rollout < 32) {
    const ranked = clamp(Math.floor(rankedRaw * 0.72), Math.min(3, rankedRaw), rankedRaw);
    return {
      status: 'partial',
      found,
      downloaded,
      analyzed,
      ranked,
      referenceCount: ranked,
      error: 'Completed with partial coverage. Some items were skipped due to extraction quality thresholds.',
    };
  }

  const ranked = clamp(rankedRaw, Math.min(4, analyzed), analyzed);
  return {
    status: 'completed',
    found,
    downloaded,
    analyzed,
    ranked,
    referenceCount: ranked,
  };
}

function startIngestionSimulation(workspaceId: string, runId: string) {
  const store = ensureWorkspaceStore(workspaceId);
  const applyPatch = (
    expectedStatuses: IngestionStatus[],
    patchFactory: (active: IngestionRun) => Partial<Omit<IngestionRun, 'id' | 'workspaceId' | 'sourcePlatform' | 'sourceUrl' | 'createdAt'>>
  ) => {
    const active = store.ingestions.get(runId);
    if (!active) return;
    if (!expectedStatuses.includes(active.status)) return;
    const patched = refreshIngestionRun(active, patchFactory(active));
    store.ingestions.set(runId, patched);
  };

  setTimeout(() => {
    applyPatch(['queued'], () => ({
      status: 'running',
      startedAt: toIsoNow(),
    }));
  }, 120);

  setTimeout(() => {
    applyPatch(['running'], (active) => {
      const outcome = buildIngestionOutcome(active);
      return {
        progress: {
          found: clamp(Math.floor(outcome.found * 0.52), 0, outcome.found),
          downloaded: 0,
          analyzed: 0,
          ranked: 0,
        },
      };
    });
  }, 420);

  setTimeout(() => {
    applyPatch(['running'], (active) => {
      const outcome = buildIngestionOutcome(active);
      return {
        progress: {
          found: outcome.found,
          downloaded: clamp(Math.floor(outcome.downloaded * 0.78), 0, outcome.downloaded),
          analyzed: 0,
          ranked: 0,
        },
      };
    });
  }, 820);

  setTimeout(() => {
    applyPatch(['running'], (active) => {
      const outcome = buildIngestionOutcome(active);
      return {
        progress: {
          found: outcome.found,
          downloaded: outcome.downloaded,
          analyzed: clamp(Math.floor(outcome.analyzed * 0.72), 0, outcome.analyzed),
          ranked: 0,
        },
      };
    });
  }, 1260);

  setTimeout(() => {
    const active = store.ingestions.get(runId);
    if (!active || isTerminalIngestionStatus(active.status)) return;
    if (active.status !== 'running') return;

    const outcome = buildIngestionOutcome(active);
    if (outcome.referenceCount > 0) {
      const generated = sortReferencesForOutput(
        new Array(outcome.referenceCount).fill(null).map((_, index) =>
          buildSyntheticReference({
            workspaceId,
            run: active,
            index,
            total: outcome.referenceCount,
          })
        )
      );
      updateStoredReferencesWithSortedOrder(store, generated);
    }

    const finalized = refreshIngestionRun(active, {
      status: outcome.status,
      progress: {
        found: outcome.found,
        downloaded: outcome.downloaded,
        analyzed: outcome.analyzed,
        ranked: outcome.ranked,
      },
      endedAt: toIsoNow(),
      error: outcome.error,
    });
    store.ingestions.set(runId, finalized);
  }, 1680);
}

export function listPromptTemplates(): PromptTemplate[] {
  return clone(PROMPT_TEMPLATES);
}

export function getViralStudioContractSnapshot(): ViralStudioContractSnapshot {
  return {
    version: 'plan1',
    generatedAt: toIsoNow(),
    scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
    stateMachines: {
      onboarding: {
        states: ['draft', 'ready', 'final'],
        transitions: [
          { from: 'draft', event: 'SAVE_DRAFT', to: 'draft' },
          { from: 'draft', event: 'SAVE_READY_FIELDS', to: 'ready' },
          {
            from: 'ready',
            event: 'FINALIZE_PROFILE',
            to: 'final',
            note: 'Allowed only when completeness.ready=true.',
          },
          { from: 'final', event: 'EDIT_PROFILE', to: 'draft' },
        ],
      },
      ingestion: {
        states: ['queued', 'running', 'partial', 'completed', 'failed'],
        transitions: [
          { from: 'queued', event: 'WORKER_ACK', to: 'running' },
          { from: 'running', event: 'ALL_TARGETS_DONE', to: 'completed' },
          { from: 'running', event: 'PARTIAL_ERRORS', to: 'partial' },
          { from: 'running', event: 'FATAL_ERROR', to: 'failed' },
          { from: 'partial', event: 'RETRY_FAILED_TARGETS', to: 'queued' },
          { from: 'failed', event: 'RETRY_FAILED_TARGETS', to: 'queued' },
        ],
      },
      generation: {
        states: ['requested', 'completed'],
        transitions: [
          { from: 'requested', event: 'GENERATION_DONE', to: 'completed' },
          { from: 'completed', event: 'REFINE_SECTION', to: 'completed' },
        ],
      },
      document: {
        states: ['draft', 'versioned'],
        transitions: [
          { from: 'draft', event: 'AUTOSAVE', to: 'draft' },
          { from: 'draft', event: 'CREATE_VERSION', to: 'versioned' },
          { from: 'versioned', event: 'EDIT', to: 'draft' },
          { from: 'versioned', event: 'EXPORT', to: 'versioned' },
        ],
      },
    },
    telemetryEvents: clone(TELEMETRY_EVENTS),
  };
}

export async function getBrandDNAProfile(workspaceId: string): Promise<BrandDNAProfile | null> {
  const store = ensureWorkspaceStore(workspaceId);
  try {
    const persisted = await loadPersistedBrandDna(workspaceId);
    store.brandDna = persisted;
    if (!persisted) return null;
    return clone(persisted);
  } catch {
    if (!store.brandDna) return null;
    return clone(store.brandDna);
  }
}

export async function upsertBrandDNAProfile(
  workspaceId: string,
  input: UpsertBrandDNAInput,
  mode: 'create' | 'patch'
): Promise<BrandDNAProfile> {
  const store = ensureWorkspaceStore(workspaceId);
  const existing = await getBrandDNAProfile(workspaceId);
  if (mode === 'create' && existing) {
    const merged = mergeBrandDna(workspaceId, input, existing);
    store.brandDna = merged;
    await persistBrandDna(workspaceId, merged);
    return clone(merged);
  }
  const merged = mergeBrandDna(workspaceId, input, existing);
  store.brandDna = merged;
  await persistBrandDna(workspaceId, merged);
  return clone(merged);
}

function createIngestionRunRecord(
  workspaceId: string,
  input: CreateIngestionRunInput,
  options?: {
    attempt?: number;
    retryOfRunId?: string;
  }
): IngestionRun {
  const store = ensureWorkspaceStore(workspaceId);
  const presetPolicy = resolveIngestionPreset(input.preset);
  const now = toIsoNow();
  const run: IngestionRun = {
    id: crypto.randomUUID(),
    workspaceId,
    sourcePlatform: input.sourcePlatform,
    sourceUrl: cleanString(input.sourceUrl),
    maxVideos: clamp(Number(input.maxVideos ?? presetPolicy.maxVideos), 5, 200),
    lookbackDays: clamp(Number(input.lookbackDays ?? presetPolicy.lookbackDays), 7, 365),
    sortBy: input.sortBy || presetPolicy.sortBy,
    preset: presetPolicy.preset,
    attempt: Math.max(1, Math.floor(Number(options?.attempt || 1))),
    ...(options?.retryOfRunId ? { retryOfRunId: cleanString(options.retryOfRunId) } : {}),
    status: 'queued',
    progress: {
      found: 0,
      downloaded: 0,
      analyzed: 0,
      ranked: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
  store.ingestions.set(run.id, run);
  startIngestionSimulation(workspaceId, run.id);
  return clone(run);
}

export function createIngestionRun(workspaceId: string, input: CreateIngestionRunInput): IngestionRun {
  return createIngestionRunRecord(workspaceId, input);
}

export function listIngestionRuns(workspaceId: string): IngestionRun[] {
  const store = ensureWorkspaceStore(workspaceId);
  return clone(
    Array.from(store.ingestions.values()).sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
  );
}

export function getIngestionRun(workspaceId: string, ingestionRunId: string): IngestionRun | null {
  const store = ensureWorkspaceStore(workspaceId);
  const run = store.ingestions.get(cleanString(ingestionRunId));
  if (!run) return null;
  return clone(run);
}

export function retryIngestionRun(workspaceId: string, ingestionRunId: string): IngestionRun | null {
  const store = ensureWorkspaceStore(workspaceId);
  const source = store.ingestions.get(cleanString(ingestionRunId));
  if (!source) return null;
  if (source.status !== 'failed' && source.status !== 'partial') {
    return null;
  }
  return createIngestionRunRecord(
    workspaceId,
    {
      sourcePlatform: source.sourcePlatform,
      sourceUrl: source.sourceUrl,
      maxVideos: source.maxVideos,
      lookbackDays: source.lookbackDays,
      sortBy: source.sortBy,
      preset: source.preset || 'balanced',
    },
    {
      attempt: source.attempt + 1,
      retryOfRunId: source.id,
    }
  );
}

export function listReferenceAssets(workspaceId: string, filters?: ReferenceListFilters): ReferenceAsset[] {
  const store = ensureWorkspaceStore(workspaceId);
  const ingestionRunId = cleanString(filters?.ingestionRunId);
  const shortlistOnly = Boolean(filters?.shortlistOnly);
  const includeExcluded = Boolean(filters?.includeExcluded);

  const rows = Array.from(store.references.values()).filter((reference) => {
    if (ingestionRunId && reference.ingestionRunId !== ingestionRunId) return false;
    if (shortlistOnly && reference.shortlistState === 'none') return false;
    if (!includeExcluded && reference.shortlistState === 'exclude') return false;
    return true;
  });

  const sorted = sortReferencesForOutput(rows);
  updateStoredReferencesWithSortedOrder(store, sorted);
  return clone(sorted);
}

export function applyReferenceShortlistAction(
  workspaceId: string,
  referenceId: string,
  action: ShortlistAction
): ReferenceAsset | null {
  const store = ensureWorkspaceStore(workspaceId);
  const key = cleanString(referenceId);
  const existing = store.references.get(key);
  if (!existing) return null;
  const nextState: ShortlistState =
    action === 'clear' ? 'none' : action === 'must-use' ? 'must-use' : action === 'exclude' ? 'exclude' : 'pin';
  const updated: ReferenceAsset = {
    ...existing,
    shortlistState: nextState,
    updatedAt: toIsoNow(),
  };
  store.references.set(updated.id, updated);
  return clone(updated);
}

export function createGenerationPack(workspaceId: string, input: CreateGenerationPackInput): GenerationPack {
  const store = ensureWorkspaceStore(workspaceId);
  const template = getTemplateById(input.templateId);
  const profile = store.brandDna;
  const selectedReferences = pickReferenceSelection(workspaceId, store, input.selectedReferenceIds);
  const selectedReferenceIds = selectedReferences.map((item) => item.id);
  const formatTarget: GenerationFormatTarget =
    input.formatTarget === 'reel-60' || input.formatTarget === 'shorts' || input.formatTarget === 'story'
      ? input.formatTarget
      : 'reel-30';
  const promptContext = buildGenerationPromptContext({
    template,
    profile,
    selectedReferences,
    prompt: cleanString(input.prompt) || template.description,
    formatTarget,
  });
  const outputs = buildOutputsFromPromptContext({
    context: promptContext,
    selectedReferences,
    profile,
  });
  const qualityCheck = runQualityGate(outputs, profile);

  const now = toIsoNow();
  const generation: GenerationPack = {
    id: crypto.randomUUID(),
    workspaceId,
    status: 'completed',
    promptTemplateId: template.id,
    formatTarget,
    inputPrompt: cleanString(input.prompt) || template.description,
    selectedReferenceIds,
    promptContext,
    outputs,
    qualityCheck,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  store.generations.set(generation.id, generation);
  return clone(generation);
}

export function getGenerationPack(workspaceId: string, generationId: string): GenerationPack | null {
  const store = ensureWorkspaceStore(workspaceId);
  const generation = store.generations.get(cleanString(generationId));
  if (!generation) return null;
  return clone(generation);
}

export function refineGenerationPack(
  workspaceId: string,
  generationId: string,
  input: RefineGenerationInput
): GenerationPack | null {
  const store = ensureWorkspaceStore(workspaceId);
  const existing = store.generations.get(cleanString(generationId));
  if (!existing) return null;
  const mode: GenerationRefineMode = input.mode === 'regenerate' ? 'regenerate' : 'refine';
  const instruction =
    cleanString(input.instruction) ||
    (mode === 'regenerate'
      ? 'Rebuild this section with a fresh angle while preserving Brand DNA constraints.'
      : 'Tighten clarity and sharpen conversion intent.');
  const next: GenerationPack = clone(existing);
  const selectedReferences = pickReferenceSelection(workspaceId, store, existing.selectedReferenceIds);
  const regeneratedOutputs = buildOutputsFromPromptContext({
    context: existing.promptContext,
    selectedReferences,
    profile: store.brandDna,
    instruction,
  });
  next.outputs = updateSingleGenerationSection({
    section: input.section,
    mode,
    outputs: existing.outputs,
    regenerated: regeneratedOutputs,
    instruction,
  });

  next.qualityCheck = runQualityGate(next.outputs, store.brandDna);
  next.revision += 1;
  next.updatedAt = toIsoNow();
  store.generations.set(next.id, next);
  return clone(next);
}

export function createStudioDocument(workspaceId: string, input: CreateStudioDocumentInput): StudioDocument {
  const store = ensureWorkspaceStore(workspaceId);
  const generation = store.generations.get(cleanString(input.generationId));
  if (!generation) {
    throw new Error('Generation not found for document creation');
  }
  const now = toIsoNow();
  const document: StudioDocument = {
    id: crypto.randomUUID(),
    workspaceId,
    title: cleanString(input.title) || 'Viral Studio Campaign Pack',
    linkedGenerationIds: [generation.id],
    sections: buildDocumentSectionsFromGeneration(generation),
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  };
  store.documents.set(document.id, document);
  store.documentVersions.set(document.id, []);
  return clone(document);
}

export function getStudioDocumentWithVersions(
  workspaceId: string,
  documentId: string
): { document: StudioDocument; versions: StudioDocumentVersion[] } | null {
  const store = ensureWorkspaceStore(workspaceId);
  const document = store.documents.get(cleanString(documentId));
  if (!document) return null;
  const versions = store.documentVersions.get(document.id) || [];
  return clone({
    document,
    versions,
  });
}

export function createStudioDocumentVersion(
  workspaceId: string,
  documentId: string,
  input: CreateStudioDocumentVersionInput
): { document: StudioDocument; version: StudioDocumentVersion } | null {
  const store = ensureWorkspaceStore(workspaceId);
  const document = store.documents.get(cleanString(documentId));
  if (!document) return null;

  const version: StudioDocumentVersion = {
    id: crypto.randomUUID(),
    workspaceId,
    documentId: document.id,
    author: cleanString(input.author) || 'workspace-user',
    summary: cleanString(input.summary) || 'Manual publish snapshot',
    snapshotSections: clone(document.sections),
    createdAt: toIsoNow(),
  };

  const versions = store.documentVersions.get(document.id) || [];
  versions.push(version);
  store.documentVersions.set(document.id, versions);

  const updatedDocument: StudioDocument = {
    ...document,
    currentVersionId: version.id,
    updatedAt: toIsoNow(),
  };
  store.documents.set(document.id, updatedDocument);

  return clone({
    document: updatedDocument,
    version,
  });
}

export function exportStudioDocument(
  workspaceId: string,
  documentId: string,
  format: ExportStudioDocumentFormat
): ExportStudioDocumentResult | null {
  const payload = getStudioDocumentWithVersions(workspaceId, documentId);
  if (!payload) return null;
  const { document, versions } = payload;
  if (format === 'json') {
    return {
      format,
      fileName: `${document.id}.json`,
      contentType: 'application/json; charset=utf-8',
      content: JSON.stringify({ document, versions }, null, 2),
    };
  }
  return {
    format: 'markdown',
    fileName: `${document.id}.md`,
    contentType: 'text/markdown; charset=utf-8',
    content: buildMarkdownDocument(document, versions),
  };
}
