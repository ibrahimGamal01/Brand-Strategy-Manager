"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  analyzeViralStudioContentDirections,
  analyzeViralStudioDesignDirections,
  applyWorkspaceBrandDnaAutofill,
  compareViralStudioDocumentVersions,
  createViralStudioDocument,
  createViralStudioFormatGeneration,
  createViralStudioDocumentVersion,
  createViralStudioGeneration,
  createViralStudioIngestion,
  createWorkspaceBrandDna,
  exportViralStudioDocument,
  fetchViralStudioContentDirections,
  fetchViralStudioContracts,
  fetchViralStudioDesignDirections,
  fetchViralStudioDocument,
  fetchViralStudioFormatGeneration,
  fetchViralStudioIngestion,
  fetchViralStudioSuggestedSources,
  fetchViralStudioTelemetry,
  fetchViralStudioWorkflowStatus,
  fetchWorkspaceBrandDna,
  generateWorkspaceBrandDnaSummary,
  listViralStudioIngestions,
  listViralStudioReferences,
  patchViralStudioDocument,
  patchWorkspaceBrandDna,
  promoteViralStudioDocumentVersion,
  previewWorkspaceBrandDnaAutofill,
  refineViralStudioGeneration,
  retryViralStudioIngestion,
  selectViralStudioContentDirection,
  selectViralStudioDesignDirection,
  updateViralStudioReferenceShortlist,
} from "@/lib/viral-studio-api";
import {
  createRuntimeThread,
  listRuntimeThreads,
  sendRuntimeMessage,
} from "@/lib/runtime-api";
import { getPortalMe } from "@/lib/auth-api";
import {
  ViralStudioAutofillFieldKey,
  ViralStudioBrandDnaAutofillPreview,
  BrandDNAProfile,
  ViralStudioContentDirectionCandidate,
  ViralStudioContentType,
  ViralStudioContractSnapshot,
  ViralStudioDesignDirectionCandidate,
  ViralStudioDocument,
  ViralStudioDocumentSection,
  ViralStudioDocumentVersionComparison,
  ViralStudioDocumentVersion,
  ViralStudioFormatGenerationJob,
  ViralStudioGenerationFormatTarget,
  ViralStudioGenerationPack,
  ViralStudioGenerationSection,
  ViralStudioIngestionRun,
  ViralStudioApprovedContentDirection,
  ViralStudioApprovedDesignDirection,
  ViralStudioPlannerSession,
  ViralStudioPlatform,
  ViralStudioPromptTemplate,
  ViralStudioReferenceAsset,
  ViralStudioSuggestedSource,
  ViralStudioTelemetrySnapshot,
  ViralStudioWorkflowStatus,
} from "@/types/viral-studio";

type BrandFormState = {
  mission: string;
  valueProposition: string;
  productOrService: string;
  region: string;
  audiencePersonas: string;
  pains: string;
  desires: string;
  objections: string;
  bannedPhrases: string;
  requiredClaims: string;
  exemplars: string;
  summary: string;
  voiceBold: number;
  voiceFormal: number;
  voicePlayful: number;
  voiceDirect: number;
};

type ViralStudioChatCitation = {
  id: string;
  label: string;
  url?: string;
  libraryRef?: string;
};

type ViralStudioChatBridgePayload = {
  content: string;
  blocksJson: Record<string, unknown>;
  citationsJson: ViralStudioChatCitation[];
  libraryRefs: string[];
};

type IngestionPreset = "balanced" | "quick-scan" | "deep-scan" | "data-max";
type ReferenceShortlistAction = "pin" | "exclude" | "must-use" | "clear";

type PromptStudioSectionMeta = {
  id: ViralStudioGenerationSection;
  title: string;
  kind: "list" | "text";
};

type PromptStudioSectionGuide = {
  eyebrow: string;
  reviewLens: string;
  purpose: string;
};

const PROMPT_STUDIO_SECTIONS: PromptStudioSectionMeta[] = [
  { id: "hooks", title: "Hooks", kind: "list" },
  { id: "scripts.short", title: "Short Script", kind: "text" },
  { id: "scripts.medium", title: "Medium Script", kind: "text" },
  { id: "scripts.long", title: "Long Script", kind: "text" },
  { id: "captions", title: "Captions", kind: "list" },
  { id: "ctas", title: "CTA Variants", kind: "list" },
  { id: "angleRemixes", title: "Angle Remixes", kind: "list" },
];

const PROMPT_STUDIO_SECTION_GUIDES: Record<ViralStudioGenerationSection, PromptStudioSectionGuide> = {
  hooks: {
    eyebrow: "Stop the scroll",
    reviewLens: "Check clarity, tension, and how fast the promise lands.",
    purpose: "Hooks should make the first 2 seconds feel inevitable to keep watching.",
  },
  "scripts.short": {
    eyebrow: "Quick win script",
    reviewLens: "Tight pacing, one proof point, immediate CTA.",
    purpose: "This is the fast-turn execution version for aggressive testing.",
  },
  "scripts.medium": {
    eyebrow: "Balanced script",
    reviewLens: "Clear setup, evidence, payoff, and branded close.",
    purpose: "Use this when you need enough explanation without losing momentum.",
  },
  "scripts.long": {
    eyebrow: "Editorial script",
    reviewLens: "Narrative flow, depth, and retention across a longer build.",
    purpose: "This is the deeper variant for richer story-led or educational content.",
  },
  captions: {
    eyebrow: "Caption angles",
    reviewLens: "First line strength, payoff clarity, and CTA handoff.",
    purpose: "Captions should reinforce the angle without repeating the script word-for-word.",
  },
  ctas: {
    eyebrow: "Action language",
    reviewLens: "Specific next step, urgency, and conversion clarity.",
    purpose: "CTAs should tell the audience exactly what to do next and why now.",
  },
  angleRemixes: {
    eyebrow: "Creative expansion",
    reviewLens: "Fresh positioning, non-obvious angles, and market contrast.",
    purpose: "Angle remixes help the team test smarter variations without losing the core strategy.",
  },
};

const DEFAULT_FORM_STATE: BrandFormState = {
  mission: "",
  valueProposition: "",
  productOrService: "",
  region: "",
  audiencePersonas: "",
  pains: "",
  desires: "",
  objections: "",
  bannedPhrases: "",
  requiredClaims: "",
  exemplars: "",
  summary: "",
  voiceBold: 55,
  voiceFormal: 40,
  voicePlayful: 45,
  voiceDirect: 65,
};

const AUTOFILL_FIELD_ORDER: ViralStudioAutofillFieldKey[] = [
  "mission",
  "valueProposition",
  "productOrService",
  "region",
  "audiencePersonas",
  "pains",
  "desires",
  "objections",
  "voiceSliders",
  "bannedPhrases",
  "requiredClaims",
  "exemplars",
  "summary",
];

const WORKFLOW_STAGE_ORDER: Array<ViralStudioWorkflowStatus["workflowStage"]> = [
  "intake_pending",
  "intake_complete",
  "studio_autofill_review",
  "extraction",
  "curation",
  "generation",
  "chat_execution",
];

const ONBOARDING_STEP_META: Array<{
  step: 1 | 2 | 3 | 4;
  title: string;
  subtitle: string;
  helper: string;
  prompts: string[];
}> = [
  {
    step: 1,
    title: "Brand Core",
    subtitle: "Mission, value, offer, region",
    helper: "Start with the one-sentence truth of the business. This should feel crisp enough to reuse everywhere.",
    prompts: [
      "What do you actually help people achieve?",
      "Why is your offer meaningfully better?",
      "What market or region shapes your positioning?",
    ],
  },
  {
    step: 2,
    title: "Audience",
    subtitle: "Personas, pains, desires, objections",
    helper: "Name the people, pressure, and payoff. Good audience inputs make the later generation feel much smarter.",
    prompts: [
      "Who is most likely to buy first?",
      "What frustrates them before they find you?",
      "What belief or objection slows them down?",
    ],
  },
  {
    step: 3,
    title: "Voice Guardrails",
    subtitle: "Sliders, banned terms, required claims",
    helper: "Turn taste into rules. This is where the product stops sounding generic and starts sounding like your team.",
    prompts: [
      "What tone should always come through?",
      "What phrases feel cheap, vague, or off-brand?",
      "What claims or qualifiers must always stay intact?",
    ],
  },
  {
    step: 4,
    title: "Proof + Summary",
    subtitle: "Exemplars and AI-ready narrative",
    helper: "Give the system a few examples and a final summary so generation can stay anchored to real brand texture.",
    prompts: [
      "What content already feels like the best version of your brand?",
      "What should the AI remember even after the form is closed?",
      "What should never be lost in translation?",
    ],
  },
];

type WorkflowGuideAction =
  | "open_intake"
  | "run_autofill"
  | "finalize_dna"
  | "start_extraction"
  | "curate_references"
  | "generate_pack"
  | "handoff_chat";

type StudioDetailCard = {
  label: string;
  value: string;
  note: string;
  tone?: "info" | "success" | "warning";
};

type ReferenceCardDetail = {
  eyebrow: string;
  headline: string;
  footer: string;
  bestUse: string;
  interactionRate: number;
  ageDays: number | null;
  primaryContributionLabel: string;
  primaryContributionValue: number;
  secondaryContributionLabel?: string;
  secondaryContributionValue?: number;
  bullets: string[];
  palette: string[];
  mediaUrl?: string;
};

function workflowStageOrderIndex(stage: ViralStudioWorkflowStatus["workflowStage"] | undefined): number {
  if (!stage) return 0;
  const index = WORKFLOW_STAGE_ORDER.indexOf(stage);
  return index >= 0 ? index : 0;
}

function csvToArray(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function arrayToCsv(items: string[] | undefined): string {
  return Array.isArray(items) ? items.join(", ") : "";
}

function toFormState(profile: BrandDNAProfile | null): BrandFormState {
  if (!profile) return { ...DEFAULT_FORM_STATE };
  return {
    mission: profile.mission || "",
    valueProposition: profile.valueProposition || "",
    productOrService: profile.productOrService || "",
    region: profile.region || "",
    audiencePersonas: arrayToCsv(profile.audiencePersonas),
    pains: arrayToCsv(profile.pains),
    desires: arrayToCsv(profile.desires),
    objections: arrayToCsv(profile.objections),
    bannedPhrases: arrayToCsv(profile.bannedPhrases),
    requiredClaims: arrayToCsv(profile.requiredClaims),
    exemplars: arrayToCsv(profile.exemplars),
    summary: profile.summary || "",
    voiceBold: profile.voiceSliders.bold,
    voiceFormal: profile.voiceSliders.formal,
    voicePlayful: profile.voiceSliders.playful,
    voiceDirect: profile.voiceSliders.direct,
  };
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  return parsed.toLocaleString();
}

function tonePreview(form: BrandFormState): string {
  const tags: string[] = [];
  if (form.voiceBold >= 60) tags.push("bold");
  if (form.voiceFormal >= 60) tags.push("professional");
  if (form.voicePlayful >= 60) tags.push("playful");
  if (form.voiceDirect >= 60) tags.push("direct");
  if (tags.length === 0) tags.push("balanced");
  return `Voice profile: ${tags.join(", ")}. Keep messaging clear, specific, and aligned with your brand promise.`;
}

function compactText(value: string, maxChars = 180): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function sanitizeHttpUrl(value: string): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function toPlatformLabel(platform: ViralStudioPlatform): string {
  if (platform === "instagram") return "Instagram";
  if (platform === "tiktok") return "TikTok";
  return "YouTube";
}

function toPresetLabel(preset: IngestionPreset): string {
  if (preset === "data-max") return "Data max";
  if (preset === "quick-scan") return "Quick scan";
  if (preset === "deep-scan") return "Deep scan";
  return "Balanced";
}

function toWorkflowStageLabel(stage: ViralStudioWorkflowStatus["workflowStage"] | string): string {
  if (stage === "intake_pending") return "Intake pending";
  if (stage === "intake_complete") return "Intake complete";
  if (stage === "studio_autofill_review") return "Studio autofill review";
  if (stage === "extraction") return "Extraction";
  if (stage === "curation") return "Curation";
  if (stage === "generation") return "Generation";
  if (stage === "chat_execution") return "Chat execution";
  return stage;
}

function toAutofillFieldLabel(field: ViralStudioAutofillFieldKey): string {
  if (field === "valueProposition") return "Value proposition";
  if (field === "productOrService") return "Product / service";
  if (field === "audiencePersonas") return "Audience personas";
  if (field === "voiceSliders") return "Voice sliders";
  if (field === "bannedPhrases") return "Banned phrases";
  if (field === "requiredClaims") return "Required claims";
  return field.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

function createAutofillSelection(
  preview: ViralStudioBrandDnaAutofillPreview | null
): Partial<Record<ViralStudioAutofillFieldKey, boolean>> {
  const next: Partial<Record<ViralStudioAutofillFieldKey, boolean>> = {};
  if (!preview) return next;
  for (const field of preview.suggestedFields) {
    next[field] = true;
  }
  return next;
}

function toGenerationFormatLabel(target: ViralStudioGenerationFormatTarget): string {
  if (target === "reel-60") return "60s Reel";
  if (target === "shorts") return "YouTube Shorts";
  if (target === "story") return "Story Sequence";
  return "30s Reel";
}

function toPlannerStageLabel(stage: ViralStudioPlannerSession["stage"] | undefined): string {
  if (stage === "design_selection") return "Pick design direction";
  if (stage === "content_strategy") return "Analyze content";
  if (stage === "content_selection") return "Pick content direction";
  if (stage === "format_selection") return "Pick content type";
  if (stage === "format_generation") return "Generating format";
  if (stage === "document_save") return "Save to document";
  return "Analyze design directions";
}

function toContentTypeLabel(contentType: ViralStudioContentType): string {
  if (contentType === "short_video") return "Short video";
  if (contentType === "story_sequence") return "Story sequence";
  if (contentType === "static_post") return "Static post";
  if (contentType === "caption_set") return "Caption set";
  if (contentType === "cta_set") return "CTA set";
  return "Carousel";
}

function toPromptIntentLabel(intent: ViralStudioPromptTemplate["intent"]): string {
  if (intent === "hook-script") return "Hook-led";
  if (intent === "caption") return "Caption-first";
  if (intent === "cta") return "CTA-focused";
  if (intent === "angle-remix") return "Angle remix";
  return "Full script";
}

function defaultSectionInstructions(): Record<ViralStudioGenerationSection, string> {
  return {
    hooks: "Sharpen the promise and make the first 2 seconds impossible to ignore.",
    "scripts.short": "Tighten pacing and make the CTA immediate.",
    "scripts.medium": "Increase clarity and add one concrete proof element.",
    "scripts.long": "Improve narrative flow while preserving direct tone.",
    captions: "Make the first line scroll-stopping and outcome-led.",
    ctas: "Increase action clarity with one measurable next step.",
    angleRemixes: "Push for fresher positioning against common market assumptions.",
  };
}

function readGenerationSectionContent(
  generation: ViralStudioGenerationPack,
  section: ViralStudioGenerationSection
): string[] {
  if (section === "hooks") return generation.outputs.hooks;
  if (section === "scripts.short") return [generation.outputs.scripts.short];
  if (section === "scripts.medium") return [generation.outputs.scripts.medium];
  if (section === "scripts.long") return [generation.outputs.scripts.long];
  if (section === "captions") return generation.outputs.captions;
  if (section === "ctas") return generation.outputs.ctas;
  return generation.outputs.angleRemixes;
}

function toSectionText(section: ViralStudioDocumentSection): string {
  if (Array.isArray(section.content)) return section.content.join("\n");
  return section.content;
}

function parseSectionText(
  kind: ViralStudioDocumentSection["kind"],
  value: string
): string | string[] {
  const normalized = value.trim();
  if (kind === "script") return normalized;
  if (!normalized) return [];
  return normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildDocumentSectionsFromGeneration(
  generation: ViralStudioGenerationPack,
  existingSections?: ViralStudioDocumentSection[]
): ViralStudioDocumentSection[] {
  const existingByKind = new Map(
    (existingSections || []).map((section) => [section.kind, section] as const)
  );
  const scriptBlock = [
    "Short",
    generation.outputs.scripts.short || "",
    "",
    "Medium",
    generation.outputs.scripts.medium || "",
    "",
    "Long",
    generation.outputs.scripts.long || "",
  ]
    .join("\n")
    .trim();
  const sectionOrder: Array<{
    kind: ViralStudioDocumentSection["kind"];
    fallbackTitle: string;
    content: string | string[];
  }> = [
    { kind: "hooks", fallbackTitle: "Hooks", content: generation.outputs.hooks },
    { kind: "script", fallbackTitle: "Script Pack", content: scriptBlock },
    { kind: "captions", fallbackTitle: "Captions", content: generation.outputs.captions },
    { kind: "ctas", fallbackTitle: "CTA Variants", content: generation.outputs.ctas },
    { kind: "angles", fallbackTitle: "Angle Remixes", content: generation.outputs.angleRemixes },
  ];
  return sectionOrder.map((entry) => {
    const existing = existingByKind.get(entry.kind);
    return {
      id: existing?.id || `auto-${entry.kind}`,
      title: existing?.title || entry.fallbackTitle,
      kind: entry.kind,
      content: entry.content,
    };
  });
}

function moveDocumentSection(
  sections: ViralStudioDocumentSection[],
  sectionId: string,
  direction: "up" | "down"
): ViralStudioDocumentSection[] {
  const index = sections.findIndex((section) => section.id === sectionId);
  if (index < 0) return sections;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= sections.length) return sections;
  const next = [...sections];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

function presetDefaults(preset: IngestionPreset): { maxVideos: number; lookbackDays: number } {
  if (preset === "data-max") {
    return { maxVideos: 120, lookbackDays: 365 };
  }
  if (preset === "quick-scan") {
    return { maxVideos: 24, lookbackDays: 90 };
  }
  if (preset === "deep-scan") {
    return { maxVideos: 80, lookbackDays: 270 };
  }
  return { maxVideos: 50, lookbackDays: 180 };
}

function statusLabel(status: ViralStudioIngestionRun["status"]): string {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "partial") return "Partial";
  if (status === "failed") return "Failed";
  return "Completed";
}

function isTerminalIngestionStatus(status: ViralStudioIngestionRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "partial";
}

function shortlistLabel(state: ViralStudioReferenceAsset["shortlistState"]): string {
  if (state === "must-use") return "Must-use";
  if (state === "pin") return "Pinned";
  if (state === "exclude") return "Excluded";
  return "Unsorted";
}

function contributionLabel(
  key: keyof ViralStudioReferenceAsset["explainability"]["weightedContributions"]
): string {
  if (key === "engagementRate") return "Engagement";
  if (key === "recency") return "Recency";
  if (key === "hookStrength") return "Hook strength";
  if (key === "retentionProxy") return "Retention proxy";
  return "Caption clarity";
}

function normalizedMetricLabel(key: keyof ViralStudioReferenceAsset["normalizedMetrics"]): string {
  if (key === "engagementRatePct") return "Engagement rate";
  if (key === "recencyPct") return "Recency";
  if (key === "hookStrengthPct") return "Hook strength";
  if (key === "retentionProxyPct") return "Retention proxy";
  return "Caption clarity";
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatUnitPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 ms";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function daysSinceIso(value: string): number | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const diffMs = Date.now() - parsed.getTime();
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function buildViralStudioCitations(source: ViralStudioReferenceAsset[]): ViralStudioChatCitation[] {
  const seen = new Set<string>();
  const citations: ViralStudioChatCitation[] = [];
  for (const item of source) {
    const url = sanitizeHttpUrl(item.sourceUrl);
    const libraryRef = String(item.assetRef || "").trim();
    const label = `${toPlatformLabel(item.sourcePlatform)} reference #${item.ranking.rank}`;
    const key = `${libraryRef || item.id}|${label}|${url || ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      id: libraryRef || item.id,
      label,
      ...(url ? { url } : {}),
      ...(libraryRef ? { libraryRef } : {}),
    });
    if (citations.length >= 12) break;
  }
  return citations;
}

function buildShortlistChatBridgePayload(source: ViralStudioReferenceAsset[]): ViralStudioChatBridgePayload {
  const citations = buildViralStudioCitations(source);
  const libraryRefs = citations
    .map((item) => String(item.libraryRef || "").trim())
    .filter(Boolean)
    .slice(0, 20);

  const shortlistLines = source.map(
    (item, index) =>
      `${index + 1}. ${toPlatformLabel(item.sourcePlatform)} | rank #${item.ranking.rank} | score ${item.scores.composite.toFixed(3)} | ${compactText(item.ranking.rationaleTitle, 110)}`
  );
  const citationLines = citations.map(
    (item, index) => `${index + 1}. ${item.label}${item.url ? ` (${item.url})` : ""}`
  );

  return {
    content: [
      "Use this Viral Studio shortlist as grounded context for strategy decisions.",
      "",
      "Shortlisted references:",
      ...shortlistLines,
      "",
      "Citations:",
      ...(citationLines.length ? citationLines : ["- none"]),
      "",
      "Task: synthesize the top content angles, audience hooks, and next execution steps for this workspace while citing the strongest references.",
    ].join("\n"),
    blocksJson: {
      type: "viral_studio_context",
      contextKind: "shortlist",
      objective: "Convert shortlisted viral references into strategic content angles and execution priorities.",
      summary: `${source.length} references were selected from Viral Studio ranking.`,
      cards: source.slice(0, 8).map((item, index) => ({
        id: item.id,
        title: compactText(item.ranking.rationaleTitle, 130) || `Reference ${index + 1}`,
        subtitle: compactText(item.caption || item.transcriptSummary || "", 130),
        sourcePlatform: item.sourcePlatform,
        sourceUrl: sanitizeHttpUrl(item.sourceUrl),
        score: Number(item.scores.composite.toFixed(4)),
        notes: item.ranking.rationaleBullets.slice(0, 3).map((bullet) => compactText(bullet, 140)),
      })),
      citations,
    },
    citationsJson: citations,
    libraryRefs,
  };
}

function buildGenerationChatBridgePayload(
  generation: ViralStudioGenerationPack,
  references: ViralStudioReferenceAsset[]
): ViralStudioChatBridgePayload {
  const referenceById = new Map(references.map((item) => [item.id, item]));
  const selectedReferences = generation.selectedReferenceIds
    .map((id) => referenceById.get(id))
    .filter((item): item is ViralStudioReferenceAsset => Boolean(item));
  const source = selectedReferences.length > 0 ? selectedReferences.slice(0, 8) : references.slice(0, 8);
  const citations = buildViralStudioCitations(source);
  if (generation.assetRef) {
    citations.unshift({
      id: generation.assetRef,
      label: `Generation pack (${toGenerationFormatLabel(generation.formatTarget)})`,
      libraryRef: generation.assetRef,
    });
  }
  const libraryRefs = citations
    .map((item) => String(item.libraryRef || "").trim())
    .filter(Boolean)
    .slice(0, 20);

  const hookLines = generation.outputs.hooks.slice(0, 6).map((hook, index) => `${index + 1}. ${compactText(hook, 220)}`);
  const captionLines = generation.outputs.captions
    .slice(0, 4)
    .map((caption, index) => `${index + 1}. ${compactText(caption, 220)}`);
  const ctaLines = generation.outputs.ctas.slice(0, 4).map((cta, index) => `${index + 1}. ${compactText(cta, 180)}`);
  const citationLines = citations.map(
    (item, index) => `${index + 1}. ${item.label}${item.url ? ` (${item.url})` : ""}`
  );

  return {
    content: [
      "Use this Viral Studio generation pack as high-priority execution context.",
      "",
      `Format target: ${toGenerationFormatLabel(generation.formatTarget)}`,
      `Objective: ${generation.promptContext.objective}`,
      `Voice profile: ${generation.promptContext.voiceProfile.join(", ")}`,
      "",
      "Hooks:",
      ...(hookLines.length ? hookLines : ["- none"]),
      "",
      "Short script:",
      compactText(generation.outputs.scripts.short, 400),
      "",
      "Captions:",
      ...(captionLines.length ? captionLines : ["- none"]),
      "",
      "CTAs:",
      ...(ctaLines.length ? ctaLines : ["- none"]),
      "",
      "Citations:",
      ...(citationLines.length ? citationLines : ["- none"]),
      "",
      "Task: turn this pack into an execution plan with channel-by-channel actions, sequencing, and measurable checkpoints aligned to workspace strategy.",
    ].join("\n"),
    blocksJson: {
      type: "viral_studio_context",
      contextKind: "generation_pack",
      objective: "Transform generation outputs into a tactical launch plan grounded in selected references.",
      summary: `Generation revision ${generation.revision} (${toGenerationFormatLabel(generation.formatTarget)}) with ${generation.outputs.hooks.length} hooks, ${generation.outputs.captions.length} captions, and ${generation.outputs.ctas.length} CTAs.`,
      cards: source.slice(0, 6).map((item, index) => ({
        id: item.id,
        title: compactText(item.ranking.rationaleTitle, 130) || `Reference ${index + 1}`,
        subtitle: compactText(item.caption || item.transcriptSummary || "", 130),
        sourcePlatform: item.sourcePlatform,
        sourceUrl: sanitizeHttpUrl(item.sourceUrl),
        score: Number(item.scores.composite.toFixed(4)),
        notes: item.ranking.rationaleBullets.slice(0, 2).map((bullet) => compactText(bullet, 140)),
      })),
      citations,
    },
    citationsJson: citations,
    libraryRefs,
  };
}

function buildFormatGenerationChatBridgePayload(
  generation: ViralStudioFormatGenerationJob,
  references: ViralStudioReferenceAsset[]
): ViralStudioChatBridgePayload {
  const referenceById = new Map(references.map((item) => [item.id, item]));
  const source = generation.result.sourceReferenceIds
    .map((id) => referenceById.get(id))
    .filter((item): item is ViralStudioReferenceAsset => Boolean(item));
  const citations = buildViralStudioCitations(source);
  const libraryRefs = citations
    .map((item) => String(item.libraryRef || "").trim())
    .filter(Boolean)
    .slice(0, 20);
  return {
    content: [
      "Use this staged Viral Studio format plan as high-priority execution context.",
      "",
      `Format: ${toContentTypeLabel(generation.contentType)}`,
      `Design direction: ${generation.result.designDetails.typographyTreatment}`,
      `Summary: ${generation.result.summary}`,
      "",
      "Design details:",
      ...generation.result.designDetails.layoutStructure.map((line) => `- ${line}`),
      "",
      "Content details:",
      `Hook: ${generation.result.contentDetails.hook}`,
      ...generation.result.contentDetails.narrativeBeats.map((line) => `- ${line}`),
      generation.result.contentDetails.proofPlacement,
      generation.result.contentDetails.cta,
    ].join("\n"),
    blocksJson: {
      kind: "viral_studio_format_generation",
      generationId: generation.id,
      contentType: generation.contentType,
      designDetails: generation.result.designDetails,
      contentDetails: generation.result.contentDetails,
      citations,
    },
    citationsJson: citations,
    libraryRefs,
  };
}

function isStepValid(step: 1 | 2 | 3 | 4, form: BrandFormState): boolean {
  if (step === 1) {
    return Boolean(form.mission && form.valueProposition && form.productOrService && form.region);
  }
  if (step === 2) {
    return csvToArray(form.audiencePersonas).length > 0 && (csvToArray(form.pains).length > 0 || csvToArray(form.desires).length > 0);
  }
  if (step === 3) {
    return csvToArray(form.bannedPhrases).length > 0 || csvToArray(form.requiredClaims).length > 0;
  }
  return csvToArray(form.exemplars).length > 0 && Boolean(form.summary.trim());
}

function onboardingCoveragePercent(form: BrandFormState): number {
  const requiredFields = [
    form.mission,
    form.valueProposition,
    form.productOrService,
    form.region,
    form.audiencePersonas,
    form.pains,
    form.desires,
    form.objections,
    form.bannedPhrases,
    form.requiredClaims,
    form.exemplars,
    form.summary,
  ];
  const filledRequired = requiredFields.filter((value) => String(value || "").trim().length > 0).length;
  const sliderSignals = [form.voiceBold, form.voiceFormal, form.voicePlayful, form.voiceDirect].filter(
    (value) => Number(value) > 0
  ).length;
  const totalSignals = requiredFields.length + 4;
  const currentSignals = filledRequired + sliderSignals;
  return Math.round((currentSignals / totalSignals) * 100);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function detailCardClassName(card: StudioDetailCard): string {
  return ["vbs-detail-card", card.tone ? `is-${card.tone}` : ""].filter(Boolean).join(" ");
}

function defaultReferencePalette(platform: ViralStudioPlatform): string[] {
  if (platform === "instagram") {
    return ["#1d4ed8", "#0f766e", "#93c5fd"];
  }
  if (platform === "tiktok") {
    return ["#0f172a", "#0f766e", "#67e8f9"];
  }
  return ["#1e3a8a", "#475569", "#cbd5f5"];
}

function toReferenceBestUse(reference: ViralStudioReferenceAsset): string {
  if (reference.shortlistState === "must-use") return "Anchor the pack around this angle.";
  if (reference.shortlistState === "pin") return "Use this as a supporting proof point.";
  if (reference.shortlistState === "exclude") return "Keep it out of the influence set.";
  const leadDriver = String(reference.explainability.topDrivers[0] || "").toLowerCase();
  if (leadDriver.includes("hook")) return "Borrow the opening angle or first line energy.";
  if (leadDriver.includes("retention")) return "Study pacing and mid-script structure.";
  if (leadDriver.includes("caption")) return "Use this for caption framing and clarity.";
  if (leadDriver.includes("recency")) return "Use this as a timely market signal.";
  return "Use this for proof, framing, or market positioning.";
}

function buildReferenceCardDetail(reference: ViralStudioReferenceAsset): ReferenceCardDetail {
  const contributionRows = Object.entries(reference.explainability.weightedContributions)
    .map(([key, value]) => ({
      key: key as keyof ViralStudioReferenceAsset["explainability"]["weightedContributions"],
      value: Number(value),
    }))
    .sort((a, b) => b.value - a.value);
  const interactionRate =
    (reference.metrics.likes + reference.metrics.comments + reference.metrics.shares) /
    Math.max(1, reference.metrics.views);
  const palette = reference.visual?.palette?.filter(Boolean).slice(0, 3) || defaultReferencePalette(reference.sourcePlatform);
  while (palette.length < 3) palette.push(palette[palette.length - 1] || "#cbd5f5");
  return {
    eyebrow: reference.visual?.eyebrow || `${toPlatformLabel(reference.sourcePlatform)} winner`,
    headline:
      compactText(reference.visual?.headline || reference.ranking.rationaleTitle || reference.caption || "Reference asset", 84) ||
      "Reference asset",
    footer: compactText(
      reference.visual?.footer ||
        reference.explainability.topDrivers[0] ||
        reference.ranking.rationaleBullets[0] ||
        reference.transcriptSummary ||
        "No summary available yet.",
      120
    ),
    bestUse: toReferenceBestUse(reference),
    interactionRate,
    ageDays: daysSinceIso(reference.metrics.postedAt),
    primaryContributionLabel: contributionLabel(contributionRows[0]?.key || "engagementRate"),
    primaryContributionValue: Number(contributionRows[0]?.value || 0),
    secondaryContributionLabel: contributionRows[1] ? contributionLabel(contributionRows[1].key) : undefined,
    secondaryContributionValue: contributionRows[1] ? Number(contributionRows[1].value) : undefined,
    bullets: (reference.explainability.whyRankedHigh.length
      ? reference.explainability.whyRankedHigh
      : reference.ranking.rationaleBullets
    )
      .slice(0, 2)
      .map((line) => compactText(line, 120)),
    palette,
    mediaUrl: sanitizeHttpUrl(reference.visual?.posterUrl || reference.visual?.thumbnailUrl || ""),
  };
}

export function ViralBrandStudioShell({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [canAccessDiagnostics, setCanAccessDiagnostics] = useState(false);

  const [contracts, setContracts] = useState<ViralStudioContractSnapshot | null>(null);
  const [telemetry, setTelemetry] = useState<ViralStudioTelemetrySnapshot | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<ViralStudioPromptTemplate[]>([]);
  const [brandProfile, setBrandProfile] = useState<BrandDNAProfile | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<ViralStudioWorkflowStatus | null>(null);
  const [autofillPreview, setAutofillPreview] = useState<ViralStudioBrandDnaAutofillPreview | null>(null);
  const [autofillSelection, setAutofillSelection] = useState<Partial<Record<ViralStudioAutofillFieldKey, boolean>>>({});
  const [suggestedSources, setSuggestedSources] = useState<ViralStudioSuggestedSource[]>([]);
  const [autofillBusy, setAutofillBusy] = useState(false);
  const [brandForm, setBrandForm] = useState<BrandFormState>({ ...DEFAULT_FORM_STATE });
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 3 | 4>(1);
  const [isEditingBrandDna, setIsEditingBrandDna] = useState(false);

  const [ingestions, setIngestions] = useState<ViralStudioIngestionRun[]>([]);
  const [activeIngestion, setActiveIngestion] = useState<ViralStudioIngestionRun | null>(null);
  const [references, setReferences] = useState<ViralStudioReferenceAsset[]>([]);
  const [generation, setGeneration] = useState<ViralStudioGenerationPack | null>(null);
  const [plannerSession, setPlannerSession] = useState<ViralStudioPlannerSession | null>(null);
  const [designDirections, setDesignDirections] = useState<ViralStudioDesignDirectionCandidate[]>([]);
  const [approvedDesignDirection, setApprovedDesignDirection] =
    useState<ViralStudioApprovedDesignDirection | null>(null);
  const [contentDirections, setContentDirections] = useState<ViralStudioContentDirectionCandidate[]>([]);
  const [approvedContentDirection, setApprovedContentDirection] =
    useState<ViralStudioApprovedContentDirection | null>(null);
  const [formatGeneration, setFormatGeneration] = useState<ViralStudioFormatGenerationJob | null>(null);
  const [selectedPlannerContentType, setSelectedPlannerContentType] =
    useState<ViralStudioContentType>("short_video");
  const [plannerCompareIds, setPlannerCompareIds] = useState<string[]>([]);
  const [document, setDocument] = useState<ViralStudioDocument | null>(null);
  const [documentDraft, setDocumentDraft] = useState<ViralStudioDocument | null>(null);
  const [documentDirty, setDocumentDirty] = useState(false);
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [versions, setVersions] = useState<ViralStudioDocumentVersion[]>([]);
  const [compareLeftVersionId, setCompareLeftVersionId] = useState<string>("current");
  const [compareRightVersionId, setCompareRightVersionId] = useState<string>("current");
  const [comparison, setComparison] = useState<ViralStudioDocumentVersionComparison | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [promoteVersionId, setPromoteVersionId] = useState<string>("");
  const [lastExport, setLastExport] = useState<{ format: string; content: string } | null>(null);
  const [chatBridgeStatus, setChatBridgeStatus] = useState<string | null>(null);
  const [autopilotBusy, setAutopilotBusy] = useState(false);
  const [autopilotStatus, setAutopilotStatus] = useState<string | null>(null);
  const [generationSaveStatus, setGenerationSaveStatus] = useState<string | null>(null);
  const autopilotTriggerRef = useRef<string>("");
  const generationSnapshotKeysRef = useRef<Set<string>>(new Set());
  const generationSnapshotBusyRef = useRef(false);

  const [sourcePlatform, setSourcePlatform] = useState<ViralStudioPlatform>("instagram");
  const [sourceUrl, setSourceUrl] = useState("");
  const [ingestionPreset, setIngestionPreset] = useState<IngestionPreset>("data-max");
  const [maxVideos, setMaxVideos] = useState(120);
  const [lookbackDays, setLookbackDays] = useState(365);
  const [showExtractionModal, setShowExtractionModal] = useState(false);
  const [promptText, setPromptText] = useState(
    "Generate a campaign-ready multi-pack with aggressive hooks, proof-backed scripts, and direct CTAs."
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("full-script");
  const [generationFormatTarget, setGenerationFormatTarget] =
    useState<ViralStudioGenerationFormatTarget>("reel-30");
  const [sectionInstructions, setSectionInstructions] =
    useState<Record<ViralStudioGenerationSection, string>>(defaultSectionInstructions);
  const [activePromptSection, setActivePromptSection] =
    useState<ViralStudioGenerationSection>("hooks");
  const [promptActionSection, setPromptActionSection] = useState<ViralStudioGenerationSection | null>(null);
  const [referenceViewMode, setReferenceViewMode] = useState<"grid" | "list">("grid");
  const [referenceFilter, setReferenceFilter] = useState<"all" | "prioritized" | "must-use" | "pin" | "exclude">("all");
  const [referencePlatformFilter, setReferencePlatformFilter] = useState<"all" | ViralStudioPlatform>("all");
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [shortlistPendingById, setShortlistPendingById] = useState<Record<string, ReferenceShortlistAction | undefined>>({});
  const [recentShortlistReferenceId, setRecentShortlistReferenceId] = useState<string | null>(null);
  const [curationNotice, setCurationNotice] = useState<string | null>(null);

  const brandReady = Boolean(brandProfile?.status === "final" && brandProfile?.completeness.ready);
  const onboardingLocked = !brandReady || isEditingBrandDna;
  const autopilotQuery = searchParams.get("autopilot");
  const diagnosticsQuery = searchParams.get("devtools");

  useEffect(() => {
    const hostname = typeof window !== "undefined" ? window.location.hostname : "";
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    if (isLocalHost || diagnosticsQuery === "1") {
      setCanAccessDiagnostics(true);
      return;
    }
    void getPortalMe()
      .then((payload) => {
        setCanAccessDiagnostics(Boolean(payload.user.isAdmin));
      })
      .catch(() => {
        setCanAccessDiagnostics(false);
      });
  }, [diagnosticsQuery]);

  const refreshTelemetry = useCallback(async () => {
    try {
      const payload = await fetchViralStudioTelemetry(workspaceId);
      setTelemetry(payload.telemetry);
    } catch {
      // Keep last telemetry snapshot if refresh fails.
    }
  }, [workspaceId]);

  const hydrateLatestDocument = useCallback(
    async (workflow: ViralStudioWorkflowStatus) => {
      const latestDocumentId = workflow.latest.documentId;
      if (!latestDocumentId) return;
      if (document?.id === latestDocumentId) return;
      try {
        const payload = await fetchViralStudioDocument(workspaceId, latestDocumentId);
        setDocument(payload.document);
        setDocumentDraft(payload.document);
        setDocumentDirty(false);
        setAutosaveState("saved");
        setVersions(payload.versions);
        setComparison(null);
        setCompareLeftVersionId("current");
        setCompareRightVersionId("current");
        setPromoteVersionId(payload.versions[payload.versions.length - 1]?.id || "");
      } catch {
        // Keep prior document state if document hydration fails during workflow refresh.
      }
    },
    [workspaceId, document?.id]
  );

  const refreshWorkflow = useCallback(async () => {
    try {
      const [workflowPayload, sourcesPayload] = await Promise.all([
        fetchViralStudioWorkflowStatus(workspaceId),
        fetchViralStudioSuggestedSources(workspaceId),
      ]);
      setWorkflowStatus(workflowPayload.workflow);
      setSuggestedSources(sourcesPayload.items);
      await hydrateLatestDocument(workflowPayload.workflow);
    } catch {
      // Keep prior workflow snapshot when refresh fails.
    }
  }, [workspaceId, hydrateLatestDocument]);

  const refreshPlanner = useCallback(async () => {
    try {
      const [designPayload, contentPayload] = await Promise.all([
        fetchViralStudioDesignDirections(workspaceId),
        fetchViralStudioContentDirections(workspaceId),
      ]);
      setPlannerSession(designPayload.session);
      setDesignDirections(designPayload.candidates);
      setApprovedDesignDirection(designPayload.approved);
      setContentDirections(contentPayload.candidates);
      setApprovedContentDirection(contentPayload.approved);
      setSelectedPlannerContentType(designPayload.session.selectedContentType || "short_video");
      if (designPayload.session.latestFormatGenerationId) {
        const formatPayload = await fetchViralStudioFormatGeneration(
          workspaceId,
          designPayload.session.latestFormatGenerationId
        ).catch(() => null);
        setFormatGeneration(formatPayload?.generation || null);
      } else {
        setFormatGeneration(null);
      }
    } catch {
      // Keep prior staged planner snapshot when refresh fails.
    }
  }, [workspaceId]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        brandPayload,
        contractPayload,
        telemetryPayload,
        ingestionPayload,
        referencePayload,
        workflowPayload,
        sourcePayload,
        designPayload,
        contentPayload,
      ] = await Promise.all([
        fetchWorkspaceBrandDna(workspaceId),
        fetchViralStudioContracts(workspaceId),
        fetchViralStudioTelemetry(workspaceId),
        listViralStudioIngestions(workspaceId),
        listViralStudioReferences(workspaceId),
        fetchViralStudioWorkflowStatus(workspaceId),
        fetchViralStudioSuggestedSources(workspaceId),
        fetchViralStudioDesignDirections(workspaceId),
        fetchViralStudioContentDirections(workspaceId),
      ]);
      setBrandProfile(brandPayload.profile);
      setBrandForm(toFormState(brandPayload.profile));
      setContracts(contractPayload.contract);
      setTelemetry(telemetryPayload.telemetry);
      setPromptTemplates(contractPayload.promptTemplates || []);
      setIngestions(ingestionPayload.runs);
      setActiveIngestion(ingestionPayload.runs[0] || null);
      setReferences(referencePayload.items);
      setWorkflowStatus(workflowPayload.workflow);
      setSuggestedSources(sourcePayload.items);
      setPlannerSession(designPayload.session);
      setDesignDirections(designPayload.candidates);
      setApprovedDesignDirection(designPayload.approved);
      setContentDirections(contentPayload.candidates);
      setApprovedContentDirection(contentPayload.approved);
      setSelectedPlannerContentType(designPayload.session.selectedContentType || "short_video");
      setPlannerCompareIds([]);
      if (designPayload.session.latestFormatGenerationId) {
        try {
          const formatPayload = await fetchViralStudioFormatGeneration(
            workspaceId,
            designPayload.session.latestFormatGenerationId
          );
          setFormatGeneration(formatPayload.generation);
        } catch {
          setFormatGeneration(null);
        }
      } else {
        setFormatGeneration(null);
      }
      await hydrateLatestDocument(workflowPayload.workflow);
      if (brandPayload.profile?.status === "final" && brandPayload.profile?.completeness.ready) {
        setOnboardingStep(4);
      }
    } catch (bootstrapError: unknown) {
      setError(String((bootstrapError as Error)?.message || "Failed to initialize Viral Brand Studio"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, hydrateLatestDocument]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void Promise.all([refreshTelemetry(), refreshWorkflow(), refreshPlanner()]);
    }, 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshPlanner, refreshTelemetry, refreshWorkflow]);

  useEffect(() => {
    if (!promptTemplates.length) return;
    if (promptTemplates.some((template) => template.id === selectedTemplateId)) return;
    setSelectedTemplateId(promptTemplates[0].id);
  }, [promptTemplates, selectedTemplateId]);

  useEffect(() => {
    if (!activeIngestion) return;
    if (isTerminalIngestionStatus(activeIngestion.status)) {
      return;
    }
    const poller = window.setInterval(() => {
      void fetchViralStudioIngestion(workspaceId, activeIngestion.id)
        .then((payload) => {
          setActiveIngestion(payload.run);
          setIngestions((previous) => {
            const next = previous.filter((row) => row.id !== payload.run.id);
            return [payload.run, ...next];
          });
          if (payload.run.status === "completed" || payload.run.status === "partial") {
            void listViralStudioReferences(workspaceId, { ingestionRunId: payload.run.id }).then((referencePayload) => {
              setReferences(referencePayload.items);
              void Promise.all([refreshTelemetry(), refreshWorkflow()]);
            });
          }
        })
        .catch(() => undefined);
    }, 900);
    return () => {
      window.clearInterval(poller);
    };
  }, [workspaceId, activeIngestion, refreshTelemetry, refreshWorkflow]);

  useEffect(() => {
    if (!showExtractionModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowExtractionModal(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showExtractionModal]);

  useEffect(() => {
    if (sourceUrl.trim()) return;
    const primary = suggestedSources[0];
    if (!primary) return;
    setSourcePlatform(primary.platform);
    setSourceUrl(primary.sourceUrl);
  }, [suggestedSources, sourceUrl]);

  const selectedReferenceIds = useMemo(() => {
    const prioritized = references.filter((item) => item.shortlistState === "must-use" || item.shortlistState === "pin");
    if (prioritized.length > 0) return prioritized.map((item) => item.id);
    return references
      .filter((item) => item.shortlistState !== "exclude")
      .slice(0, 5)
      .map((item) => item.id);
  }, [references]);

  const ingestionTimeline = useMemo(() => {
    if (!activeIngestion) {
      return [
        { key: "found", label: "Found", value: 0 },
        { key: "downloaded", label: "Downloaded", value: 0 },
        { key: "analyzed", label: "Analyzed", value: 0 },
        { key: "ranked", label: "Ranked", value: 0 },
      ];
    }
    return [
      { key: "found", label: "Found", value: activeIngestion.progress.found },
      { key: "downloaded", label: "Downloaded", value: activeIngestion.progress.downloaded },
      { key: "analyzed", label: "Analyzed", value: activeIngestion.progress.analyzed },
      { key: "ranked", label: "Ranked", value: activeIngestion.progress.ranked },
    ];
  }, [activeIngestion]);

  const filteredReferences = useMemo(() => {
    let next = references;
    if (referenceFilter === "prioritized") {
      next = next.filter((item) => item.shortlistState === "must-use" || item.shortlistState === "pin");
    } else if (referenceFilter !== "all") {
      next = next.filter((item) => item.shortlistState === referenceFilter);
    }
    if (referencePlatformFilter !== "all") {
      next = next.filter((item) => item.sourcePlatform === referencePlatformFilter);
    }
    return next.slice(0, 24);
  }, [references, referenceFilter, referencePlatformFilter]);

  const referenceCounts = useMemo(() => {
    const prioritizedCount = references.filter(
      (item) => item.shortlistState === "must-use" || item.shortlistState === "pin"
    ).length;
    return {
      all: references.length,
      prioritized: prioritizedCount,
      "must-use": references.filter((item) => item.shortlistState === "must-use").length,
      pin: references.filter((item) => item.shortlistState === "pin").length,
      exclude: references.filter((item) => item.shortlistState === "exclude").length,
    };
  }, [references]);

  useEffect(() => {
    if (filteredReferences.length === 0) {
      setSelectedReferenceId(null);
      return;
    }
    if (!selectedReferenceId || !filteredReferences.some((item) => item.id === selectedReferenceId)) {
      setSelectedReferenceId(filteredReferences[0].id);
    }
  }, [filteredReferences, selectedReferenceId]);

  useEffect(() => {
    if (!curationNotice) return;
    const timer = window.setTimeout(() => {
      setCurationNotice(null);
    }, 2600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [curationNotice]);

  useEffect(() => {
    if (!recentShortlistReferenceId) return;
    const timer = window.setTimeout(() => {
      setRecentShortlistReferenceId(null);
    }, 900);
    return () => {
      window.clearTimeout(timer);
    };
  }, [recentShortlistReferenceId]);

  const selectedReference = useMemo(() => {
    if (!selectedReferenceId) return filteredReferences[0] || null;
    return (
      filteredReferences.find((item) => item.id === selectedReferenceId) ||
      references.find((item) => item.id === selectedReferenceId) ||
      filteredReferences[0] ||
      null
    );
  }, [filteredReferences, references, selectedReferenceId]);

  const selectedReferenceInsights = useMemo(() => {
    if (!selectedReference) return null;
    const board = filteredReferences.length > 0 ? filteredReferences : references;
    const boardSize = board.length || 1;
    const avgComposite =
      board.reduce((sum, item) => sum + Number(item.scores.composite || 0), 0) / boardSize;
    const compositeDelta = Number(selectedReference.scores.composite || 0) - avgComposite;
    const interactionRateRaw =
      (selectedReference.metrics.likes + selectedReference.metrics.comments + selectedReference.metrics.shares) /
      Math.max(1, selectedReference.metrics.views);
    const contributionRows = Object.entries(selectedReference.explainability.weightedContributions)
      .map(([key, value]) => ({
        key: key as keyof ViralStudioReferenceAsset["explainability"]["weightedContributions"],
        value: Number(value),
      }))
      .sort((a, b) => b.value - a.value);
    const normalizedRows = Object.entries(selectedReference.normalizedMetrics).map(([key, value]) => ({
      key: key as keyof ViralStudioReferenceAsset["normalizedMetrics"],
      value: Number(value),
    }));
    return {
      avgComposite,
      compositeDelta,
      interactionRateRaw,
      contributionRows,
      normalizedRows,
      postedAgeDays: daysSinceIso(selectedReference.metrics.postedAt),
    };
  }, [selectedReference, filteredReferences, references]);

  const selectedTemplate = useMemo(() => {
    return promptTemplates.find((template) => template.id === selectedTemplateId) || promptTemplates[0] || null;
  }, [promptTemplates, selectedTemplateId]);

  const comparedDesignDirections = useMemo(() => {
    return plannerCompareIds
      .map((id) => designDirections.find((item) => item.id === id) || null)
      .filter(Boolean) as ViralStudioDesignDirectionCandidate[];
  }, [designDirections, plannerCompareIds]);

  const latestPlannerReferenceCards = useMemo(() => {
    const ids = formatGeneration?.result.sourceReferenceIds || approvedDesignDirection?.sourceReferenceIds || [];
    const map = new Map(references.map((item) => [item.id, item]));
    return ids.map((id) => map.get(id)).filter(Boolean) as ViralStudioReferenceAsset[];
  }, [approvedDesignDirection?.sourceReferenceIds, formatGeneration?.result.sourceReferenceIds, references]);

  const prioritizedReferenceCount = useMemo(() => {
    return references.filter((item) => item.shortlistState === "must-use" || item.shortlistState === "pin").length;
  }, [references]);

  const qualitySignals = useMemo(() => {
    if (!generation) return [];
    const signals: string[] = [];
    if (generation.qualityCheck.bannedTermHits.length > 0) {
      signals.push(`Banned terms: ${generation.qualityCheck.bannedTermHits.join(", ")}`);
    }
    if (generation.qualityCheck.toneMismatch) {
      signals.push("Tone mismatch detected against high-formality voice settings.");
    }
    if (generation.qualityCheck.duplicates.length > 0) {
      signals.push(`Duplicate variants: ${generation.qualityCheck.duplicates.length}`);
    }
    if (generation.qualityCheck.lengthWarnings.length > 0) {
      signals.push(...generation.qualityCheck.lengthWarnings);
    }
    return signals;
  }, [generation]);

  const versionOptions = useMemo(() => {
    const base = [{ id: "current", label: "Current Draft" }];
    const timeline = [...versions]
      .reverse()
      .map((version) => ({
        id: version.id,
        label: `${version.summary || "Snapshot"} • ${new Date(version.createdAt).toLocaleString()}`,
    }));
    return [...base, ...timeline];
  }, [versions]);

  const orderedAutofillFields = useMemo(() => {
    if (!autofillPreview) return [] as ViralStudioAutofillFieldKey[];
    const allowed = new Set(autofillPreview.suggestedFields);
    return AUTOFILL_FIELD_ORDER.filter((field) => allowed.has(field));
  }, [autofillPreview]);

  const selectedAutofillCount = useMemo(() => {
    if (!autofillPreview) return 0;
    return autofillPreview.suggestedFields.filter((field) => autofillSelection[field] !== false).length;
  }, [autofillPreview, autofillSelection]);

  const saveBrandDna = useCallback(
    async (mode: "draft" | "final") => {
      setIsBusy(true);
      setError(null);
      try {
        const payload = {
          status: mode,
          mission: brandForm.mission,
          valueProposition: brandForm.valueProposition,
          productOrService: brandForm.productOrService,
          region: brandForm.region,
          audiencePersonas: csvToArray(brandForm.audiencePersonas),
          pains: csvToArray(brandForm.pains),
          desires: csvToArray(brandForm.desires),
          objections: csvToArray(brandForm.objections),
          bannedPhrases: csvToArray(brandForm.bannedPhrases),
          requiredClaims: csvToArray(brandForm.requiredClaims),
          exemplars: csvToArray(brandForm.exemplars),
          summary: brandForm.summary,
          voiceSliders: {
            bold: brandForm.voiceBold,
            formal: brandForm.voiceFormal,
            playful: brandForm.voicePlayful,
            direct: brandForm.voiceDirect,
          },
        };
        const response = brandProfile
          ? await patchWorkspaceBrandDna(workspaceId, payload)
          : await createWorkspaceBrandDna(workspaceId, payload);
        setBrandProfile(response.profile);
        setBrandForm(toFormState(response.profile));
        if (response.profile.status === "final" && response.profile.completeness.ready) {
          setIsEditingBrandDna(false);
          setOnboardingStep(4);
        }
        void Promise.all([refreshTelemetry(), refreshWorkflow()]);
      } catch (saveError: unknown) {
        setError(String((saveError as Error)?.message || "Failed to save Brand DNA"));
      } finally {
        setIsBusy(false);
      }
    },
    [workspaceId, brandForm, brandProfile, refreshTelemetry, refreshWorkflow]
  );

  const generateSummary = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const payload = await generateWorkspaceBrandDnaSummary(workspaceId, {
        mission: brandForm.mission,
        valueProposition: brandForm.valueProposition,
        productOrService: brandForm.productOrService,
        region: brandForm.region,
        audiencePersonas: csvToArray(brandForm.audiencePersonas),
        pains: csvToArray(brandForm.pains),
        desires: csvToArray(brandForm.desires),
        voiceSliders: {
          bold: brandForm.voiceBold,
          formal: brandForm.voiceFormal,
          playful: brandForm.voicePlayful,
          direct: brandForm.voiceDirect,
        },
      });
      setBrandForm((previous) => ({ ...previous, summary: payload.summary.summary }));
    } catch (summaryError: unknown) {
      setError(String((summaryError as Error)?.message || "Failed to generate summary"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, brandForm]);

  const previewAutofill = useCallback(async () => {
    setAutofillBusy(true);
    setError(null);
    try {
      const payload = await previewWorkspaceBrandDnaAutofill(workspaceId);
      setAutofillPreview(payload.preview);
      setAutofillSelection(createAutofillSelection(payload.preview));
      await refreshWorkflow();
    } catch (previewError: unknown) {
      setError(String((previewError as Error)?.message || "Failed to generate autofill preview"));
    } finally {
      setAutofillBusy(false);
    }
  }, [workspaceId, refreshWorkflow]);

  const toggleAutofillField = useCallback((field: ViralStudioAutofillFieldKey) => {
    setAutofillSelection((previous) => ({ ...previous, [field]: !(previous[field] !== false) }));
  }, []);

  const applyAutofill = useCallback(async () => {
    setAutofillBusy(true);
    setError(null);
    try {
      const selectedFields = (autofillPreview?.suggestedFields || []).filter(
        (field) => autofillSelection[field] !== false
      );
      const payload = await applyWorkspaceBrandDnaAutofill(workspaceId, {
        selectedFields,
        finalizeIfReady: true,
      });
      setBrandProfile(payload.profile);
      setBrandForm(toFormState(payload.profile));
      setAutofillPreview(payload.preview);
      setAutofillSelection(createAutofillSelection(payload.preview));
      if (payload.profile.status === "final" && payload.profile.completeness.ready) {
        setOnboardingStep(4);
        setIsEditingBrandDna(false);
      }
      await Promise.all([refreshWorkflow(), refreshTelemetry()]);
    } catch (applyError: unknown) {
      setError(String((applyError as Error)?.message || "Failed to apply autofill suggestions"));
    } finally {
      setAutofillBusy(false);
    }
  }, [workspaceId, autofillPreview, autofillSelection, refreshTelemetry, refreshWorkflow]);

  useEffect(() => {
    if (brandReady) return;
    if (autofillPreview || autofillBusy) return;
    const stage = workflowStatus?.workflowStage;
    if (stage !== "studio_autofill_review" && stage !== "intake_complete") return;
    void previewAutofill();
  }, [brandReady, autofillBusy, autofillPreview, previewAutofill, workflowStatus?.workflowStage]);

  const runExtraction = useCallback(async () => {
    if (!brandReady) return;
    setIsBusy(true);
    setError(null);
    try {
      const payload = await createViralStudioIngestion(workspaceId, {
        sourcePlatform,
        sourceUrl,
        maxVideos,
        lookbackDays,
        sortBy: "engagement",
        preset: ingestionPreset,
      });
      setShowExtractionModal(false);
      setActiveIngestion(payload.run);
      setIngestions((previous) => [payload.run, ...previous.filter((row) => row.id !== payload.run.id)]);
      void Promise.all([refreshTelemetry(), refreshWorkflow()]);
    } catch (runError: unknown) {
      setError(String((runError as Error)?.message || "Failed to start extraction"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, sourcePlatform, sourceUrl, maxVideos, lookbackDays, ingestionPreset, brandReady, refreshTelemetry, refreshWorkflow]);

  const applyIngestionPreset = useCallback((preset: IngestionPreset) => {
    setIngestionPreset(preset);
    const defaults = presetDefaults(preset);
    setMaxVideos(defaults.maxVideos);
    setLookbackDays(defaults.lookbackDays);
  }, []);

  const selectSuggestedSource = useCallback(
    (source: ViralStudioSuggestedSource) => {
      setSourcePlatform(source.platform);
      setSourceUrl(source.sourceUrl);
      applyIngestionPreset("data-max");
      setShowExtractionModal(true);
    },
    [applyIngestionPreset]
  );

  const openIngestionResults = useCallback(
    async (run: ViralStudioIngestionRun) => {
      setActiveIngestion(run);
      if (run.status === "completed" || run.status === "partial") {
        try {
          const payload = await listViralStudioReferences(workspaceId, { ingestionRunId: run.id });
          setReferences(payload.items);
          void Promise.all([refreshTelemetry(), refreshWorkflow()]);
        } catch {
          // Keep current list if refresh fails.
        }
      }
    },
    [workspaceId, refreshTelemetry, refreshWorkflow]
  );

  const retryExtraction = useCallback(
    async (runId: string) => {
      setIsBusy(true);
      setError(null);
      try {
        const payload = await retryViralStudioIngestion(workspaceId, runId);
        setActiveIngestion(payload.run);
        setIngestions((previous) => [payload.run, ...previous.filter((row) => row.id !== payload.run.id)]);
        void Promise.all([refreshTelemetry(), refreshWorkflow()]);
      } catch (retryError: unknown) {
        setError(String((retryError as Error)?.message || "Failed to retry extraction"));
      } finally {
        setIsBusy(false);
      }
    },
    [workspaceId, refreshTelemetry, refreshWorkflow]
  );

  const shortlistReference = useCallback(
    async (referenceId: string, action: ReferenceShortlistAction) => {
      setError(null);
      setShortlistPendingById((previous) => ({ ...previous, [referenceId]: action }));
      try {
        const payload = await updateViralStudioReferenceShortlist(workspaceId, { referenceId, action });
        setReferences((previous) => previous.map((item) => (item.id === payload.item.id ? payload.item : item)));
        setRecentShortlistReferenceId(payload.item.id);
        setCurationNotice(
          action === "clear"
            ? `Reference #${payload.item.ranking.rank} cleared from shortlist.`
            : `Reference #${payload.item.ranking.rank} moved to ${shortlistLabel(payload.item.shortlistState)}.`
        );
        void Promise.all([refreshTelemetry(), refreshWorkflow()]);
      } catch (shortlistError: unknown) {
        setError(String((shortlistError as Error)?.message || "Failed to update shortlist"));
      } finally {
        setShortlistPendingById((previous) => {
          const next = { ...previous };
          delete next[referenceId];
          return next;
        });
      }
    },
    [workspaceId, refreshTelemetry, refreshWorkflow]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!selectedReferenceId) return;
      if (shortlistPendingById[selectedReferenceId]) return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        const isTypingTarget =
          tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
        if (isTypingTarget) return;
      }
      if (event.key === "1") {
        event.preventDefault();
        void shortlistReference(selectedReferenceId, "pin");
      } else if (event.key === "2") {
        event.preventDefault();
        void shortlistReference(selectedReferenceId, "must-use");
      } else if (event.key === "3") {
        event.preventDefault();
        void shortlistReference(selectedReferenceId, "exclude");
      } else if (event.key === "0") {
        event.preventDefault();
        void shortlistReference(selectedReferenceId, "clear");
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [selectedReferenceId, shortlistReference, shortlistPendingById]);

  const runDesignAnalysis = useCallback(async () => {
    if (!brandReady) return;
    setIsBusy(true);
    setError(null);
    try {
      const payload = await analyzeViralStudioDesignDirections(workspaceId);
      setPlannerSession(payload.session);
      setDesignDirections(payload.candidates);
      setApprovedDesignDirection(null);
      setContentDirections([]);
      setApprovedContentDirection(null);
      setFormatGeneration(null);
      setPlannerCompareIds([]);
      void Promise.all([refreshTelemetry(), refreshWorkflow()]);
    } catch (plannerError: unknown) {
      setError(String((plannerError as Error)?.message || "Failed to analyze design directions"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, brandReady, refreshTelemetry, refreshWorkflow]);

  const toggleDesignCompare = useCallback((directionId: string) => {
    setPlannerCompareIds((previous) => {
      if (previous.includes(directionId)) {
        return previous.filter((item) => item !== directionId);
      }
      if (previous.length >= 2) {
        return [...previous.slice(1), directionId];
      }
      return [...previous, directionId];
    });
  }, []);

  const approveDesignDirection = useCallback(
    async (directionId: string) => {
      setIsBusy(true);
      setError(null);
      try {
        const payload = await selectViralStudioDesignDirection(workspaceId, directionId);
        setPlannerSession(payload.session);
        setApprovedDesignDirection(payload.approved);
        setContentDirections([]);
        setApprovedContentDirection(null);
        setFormatGeneration(null);
        setPlannerCompareIds([]);
        await refreshPlanner();
        await Promise.all([refreshTelemetry(), refreshWorkflow()]);
      } catch (plannerError: unknown) {
        setError(String((plannerError as Error)?.message || "Failed to approve design direction"));
      } finally {
        setIsBusy(false);
      }
    },
    [workspaceId, refreshPlanner, refreshTelemetry, refreshWorkflow]
  );

  const runContentAnalysis = useCallback(async () => {
    if (!approvedDesignDirection) return;
    setIsBusy(true);
    setError(null);
    try {
      const payload = await analyzeViralStudioContentDirections(workspaceId);
      setPlannerSession(payload.session);
      setContentDirections(payload.candidates);
      setApprovedContentDirection(null);
      setFormatGeneration(null);
      void Promise.all([refreshTelemetry(), refreshWorkflow()]);
    } catch (plannerError: unknown) {
      setError(String((plannerError as Error)?.message || "Failed to analyze content directions"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, approvedDesignDirection, refreshTelemetry, refreshWorkflow]);

  const approveContentDirection = useCallback(
    async (directionId: string) => {
      setIsBusy(true);
      setError(null);
      try {
        const payload = await selectViralStudioContentDirection(workspaceId, directionId);
        setPlannerSession(payload.session);
        setApprovedDesignDirection(payload.approvedDesign);
        setApprovedContentDirection(payload.approved);
        setFormatGeneration(null);
        await refreshPlanner();
        await Promise.all([refreshTelemetry(), refreshWorkflow()]);
      } catch (plannerError: unknown) {
        setError(String((plannerError as Error)?.message || "Failed to approve content direction"));
      } finally {
        setIsBusy(false);
      }
    },
    [workspaceId, refreshPlanner, refreshTelemetry, refreshWorkflow]
  );

  const generatePlannerFormat = useCallback(async () => {
    if (!approvedDesignDirection || !approvedContentDirection) return;
    setIsBusy(true);
    setError(null);
    try {
      const payload = await createViralStudioFormatGeneration(workspaceId, {
        contentType: selectedPlannerContentType,
      });
      setPlannerSession(payload.session);
      setApprovedDesignDirection(payload.approvedDesign);
      setApprovedContentDirection(payload.approvedContent);
      setFormatGeneration(payload.generation);
      void Promise.all([refreshTelemetry(), refreshWorkflow()]);
    } catch (plannerError: unknown) {
      setError(String((plannerError as Error)?.message || "Failed to generate format details"));
    } finally {
      setIsBusy(false);
    }
  }, [
    workspaceId,
    approvedContentDirection,
    approvedDesignDirection,
    selectedPlannerContentType,
    refreshTelemetry,
    refreshWorkflow,
  ]);

  const generatePack = useCallback(async () => {
    if (!brandReady) return;
    setIsBusy(true);
    setError(null);
    try {
      const payload = await createViralStudioGeneration(workspaceId, {
        templateId: selectedTemplateId,
        prompt: promptText,
        selectedReferenceIds,
        formatTarget: generationFormatTarget,
      });
      setGeneration(payload.generation);
      setActivePromptSection("hooks");
      void Promise.all([refreshTelemetry(), refreshWorkflow()]);
    } catch (generationError: unknown) {
      setError(String((generationError as Error)?.message || "Failed to generate pack"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, selectedReferenceIds, promptText, brandReady, selectedTemplateId, generationFormatTarget, refreshTelemetry, refreshWorkflow]);

  const runPromptSectionAction = useCallback(
    async (section: ViralStudioGenerationSection, mode: "refine" | "regenerate") => {
      if (!generation) return;
      setIsBusy(true);
      setError(null);
      setPromptActionSection(section);
      try {
        const instruction = sectionInstructions[section]?.trim();
        const payload = await refineViralStudioGeneration(workspaceId, generation.id, {
          section,
          mode,
          ...(instruction ? { instruction } : {}),
        });
        setGeneration(payload.generation);
        setActivePromptSection(section);
        void Promise.all([refreshTelemetry(), refreshWorkflow()]);
      } catch (refineError: unknown) {
        setError(String((refineError as Error)?.message || "Failed to refine generation section"));
      } finally {
        setPromptActionSection(null);
        setIsBusy(false);
      }
    },
    [workspaceId, generation, sectionInstructions, refreshTelemetry, refreshWorkflow]
  );

  const updateSectionInstruction = useCallback(
    (section: ViralStudioGenerationSection, value: string) => {
      setSectionInstructions((previous) => ({ ...previous, [section]: value }));
    },
    []
  );

  const toDocumentPatchPayload = useCallback((draft: ViralStudioDocument) => {
    return {
      title: draft.title,
      sections: draft.sections.map((section) => ({
        id: section.id,
        title: section.title,
        kind: section.kind,
        content: section.content,
      })),
      orderedSectionIds: draft.sections.map((section) => section.id),
    };
  }, []);

  const persistDocumentDraft = useCallback(
    async (autosave: boolean) => {
      if (!documentDraft) return null;
      const payload = await patchViralStudioDocument(workspaceId, documentDraft.id, {
        ...toDocumentPatchPayload(documentDraft),
        autosave,
      });
      setDocument(payload.document);
      setDocumentDraft(payload.document);
      setDocumentDirty(false);
      setAutosaveState("saved");
      return payload.document;
    },
    [workspaceId, documentDraft, toDocumentPatchPayload]
  );

  const createDocumentFromGeneration = useCallback(async () => {
    if (!generation && !formatGeneration) return;
    setIsBusy(true);
    setError(null);
    try {
      const payload = await createViralStudioDocument(workspaceId, {
        ...(formatGeneration
          ? { formatGenerationId: formatGeneration.id }
          : { generationId: generation?.id || "" }),
        title: formatGeneration
          ? `${toContentTypeLabel(formatGeneration.contentType)} Plan`
          : "Campaign Pack - Plan 6",
      });
      const documentPayload = await fetchViralStudioDocument(workspaceId, payload.document.id);
      setDocument(documentPayload.document);
      setDocumentDraft(documentPayload.document);
      setDocumentDirty(false);
      setAutosaveState("saved");
      setVersions(documentPayload.versions);
      setComparison(null);
      setCompareLeftVersionId("current");
      setCompareRightVersionId("current");
      setPromoteVersionId(documentPayload.versions[documentPayload.versions.length - 1]?.id || "");
      void Promise.all([refreshTelemetry(), refreshWorkflow()]);
    } catch (documentError: unknown) {
      setError(String((documentError as Error)?.message || "Failed to create document"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, formatGeneration, generation, refreshTelemetry, refreshWorkflow]);

  const syncGenerationToVersionHistory = useCallback(
    async (nextGeneration: ViralStudioGenerationPack) => {
      const snapshotKey = `${nextGeneration.id}:${nextGeneration.revision}`;
      if (generationSnapshotKeysRef.current.has(snapshotKey)) return;
      if (generationSnapshotBusyRef.current) return;
      if (documentDirty) {
        setGenerationSaveStatus(
          "Auto-save paused because document edits are pending. Save draft to resume generation snapshots."
        );
        return;
      }
      generationSnapshotBusyRef.current = true;
      setGenerationSaveStatus(`Saving generation revision ${nextGeneration.revision}...`);
      try {
        let workingDocument = document;
        let initialVersions: ViralStudioDocumentVersion[] = versions;
        if (!workingDocument) {
          const created = await createViralStudioDocument(workspaceId, {
            generationId: nextGeneration.id,
            title: `Campaign Pack - ${toGenerationFormatLabel(nextGeneration.formatTarget)}`,
          });
          const fetched = await fetchViralStudioDocument(workspaceId, created.document.id);
          workingDocument = fetched.document;
          initialVersions = fetched.versions;
          setDocument(fetched.document);
          setDocumentDraft(fetched.document);
          setVersions(fetched.versions);
          setComparison(null);
          setCompareLeftVersionId("current");
          setCompareRightVersionId("current");
          setPromoteVersionId(fetched.versions[fetched.versions.length - 1]?.id || "");
        }

        const syncedSections = buildDocumentSectionsFromGeneration(nextGeneration, workingDocument.sections);
        const patched = await patchViralStudioDocument(workspaceId, workingDocument.id, {
          title: workingDocument.title || `Campaign Pack - ${toGenerationFormatLabel(nextGeneration.formatTarget)}`,
          sections: syncedSections.map((section) => ({
            id: section.id,
            title: section.title,
            kind: section.kind,
            content: section.content,
          })),
          orderedSectionIds: syncedSections.map((section) => section.id),
          autosave: false,
        });
        setDocument(patched.document);
        setDocumentDraft(patched.document);
        setDocumentDirty(false);
        setAutosaveState("saved");

        const versionPayload = await createViralStudioDocumentVersion(workspaceId, patched.document.id, {
          author: "viral-studio-autosave",
          summary: `Auto-saved generation revision ${nextGeneration.revision}`,
        });
        setDocument(versionPayload.document);
        setDocumentDraft(versionPayload.document);
        setDocumentDirty(false);
        setAutosaveState("saved");
        setVersions((previous) => {
          const base = previous.length > 0 ? previous : initialVersions;
          if (base.some((version) => version.id === versionPayload.version.id)) return base;
          return [...base, versionPayload.version];
        });
        setPromoteVersionId(versionPayload.version.id);
        setGenerationSaveStatus(
          `Revision ${nextGeneration.revision} saved to document timeline as an immutable version.`
        );
        generationSnapshotKeysRef.current.add(snapshotKey);
        void Promise.all([refreshTelemetry(), refreshWorkflow()]);
      } catch (snapshotError: unknown) {
        setGenerationSaveStatus("Automatic generation snapshot failed. Use Create Version to capture manually.");
        setError(String((snapshotError as Error)?.message || "Failed to auto-save generation revision"));
      } finally {
        generationSnapshotBusyRef.current = false;
      }
    },
    [workspaceId, document, versions, documentDirty, refreshTelemetry, refreshWorkflow]
  );

  useEffect(() => {
    if (!generation) return;
    const snapshotKey = `${generation.id}:${generation.revision}`;
    if (generationSnapshotKeysRef.current.has(snapshotKey)) return;
    if (generationSnapshotBusyRef.current) return;
    void syncGenerationToVersionHistory(generation);
  }, [generation, syncGenerationToVersionHistory]);

  const snapshotVersion = useCallback(async () => {
    if (!document) return;
    setIsBusy(true);
    setError(null);
    try {
      if (documentDraft && documentDirty) {
        await persistDocumentDraft(false);
      }
      const payload = await createViralStudioDocumentVersion(workspaceId, document.id, {
        author: "viral-studio-plan6",
        summary: "Published after document workspace edits",
      });
      setDocument(payload.document);
      setDocumentDraft(payload.document);
      setDocumentDirty(false);
      setAutosaveState("saved");
      setVersions((previous) => {
        if (previous.some((version) => version.id === payload.version.id)) return previous;
        return [...previous, payload.version];
      });
      setPromoteVersionId(payload.version.id);
      void Promise.all([refreshTelemetry(), refreshWorkflow()]);
    } catch (versionError: unknown) {
      setError(String((versionError as Error)?.message || "Failed to create document version"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, document, documentDraft, documentDirty, persistDocumentDraft, refreshTelemetry, refreshWorkflow]);

  const saveDocumentNow = useCallback(async () => {
    if (!documentDraft || !documentDirty) return;
    setIsBusy(true);
    setError(null);
    try {
      await persistDocumentDraft(false);
    } catch (saveError: unknown) {
      setAutosaveState("error");
      setError(String((saveError as Error)?.message || "Failed to save document"));
    } finally {
      setIsBusy(false);
    }
  }, [documentDraft, documentDirty, persistDocumentDraft]);

  const promoteVersion = useCallback(async () => {
    if (!document || !promoteVersionId) return;
    setIsBusy(true);
    setError(null);
    try {
      if (documentDraft && documentDirty) {
        await persistDocumentDraft(false);
      }
      const payload = await promoteViralStudioDocumentVersion(workspaceId, document.id, promoteVersionId, {
        author: "viral-studio-plan6",
        summary: "Promoted from version timeline",
      });
      setDocument(payload.document);
      setDocumentDraft(payload.document);
      setDocumentDirty(false);
      setAutosaveState("saved");
      setVersions((previous) => {
        if (previous.some((version) => version.id === payload.version.id)) return previous;
        return [...previous, payload.version];
      });
      setCompareLeftVersionId(payload.promotedFromVersionId);
      setCompareRightVersionId(payload.version.id);
      void Promise.all([refreshTelemetry(), refreshWorkflow()]);
    } catch (promoteError: unknown) {
      setError(String((promoteError as Error)?.message || "Failed to promote document version"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, document, promoteVersionId, documentDraft, documentDirty, persistDocumentDraft, refreshTelemetry, refreshWorkflow]);

  const runVersionCompare = useCallback(async () => {
    if (!document) return;
    setCompareLoading(true);
    setError(null);
    try {
      const payload = await compareViralStudioDocumentVersions(
        workspaceId,
        document.id,
        compareLeftVersionId,
        compareRightVersionId
      );
      setComparison(payload.comparison);
    } catch (compareError: unknown) {
      setError(String((compareError as Error)?.message || "Failed to compare versions"));
    } finally {
      setCompareLoading(false);
    }
  }, [workspaceId, document, compareLeftVersionId, compareRightVersionId]);

  const updateDocumentTitle = useCallback((title: string) => {
    setDocumentDraft((previous) => (previous ? { ...previous, title } : previous));
    setDocumentDirty(true);
    setAutosaveState("idle");
  }, []);

  const updateDocumentSectionTitle = useCallback((sectionId: string, title: string) => {
    setDocumentDraft((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        sections: previous.sections.map((section) => (section.id === sectionId ? { ...section, title } : section)),
      };
    });
    setDocumentDirty(true);
    setAutosaveState("idle");
  }, []);

  const updateDocumentSectionContent = useCallback((sectionId: string, value: string) => {
    setDocumentDraft((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        sections: previous.sections.map((section) =>
          section.id === sectionId
            ? {
                ...section,
                content: parseSectionText(section.kind, value),
              }
            : section
        ),
      };
    });
    setDocumentDirty(true);
    setAutosaveState("idle");
  }, []);

  const reorderDocumentSection = useCallback((sectionId: string, direction: "up" | "down") => {
    setDocumentDraft((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        sections: moveDocumentSection(previous.sections, sectionId, direction),
      };
    });
    setDocumentDirty(true);
    setAutosaveState("idle");
  }, []);

  const exportDocument = useCallback(
    async (format: "markdown" | "json") => {
      if (!document) return;
      setIsBusy(true);
      setError(null);
      try {
        if (documentDraft && documentDirty) {
          await persistDocumentDraft(false);
        }
        const payload = await exportViralStudioDocument(workspaceId, document.id, format);
        setLastExport({ format: payload.export.format, content: payload.export.content.slice(0, 800) });
        void Promise.all([refreshTelemetry(), refreshWorkflow()]);
      } catch (exportError: unknown) {
        setError(String((exportError as Error)?.message || "Failed to export document"));
      } finally {
        setIsBusy(false);
      }
    },
    [workspaceId, document, documentDraft, documentDirty, persistDocumentDraft, refreshTelemetry, refreshWorkflow]
  );

  useEffect(() => {
    if (!documentDraft || !documentDirty) return;
    const timer = window.setInterval(() => {
      void (async () => {
        setAutosaveState("saving");
        try {
          await persistDocumentDraft(true);
        } catch {
          setAutosaveState("error");
        }
      })();
    }, 10_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [documentDraft, documentDirty, persistDocumentDraft]);

  const resolveChatBranch = useCallback(async () => {
    const threads = await listRuntimeThreads(workspaceId);
    const threadWithBranch = threads.find((thread) => Array.isArray(thread.branches) && thread.branches.length > 0);
    if (threadWithBranch?.branches?.length) {
      return {
        branchId: threadWithBranch.branches[0].id,
        threadId: threadWithBranch.id,
      };
    }
    const created = await createRuntimeThread(workspaceId, {
      title: "Viral Studio Collaboration",
      createdBy: "viral-studio",
    });
    return {
      branchId: created.mainBranch.id,
      threadId: created.thread.id,
    };
  }, [workspaceId]);

  const sendGenerationToChat = useCallback(async () => {
    if (!generation && !formatGeneration) return;
    setIsBusy(true);
    setError(null);
    setChatBridgeStatus(null);
    try {
      const { branchId } = await resolveChatBranch();
      const payload = formatGeneration
        ? buildFormatGenerationChatBridgePayload(formatGeneration, references)
        : buildGenerationChatBridgePayload(generation as ViralStudioGenerationPack, references);
      await sendRuntimeMessage(workspaceId, branchId, {
        content: payload.content,
        mode: "send",
        blocksJson: payload.blocksJson,
        citationsJson: payload.citationsJson,
        ...(payload.libraryRefs.length ? { libraryRefs: payload.libraryRefs } : {}),
      });
      setChatBridgeStatus(
        formatGeneration
          ? "Staged format plan sent to core chat successfully."
          : "Generation pack sent to core chat successfully."
      );
    } catch (bridgeError: unknown) {
      setError(String((bridgeError as Error)?.message || "Failed to send pack to chat"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, formatGeneration, generation, references, resolveChatBranch]);

  const sendShortlistToChat = useCallback(async () => {
    if (!references.length) return;
    setIsBusy(true);
    setError(null);
    setChatBridgeStatus(null);
    try {
      const shortlisted = references.filter((item) => item.shortlistState === "must-use" || item.shortlistState === "pin").slice(0, 6);
      const source = shortlisted.length > 0 ? shortlisted : references.slice(0, 6);
      const { branchId } = await resolveChatBranch();
      const payload = buildShortlistChatBridgePayload(source);
      await sendRuntimeMessage(workspaceId, branchId, {
        content: payload.content,
        mode: "send",
        blocksJson: payload.blocksJson,
        citationsJson: payload.citationsJson,
        ...(payload.libraryRefs.length ? { libraryRefs: payload.libraryRefs } : {}),
      });
      setChatBridgeStatus("Shortlisted references sent to core chat.");
    } catch (bridgeError: unknown) {
      setError(String((bridgeError as Error)?.message || "Failed to send shortlist to chat"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, references, resolveChatBranch]);

  const runAutofillFinalize = useCallback(async (options?: { forceAll?: boolean }) => {
    setAutofillBusy(true);
    setError(null);
    try {
      const previewPayload = autofillPreview
        ? { preview: autofillPreview }
        : await previewWorkspaceBrandDnaAutofill(workspaceId);
      const preview = previewPayload.preview;
      setAutofillPreview(preview);
      if (!autofillPreview) {
        setAutofillSelection(createAutofillSelection(preview));
      }
      const selectedFields = options?.forceAll
        ? preview.suggestedFields
        : preview.suggestedFields.filter((field) => autofillSelection[field] !== false);
      const appliedPayload = await applyWorkspaceBrandDnaAutofill(workspaceId, {
        ...(selectedFields.length ? { selectedFields } : {}),
        finalizeIfReady: true,
      });
      setBrandProfile(appliedPayload.profile);
      setBrandForm(toFormState(appliedPayload.profile));
      setAutofillPreview(appliedPayload.preview);
      setAutofillSelection(createAutofillSelection(appliedPayload.preview));
      if (appliedPayload.profile.status === "final" && appliedPayload.profile.completeness.ready) {
        setOnboardingStep(4);
        setIsEditingBrandDna(false);
      }
      await Promise.all([refreshWorkflow(), refreshTelemetry()]);
    } catch (autofillError: unknown) {
      setError(String((autofillError as Error)?.message || "Failed to run guided autofill"));
    } finally {
      setAutofillBusy(false);
    }
  }, [workspaceId, autofillPreview, autofillSelection, refreshWorkflow, refreshTelemetry]);

  const startGuidedDataMaxExtraction = useCallback(
    async (preferredSource?: ViralStudioSuggestedSource | null) => {
      const fallbackSource = preferredSource || suggestedSources[0];
      const resolvedSourceUrl = sourceUrl.trim() || fallbackSource?.sourceUrl || "";
      const resolvedPlatform = sourceUrl.trim() ? sourcePlatform : fallbackSource?.platform || sourcePlatform;
      if (!resolvedSourceUrl) {
        setShowExtractionModal(true);
        throw new Error("No source URL available for data-max extraction.");
      }
      const payload = await createViralStudioIngestion(workspaceId, {
        sourcePlatform: resolvedPlatform,
        sourceUrl: resolvedSourceUrl,
        maxVideos: 120,
        lookbackDays: 365,
        sortBy: "engagement",
        preset: "data-max",
      });
      setSourcePlatform(resolvedPlatform);
      setSourceUrl(resolvedSourceUrl);
      setIngestionPreset("data-max");
      setMaxVideos(120);
      setLookbackDays(365);
      setShowExtractionModal(false);
      setActiveIngestion(payload.run);
      setIngestions((previous) => [payload.run, ...previous.filter((row) => row.id !== payload.run.id)]);
      await Promise.all([refreshTelemetry(), refreshWorkflow()]);
      return payload.run;
    },
    [workspaceId, sourceUrl, sourcePlatform, suggestedSources, refreshTelemetry, refreshWorkflow]
  );

  const waitForIngestionTerminal = useCallback(
    async (
      ingestionId: string,
      options?: {
        timeoutMs?: number;
        onProgress?: (run: ViralStudioIngestionRun) => void;
      }
    ) => {
      const timeoutMs = Math.max(20_000, options?.timeoutMs || 140_000);
      const startedAt = Date.now();
      let lastRun: ViralStudioIngestionRun | null = null;
      while (Date.now() - startedAt < timeoutMs) {
        const payload = await fetchViralStudioIngestion(workspaceId, ingestionId);
        lastRun = payload.run;
        setActiveIngestion(payload.run);
        setIngestions((previous) => {
          const next = previous.filter((row) => row.id !== payload.run.id);
          return [payload.run, ...next];
        });
        options?.onProgress?.(payload.run);
        if (isTerminalIngestionStatus(payload.run.status)) {
          return payload.run;
        }
        await delay(1250);
      }
      throw new Error(
        `Timed out waiting for extraction completion. Last status: ${lastRun?.status || "unknown"}.`
      );
    },
    [workspaceId]
  );

  const autoCurateTopReferences = useCallback(
    async (referenceSource?: ViralStudioReferenceAsset[]) => {
      const base = referenceSource && referenceSource.length ? referenceSource : references;
      const candidates = base.filter((item) => item.shortlistState !== "exclude").slice(0, 3);
      if (!candidates.length) {
        throw new Error("No ranked references are available yet for curation.");
      }
      const updates = await Promise.all(
        candidates.map((item, index) =>
          updateViralStudioReferenceShortlist(workspaceId, {
            referenceId: item.id,
            action: index === 0 ? "must-use" : "pin",
          })
        )
      );
      const byId = new Map(updates.map((entry) => [entry.item.id, entry.item]));
      setReferences((previous) =>
        (referenceSource && referenceSource.length ? referenceSource : previous).map(
          (item) => byId.get(item.id) || item
        )
      );
      setCurationNotice("Top references auto-curated: #1 must-use, #2-3 pinned.");
      await Promise.all([refreshTelemetry(), refreshWorkflow()]);
      return updates.map((entry) => entry.item);
    },
    [workspaceId, references, refreshTelemetry, refreshWorkflow]
  );

  const runWebsiteFirstAutopilot = useCallback(async () => {
    if (autopilotBusy) return;
    setAutopilotBusy(true);
    setError(null);
    setAutopilotStatus("Checking intake and workspace evidence...");
    try {
      const [workflowPayload, sourcePayload] = await Promise.all([
        fetchViralStudioWorkflowStatus(workspaceId),
        fetchViralStudioSuggestedSources(workspaceId),
      ]);
      setWorkflowStatus(workflowPayload.workflow);
      setSuggestedSources(sourcePayload.items || []);

      if (!workflowPayload.workflow.intakeCompleted) {
        setAutopilotStatus("Intake is still required. Complete intake first, then rerun autopilot.");
        router.push(`/app/w/${workspaceId}`);
        return;
      }

      if (!workflowPayload.workflow.brandDnaReady) {
        setAutopilotStatus("Hydrating Brand DNA from website + social evidence...");
        await runAutofillFinalize({ forceAll: true });
        const workflowAfterAutofill = await fetchViralStudioWorkflowStatus(workspaceId);
        setWorkflowStatus(workflowAfterAutofill.workflow);
        if (!workflowAfterAutofill.workflow.brandDnaReady) {
          throw new Error("Brand DNA is still not finalized. Review DNA fields and finalize before extraction.");
        }
      }

      setAutopilotStatus("Launching data-max extraction...");
      const run = await startGuidedDataMaxExtraction(sourcePayload.items[0] || null);

      setAutopilotStatus("Extraction running. Monitoring progress...");
      const terminalRun = await waitForIngestionTerminal(run.id, {
        timeoutMs: 170_000,
        onProgress: (snapshot) => {
          setAutopilotStatus(
            `Extraction ${statusLabel(snapshot.status)}: ${snapshot.progress.ranked}/${snapshot.progress.found || snapshot.maxVideos} ranked`
          );
        },
      });

      if (terminalRun.status === "failed") {
        throw new Error(terminalRun.error || "Extraction failed in autopilot.");
      }

      setAutopilotStatus("Loading ranked references...");
      const referencesPayload = await listViralStudioReferences(workspaceId, {
        ingestionRunId: terminalRun.id,
      });
      setReferences(referencesPayload.items);

      setAutopilotStatus("Curating top references...");
      await autoCurateTopReferences(referencesPayload.items);

      setAutopilotStatus("Website-first autopilot complete: DNA finalized, extraction completed, and top references curated.");
      setChatBridgeStatus("Website-first autopilot completed. Continue in Prompt Studio or send context to core chat.");
    } catch (autopilotError: unknown) {
      setError(String((autopilotError as Error)?.message || "Website-first autopilot failed."));
      setAutopilotStatus("Autopilot stopped with an error. Review details and retry.");
    } finally {
      setAutopilotBusy(false);
    }
  }, [
    workspaceId,
    autopilotBusy,
    router,
    runAutofillFinalize,
    startGuidedDataMaxExtraction,
    waitForIngestionTerminal,
    autoCurateTopReferences,
  ]);

  useEffect(() => {
    if (loading) return;
    if (autopilotQuery !== "website-first") return;
    const triggerKey = `${workspaceId}:${autopilotQuery}`;
    if (autopilotTriggerRef.current === triggerKey) return;
    autopilotTriggerRef.current = triggerKey;
    void runWebsiteFirstAutopilot();
    router.replace(`/app/w/${workspaceId}/viral-studio`);
  }, [loading, autopilotQuery, workspaceId, runWebsiteFirstAutopilot, router]);

  const workflowStage = workflowStatus?.workflowStage || "intake_pending";
  const workflowStepIndex = workflowStageOrderIndex(workflowStage);
  const workflowProgressPct = Math.round(((workflowStepIndex + 1) / WORKFLOW_STAGE_ORDER.length) * 100);
  const workflowGuide = useMemo(() => {
    if (workflowStage === "intake_pending") {
      return {
        action: "open_intake" as WorkflowGuideAction,
        title: "Complete Workspace Intake",
        body: "Start with website/social intake so Brand DNA autofill has enough evidence to work correctly.",
        cta: "Open Intake Form",
      };
    }
    if (workflowStage === "intake_complete" || workflowStage === "studio_autofill_review") {
      return {
        action: "run_autofill" as WorkflowGuideAction,
        title: "Run Autofill + Finalize DNA",
        body: "Auto-hydrate mission, audience, voice, and guardrails from workspace evidence, then finalize in one flow.",
        cta: "Run Smart Autofill",
      };
    }
    if (workflowStage === "extraction") {
      return {
        action: "start_extraction" as WorkflowGuideAction,
        title: "Start Data-Max Extraction",
        body: "Use top suggested social source and run deep extraction to build the viral reference set.",
        cta: "Start Data-Max Run",
      };
    }
    if (workflowStage === "curation") {
      return {
        action: "curate_references" as WorkflowGuideAction,
        title: "Curate Priority References",
        body: "Auto-pin top references to seed generation with clear, explainable winners.",
        cta: "Auto-Curate Top 3",
      };
    }
    if (workflowStage === "generation") {
      return {
        action: "generate_pack" as WorkflowGuideAction,
        title: "Generate Campaign Pack",
        body: "Build hook/script/caption/CTA variants from Brand DNA + curated references in one run.",
        cta: "Generate Pack",
      };
    }
    return {
      action: "handoff_chat" as WorkflowGuideAction,
      title: "Ship To Core Chat",
      body: "Send the final context pack to chat so strategy and execution continue in the main business workflow.",
      cta: "Handoff To Chat",
    };
  }, [workflowStage]);
  const onboardingCoveragePct = useMemo(() => onboardingCoveragePercent(brandForm), [brandForm]);
  const activeOnboardingMeta =
    ONBOARDING_STEP_META.find((item) => item.step === onboardingStep) || ONBOARDING_STEP_META[0];
  const latestSuggestedSource = suggestedSources[0] || null;
  const latestReferenceSummary = activeIngestion
    ? `${activeIngestion.progress.ranked}/${activeIngestion.progress.found || activeIngestion.maxVideos} ranked`
    : `${references.length} references loaded`;
  const launchpadCards = [
    {
      id: "foundation",
      eyebrow: "01 Foundation",
      title: brandReady ? "Brand DNA is ready" : "Brand DNA needs one clean pass",
      body: brandReady
        ? compactText(brandProfile?.summary || "Brand DNA is finalized and ready to drive generation.", 170)
        : "Use one website-first autofill pass, confirm the summary, and finalize voice guardrails.",
      stat: `${onboardingCoveragePct}% coverage`,
      actionLabel: brandReady ? "Edit DNA" : workflowGuide.cta,
      action: () => {
        window.document.getElementById("vbs-section-onboarding")?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (brandReady) {
          setIsEditingBrandDna(true);
          return;
        }
        void runWorkflowGuideAction();
      },
    },
    {
      id: "references",
      eyebrow: "02 Reference Engine",
      title: activeIngestion ? "Reference engine is active" : "Reference engine is ready to run",
      body: latestSuggestedSource
        ? `${latestSuggestedSource.label} is the top website/social source. Run data-max extraction and curate only the winners.`
        : "We will use suggested website and social evidence as soon as intake is complete.",
      stat: latestReferenceSummary,
      actionLabel: activeIngestion ? "Open reference engine" : "Start extraction",
      action: () => {
        window.document.getElementById("vbs-section-extraction")?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (activeIngestion) {
          void openIngestionResults(activeIngestion);
          return;
        }
        setShowExtractionModal(true);
      },
    },
    {
      id: "create",
      eyebrow: "03 Create & Save",
      title: generation ? "Generation and version history are live" : "Create one campaign pack",
      body: generation
        ? `Revision ${generation.revision} is available and every revision now saves into document history automatically.`
        : "Generate one multi-pack and let the studio save each revision into the document timeline.",
      stat: document ? `${versions.length} saved version(s)` : "No document yet",
      actionLabel: generation ? "Open create & save" : "Generate pack",
      action: () => {
        window.document.getElementById("vbs-section-create-save")?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (!generation) {
          void generatePack();
        }
      },
    },
  ];

  const workflowBabySteps = useMemo(() => {
    const extractionReady = Boolean(activeIngestion || references.length > 0);
    const curationReady = prioritizedReferenceCount > 0;
    const generationReady = Boolean(generation || document);
    return [
      {
        key: "brand",
        eyebrow: "Step 1",
        title: "Lock the brand truth",
        state: brandReady ? "done" : "active",
        body: brandReady
          ? "Mission, audience, tone, and claims are approved and ready to steer every later decision."
          : "Use the website-first autofill as a first draft, then tighten the fields one cluster at a time.",
        input: workflowStatus?.intakeCompleted ? "Intake evidence + website/social context" : "Workspace intake and website evidence",
        decision: activeOnboardingMeta.title,
        output: brandReady ? compactText(brandProfile?.summary || tonePreview(brandForm), 130) : `${onboardingCoveragePct}% coverage so far`,
      },
      {
        key: "extract",
        eyebrow: "Step 2",
        title: "Pull the strongest reference pool",
        state: extractionReady ? "done" : brandReady ? "active" : "upcoming",
        body: activeIngestion
          ? "The extraction engine is already turning one source into a ranked evidence board."
          : "Choose one strong source first. A cleaner source makes the ranking and shortlist far more reliable.",
        input: latestSuggestedSource ? `${latestSuggestedSource.label} • ${toPlatformLabel(latestSuggestedSource.platform)}` : "Suggested sources from intake and website evidence",
        decision: activeIngestion ? `${statusLabel(activeIngestion.status)} run` : "Preset, depth, and source URL",
        output: extractionReady ? `${references.length} references loaded` : "A ranked board of references to inspect",
      },
      {
        key: "curate",
        eyebrow: "Step 3",
        title: "Shortlist only the winners",
        state: curationReady ? "done" : extractionReady ? "active" : "upcoming",
        body: curationReady
          ? "Your shortlist now tells generation exactly which references are allowed to influence the pack."
          : "Use pin, must-use, and exclude deliberately. Treat this step as editorial judgment, not just filtering.",
        input: extractionReady ? `${filteredReferences.length} visible references` : "Ranked references will appear here after extraction",
        decision: curationReady ? `${prioritizedReferenceCount} prioritized refs` : "Pick what must guide the pack",
        output: curationReady ? "A sharp shortlist ready for generation" : "A smaller set of references with clear rationale",
      },
      {
        key: "create",
        eyebrow: "Step 4",
        title: "Generate, refine, and save",
        state: generationReady ? "done" : curationReady ? "active" : "upcoming",
        body: generation
          ? "The pack is live. Now the job is refinement, quality control, and durable versioning."
          : "Once the shortlist is right, generate one multi-pack, review quality, and save the strongest draft into the document timeline.",
        input: `${selectedTemplate?.title || "Prompt template"} • ${toGenerationFormatLabel(generationFormatTarget)}`,
        decision: generation ? `Revision ${generation.revision}` : "Prompt direction + section refinements",
        output: document ? `${versions.length} version(s) saved` : "A durable campaign document and revision history",
      },
    ];
  }, [
    activeIngestion,
    activeOnboardingMeta.title,
    brandProfile,
    brandReady,
    document,
    filteredReferences.length,
    generation,
    generationFormatTarget,
    latestSuggestedSource,
    onboardingCoveragePct,
    prioritizedReferenceCount,
    references.length,
    selectedTemplate,
    versions.length,
    workflowStatus?.intakeCompleted,
    brandForm,
  ]);

  const foundationDetailCards = useMemo<StudioDetailCard[]>(() => {
    const cardsByStep: Record<1 | 2 | 3 | 4, StudioDetailCard[]> = {
      1: [
        {
          label: "What you are defining",
          value: "Mission, value proposition, offer, and region",
          note: "Keep it specific enough that the system could reuse it in a landing page headline.",
        },
        {
          label: "Why it matters",
          value: "This becomes the positioning layer",
          note: "Reference ranking and generation quality both improve when the product promise is concrete.",
        },
        {
          label: "What unlocks next",
          value: "Audience modeling",
          note: "Once the offer is clear, the next step can focus on who needs it and why they hesitate.",
        },
      ],
      2: [
        {
          label: "What you are defining",
          value: "Personas, pains, desires, and objections",
          note: "Write like you are describing real buyers, not a broad marketing segment.",
        },
        {
          label: "Why it matters",
          value: "This shapes hooks and angles",
          note: "The best references will feel more relevant when the board is judged through a clear audience lens.",
        },
        {
          label: "What unlocks next",
          value: "Voice guardrails",
          note: "Once the buyer is clear, we can decide how directly, formally, or playfully to speak to them.",
        },
      ],
      3: [
        {
          label: "What you are defining",
          value: "Voice sliders, banned phrases, and required claims",
          note: "This is where the studio stops sounding generic and starts sounding like your team.",
        },
        {
          label: "Why it matters",
          value: "This protects brand consistency",
          note: "Generation and refinements will use these settings as a quality gate, not just as decoration.",
        },
        {
          label: "What unlocks next",
          value: "Examples and final summary",
          note: "After the tone is locked, the final step turns all of that structure into one AI-ready brief.",
        },
      ],
      4: [
        {
          label: "What you are defining",
          value: "Exemplars and the final reusable summary",
          note: "Give the system a few real examples so the final summary stays anchored to actual brand texture.",
        },
        {
          label: "Why it matters",
          value: "This becomes the working brief",
          note: "Extraction choices, generation, and chat handoff all inherit this summary after finalization.",
        },
        {
          label: "What unlocks next",
          value: "Extraction, generation, and saving",
          note: "Once finalized, the rest of Viral Studio can move without asking the brand questions again.",
        },
      ],
    };
    return cardsByStep[onboardingStep];
  }, [onboardingStep]);

  const referenceDetailCards = useMemo<StudioDetailCard[]>(() => {
    const activeSource = latestSuggestedSource ? `${latestSuggestedSource.label} • ${toPlatformLabel(latestSuggestedSource.platform)}` : "No source selected yet";
    return [
      {
        label: "1. Choose one source",
        value: activeSource,
        note: "Start with the cleanest source first. One strong source beats five noisy ones.",
      },
      {
        label: "2. Read the board carefully",
        value: activeIngestion ? `${statusLabel(activeIngestion.status)} • ${references.length} refs loaded` : "Wait for the run to finish",
        note: "Use score, platform, recency, and the first rationale line to decide which cards deserve attention.",
      },
      {
        label: "3. Shortlist with intent",
        value: prioritizedReferenceCount > 0 ? `${prioritizedReferenceCount} prioritized` : "No prioritized refs yet",
        note: "Use must-use for anchors, pin for strong supporting examples, exclude for anything misleading or off-brand.",
      },
    ];
  }, [activeIngestion, latestSuggestedSource, prioritizedReferenceCount, references.length]);

  const createDetailCards = useMemo<StudioDetailCard[]>(() => {
    return [
      {
        label: "Before you generate",
        value: `${selectedTemplate?.title || "Select template"} • ${toGenerationFormatLabel(generationFormatTarget)}`,
        note: `The pack will use ${prioritizedReferenceCount} prioritized reference(s) and the current Brand DNA guardrails.`,
      },
      {
        label: "What to review next",
        value: generation ? `Revision ${generation.revision} ready` : "Quality gate will appear after generation",
        note: generation
          ? `Check hooks, scripts, captions, and CTA variants before refining one section at a time.`
          : "Generate once, then review quality signals and section cards before editing the document.",
      },
      {
        label: "What gets saved",
        value: document ? `${versions.length} version(s) in the vault` : "Document draft is still waiting",
        note: document
          ? "Every revision can become a durable version snapshot, export, or promoted working draft."
          : "The best draft should move into Document Workspace so the team can iterate safely.",
      },
    ];
  }, [document, generation, generationFormatTarget, prioritizedReferenceCount, selectedTemplate, versions.length]);

  const extractionFocusCards = useMemo<StudioDetailCard[]>(() => {
    const sourceLabel = latestSuggestedSource
      ? `${latestSuggestedSource.label} • ${toPlatformLabel(latestSuggestedSource.platform)}`
      : sourceUrl.trim()
        ? `${toPlatformLabel(sourcePlatform)} • ${compactText(sourceUrl.trim(), 44)}`
        : "Choose the cleanest source first";
    const sourceNote = latestSuggestedSource
      ? `${Math.round((latestSuggestedSource.confidence || 0) * 100)}% confidence • ${compactText(
          latestSuggestedSource.sourceUrl,
          110
        )}`
      : "Use one strong social/profile URL before expanding the search.";
    const rankedTarget = activeIngestion
      ? `${activeIngestion.progress.ranked}/${Math.max(activeIngestion.progress.found || 0, activeIngestion.maxVideos)} ranked`
      : ingestions.length > 0
        ? `${ingestions.length} run(s) in history`
        : "No run started yet";
    const progressNote = activeIngestion
      ? `Downloaded ${activeIngestion.progress.downloaded}, analyzed ${activeIngestion.progress.analyzed}, ranked ${activeIngestion.progress.ranked}.`
      : "Once the run starts, this panel will show found, downloaded, analyzed, and ranked counts.";
    const nextCheckValue = activeIngestion
      ? activeIngestion.status === "completed" || activeIngestion.status === "partial"
        ? "Inspect the top 5 cards for real fit"
        : "Wait for the ranked count to stabilize"
      : "Confirm the URL matches the exact account";
    return [
      {
        label: "Source in focus",
        value: sourceLabel,
        note: sourceNote,
        tone: latestSuggestedSource ? "info" : "warning",
      },
      {
        label: "Run recipe",
        value: `${toPresetLabel(ingestionPreset)} • ${maxVideos} videos • ${lookbackDays} days`,
        note: "Keep Data max for the first pass unless the source is noisy or very inactive.",
      },
      {
        label: "Current progress",
        value: activeIngestion ? `${statusLabel(activeIngestion.status)} • ${rankedTarget}` : rankedTarget,
        note: activeIngestion?.error ? `Warning: ${activeIngestion.error}` : progressNote,
        tone:
          activeIngestion?.status === "completed" || activeIngestion?.status === "partial"
            ? "success"
            : activeIngestion?.status === "failed"
              ? "warning"
              : "info",
      },
      {
        label: "What to verify next",
        value: nextCheckValue,
        note: "You want relevance before volume. If the first winners feel wrong, change the source or preset before curating.",
      },
    ];
  }, [
    activeIngestion,
    ingestions.length,
    ingestionPreset,
    latestSuggestedSource,
    lookbackDays,
    maxVideos,
    sourcePlatform,
    sourceUrl,
  ]);

  const curationFocusCards = useMemo<StudioDetailCard[]>(() => {
    const selectedTitle = selectedReference
      ? compactText(selectedReference.ranking.rationaleTitle || selectedReference.caption || "Selected reference", 72)
      : "Select a reference card to inspect it";
    const driverLine = selectedReference
      ? selectedReference.explainability.topDrivers.slice(0, 2).join(" • ") ||
        compactText(selectedReference.ranking.rationaleBullets[0] || "No explainability available yet.", 110)
      : "Top drivers will appear here";
    const actionValue = !selectedReference
      ? "No shortlist decision yet"
      : selectedReference.shortlistState === "must-use"
        ? "Must-use anchor for generation"
        : selectedReference.shortlistState === "pin"
          ? "Pinned as a strong supporting example"
          : selectedReference.shortlistState === "exclude"
            ? "Excluded from the influence set"
            : "Decide whether this should steer the pack";
    const actionNote = !selectedReference
      ? "Pick one card, then decide whether it is an anchor, a supporting example, or noise."
      : selectedReference.shortlistState === "must-use"
        ? "Keep must-use for the references that define the angle or proof structure of the pack."
        : selectedReference.shortlistState === "pin"
          ? "Pinned references support generation without dominating every section."
          : selectedReference.shortlistState === "exclude"
            ? "Excluded references stay visible for audit, but they should not influence the pack."
            : "Use must-use for anchors, pin for support, and exclude for off-brand or misleading winners.";
    const boardScope = `${filteredReferences.length} visible • ${referenceCounts.prioritized} prioritized • ${
      referencePlatformFilter === "all" ? "All platforms" : toPlatformLabel(referencePlatformFilter)
    }`;
    return [
      {
        label: "Selected reference",
        value: selectedTitle,
        note: selectedReference
          ? `${toPlatformLabel(selectedReference.sourcePlatform)} • score ${selectedReference.scores.composite.toFixed(
              3
            )} • ${formatCompactNumber(selectedReference.metrics.views)} views`
          : "The board will reveal full metrics after you choose a card.",
        tone: selectedReference ? "info" : "warning",
      },
      {
        label: "Why it ranks high",
        value: driverLine,
        note: selectedReferenceInsights
          ? `${selectedReferenceInsights.compositeDelta >= 0 ? "+" : ""}${selectedReferenceInsights.compositeDelta.toFixed(
              3
            )} vs board average • ${formatUnitPercent(selectedReferenceInsights.interactionRateRaw)} interaction rate`
          : "Look for hook strength, recency, retention proxy, and clarity before trusting a high view count.",
      },
      {
        label: "Editorial decision",
        value: actionValue,
        note: actionNote,
        tone:
          selectedReference?.shortlistState === "must-use"
            ? "success"
            : selectedReference?.shortlistState === "exclude"
              ? "warning"
              : "info",
      },
      {
        label: "Board scope",
        value: boardScope,
        note: `View mode: ${referenceViewMode}. Shortcut keys: 1 pin, 2 must-use, 3 exclude, 0 clear.`,
      },
    ];
  }, [
    filteredReferences.length,
    referenceCounts.prioritized,
    referencePlatformFilter,
    referenceViewMode,
    selectedReference,
    selectedReferenceInsights,
  ]);

  const referenceCardDetails = useMemo(() => {
    const next = new Map<string, ReferenceCardDetail>();
    for (const reference of filteredReferences) {
      next.set(reference.id, buildReferenceCardDetail(reference));
    }
    return next;
  }, [filteredReferences]);

  const selectedReferenceCardDetail = useMemo(() => {
    if (!selectedReference) return null;
    return referenceCardDetails.get(selectedReference.id) || buildReferenceCardDetail(selectedReference);
  }, [referenceCardDetails, selectedReference]);

  const selectedReferenceVisualStyle = useMemo(() => {
    if (!selectedReferenceCardDetail) return undefined;
    return (selectedReferenceCardDetail.mediaUrl
      ? {
          backgroundImage: `linear-gradient(180deg, rgba(11,19,43,0.16), rgba(11,19,43,0.82)), url("${selectedReferenceCardDetail.mediaUrl}")`,
        }
      : {
          ["--vbs-reference-accent" as const]: selectedReferenceCardDetail.palette[0],
          ["--vbs-reference-accent-soft" as const]: selectedReferenceCardDetail.palette[1],
          ["--vbs-reference-accent-deep" as const]: selectedReferenceCardDetail.palette[2],
        }) as CSSProperties;
  }, [selectedReferenceCardDetail]);

  const selectedReferenceDrawerStyle = useMemo(() => {
    if (!selectedReferenceCardDetail) return undefined;
    return {
      ["--vbs-analysis-accent" as const]: selectedReferenceCardDetail.palette[0],
      ["--vbs-analysis-accent-soft" as const]: selectedReferenceCardDetail.palette[1],
      ["--vbs-analysis-accent-deep" as const]: selectedReferenceCardDetail.palette[2],
    } as CSSProperties;
  }, [selectedReferenceCardDetail]);

  const generationFocusCards = useMemo<StudioDetailCard[]>(() => {
    const influenceCount = prioritizedReferenceCount > 0 ? prioritizedReferenceCount : selectedReferenceIds.length;
    const qualityValue = generation
      ? qualitySignals.length > 0
        ? `${qualitySignals.length} review signal(s)`
        : "Quality gate clear"
      : "No quality report yet";
    const saveTarget = documentDraft
      ? `${documentDraft.sections.length} section(s) in the working draft`
      : document
        ? `${document.sections.length} section(s) saved`
        : "Create a document after the first strong pack";
    return [
      {
        label: "Current setup",
        value: `${selectedTemplate?.title || "Select template"} • ${toGenerationFormatLabel(generationFormatTarget)}`,
        note: "Keep the prompt direction tight. Use section-level refinement after the first full pass instead of rewriting everything.",
        tone: selectedTemplate ? "info" : "warning",
      },
      {
        label: "Influence set",
        value: `${influenceCount} reference(s) steering the pack`,
        note:
          prioritizedReferenceCount > 0
            ? "Generation will prefer must-use and pinned references before it falls back to the board."
            : "If you do not prioritize references, the studio will fall back to the top non-excluded winners.",
      },
      {
        label: "Quality gate",
        value: qualityValue,
        note: generation
          ? qualitySignals.length > 0
            ? compactText(qualitySignals.join(" • "), 130)
            : "No banned terms, tone mismatches, duplicates, or length warnings were detected in this revision."
          : "Generate once to inspect guardrails, then refine only the sections that need work.",
        tone: generation ? (qualitySignals.length > 0 ? "warning" : "success") : "info",
      },
      {
        label: "What gets preserved",
        value: saveTarget,
        note: "Generation creates the creative raw material. Document Workspace turns it into a durable, editable artifact for the team.",
      },
    ];
  }, [
    document,
    documentDraft,
    generation,
    generationFormatTarget,
    prioritizedReferenceCount,
    qualitySignals,
    selectedReferenceIds.length,
    selectedTemplate,
  ]);

  const generationReferencePreview = useMemo(() => {
    const referenceById = new Map(references.map((item) => [item.id, item] as const));
    const activeIds = generation?.selectedReferenceIds?.length ? generation.selectedReferenceIds : selectedReferenceIds;
    return activeIds
      .map((id) => referenceById.get(id))
      .filter((item): item is ViralStudioReferenceAsset => Boolean(item))
      .slice(0, 4);
  }, [generation?.selectedReferenceIds, references, selectedReferenceIds]);

  const generationSummaryCards = useMemo<StudioDetailCard[]>(() => {
    if (!generation) {
      return [
        {
          label: "Pack status",
          value: "No pack generated yet",
          note: "Choose the template, tighten the direction, then run one full pack before section-level refinements.",
          tone: "warning",
        },
        {
          label: "What will appear",
          value: "Hooks, scripts, captions, CTAs, and angle remixes",
          note: "The studio will lay out each section as its own review card so you can refine one part without restarting the whole pack.",
        },
        {
          label: "First review pass",
          value: "Check the strongest hook, the medium script, and CTA clarity",
          note: "Those three signals tell you very quickly whether the prompt direction is on-strategy or needs another pass.",
        },
        {
          label: "Document handoff",
          value: "Best pack becomes the editable campaign draft",
          note: "Create the document only after the pack feels structurally right, not while the strategy is still drifting.",
        },
      ];
    }
    return [
      {
        label: "Pack status",
        value: `Revision ${generation.revision} • ${generation.qualityCheck.passed ? "Ready to refine" : "Needs review"}`,
        note: `Created ${formatTimestamp(generation.createdAt)} • ${generationReferencePreview.length} reference(s) influenced this run.`,
        tone: generation.qualityCheck.passed ? "success" : "warning",
      },
      {
        label: "Section mix",
        value: `${generation.outputs.hooks.length} hooks • ${generation.outputs.captions.length} captions • ${generation.outputs.ctas.length} CTAs`,
        note: "Use the section cards as an editorial pass, not as a single giant text blob.",
      },
      {
        label: "Script coverage",
        value: `${generation.outputs.scripts.short ? "Short" : ""}${generation.outputs.scripts.medium ? " • Medium" : ""}${generation.outputs.scripts.long ? " • Long" : ""}`.replace(/^ • /, ""),
        note: "Short is for speed, medium is the default working version, and long is for deeper educational or story-led variants.",
      },
      {
        label: "Document handoff",
        value: document ? `${document.title} is linked to this pack` : "No document linked yet",
        note: document
          ? "Keep refining here, then snapshot the best draft into version history."
          : "When this revision feels right, create the document so the team can edit and version it safely.",
      },
    ];
  }, [document, generation, generationReferencePreview.length]);

  const documentFocusCards = useMemo<StudioDetailCard[]>(() => {
    const latestVersion = versions[versions.length - 1] || null;
    const autosaveValue =
      autosaveState === "saving"
        ? "Saving now"
        : autosaveState === "saved"
          ? "Draft saved"
          : autosaveState === "error"
            ? "Autosave needs attention"
            : documentDirty
              ? "Unsaved edits are pending"
              : "No pending edits";
    return [
      {
        label: "Current draft",
        value: documentDraft ? `${documentDraft.title} • ${documentDraft.sections.length} section(s)` : "No document draft yet",
        note: documentDraft
          ? "Edit section titles and content directly here, then snapshot the best state into version history."
          : "Create the document from a generation pack to start editing and versioning.",
        tone: documentDraft ? "info" : "warning",
      },
      {
        label: "Autosave health",
        value: autosaveValue,
        note: "Draft edits autosave every 10 seconds while you work, but you can still force a manual save whenever you want.",
        tone: autosaveState === "error" ? "warning" : autosaveState === "saved" ? "success" : "info",
      },
      {
        label: "Version timeline",
        value: latestVersion ? `${versions.length} snapshot(s) • latest ${formatTimestamp(latestVersion.createdAt)}` : "No immutable snapshots yet",
        note: latestVersion
          ? `${latestVersion.summary || "Snapshot"} by ${latestVersion.author}. Promote any version when it should become the working draft.`
          : "Use Create Version when the draft reaches a reviewable milestone.",
      },
      {
        label: "Export vault",
        value: lastExport ? `Last export: ${lastExport.format.toUpperCase()}` : "Markdown and JSON exports are ready",
        note: lastExport
          ? compactText(lastExport.content, 130)
          : "Exports let the pack leave the studio without losing the structure you built here.",
      },
    ];
  }, [autosaveState, documentDirty, documentDraft, lastExport, versions]);

  const runWorkflowGuideAction = useCallback(async () => {
    if (workflowGuide.action === "open_intake") {
      router.push(`/app/w/${workspaceId}/intake`);
      return;
    }
    if (workflowGuide.action === "run_autofill") {
      await runAutofillFinalize();
      return;
    }
    if (workflowGuide.action === "start_extraction") {
      if (!brandReady) {
        setError("Finalize Brand DNA before starting extraction.");
        setOnboardingStep(4);
        setIsEditingBrandDna(true);
        return;
      }
      setIsBusy(true);
      setError(null);
      try {
        await startGuidedDataMaxExtraction();
      } catch (ingestionError: unknown) {
        const message = String((ingestionError as Error)?.message || "Failed to start guided extraction");
        if (message.includes("No source URL available")) {
          setShowExtractionModal(true);
        } else {
          setError(message);
        }
      } finally {
        setIsBusy(false);
      }
      return;
    }
    if (workflowGuide.action === "curate_references") {
      setIsBusy(true);
      setError(null);
      try {
        await autoCurateTopReferences(references);
      } catch (curationError: unknown) {
        setError(String((curationError as Error)?.message || "Failed to auto-curate references"));
      } finally {
        setIsBusy(false);
      }
      return;
    }
    if (workflowGuide.action === "generate_pack") {
      if (generation) {
        await sendGenerationToChat();
        return;
      }
      await generatePack();
      return;
    }
    if (generation) {
      await sendGenerationToChat();
      router.push(`/app/w/${workspaceId}`);
      return;
    }
    if (prioritizedReferenceCount > 0) {
      await sendShortlistToChat();
      router.push(`/app/w/${workspaceId}`);
      return;
    }
    router.push(`/app/w/${workspaceId}`);
  }, [
    workflowGuide.action,
    router,
    workspaceId,
    runAutofillFinalize,
    brandReady,
    references,
    generation,
    sendGenerationToChat,
    prioritizedReferenceCount,
    sendShortlistToChat,
    generatePack,
    startGuidedDataMaxExtraction,
    autoCurateTopReferences,
  ]);

  if (loading) {
    return (
      <section className="vbs-shell vbs-panel">
        <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Bootstrapping Viral Brand Studio...
        </p>
      </section>
    );
  }

  return (
    <section className="vbs-shell">
      <header className="vbs-reset-hero">
        <div>
          <p className="vbs-chip">Editorial Reset</p>
          <h1 className="vbs-title">Viral Brand Studio</h1>
          <p className="vbs-subtitle">
            One website-first creative system: define the brand, extract winners, generate a pack, and keep every revision saved.
          </p>
        </div>
        <div className="vbs-reset-meta">
          <div>
            <span>Stage</span>
            <strong>{toWorkflowStageLabel(workflowStage)}</strong>
          </div>
          <div>
            <span>Prioritized refs</span>
            <strong>{prioritizedReferenceCount}</strong>
          </div>
          <div>
            <span>Saved versions</span>
            <strong>{versions.length}</strong>
          </div>
        </div>
      </header>

      {error ? <div className="vbs-alert">{error}</div> : null}
      {chatBridgeStatus ? <div className="vbs-alert" style={{ borderColor: "#b6f0d4", background: "#f2fff7", color: "#11643f" }}>{chatBridgeStatus}</div> : null}

      <section className="vbs-launchpad">
        <div className="vbs-launchpad-main">
          <div className="vbs-launchpad-copy">
            <p className="vbs-meta">Current mission</p>
            <h2>{workflowGuide.title}</h2>
            <p>{workflowGuide.body}</p>
            <div className="vbs-actions">
              <button type="button" disabled={isBusy || autofillBusy} onClick={() => void runWorkflowGuideAction()}>
                {workflowGuide.cta}
              </button>
              <button
                type="button"
                disabled={isBusy || autofillBusy || autopilotBusy}
                onClick={() => void runWebsiteFirstAutopilot()}
              >
                {autopilotBusy ? "Running Website-First Autopilot..." : "Run Website-First Autopilot"}
              </button>
              <button type="button" onClick={() => router.push(`/app/w/${workspaceId}`)}>
                Open Core Chat
              </button>
            </div>
            {autopilotStatus ? <p className="vbs-meta">{autopilotStatus}</p> : null}
          </div>
          <div className="vbs-launchpad-strip">
            <div>
              <span>Workflow</span>
              <strong>{workflowProgressPct}% complete</strong>
            </div>
            <div>
              <span>Suggested source</span>
              <strong>{latestSuggestedSource ? latestSuggestedSource.label : "Waiting for evidence"}</strong>
            </div>
            <div>
              <span>Generation vault</span>
              <strong>{generation ? `Revision ${generation.revision}` : "No pack yet"}</strong>
            </div>
          </div>
        </div>
        <div className="vbs-process-board">
          {workflowBabySteps.map((step) => (
            <article key={step.key} className={`vbs-process-card is-${step.state}`}>
              <div className="vbs-process-card-head">
                <span>{step.eyebrow}</span>
                <strong>{step.title}</strong>
                <small>{step.state === "done" ? "Done" : step.state === "active" ? "Now" : "Up next"}</small>
              </div>
              <p>{step.body}</p>
              <div className="vbs-process-card-grid">
                <div>
                  <span>Input</span>
                  <strong>{step.input}</strong>
                </div>
                <div>
                  <span>Decision</span>
                  <strong>{step.decision}</strong>
                </div>
                <div>
                  <span>Output</span>
                  <strong>{step.output}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="vbs-launchpad-grid">
          {launchpadCards.map((card) => (
            <article key={card.id} className="vbs-launchpad-card">
              <p className="vbs-meta">{card.eyebrow}</p>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <div className="vbs-launchpad-foot">
                <strong>{card.stat}</strong>
                <button type="button" onClick={card.action}>
                  {card.actionLabel}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="vbs-stack">
        <article className="vbs-panel vbs-section-shell" id="vbs-section-onboarding">
          <div className="vbs-section-head">
            <div>
              <p className="vbs-meta">Foundation</p>
              <h2 className="vbs-panel-title">Brand DNA</h2>
              <p className="vbs-panel-subtitle">Define the brand once, then let the rest of the workflow inherit it.</p>
            </div>
            <div className="vbs-status-strip">
              <span>Intake {workflowStatus?.intakeCompleted ? "ready" : "pending"}</span>
              <span>DNA {brandReady ? "finalized" : "in progress"}</span>
              <span>{onboardingCoveragePct}% filled</span>
            </div>
          </div>
          <div className="vbs-output vbs-onboarding-progress">
            <p className="vbs-meta">
              Coverage <strong>{onboardingCoveragePct}%</strong> • Active step <strong>{onboardingStep}</strong>/4
            </p>
            <div className="vbs-progress-track" aria-hidden="true">
              <span style={{ width: `${Math.max(8, Math.min(100, onboardingCoveragePct))}%` }} />
            </div>
            <div className="vbs-onboarding-step-grid">
              {ONBOARDING_STEP_META.map((item) => {
                const state =
                  item.step < onboardingStep
                    ? "done"
                    : item.step === onboardingStep
                      ? "active"
                      : isStepValid(item.step, brandForm)
                        ? "ready"
                        : "upcoming";
                return (
                  <button
                    key={item.step}
                    type="button"
                    className={[
                      "vbs-onboarding-step",
                      state === "active" ? "is-active" : "",
                      state === "done" ? "is-done" : "",
                      state === "ready" ? "is-ready" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setOnboardingStep(item.step)}
                  >
                    <span>{item.step}</span>
                    <strong>{item.title}</strong>
                    <p>{item.subtitle}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="vbs-output vbs-foundation-note">
            <p className="vbs-meta">
              Viral Studio now behaves like one continuous system: approve foundation once, let references inherit that
              context, then generate and save without re-explaining the brand every step.
            </p>
          </div>
          <div className="vbs-detail-grid">
            {foundationDetailCards.map((card) => (
              <article key={card.label} className={detailCardClassName(card)}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <p>{card.note}</p>
              </article>
            ))}
          </div>
          <div className="vbs-output vbs-autofill-panel">
            <div className="vbs-mini-actions">
              <button type="button" disabled={autofillBusy || isBusy} onClick={() => void previewAutofill()}>
                {autofillBusy ? "Loading preview..." : "Preview Autofill"}
              </button>
              <button
                type="button"
                disabled={autofillBusy || isBusy || !autofillPreview || selectedAutofillCount === 0}
                onClick={() => void applyAutofill()}
              >
                Apply Selected ({selectedAutofillCount})
              </button>
            </div>
            <p className="vbs-meta">
              Preview-then-apply mode from intake + website + social evidence. Confidence{" "}
              <strong>
                {autofillPreview ? `${Math.round((autofillPreview.suggestionConfidence || 0) * 100)}%` : "n/a"}
              </strong>
              {" • "}
              Coverage{" "}
              <strong>
                {autofillPreview?.coverage.suggestedCount || 0} field(s)
              </strong>
            </p>
            {autofillPreview ? (
              <div className="vbs-autofill-list">
                {orderedAutofillFields.map((field) => {
                  const suggestion = autofillPreview.fieldSuggestions[field];
                  if (!suggestion) return null;
                  return (
                    <label key={field} className="vbs-autofill-item">
                      <span className="vbs-autofill-row">
                        <input
                          type="checkbox"
                          checked={autofillSelection[field] !== false}
                          onChange={() => toggleAutofillField(field)}
                        />
                        <strong>{toAutofillFieldLabel(field)}</strong>
                        <span className="vbs-meta">{Math.round((suggestion.confidence || 0) * 100)}%</span>
                      </span>
                      <span className="vbs-meta">{compactText(suggestion.rationale, 220)}</span>
                      <span className="vbs-meta">
                        Evidence:{" "}
                        {suggestion.sourceEvidence
                          .slice(0, 2)
                          .map((entry) => entry.label)
                          .filter(Boolean)
                          .join(" • ") || "n/a"}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="vbs-meta">
                No autofill preview loaded yet. Use preview to hydrate fields from workspace evidence.
              </p>
            )}
          </div>
          <div className="vbs-output">
            <h3>Suggested Extraction Sources (Data-max)</h3>
            {suggestedSources.length ? (
              <div className="vbs-source-suggest-list">
                {suggestedSources.slice(0, 8).map((source) => (
                  <div key={`${source.platform}:${source.sourceUrl}`} className="vbs-source-suggest-row">
                    <div>
                      <p>
                        <strong>{toPlatformLabel(source.platform)}</strong> • {source.label}
                      </p>
                      <p className="vbs-meta">
                        Confidence {Math.round((source.confidence || 0) * 100)}% • {source.sourceUrl}
                      </p>
                    </div>
                    <button type="button" disabled={isBusy} onClick={() => selectSuggestedSource(source)}>
                      Use Source
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="vbs-meta">No social/profile suggestions detected yet in intake evidence.</p>
            )}
          </div>

          {brandReady && !isEditingBrandDna ? (
            <div className="vbs-output">
              <p className="vbs-meta">Brand DNA is finalized and active.</p>
              <p>{brandProfile?.summary}</p>
              <div className="vbs-actions">
                <button type="button" onClick={() => setIsEditingBrandDna(true)}>Edit Brand DNA</button>
              </div>
            </div>
          ) : (
            <div className="vbs-dna-flow">
              <aside className="vbs-dna-sidecar">
                <div className="vbs-dna-step-card">
                  <p className="vbs-meta">Step {activeOnboardingMeta.step} of 4</p>
                  <h3>{activeOnboardingMeta.title}</h3>
                  <p>{activeOnboardingMeta.helper}</p>
                </div>
                <div className="vbs-dna-prompt-list">
                  {activeOnboardingMeta.prompts.map((prompt) => (
                    <div key={prompt} className="vbs-dna-prompt-chip">
                      {prompt}
                    </div>
                  ))}
                </div>
                <div className="vbs-output vbs-dna-tone-card">
                  <p className="vbs-meta">Live tone preview</p>
                  <p>{tonePreview(brandForm)}</p>
                </div>
              </aside>

              <div className="vbs-dna-main">
                <div className="vbs-dna-step-tabs">
                  {ONBOARDING_STEP_META.map((item) => (
                    <button
                      key={item.step}
                      type="button"
                      className={item.step === onboardingStep ? "vbs-chip-toggle is-active" : "vbs-chip-toggle"}
                      onClick={() => setOnboardingStep(item.step)}
                    >
                      {item.step}. {item.title}
                    </button>
                  ))}
                </div>

                {onboardingStep === 1 ? (
                  <div className="vbs-dna-form-card">
                    <div className="vbs-dna-inline-grid">
                      <label className="vbs-dna-field">
                        <span>Mission</span>
                        <textarea
                          rows={3}
                          aria-label="Mission"
                          placeholder="We help premium skincare brands turn social attention into repeatable sales."
                          value={brandForm.mission}
                          onChange={(e) => setBrandForm((p) => ({ ...p, mission: e.target.value }))}
                        />
                      </label>
                      <label className="vbs-dna-field">
                        <span>Value proposition</span>
                        <textarea
                          rows={3}
                          aria-label="Value Proposition"
                          placeholder="Fast, strategy-led creative systems that turn research into campaign-ready content."
                          value={brandForm.valueProposition}
                          onChange={(e) => setBrandForm((p) => ({ ...p, valueProposition: e.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="vbs-dna-inline-grid">
                      <label className="vbs-dna-field">
                        <span>Product or service</span>
                        <input
                          aria-label="Product / Service"
                          placeholder="Brand strategy, viral content systems, creative production"
                          value={brandForm.productOrService}
                          onChange={(e) => setBrandForm((p) => ({ ...p, productOrService: e.target.value }))}
                        />
                      </label>
                      <label className="vbs-dna-field">
                        <span>Region</span>
                        <input
                          aria-label="Region"
                          placeholder="GCC, MENA, global ecommerce, United States"
                          value={brandForm.region}
                          onChange={(e) => setBrandForm((p) => ({ ...p, region: e.target.value }))}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 2 ? (
                  <div className="vbs-dna-form-card">
                    <div className="vbs-dna-inline-grid">
                      <label className="vbs-dna-field">
                        <span>Audience personas</span>
                        <textarea
                          rows={4}
                          aria-label="Audience Personas"
                          placeholder="Founders, growth leads, brand managers, clinic owners"
                          value={brandForm.audiencePersonas}
                          onChange={(e) => setBrandForm((p) => ({ ...p, audiencePersonas: e.target.value }))}
                        />
                      </label>
                      <label className="vbs-dna-field">
                        <span>Pains</span>
                        <textarea
                          rows={4}
                          aria-label="Pains"
                          placeholder="Inconsistent content, low converting traffic, unclear brand message"
                          value={brandForm.pains}
                          onChange={(e) => setBrandForm((p) => ({ ...p, pains: e.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="vbs-dna-inline-grid">
                      <label className="vbs-dna-field">
                        <span>Desires</span>
                        <textarea
                          rows={4}
                          aria-label="Desires"
                          placeholder="Higher trust, sharper positioning, campaign ideas that actually perform"
                          value={brandForm.desires}
                          onChange={(e) => setBrandForm((p) => ({ ...p, desires: e.target.value }))}
                        />
                      </label>
                      <label className="vbs-dna-field">
                        <span>Objections</span>
                        <textarea
                          rows={4}
                          aria-label="Objections"
                          placeholder="Too expensive, not sure it fits our market, unclear proof"
                          value={brandForm.objections}
                          onChange={(e) => setBrandForm((p) => ({ ...p, objections: e.target.value }))}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 3 ? (
                  <div className="vbs-dna-form-card">
                    <div className="vbs-slider-grid">
                      <label className="vbs-dna-slider-card">
                        <span>Bold</span>
                        <strong>{brandForm.voiceBold}</strong>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={brandForm.voiceBold}
                          onChange={(e) => setBrandForm((p) => ({ ...p, voiceBold: Number(e.target.value) }))}
                        />
                      </label>
                      <label className="vbs-dna-slider-card">
                        <span>Formal</span>
                        <strong>{brandForm.voiceFormal}</strong>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={brandForm.voiceFormal}
                          onChange={(e) => setBrandForm((p) => ({ ...p, voiceFormal: Number(e.target.value) }))}
                        />
                      </label>
                      <label className="vbs-dna-slider-card">
                        <span>Playful</span>
                        <strong>{brandForm.voicePlayful}</strong>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={brandForm.voicePlayful}
                          onChange={(e) => setBrandForm((p) => ({ ...p, voicePlayful: Number(e.target.value) }))}
                        />
                      </label>
                      <label className="vbs-dna-slider-card">
                        <span>Direct</span>
                        <strong>{brandForm.voiceDirect}</strong>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={brandForm.voiceDirect}
                          onChange={(e) => setBrandForm((p) => ({ ...p, voiceDirect: Number(e.target.value) }))}
                        />
                      </label>
                    </div>
                    <div className="vbs-dna-inline-grid">
                      <label className="vbs-dna-field">
                        <span>Banned phrases</span>
                        <textarea
                          rows={4}
                          aria-label="Banned Phrases"
                          placeholder="best in class, disrupt, game-changing"
                          value={brandForm.bannedPhrases}
                          onChange={(e) => setBrandForm((p) => ({ ...p, bannedPhrases: e.target.value }))}
                        />
                      </label>
                      <label className="vbs-dna-field">
                        <span>Required claims</span>
                        <textarea
                          rows={4}
                          aria-label="Required Claims"
                          placeholder="Doctor-led, evidence-backed, cruelty-free, available across GCC"
                          value={brandForm.requiredClaims}
                          onChange={(e) => setBrandForm((p) => ({ ...p, requiredClaims: e.target.value }))}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {onboardingStep === 4 ? (
                  <div className="vbs-dna-form-card">
                    <label className="vbs-dna-field">
                      <span>Exemplar inputs</span>
                      <textarea
                        rows={4}
                        aria-label="Exemplar Inputs"
                        placeholder="Paste strong posts, brand lines, landing page copy, or campaign examples"
                        value={brandForm.exemplars}
                        onChange={(e) => setBrandForm((p) => ({ ...p, exemplars: e.target.value }))}
                      />
                    </label>
                    <label className="vbs-dna-field">
                      <span>Brand DNA summary</span>
                      <textarea
                        rows={6}
                        aria-label="Brand DNA Summary"
                        placeholder="Summarize the brand in a way the generation system can reuse across outputs"
                        value={brandForm.summary}
                        onChange={(e) => setBrandForm((p) => ({ ...p, summary: e.target.value }))}
                      />
                    </label>
                    <div className="vbs-mini-actions">
                      <button type="button" disabled={onboardingStep !== 4 || isBusy} onClick={() => void generateSummary()}>
                        Generate AI Summary
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="vbs-actions">
                  <button
                    type="button"
                    disabled={onboardingStep === 1 || isBusy}
                    onClick={() => setOnboardingStep((Math.max(1, onboardingStep - 1) as 1 | 2 | 3 | 4))}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={onboardingStep === 4 || !isStepValid(onboardingStep, brandForm) || isBusy}
                    onClick={() => setOnboardingStep((Math.min(4, onboardingStep + 1) as 1 | 2 | 3 | 4))}
                  >
                    Next
                  </button>
                  <button type="button" disabled={isBusy} onClick={() => void saveBrandDna("draft")}>
                    Save Draft
                  </button>
                  <button type="button" disabled={!isStepValid(4, brandForm) || isBusy} onClick={() => void saveBrandDna("final")}>
                    Finalize DNA
                  </button>
                  {brandProfile ? (
                    <button type="button" disabled={isBusy} onClick={() => setBrandForm(toFormState(brandProfile))}>
                      Reset Draft
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          <p className="vbs-meta">
            Status: <strong>{brandProfile?.status || "draft"}</strong> • Ready: <strong>{brandProfile?.completeness.ready ? "yes" : "no"}</strong> • Updated: {formatTimestamp(brandProfile?.updatedAt)}
          </p>
        </article>

        {canAccessDiagnostics ? (
          <article className="vbs-panel vbs-dev-drawer" id="vbs-section-diagnostics">
            <div className="vbs-diagnostics-head">
              <div>
                <p className="vbs-meta">Developer Access</p>
                <h2 className="vbs-panel-title">Diagnostics Drawer</h2>
                <p className="vbs-panel-subtitle">State contracts, telemetry, and runtime health for admin or local debugging only.</p>
              </div>
              <button type="button" onClick={() => setShowDiagnostics((previous) => !previous)}>
                {showDiagnostics ? "Hide Drawer" : "Open Drawer"}
              </button>
            </div>
            {showDiagnostics ? (
              <>
                <div className="vbs-contract-grid">
                  <div>
                    <h3>State Machines</h3>
                    <ul>
                      <li>Onboarding: {contracts?.stateMachines.onboarding.states.join(" → ") || "n/a"}</li>
                      <li>Ingestion: {contracts?.stateMachines.ingestion.states.join(" → ") || "n/a"}</li>
                      <li>Generation: {contracts?.stateMachines.generation.states.join(" → ") || "n/a"}</li>
                      <li>Document: {contracts?.stateMachines.document.states.join(" → ") || "n/a"}</li>
                    </ul>
                  </div>
                  <div>
                    <h3>Telemetry</h3>
                    <ul>
                      {(contracts?.telemetryEvents || []).slice(0, 7).map((event) => <li key={event.name}>{event.name}</li>)}
                    </ul>
                  </div>
                </div>
                <div className="vbs-telemetry-grid">
                  <div className="vbs-output">
                    <h3>Runtime Funnel</h3>
                    <ul>
                      <li>Onboarding finalized: {telemetry?.funnel.onboardingFinalized ? "yes" : "no"}</li>
                      <li>Ingestions started: {telemetry?.funnel.ingestionsStarted ?? 0}</li>
                      <li>Ingestions completed: {telemetry?.funnel.ingestionsCompleted ?? 0}</li>
                      <li>Ingestions failed: {telemetry?.funnel.ingestionsFailed ?? 0}</li>
                      <li>Generations completed: {telemetry?.funnel.generationsCompleted ?? 0}</li>
                      <li>Documents versioned: {telemetry?.funnel.documentsVersioned ?? 0}</li>
                      <li>Exports: {telemetry?.funnel.exports ?? 0}</li>
                    </ul>
                  </div>
                  <div className="vbs-output">
                    <h3>Latency (Avg)</h3>
                    <div className="vbs-telemetry-kpi">
                      <div>
                        <span>Ingestion</span>
                        <strong>{formatDurationMs(telemetry?.latencyMs.ingestionAvg ?? 0)}</strong>
                      </div>
                      <div>
                        <span>Generation</span>
                        <strong>{formatDurationMs(telemetry?.latencyMs.generationAvg ?? 0)}</strong>
                      </div>
                      <div>
                        <span>Document</span>
                        <strong>{formatDurationMs(telemetry?.latencyMs.documentAvg ?? 0)}</strong>
                      </div>
                    </div>
                    <p className="vbs-meta">Recent runtime events: {telemetry?.recent.length ?? 0}</p>
                  </div>
                </div>
                <div className="vbs-telemetry-grid">
                  <div className="vbs-output">
                    <h3>Error Classes</h3>
                    {telemetry && Object.keys(telemetry.errorClasses).length > 0 ? (
                      <ul>
                        {Object.entries(telemetry.errorClasses)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 8)
                          .map(([name, count]) => (
                            <li key={name}>
                              {name}: {count}
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="vbs-meta">No runtime errors recorded in this telemetry window.</p>
                    )}
                  </div>
                  <div className="vbs-output">
                    <h3>Recent Events</h3>
                    {telemetry?.recent.length ? (
                      <ul>
                        {telemetry.recent
                          .slice()
                          .reverse()
                          .slice(0, 8)
                          .map((event) => (
                            <li key={`${event.at}-${event.name}`}>
                              [{event.status}] {event.name} ({event.stage}) • {formatDurationMs(event.durationMs)} •{" "}
                              {formatTimestamp(event.at)}
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="vbs-meta">No events yet.</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="vbs-output">
                <p className="vbs-meta">
                  Diagnostics stay out of the main product flow. Open this drawer only when you need to debug runtime behavior.
                </p>
              </div>
            )}
          </article>
        ) : null}
      </div>

      {!onboardingLocked ? (
        <>
          <article className="vbs-panel vbs-section-shell">
            <div className="vbs-section-head">
              <div>
                <p className="vbs-meta">Reference Engine</p>
                <h2 className="vbs-panel-title">Extract, rank, and curate</h2>
                <p className="vbs-panel-subtitle">
                  Pull the strongest source, monitor the run, and shortlist only what should influence generation.
                </p>
              </div>
              <div className="vbs-status-strip">
                <span>{activeIngestion ? statusLabel(activeIngestion.status) : "No run yet"}</span>
                <span>{references.length} references</span>
                <span>{prioritizedReferenceCount} prioritized</span>
              </div>
            </div>
            <div className="vbs-detail-grid vbs-detail-grid-compact">
              {referenceDetailCards.map((card) => (
                <article key={card.label} className={detailCardClassName(card)}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </article>
              ))}
            </div>
            <div className="vbs-grid">
              <article className="vbs-panel" id="vbs-section-extraction">
              <h2 className="vbs-panel-title">Competitor Extraction</h2>
              <div className="vbs-detail-grid vbs-detail-grid-compact">
                {extractionFocusCards.map((card) => (
                  <article key={card.label} className={detailCardClassName(card)}>
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                    <p>{card.note}</p>
                  </article>
                ))}
              </div>
              {suggestedSources.length ? (
                <div className="vbs-source-suggest-list">
                  {suggestedSources.slice(0, 3).map((source) => (
                    <div key={`${source.platform}:${source.sourceUrl}:reference-engine`} className="vbs-source-suggest-row">
                      <div>
                        <p>
                          <strong>{source.label}</strong>
                        </p>
                        <p className="vbs-meta">
                          {toPlatformLabel(source.platform)} • {Math.round((source.confidence || 0) * 100)}% confidence •{" "}
                          {compactText(source.sourceUrl, 96)}
                        </p>
                      </div>
                      <button type="button" disabled={isBusy} onClick={() => selectSuggestedSource(source)}>
                        Use Source
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="vbs-actions">
                <button type="button" onClick={() => setShowExtractionModal(true)} disabled={isBusy}>
                  Extract Best Videos
                </button>
                <button
                  type="button"
                  disabled={
                    isBusy ||
                    !activeIngestion ||
                    (activeIngestion.status !== "failed" && activeIngestion.status !== "partial")
                  }
                  onClick={() => activeIngestion && void retryExtraction(activeIngestion.id)}
                >
                  Retry Active Run
                </button>
              </div>
              {activeIngestion ? (
                <div className="vbs-output">
                  <p className="vbs-meta">
                    Active run: {toPlatformLabel(activeIngestion.sourcePlatform)} • {statusLabel(activeIngestion.status)} • Attempt{" "}
                    {activeIngestion.attempt || 1}
                  </p>
                  <p className="vbs-meta">
                    Preset {toPresetLabel(activeIngestion.preset)} • {activeIngestion.maxVideos} videos •{" "}
                    {activeIngestion.lookbackDays} days • Auto-refresh every 0.9s
                  </p>
                  <div className="vbs-ingestion-timeline">
                    {ingestionTimeline.map((item) => (
                      <div key={item.key} className="vbs-ingestion-step">
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                  {activeIngestion.error ? <p className="vbs-meta">Last warning: {activeIngestion.error}</p> : null}
                </div>
              ) : <p className="vbs-meta">No run yet.</p>}
              <p className="vbs-meta">Run history ({ingestions.length})</p>
              <div className="vbs-run-history">
                {ingestions.slice(0, 6).map((run) => (
                  <div key={run.id} className="vbs-run-row">
                    <div>
                      <p>
                        {toPlatformLabel(run.sourcePlatform)} • {statusLabel(run.status)} • Attempt {run.attempt || 1}
                      </p>
                      <p className="vbs-meta">
                        {run.progress.ranked}/{run.progress.found || run.maxVideos} ranked • {formatTimestamp(run.createdAt)}
                      </p>
                    </div>
                    <div className="vbs-mini-actions">
                      <button type="button" onClick={() => void openIngestionResults(run)} disabled={isBusy}>
                        View Results
                      </button>
                      <button
                        type="button"
                        onClick={() => void retryExtraction(run.id)}
                        disabled={isBusy || (run.status !== "failed" && run.status !== "partial")}
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                ))}
                {ingestions.length === 0 ? <p className="vbs-meta">No extraction history yet.</p> : null}
              </div>
              </article>

              <article className="vbs-panel">
              <h2 className="vbs-panel-title">Reference Curation</h2>
              <p className="vbs-panel-subtitle">Ranked board with explainability, filter chips, and expandable analysis drawer.</p>
              <div className="vbs-detail-grid vbs-detail-grid-compact">
                {curationFocusCards.map((card) => (
                  <article key={card.label} className={detailCardClassName(card)}>
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                    <p>{card.note}</p>
                  </article>
                ))}
              </div>
              <div className="vbs-reference-toolbar">
                <div className="vbs-mini-actions">
                  <button
                    type="button"
                    aria-pressed={referenceViewMode === "grid"}
                    className={referenceViewMode === "grid" ? "vbs-chip-toggle is-active" : "vbs-chip-toggle"}
                    onClick={() => setReferenceViewMode("grid")}
                  >
                    Grid
                  </button>
                  <button
                    type="button"
                    aria-pressed={referenceViewMode === "list"}
                    className={referenceViewMode === "list" ? "vbs-chip-toggle is-active" : "vbs-chip-toggle"}
                    onClick={() => setReferenceViewMode("list")}
                  >
                    List
                  </button>
                </div>
                <div className="vbs-mini-actions">
                  {[
                    { key: "all", label: "All" },
                    { key: "prioritized", label: "Prioritized" },
                    { key: "must-use", label: "Must-use" },
                    { key: "pin", label: "Pinned" },
                    { key: "exclude", label: "Excluded" },
                  ].map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      aria-pressed={referenceFilter === chip.key}
                      className={referenceFilter === chip.key ? "vbs-chip-toggle is-active" : "vbs-chip-toggle"}
                      onClick={() =>
                        setReferenceFilter(
                          chip.key as "all" | "prioritized" | "must-use" | "pin" | "exclude"
                        )
                      }
                    >
                      {chip.label} ({referenceCounts[chip.key as keyof typeof referenceCounts]})
                    </button>
                  ))}
                </div>
              </div>
              {curationNotice ? (
                <p className="vbs-curation-notice" role="status" aria-live="polite">
                  {curationNotice}
                </p>
              ) : null}
              <div className="vbs-mini-actions" style={{ marginTop: "0.45rem" }}>
                {(["all", "instagram", "tiktok", "youtube"] as const).map((platform) => (
                  <button
                    key={platform}
                    type="button"
                    aria-pressed={referencePlatformFilter === platform}
                    className={referencePlatformFilter === platform ? "vbs-chip-toggle is-active" : "vbs-chip-toggle"}
                    onClick={() => setReferencePlatformFilter(platform)}
                  >
                    {platform === "all" ? "All Platforms" : toPlatformLabel(platform)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void sendShortlistToChat()}
                  disabled={isBusy || filteredReferences.length === 0}
                >
                  Send Filtered Shortlist To Chat
                </button>
              </div>
              <div className={referenceViewMode === "grid" ? "vbs-reference-board-grid" : "vbs-reference-board-list"}>
                {filteredReferences.map((reference) => {
                  const cardDetail = referenceCardDetails.get(reference.id) || buildReferenceCardDetail(reference);
                  const visualStyle = (cardDetail.mediaUrl
                    ? {
                        backgroundImage: `linear-gradient(180deg, rgba(11,19,43,0.18), rgba(11,19,43,0.82)), url("${cardDetail.mediaUrl}")`,
                      }
                    : {
                        ["--vbs-reference-accent" as const]: cardDetail.palette[0],
                        ["--vbs-reference-accent-soft" as const]: cardDetail.palette[1],
                        ["--vbs-reference-accent-deep" as const]: cardDetail.palette[2],
                      }) as CSSProperties;
                  return (
                    <div
                      key={reference.id}
                      className={[
                        "vbs-reference-card",
                        selectedReference?.id === reference.id ? "is-selected" : "",
                        recentShortlistReferenceId === reference.id ? "is-updated" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <button
                        type="button"
                        className="vbs-reference-card-head"
                        onClick={() => setSelectedReferenceId(reference.id)}
                      >
                        <div className="vbs-reference-visual" style={visualStyle}>
                          <span className="vbs-rank-badge">#{reference.ranking.rank}</span>
                          <div className="vbs-reference-visual-copy">
                            <small>{cardDetail.eyebrow}</small>
                            <strong>{cardDetail.headline}</strong>
                            <p>{cardDetail.footer}</p>
                          </div>
                        </div>
                        <div className="vbs-reference-card-topline">
                          <p className="vbs-reference-title">{reference.ranking.rationaleTitle}</p>
                          <p className="vbs-meta">
                            {toPlatformLabel(reference.sourcePlatform)} • score {reference.scores.composite.toFixed(3)} •{" "}
                            {shortlistLabel(reference.shortlistState)}
                          </p>
                        </div>
                        <div className="vbs-reference-card-insight-grid">
                          <div>
                            <span>Best use</span>
                            <strong>{cardDetail.bestUse}</strong>
                          </div>
                          <div>
                            <span>Lead driver</span>
                            <strong>
                              {cardDetail.primaryContributionLabel} • {(cardDetail.primaryContributionValue * 100).toFixed(1)} pts
                            </strong>
                          </div>
                        </div>
                        <div className="vbs-reference-metric-strip">
                          <div>
                            <span>Views</span>
                            <strong>{formatCompactNumber(reference.metrics.views)}</strong>
                          </div>
                          <div>
                            <span>Interaction</span>
                            <strong>{formatUnitPercent(cardDetail.interactionRate)}</strong>
                          </div>
                          <div>
                            <span>Age</span>
                            <strong>{cardDetail.ageDays === null ? "n/a" : `${cardDetail.ageDays}d`}</strong>
                          </div>
                        </div>
                        <div className="vbs-top-driver-row vbs-top-driver-row-compact">
                          {reference.explainability.topDrivers.slice(0, 3).map((driver) => (
                            <span key={driver} className="vbs-driver-chip">
                              {driver}
                            </span>
                          ))}
                        </div>
                        {cardDetail.secondaryContributionLabel ? (
                          <p className="vbs-meta">
                            Second driver: {cardDetail.secondaryContributionLabel} •{" "}
                            {(Number(cardDetail.secondaryContributionValue || 0) * 100).toFixed(1)} pts
                          </p>
                        ) : null}
                        <ul className="vbs-reference-bullets">
                          {cardDetail.bullets.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </button>
                    <div className="vbs-mini-actions vbs-shortlist-actions">
                      {(
                        [
                          { key: "pin", label: "Pin" },
                          { key: "must-use", label: "Must-use" },
                          { key: "exclude", label: "Exclude" },
                          { key: "clear", label: "Clear" },
                        ] as Array<{ key: ReferenceShortlistAction; label: string }>
                      ).map((item) => {
                        const pendingAction = shortlistPendingById[reference.id];
                        const isPending = pendingAction === item.key;
                        const isActive =
                          item.key === "clear"
                            ? reference.shortlistState === "none"
                            : reference.shortlistState === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            aria-pressed={isActive}
                            className={[
                              "vbs-action-chip",
                              `vbs-action-${item.key}`,
                              isActive ? "is-active" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={() => void shortlistReference(reference.id, item.key)}
                            disabled={Boolean(pendingAction)}
                          >
                            {isPending ? `${item.label}…` : item.label}
                          </button>
                        );
                      })}
                    </div>
                    </div>
                  );
                })}
              </div>
              {filteredReferences.length === 0 ? <p className="vbs-meta">No references match current filters.</p> : null}
              {selectedReference && selectedReferenceInsights && selectedReferenceCardDetail ? (
                <div className="vbs-analysis-drawer" style={selectedReferenceDrawerStyle}>
                  <div className="vbs-analysis-hero">
                    <div className="vbs-reference-visual vbs-analysis-visual" style={selectedReferenceVisualStyle}>
                      <span className="vbs-rank-badge">#{selectedReference.ranking.rank}</span>
                      <div className="vbs-reference-visual-copy">
                        <small>{selectedReferenceCardDetail.eyebrow}</small>
                        <strong>{selectedReferenceCardDetail.headline}</strong>
                        <p>{selectedReferenceCardDetail.footer}</p>
                      </div>
                    </div>
                    <div className="vbs-analysis-overview">
                      <div className="vbs-analysis-overview-head">
                        <p className="vbs-meta">
                          Expanded analysis • {toPlatformLabel(selectedReference.sourcePlatform)} •{" "}
                          {shortlistLabel(selectedReference.shortlistState)}
                        </p>
                        <div className="vbs-top-driver-row vbs-top-driver-row-compact">
                          {selectedReference.explainability.topDrivers.map((driver) => (
                            <span key={driver} className="vbs-driver-chip">
                              {driver}
                            </span>
                          ))}
                        </div>
                      </div>
                      <h3>{selectedReference.ranking.rationaleTitle}</h3>
                      <p className="vbs-analysis-summary">
                        {selectedReferenceCardDetail.bestUse} This expanded state keeps the same creative object in view
                        while exposing the ranking logic underneath it.
                      </p>
                      <div className="vbs-reference-card-insight-grid vbs-analysis-insight-grid">
                        <div>
                          <span>Best use</span>
                          <strong>{selectedReferenceCardDetail.bestUse}</strong>
                        </div>
                        <div>
                          <span>Lead driver</span>
                          <strong>
                            {selectedReferenceCardDetail.primaryContributionLabel} •{" "}
                            {(selectedReferenceCardDetail.primaryContributionValue * 100).toFixed(1)} pts
                          </strong>
                        </div>
                      </div>
                      <div className="vbs-reference-metric-strip vbs-analysis-metric-strip">
                        <div>
                          <span>Views</span>
                          <strong>{formatCompactNumber(selectedReference.metrics.views)}</strong>
                        </div>
                        <div>
                          <span>Interaction</span>
                          <strong>{formatUnitPercent(selectedReferenceCardDetail.interactionRate)}</strong>
                        </div>
                        <div>
                          <span>Age</span>
                          <strong>
                            {selectedReferenceCardDetail.ageDays === null ? "n/a" : `${selectedReferenceCardDetail.ageDays}d`}
                          </strong>
                        </div>
                      </div>
                      <ul className="vbs-reference-bullets vbs-analysis-preview-bullets">
                        {selectedReferenceCardDetail.bullets.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="vbs-analysis-story-grid">
                    <section className="vbs-analysis-section">
                      <div className="vbs-analysis-section-head">
                        <div>
                          <p className="vbs-meta">Score pulse</p>
                          <h4>Why this keeps winning on the board</h4>
                        </div>
                        <span className="vbs-analysis-chip">
                          {selectedReferenceInsights.compositeDelta >= 0 ? "Above board average" : "Below board average"}
                        </span>
                      </div>
                      <div className="vbs-analysis-kpi-grid">
                        <div>
                          <span>Composite</span>
                          <strong>{selectedReference.scores.composite.toFixed(3)}</strong>
                          <p
                            className={
                              selectedReferenceInsights.compositeDelta >= 0 ? "vbs-delta-positive" : "vbs-delta-negative"
                            }
                          >
                            {selectedReferenceInsights.compositeDelta >= 0 ? "+" : ""}
                            {selectedReferenceInsights.compositeDelta.toFixed(3)} vs board avg{" "}
                            {selectedReferenceInsights.avgComposite.toFixed(3)}
                          </p>
                        </div>
                        <div>
                          <span>Views</span>
                          <strong>{formatCompactNumber(selectedReference.metrics.views)}</strong>
                          <p>{selectedReference.metrics.likes} likes • {selectedReference.metrics.comments} comments</p>
                        </div>
                        <div>
                          <span>Interaction Rate</span>
                          <strong>{formatUnitPercent(selectedReferenceInsights.interactionRateRaw)}</strong>
                          <p>{selectedReference.metrics.shares} shares</p>
                        </div>
                        <div>
                          <span>Recency</span>
                          <strong>
                            {selectedReferenceInsights.postedAgeDays === null
                              ? "n/a"
                              : `${selectedReferenceInsights.postedAgeDays}d ago`}
                          </strong>
                          <p>{formatTimestamp(selectedReference.metrics.postedAt)}</p>
                        </div>
                      </div>
                    </section>

                    <section className="vbs-analysis-section">
                      <div className="vbs-analysis-section-head">
                        <div>
                          <p className="vbs-meta">Editorial read</p>
                          <h4>What to borrow and what to preserve</h4>
                        </div>
                        <span className="vbs-analysis-chip">
                          {selectedReferenceCardDetail.secondaryContributionLabel
                            ? `Second driver: ${selectedReferenceCardDetail.secondaryContributionLabel}`
                            : "Single dominant angle"}
                        </span>
                      </div>
                      <ul className="vbs-analysis-rationale-list">
                        {selectedReference.explainability.whyRankedHigh.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </section>
                  </div>

                  <div className="vbs-analysis-story-grid">
                    <section className="vbs-analysis-section">
                      <div className="vbs-analysis-section-head">
                        <div>
                          <p className="vbs-meta">Contribution map</p>
                          <h4>Weighted drivers</h4>
                        </div>
                        <span className="vbs-analysis-chip">
                          Formula {selectedReference.explainability.formulaVersion}
                        </span>
                      </div>
                      <div className="vbs-analysis-grid">
                        {selectedReferenceInsights.contributionRows.map(({ key, value }) => (
                          <div key={key} className="vbs-analysis-metric">
                            <p>{contributionLabel(key)}</p>
                            <strong>{(Number(value) * 100).toFixed(1)} pts</strong>
                            <div className="vbs-analysis-bar">
                              <span style={{ width: `${Math.max(6, Math.min(100, Number(value) * 320))}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="vbs-analysis-section">
                      <div className="vbs-analysis-section-head">
                        <div>
                          <p className="vbs-meta">Normalized read</p>
                          <h4>Cross-platform strength profile</h4>
                        </div>
                        <span className="vbs-analysis-chip">Comparable metrics</span>
                      </div>
                      <div className="vbs-analysis-grid vbs-normalized-grid">
                        {selectedReferenceInsights.normalizedRows.map(({ key, value }) => (
                          <div key={key} className="vbs-analysis-metric">
                            <p>{normalizedMetricLabel(key)}</p>
                            <strong>{value.toFixed(1)}%</strong>
                            <div className="vbs-analysis-bar">
                              <span style={{ width: `${Math.max(6, Math.min(100, value))}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>

                  <div className="vbs-source-context vbs-analysis-section">
                    <div className="vbs-analysis-section-head">
                      <div>
                        <p className="vbs-meta">Source context</p>
                        <h4>Transcript, caption, and OCR cues</h4>
                      </div>
                      <span className="vbs-analysis-chip">Shortcuts: 1 pin, 2 must-use, 3 exclude, 0 clear</span>
                    </div>
                    <div className="vbs-analysis-source-grid">
                      <article>
                        <span>Caption</span>
                        <p className="vbs-meta">{selectedReference.caption}</p>
                      </article>
                      <article>
                        <span>Transcript summary</span>
                        <p className="vbs-meta">{selectedReference.transcriptSummary}</p>
                      </article>
                      <article>
                        <span>OCR summary</span>
                        <p className="vbs-meta">{selectedReference.ocrSummary}</p>
                      </article>
                    </div>
                  </div>
                </div>
              ) : null}
              </article>
            </div>
          </article>

          <article className="vbs-panel vbs-section-shell" id="vbs-section-create-save">
            <div className="vbs-section-head">
              <div>
                <p className="vbs-meta">Create & Save</p>
                <h2 className="vbs-panel-title">Generate, refine, and keep every revision</h2>
                <p className="vbs-panel-subtitle">
                  Build the pack, edit the durable document, and let the studio keep version history automatically.
                </p>
              </div>
              <div className="vbs-status-strip">
                <span>
                  {formatGeneration
                    ? `${toContentTypeLabel(formatGeneration.contentType)} ready`
                    : generation
                      ? `Revision ${generation.revision}`
                      : "No generation yet"}
                </span>
                <span>{document ? "Document ready" : "Document pending"}</span>
                <span>{versions.length} versions</span>
              </div>
            </div>
            <div className="vbs-detail-grid vbs-detail-grid-compact">
              {createDetailCards.map((card) => (
                <article key={card.label} className={detailCardClassName(card)}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                  <p>{card.note}</p>
                </article>
              ))}
            </div>
            <div className="vbs-grid">
              <article className="vbs-panel vbs-prompt-studio" id="vbs-section-generation">
              <h2 className="vbs-panel-title">Staged Generation Planner</h2>
              <p className="vbs-panel-subtitle">
                Move through one baby step at a time: pick the design pattern, lock the message, choose one format, then save the result.
              </p>
              <div className="vbs-planner-summary-rail">
                <article className="vbs-planner-summary-card">
                  <span>Planner stage</span>
                  <strong>{toPlannerStageLabel(plannerSession?.stage)}</strong>
                </article>
                <article className="vbs-planner-summary-card">
                  <span>Design</span>
                  <strong>{approvedDesignDirection?.archetypeName || "Not selected yet"}</strong>
                </article>
                <article className="vbs-planner-summary-card">
                  <span>Content</span>
                  <strong>{approvedContentDirection?.title || "Not selected yet"}</strong>
                </article>
                <article className="vbs-planner-summary-card">
                  <span>Format</span>
                  <strong>{formatGeneration ? toContentTypeLabel(formatGeneration.contentType) : toContentTypeLabel(selectedPlannerContentType)}</strong>
                </article>
              </div>
              <div className="vbs-staged-planner">
                <section className="vbs-planner-step">
                  <div className="vbs-planner-step-head">
                    <div>
                      <p className="vbs-meta">Step 1</p>
                      <h3>Pick a design direction</h3>
                    </div>
                    <span>{designDirections.length} direction(s)</span>
                  </div>
                  <p className="vbs-meta">
                    Analyze the shortlisted winner posts first. This turns old reference designs into visible directions you can compare before any copy is generated.
                  </p>
                  <div className="vbs-mini-actions">
                    <button type="button" disabled={isBusy || !brandReady} onClick={() => void runDesignAnalysis()}>
                      {designDirections.length > 0 ? "Re-analyze design directions" : "Analyze design directions"}
                    </button>
                    <button
                      type="button"
                      disabled={plannerCompareIds.length === 0}
                      onClick={() => setPlannerCompareIds([])}
                    >
                      Clear compare
                    </button>
                  </div>
                  {designDirections.length > 0 ? (
                    <div className="vbs-planner-card-grid">
                      {designDirections.map((direction) => (
                        <article
                          key={direction.id}
                          className={[
                            "vbs-planner-card",
                            approvedDesignDirection?.id === direction.id ? "is-approved" : "",
                            plannerCompareIds.includes(direction.id) ? "is-compared" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <div className="vbs-planner-card-head">
                            <div>
                              <p className="vbs-meta">Design direction #{direction.orderIndex + 1}</p>
                              <h4>{direction.archetypeName}</h4>
                            </div>
                            <span>{direction.sourceReferenceIds.length} refs</span>
                          </div>
                          <div className="vbs-design-thumbnail-row">
                            {direction.thumbnailCluster.map((thumb) => (
                              <div
                                key={`${direction.id}-${thumb.referenceId}`}
                                className="vbs-design-thumb"
                                style={
                                  thumb.mediaUrl
                                    ? {
                                        backgroundImage: `linear-gradient(180deg, rgba(11,19,43,0.16), rgba(11,19,43,0.72)), url("${thumb.mediaUrl}")`,
                                      }
                                    : undefined
                                }
                              >
                                <small>{thumb.platform}</small>
                                <strong>{thumb.label}</strong>
                              </div>
                            ))}
                          </div>
                          <p>{direction.summary}</p>
                          <div className="vbs-planner-fact-list">
                            <div>
                              <span>Layout</span>
                              <strong>{direction.layoutPattern}</strong>
                            </div>
                            <div>
                              <span>Typography</span>
                              <strong>{direction.typographyCharacter}</strong>
                            </div>
                            <div>
                              <span>Palette</span>
                              <strong>{direction.colorPaletteSummary}</strong>
                            </div>
                          </div>
                          <div className="vbs-top-driver-row vbs-top-driver-row-compact">
                            {direction.bestFor.map((item) => (
                              <span key={`${direction.id}-best-${item}`} className="vbs-driver-chip">
                                {item}
                              </span>
                            ))}
                          </div>
                          <ul className="vbs-reference-bullets">
                            {direction.whyGrouped.slice(0, 2).map((line) => (
                              <li key={`${direction.id}-why-${line}`}>{line}</li>
                            ))}
                          </ul>
                          <div className="vbs-mini-actions">
                            <button type="button" disabled={isBusy} onClick={() => toggleDesignCompare(direction.id)}>
                              {plannerCompareIds.includes(direction.id) ? "Remove compare" : "Compare"}
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void approveDesignDirection(direction.id)}
                            >
                              {approvedDesignDirection?.id === direction.id ? "Approved" : "Use this design"}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="vbs-meta">No design directions yet. Start by analyzing your shortlisted references.</p>
                  )}
                  {comparedDesignDirections.length > 0 ? (
                    <div className="vbs-planner-compare-grid">
                      {comparedDesignDirections.map((direction) => (
                        <article key={`compare-${direction.id}`} className="vbs-planner-compare-card">
                          <p className="vbs-meta">Compare view</p>
                          <h4>{direction.archetypeName}</h4>
                          <p>{direction.summary}</p>
                          <ul>
                            {direction.pros.slice(0, 2).map((line) => (
                              <li key={`${direction.id}-pro-${line}`}>{line}</li>
                            ))}
                          </ul>
                          <p className="vbs-meta">Risk watch: {direction.risks[0] || "Keep the execution tight and proof-backed."}</p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="vbs-planner-step">
                  <div className="vbs-planner-step-head">
                    <div>
                      <p className="vbs-meta">Step 2</p>
                      <h3>Pick a content direction</h3>
                    </div>
                    <span>{contentDirections.length} option(s)</span>
                  </div>
                  <p className="vbs-meta">
                    Once the design is locked, analyze messaging directions separately so the model is only solving one strategic decision at a time.
                  </p>
                  <div className="vbs-mini-actions">
                    <button
                      type="button"
                      disabled={isBusy || !approvedDesignDirection}
                      onClick={() => void runContentAnalysis()}
                    >
                      {contentDirections.length > 0 ? "Re-analyze content directions" : "Analyze content directions"}
                    </button>
                  </div>
                  {approvedDesignDirection ? (
                    <div className="vbs-approved-pill-row">
                      <span className="vbs-approved-pill">Design locked: {approvedDesignDirection.archetypeName}</span>
                    </div>
                  ) : (
                    <p className="vbs-meta">Approve a design direction first to unlock content strategy.</p>
                  )}
                  {contentDirections.length > 0 ? (
                    <div className="vbs-planner-card-grid">
                      {contentDirections.map((direction) => (
                        <article
                          key={direction.id}
                          className={[
                            "vbs-planner-card",
                            approvedContentDirection?.id === direction.id ? "is-approved" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <div className="vbs-planner-card-head">
                            <div>
                              <p className="vbs-meta">Content direction #{direction.orderIndex + 1}</p>
                              <h4>{direction.title}</h4>
                            </div>
                            <span>{direction.sourceReferenceIds.length} refs</span>
                          </div>
                          <div className="vbs-planner-fact-list">
                            <div>
                              <span>Audience</span>
                              <strong>{direction.coreAudience}</strong>
                            </div>
                            <div>
                              <span>Pain / desire</span>
                              <strong>
                                {direction.targetedPain} {" -> "} {direction.targetedDesire}
                              </strong>
                            </div>
                            <div>
                              <span>Big promise</span>
                              <strong>{direction.bigPromise}</strong>
                            </div>
                          </div>
                          <ul className="vbs-reference-bullets">
                            {direction.whyFitsDesign.map((line) => (
                              <li key={`${direction.id}-fit-${line}`}>{line}</li>
                            ))}
                          </ul>
                          <p className="vbs-meta">Objection handling: {direction.objectionHandling}</p>
                          <div className="vbs-mini-actions">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void approveContentDirection(direction.id)}
                            >
                              {approvedContentDirection?.id === direction.id ? "Approved" : "Use this content"}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="vbs-planner-step">
                  <div className="vbs-planner-step-head">
                    <div>
                      <p className="vbs-meta">Step 3</p>
                      <h3>Generate one format at a time</h3>
                    </div>
                    <span>{formatGeneration ? "Latest result ready" : "Waiting"}</span>
                  </div>
                  <p className="vbs-meta">
                    Pick one content type only. The planner will return separate design details and content details so the next generation run stays focused.
                  </p>
                  <div className="vbs-content-type-grid">
                    {(
                      [
                        "short_video",
                        "carousel",
                        "story_sequence",
                        "static_post",
                        "caption_set",
                        "cta_set",
                      ] as ViralStudioContentType[]
                    ).map((contentType) => (
                      <button
                        key={contentType}
                        type="button"
                        aria-pressed={selectedPlannerContentType === contentType}
                        className={selectedPlannerContentType === contentType ? "vbs-chip-toggle is-active" : "vbs-chip-toggle"}
                        onClick={() => setSelectedPlannerContentType(contentType)}
                      >
                        {toContentTypeLabel(contentType)}
                      </button>
                    ))}
                  </div>
                  <div className="vbs-mini-actions">
                    <button
                      type="button"
                      disabled={isBusy || !approvedDesignDirection || !approvedContentDirection}
                      onClick={() => void generatePlannerFormat()}
                    >
                      {formatGeneration ? "Generate next format from same approved direction" : "Generate format details"}
                    </button>
                  </div>
                  {formatGeneration ? (
                    <div className="vbs-format-result-grid">
                      <article className="vbs-planner-result-card">
                        <p className="vbs-meta">Design details</p>
                        <h4>{formatGeneration.result.title}</h4>
                        <ul>
                          {formatGeneration.result.designDetails.layoutStructure.map((line) => (
                            <li key={`layout-${line}`}>{line}</li>
                          ))}
                        </ul>
                        <p className="vbs-meta">Typography: {formatGeneration.result.designDetails.typographyTreatment}</p>
                        <ul className="vbs-reference-bullets">
                          {formatGeneration.result.designDetails.onScreenTextGuidance.map((line) => (
                            <li key={`text-${line}`}>{line}</li>
                          ))}
                        </ul>
                      </article>
                      <article className="vbs-planner-result-card">
                        <p className="vbs-meta">Content details</p>
                        <h4>{formatGeneration.result.summary}</h4>
                        <p><strong>Hook:</strong> {formatGeneration.result.contentDetails.hook}</p>
                        <ul>
                          {formatGeneration.result.contentDetails.narrativeBeats.map((line) => (
                            <li key={`beat-${line}`}>{line}</li>
                          ))}
                        </ul>
                        <p className="vbs-meta">Proof placement: {formatGeneration.result.contentDetails.proofPlacement}</p>
                        <p className="vbs-meta">{formatGeneration.result.contentDetails.cta}</p>
                      </article>
                      <article className="vbs-planner-result-card">
                        <p className="vbs-meta">Step 5</p>
                        <h4>Save to document</h4>
                        <p>
                          This format run is already persisted. Save it into Document Workspace when the design and message feel locked.
                        </p>
                        <div className="vbs-top-driver-row vbs-top-driver-row-compact">
                          {latestPlannerReferenceCards.map((reference) => (
                            <span key={`ref-${reference.id}`} className="vbs-driver-chip">
                              #{reference.ranking.rank} {toPlatformLabel(reference.sourcePlatform)}
                            </span>
                          ))}
                        </div>
                        <div className="vbs-mini-actions">
                          <button type="button" disabled={isBusy || Boolean(document)} onClick={() => void createDocumentFromGeneration()}>
                            {document ? "Document Ready" : "Save To Document"}
                          </button>
                          <button type="button" disabled={isBusy} onClick={() => void sendGenerationToChat()}>
                            Send Context To Chat
                          </button>
                        </div>
                      </article>
                    </div>
                  ) : (
                    <p className="vbs-meta">
                      No format generated yet. Once the design and content directions are approved, generate a single format and inspect the returned design/content split before saving.
                    </p>
                  )}
                </section>
              </div>
              <details className="vbs-advanced-fallback">
                <summary>Advanced fallback: one-shot multi-pack generator</summary>
              <div className="vbs-generation-overview">
                <article className="vbs-generation-brief-card">
                  <div className="vbs-generation-brief-head">
                    <div>
                      <p className="vbs-meta">Creative brief</p>
                      <h3>{generation ? generation.promptContext.objective : "Set the direction before you generate"}</h3>
                    </div>
                    <span className="vbs-brief-badge">
                      {selectedTemplate ? toPromptIntentLabel(selectedTemplate.intent) : "Template"}
                    </span>
                  </div>
                  <p className="vbs-generation-brief-copy">
                    {generation
                      ? generation.promptContext.audienceSnapshot
                      : compactText(
                          brandProfile?.summary ||
                            "Your Brand DNA summary and prioritized references will be condensed into one working brief here.",
                          240
                        )}
                  </p>
                  <div className="vbs-generation-brief-grid">
                    <div>
                      <span>Brand brief</span>
                      <strong>{compactText(generation?.promptContext.brandSummary || brandProfile?.summary || "Finalize Brand DNA to strengthen the pack brief.", 120)}</strong>
                    </div>
                    <div>
                      <span>Voice profile</span>
                      <strong>
                        {generation?.promptContext.voiceProfile?.length
                          ? generation.promptContext.voiceProfile.join(" • ")
                          : tonePreview(brandForm).replace("Voice profile: ", "")}
                      </strong>
                    </div>
                    <div>
                      <span>Required claims</span>
                      <strong>
                        {generation?.promptContext.requiredClaims?.length
                          ? compactText(generation.promptContext.requiredClaims.join(", "), 110)
                          : brandProfile?.requiredClaims?.length
                            ? compactText(brandProfile.requiredClaims.join(", "), 110)
                            : "No required claims set"}
                      </strong>
                    </div>
                    <div>
                      <span>Banned phrases</span>
                      <strong>
                        {generation?.promptContext.bannedPhrases?.length
                          ? compactText(generation.promptContext.bannedPhrases.join(", "), 110)
                          : brandProfile?.bannedPhrases?.length
                            ? compactText(brandProfile.bannedPhrases.join(", "), 110)
                            : "No banned phrases set"}
                      </strong>
                    </div>
                  </div>
                </article>
                <article className="vbs-generation-reference-card">
                  <div className="vbs-generation-brief-head">
                    <div>
                      <p className="vbs-meta">Influence set</p>
                      <h3>{generationReferencePreview.length} references are steering this pack</h3>
                    </div>
                    <span className="vbs-brief-badge">
                      {prioritizedReferenceCount > 0 ? `${prioritizedReferenceCount} prioritized` : "Fallback top refs"}
                    </span>
                  </div>
                  {generationReferencePreview.length ? (
                    <div className="vbs-generation-reference-list">
                      {generationReferencePreview.map((reference) => (
                        <button
                          key={`generation-ref-${reference.id}`}
                          type="button"
                          className="vbs-generation-reference-item"
                          onClick={() => setSelectedReferenceId(reference.id)}
                        >
                          <span>#{reference.ranking.rank}</span>
                          <strong>{compactText(reference.ranking.rationaleTitle, 70)}</strong>
                          <p>
                            {toPlatformLabel(reference.sourcePlatform)} • {shortlistLabel(reference.shortlistState)} •{" "}
                            {formatCompactNumber(reference.metrics.views)} views
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="vbs-meta">
                      Prioritize references in the board first. The strongest shortlist should become the visible influence set here.
                    </p>
                  )}
                </article>
              </div>
              <div className="vbs-template-rail">
                {promptTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={template.id === selectedTemplateId ? "vbs-template-card is-active" : "vbs-template-card"}
                    aria-pressed={template.id === selectedTemplateId}
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <span>{toPromptIntentLabel(template.intent)}</span>
                    <strong>{template.title}</strong>
                    <p>{compactText(template.description, 120)}</p>
                    <small>{template.requiredFields.length} required fields • {compactText(template.outputSchema, 80)}</small>
                  </button>
                ))}
              </div>
              <div className="vbs-prompt-two-pane">
                <div className="vbs-prompt-controls">
                  <div className="vbs-generation-summary-strip">
                    {generationSummaryCards.map((card) => (
                      <article key={card.label} className={detailCardClassName(card)}>
                        <span>{card.label}</span>
                        <strong>{card.value}</strong>
                        <p>{card.note}</p>
                      </article>
                    ))}
                  </div>
                  <div className="vbs-form-grid">
                    <label>
                      Template
                      <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                        {promptTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Format Target
                      <select
                        value={generationFormatTarget}
                        onChange={(event) => setGenerationFormatTarget(event.target.value as ViralStudioGenerationFormatTarget)}
                      >
                        <option value="reel-30">30s Reel</option>
                        <option value="reel-60">60s Reel</option>
                        <option value="shorts">YouTube Shorts</option>
                        <option value="story">Story Sequence</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Prompt direction
                    <textarea value={promptText} rows={4} onChange={(e) => setPromptText(e.target.value)} />
                  </label>
                  <p className="vbs-meta">
                    Active template: {selectedTemplate?.title || "n/a"} • Prioritized references: {prioritizedReferenceCount} •
                    Format: {toGenerationFormatLabel(generationFormatTarget)}
                  </p>
                  <p className="vbs-meta">
                    Every generation revision is auto-saved into Document Workspace version history.
                  </p>
                  {generationSaveStatus ? <p className="vbs-meta">{generationSaveStatus}</p> : null}
                  <div className="vbs-actions">
                    <button type="button" disabled={isBusy} onClick={() => void generatePack()}>
                      Generate Multi-Pack
                    </button>
                    <button type="button" disabled={isBusy || !generation} onClick={() => void sendGenerationToChat()}>
                      Send Pack To Chat
                    </button>
                  </div>
                  {generation ? (
                    <div className="vbs-quality-report">
                      <p className="vbs-meta">
                        Revision {generation.revision} • Quality: {generation.qualityCheck.passed ? "pass" : "review"}
                      </p>
                      {qualitySignals.length > 0 ? (
                        <ul>
                          {qualitySignals.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="vbs-meta">Quality gate clear: no banned terms, tone violations, or length warnings.</p>
                      )}
                      <p className="vbs-meta">
                        Composer prompt: {compactText(generation.promptContext.composedPrompt, 340)}
                      </p>
                    </div>
                  ) : (
                    <p className="vbs-meta">No generation yet.</p>
                  )}
                </div>
                <div className="vbs-prompt-output">
                  {generation ? (
                    PROMPT_STUDIO_SECTIONS.map((sectionMeta) => {
                      const sectionLines = readGenerationSectionContent(generation, sectionMeta.id);
                      const sectionInstruction = sectionInstructions[sectionMeta.id] || "";
                      const isSectionPending = promptActionSection === sectionMeta.id;
                      const sectionGuide = PROMPT_STUDIO_SECTION_GUIDES[sectionMeta.id];
                      const leadLine = sectionLines[0] || "";
                      return (
                        <article
                          key={sectionMeta.id}
                          className={`vbs-pack-card ${activePromptSection === sectionMeta.id ? "is-active" : ""}`}
                          onClick={() => setActivePromptSection(sectionMeta.id)}
                        >
                          <header className="vbs-pack-card-head">
                            <div>
                              <p className="vbs-meta">{sectionGuide.eyebrow}</p>
                              <h3>{sectionMeta.title}</h3>
                            </div>
                            <span>{sectionMeta.kind === "list" ? `${sectionLines.length} variants` : "1 block"}</span>
                          </header>
                          <div className="vbs-pack-card-lead">
                            <strong>{compactText(leadLine, 150) || "This section will populate after generation."}</strong>
                            <p>{sectionGuide.purpose}</p>
                          </div>
                          <div className="vbs-pack-card-body">
                            {sectionMeta.kind === "list" ? (
                              <ul>
                                {sectionLines.map((line, index) => (
                                  <li key={`${sectionMeta.id}-${index}`}>{line}</li>
                                ))}
                              </ul>
                            ) : (
                              <pre>{sectionLines[0] || ""}</pre>
                            )}
                          </div>
                          <div className="vbs-pack-card-review">
                            <span>Review lens</span>
                            <strong>{sectionGuide.reviewLens}</strong>
                          </div>
                          <label className="vbs-pack-instruction">
                            Section instruction
                            <input
                              value={sectionInstruction}
                              onChange={(event) => updateSectionInstruction(sectionMeta.id, event.target.value)}
                              placeholder="How should this section change?"
                            />
                          </label>
                          <div className="vbs-mini-actions">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void runPromptSectionAction(sectionMeta.id, "refine")}
                            >
                              {isSectionPending ? "Working…" : "Refine Section"}
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void runPromptSectionAction(sectionMeta.id, "regenerate")}
                            >
                              {isSectionPending ? "Working…" : "Regenerate Only"}
                            </button>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="vbs-generation-empty">
                      <div className="vbs-generation-empty-head">
                        <p className="vbs-meta">Pack preview</p>
                        <h3>Generate once, then refine with precision</h3>
                      </div>
                      <div className="vbs-generation-empty-grid">
                        <article>
                          <span>1</span>
                          <strong>Choose the strongest template</strong>
                          <p>Pick the template that matches the job, not the one with the most words.</p>
                        </article>
                        <article>
                          <span>2</span>
                          <strong>Keep the direction narrow</strong>
                          <p>One clear angle beats a long prompt with mixed goals.</p>
                        </article>
                        <article>
                          <span>3</span>
                          <strong>Review before editing the document</strong>
                          <p>Use the first full pack as a read on strategy, then refine only the sections that miss.</p>
                        </article>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              </details>
              </article>

              <article className="vbs-panel vbs-document-workspace" id="vbs-section-documents">
              <h2 className="vbs-panel-title">Document Workspace</h2>
              <p className="vbs-panel-subtitle">
                Editable campaign artifact with autosave every 10s, version timeline, compare view, and promote/rollback workflow.
              </p>
              <div className="vbs-actions">
                <button
                  type="button"
                  disabled={isBusy || !generation || Boolean(document)}
                  onClick={() => void createDocumentFromGeneration()}
                >
                  {document ? "Document Ready" : "Create Document"}
                </button>
                <button type="button" disabled={isBusy || !documentDraft || !documentDirty} onClick={() => void saveDocumentNow()}>
                  Save Draft
                </button>
                <button type="button" disabled={isBusy || !document} onClick={() => void snapshotVersion()}>
                  Create Version
                </button>
                <button type="button" disabled={isBusy || !document} onClick={() => void exportDocument("markdown")}>
                  Export MD
                </button>
                <button type="button" disabled={isBusy || !document} onClick={() => void exportDocument("json")}>
                  Export JSON
                </button>
              </div>
              <p className="vbs-meta" role="status" aria-live="polite">
                Document: {document ? document.title : "none"} • Versions: {versions.length} • Autosave:{" "}
                {autosaveState === "saving"
                  ? "saving..."
                  : autosaveState === "saved"
                    ? "saved"
                    : autosaveState === "error"
                      ? "error"
                      : documentDirty
                        ? "pending edits"
                        : "idle"}
              </p>
              <div className="vbs-detail-grid vbs-detail-grid-compact">
                {documentFocusCards.map((card) => (
                  <article key={card.label} className={detailCardClassName(card)}>
                    <span>{card.label}</span>
                    <strong>{card.value}</strong>
                    <p>{card.note}</p>
                  </article>
                ))}
              </div>
              {generationSaveStatus ? <p className="vbs-meta">{generationSaveStatus}</p> : null}
              {documentDraft ? (
                <div className="vbs-doc-editor">
                  <label className="vbs-doc-title-input">
                    Document title
                    <input
                      value={documentDraft.title}
                      onChange={(event) => updateDocumentTitle(event.target.value)}
                    />
                  </label>

                  <div className="vbs-doc-sections">
                    {documentDraft.sections.map((section, index) => (
                      <article key={section.id} className="vbs-doc-section-card">
                        <div className="vbs-doc-section-head">
                          <input
                            value={section.title}
                            onChange={(event) => updateDocumentSectionTitle(section.id, event.target.value)}
                            aria-label={`Section ${index + 1} title`}
                          />
                          <div className="vbs-mini-actions">
                            <button
                              type="button"
                              disabled={isBusy || index === 0}
                              onClick={() => reorderDocumentSection(section.id, "up")}
                            >
                              Move Up
                            </button>
                            <button
                              type="button"
                              disabled={isBusy || index === documentDraft.sections.length - 1}
                              onClick={() => reorderDocumentSection(section.id, "down")}
                            >
                              Move Down
                            </button>
                          </div>
                        </div>
                        <textarea
                          rows={Array.isArray(section.content) ? Math.max(4, section.content.length + 1) : 8}
                          value={toSectionText(section)}
                          onChange={(event) => updateDocumentSectionContent(section.id, event.target.value)}
                        />
                        <p className="vbs-meta">{section.kind} section</p>
                      </article>
                    ))}
                  </div>

                  <div className="vbs-doc-version-tools">
                    <div className="vbs-doc-compare-controls">
                      <h3>Version Compare</h3>
                      <div className="vbs-form-grid">
                        <label>
                          Left
                          <select
                            value={compareLeftVersionId}
                            onChange={(event) => setCompareLeftVersionId(event.target.value)}
                          >
                            {versionOptions.map((option) => (
                              <option key={`left-${option.id}`} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Right
                          <select
                            value={compareRightVersionId}
                            onChange={(event) => setCompareRightVersionId(event.target.value)}
                          >
                            {versionOptions.map((option) => (
                              <option key={`right-${option.id}`} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="vbs-actions">
                        <button type="button" disabled={compareLoading || !document} onClick={() => void runVersionCompare()}>
                          {compareLoading ? "Comparing..." : "Compare Versions"}
                        </button>
                      </div>
                      {comparison ? (
                        <div className="vbs-doc-compare-results">
                          <p className="vbs-meta">
                            {comparison.changedSections} changed sections out of {comparison.totalSections}
                          </p>
                          <ul>
                            {comparison.sectionDiffs.slice(0, 12).map((diff) => (
                              <li key={diff.sectionKey}>
                                <strong>{diff.title}</strong> • {diff.changed ? "changed" : "unchanged"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>

                    <div className="vbs-doc-timeline">
                      <h3>Version Timeline</h3>
                      <div className="vbs-form-grid">
                        <label>
                          Promote version
                          <select value={promoteVersionId} onChange={(event) => setPromoteVersionId(event.target.value)}>
                            <option value="">Select version</option>
                            {versions
                              .slice()
                              .reverse()
                              .map((version) => (
                                <option key={version.id} value={version.id}>
                                  {version.summary || "Snapshot"} • {new Date(version.createdAt).toLocaleString()}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      <div className="vbs-actions">
                        <button type="button" disabled={isBusy || !promoteVersionId} onClick={() => void promoteVersion()}>
                          Promote Version
                        </button>
                      </div>
                      <ul>
                        {versions
                          .slice()
                          .reverse()
                          .map((version) => (
                            <li key={version.id}>
                              <strong>{version.summary}</strong> • {version.author} • {formatTimestamp(version.createdAt)}
                              {version.basedOnVersionId ? ` • based on ${version.basedOnVersionId}` : ""}
                            </li>
                          ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="vbs-meta">No document created yet. Generate a pack and create a document to start editing.</p>
              )}
              {lastExport ? (
                <div className="vbs-export-preview">
                  <p className="vbs-meta">Last export ({lastExport.format})</p>
                  <pre>{lastExport.content}</pre>
                </div>
              ) : null}
              </article>
            </div>
          </article>
        </>
      ) : (
        <article className="vbs-panel">
          <h2 className="vbs-panel-title">Workflow Locked Until DNA Finalization</h2>
          <p className="vbs-panel-subtitle">Plan 2 onboarding gate is active. Complete and finalize Brand DNA to unlock extraction, generation, and document actions.</p>
        </article>
      )}

      {showExtractionModal ? (
        <div
          className="vbs-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Extract best videos"
          onClick={() => setShowExtractionModal(false)}
        >
          <div className="vbs-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Extract Best Videos</h3>
            <p className="vbs-meta">
              Configure platform, profile URL, preset, and extraction volume. Progress updates automatically while the
              run is active.
            </p>
            <div className="vbs-form-grid">
              <label>
                Platform
                <select value={sourcePlatform} onChange={(e) => setSourcePlatform(e.target.value as ViralStudioPlatform)}>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="youtube">YouTube</option>
                </select>
              </label>
              <label>
                Source URL
                <input value={sourceUrl} placeholder="https://..." onChange={(e) => setSourceUrl(e.target.value)} />
              </label>
              <label>
                Filter Preset
                <select
                  value={ingestionPreset}
                  onChange={(e) => applyIngestionPreset(e.target.value as IngestionPreset)}
                >
                  <option value="data-max">Data max (Recommended)</option>
                  <option value="balanced">Balanced</option>
                  <option value="quick-scan">Quick Scan</option>
                  <option value="deep-scan">Deep Scan</option>
                </select>
              </label>
              <label>
                Volume (max videos): {maxVideos}
                <input
                  type="range"
                  min={5}
                  max={200}
                  value={maxVideos}
                  onChange={(e) => setMaxVideos(Number(e.target.value))}
                />
              </label>
              <label>
                Lookback Days
                <input
                  type="number"
                  min={7}
                  max={365}
                  value={lookbackDays}
                  onChange={(e) => setLookbackDays(Number(e.target.value))}
                />
              </label>
              <label>
                Sort By
                <select value="engagement" disabled>
                  <option value="engagement">Engagement (default)</option>
                </select>
              </label>
            </div>
            <div className="vbs-actions">
              <button type="button" onClick={() => setShowExtractionModal(false)} disabled={isBusy}>
                Cancel
              </button>
              <button type="button" onClick={() => void runExtraction()} disabled={isBusy || !sourceUrl.trim()}>
                Start Extraction Run
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
