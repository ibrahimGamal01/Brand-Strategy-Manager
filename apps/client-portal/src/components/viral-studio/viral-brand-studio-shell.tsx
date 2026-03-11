"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  applyWorkspaceBrandDnaAutofill,
  compareViralStudioDocumentVersions,
  createViralStudioDocument,
  createViralStudioDocumentVersion,
  createViralStudioGeneration,
  createViralStudioIngestion,
  createWorkspaceBrandDna,
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
  const [isEditingBrandDna, setIsEditingBrandDna] = useState(false);

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
  const launchpadCards: Array<{
    id: "foundation" | "references" | "create";
    eyebrow: string;
    title: string;
    body: string;
    stat: string;
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
      actionLabel: brandReady ? "Edit DNA" : workflowGuide.cta,
      action: () => {
        window.document.getElementById("vbs-section-onboarding")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      actionLabel: activeIngestion ? "Open reference engine" : "Start extraction",
      action: async () => {
        window.document.getElementById("vbs-section-extraction")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      actionLabel: generation ? "Open create & save" : "Generate pack",
      action: async () => {
        window.document.getElementById("vbs-section-create-save")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
            </article>
          ))}
        </div>
      </section>

      <div className="vbs-stack">
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
          <article className="vbs-panel vbs-section-shell vbs-chapter-shell vbs-chapter-reference" data-chapter="02">
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
                    <p className="vbs-meta">Shortcuts: `1` pin, `2` must-use, `3` exclude, `0` clear.</p>
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
                      const visual = resolveReferenceVisual(reference);
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

          <article className="vbs-panel vbs-section-shell vbs-chapter-shell vbs-chapter-create" id="vbs-section-create-save" data-chapter="03">
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
                                className={`vbs-pack-card ${activePromptSection === sectionMeta.id ? "is-active" : ""}`}
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
                                    <ul>
                                      {sectionLines.map((line, index) => (
                                        <li key={`${sectionMeta.id}-${index}`}>{line}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <pre>{sectionLines[0] || ""}</pre>
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
