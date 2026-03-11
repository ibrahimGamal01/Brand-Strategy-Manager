import crypto from 'node:crypto';
import {
  createGenerationPack,
  getBrandDNAProfile,
  listReferenceAssets,
  type BrandDNAProfile,
  type GenerationFormatTarget,
  type ReferenceAsset,
  type StudioDocumentSection,
  type ViralStudioPlatform,
} from './viral-studio';
import {
  repositoryDeleteApprovedContentDirection,
  repositoryDeleteApprovedDesignDirection,
  repositoryGetFormatGenerationJob,
  repositoryGetPlannerSession,
  repositoryLoadPlannerSnapshot,
  repositoryReplaceContentDirectionCandidates,
  repositoryReplaceDesignDirectionCandidates,
  repositoryUpsertApprovedContentDirection,
  repositoryUpsertApprovedDesignDirection,
  repositoryUpsertFormatGenerationJob,
  repositoryUpsertPlannerSession,
} from './viral-studio-planner-repository';
import { resolveViralStudioWorkspaceStorageMode, type ViralStudioPersistenceMode } from './viral-studio-persistence';

export type ViralStudioPlannerStage =
  | 'design_analysis'
  | 'design_selection'
  | 'content_strategy'
  | 'content_selection'
  | 'format_selection'
  | 'format_generation'
  | 'document_save';

export type ViralStudioContentType =
  | 'short_video'
  | 'carousel'
  | 'story_sequence'
  | 'static_post'
  | 'caption_set'
  | 'cta_set';

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
  storageMode?: ViralStudioPersistenceMode;
};

export type DesignDirectionThumbnail = {
  referenceId: string;
  platform: ViralStudioPlatform;
  label: string;
  mediaUrl?: string;
};

export type DesignDirectionCandidate = {
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
  thumbnailCluster: DesignDirectionThumbnail[];
  createdAt: string;
  updatedAt: string;
  persistedAt?: string;
  storageMode?: ViralStudioPersistenceMode;
};

export type ApprovedDesignDirection = DesignDirectionCandidate & {
  candidateId: string;
  approvedAt: string;
};

export type ContentDirectionCandidate = {
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
  storageMode?: ViralStudioPersistenceMode;
};

export type ApprovedContentDirection = ContentDirectionCandidate & {
  candidateId: string;
  approvedAt: string;
};

export type FormatGenerationResult = {
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

export type FormatGenerationJob = {
  id: string;
  workspaceId: string;
  sessionId: string;
  approvedDesignDirectionId: string;
  approvedContentDirectionId: string;
  contentType: ViralStudioContentType;
  status: 'completed';
  generationPackId: string;
  selectedReferenceIds: string[];
  result: FormatGenerationResult;
  createdAt: string;
  updatedAt: string;
  persistedAt?: string;
  storageMode?: ViralStudioPersistenceMode;
};

type PlannerWorkspaceStore = {
  session: ViralStudioPlannerSession | null;
  designDirections: Map<string, DesignDirectionCandidate>;
  approvedDesign: ApprovedDesignDirection | null;
  contentDirections: Map<string, ContentDirectionCandidate>;
  approvedContent: ApprovedContentDirection | null;
  formatJobs: Map<string, FormatGenerationJob>;
  hydrated: boolean;
};

const plannerStores = new Map<string, PlannerWorkspaceStore>();

const DESIGN_ARCHETYPES = [
  {
    key: 'editorial-proof',
    archetypeName: 'Editorial Proof Stack',
    layoutPattern: 'Open on the tension, cut to proof, then land the invitation with one dominant frame.',
    typographyCharacter: 'High-contrast headline system with compact, confident supporting captions.',
    motionPacingNotes: 'Measured starts, tight proof beats, calm CTA close.',
    onScreenTextStyle: 'Three- to six-word overlays with one anchored proof caption per beat.',
    proofStructure: 'Claim -> evidence -> explanation -> invitation.',
    ctaPresentationStyle: 'Soft, assured CTA framed as the obvious next move.',
    bestFor: ['Authority reels', 'Founder-led explainers', 'Conversion-focused educational posts'],
    pros: ['Feels premium and intentional', 'Lets proof carry the persuasion', 'Works across video and carousel formats'],
    risks: ['Can feel too restrained without a sharp hook', 'Needs a real proof artifact to avoid looking generic'],
  },
  {
    key: 'contrast-hook',
    archetypeName: 'Contrast Hook Board',
    layoutPattern: 'Lead with a stark before/after contrast, then break the claim into fast visual cards.',
    typographyCharacter: 'Bold sans headlines with utility-style secondary labels and contrast callouts.',
    motionPacingNotes: 'Fast front half, punchy mid-sequence pivots, immediate CTA.',
    onScreenTextStyle: 'Large hook card, fast contrast labels, short framing questions.',
    proofStructure: 'Pattern interrupt -> pain naming -> proof fragment -> action.',
    ctaPresentationStyle: 'Direct CTA that converts momentum into a clear response.',
    bestFor: ['Short-form hooks', 'Carousel openers', 'Story sequences that need instant attention'],
    pros: ['Creates immediate attention', 'Easy to scan on mobile', 'Helpful when the audience is skeptical or busy'],
    risks: ['Can feel loud if Brand DNA is very formal', 'Needs disciplined copy so it does not become clickbait'],
  },
  {
    key: 'tutorial-authority',
    archetypeName: 'Authority Tutorial Frame',
    layoutPattern: 'Promise one concrete outcome, teach through three layered frames, then invite the next step.',
    typographyCharacter: 'Structured editorial grid with service-minded annotations and proof markers.',
    motionPacingNotes: 'Deliberate sequence with stronger pauses between instructional beats.',
    onScreenTextStyle: 'Clear chapter markers, teaching overlays, and proof footnotes.',
    proofStructure: 'Instruction -> example -> proof -> application.',
    ctaPresentationStyle: 'CTA framed as continuation of the learning journey.',
    bestFor: ['Educational reels', 'Carousels', 'Static posts that need depth with structure'],
    pros: ['Builds trust through clarity', 'Supports deeper claims', 'Adapts well to multiple content types'],
    risks: ['Needs disciplined editing to avoid over-explaining', 'The first frame must still feel instantly relevant'],
  },
] as const;

const CONTENT_DIRECTION_BLUEPRINTS = [
  {
    key: 'pain-to-proof',
    title: 'Pain To Proof Release',
    ctaIntent: 'Invite the audience to see the exact system or next step.',
    toneStance: 'Direct, calm, operator-grade confidence.',
    useCases: ['Lead generation reels', 'Educational carousel packs', 'Sales-enablement story sequences'],
  },
  {
    key: 'desire-led',
    title: 'Desire-Led Transformation',
    ctaIntent: 'Move the audience toward the most desirable future state with a grounded CTA.',
    toneStance: 'Aspirational without becoming fluffy.',
    useCases: ['Transformation stories', 'Before/after static posts', 'Story nurture content'],
  },
  {
    key: 'objection-crusher',
    title: 'Objection Crusher',
    ctaIntent: 'Neutralize resistance and then ask for the smallest viable commitment.',
    toneStance: 'Reassuring, credible, and friction-reducing.',
    useCases: ['High-consideration offer posts', 'Q&A reels', 'Caption sets for skeptical buyers'],
  },
] as const;

function toIsoNow(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compactText(value: unknown, maxChars = 180): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function ensurePlannerStore(workspaceId: string): PlannerWorkspaceStore {
  const key = cleanString(workspaceId);
  const existing = plannerStores.get(key);
  if (existing) return existing;
  const created: PlannerWorkspaceStore = {
    session: null,
    designDirections: new Map<string, DesignDirectionCandidate>(),
    approvedDesign: null,
    contentDirections: new Map<string, ContentDirectionCandidate>(),
    approvedContent: null,
    formatJobs: new Map<string, FormatGenerationJob>(),
    hydrated: false,
  };
  plannerStores.set(key, created);
  return created;
}

function resolveWorkspaceStorageModeValue(workspaceId: string): ViralStudioPersistenceMode {
  return resolveViralStudioWorkspaceStorageMode(cleanString(workspaceId)).mode;
}

function shouldPersistToDb(workspaceId: string): boolean {
  return resolveViralStudioWorkspaceStorageMode(cleanString(workspaceId)).writesToDb;
}

function shouldUseDbReads(workspaceId: string): boolean {
  return resolveViralStudioWorkspaceStorageMode(cleanString(workspaceId)).readsFromDb;
}

function attachStorageModeToRecord<T extends Record<string, unknown>>(workspaceId: string, payload: T): T {
  return {
    ...payload,
    storageMode: resolveWorkspaceStorageModeValue(workspaceId),
  };
}

function attachStorageModeToList<T extends Record<string, unknown>>(workspaceId: string, items: T[]): T[] {
  return items.map((item) => attachStorageModeToRecord(workspaceId, item));
}

async function hydratePlannerStore(workspaceId: string): Promise<PlannerWorkspaceStore> {
  const store = ensurePlannerStore(workspaceId);
  if (store.hydrated) return store;
  if (!shouldPersistToDb(workspaceId) && !shouldUseDbReads(workspaceId)) {
    store.hydrated = true;
    return store;
  }
  try {
    const snapshot = await repositoryLoadPlannerSnapshot(workspaceId);
    store.session = snapshot.session ? clone(snapshot.session) : null;
    store.designDirections = new Map(snapshot.designDirections.map((item) => [item.id, clone(item)]));
    store.approvedDesign = snapshot.approvedDesign ? clone(snapshot.approvedDesign) : null;
    store.contentDirections = new Map(snapshot.contentDirections.map((item) => [item.id, clone(item)]));
    store.approvedContent = snapshot.approvedContent ? clone(snapshot.approvedContent) : null;
    store.formatJobs = new Map(snapshot.formatJobs.map((item) => [item.id, clone(item)]));
  } catch {
    // Best effort hydration: planner can still run in memory.
  }
  store.hydrated = true;
  return store;
}

async function persistBestEffort(workspaceId: string, task: () => Promise<void>) {
  if (!shouldPersistToDb(workspaceId)) return;
  try {
    await task();
  } catch {
    // Planner keeps functioning in memory-first mode when DB persistence fails.
  }
}

function createEmptySession(workspaceId: string): ViralStudioPlannerSession {
  const now = toIsoNow();
  return {
    id: crypto.randomUUID(),
    workspaceId,
    stage: 'design_analysis',
    shortlistedReferenceIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function ensurePlannerSession(workspaceId: string): Promise<ViralStudioPlannerSession> {
  const store = await hydratePlannerStore(workspaceId);
  if (store.session) {
    return attachStorageModeToRecord(workspaceId, clone(store.session)) as ViralStudioPlannerSession;
  }
  let existing: ViralStudioPlannerSession | null = null;
  if (shouldUseDbReads(workspaceId) || shouldPersistToDb(workspaceId)) {
    try {
      existing = await repositoryGetPlannerSession(workspaceId);
    } catch {
      existing = null;
    }
  }
  const session = existing || createEmptySession(workspaceId);
  store.session = clone(session);
  if (!existing) {
    await persistBestEffort(workspaceId, async () => {
      await repositoryUpsertPlannerSession(session);
    });
  }
  return attachStorageModeToRecord(workspaceId, clone(session)) as ViralStudioPlannerSession;
}

function shortlistPriority(state: ReferenceAsset['shortlistState']): number {
  if (state === 'must-use') return 0;
  if (state === 'pin') return 1;
  if (state === 'none') return 2;
  return 3;
}

function sortReferencesForPlanner(references: ReferenceAsset[]): ReferenceAsset[] {
  return [...references].sort((left, right) => {
    const shortlistDelta = shortlistPriority(left.shortlistState) - shortlistPriority(right.shortlistState);
    if (shortlistDelta !== 0) return shortlistDelta;
    const rankDelta = Number(left.ranking.rank || 999) - Number(right.ranking.rank || 999);
    if (rankDelta !== 0) return rankDelta;
    return Number(right.scores.composite || 0) - Number(left.scores.composite || 0);
  });
}

async function pickPlannerReferences(workspaceId: string): Promise<ReferenceAsset[]> {
  const all = await listReferenceAssets(workspaceId, { includeExcluded: true });
  const prioritized = sortReferencesForPlanner(all).filter(
    (item) => item.shortlistState === 'must-use' || item.shortlistState === 'pin'
  );
  if (prioritized.length > 0) return prioritized.slice(0, 6);
  return sortReferencesForPlanner(all)
    .filter((item) => item.shortlistState !== 'exclude')
    .slice(0, 6);
}

function uniquePaletteSummary(references: ReferenceAsset[]): string {
  const palette = Array.from(
    new Set(
      references
        .flatMap((reference) => reference.visual?.palette || [])
        .map((value) => cleanString(value).toUpperCase())
        .filter(Boolean)
    )
  ).slice(0, 4);
  return palette.length > 0 ? palette.join(' • ') : 'Ink-led neutrals with disciplined accent contrast';
}

function buildReferenceGroup(references: ReferenceAsset[], index: number, total: number): ReferenceAsset[] {
  const grouped = references.filter((_, itemIndex) => itemIndex % total === index);
  const fallback = references.slice(index, index + 3);
  const chosen = grouped.length > 0 ? grouped : fallback;
  return chosen.slice(0, 3);
}

function buildDesignCandidates(input: {
  workspaceId: string;
  sessionId: string;
  references: ReferenceAsset[];
}): DesignDirectionCandidate[] {
  const now = toIsoNow();
  return DESIGN_ARCHETYPES.map((blueprint, index, all) => {
    const group = buildReferenceGroup(input.references, index, all.length);
    const sourceReferenceIds = group.map((reference) => reference.id);
    const topDrivers = Array.from(
      new Set(group.flatMap((reference) => reference.explainability.topDrivers || []).map((entry) => compactText(entry, 64)).filter(Boolean))
    ).slice(0, 3);
    const sharedUse = Array.from(
      new Set(
        group.map((reference) => compactText(reference.ranking.rationaleTitle || reference.visual?.headline || `Reference #${reference.ranking.rank}`, 80))
      )
    ).slice(0, 2);
    const paletteSummary = uniquePaletteSummary(group);
    return {
      id: crypto.createHash('sha1').update(`${input.sessionId}:design:${blueprint.key}`).digest('hex').slice(0, 24),
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      orderIndex: index,
      archetypeName: blueprint.archetypeName,
      sourceReferenceIds,
      summary: `${blueprint.archetypeName} turns the winning board into a clear visual system centered on ${topDrivers[0] || 'high-clarity hooks'} and proof-led storytelling.`,
      layoutPattern: blueprint.layoutPattern,
      typographyCharacter: blueprint.typographyCharacter,
      colorPaletteSummary: paletteSummary,
      motionPacingNotes: blueprint.motionPacingNotes,
      hookFramingPattern: topDrivers[0]
        ? `Use ${topDrivers[0].toLowerCase()} as the first-frame framing device, then move quickly into proof.`
        : 'Lead with one clear tension statement, then move into proof within the first two beats.',
      onScreenTextStyle: blueprint.onScreenTextStyle,
      proofStructure: blueprint.proofStructure,
      ctaPresentationStyle: blueprint.ctaPresentationStyle,
      bestFor: [...blueprint.bestFor],
      whyGrouped: [
        `These source references share repeated drivers: ${topDrivers.join(', ') || 'hook clarity and evidence density'}.`,
        `The cluster keeps surfacing the same visual job: ${sharedUse.join(' + ') || 'quick hook, proof, and CTA sequencing'}.`,
      ],
      pros: [...blueprint.pros],
      risks: [...blueprint.risks],
      thumbnailCluster: group.map((reference) => ({
        referenceId: reference.id,
        platform: reference.sourcePlatform,
        label: compactText(reference.visual?.headline || reference.ranking.rationaleTitle || `Reference #${reference.ranking.rank}`, 48),
        ...(cleanString(reference.visual?.posterUrl || reference.visual?.thumbnailUrl)
          ? { mediaUrl: cleanString(reference.visual?.posterUrl || reference.visual?.thumbnailUrl) }
          : {}),
      })),
      createdAt: now,
      updatedAt: now,
    };
  });
}

function buildApprovedDesign(candidate: DesignDirectionCandidate): ApprovedDesignDirection {
  const now = toIsoNow();
  return {
    ...candidate,
    candidateId: candidate.id,
    approvedAt: now,
    updatedAt: now,
  };
}

function buildContentDirections(input: {
  workspaceId: string;
  sessionId: string;
  approvedDesign: ApprovedDesignDirection;
  references: ReferenceAsset[];
  profile: BrandDNAProfile | null;
}): ContentDirectionCandidate[] {
  const now = toIsoNow();
  const audiences = input.profile?.audiencePersonas?.length ? input.profile.audiencePersonas : ['Growth-minded buyers'];
  const pains = input.profile?.pains?.length ? input.profile.pains : ['inconsistent content performance'];
  const desires = input.profile?.desires?.length ? input.profile.desires : ['predictable pipeline growth'];
  const objections = input.profile?.objections?.length ? input.profile.objections : ['concern that the strategy will stay theoretical'];
  const leadReference = input.references[0];
  return CONTENT_DIRECTION_BLUEPRINTS.map((blueprint, index) => {
    const coreAudience = audiences[index] || audiences[0];
    const targetedPain = pains[index] || pains[0];
    const targetedDesire = desires[index] || desires[0];
    const objectionHandling = objections[index] || objections[0];
    const proofAngle = leadReference
      ? `${compactText(leadReference.ranking.rationaleTitle || leadReference.caption, 96)} becomes the proof anchor that keeps the promise believable.`
      : 'Use ranked reference proof to make the promise feel earned rather than claimed.';
    return {
      id: crypto.createHash('sha1').update(`${input.sessionId}:content:${blueprint.key}`).digest('hex').slice(0, 24),
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      approvedDesignDirectionId: input.approvedDesign.id,
      orderIndex: index,
      title: blueprint.title,
      coreAudience,
      targetedPain,
      targetedDesire,
      bigPromise: `Move ${coreAudience.toLowerCase()} from ${targetedPain} to ${targetedDesire} with a system they can immediately understand and trust.`,
      proofAngle,
      objectionHandling: `Address "${objectionHandling}" directly, then reduce friction with one visible proof cue and one concrete next step.`,
      ctaIntent: blueprint.ctaIntent,
      toneStance: blueprint.toneStance,
      recommendedUseCases: [...blueprint.useCases],
      whyFitsDesign: [
        `${input.approvedDesign.archetypeName} works because the visual structure gives this message room to move from tension into proof cleanly.`,
        `The selected design already favors ${input.approvedDesign.proofStructure.toLowerCase()}, which reinforces this messaging route without overloading the frame.`,
      ],
      sourceReferenceIds: input.references.slice(0, 3).map((reference) => reference.id),
      createdAt: now,
      updatedAt: now,
    };
  });
}

function buildApprovedContent(candidate: ContentDirectionCandidate): ApprovedContentDirection {
  const now = toIsoNow();
  return {
    ...candidate,
    candidateId: candidate.id,
    approvedAt: now,
    updatedAt: now,
  };
}

function mapContentTypeToTemplate(contentType: ViralStudioContentType): string {
  if (contentType === 'caption_set') return 'caption';
  if (contentType === 'cta_set') return 'cta';
  if (contentType === 'static_post') return 'hook-script';
  if (contentType === 'carousel') return 'angle-remix';
  return 'full-script';
}

function mapContentTypeToFormatTarget(contentType: ViralStudioContentType): GenerationFormatTarget {
  if (contentType === 'story_sequence' || contentType === 'carousel') return 'story';
  if (contentType === 'short_video') return 'shorts';
  if (contentType === 'caption_set' || contentType === 'cta_set') return 'reel-30';
  return 'reel-60';
}

function formatContentTypeLabel(contentType: ViralStudioContentType): string {
  if (contentType === 'short_video') return 'Short Video';
  if (contentType === 'story_sequence') return 'Story Sequence';
  if (contentType === 'static_post') return 'Static Post';
  if (contentType === 'caption_set') return 'Caption Set';
  if (contentType === 'cta_set') return 'CTA Set';
  return 'Carousel';
}

function buildFormatResult(input: {
  contentType: ViralStudioContentType;
  approvedDesign: ApprovedDesignDirection;
  approvedContent: ApprovedContentDirection;
  references: ReferenceAsset[];
  profile: BrandDNAProfile | null;
}): FormatGenerationResult {
  const leadReference = input.references[0];
  const leadDriver = leadReference?.explainability.topDrivers?.[0] || 'hook clarity';
  const brandPromise = input.profile?.valueProposition || input.approvedContent.bigPromise;
  const ctaLine = `CTA: ${input.approvedContent.ctaIntent}`;
  const sharedDesign = {
    layoutStructure: [
      `Frame 1: Open on ${input.approvedContent.targetedPain} with one decisive headline.`,
      `Frame 2: Transition into ${input.approvedDesign.proofStructure.toLowerCase()}.`,
      `Final frame: land ${input.approvedContent.ctaIntent.toLowerCase()}.`,
    ],
    typographyTreatment: input.approvedDesign.typographyCharacter,
    onScreenTextGuidance: [
      `Keep hook text anchored around ${leadDriver.toLowerCase()}.`,
      'Use one dominant headline and one supporting proof caption per beat.',
      `Mirror Brand DNA voice: ${(input.profile?.summary || input.approvedContent.toneStance).slice(0, 120)}.`,
    ],
    pacingOrFrameStructure: [
      input.approvedDesign.motionPacingNotes,
      'Do not add more than one new idea per beat.',
      'Let proof breathe before the CTA lands.',
    ],
    visualCompositionNotes: [
      input.approvedDesign.layoutPattern,
      `Palette direction: ${input.approvedDesign.colorPaletteSummary}.`,
      'Keep the proof artifact visible, not implied.',
    ],
    assetSuggestions: [
      'One hero proof screenshot or testimonial frame.',
      'One clean product or offer demonstration shot.',
      'One closing CTA frame with whitespace and brand-safe contrast.',
    ],
  };

  const sharedContent = {
    hook: `If ${input.approvedContent.targetedPain} is still blocking momentum, this is the frame that changes it.`,
    narrativeBeats: [
      `Name the tension: ${input.approvedContent.targetedPain}.`,
      `Reframe the opportunity: ${input.approvedContent.targetedDesire}.`,
      `Prove the shift with ${leadReference ? `reference #${leadReference.ranking.rank}` : 'one ranked proof artifact'}.`,
      `Land the promise: ${brandPromise}.`,
    ],
    proofPlacement: input.approvedContent.proofAngle,
    cta: ctaLine,
    captionGuidance: [
      `Open the caption by restating the hook in a calmer voice.`,
      `Use one proof line and one credibility line before the CTA.`,
      `Keep required claims visible: ${(input.profile?.requiredClaims || []).slice(0, 2).join(' • ') || 'add any compliance-required claim.'}`,
    ],
    variantIdeas: [
      'Version A: tighter and more direct.',
      'Version B: proof-first and lower hype.',
      'Version C: objection-led and reassurance-heavy.',
    ],
  };

  if (input.contentType === 'carousel') {
    return {
      title: 'Carousel Direction',
      summary: 'Generate a slide-by-slide concept before writing dense copy.',
      contentType: input.contentType,
      approvedDesignDirectionId: input.approvedDesign.id,
      approvedContentDirectionId: input.approvedContent.id,
      sourceReferenceIds: input.references.map((reference) => reference.id),
      designDetails: {
        ...sharedDesign,
        layoutStructure: [
          'Slide 1: decisive hook card.',
          'Slide 2: context or mistake pattern.',
          'Slide 3: proof reveal.',
          'Slide 4: process or framework.',
          'Slide 5: CTA slide.',
        ],
      },
      contentDetails: {
        ...sharedContent,
        narrativeBeats: [
          'Slide 1 headline and tension.',
          'Slide 2 explains why the old pattern fails.',
          'Slide 3 shows proof or example.',
          'Slide 4 gives the usable shift.',
          'Slide 5 invites the next move.',
        ],
      },
    };
  }

  if (input.contentType === 'story_sequence') {
    return {
      title: 'Story Sequence Direction',
      summary: 'Use connected frames that feel personal but still conversion-aware.',
      contentType: input.contentType,
      approvedDesignDirectionId: input.approvedDesign.id,
      approvedContentDirectionId: input.approvedContent.id,
      sourceReferenceIds: input.references.map((reference) => reference.id),
      designDetails: {
        ...sharedDesign,
        layoutStructure: ['Frame 1 hook', 'Frame 2 proof', 'Frame 3 explanation', 'Frame 4 CTA'],
      },
      contentDetails: {
        ...sharedContent,
        narrativeBeats: [
          'Frame 1 names the problem.',
          'Frame 2 shows the shift visually.',
          'Frame 3 gives the reason it works.',
          'Frame 4 asks for the next smallest action.',
        ],
      },
    };
  }

  if (input.contentType === 'static_post') {
    return {
      title: 'Static Post Direction',
      summary: 'One visual concept, one claim, one proof anchor, one CTA.',
      contentType: input.contentType,
      approvedDesignDirectionId: input.approvedDesign.id,
      approvedContentDirectionId: input.approvedContent.id,
      sourceReferenceIds: input.references.map((reference) => reference.id),
      designDetails: {
        ...sharedDesign,
        layoutStructure: ['Hero concept', 'supporting proof micro-copy', 'CTA corner or footer'],
      },
      contentDetails: {
        ...sharedContent,
        narrativeBeats: ['Headline', 'supporting line', 'proof fragment', 'CTA line'],
      },
    };
  }

  if (input.contentType === 'caption_set') {
    return {
      title: 'Caption Set Direction',
      summary: 'Generate captions only after design and message direction are locked.',
      contentType: input.contentType,
      approvedDesignDirectionId: input.approvedDesign.id,
      approvedContentDirectionId: input.approvedContent.id,
      sourceReferenceIds: input.references.map((reference) => reference.id),
      designDetails: {
        ...sharedDesign,
        layoutStructure: ['Primary post or reel remains fixed; captions carry the narrative variants.'],
      },
      contentDetails: {
        ...sharedContent,
        narrativeBeats: ['Caption opener', 'proof line', 'credibility line', 'CTA line'],
        variantIdeas: ['Concise caption', 'storytelling caption', 'proof-heavy caption'],
      },
    };
  }

  if (input.contentType === 'cta_set') {
    return {
      title: 'CTA Set Direction',
      summary: 'Build CTA options that still feel native to the approved design and message.',
      contentType: input.contentType,
      approvedDesignDirectionId: input.approvedDesign.id,
      approvedContentDirectionId: input.approvedContent.id,
      sourceReferenceIds: input.references.map((reference) => reference.id),
      designDetails: {
        ...sharedDesign,
        layoutStructure: ['Primary content body remains stable; CTA framing changes by variant.'],
      },
      contentDetails: {
        ...sharedContent,
        narrativeBeats: ['Decision prompt', 'confidence line', 'next-step CTA'],
        variantIdeas: ['Direct CTA', 'soft consult CTA', 'proof-led CTA'],
      },
    };
  }

  return {
    title: 'Short Video Direction',
    summary: 'Storyboard the visual rhythm and the message beats before generating more formats.',
    contentType: input.contentType,
    approvedDesignDirectionId: input.approvedDesign.id,
    approvedContentDirectionId: input.approvedContent.id,
    sourceReferenceIds: input.references.map((reference) => reference.id),
    designDetails: sharedDesign,
    contentDetails: sharedContent,
  };
}

export function buildDocumentSectionsFromFormatGeneration(job: FormatGenerationJob): StudioDocumentSection[] {
  const designLines = [
    ...job.result.designDetails.layoutStructure,
    '',
    `Typography: ${job.result.designDetails.typographyTreatment}`,
    '',
    ...job.result.designDetails.onScreenTextGuidance.map((line) => `Text guidance: ${line}`),
    ...job.result.designDetails.pacingOrFrameStructure.map((line) => `Pacing: ${line}`),
    ...job.result.designDetails.visualCompositionNotes.map((line) => `Composition: ${line}`),
  ].join('\n');
  const contentLines = [
    `Hook: ${job.result.contentDetails.hook}`,
    '',
    ...job.result.contentDetails.narrativeBeats.map((line, index) => `Beat ${index + 1}: ${line}`),
    '',
    `Proof placement: ${job.result.contentDetails.proofPlacement}`,
    `CTA: ${job.result.contentDetails.cta}`,
  ].join('\n');
  return [
    {
      id: crypto.randomUUID(),
      title: `${formatContentTypeLabel(job.contentType)} Brief`,
      kind: 'script',
      content: job.result.summary,
    },
    {
      id: crypto.randomUUID(),
      title: 'Design Details',
      kind: 'script',
      content: designLines,
    },
    {
      id: crypto.randomUUID(),
      title: 'Content Details',
      kind: 'script',
      content: contentLines,
    },
    {
      id: crypto.randomUUID(),
      title: 'Asset Suggestions',
      kind: 'captions',
      content: job.result.designDetails.assetSuggestions,
    },
    {
      id: crypto.randomUUID(),
      title: 'Caption Guidance',
      kind: 'captions',
      content: job.result.contentDetails.captionGuidance,
    },
    {
      id: crypto.randomUUID(),
      title: 'CTA Variants',
      kind: 'ctas',
      content: [job.result.contentDetails.cta, ...job.result.contentDetails.variantIdeas],
    },
  ];
}

export async function getViralStudioPlannerState(workspaceId: string): Promise<{
  session: ViralStudioPlannerSession;
  designDirections: DesignDirectionCandidate[];
  approvedDesign: ApprovedDesignDirection | null;
  contentDirections: ContentDirectionCandidate[];
  approvedContent: ApprovedContentDirection | null;
}> {
  const session = await ensurePlannerSession(workspaceId);
  const store = await hydratePlannerStore(workspaceId);
  return {
    session,
    designDirections: attachStorageModeToList(workspaceId, Array.from(store.designDirections.values()).sort((a, b) => a.orderIndex - b.orderIndex).map((item) => clone(item))) as DesignDirectionCandidate[],
    approvedDesign: store.approvedDesign
      ? (attachStorageModeToRecord(workspaceId, clone(store.approvedDesign)) as ApprovedDesignDirection)
      : null,
    contentDirections: attachStorageModeToList(workspaceId, Array.from(store.contentDirections.values()).sort((a, b) => a.orderIndex - b.orderIndex).map((item) => clone(item))) as ContentDirectionCandidate[],
    approvedContent: store.approvedContent
      ? (attachStorageModeToRecord(workspaceId, clone(store.approvedContent)) as ApprovedContentDirection)
      : null,
  };
}

export async function analyzeDesignDirections(workspaceId: string): Promise<{
  session: ViralStudioPlannerSession;
  candidates: DesignDirectionCandidate[];
}> {
  const store = await hydratePlannerStore(workspaceId);
  const session = await ensurePlannerSession(workspaceId);
  const references = await pickPlannerReferences(workspaceId);
  if (references.length === 0) {
    throw new Error('Shortlist at least one reference before design analysis.');
  }
  const candidates = buildDesignCandidates({
    workspaceId,
    sessionId: session.id,
    references,
  });
  const nextSession: ViralStudioPlannerSession = {
    ...session,
    stage: 'design_selection',
    shortlistedReferenceIds: references.map((reference) => reference.id),
    approvedDesignDirectionId: undefined,
    approvedContentDirectionId: undefined,
    selectedContentType: undefined,
    latestFormatGenerationId: undefined,
    updatedAt: toIsoNow(),
  };
  store.session = clone(nextSession);
  store.designDirections = new Map(candidates.map((item) => [item.id, clone(item)]));
  store.approvedDesign = null;
  store.contentDirections = new Map();
  store.approvedContent = null;
  store.formatJobs = new Map();
  await persistBestEffort(workspaceId, async () => {
    await repositoryUpsertPlannerSession(nextSession);
    await repositoryReplaceDesignDirectionCandidates(workspaceId, session.id, candidates);
    await repositoryDeleteApprovedDesignDirection(workspaceId, session.id);
    await repositoryDeleteApprovedContentDirection(workspaceId, session.id);
    await repositoryReplaceContentDirectionCandidates(workspaceId, session.id, []);
  });
  return {
    session: attachStorageModeToRecord(workspaceId, clone(nextSession)) as ViralStudioPlannerSession,
    candidates: attachStorageModeToList(workspaceId, candidates.map((item) => clone(item))) as DesignDirectionCandidate[],
  };
}

export async function listDesignDirections(workspaceId: string): Promise<{
  session: ViralStudioPlannerSession;
  candidates: DesignDirectionCandidate[];
  approved: ApprovedDesignDirection | null;
}> {
  const payload = await getViralStudioPlannerState(workspaceId);
  return {
    session: payload.session,
    candidates: payload.designDirections,
    approved: payload.approvedDesign,
  };
}

export async function selectDesignDirection(
  workspaceId: string,
  candidateId: string
): Promise<{
  session: ViralStudioPlannerSession;
  approved: ApprovedDesignDirection;
}> {
  const store = await hydratePlannerStore(workspaceId);
  const session = await ensurePlannerSession(workspaceId);
  let candidate = store.designDirections.get(cleanString(candidateId));
  if (!candidate && shouldUseDbReads(workspaceId)) {
    const snapshot = await repositoryLoadPlannerSnapshot(workspaceId);
    store.designDirections = new Map(snapshot.designDirections.map((item) => [item.id, clone(item)]));
    candidate = store.designDirections.get(cleanString(candidateId));
  }
  if (!candidate) {
    throw new Error('Design direction not found. Run design analysis first.');
  }
  const approved = buildApprovedDesign(candidate);
  const nextSession: ViralStudioPlannerSession = {
    ...session,
    stage: 'content_strategy',
    approvedDesignDirectionId: approved.id,
    approvedContentDirectionId: undefined,
    selectedContentType: undefined,
    latestFormatGenerationId: undefined,
    updatedAt: toIsoNow(),
  };
  store.session = clone(nextSession);
  store.approvedDesign = clone(approved);
  store.contentDirections = new Map();
  store.approvedContent = null;
  store.formatJobs = new Map();
  await persistBestEffort(workspaceId, async () => {
    await repositoryUpsertPlannerSession(nextSession);
    await repositoryUpsertApprovedDesignDirection(approved);
    await repositoryDeleteApprovedContentDirection(workspaceId, session.id);
    await repositoryReplaceContentDirectionCandidates(workspaceId, session.id, []);
  });
  return {
    session: attachStorageModeToRecord(workspaceId, clone(nextSession)) as ViralStudioPlannerSession,
    approved: attachStorageModeToRecord(workspaceId, clone(approved)) as ApprovedDesignDirection,
  };
}

export async function analyzeContentDirections(workspaceId: string): Promise<{
  session: ViralStudioPlannerSession;
  approvedDesign: ApprovedDesignDirection;
  candidates: ContentDirectionCandidate[];
}> {
  const store = await hydratePlannerStore(workspaceId);
  const session = await ensurePlannerSession(workspaceId);
  const approvedDesign = store.approvedDesign;
  if (!approvedDesign) {
    throw new Error('Approve one design direction before analyzing content strategy.');
  }
  const references = await pickPlannerReferences(workspaceId);
  const profile = await getBrandDNAProfile(workspaceId);
  const candidates = buildContentDirections({
    workspaceId,
    sessionId: session.id,
    approvedDesign,
    references,
    profile,
  });
  const nextSession: ViralStudioPlannerSession = {
    ...session,
    stage: 'content_selection',
    approvedContentDirectionId: undefined,
    selectedContentType: undefined,
    latestFormatGenerationId: undefined,
    updatedAt: toIsoNow(),
  };
  store.session = clone(nextSession);
  store.contentDirections = new Map(candidates.map((item) => [item.id, clone(item)]));
  store.approvedContent = null;
  store.formatJobs = new Map();
  await persistBestEffort(workspaceId, async () => {
    await repositoryUpsertPlannerSession(nextSession);
    await repositoryReplaceContentDirectionCandidates(workspaceId, session.id, candidates);
    await repositoryDeleteApprovedContentDirection(workspaceId, session.id);
  });
  return {
    session: attachStorageModeToRecord(workspaceId, clone(nextSession)) as ViralStudioPlannerSession,
    approvedDesign: attachStorageModeToRecord(workspaceId, clone(approvedDesign)) as ApprovedDesignDirection,
    candidates: attachStorageModeToList(workspaceId, candidates.map((item) => clone(item))) as ContentDirectionCandidate[],
  };
}

export async function listContentDirections(workspaceId: string): Promise<{
  session: ViralStudioPlannerSession;
  approvedDesign: ApprovedDesignDirection | null;
  candidates: ContentDirectionCandidate[];
  approved: ApprovedContentDirection | null;
}> {
  const payload = await getViralStudioPlannerState(workspaceId);
  return {
    session: payload.session,
    approvedDesign: payload.approvedDesign,
    candidates: payload.contentDirections,
    approved: payload.approvedContent,
  };
}

export async function selectContentDirection(
  workspaceId: string,
  candidateId: string
): Promise<{
  session: ViralStudioPlannerSession;
  approvedDesign: ApprovedDesignDirection;
  approved: ApprovedContentDirection;
}> {
  const store = await hydratePlannerStore(workspaceId);
  const session = await ensurePlannerSession(workspaceId);
  if (!store.approvedDesign) {
    throw new Error('Approve one design direction before selecting content strategy.');
  }
  let candidate = store.contentDirections.get(cleanString(candidateId));
  if (!candidate && shouldUseDbReads(workspaceId)) {
    const snapshot = await repositoryLoadPlannerSnapshot(workspaceId);
    store.contentDirections = new Map(snapshot.contentDirections.map((item) => [item.id, clone(item)]));
    candidate = store.contentDirections.get(cleanString(candidateId));
  }
  if (!candidate) {
    throw new Error('Content direction not found. Analyze content directions first.');
  }
  if (candidate.approvedDesignDirectionId !== store.approvedDesign.id) {
    throw new Error('This content direction belongs to a different approved design direction.');
  }
  const approved = buildApprovedContent(candidate);
  const nextSession: ViralStudioPlannerSession = {
    ...session,
    stage: 'format_selection',
    approvedContentDirectionId: approved.id,
    selectedContentType: undefined,
    latestFormatGenerationId: undefined,
    updatedAt: toIsoNow(),
  };
  store.session = clone(nextSession);
  store.approvedContent = clone(approved);
  store.formatJobs = new Map();
  await persistBestEffort(workspaceId, async () => {
    await repositoryUpsertPlannerSession(nextSession);
    await repositoryUpsertApprovedContentDirection(approved);
  });
  return {
    session: attachStorageModeToRecord(workspaceId, clone(nextSession)) as ViralStudioPlannerSession,
    approvedDesign: attachStorageModeToRecord(workspaceId, clone(store.approvedDesign)) as ApprovedDesignDirection,
    approved: attachStorageModeToRecord(workspaceId, clone(approved)) as ApprovedContentDirection,
  };
}

export async function createFormatGeneration(
  workspaceId: string,
  input: { contentType: ViralStudioContentType }
): Promise<{
  session: ViralStudioPlannerSession;
  approvedDesign: ApprovedDesignDirection;
  approvedContent: ApprovedContentDirection;
  generation: FormatGenerationJob;
}> {
  const store = await hydratePlannerStore(workspaceId);
  const session = await ensurePlannerSession(workspaceId);
  const approvedDesign = store.approvedDesign;
  const approvedContent = store.approvedContent;
  if (!approvedDesign || !approvedContent) {
    throw new Error('Approve one design direction and one content direction before generating a format.');
  }
  const references = await pickPlannerReferences(workspaceId);
  if (references.length === 0) {
    throw new Error('Shortlist at least one reference before generating a format.');
  }
  const profile = await getBrandDNAProfile(workspaceId);
  const selectedReferenceIds = references.map((reference) => reference.id);
  const contentType = input.contentType;
  const result = buildFormatResult({
    contentType,
    approvedDesign,
    approvedContent,
    references,
    profile,
  });
  const companionPrompt = [
    `Approved design direction: ${approvedDesign.archetypeName}.`,
    `Approved content direction: ${approvedContent.title}.`,
    `Generate a support pack for ${formatContentTypeLabel(contentType)}.`,
    `Keep the execution grounded in these references: ${selectedReferenceIds.join(', ')}.`,
  ].join(' ');
  const legacyGeneration = await createGenerationPack(workspaceId, {
    templateId: mapContentTypeToTemplate(contentType),
    prompt: companionPrompt,
    selectedReferenceIds,
    formatTarget: mapContentTypeToFormatTarget(contentType),
  });
  const now = toIsoNow();
  const job: FormatGenerationJob = {
    id: crypto.randomUUID(),
    workspaceId,
    sessionId: session.id,
    approvedDesignDirectionId: approvedDesign.id,
    approvedContentDirectionId: approvedContent.id,
    contentType,
    status: 'completed',
    generationPackId: legacyGeneration.id,
    selectedReferenceIds,
    result,
    createdAt: now,
    updatedAt: now,
  };
  const nextSession: ViralStudioPlannerSession = {
    ...session,
    stage: 'document_save',
    selectedContentType: contentType,
    latestFormatGenerationId: job.id,
    updatedAt: now,
  };
  store.session = clone(nextSession);
  store.formatJobs.set(job.id, clone(job));
  await persistBestEffort(workspaceId, async () => {
    await repositoryUpsertPlannerSession(nextSession);
    await repositoryUpsertFormatGenerationJob(job);
  });
  return {
    session: attachStorageModeToRecord(workspaceId, clone(nextSession)) as ViralStudioPlannerSession,
    approvedDesign: attachStorageModeToRecord(workspaceId, clone(approvedDesign)) as ApprovedDesignDirection,
    approvedContent: attachStorageModeToRecord(workspaceId, clone(approvedContent)) as ApprovedContentDirection,
    generation: attachStorageModeToRecord(workspaceId, clone(job)) as FormatGenerationJob,
  };
}

export async function getFormatGeneration(
  workspaceId: string,
  generationId: string
): Promise<FormatGenerationJob | null> {
  const store = await hydratePlannerStore(workspaceId);
  const existing = store.formatJobs.get(cleanString(generationId));
  if (existing) {
    return attachStorageModeToRecord(workspaceId, clone(existing)) as FormatGenerationJob;
  }
  if (!shouldUseDbReads(workspaceId) && !shouldPersistToDb(workspaceId)) return null;
  try {
    const row = await repositoryGetFormatGenerationJob(workspaceId, cleanString(generationId));
    if (!row) return null;
    store.formatJobs.set(row.id, clone(row));
    return attachStorageModeToRecord(workspaceId, clone(row)) as FormatGenerationJob;
  } catch {
    return null;
  }
}
