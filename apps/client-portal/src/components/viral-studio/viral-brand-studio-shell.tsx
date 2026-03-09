"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
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
  fetchViralStudioTelemetry,
  fetchWorkspaceBrandDna,
  generateWorkspaceBrandDnaSummary,
  listViralStudioIngestions,
  listViralStudioReferences,
  patchViralStudioDocument,
  patchWorkspaceBrandDna,
  promoteViralStudioDocumentVersion,
  refineViralStudioGeneration,
  retryViralStudioIngestion,
  updateViralStudioReferenceShortlist,
} from "@/lib/viral-studio-api";
import {
  createRuntimeThread,
  listRuntimeThreads,
  sendRuntimeMessage,
} from "@/lib/runtime-api";
import {
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
  ViralStudioTelemetrySnapshot,
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

type IngestionPreset = "balanced" | "quick-scan" | "deep-scan";
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
  if (preset === "quick-scan") return "Quick scan";
  if (preset === "deep-scan") return "Deep scan";
  return "Balanced";
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

export function ViralBrandStudioShell({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [contracts, setContracts] = useState<ViralStudioContractSnapshot | null>(null);
  const [telemetry, setTelemetry] = useState<ViralStudioTelemetrySnapshot | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<ViralStudioPromptTemplate[]>([]);
  const [brandProfile, setBrandProfile] = useState<BrandDNAProfile | null>(null);
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

  const [sourcePlatform, setSourcePlatform] = useState<ViralStudioPlatform>("instagram");
  const [sourceUrl, setSourceUrl] = useState("");
  const [ingestionPreset, setIngestionPreset] = useState<IngestionPreset>("balanced");
  const [maxVideos, setMaxVideos] = useState(50);
  const [lookbackDays, setLookbackDays] = useState(180);
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

  const refreshTelemetry = useCallback(async () => {
    try {
      const payload = await fetchViralStudioTelemetry(workspaceId);
      setTelemetry(payload.telemetry);
    } catch {
      // Keep last telemetry snapshot if refresh fails.
    }
  }, [workspaceId]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [brandPayload, contractPayload, telemetryPayload, ingestionPayload, referencePayload] = await Promise.all([
        fetchWorkspaceBrandDna(workspaceId),
        fetchViralStudioContracts(workspaceId),
        fetchViralStudioTelemetry(workspaceId),
        listViralStudioIngestions(workspaceId),
        listViralStudioReferences(workspaceId),
      ]);
      setBrandProfile(brandPayload.profile);
      setBrandForm(toFormState(brandPayload.profile));
      setContracts(contractPayload.contract);
      setTelemetry(telemetryPayload.telemetry);
      setPromptTemplates(contractPayload.promptTemplates || []);
      setIngestions(ingestionPayload.runs);
      setActiveIngestion(ingestionPayload.runs[0] || null);
      setReferences(referencePayload.items);
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
      void refreshTelemetry();
    }, 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshTelemetry]);

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
              void refreshTelemetry();
            });
          }
        })
        .catch(() => undefined);
    }, 900);
    return () => {
      window.clearInterval(poller);
    };
  }, [workspaceId, activeIngestion, refreshTelemetry]);

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
        void refreshTelemetry();
      } catch (saveError: unknown) {
        setError(String((saveError as Error)?.message || "Failed to save Brand DNA"));
      } finally {
        setIsBusy(false);
      }
    },
    [workspaceId, brandForm, brandProfile, refreshTelemetry]
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
      void refreshTelemetry();
    } catch (runError: unknown) {
      setError(String((runError as Error)?.message || "Failed to start extraction"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, sourcePlatform, sourceUrl, maxVideos, lookbackDays, ingestionPreset, brandReady, refreshTelemetry]);

  const applyIngestionPreset = useCallback((preset: IngestionPreset) => {
    setIngestionPreset(preset);
    const defaults = presetDefaults(preset);
    setMaxVideos(defaults.maxVideos);
    setLookbackDays(defaults.lookbackDays);
  }, []);

  const openIngestionResults = useCallback(
    async (run: ViralStudioIngestionRun) => {
      setActiveIngestion(run);
      if (run.status === "completed" || run.status === "partial") {
        try {
          const payload = await listViralStudioReferences(workspaceId, { ingestionRunId: run.id });
          setReferences(payload.items);
          void refreshTelemetry();
        } catch {
          // Keep current list if refresh fails.
        }
      }
    },
    [workspaceId, refreshTelemetry]
  );

  const retryExtraction = useCallback(
    async (runId: string) => {
      setIsBusy(true);
      setError(null);
      try {
        const payload = await retryViralStudioIngestion(workspaceId, runId);
        setActiveIngestion(payload.run);
        setIngestions((previous) => [payload.run, ...previous.filter((row) => row.id !== payload.run.id)]);
        void refreshTelemetry();
      } catch (retryError: unknown) {
        setError(String((retryError as Error)?.message || "Failed to retry extraction"));
      } finally {
        setIsBusy(false);
      }
    },
    [workspaceId, refreshTelemetry]
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
        void refreshTelemetry();
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
    [workspaceId, refreshTelemetry]
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
      void refreshTelemetry();
    } catch (generationError: unknown) {
      setError(String((generationError as Error)?.message || "Failed to generate pack"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, selectedReferenceIds, promptText, brandReady, selectedTemplateId, generationFormatTarget, refreshTelemetry]);

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
        void refreshTelemetry();
      } catch (refineError: unknown) {
        setError(String((refineError as Error)?.message || "Failed to refine generation section"));
      } finally {
        setPromptActionSection(null);
        setIsBusy(false);
      }
    },
    [workspaceId, generation, sectionInstructions, refreshTelemetry]
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
      void refreshTelemetry();
    } catch (documentError: unknown) {
      setError(String((documentError as Error)?.message || "Failed to create document"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, generation, refreshTelemetry]);

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
      void refreshTelemetry();
    } catch (versionError: unknown) {
      setError(String((versionError as Error)?.message || "Failed to create document version"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, document, documentDraft, documentDirty, persistDocumentDraft, refreshTelemetry]);

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
      void refreshTelemetry();
    } catch (promoteError: unknown) {
      setError(String((promoteError as Error)?.message || "Failed to promote document version"));
    } finally {
      setIsBusy(false);
    }
  }, [workspaceId, document, promoteVersionId, documentDraft, documentDirty, persistDocumentDraft, refreshTelemetry]);

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
        void refreshTelemetry();
      } catch (exportError: unknown) {
        setError(String((exportError as Error)?.message || "Failed to export document"));
      } finally {
        setIsBusy(false);
      }
    },
    [workspaceId, document, documentDraft, documentDirty, persistDocumentDraft, refreshTelemetry]
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
      <header className="vbs-hero">
        <p className="vbs-chip">Plans 1-4 Active Build</p>
        <h1 className="vbs-title">Viral Brand Studio</h1>
        <p className="vbs-subtitle">
          Pomelli-style 4-step Brand DNA onboarding, reel-inspired extraction, and explainable viral reference curation integrated with generation and document workflows.
        </p>
      </header>

      {error ? <div className="vbs-alert">{error}</div> : null}
      {chatBridgeStatus ? <div className="vbs-alert" style={{ borderColor: "#b6f0d4", background: "#f2fff7", color: "#11643f" }}>{chatBridgeStatus}</div> : null}

      <div className="vbs-grid">
        <article className="vbs-panel">
          <h2 className="vbs-panel-title">Brand DNA Onboarding</h2>
          <p className="vbs-panel-subtitle">Complete all 4 steps and finalize to unlock generation workflow.</p>

          {brandReady && !isEditingBrandDna ? (
            <div className="vbs-output">
              <p className="vbs-meta">Brand DNA is finalized and active.</p>
              <p>{brandProfile?.summary}</p>
              <div className="vbs-actions">
                <button type="button" onClick={() => setIsEditingBrandDna(true)}>Edit Brand DNA</button>
              </div>
            </div>
          ) : (
            <>
              <div className="vbs-actions">
                {[1, 2, 3, 4].map((step) => (
                  <button key={step} type="button" onClick={() => setOnboardingStep(step as 1 | 2 | 3 | 4)}>
                    Step {step}
                  </button>
                ))}
              </div>

              <div className="vbs-form-grid">
                {onboardingStep === 1 ? (
                  <>
                    <label>Mission<input value={brandForm.mission} onChange={(e) => setBrandForm((p) => ({ ...p, mission: e.target.value }))} /></label>
                    <label>Value Proposition<input value={brandForm.valueProposition} onChange={(e) => setBrandForm((p) => ({ ...p, valueProposition: e.target.value }))} /></label>
                    <label>Product / Service<input value={brandForm.productOrService} onChange={(e) => setBrandForm((p) => ({ ...p, productOrService: e.target.value }))} /></label>
                    <label>Region<input value={brandForm.region} onChange={(e) => setBrandForm((p) => ({ ...p, region: e.target.value }))} /></label>
                  </>
                ) : null}

                {onboardingStep === 2 ? (
                  <>
                    <label>Audience Personas<input value={brandForm.audiencePersonas} onChange={(e) => setBrandForm((p) => ({ ...p, audiencePersonas: e.target.value }))} /></label>
                    <label>Pains<input value={brandForm.pains} onChange={(e) => setBrandForm((p) => ({ ...p, pains: e.target.value }))} /></label>
                    <label>Desires<input value={brandForm.desires} onChange={(e) => setBrandForm((p) => ({ ...p, desires: e.target.value }))} /></label>
                    <label>Objections<input value={brandForm.objections} onChange={(e) => setBrandForm((p) => ({ ...p, objections: e.target.value }))} /></label>
                  </>
                ) : null}

                {onboardingStep === 3 ? (
                  <>
                    <label>Banned Phrases<input value={brandForm.bannedPhrases} onChange={(e) => setBrandForm((p) => ({ ...p, bannedPhrases: e.target.value }))} /></label>
                    <label>Required Claims<input value={brandForm.requiredClaims} onChange={(e) => setBrandForm((p) => ({ ...p, requiredClaims: e.target.value }))} /></label>
                  </>
                ) : null}

                {onboardingStep === 4 ? (
                  <>
                    <label>Exemplar Inputs<input value={brandForm.exemplars} onChange={(e) => setBrandForm((p) => ({ ...p, exemplars: e.target.value }))} /></label>
                    <label>Brand DNA Summary<input value={brandForm.summary} onChange={(e) => setBrandForm((p) => ({ ...p, summary: e.target.value }))} /></label>
                  </>
                ) : null}
              </div>

              <div className="vbs-slider-grid">
                <label>Bold {brandForm.voiceBold}<input type="range" min={0} max={100} value={brandForm.voiceBold} onChange={(e) => setBrandForm((p) => ({ ...p, voiceBold: Number(e.target.value) }))} /></label>
                <label>Formal {brandForm.voiceFormal}<input type="range" min={0} max={100} value={brandForm.voiceFormal} onChange={(e) => setBrandForm((p) => ({ ...p, voiceFormal: Number(e.target.value) }))} /></label>
                <label>Playful {brandForm.voicePlayful}<input type="range" min={0} max={100} value={brandForm.voicePlayful} onChange={(e) => setBrandForm((p) => ({ ...p, voicePlayful: Number(e.target.value) }))} /></label>
                <label>Direct {brandForm.voiceDirect}<input type="range" min={0} max={100} value={brandForm.voiceDirect} onChange={(e) => setBrandForm((p) => ({ ...p, voiceDirect: Number(e.target.value) }))} /></label>
              </div>

              <div className="vbs-output">
                <p className="vbs-meta">Live tone preview</p>
                <p>{tonePreview(brandForm)}</p>
              </div>

              <div className="vbs-actions">
                <button type="button" disabled={onboardingStep === 1 || isBusy} onClick={() => setOnboardingStep((Math.max(1, onboardingStep - 1) as 1 | 2 | 3 | 4))}>Back</button>
                <button type="button" disabled={onboardingStep === 4 || !isStepValid(onboardingStep, brandForm) || isBusy} onClick={() => setOnboardingStep((Math.min(4, onboardingStep + 1) as 1 | 2 | 3 | 4))}>Next</button>
                <button type="button" disabled={isBusy} onClick={() => void saveBrandDna("draft")}>Save Draft</button>
                <button type="button" disabled={onboardingStep !== 4 || isBusy} onClick={() => void generateSummary()}>Generate AI Summary</button>
                <button type="button" disabled={!isStepValid(4, brandForm) || isBusy} onClick={() => void saveBrandDna("final")}>Finalize DNA</button>
                {brandProfile ? (
                  <button type="button" disabled={isBusy} onClick={() => setBrandForm(toFormState(brandProfile))}>Reset Draft</button>
                ) : null}
              </div>
            </>
          )}

          <p className="vbs-meta">
            Status: <strong>{brandProfile?.status || "draft"}</strong> • Ready: <strong>{brandProfile?.completeness.ready ? "yes" : "no"}</strong> • Updated: {formatTimestamp(brandProfile?.updatedAt)}
          </p>
        </article>

        <article className="vbs-panel">
          <h2 className="vbs-panel-title">System Contract</h2>
          <p className="vbs-panel-subtitle">State and telemetry taxonomy from Plan 1 foundation.</p>
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
        </article>
      </div>

      {!onboardingLocked ? (
        <>
          <div className="vbs-grid">
            <article className="vbs-panel">
              <h2 className="vbs-panel-title">Competitor Extraction</h2>
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
                {filteredReferences.map((reference) => (
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
                      <span className="vbs-rank-badge">#{reference.ranking.rank}</span>
                      <p>{reference.ranking.rationaleTitle}</p>
                      <p className="vbs-meta">
                        {toPlatformLabel(reference.sourcePlatform)} • score {reference.scores.composite.toFixed(3)} •{" "}
                        {shortlistLabel(reference.shortlistState)}
                      </p>
                      <p className="vbs-meta">
                        {formatCompactNumber(reference.metrics.views)} views • {formatTimestamp(reference.metrics.postedAt)}
                      </p>
                      <p className="vbs-meta">
                        {reference.explainability.topDrivers[0] || reference.ranking.rationaleBullets[0]}
                      </p>
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
                ))}
              </div>
              {filteredReferences.length === 0 ? <p className="vbs-meta">No references match current filters.</p> : null}
              {selectedReference && selectedReferenceInsights ? (
                <div className="vbs-analysis-drawer">
                  <p className="vbs-meta">
                    Analysis Drawer • #{selectedReference.ranking.rank} • {toPlatformLabel(selectedReference.sourcePlatform)} •{" "}
                    {shortlistLabel(selectedReference.shortlistState)}
                  </p>
                  <h3>{selectedReference.ranking.rationaleTitle}</h3>
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
                  <div className="vbs-top-driver-row">
                    {selectedReference.explainability.topDrivers.map((driver) => (
                      <span key={driver} className="vbs-driver-chip">
                        {driver}
                      </span>
                    ))}
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
                </div>
              ) : null}
            </article>
          </div>

          <div className="vbs-grid">
            <article className="vbs-panel vbs-prompt-studio">
              <h2 className="vbs-panel-title">Prompt Studio</h2>
              <p className="vbs-panel-subtitle">
                Two-pane pack builder using Brand DNA + shortlisted references with section-level refine and regenerate controls.
              </p>
              <div className="vbs-prompt-two-pane">
                <div className="vbs-prompt-controls">
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
                      return (
                        <article
                          key={sectionMeta.id}
                          className={`vbs-pack-card ${activePromptSection === sectionMeta.id ? "is-active" : ""}`}
                          onClick={() => setActivePromptSection(sectionMeta.id)}
                        >
                          <header className="vbs-pack-card-head">
                            <h3>{sectionMeta.title}</h3>
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
                    <div className="vbs-output">
                      <p className="vbs-meta">Run Generate Multi-Pack to populate section cards.</p>
                    </div>
                  )}
                </div>
              </div>
            </article>

            <article className="vbs-panel vbs-document-workspace">
              <h2 className="vbs-panel-title">Document Workspace</h2>
              <p className="vbs-panel-subtitle">
                Editable campaign artifact with autosave every 10s, version timeline, compare view, and promote/rollback workflow.
              </p>
              <div className="vbs-actions">
                <button type="button" disabled={isBusy || !generation} onClick={() => void createDocumentFromGeneration()}>
                  Create Document
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
                  <option value="balanced">Balanced (Recommended)</option>
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
