"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleOff,
  Compass,
  FileText,
  FolderArchive,
  Layers3,
  Palette,
  Pin,
  Rocket,
  ScanSearch,
  Send,
  Sparkles,
  WandSparkles,
  Workflow,
} from "lucide-react";
import {
  applyWorkspaceBrandDnaAutofill,
  compareViralStudioDocumentVersions,
  createViralStudioDocument,
  createViralStudioDocumentVersion,
  createViralStudioGeneration,
  createViralStudioIngestion,
  createWorkspaceBrandDna,
  fetchViralStudioGeneration,
  exportViralStudioDocument,
  fetchViralStudioContracts,
  fetchViralStudioDocument,
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
  ViralStudioContractSnapshot,
  ViralStudioDocument,
  ViralStudioDocumentSection,
  ViralStudioDocumentVersionComparison,
  ViralStudioDocumentVersion,
  ViralStudioGenerationFormatTarget,
  ViralStudioGenerationPack,
  ViralStudioGenerationSection,
  ViralStudioIngestionRun,
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

const PROMPT_STUDIO_SECTIONS: PromptStudioSectionMeta[] = [
  { id: "hooks", title: "Hooks", kind: "list" },
  { id: "scripts.short", title: "Short Script", kind: "text" },
  { id: "scripts.medium", title: "Medium Script", kind: "text" },
  { id: "scripts.long", title: "Long Script", kind: "text" },
  { id: "captions", title: "Captions", kind: "list" },
  { id: "ctas", title: "CTA Variants", kind: "list" },
  { id: "angleRemixes", title: "Angle Remixes", kind: "list" },
];

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

const STUDIO_SLIDE_ORDER = ["launchpad", "foundation", "reference", "create"] as const;
type StudioSlideId = (typeof STUDIO_SLIDE_ORDER)[number];

const STUDIO_SLIDE_META: Array<{
  id: StudioSlideId;
  label: string;
  chapter: string;
  detail: string;
  icon: LucideIcon;
}> = [
  { id: "launchpad", label: "Launchpad", chapter: "00", detail: "Autopilot + workflow", icon: Workflow },
  { id: "foundation", label: "Brand DNA", chapter: "01", detail: "Identity + tone", icon: Palette },
  { id: "reference", label: "Reference Engine", chapter: "02", detail: "Extract + shortlist", icon: ScanSearch },
  { id: "create", label: "Create & Save", chapter: "03", detail: "Generate + version", icon: FolderArchive },
];

const WORKFLOW_STAGE_META: Array<{
  stage: ViralStudioWorkflowStatus["workflowStage"];
  label: string;
  caption: string;
  icon: LucideIcon;
  slide: StudioSlideId;
}> = [
  { stage: "intake_pending", label: "Intake", caption: "evidence", icon: Compass, slide: "launchpad" },
  { stage: "intake_complete", label: "Ready", caption: "workspace", icon: Compass, slide: "launchpad" },
  { stage: "studio_autofill_review", label: "Autofill", caption: "review", icon: WandSparkles, slide: "foundation" },
  { stage: "extraction", label: "Extract", caption: "sources", icon: ScanSearch, slide: "reference" },
  { stage: "curation", label: "Curate", caption: "winners", icon: Pin, slide: "reference" },
  { stage: "generation", label: "Generate", caption: "pack", icon: Sparkles, slide: "create" },
  { stage: "chat_execution", label: "Ship", caption: "to chat", icon: Send, slide: "launchpad" },
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

function isStudioSlideId(value: string): value is StudioSlideId {
  return STUDIO_SLIDE_ORDER.includes(value as StudioSlideId);
}

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

function buildTonePreviewCards(form: BrandFormState): Array<{
  id: string;
  eyebrow: string;
  sample: string;
}> {
  return [
    {
      id: "hook",
      eyebrow: "Hook",
      sample:
        form.voiceBold >= 60
          ? "Stop posting polite filler. Lead with the measurable shift your audience wants now."
          : "Start with the clearest transformation your audience can recognize in one line.",
    },
    {
      id: "proof",
      eyebrow: "Proof",
      sample:
        form.voiceFormal >= 60
          ? "Ground each claim in evidence, process, or a named outcome so trust shows up fast."
          : "Add one concrete proof point so the message feels earned, not just louder.",
    },
    {
      id: "cta",
      eyebrow: "CTA",
      sample:
        form.voiceDirect >= 60
          ? "Ask for the next action clearly and cut the soft language."
          : form.voicePlayful >= 60
            ? "Invite the next step with warmth and momentum, not pressure."
            : "Keep the CTA simple, clear, and easy to act on.",
    },
  ];
}

function formatShortTime(value?: string | null): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "n/a";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function hasBrandDraftSignal(form: BrandFormState): boolean {
  return Boolean(
    form.mission.trim() ||
      form.valueProposition.trim() ||
      form.productOrService.trim() ||
      form.region.trim() ||
      form.audiencePersonas.trim() ||
      form.pains.trim() ||
      form.desires.trim() ||
      form.objections.trim() ||
      form.bannedPhrases.trim() ||
      form.requiredClaims.trim() ||
      form.exemplars.trim() ||
      form.summary.trim()
  );
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

function encodeSvgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeSvgText(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function splitPosterText(value: string, maxLineLength: number, maxLines: number): string[] {
  const words = compactText(value, 120).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  while (words.length > 0 && lines.length < maxLines) {
    const word = words.shift()!;
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLineLength || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (words.length > 0 && lines.length > 0) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:!?-]+$/g, "")}…`;
  return lines;
}

function platformVisualPalette(platform: ViralStudioPlatform): string[] {
  if (platform === "instagram") return ["#18181B", "#F97316", "#F8F4EC"];
  if (platform === "tiktok") return ["#07111F", "#14B8A6", "#F4FEFF"];
  return ["#190B0F", "#DC2626", "#FFF1E8"];
}

function buildReferencePosterFallback(reference: ViralStudioReferenceAsset, palette: string[]): string {
  const [ink, accent, paper] = palette;
  const eyebrow = `${toPlatformLabel(reference.sourcePlatform)} reference`;
  const headline = compactText(
    reference.visual?.headline ||
      reference.caption.replace(/^High-performing\s+\w+\s+angle\s+\d+:\s*/i, "") ||
      reference.ranking.rationaleTitle,
    68
  );
  const footer = compactText(
    reference.visual?.footer || reference.transcriptSummary || reference.ocrSummary || reference.ranking.rationaleBullets[0] || "",
    96
  );
  const headlineLines = splitPosterText(headline, 16, 3);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500" role="img" aria-label="${escapeSvgText(
      headline
    )}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${ink}"/>
          <stop offset="55%" stop-color="${accent}"/>
          <stop offset="100%" stop-color="${paper}"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="1500" rx="72" fill="url(#bg)"/>
      <circle cx="1004" cy="224" r="250" fill="${paper}" opacity="0.12"/>
      <circle cx="210" cy="1210" r="340" fill="${accent}" opacity="0.18"/>
      <rect x="76" y="76" width="1048" height="1348" rx="48" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.22)"/>
      <text x="112" y="164" fill="${paper}" opacity="0.8" font-family="Arial, sans-serif" font-size="38" font-weight="700" letter-spacing="7">${escapeSvgText(
        eyebrow.toUpperCase()
      )}</text>
      ${headlineLines
        .map(
          (line, index) =>
            `<text x="112" y="${360 + index * 132}" fill="${paper}" font-family="Georgia, serif" font-size="104" font-weight="700">${escapeSvgText(
              line
            )}</text>`
        )
        .join("")}
      <text x="112" y="1170" fill="${paper}" font-family="Arial, sans-serif" font-size="58" font-weight="700">${escapeSvgText(
        `${formatCompactNumber(reference.metrics.views)} views`
      )}</text>
      <text x="112" y="1262" fill="${paper}" opacity="0.76" font-family="Arial, sans-serif" font-size="34">${escapeSvgText(
        footer
      )}</text>
      <rect x="888" y="1162" width="224" height="184" rx="34" fill="rgba(11,19,43,0.35)" stroke="rgba(255,255,255,0.22)"/>
      <text x="930" y="1238" fill="${paper}" opacity="0.72" font-family="Arial, sans-serif" font-size="28" letter-spacing="4">SCORE</text>
      <text x="930" y="1320" fill="${paper}" font-family="Arial, sans-serif" font-size="74" font-weight="700">${escapeSvgText(
        String(Math.round(reference.scores.composite * 100))
      )}</text>
    </svg>
  `;
  return encodeSvgDataUri(svg);
}

function resolveReferenceVisual(reference: ViralStudioReferenceAsset) {
  const palette = reference.visual?.palette?.length ? reference.visual.palette : platformVisualPalette(reference.sourcePlatform);
  return {
    palette,
    eyebrow:
      reference.visual?.eyebrow ||
      `${toPlatformLabel(reference.sourcePlatform)} • ${shortlistLabel(reference.shortlistState)}`,
    headline:
      compactText(
        reference.visual?.headline ||
          reference.caption.replace(/^High-performing\s+\w+\s+angle\s+\d+:\s*/i, "") ||
          reference.ranking.rationaleTitle,
        78
      ) || reference.ranking.rationaleTitle,
    footer:
      compactText(
        reference.visual?.footer || reference.transcriptSummary || reference.ocrSummary || reference.ranking.rationaleBullets[0] || "",
        120
      ) || reference.ranking.rationaleBullets[0],
    posterUrl:
      reference.visual?.posterUrl ||
      reference.visual?.thumbnailUrl ||
      buildReferencePosterFallback(reference, palette),
  };
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
  const [activeSlide, setActiveSlide] = useState<StudioSlideId>("launchpad");
  const [isEditingBrandDna, setIsEditingBrandDna] = useState(false);
  const [brandAutosaveState, setBrandAutosaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [brandAutosavedAt, setBrandAutosavedAt] = useState<string | null>(null);
  const [extractionAutosavedAt, setExtractionAutosavedAt] = useState<string | null>(null);
  const [curationAutosavedAt, setCurationAutosavedAt] = useState<string | null>(null);

  const [ingestions, setIngestions] = useState<ViralStudioIngestionRun[]>([]);
  const [activeIngestion, setActiveIngestion] = useState<ViralStudioIngestionRun | null>(null);
  const [references, setReferences] = useState<ViralStudioReferenceAsset[]>([]);
  const [generation, setGeneration] = useState<ViralStudioGenerationPack | null>(null);
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
  const brandAutosaveFingerprintRef = useRef<string>("");
  const brandAutosaveInFlightRef = useRef(false);
  const extractionAutosaveRunIdsRef = useRef<Set<string>>(new Set());

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
  const [compareReferenceIds, setCompareReferenceIds] = useState<string[]>([]);
  const [shortlistPendingById, setShortlistPendingById] = useState<Record<string, ReferenceShortlistAction | undefined>>({});
  const [recentShortlistReferenceId, setRecentShortlistReferenceId] = useState<string | null>(null);
  const [curationNotice, setCurationNotice] = useState<string | null>(null);

  const brandReady = Boolean(brandProfile?.status === "final" && brandProfile?.completeness.ready);
  const onboardingLocked = !brandReady || isEditingBrandDna;
  const autopilotQuery = searchParams.get("autopilot");
  const diagnosticsQuery = searchParams.get("devtools");
  const onboardingStepStorageKey = useMemo(() => `viral-studio:onboarding-step:${workspaceId}`, [workspaceId]);
  const activeSlideStorageKey = useMemo(() => `viral-studio:active-slide:${workspaceId}`, [workspaceId]);

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

  useEffect(() => {
    try {
      const storedStep = window.localStorage.getItem(onboardingStepStorageKey);
      if (storedStep) {
        const parsed = Number(storedStep);
        if (parsed >= 1 && parsed <= 4) {
          setOnboardingStep(parsed as 1 | 2 | 3 | 4);
        }
      }
      const storedSlide = window.localStorage.getItem(activeSlideStorageKey);
      if (storedSlide && isStudioSlideId(storedSlide)) {
        setActiveSlide(storedSlide);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [onboardingStepStorageKey, activeSlideStorageKey]);

  const refreshTelemetry = useCallback(async () => {
    try {
      const payload = await fetchViralStudioTelemetry(workspaceId);
      setTelemetry(payload.telemetry);
    } catch {
      // Keep last telemetry snapshot if refresh fails.
    }
  }, [workspaceId]);

  const refreshWorkflow = useCallback(async () => {
    try {
      const [workflowPayload, sourcesPayload] = await Promise.all([
        fetchViralStudioWorkflowStatus(workspaceId),
        fetchViralStudioSuggestedSources(workspaceId),
      ]);
      setWorkflowStatus(workflowPayload.workflow);
      setSuggestedSources(sourcesPayload.items);
    } catch {
      // Keep prior workflow snapshot when refresh fails.
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
      ] = await Promise.all([
        fetchWorkspaceBrandDna(workspaceId),
        fetchViralStudioContracts(workspaceId),
        fetchViralStudioTelemetry(workspaceId),
        listViralStudioIngestions(workspaceId),
        listViralStudioReferences(workspaceId),
        fetchViralStudioWorkflowStatus(workspaceId),
        fetchViralStudioSuggestedSources(workspaceId),
      ]);
      const latestGenerationId = workflowPayload.workflow.latest?.generationId;
      const latestDocumentId = workflowPayload.workflow.latest?.documentId;
      const [generationPayload, documentPayload] = await Promise.all([
        latestGenerationId
          ? fetchViralStudioGeneration(workspaceId, latestGenerationId).catch(() => null)
          : Promise.resolve(null),
        latestDocumentId
          ? fetchViralStudioDocument(workspaceId, latestDocumentId).catch(() => null)
          : Promise.resolve(null),
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
      setGeneration(generationPayload?.generation || null);
      if (generationPayload?.generation) {
        generationSnapshotKeysRef.current.add(
          `${generationPayload.generation.id}:${generationPayload.generation.revision}`
        );
      }
      if (documentPayload) {
        setDocument(documentPayload.document);
        setDocumentDraft(documentPayload.document);
        setVersions(documentPayload.versions);
        setComparison(null);
        setCompareLeftVersionId("current");
        setCompareRightVersionId("current");
        setPromoteVersionId(documentPayload.versions[documentPayload.versions.length - 1]?.id || "");
      } else {
        setDocument(null);
        setDocumentDraft(null);
        setVersions([]);
        setComparison(null);
        setCompareLeftVersionId("current");
        setCompareRightVersionId("current");
        setPromoteVersionId("");
      }
      if (brandPayload.profile?.status === "final" && brandPayload.profile?.completeness.ready) {
        setOnboardingStep(4);
      }
    } catch (bootstrapError: unknown) {
      setError(String((bootstrapError as Error)?.message || "Failed to initialize Viral Brand Studio"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void Promise.all([refreshTelemetry(), refreshWorkflow()]);
    }, 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshTelemetry, refreshWorkflow]);

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
              if (!extractionAutosaveRunIdsRef.current.has(payload.run.id)) {
                extractionAutosaveRunIdsRef.current.add(payload.run.id);
                setExtractionAutosavedAt(new Date().toISOString());
              }
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

  const comparedReferences = useMemo(() => {
    return compareReferenceIds
      .map((id) => references.find((item) => item.id === id))
      .filter((item): item is ViralStudioReferenceAsset => Boolean(item))
      .slice(0, 2);
  }, [compareReferenceIds, references]);

  useEffect(() => {
    setCompareReferenceIds((previous) => previous.filter((id) => references.some((item) => item.id === id)).slice(0, 2));
  }, [references]);

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

  const generatedSectionCount = useMemo(() => {
    if (!generation) return 0;
    return PROMPT_STUDIO_SECTIONS.reduce((count, sectionMeta) => {
      return count + (readGenerationSectionContent(generation, sectionMeta.id).length > 0 ? 1 : 0);
    }, 0);
  }, [generation]);

  const autosaveLabel = useMemo(() => {
    if (autosaveState === "saving") return "Saving";
    if (autosaveState === "saved") return "Saved";
    if (autosaveState === "error") return "Error";
    if (documentDirty) return "Pending";
    return "Idle";
  }, [autosaveState, documentDirty]);

  const latestVersion = useMemo(() => {
    return versions.length > 0 ? versions[versions.length - 1] : null;
  }, [versions]);

  const versionTimelinePreview = useMemo(() => {
    return [...versions].reverse().slice(0, 4);
  }, [versions]);

  const generationGalleryPreview = useMemo(() => {
    return PROMPT_STUDIO_SECTIONS.map((sectionMeta) => {
      const lines = generation ? readGenerationSectionContent(generation, sectionMeta.id) : [];
      return {
        id: sectionMeta.id,
        title: sectionMeta.title,
        kind: sectionMeta.kind,
        count: lines.length,
        preview:
          lines.length > 0
            ? compactText(lines[0], sectionMeta.kind === "list" ? 72 : 108)
            : "Waiting for first revision",
      };
    });
  }, [generation]);

  const qualityGateCards = useMemo(() => {
    if (!generation) {
      return [
        { label: "Guardrails", value: "Waiting", tone: "neutral" },
        { label: "Duplicates", value: "0", tone: "neutral" },
        { label: "Warnings", value: "0", tone: "neutral" },
      ];
    }
    return [
      {
        label: "Guardrails",
        value: generation.qualityCheck.passed ? "Clear" : "Review",
        tone: generation.qualityCheck.passed ? "positive" : "warning",
      },
      {
        label: "Duplicates",
        value: String(generation.qualityCheck.duplicates.length),
        tone: generation.qualityCheck.duplicates.length > 0 ? "warning" : "positive",
      },
      {
        label: "Warnings",
        value: String(qualitySignals.length),
        tone: qualitySignals.length > 0 ? "warning" : "positive",
      },
    ];
  }, [generation, qualitySignals]);

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

  const buildBrandDnaPayload = useCallback(
    (mode: "draft" | "final") => ({
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
    }),
    [brandForm]
  );

  const autoSaveBrandDnaDraft = useCallback(
    async (reason: "typing" | "step") => {
      if (brandReady || autofillBusy || isBusy) return;
      if (brandAutosaveInFlightRef.current) return;
      if (!hasBrandDraftSignal(brandForm)) return;
      const payload = buildBrandDnaPayload("draft");
      const fingerprint = JSON.stringify(payload);
      if (brandAutosaveFingerprintRef.current === fingerprint) return;
      brandAutosaveInFlightRef.current = true;
      setBrandAutosaveState("saving");
      try {
        const response = brandProfile
          ? await patchWorkspaceBrandDna(workspaceId, payload)
          : await createWorkspaceBrandDna(workspaceId, payload);
        brandAutosaveFingerprintRef.current = fingerprint;
        setBrandProfile(response.profile);
        const savedAt = new Date().toISOString();
        setBrandAutosaveState("saved");
        setBrandAutosavedAt(savedAt);
        if (reason === "step") {
          setChatBridgeStatus(`Foundation step auto-saved at ${formatShortTime(savedAt)}.`);
        }
        void Promise.all([refreshTelemetry(), refreshWorkflow()]);
      } catch {
        setBrandAutosaveState("error");
      } finally {
        brandAutosaveInFlightRef.current = false;
      }
    },
    [
      workspaceId,
      brandReady,
      autofillBusy,
      isBusy,
      brandForm,
      buildBrandDnaPayload,
      brandProfile,
      refreshTelemetry,
      refreshWorkflow,
    ]
  );

  const saveBrandDna = useCallback(
    async (mode: "draft" | "final") => {
      setIsBusy(true);
      setError(null);
      try {
        const payload = buildBrandDnaPayload(mode);
        const response = brandProfile
          ? await patchWorkspaceBrandDna(workspaceId, payload)
          : await createWorkspaceBrandDna(workspaceId, payload);
        setBrandProfile(response.profile);
        setBrandForm(toFormState(response.profile));
        brandAutosaveFingerprintRef.current = JSON.stringify(buildBrandDnaPayload("draft"));
        setBrandAutosaveState("saved");
        setBrandAutosavedAt(new Date().toISOString());
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
    [workspaceId, buildBrandDnaPayload, brandProfile, refreshTelemetry, refreshWorkflow]
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
      brandAutosaveFingerprintRef.current = JSON.stringify(buildBrandDnaPayload("draft"));
      setBrandAutosaveState("saved");
      setBrandAutosavedAt(new Date().toISOString());
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
  }, [workspaceId, autofillPreview, autofillSelection, refreshTelemetry, refreshWorkflow, buildBrandDnaPayload]);

  useEffect(() => {
    if (brandReady) return;
    if (autofillPreview || autofillBusy) return;
    const stage = workflowStatus?.workflowStage;
    if (stage !== "studio_autofill_review" && stage !== "intake_complete") return;
    void previewAutofill();
  }, [brandReady, autofillBusy, autofillPreview, previewAutofill, workflowStatus?.workflowStage]);

  useEffect(() => {
    const latestGenerationId = workflowStatus?.latest?.generationId;
    if (!latestGenerationId) return;
    if (generation?.id === latestGenerationId) return;
    void fetchViralStudioGeneration(workspaceId, latestGenerationId)
      .then((payload) => {
        setGeneration(payload.generation);
        generationSnapshotKeysRef.current.add(`${payload.generation.id}:${payload.generation.revision}`);
      })
      .catch(() => undefined);
  }, [workspaceId, workflowStatus?.latest?.generationId, generation?.id]);

  useEffect(() => {
    const latestDocumentId = workflowStatus?.latest?.documentId;
    if (!latestDocumentId) return;
    if (document?.id === latestDocumentId && versions.length > 0) return;
    void fetchViralStudioDocument(workspaceId, latestDocumentId)
      .then((payload) => {
        setDocument(payload.document);
        setDocumentDraft(payload.document);
        setVersions(payload.versions);
        setComparison(null);
        setCompareLeftVersionId("current");
        setCompareRightVersionId("current");
        setPromoteVersionId(payload.versions[payload.versions.length - 1]?.id || "");
      })
      .catch(() => undefined);
  }, [workspaceId, workflowStatus?.latest?.documentId, document?.id, versions.length]);

  const brandDraftSignature = useMemo(
    () =>
      JSON.stringify({
        mission: brandForm.mission,
        valueProposition: brandForm.valueProposition,
        productOrService: brandForm.productOrService,
        region: brandForm.region,
        audiencePersonas: brandForm.audiencePersonas,
        pains: brandForm.pains,
        desires: brandForm.desires,
        objections: brandForm.objections,
        bannedPhrases: brandForm.bannedPhrases,
        requiredClaims: brandForm.requiredClaims,
        exemplars: brandForm.exemplars,
        summary: brandForm.summary,
        voiceBold: brandForm.voiceBold,
        voiceFormal: brandForm.voiceFormal,
        voicePlayful: brandForm.voicePlayful,
        voiceDirect: brandForm.voiceDirect,
      }),
    [brandForm]
  );

  useEffect(() => {
    if (loading) return;
    if (brandReady) return;
    if (autofillBusy || isBusy) return;
    if (!hasBrandDraftSignal(brandForm)) return;
    const timer = window.setTimeout(() => {
      void autoSaveBrandDnaDraft("typing");
    }, 1400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loading, brandReady, autofillBusy, isBusy, brandForm, brandDraftSignature, autoSaveBrandDnaDraft]);

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
          if (!extractionAutosaveRunIdsRef.current.has(run.id)) {
            extractionAutosaveRunIdsRef.current.add(run.id);
            setExtractionAutosavedAt(new Date().toISOString());
          }
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
        setCurationAutosavedAt(new Date().toISOString());
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

  const toggleCompareReference = useCallback((referenceId: string) => {
    setCompareReferenceIds((previous) => {
      if (previous.includes(referenceId)) {
        return previous.filter((id) => id !== referenceId);
      }
      return [...previous, referenceId].slice(-2);
    });
  }, []);

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
    if (!generation) return;
    setIsBusy(true);
    setError(null);
    try {
      const payload = await createViralStudioDocument(workspaceId, {
        generationId: generation.id,
        title: "Campaign Pack - Plan 6",
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
  }, [workspaceId, generation, refreshTelemetry, refreshWorkflow]);

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
    if (!generation) return;
    setIsBusy(true);
    setError(null);
    setChatBridgeStatus(null);
    try {
      const { branchId } = await resolveChatBranch();
      const payload = buildGenerationChatBridgePayload(generation, references);
      await sendRuntimeMessage(workspaceId, branchId, {
        content: payload.content,
        mode: "send",
        blocksJson: payload.blocksJson,
        citationsJson: payload.citationsJson,
        ...(payload.libraryRefs.length ? { libraryRefs: payload.libraryRefs } : {}),
      });
      setChatBridgeStatus("Generation pack sent to core chat successfully.");
    } catch (bridgeError: unknown) {
      setError(String((bridgeError as Error)?.message || "Failed to send pack to chat"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, generation, references, resolveChatBranch]);

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
      brandAutosaveFingerprintRef.current = JSON.stringify(buildBrandDnaPayload("draft"));
      setBrandAutosaveState("saved");
      setBrandAutosavedAt(new Date().toISOString());
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
  }, [workspaceId, autofillPreview, autofillSelection, refreshWorkflow, refreshTelemetry, buildBrandDnaPayload]);

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
      setCurationAutosavedAt(new Date().toISOString());
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
      if (!extractionAutosaveRunIdsRef.current.has(terminalRun.id)) {
        extractionAutosaveRunIdsRef.current.add(terminalRun.id);
        setExtractionAutosavedAt(new Date().toISOString());
      }

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

  const setOnboardingStepWithAutosave = useCallback(
    (nextStep: 1 | 2 | 3 | 4) => {
      const previousStep = onboardingStep;
      if (!brandReady && nextStep > previousStep && isStepValid(previousStep, brandForm)) {
        void autoSaveBrandDnaDraft("step");
      }
      setOnboardingStep(nextStep);
    },
    [onboardingStep, brandReady, brandForm, autoSaveBrandDnaDraft]
  );

  useEffect(() => {
    if (loading) return;
    try {
      window.localStorage.setItem(onboardingStepStorageKey, String(onboardingStep));
    } catch {
      // Ignore storage failures.
    }
  }, [loading, onboardingStepStorageKey, onboardingStep]);

  useEffect(() => {
    if (loading) return;
    try {
      window.localStorage.setItem(activeSlideStorageKey, activeSlide);
    } catch {
      // Ignore storage failures.
    }
  }, [loading, activeSlideStorageKey, activeSlide]);

  useEffect(() => {
    if (loading) return;
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        const isTypingTarget =
          tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
        if (isTypingTarget) return;
      }
      const currentIndex = STUDIO_SLIDE_ORDER.indexOf(activeSlide);
      if (currentIndex < 0) return;
      if (event.key === "ArrowLeft" && currentIndex > 0) {
        event.preventDefault();
        setActiveSlide(STUDIO_SLIDE_ORDER[currentIndex - 1]);
      } else if (event.key === "ArrowRight" && currentIndex < STUDIO_SLIDE_ORDER.length - 1) {
        event.preventDefault();
        setActiveSlide(STUDIO_SLIDE_ORDER[currentIndex + 1]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [loading, activeSlide]);

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
  const foundationAutosaveNote = brandReady
    ? `Finalized and saved at ${formatShortTime(brandProfile?.updatedAt)}`
    : brandAutosaveState === "saving"
      ? "Auto-saving foundation..."
      : brandAutosaveState === "saved"
        ? `Foundation auto-saved at ${formatShortTime(brandAutosavedAt)}`
        : brandAutosaveState === "error"
          ? "Auto-save failed. Keep editing and retry finalize."
          : "Auto-save activates as soon as inputs are added.";
  const extractionAutosaveNote = extractionAutosavedAt
    ? `Downloaded references auto-saved at ${formatShortTime(extractionAutosavedAt)}`
    : activeIngestion
      ? "Run progress is persisted automatically."
      : "Downloaded references auto-save when extraction finishes.";
  const curationAutosaveNote = curationAutosavedAt
    ? `Shortlist auto-saved at ${formatShortTime(curationAutosavedAt)}`
    : "Shortlist decisions auto-save per action.";
  const generationAutosaveNote = generationSaveStatus || "Every generation revision auto-saves to the document timeline.";
  const launchpadCards: Array<{
    id: "foundation" | "references" | "create";
    eyebrow: string;
    title: string;
    body: string;
    stat: string;
    saveNote: string;
    actionLabel: string;
    action: () => void | Promise<void>;
    disabled?: boolean;
  }> = [
    {
      id: "foundation",
      eyebrow: "01 Foundation",
      title: brandReady ? "Brand DNA is ready" : "Brand DNA needs one clean pass",
      body: brandReady
        ? compactText(brandProfile?.summary || "Brand DNA is finalized and ready to drive generation.", 170)
        : "Use one website-first autofill pass, confirm the summary, and finalize voice guardrails.",
      stat: `${onboardingCoveragePct}% coverage`,
      saveNote: foundationAutosaveNote,
      actionLabel: brandReady ? "Edit DNA" : workflowGuide.cta,
      action: () => {
        setActiveSlide("foundation");
        if (brandReady) {
          setIsEditingBrandDna(true);
          return;
        }
        void runWorkflowGuideAction();
      },
      disabled: isBusy || autofillBusy,
    },
    {
      id: "references",
      eyebrow: "02 Reference Engine",
      title: activeIngestion ? "Reference engine is active" : "Reference engine is ready to run",
      body: latestSuggestedSource
        ? `${latestSuggestedSource.label} is the top website/social source. Run data-max extraction and curate only the winners.`
        : "We will use suggested website and social evidence as soon as intake is complete.",
      stat: latestReferenceSummary,
      saveNote: `${extractionAutosaveNote} ${curationAutosaveNote}`,
      actionLabel: activeIngestion ? "Open reference engine" : "Start extraction",
      action: async () => {
        setActiveSlide("reference");
        if (activeIngestion) {
          await openIngestionResults(activeIngestion);
          return;
        }
        if (!brandReady) {
          setError("Finalize Brand DNA before extraction.");
          setOnboardingStep(4);
          setIsEditingBrandDna(true);
          return;
        }
        setIsBusy(true);
        setError(null);
        try {
          await startGuidedDataMaxExtraction();
        } catch (ingestionError: unknown) {
          const message = String((ingestionError as Error)?.message || "Failed to start extraction");
          if (message.includes("No source URL available")) {
            setShowExtractionModal(true);
          } else {
            setError(message);
          }
        } finally {
          setIsBusy(false);
        }
      },
      disabled: isBusy || autofillBusy || autopilotBusy,
    },
    {
      id: "create",
      eyebrow: "03 Create & Save",
      title: generation ? "Generation and version history are live" : "Create one campaign pack",
      body: generation
        ? `Revision ${generation.revision} is available and every revision now saves into document history automatically.`
        : "Generate one multi-pack and let the studio save each revision into the document timeline.",
      stat: document ? `${versions.length} saved version(s)` : "No document yet",
      saveNote: generationAutosaveNote,
      actionLabel: generation ? "Open create & save" : "Generate pack",
      action: async () => {
        setActiveSlide("create");
        if (generation) {
          return;
        }
        if (!brandReady) {
          setError("Finalize Brand DNA before generation.");
          setOnboardingStep(4);
          setIsEditingBrandDna(true);
          return;
        }
        if (prioritizedReferenceCount === 0 && references.length > 0) {
          await autoCurateTopReferences(references);
        }
        await generatePack();
      },
      disabled: isBusy || autofillBusy || autopilotBusy,
    },
  ];

  const runWorkflowGuideAction = useCallback(async () => {
    if (workflowGuide.action === "open_intake") {
      router.push(`/app/w/${workspaceId}/intake`);
      return;
    }
    if (workflowGuide.action === "run_autofill") {
      setActiveSlide("foundation");
      await runAutofillFinalize();
      return;
    }
    if (workflowGuide.action === "start_extraction") {
      setActiveSlide("reference");
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
      setActiveSlide("reference");
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
      setActiveSlide("create");
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

  const toneCards = useMemo(() => buildTonePreviewCards(brandForm), [brandForm]);
  const leadReference = selectedReference || references[0] || null;
  const leadReferenceVisual = useMemo(
    () => (leadReference ? resolveReferenceVisual(leadReference) : null),
    [leadReference]
  );
  const workflowStageCards = useMemo(
    () =>
      WORKFLOW_STAGE_META.map((item, index) => ({
        ...item,
        state:
          index < workflowStepIndex ? "done" : index === workflowStepIndex ? "active" : "upcoming",
      })),
    [workflowStepIndex]
  );

  const actionDock = useMemo(() => {
    if (activeSlide === "launchpad") {
      return {
        eyebrow: "Launch handlers",
        title: workflowGuide.title,
        note: workflowGuide.body,
        saveNote: generationAutosaveNote,
        shortcuts: ["Jump stages", "Website-first", "Send to chat"],
        actions: [
          {
            key: "guide",
            label: workflowGuide.cta,
            icon: Rocket,
            emphasis: "primary" as const,
            disabled: isBusy || autofillBusy,
            run: () => runWorkflowGuideAction(),
          },
          {
            key: "autopilot",
            label: autopilotBusy ? "Autopilot running" : "Website-first autopilot",
            icon: WandSparkles,
            emphasis: "ghost" as const,
            disabled: isBusy || autofillBusy || autopilotBusy,
            run: () => runWebsiteFirstAutopilot(),
          },
          {
            key: "chat",
            label: "Open core chat",
            icon: Bot,
            emphasis: "ghost" as const,
            disabled: false,
            run: () => router.push(`/app/w/${workspaceId}`),
          },
        ],
      };
    }

    if (activeSlide === "foundation") {
      return {
        eyebrow: "Foundation handlers",
        title: brandReady && !isEditingBrandDna ? "DNA is locked in" : `Question cluster ${onboardingStep} of 4`,
        note:
          brandReady && !isEditingBrandDna
            ? "The brand summary is active across extraction, generation, and chat."
            : activeOnboardingMeta.helper,
        saveNote: foundationAutosaveNote,
        shortcuts: ["Preview then apply", "One cluster at a time", "Finalize once"],
        actions: [
          {
            key: "preview",
            label: autofillBusy ? "Previewing" : "Preview autofill",
            icon: WandSparkles,
            emphasis: "ghost" as const,
            disabled: autofillBusy || isBusy,
            run: () => previewAutofill(),
          },
          {
            key: "apply",
            label: `Apply selected (${selectedAutofillCount})`,
            icon: Sparkles,
            emphasis: "ghost" as const,
            disabled: autofillBusy || isBusy || !autofillPreview || selectedAutofillCount === 0,
            run: () => applyAutofill(),
          },
          {
            key: "advance",
            label:
              brandReady && !isEditingBrandDna
                ? "Edit DNA"
                : onboardingStep === 4
                  ? "Finalize DNA"
                  : "Next cluster",
            icon: brandReady && !isEditingBrandDna ? Palette : CheckCircle2,
            emphasis: "primary" as const,
            disabled:
              isBusy ||
              (!(brandReady && !isEditingBrandDna) &&
                (onboardingStep === 4 ? !isStepValid(4, brandForm) : !isStepValid(onboardingStep, brandForm))),
            run: () => {
              if (brandReady && !isEditingBrandDna) {
                setIsEditingBrandDna(true);
                return;
              }
              if (onboardingStep === 4) {
                return saveBrandDna("final");
              }
              return setOnboardingStepWithAutosave(Math.min(4, onboardingStep + 1) as 1 | 2 | 3 | 4);
            },
          },
          {
            key: "references",
            label: "Go to references",
            icon: ArrowRight,
            emphasis: "ghost" as const,
            disabled: !brandReady,
            run: () => setActiveSlide("reference"),
          },
        ],
      };
    }

    if (activeSlide === "reference") {
      return {
        eyebrow: "Reference handlers",
        title: activeIngestion ? "Extraction and curation are live" : "Load winners, then steer them visibly",
        note:
          activeIngestion?.status === "running"
            ? "Progress is durable while the run keeps downloading, analyzing, and ranking."
            : "Use shortlist handlers on the selected card or send the winning set back into chat.",
        saveNote: `${extractionAutosaveNote} ${curationAutosaveNote}`,
        shortcuts: ["1 pin", "2 must-use", "3 exclude", "0 clear"],
        actions: [
          {
            key: "extract",
            label: activeIngestion ? "Refresh run" : "Start extraction",
            icon: ScanSearch,
            emphasis: "primary" as const,
            disabled: isBusy || (!brandReady && !activeIngestion),
            run: async () => {
              if (activeIngestion) {
                await openIngestionResults(activeIngestion);
                return;
              }
              setActiveSlide("reference");
              if (!brandReady) {
                setError("Finalize Brand DNA before extraction.");
                setOnboardingStep(4);
                setIsEditingBrandDna(true);
                return;
              }
              setIsBusy(true);
              setError(null);
              try {
                await startGuidedDataMaxExtraction();
              } catch (ingestionError: unknown) {
                const message = String((ingestionError as Error)?.message || "Failed to start extraction");
                if (message.includes("No source URL available")) {
                  setShowExtractionModal(true);
                } else {
                  setError(message);
                }
              } finally {
                setIsBusy(false);
              }
            },
          },
          {
            key: "pin",
            label: "Pin selected",
            icon: Pin,
            emphasis: "ghost" as const,
            disabled: !selectedReference || Boolean(selectedReference && shortlistPendingById[selectedReference.id]),
            run: () =>
              selectedReference ? shortlistReference(selectedReference.id, "pin") : undefined,
          },
          {
            key: "must-use",
            label: "Must-use",
            icon: CheckCircle2,
            emphasis: "ghost" as const,
            disabled: !selectedReference || Boolean(selectedReference && shortlistPendingById[selectedReference.id]),
            run: () =>
              selectedReference ? shortlistReference(selectedReference.id, "must-use") : undefined,
          },
          {
            key: "compare",
            label:
              selectedReference && compareReferenceIds.includes(selectedReference.id)
                ? "Remove compare"
                : "Compare selected",
            icon: Layers3,
            emphasis: "ghost" as const,
            disabled: !selectedReference,
            run: () => (selectedReference ? toggleCompareReference(selectedReference.id) : undefined),
          },
          {
            key: "chat",
            label: "Send shortlist to chat",
            icon: Send,
            emphasis: "ghost" as const,
            disabled: prioritizedReferenceCount === 0 || isBusy,
            run: () => sendShortlistToChat(),
          },
        ],
      };
    }

    return {
      eyebrow: "Create handlers",
      title: generation ? "Pack gallery and vault are live" : "Generate once, then keep every revision",
      note:
        generation
          ? "Refine sections, create versions, and move the winning output into chat or export."
          : "The first run builds the gallery, and each revision saves into the document timeline.",
      saveNote: generationAutosaveNote,
      shortcuts: ["Generate", "Refine", "Version", "Export"],
      actions: [
        {
          key: "generate",
          label: generation ? "Regenerate pack" : "Generate pack",
          icon: Sparkles,
          emphasis: "primary" as const,
          disabled: isBusy || !brandReady,
          run: () => generatePack(),
        },
        {
          key: "document",
          label: document ? "Create version" : "Create document",
          icon: FileText,
          emphasis: "ghost" as const,
          disabled: isBusy || (!generation && !document),
          run: () => {
            if (document) return snapshotVersion();
            return createDocumentFromGeneration();
          },
        },
        {
          key: "chat",
          label: "Send pack to chat",
          icon: Send,
          emphasis: "ghost" as const,
          disabled: !generation || isBusy,
          run: () => sendGenerationToChat(),
        },
        {
          key: "export",
          label: "Export markdown",
          icon: FolderArchive,
          emphasis: "ghost" as const,
          disabled: !document || isBusy,
          run: () => exportDocument("markdown"),
        },
      ],
    };
  }, [
    activeOnboardingMeta.helper,
    activeIngestion,
    activeSlide,
    applyAutofill,
    autofillBusy,
    autofillPreview,
    brandForm,
    brandReady,
    curationAutosaveNote,
    createDocumentFromGeneration,
    document,
    exportDocument,
    extractionAutosaveNote,
    foundationAutosaveNote,
    generatePack,
    generation,
    generationAutosaveNote,
    isBusy,
    onboardingStep,
    openIngestionResults,
    previewAutofill,
    prioritizedReferenceCount,
    router,
    runWebsiteFirstAutopilot,
    runWorkflowGuideAction,
    saveBrandDna,
    selectedAutofillCount,
    selectedReference,
    sendGenerationToChat,
    sendShortlistToChat,
    shortlistPendingById,
    shortlistReference,
    startGuidedDataMaxExtraction,
    snapshotVersion,
    toggleCompareReference,
    workspaceId,
    workflowGuide.body,
    workflowGuide.cta,
    workflowGuide.title,
    compareReferenceIds,
    autopilotBusy,
    isEditingBrandDna,
    setOnboardingStepWithAutosave,
  ]);

  const renderLaunchpadVisual = (cardId: "foundation" | "references" | "create") => {
    if (cardId === "foundation") {
      return (
        <div className="vbs-launchpad-visual vbs-tone-preview-grid">
          {toneCards.map((card) => (
            <article key={card.id} className="vbs-tone-preview-card">
              <p className="vbs-meta">{card.eyebrow}</p>
              <strong>{card.sample}</strong>
            </article>
          ))}
        </div>
      );
    }

    if (cardId === "references") {
      return leadReferenceVisual ? (
        <div className="vbs-launchpad-visual vbs-launchpad-poster">
          <Image
            src={leadReferenceVisual.posterUrl}
            alt={leadReferenceVisual.headline}
            fill
            sizes="(max-width: 900px) 100vw, 420px"
            style={{ objectFit: "cover" }}
          />
          <div className="vbs-launchpad-poster-copy">
            <span>{leadReferenceVisual.eyebrow}</span>
            <strong>{leadReferenceVisual.headline}</strong>
          </div>
        </div>
      ) : (
        <div className="vbs-launchpad-visual vbs-visual-empty">
          <p className="vbs-meta">Visual board</p>
          <strong>Reference posters appear here once extraction begins.</strong>
        </div>
      );
    }

    return (
      <div className="vbs-launchpad-visual vbs-pack-stack">
        {(generation?.outputs.hooks?.slice(0, 3) || [
          "Hooks stack here",
          "Scripts stack here",
          "Captions + CTA variants stack here",
        ]).map((line, index) => (
          <div key={`${cardId}-${index}`} className="vbs-pack-stack-card">
            <span>{index === 0 ? "Hook" : index === 1 ? "Script" : "CTA"}</span>
            <strong>{compactText(line, 74)}</strong>
          </div>
        ))}
      </div>
    );
  };

  const activeSlideIndex = Math.max(0, STUDIO_SLIDE_ORDER.indexOf(activeSlide));
  const canSlideBack = activeSlideIndex > 0;
  const canSlideForward = activeSlideIndex < STUDIO_SLIDE_ORDER.length - 1;
  const slideTransform = `translateX(-${activeSlideIndex * 100}%)`;

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
    <section className="vbs-shell vbs-shell-slides">
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

      {error ? (
        <div className="vbs-alert bat-status bat-status-danger" role="alert">
          <strong>Attention</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {chatBridgeStatus ? (
        <div className="vbs-alert bat-status bat-status-success" role="status" aria-live="polite">
          <strong>Saved to workflow</strong>
          <span>{chatBridgeStatus}</span>
        </div>
      ) : null}

      <div className="vbs-slide-toolbar">
        <div className="vbs-slide-tabs" role="tablist" aria-label="Viral Studio workflow slides">
          {STUDIO_SLIDE_META.map((slide) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={activeSlide === slide.id}
              aria-controls={`vbs-slide-${slide.id}`}
              className={activeSlide === slide.id ? "vbs-slide-tab is-active" : "vbs-slide-tab"}
              onClick={() => setActiveSlide(slide.id)}
            >
              <span>{slide.chapter}</span>
              <strong>
                <slide.icon className="h-3.5 w-3.5" />
                {slide.label}
              </strong>
              <small>{slide.detail}</small>
            </button>
          ))}
        </div>
        <div className="vbs-slide-arrows">
          <button
            type="button"
            onClick={() => setActiveSlide(STUDIO_SLIDE_ORDER[Math.max(0, activeSlideIndex - 1)])}
            disabled={!canSlideBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Previous Slide
          </button>
          <button
            type="button"
            onClick={() => setActiveSlide(STUDIO_SLIDE_ORDER[Math.min(STUDIO_SLIDE_ORDER.length - 1, activeSlideIndex + 1)])}
            disabled={!canSlideForward}
          >
            Next Slide
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="vbs-stage-handler-rail" role="navigation" aria-label="Workflow stages">
        {workflowStageCards.map((item) => {
          const isCurrent = workflowStage === item.stage;
          return (
            <button
              key={item.stage}
              type="button"
              className={[
                "vbs-stage-handler",
                item.state === "active" ? "is-active" : "",
                item.state === "done" ? "is-done" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => {
                if (item.stage === "intake_pending" && workflowStage === "intake_pending") {
                  router.push(`/app/w/${workspaceId}/intake`);
                  return;
                }
                setActiveSlide(item.slide);
              }}
            >
              <span className="vbs-stage-handler-icon">
                <item.icon className="h-4 w-4" />
              </span>
              <span className="vbs-stage-handler-copy">
                <strong>{item.label}</strong>
                <small>{item.caption}</small>
              </span>
              <span className="vbs-stage-handler-state">{item.state === "done" ? "Done" : isCurrent ? "Now" : "Queued"}</span>
            </button>
          );
        })}
      </div>

      <div className="vbs-slide-viewport">
        <div className="vbs-slide-track" style={{ transform: slideTransform }}>
      <section className="vbs-launchpad vbs-slide-card" id="vbs-slide-launchpad" role="tabpanel" aria-label="Launchpad slide">
        <div className="vbs-launchpad-main">
          <div className="vbs-launchpad-copy">
            <p className="vbs-meta">Current mission</p>
            <h2>{workflowGuide.title}</h2>
            <p>{workflowGuide.body}</p>
            <div className="vbs-actions">
              <button type="button" disabled={isBusy || autofillBusy} onClick={() => void runWorkflowGuideAction()}>
                {workflowGuide.cta}
              </button>
              {!brandReady || !activeIngestion || references.length === 0 ? (
                <button
                  type="button"
                  disabled={isBusy || autofillBusy || autopilotBusy}
                  onClick={() => void runWebsiteFirstAutopilot()}
                >
                  {autopilotBusy ? "Running Website-First Autopilot..." : "Run Website-First Autopilot"}
                </button>
              ) : null}
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
        <div className="vbs-launchpad-grid">
          {launchpadCards.map((card) => (
            <article key={card.id} className={`vbs-launchpad-card vbs-launchpad-card-${card.id}`}>
              <p className="vbs-meta">{card.eyebrow}</p>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              {renderLaunchpadVisual(card.id)}
              <div className="vbs-launchpad-foot">
                <strong>{card.stat}</strong>
                <button
                  type="button"
                  className="vbs-launchpad-action"
                  onClick={() => void card.action()}
                  disabled={Boolean(card.disabled)}
                >
                  {card.actionLabel}
                </button>
              </div>
              <p className="vbs-meta vbs-launchpad-save-note">{card.saveNote}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="vbs-stack vbs-slide-card" id="vbs-slide-foundation" role="tabpanel" aria-label="Brand DNA slide">
        <article
          className={[
            "vbs-panel",
            "vbs-section-shell",
            "vbs-chapter-shell",
            "vbs-chapter-foundation",
            brandReady && !isEditingBrandDna ? "is-compact" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          id="vbs-section-onboarding"
          data-chapter="01"
        >
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
                    onClick={() => setOnboardingStepWithAutosave(item.step)}
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
                        <span className="vbs-chip-toggle is-active">
                          {Math.round((suggestion.confidence || 0) * 100)}%
                        </span>
                      </span>
                      <span className="vbs-meta">{compactText(suggestion.rationale, 220)}</span>
                      <span className="vbs-autofill-evidence">
                        {suggestion.sourceEvidence.slice(0, 3).map((entry) => (
                          <span key={`${field}-${entry.label}`} className="vbs-evidence-badge">
                            {entry.label}
                          </span>
                        ))}
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
          <div className="vbs-output vbs-foundation-sources">
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
                  <div className="vbs-tone-preview-grid">
                    {toneCards.map((card) => (
                      <article key={card.id} className="vbs-tone-preview-card">
                        <p className="vbs-meta">{card.eyebrow}</p>
                        <strong>{card.sample}</strong>
                      </article>
                    ))}
                  </div>
                </div>
              </aside>

              <div className="vbs-dna-main">
                <div className="vbs-dna-step-tabs">
                  {ONBOARDING_STEP_META.map((item) => (
                    <button
                      key={item.step}
                      type="button"
                      className={item.step === onboardingStep ? "vbs-chip-toggle is-active" : "vbs-chip-toggle"}
                      onClick={() => setOnboardingStepWithAutosave(item.step)}
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
                    onClick={() => setOnboardingStepWithAutosave(Math.max(1, onboardingStep - 1) as 1 | 2 | 3 | 4)}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={onboardingStep === 4 || !isStepValid(onboardingStep, brandForm) || isBusy}
                    onClick={() => setOnboardingStepWithAutosave(Math.min(4, onboardingStep + 1) as 1 | 2 | 3 | 4)}
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
            Status: <strong>{brandProfile?.status || "draft"}</strong> • Ready: <strong>{brandProfile?.completeness.ready ? "yes" : "no"}</strong> • Updated: {formatTimestamp(brandProfile?.updatedAt)} • Autosave:{" "}
            <strong>{brandAutosaveState === "saving" ? "saving" : brandAutosaveState === "saved" ? "saved" : brandAutosaveState === "error" ? "error" : "idle"}</strong>
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
          <article
            className="vbs-panel vbs-section-shell vbs-chapter-shell vbs-chapter-reference vbs-slide-card"
            id="vbs-slide-reference"
            role="tabpanel"
            aria-label="Reference engine slide"
            data-chapter="02"
          >
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
            <div className="vbs-grid">
              <article className="vbs-panel" id="vbs-section-extraction">
                <div className="vbs-extraction-stage">
                  <div className="vbs-extraction-launchpad">
                    <p className="vbs-meta">Launch</p>
                    <h3>Start with the strongest source, not a blank form</h3>
                    <p>
                      Viral Studio can start from suggested social sources immediately. Open the setup sheet when you need to
                      adjust platform, preset, or volume.
                    </p>
                    <div className="vbs-extraction-facts">
                      <div>
                        <span>Top source</span>
                        <strong>{latestSuggestedSource ? latestSuggestedSource.label : "Awaiting intake evidence"}</strong>
                      </div>
                      <div>
                        <span>Preset</span>
                        <strong>{toPresetLabel(ingestionPreset)}</strong>
                      </div>
                      <div>
                        <span>Depth</span>
                        <strong>{maxVideos} videos</strong>
                      </div>
                    </div>
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
                  </div>

                  <div className="vbs-extraction-source-grid">
                    {(suggestedSources.length ? suggestedSources.slice(0, 3) : [null]).map((source, index) =>
                      source ? (
                        <article key={`${source.platform}:${source.sourceUrl}`} className="vbs-extraction-source-card">
                          <p className="vbs-meta">Suggested source {index + 1}</p>
                          <h4>{source.label}</h4>
                          <p>{source.sourceUrl}</p>
                          <div className="vbs-mini-actions">
                            <span className="vbs-chip-toggle is-active">
                              {toPlatformLabel(source.platform)} • {Math.round((source.confidence || 0) * 100)}%
                            </span>
                            <button type="button" disabled={isBusy} onClick={() => selectSuggestedSource(source)}>
                              Use Source
                            </button>
                          </div>
                        </article>
                      ) : (
                        <article key="empty-source" className="vbs-extraction-source-card">
                          <p className="vbs-meta">Suggested source</p>
                          <h4>Need more intake evidence</h4>
                          <p>Add or improve website and social inputs so the extraction setup can prefill high-confidence sources.</p>
                        </article>
                      )
                    )}
                  </div>
                </div>

                <div className="vbs-output vbs-extraction-monitor">
                  <div className="vbs-curation-kpis">
                    <div>
                      <span>Status</span>
                      <strong>{activeIngestion ? statusLabel(activeIngestion.status) : "Idle"}</strong>
                    </div>
                    <div>
                      <span>Ranked</span>
                      <strong>{activeIngestion ? activeIngestion.progress.ranked : 0}</strong>
                    </div>
                    <div>
                      <span>Window</span>
                      <strong>{activeIngestion ? `${activeIngestion.lookbackDays}d` : `${lookbackDays}d`}</strong>
                    </div>
                  </div>
                  {activeIngestion ? (
                    <>
                      <p className="vbs-meta">
                        Active run: {toPlatformLabel(activeIngestion.sourcePlatform)} • Attempt {activeIngestion.attempt || 1} •
                        Preset {toPresetLabel(activeIngestion.preset)}
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
                    </>
                  ) : (
                    <p className="vbs-meta">No active run yet. Start with the suggested source or open the extraction sheet.</p>
                  )}
                </div>

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
                <div className="vbs-curation-shell">
                  <div className="vbs-curation-topline">
                    <div>
                      <h2 className="vbs-panel-title">Reference Curation</h2>
                      <p className="vbs-panel-subtitle">Review the ranking, pick winners, and keep only what deserves to steer generation.</p>
                    </div>
                    <div className="vbs-curation-kpis">
                      <div>
                        <span>Must-use</span>
                        <strong>{referenceCounts["must-use"]}</strong>
                      </div>
                      <div>
                        <span>Pinned</span>
                        <strong>{referenceCounts.pin}</strong>
                      </div>
                      <div>
                        <span>Excluded</span>
                        <strong>{referenceCounts.exclude}</strong>
                      </div>
                    </div>
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
                      <button type="button" disabled={isBusy || references.length === 0} onClick={() => void autoCurateTopReferences(references)}>
                        Auto-Curate Top 3
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

                  <div className="vbs-curation-assist">
                    <div className="vbs-mini-actions">
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
                    </div>
                    <div className="vbs-shortlist-handler-rail">
                      <button
                        type="button"
                        disabled={!selectedReference || Boolean(selectedReference && shortlistPendingById[selectedReference.id])}
                        onClick={() => selectedReference && void shortlistReference(selectedReference.id, "pin")}
                      >
                        <Pin className="h-4 w-4" />
                        Pin
                      </button>
                      <button
                        type="button"
                        disabled={!selectedReference || Boolean(selectedReference && shortlistPendingById[selectedReference.id])}
                        onClick={() => selectedReference && void shortlistReference(selectedReference.id, "must-use")}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Must-use
                      </button>
                      <button
                        type="button"
                        disabled={!selectedReference || Boolean(selectedReference && shortlistPendingById[selectedReference.id])}
                        onClick={() => selectedReference && void shortlistReference(selectedReference.id, "exclude")}
                      >
                        <CircleOff className="h-4 w-4" />
                        Exclude
                      </button>
                      <button
                        type="button"
                        disabled={!selectedReference || Boolean(selectedReference && shortlistPendingById[selectedReference.id])}
                        onClick={() => selectedReference && void shortlistReference(selectedReference.id, "clear")}
                      >
                        <ArrowLeft className="h-4 w-4" />
                        Clear
                      </button>
                      <button
                        type="button"
                        aria-pressed={selectedReference ? compareReferenceIds.includes(selectedReference.id) : false}
                        disabled={!selectedReference}
                        onClick={() => selectedReference && toggleCompareReference(selectedReference.id)}
                      >
                        <Layers3 className="h-4 w-4" />
                        Compare
                      </button>
                      <button
                        type="button"
                        onClick={() => void sendShortlistToChat()}
                        disabled={isBusy || filteredReferences.length === 0}
                      >
                        <Send className="h-4 w-4" />
                        Send to chat
                      </button>
                    </div>
                    <div className="vbs-shortcut-chips" aria-label="Keyboard shortcuts">
                      <span>1 Pin</span>
                      <span>2 Must-use</span>
                      <span>3 Exclude</span>
                      <span>0 Clear</span>
                    </div>
                  </div>

                  <div className={referenceViewMode === "grid" ? "vbs-reference-board-grid" : "vbs-reference-board-list"}>
                    {filteredReferences.map((reference) => {
                      const visual = resolveReferenceVisual(reference);
                      return (
                        <div
                          key={reference.id}
                          className={[
                            "vbs-reference-card",
                            selectedReference?.id === reference.id ? "is-selected" : "",
                            compareReferenceIds.includes(reference.id) ? "is-compare" : "",
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
                              <div className="vbs-reference-poster">
                              <Image
                                src={visual.posterUrl}
                                alt={`${toPlatformLabel(reference.sourcePlatform)} reference preview`}
                                fill
                                unoptimized
                                sizes="(max-width: 1100px) 100vw, 33vw"
                              />
                              <div className="vbs-reference-poster-top">
                                <span className="vbs-rank-badge">#{reference.ranking.rank}</span>
                                <span className={`vbs-reference-state vbs-reference-state-${reference.shortlistState}`}>
                                  {shortlistLabel(reference.shortlistState)}
                                </span>
                              </div>
                              <div className="vbs-reference-poster-bottom">
                                <p className="vbs-reference-eyebrow">{visual.eyebrow}</p>
                                <h3>{visual.headline}</h3>
                                <p>{visual.footer}</p>
                              </div>
                            </div>
                            <div className="vbs-reference-card-summary">
                              <div className="vbs-reference-card-copy">
                                <p>{reference.ranking.rationaleTitle}</p>
                                <p className="vbs-meta">
                                  {toPlatformLabel(reference.sourcePlatform)} • score {reference.scores.composite.toFixed(3)} •{" "}
                                  {formatCompactNumber(reference.metrics.views)} views
                                </p>
                              </div>
                              <div className="vbs-top-driver-row">
                                {reference.explainability.topDrivers.slice(0, 2).map((driver) => (
                                  <span key={driver} className="vbs-driver-chip">
                                    {driver}
                                  </span>
                                ))}
                              </div>
                            </div>
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
                  {selectedReference && selectedReferenceInsights ? (
                    <div className="vbs-analysis-drawer">
                      {(() => {
                        const visual = resolveReferenceVisual(selectedReference);
                        return (
                          <>
                            <p className="vbs-meta">
                              Analysis Drawer • #{selectedReference.ranking.rank} • {toPlatformLabel(selectedReference.sourcePlatform)} •{" "}
                              {shortlistLabel(selectedReference.shortlistState)}
                            </p>
                            <div className="vbs-analysis-hero">
                              <div className="vbs-analysis-poster">
                                <Image
                                  src={visual.posterUrl}
                                  alt={`${toPlatformLabel(selectedReference.sourcePlatform)} reference analysis preview`}
                                  fill
                                  unoptimized
                                  sizes="(max-width: 1100px) 100vw, 40vw"
                                />
                              </div>
                              <div className="vbs-analysis-story">
                                <div className="vbs-analysis-story-head">
                                  <h3>{visual.headline}</h3>
                                  <p>{selectedReference.ranking.rationaleTitle}</p>
                                </div>
                                <div className="vbs-top-driver-row">
                                  {selectedReference.explainability.topDrivers.map((driver) => (
                                    <span key={driver} className="vbs-driver-chip">
                                      {driver}
                                    </span>
                                  ))}
                                </div>
                                <div className="vbs-analysis-story-grid">
                                  <article>
                                    <span>Hook</span>
                                    <strong>{compactText(selectedReference.caption, 120)}</strong>
                                  </article>
                                  <article>
                                    <span>Narrative Beat</span>
                                    <strong>{compactText(selectedReference.transcriptSummary, 120)}</strong>
                                  </article>
                                  <article>
                                    <span>On-screen Text</span>
                                    <strong>{compactText(selectedReference.ocrSummary, 120)}</strong>
                                  </article>
                                </div>
                              </div>
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
                            <ul>
                              {selectedReference.explainability.whyRankedHigh.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                            {comparedReferences.length === 2 ? (
                              <div className="vbs-compare-panel">
                                <div className="vbs-compare-panel-head">
                                  <h4>Compare winners</h4>
                                  <p className="vbs-meta">Two references selected for side-by-side steering.</p>
                                </div>
                                <div className="vbs-compare-grid">
                                  {comparedReferences.map((reference) => (
                                    <article key={reference.id} className="vbs-compare-card">
                                      <p className="vbs-meta">
                                        #{reference.ranking.rank} • {toPlatformLabel(reference.sourcePlatform)}
                                      </p>
                                      <strong>{compactText(reference.ranking.rationaleTitle, 80)}</strong>
                                      <p>{compactText(reference.caption || reference.transcriptSummary || "", 110)}</p>
                                      <div className="vbs-mini-actions">
                                        <span className="vbs-chip-toggle is-active">
                                          {reference.scores.composite.toFixed(3)}
                                        </span>
                                        <button type="button" onClick={() => setSelectedReferenceId(reference.id)}>
                                          Focus
                                        </button>
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            <div className="vbs-source-context">
                              <h4>Source Context</h4>
                              <p className="vbs-meta">{selectedReference.caption}</p>
                              <p className="vbs-meta">{selectedReference.transcriptSummary}</p>
                              <p className="vbs-meta">{selectedReference.ocrSummary}</p>
                              <p className="vbs-meta">
                                Formula {selectedReference.explainability.formulaVersion} • Shortcuts: 1 pin, 2 must-use, 3
                                exclude, 0 clear
                              </p>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : null}
                </div>
              </article>
            </div>
          </article>

          <article
            className="vbs-panel vbs-section-shell vbs-chapter-shell vbs-chapter-create vbs-slide-card"
            id="vbs-slide-create"
            role="tabpanel"
            aria-label="Create and save slide"
            data-chapter="03"
          >
            <div className="vbs-section-head">
              <div>
                <p className="vbs-meta">Create & Save</p>
                <h2 className="vbs-panel-title">Generate, refine, and keep every revision</h2>
                <p className="vbs-panel-subtitle">
                  Build the pack, edit the durable document, and let the studio keep version history automatically.
                </p>
              </div>
              <div className="vbs-status-strip">
                <span>{generation ? `Revision ${generation.revision}` : "No generation yet"}</span>
                <span>{document ? "Document ready" : "Document pending"}</span>
                <span>{versions.length} versions</span>
              </div>
            </div>
            <div className="vbs-grid">
              <article className="vbs-panel vbs-prompt-studio" id="vbs-section-generation">
                <h2 className="vbs-panel-title">Prompt Studio</h2>
                <p className="vbs-panel-subtitle">
                  Set the brief once, then refine only the sections that need more edge, clarity, or control.
                </p>
                <div className="vbs-create-overview">
                  <div className="vbs-create-preview-board">
                    <div className="vbs-create-preview-head">
                      <div>
                        <p className="vbs-meta">Campaign preview</p>
                        <h3>{generation ? "Your pack is becoming a visual gallery" : "The first revision will populate the gallery"}</h3>
                      </div>
                      <div className="vbs-output-badge">
                        {generatedSectionCount}/{PROMPT_STUDIO_SECTIONS.length} live
                      </div>
                    </div>
                    <div className="vbs-create-preview-grid">
                      {generationGalleryPreview.map((item) => (
                        <article
                          key={item.id}
                          className={`vbs-create-preview-card ${item.count > 0 ? "is-ready" : ""} ${item.kind === "text" ? "is-script" : ""}`}
                        >
                          <span>{item.kind === "list" ? `${Math.max(1, item.count)} variants` : "Narrative block"}</span>
                          <strong>{item.title}</strong>
                          <p>{item.preview}</p>
                        </article>
                      ))}
                    </div>
                    <div className="vbs-quality-gate-strip">
                      {qualityGateCards.map((item) => (
                        <article key={item.label} className={`vbs-quality-gate-card is-${item.tone}`}>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </article>
                      ))}
                    </div>
                  </div>
                  <aside className="vbs-save-vault-card">
                    <p className="vbs-meta">Save vault</p>
                    <h3>{document ? document.title : generation ? "Campaign Pack Vault" : "Vault waiting for first pack"}</h3>
                    <p>
                      Every revision is durable here, so generation feels like a creative timeline instead of disposable output.
                    </p>
                    <div className="vbs-save-vault-kpis">
                      <div>
                        <span>Autosave</span>
                        <strong>{autosaveLabel}</strong>
                      </div>
                      <div>
                        <span>Latest</span>
                        <strong>{latestVersion ? `v${latestVersion.versionNumber}` : generation ? `r${generation.revision}` : "None"}</strong>
                      </div>
                      <div>
                        <span>Exports</span>
                        <strong>{lastExport ? lastExport.format.toUpperCase() : "Pending"}</strong>
                      </div>
                    </div>
                    <div className="vbs-save-vault-rail">
                      {versionTimelinePreview.length > 0 ? (
                        versionTimelinePreview.map((version) => (
                          <article key={version.id} className="vbs-save-vault-step">
                            <span>v{version.versionNumber}</span>
                            <strong>{version.summary || "Snapshot"}</strong>
                            <p>{formatTimestamp(version.createdAt)}</p>
                          </article>
                        ))
                      ) : (
                        <article className="vbs-save-vault-step is-empty">
                          <span>Vault</span>
                          <strong>Published versions will appear here.</strong>
                          <p>Create the first version after the pack looks right.</p>
                        </article>
                      )}
                    </div>
                  </aside>
                </div>
                <div className="vbs-generation-shell">
                  <div className="vbs-generation-brief">
                    <div className="vbs-generation-hero">
                      <div>
                        <p className="vbs-meta">Generation brief</p>
                        <h3>{selectedTemplate?.title || "Campaign pack setup"}</h3>
                        <p>
                          Brand DNA, prioritized references, and format target combine here. This should feel like setting
                          direction, not filling a machine.
                        </p>
                      </div>
                      <div className="vbs-generation-summary">
                        <div>
                          <span>References</span>
                          <strong>{prioritizedReferenceCount}</strong>
                        </div>
                        <div>
                          <span>Format</span>
                          <strong>{toGenerationFormatLabel(generationFormatTarget)}</strong>
                        </div>
                        <div>
                          <span>Revision</span>
                          <strong>{generation ? generation.revision : "Draft"}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="vbs-generation-ribbon" role="status" aria-live="polite">
                      <span>Auto-save on every revision</span>
                      <span>{generation ? `Quality ${generation.qualityCheck.passed ? "ready" : "review"}` : "Waiting for first draft"}</span>
                      <span>{generatedSectionCount}/{PROMPT_STUDIO_SECTIONS.length} sections ready</span>
                    </div>
                    <div className="vbs-generation-deliverables">
                      {PROMPT_STUDIO_SECTIONS.map((sectionMeta) => {
                        const ready = generation ? readGenerationSectionContent(generation, sectionMeta.id).length > 0 : false;
                        return (
                          <span key={sectionMeta.id} className={`vbs-deliverable-chip ${ready ? "is-ready" : ""}`}>
                            {sectionMeta.title}
                          </span>
                        );
                      })}
                    </div>
                    <div className="vbs-prompt-two-pane">
                      <div className="vbs-prompt-controls">
                        <div className="vbs-prompt-controls-head">
                          <div>
                            <p className="vbs-meta">Direction setup</p>
                            <h3>Shape the pack once</h3>
                            <p>
                              Pick the output frame, add one clear instruction, then let the section cards carry the rest of
                              the iteration.
                            </p>
                          </div>
                          <div className="vbs-prompt-control-stats">
                            <div>
                              <span>Template</span>
                              <strong>{selectedTemplate?.title || "None"}</strong>
                            </div>
                            <div>
                              <span>Save state</span>
                              <strong>{generationSaveStatus ? "Synced" : "Ready"}</strong>
                            </div>
                          </div>
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
                        <label className="vbs-prompt-direction">
                          Prompt direction
                          <textarea value={promptText} rows={4} onChange={(e) => setPromptText(e.target.value)} />
                        </label>
                        <div className="vbs-generation-actions">
                          <button type="button" disabled={isBusy} onClick={() => void generatePack()}>
                            Generate Multi-Pack
                          </button>
                          <button type="button" disabled={isBusy || !generation} onClick={() => void sendGenerationToChat()}>
                            Send Pack To Chat
                          </button>
                        </div>
                        <div className="vbs-generation-notes">
                          <p className="vbs-meta">Every generation revision is auto-saved into Document Workspace version history.</p>
                          <p className="vbs-meta">{generationSaveStatus || "Your next revision will appear here as soon as the pack finishes."}</p>
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
                          <div className="vbs-generation-empty">
                            <p className="vbs-meta">No generation yet. Launch one run to populate the pack gallery.</p>
                          </div>
                        )}
                      </div>
                      <div className="vbs-prompt-output">
                        <div className="vbs-output-head">
                          <div>
                            <p className="vbs-meta">Pack gallery</p>
                            <h3>Refine card by card</h3>
                          </div>
                          <div className="vbs-output-badge">
                            {generatedSectionCount}/{PROMPT_STUDIO_SECTIONS.length} live
                          </div>
                        </div>
                        {generation ? (
                          PROMPT_STUDIO_SECTIONS.map((sectionMeta) => {
                            const sectionLines = readGenerationSectionContent(generation, sectionMeta.id);
                            const sectionInstruction = sectionInstructions[sectionMeta.id] || "";
                            const isSectionPending = promptActionSection === sectionMeta.id;
                            return (
                              <article
                                key={sectionMeta.id}
                                className={`vbs-pack-card ${activePromptSection === sectionMeta.id ? "is-active" : ""} ${sectionMeta.kind === "text" ? "is-script" : "is-variants"}`}
                                onClick={() => setActivePromptSection(sectionMeta.id)}
                              >
                                <header className="vbs-pack-card-head">
                                  <div>
                                    <p className="vbs-meta">{sectionMeta.kind === "list" ? "Variant set" : "Narrative block"}</p>
                                    <h3>{sectionMeta.title}</h3>
                                  </div>
                                  <span>{sectionMeta.kind === "list" ? `${sectionLines.length} variants` : "1 block"}</span>
                                </header>
                                <div className="vbs-pack-card-body">
                                  {sectionMeta.kind === "list" ? (
                                    <ul className="vbs-pack-variant-list">
                                      {sectionLines.map((line, index) => (
                                        <li key={`${sectionMeta.id}-${index}`}>
                                          <span>{index + 1}</span>
                                          <p>{line}</p>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <div className="vbs-pack-script-panel">
                                      <pre>{sectionLines[0] || ""}</pre>
                                    </div>
                                  )}
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
                          <div className="vbs-output vbs-output-empty">
                            <p className="vbs-meta">Pack gallery waiting</p>
                            <h3>Run Generate Multi-Pack to create your first working draft</h3>
                            <p>
                              The studio will return hooks, scripts, captions, CTAs, and angle remixes as editable cards you
                              can tune one section at a time.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </article>

              <article className="vbs-panel vbs-document-workspace" id="vbs-section-documents">
                <h2 className="vbs-panel-title">Document Workspace</h2>
                <p className="vbs-panel-subtitle">
                  Keep the winning pack as a durable working document, then publish clean versions without losing history.
                </p>
                <div className="vbs-document-shell">
                  <div className="vbs-document-topline">
                    <div className="vbs-document-hero">
                      <div>
                        <p className="vbs-meta">Document control</p>
                        <h3>{document ? document.title : "No document created yet"}</h3>
                        <p>
                          This is the durable artifact for the campaign. Edit the content directly, then snapshot versions when
                          the team reaches a better draft.
                        </p>
                      </div>
                      <div className="vbs-document-summary">
                        <div>
                          <span>Versions</span>
                          <strong>{versions.length}</strong>
                        </div>
                        <div>
                          <span>Autosave</span>
                          <strong>
                            {autosaveState === "saving"
                              ? "Saving"
                              : autosaveState === "saved"
                                ? "Saved"
                                : autosaveState === "error"
                                  ? "Error"
                                  : documentDirty
                                    ? "Pending"
                                    : "Idle"}
                          </strong>
                        </div>
                        <div>
                          <span>Export</span>
                          <strong>{lastExport ? lastExport.format.toUpperCase() : "None"}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="vbs-vault-summary-grid">
                      <article className="vbs-vault-summary-card">
                        <span>Current draft</span>
                        <strong>{documentDraft ? `${documentDraft.sections.length} sections live` : "Not created yet"}</strong>
                        <p>{documentDirty ? "There are unsaved edits waiting in the editor." : "The working document is in sync."}</p>
                      </article>
                      <article className="vbs-vault-summary-card">
                        <span>Latest version</span>
                        <strong>{latestVersion ? latestVersion.summary || `Version ${latestVersion.versionNumber}` : "No published version"}</strong>
                        <p>{latestVersion ? formatTimestamp(latestVersion.createdAt) : "Create a version to lock the draft."}</p>
                      </article>
                      <article className="vbs-vault-summary-card">
                        <span>Export state</span>
                        <strong>{lastExport ? `${lastExport.format.toUpperCase()} ready` : "No export yet"}</strong>
                        <p>{lastExport ? "A fresh export is ready from the latest saved draft." : "Markdown and JSON exports appear after the first save."}</p>
                      </article>
                    </div>
                    <div className="vbs-document-action-bar">
                      <div className="vbs-document-actions">
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
                      </div>
                      <div className="vbs-document-actions vbs-document-actions-secondary">
                        <button type="button" disabled={isBusy || !document} onClick={() => void exportDocument("markdown")}>
                          Export MD
                        </button>
                        <button type="button" disabled={isBusy || !document} onClick={() => void exportDocument("json")}>
                          Export JSON
                        </button>
                      </div>
                    </div>
                    <div className="vbs-document-ribbon" role="status" aria-live="polite">
                      <span>Document {document ? "ready" : "not created yet"}</span>
                      <span>{versions.length} versions</span>
                      <span>Autosave {autosaveLabel.toLowerCase()}</span>
                      <span>{latestVersion ? `Latest ${formatTimestamp(latestVersion.createdAt)}` : "No published version yet"}</span>
                    </div>
                    {generationSaveStatus ? <p className="vbs-meta">{generationSaveStatus}</p> : null}
                  </div>
                  {documentDraft ? (
                    <div className="vbs-document-layout">
                      <div className="vbs-doc-editor">
                        <div className="vbs-doc-editor-head">
                          <div>
                            <p className="vbs-meta">Editor canvas</p>
                            <h3>Shape the durable draft</h3>
                            <p>Reorder sections, polish the copy, and let autosave hold the working state while versions capture milestones.</p>
                          </div>
                          <div className="vbs-document-summary vbs-document-summary-compact">
                            <div>
                              <span>Sections</span>
                              <strong>{documentDraft.sections.length}</strong>
                            </div>
                            <div>
                              <span>Latest export</span>
                              <strong>{lastExport ? lastExport.format.toUpperCase() : "None"}</strong>
                            </div>
                          </div>
                        </div>
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
                      </div>

                      <aside className="vbs-doc-sidebar">
                        <div className="vbs-doc-sidebar-card vbs-doc-compare-controls">
                          <h3>Version Compare</h3>
                          <p className="vbs-meta">Check what changed before you promote a draft into the main working version.</p>
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

                        <div className="vbs-doc-sidebar-card vbs-doc-timeline">
                          <h3>Version Timeline</h3>
                          <p className="vbs-meta">Every checkpoint stays durable, so the team can safely roll forward without losing history.</p>
                          <div className="vbs-version-rail">
                            {versionTimelinePreview.length > 0 ? (
                              versionTimelinePreview.map((version) => (
                                <button
                                  key={version.id}
                                  type="button"
                                  className={`vbs-version-card ${promoteVersionId === version.id ? "is-selected" : ""}`}
                                  onClick={() => setPromoteVersionId(version.id)}
                                >
                                  <span>v{version.versionNumber}</span>
                                  <strong>{version.summary || "Snapshot"}</strong>
                                  <p>{formatTimestamp(version.createdAt)}</p>
                                </button>
                              ))
                            ) : (
                              <div className="vbs-version-card is-empty">
                                <span>Timeline</span>
                                <strong>Your first published version will appear here.</strong>
                                <p>Use Create Version once the draft is ready to lock it in.</p>
                              </div>
                            )}
                          </div>
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
                      </aside>
                    </div>
                  ) : (
                    <div className="vbs-document-empty">
                      <p className="vbs-meta">Document workspace waiting</p>
                      <h3>Turn the best pack into a working document</h3>
                      <p>
                        Once created, the document becomes the durable team artifact for edits, version snapshots, exports, and
                        rollback.
                      </p>
                    </div>
                  )}
                  {lastExport ? (
                    <div className="vbs-export-preview">
                      <p className="vbs-meta">Last export ({lastExport.format})</p>
                      <pre>{lastExport.content}</pre>
                    </div>
                  ) : null}
                </div>
              </article>
            </div>
          </article>
        </>
      ) : (
        <>
          <article className="vbs-panel vbs-slide-card" id="vbs-slide-reference" role="tabpanel" aria-label="Reference engine slide">
            <h2 className="vbs-panel-title">Workflow Locked Until DNA Finalization</h2>
            <p className="vbs-panel-subtitle">Plan 2 onboarding gate is active. Complete and finalize Brand DNA to unlock extraction, generation, and document actions.</p>
          </article>
          <article className="vbs-panel vbs-slide-card" id="vbs-slide-create" role="tabpanel" aria-label="Create and save slide">
            <h2 className="vbs-panel-title">Create & Save unlocks after DNA finalization</h2>
            <p className="vbs-panel-subtitle">Finish the Brand DNA flow once and the generation + versioning workspace will unlock automatically.</p>
          </article>
        </>
      )}
        </div>
      </div>

      <div className="vbs-action-dock" role="toolbar" aria-label="Viral Studio handlers">
        <div className="vbs-action-dock-copy">
          <p className="vbs-meta">{actionDock.eyebrow}</p>
          <h2>{actionDock.title}</h2>
          <p>{actionDock.note}</p>
        </div>
        <div className="vbs-action-dock-actions">
          {actionDock.actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.key}
                type="button"
                className={action.emphasis === "primary" ? "vbs-handler-button is-primary" : "vbs-handler-button"}
                disabled={action.disabled}
                onClick={() => void action.run()}
              >
                <Icon className="h-4 w-4" />
                {action.label}
              </button>
            );
          })}
        </div>
        <div className="vbs-action-dock-meta">
          <div className="vbs-save-ribbon">
            <span>Auto-save</span>
            <strong>{actionDock.saveNote}</strong>
          </div>
          <div className="vbs-shortcut-chips">
            {actionDock.shortcuts.map((shortcut) => (
              <span key={shortcut}>{shortcut}</span>
            ))}
          </div>
        </div>
      </div>

      {showExtractionModal ? (
        <div
          className="vbs-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Extract best videos"
          onClick={() => setShowExtractionModal(false)}
        >
          <div className="vbs-modal" onClick={(event) => event.stopPropagation()}>
            <div className="vbs-modal-grid">
              <div className="vbs-modal-copy">
                <h3>Extract Best Videos</h3>
                <p className="vbs-meta">
                  Start from the strongest source, choose the scan depth, and let the run pipeline handle the rest.
                </p>
                <div className="vbs-extraction-facts">
                  <div>
                    <span>Recommended</span>
                    <strong>Data max</strong>
                  </div>
                  <div>
                    <span>Volume</span>
                    <strong>{maxVideos} videos</strong>
                  </div>
                  <div>
                    <span>Lookback</span>
                    <strong>{lookbackDays} days</strong>
                  </div>
                </div>
                {suggestedSources.length ? (
                  <div className="vbs-source-suggest-list">
                    {suggestedSources.slice(0, 3).map((source) => (
                      <button
                        key={`${source.platform}:${source.sourceUrl}`}
                        type="button"
                        className="vbs-source-suggest-row"
                        onClick={() => {
                          setSourcePlatform(source.platform);
                          setSourceUrl(source.sourceUrl);
                          applyIngestionPreset("data-max");
                        }}
                      >
                        <div>
                          <p>
                            <strong>{source.label}</strong>
                          </p>
                          <p className="vbs-meta">
                            {toPlatformLabel(source.platform)} • {Math.round((source.confidence || 0) * 100)}%
                          </p>
                        </div>
                        <span className="vbs-meta">Apply</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="vbs-modal-form">
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
              </div>
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
