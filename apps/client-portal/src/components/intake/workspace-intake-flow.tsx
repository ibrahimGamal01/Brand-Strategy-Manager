"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  RuntimeApiError,
  saveWorkspaceIntakeDraft,
  submitWorkspaceIntake,
  suggestWorkspaceIntakeCompletion,
  WorkspaceIntakeFormData,
} from "@/lib/runtime-api";
import {
  extractHandleFromUrlOrRaw,
  SuggestedHandleValidationItem,
} from "./social-handles-fields";
import { IntakeWizardV2 } from "./v2/intake-wizard-v2";
import {
  applySuggestedHandles,
  applySuggestedToState,
  classifyStateWebsiteInputs,
  fromPrefillToV2,
  SuggestedHandleCandidate,
  toSubmitPayloadV2,
  toSuggestPayloadV2,
} from "./v2/intake-mappers";
import {
  IntakeFieldMetaMap,
  IntakeStateV2,
  IntakeTrackableField,
  IntakeWizardStepId,
} from "./v2/intake-types";

type WorkspaceIntakeFlowProps = {
  workspaceId: string;
  initialPrefill?: WorkspaceIntakeFormData;
  onCompleted: () => Promise<void>;
};

type SuggestedHandleValidationState = {
  instagram?: SuggestedHandleValidationItem;
  tiktok?: SuggestedHandleValidationItem;
  youtube?: SuggestedHandleValidationItem;
  linkedin?: SuggestedHandleValidationItem;
  twitter?: SuggestedHandleValidationItem;
};

type IntakePhase = "wizard" | "starting";

const SUGGEST_RETRY_ATTEMPTS = 2;
const CONFIRMATION_REASON_NOTICE: Record<string, string> = {
  MISSING_PRIMARY_CHANNEL: "No trusted primary channel found yet. Add a website or verified handle to improve suggestions.",
  LOW_CONFIDENCE_SUGGESTION: "Suggestions were found but confidence is low, so BAT did not auto-apply risky channels.",
  AI_UNAVAILABLE: "Autofill service is temporarily unavailable. You can continue manually.",
  AI_NOT_CONFIGURED: "Autofill service is temporarily unavailable. You can continue manually.",
};

function hasWebsiteInput(state: IntakeStateV2): boolean {
  const classified = classifyStateWebsiteInputs(state);
  return classified.crawlWebsites.length > 0;
}

function toUniqueWebsiteList(state: IntakeStateV2): string[] {
  return classifyStateWebsiteInputs(state).crawlWebsites.slice(0, 5);
}

function toSocialReferenceList(state: IntakeStateV2): string[] {
  return classifyStateWebsiteInputs(state).socialReferences.slice(0, 12);
}

function toHandleRows(state: IntakeStateV2): Array<{ platform: string; handle: string }> {
  const rows: Array<{ platform: string; handle: string }> = [];
  const platforms = ["instagram", "tiktok", "youtube", "linkedin", "twitter"] as const;
  for (const platform of platforms) {
    const bucket = state.handlesV2?.[platform];
    if (bucket?.handles?.length) {
      const ordered = bucket.primary
        ? [bucket.primary, ...bucket.handles.filter((entry) => entry !== bucket.primary)]
        : bucket.handles;
      ordered.slice(0, 5).forEach((handle) => {
        if (!String(handle || "").trim()) return;
        rows.push({ platform: platform === "twitter" ? "x" : platform, handle: String(handle || "").trim() });
      });
      continue;
    }
    const handle = extractHandleFromUrlOrRaw(platform, state.handles[platform] || "");
    if (handle) {
      rows.push({ platform: platform === "twitter" ? "x" : platform, handle });
    }
  }
  return rows;
}

function candidateKey(candidate: Pick<SuggestedHandleCandidate, "platform" | "handle">): string {
  return `${candidate.platform}:${String(candidate.handle || "").trim().toLowerCase()}`;
}

function isTransientSuggestError(message: string): boolean {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("request failed (502)") ||
    text.includes("request failed (503)") ||
    text.includes("request failed (504)") ||
    text.includes("bad gateway") ||
    text.includes("gateway timeout") ||
    text.includes("failed to fetch")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferPlatformFromReference(rawValue: string): SuggestedHandleCandidate["platform"] | null {
  const lower = String(rawValue || "").toLowerCase();
  if (lower.includes("instagram.com/")) return "instagram";
  if (lower.includes("tiktok.com/")) return "tiktok";
  if (lower.includes("youtube.com/") || lower.includes("youtu.be/")) return "youtube";
  if (lower.includes("linkedin.com/")) return "linkedin";
  if (lower.includes("x.com/") || lower.includes("twitter.com/")) return "twitter";
  return null;
}

function deriveFallbackHandleCandidates(
  socialReferences: string[],
  handles: IntakeStateV2["handles"]
): SuggestedHandleCandidate[] {
  const seen = new Set<string>();
  const results: SuggestedHandleCandidate[] = [];

  for (const reference of socialReferences) {
    const platform = inferPlatformFromReference(reference);
    if (!platform) continue;

    const existing = extractHandleFromUrlOrRaw(platform, handles[platform] || "");
    if (existing) continue;

    const handle = extractHandleFromUrlOrRaw(platform, reference);
    if (!handle) continue;

    const key = `${platform}:${handle.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      platform,
      handle,
      profileUrl: reference,
      confidence: 0.99,
      reason: "Detected from your provided social profile URL.",
      source: "client_side_social_reference",
      isLikelyClient: true,
    });
  }

  return results;
}

const TRACKED_FIELD_KEYS: IntakeTrackableField[] = [
  "name",
  "website",
  "websites",
  "socialReferences",
  "oneSentenceDescription",
  "niche",
  "businessType",
  "operateWhere",
  "wantClientsWhere",
  "idealAudience",
  "targetAudience",
  "geoScope",
  "servicesList",
  "mainOffer",
  "primaryGoal",
  "secondaryGoals",
  "futureGoal",
  "engineGoal",
  "topProblems",
  "resultsIn90Days",
  "questionsBeforeBuying",
  "brandVoiceWords",
  "brandTone",
  "topicsToAvoid",
  "constraints",
  "excludedCategories",
  "language",
  "planningHorizon",
  "autonomyLevel",
  "budgetSensitivity",
  "competitorInspirationLinks",
  "primaryChannel",
  "handles.instagram",
  "handles.tiktok",
  "handles.youtube",
  "handles.linkedin",
  "handles.twitter",
];

function isFieldValueFilled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => isFieldValueFilled(item));
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function readTrackableFieldValue(state: IntakeStateV2, field: IntakeTrackableField): unknown {
  if (field.startsWith("handles.")) {
    const platform = field.slice("handles.".length) as keyof IntakeStateV2["handles"];
    return state.handles[platform];
  }
  return state[field as keyof IntakeStateV2];
}

function buildInitialFieldMetaFromState(state: IntakeStateV2): IntakeFieldMetaMap {
  const createdAt = new Date().toISOString();
  const fieldMeta: IntakeFieldMetaMap = {};
  for (const field of TRACKED_FIELD_KEYS) {
    if (!isFieldValueFilled(readTrackableFieldValue(state, field))) continue;
    fieldMeta[field] = {
      source: "prefill",
      lastUpdatedAt: createdAt,
    };
  }
  return fieldMeta;
}

function mergeFieldMeta(
  previous: IntakeFieldMetaMap,
  updates: Partial<Record<IntakeTrackableField, "user" | "ai" | "prefill">>
): IntakeFieldMetaMap {
  const now = new Date().toISOString();
  const next: IntakeFieldMetaMap = { ...previous };
  for (const [field, source] of Object.entries(updates)) {
    if (!source) continue;
    next[field as IntakeTrackableField] = {
      source,
      lastUpdatedAt: now,
    };
  }
  return next;
}

function normalizeCoverageFields(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => String(field || "").trim()).filter(Boolean);
}

function buildBackgroundSuggestFingerprint(state: IntakeStateV2): string {
  const classified = classifyStateWebsiteInputs(state);
  const handles = toHandleRows(state)
    .map((row) => `${row.platform}:${String(row.handle || "").trim().toLowerCase()}`)
    .filter(Boolean)
    .sort();
  return JSON.stringify({
    name: String(state.name || "").trim().toLowerCase(),
    websites: classified.crawlWebsites.map((entry) => String(entry || "").trim().toLowerCase()).sort(),
    socialReferences: classified.socialReferences.map((entry) => String(entry || "").trim().toLowerCase()).sort(),
    handles,
  });
}

export function WorkspaceIntakeFlow({ workspaceId, initialPrefill, onCompleted }: WorkspaceIntakeFlowProps) {
  const [phase, setPhase] = useState<IntakePhase>("wizard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [state, setState] = useState<IntakeStateV2>(fromPrefillToV2(initialPrefill));
  const [fieldMeta, setFieldMeta] = useState<IntakeFieldMetaMap>(() =>
    buildInitialFieldMetaFromState(fromPrefillToV2(initialPrefill))
  );
  const [suggestedFields, setSuggestedFields] = useState<Set<string>>(new Set());
  const [suggestedHandlePlatforms, setSuggestedHandlePlatforms] = useState<Set<string>>(new Set());
  const [suggestedHandleValidation, setSuggestedHandleValidation] = useState<SuggestedHandleValidationState>();
  const [suggestedHandleCandidates, setSuggestedHandleCandidates] = useState<SuggestedHandleCandidate[]>([]);
  const [lastCoverage, setLastCoverage] = useState<{
    inferableFields: string[];
    suggestedFields: string[];
    blockedLowSignalFields: string[];
  }>({
    inferableFields: [],
    suggestedFields: [],
    blockedLowSignalFields: [],
  });
  const [rejectedHandleCandidates, setRejectedHandleCandidates] = useState<Set<string>>(new Set());
  const [ignoredHandleCandidates, setIgnoredHandleCandidates] = useState<Set<string>>(new Set());
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [confirmationReasons, setConfirmationReasons] = useState<string[]>([]);
  const [channelsConfirmed, setChannelsConfirmed] = useState(false);
  const [hasPreScanEvidence, setHasPreScanEvidence] = useState(false);

  const backgroundSyncTimerRef = useRef<number | null>(null);
  const latestStateRef = useRef(state);
  const latestFieldMetaRef = useRef(fieldMeta);
  const backgroundSuggestInFlightRef = useRef(false);
  const backgroundSuggestFingerprintRef = useRef<string>("");

  useEffect(() => {
    const next = fromPrefillToV2(initialPrefill);
    setState(next);
    setFieldMeta(buildInitialFieldMetaFromState(next));
    setSuggestedHandleCandidates([]);
    setRejectedHandleCandidates(new Set());
    setIgnoredHandleCandidates(new Set());
    setLastCoverage({
      inferableFields: [],
      suggestedFields: [],
      blockedLowSignalFields: [],
    });
    setHasPreScanEvidence(Boolean(next.website || next.websites.length || next.socialReferences.length));
  }, [initialPrefill]);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    latestFieldMetaRef.current = fieldMeta;
  }, [fieldMeta]);

  useEffect(() => {
    setSuggestedHandleCandidates((previous) =>
      previous.filter((candidate) => {
        const bucket = state.handlesV2?.[candidate.platform];
        const currentList = Array.isArray(bucket?.handles) ? bucket.handles : [];
        const normalized = String(candidate.handle || "").trim().toLowerCase();
        if (currentList.some((entry) => String(entry || "").trim().toLowerCase() === normalized)) {
          return false;
        }
        const currentPrimary = extractHandleFromUrlOrRaw(candidate.platform, state.handles[candidate.platform] || "");
        if (!currentPrimary) return true;
        return currentPrimary !== normalized;
      })
    );
  }, [state.handles, state.handlesV2]);

  useEffect(() => {
    if (phase !== "starting") return;

    const timer = setTimeout(() => {
      void onCompleted().catch((completionError: unknown) => {
        setError(String((completionError as Error)?.message || "Failed to open chat workspace"));
        setPhase("wizard");
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, [onCompleted, phase]);

  useEffect(() => {
    if (phase !== "wizard") return;
    if (backgroundSyncTimerRef.current) {
      window.clearTimeout(backgroundSyncTimerRef.current);
    }
    const sourceFingerprint = buildBackgroundSuggestFingerprint(state);
    backgroundSyncTimerRef.current = window.setTimeout(() => {
      const payload = toSuggestPayloadV2(state);
      void saveWorkspaceIntakeDraft(workspaceId, {
        ...payload,
        triggerEnrichment: true,
      })
        .then(() => {
          setHasPreScanEvidence(true);
          if (backgroundSuggestInFlightRef.current) return;
          if (backgroundSuggestFingerprintRef.current === sourceFingerprint) return;
          backgroundSuggestInFlightRef.current = true;
          void suggestWorkspaceIntakeCompletion(workspaceId, {
            ...payload,
            step: "brand",
            scope: "global",
            overwritePolicy: "missing_or_low_signal",
            socialReferences: toSocialReferenceList(state),
            fieldMeta: latestFieldMetaRef.current,
          })
            .then((suggestion) => {
              if (!suggestion?.success) return;
              if (buildBackgroundSuggestFingerprint(latestStateRef.current) !== sourceFingerprint) return;

              let next = latestStateRef.current;
              let nextMeta = latestFieldMetaRef.current;
              let updatedFields = 0;
              let updatedHandles = 0;

              if (suggestion.suggested) {
                const suggestedResult = applySuggestedToState(next, suggestion.suggested, "brand", {
                  scope: "global",
                  overwritePolicy: "missing_or_low_signal",
                  fieldMeta: nextMeta,
                });
                next = suggestedResult.next;
                nextMeta = suggestedResult.nextFieldMeta;
                updatedFields = suggestedResult.suggestedKeys.size;
                setSuggestedFields((previous) =>
                  new Set([...Array.from(previous), ...Array.from(suggestedResult.suggestedKeys)])
                );
              }

              if (suggestion.suggestedHandles) {
                const handleResult = applySuggestedHandles(next, suggestion.suggestedHandles);
                next = handleResult.next;
                updatedHandles = handleResult.suggestedPlatforms.size;
                setSuggestedHandlePlatforms((previous) =>
                  new Set([...Array.from(previous), ...Array.from(handleResult.suggestedPlatforms)])
                );
              }

              if (updatedFields > 0 || updatedHandles > 0) {
                setState(next);
                setFieldMeta(nextMeta);
              }
              setSuggestedHandleValidation(
                suggestion?.suggestedHandleValidation && typeof suggestion.suggestedHandleValidation === "object"
                  ? suggestion.suggestedHandleValidation
                  : undefined
              );
              setLastCoverage({
                inferableFields: normalizeCoverageFields(suggestion?.coverage?.inferableFields),
                suggestedFields: normalizeCoverageFields(suggestion?.coverage?.suggestedFields),
                blockedLowSignalFields: normalizeCoverageFields(suggestion?.coverage?.blockedLowSignalFields),
              });
              const warningCodes = Array.isArray(suggestion?.warnings) ? suggestion.warnings : [];
              const reasonCodes = Array.isArray(suggestion?.confirmationReasons) ? suggestion.confirmationReasons : [];
              const bypassMissingPrimary =
                hasWebsiteInput(next) &&
                reasonCodes.length > 0 &&
                reasonCodes.every((code) => code === "MISSING_PRIMARY_CHANNEL");
              const needsConfirmation = suggestion?.confirmationRequired === true && !bypassMissingPrimary;
              setConfirmationRequired(needsConfirmation);
              setConfirmationReasons(reasonCodes);
              setChannelsConfirmed(!needsConfirmation);
              if (warningCodes.includes("LOW_SIGNAL_COPY")) {
                setNotice("BAT refreshed background suggestions and skipped low-signal copy.");
              } else if (updatedFields > 0 || updatedHandles > 0) {
                setNotice("BAT refreshed suggestions in the background.");
              }
              backgroundSuggestFingerprintRef.current = sourceFingerprint;
            })
            .catch((backgroundSuggestError: unknown) => {
              const message = String((backgroundSuggestError as Error)?.message || "");
              if (message) {
                console.warn("[Intake] Background suggest warning:", message);
              }
            })
            .finally(() => {
              backgroundSuggestInFlightRef.current = false;
            });
        })
        .catch((backgroundError: unknown) => {
          const message = String((backgroundError as Error)?.message || "");
          if (message) {
            console.warn("[Intake] Background enrichment sync warning:", message);
          }
        });
    }, 3200);

    return () => {
      if (backgroundSyncTimerRef.current) {
        window.clearTimeout(backgroundSyncTimerRef.current);
        backgroundSyncTimerRef.current = null;
      }
    };
  }, [workspaceId, state, phase]);

  const filledHandles = useMemo(() => toHandleRows(state), [state]);
  const hasWebsite = useMemo(() => hasWebsiteInput(state), [state]);

  const captureStats = useMemo(() => {
    const sections = [
      Boolean(state.name.trim().length > 0),
      Boolean(hasWebsite),
      Boolean(state.mainOffer.trim().length > 0 || state.primaryGoal.trim().length > 0),
      Boolean(state.idealAudience.trim().length > 0 || state.topProblems.length > 0),
      Boolean(state.brandVoiceWords.length > 0 || state.topicsToAvoid.length > 0),
      Boolean(state.competitorLinks.length > 0),
    ];
    const completed = sections.filter(Boolean).length;
    return {
      completed,
      total: sections.length,
      percent: Math.round((completed / sections.length) * 100),
    };
  }, [hasWebsite, state]);

  function handleWizardStateChange(next: IntakeStateV2) {
    const updates: Partial<Record<IntakeTrackableField, "user" | "ai" | "prefill">> = {};
    for (const field of TRACKED_FIELD_KEYS) {
      const before = JSON.stringify(readTrackableFieldValue(state, field));
      const after = JSON.stringify(readTrackableFieldValue(next, field));
      if (before !== after) {
        updates[field] = "user";
      }
    }
    setState(next);
    if (Object.keys(updates).length > 0) {
      setFieldMeta((previous) => mergeFieldMeta(previous, updates));
    }
  }

  async function handleAutoFillStep(step: IntakeWizardStepId) {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const suggestionPayload = toSuggestPayloadV2(state);
      let suggestion: Awaited<ReturnType<typeof suggestWorkspaceIntakeCompletion>> | null = null;
      let lastSuggestError: unknown = null;
      for (let attempt = 0; attempt < SUGGEST_RETRY_ATTEMPTS; attempt += 1) {
        try {
          suggestion = await suggestWorkspaceIntakeCompletion(workspaceId, {
            ...suggestionPayload,
            step,
            scope: "global",
            overwritePolicy: "missing_or_low_signal",
            socialReferences: toSocialReferenceList(state),
            fieldMeta,
          });
          lastSuggestError = null;
          break;
        } catch (retryError: unknown) {
          lastSuggestError = retryError;
          const retryable = isTransientSuggestError(String((retryError as Error)?.message || ""));
          const isLastAttempt = attempt >= SUGGEST_RETRY_ATTEMPTS - 1;
          if (!retryable || isLastAttempt) break;
          await delay(500 * (attempt + 1));
        }
      }
      if (!suggestion && lastSuggestError) {
        throw lastSuggestError;
      }
      if (!suggestion) {
        throw new Error("Suggestion failed");
      }
      let next = state;
      let updatedFieldCount = 0;
      let updatedHandleCount = 0;

      if (suggestion?.success && suggestion.suggested) {
        const suggestedResult = applySuggestedToState(next, suggestion.suggested, step, {
          scope: "global",
          overwritePolicy: "missing_or_low_signal",
          fieldMeta,
        });
        next = suggestedResult.next;
        updatedFieldCount = suggestedResult.suggestedKeys.size;
        setFieldMeta(suggestedResult.nextFieldMeta);
        setSuggestedFields((previous) => new Set([...Array.from(previous), ...Array.from(suggestedResult.suggestedKeys)]));
      }

      if (suggestion?.success && suggestion.suggestedHandles) {
        const handleResult = applySuggestedHandles(next, suggestion.suggestedHandles);
        next = handleResult.next;
        updatedHandleCount = handleResult.suggestedPlatforms.size;
        setSuggestedHandlePlatforms((previous) =>
          new Set([...Array.from(previous), ...Array.from(handleResult.suggestedPlatforms)])
        );
      }

      const reasonCodes = Array.isArray(suggestion?.confirmationReasons) ? suggestion.confirmationReasons : [];
      const warningCodes = Array.isArray(suggestion?.warnings) ? suggestion.warnings : [];
      const bypassMissingPrimary =
        hasWebsiteInput(next) && reasonCodes.length > 0 && reasonCodes.every((code) => code === "MISSING_PRIMARY_CHANNEL");
      const needsConfirmation = suggestion?.confirmationRequired === true && !bypassMissingPrimary;

      if (step === "channels") {
        const hiddenCandidateKeys = new Set<string>([
          ...Array.from(rejectedHandleCandidates),
          ...Array.from(ignoredHandleCandidates),
        ]);
        const nextCandidates = Array.isArray(suggestion?.suggestedHandleCandidates)
          ? suggestion.suggestedHandleCandidates.filter((candidate) => {
              const key = candidateKey(candidate);
              if (hiddenCandidateKeys.has(key)) return false;
              const existing = extractHandleFromUrlOrRaw(candidate.platform, next.handles[candidate.platform] || "");
              if (!existing) return true;
              return existing !== String(candidate.handle || "").trim().toLowerCase();
            })
          : [];
        const fallbackCandidates = deriveFallbackHandleCandidates(next.socialReferences, next.handles).filter(
          (candidate) => {
            const key = candidateKey(candidate);
            if (hiddenCandidateKeys.has(key)) return false;
            return !nextCandidates.some((item) => candidateKey(item) === key);
          }
        );
        setSuggestedHandleCandidates([...nextCandidates, ...fallbackCandidates]);
      }

      setState(next);
      setSuggestedHandleValidation(
        suggestion?.suggestedHandleValidation && typeof suggestion.suggestedHandleValidation === "object"
          ? suggestion.suggestedHandleValidation
          : undefined
      );
      setLastCoverage({
        inferableFields: normalizeCoverageFields(suggestion?.coverage?.inferableFields),
        suggestedFields: normalizeCoverageFields(suggestion?.coverage?.suggestedFields),
        blockedLowSignalFields: normalizeCoverageFields(suggestion?.coverage?.blockedLowSignalFields),
      });
      setConfirmationRequired(needsConfirmation);
      setConfirmationReasons(reasonCodes);
      setChannelsConfirmed(!needsConfirmation);

      if (updatedFieldCount > 0 || updatedHandleCount > 0) {
        setNotice("Global smart autofill applied.");
      } else if (
        reasonCodes.includes("AI_UNAVAILABLE") ||
        reasonCodes.includes("AI_NOT_CONFIGURED") ||
        warningCodes.includes("AI_UNAVAILABLE") ||
        warningCodes.includes("AI_NOT_CONFIGURED")
      ) {
        setNotice("Autofill service is temporarily unavailable. You can continue manually.");
      } else if (warningCodes.includes("LOW_SIGNAL_COPY")) {
        setNotice("BAT skipped low-signal copy and kept your existing text for this step.");
      } else if (warningCodes.includes("NO_HIGH_CONFIDENCE_CHANNELS")) {
        setNotice("BAT found channel candidates but none were high-confidence enough to auto-apply.");
      } else if (reasonCodes.length > 0) {
        const detail = reasonCodes.map((code) => CONFIRMATION_REASON_NOTICE[code] || code).join(" ");
        setNotice(detail);
      } else {
        setNotice("No strong suggestions found for this step yet.");
      }
    } catch (suggestError: unknown) {
      const typedError = suggestError as RuntimeApiError;
      const rawMessage = String(typedError?.message || "Suggestion failed");
      if (/failed to fetch/i.test(rawMessage)) {
        setError("Autofill could not reach the backend suggestion service. Please retry in a few seconds.");
      } else {
        setError(rawMessage);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDraft() {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const payload = toSuggestPayloadV2(state);
      const result = await saveWorkspaceIntakeDraft(workspaceId, {
        ...payload,
        triggerEnrichment: true,
      });
      if (!result?.ok) {
        throw new Error("Failed to save draft");
      }
      setNotice("Draft saved.");
    } catch (draftError: unknown) {
      setError(String((draftError as Error)?.message || "Failed to save draft"));
    } finally {
      setLoading(false);
    }
  }

  async function handleStartWorkflow() {
    setLoading(true);
    setError("");
    setNotice("");

    if (filledHandles.length === 0 && !hasWebsite) {
      setError("Add at least one social handle or website before starting BAT.");
      setLoading(false);
      return;
    }

    if (!state.mainOffer.trim() && !state.primaryGoal.trim()) {
      setNotice("No primary goal or offer was set yet. BAT will infer this in chat and you can refine it later.");
    }

    if (confirmationRequired && filledHandles.length > 0 && !channelsConfirmed) {
      setError("Please confirm the suggested channels before starting.");
      setLoading(false);
      return;
    }

    try {
      const payload = toSubmitPayloadV2(state);
      const result = await submitWorkspaceIntake(workspaceId, payload as Record<string, unknown>);
      if (!result?.success) {
        throw new Error("Failed to start smart workflow");
      }
      setPhase("starting");
    } catch (submitError: unknown) {
      setError(String((submitError as Error)?.message || "Failed to submit intake"));
    } finally {
      setLoading(false);
    }
  }

  function handleAcceptHandleCandidate(candidate: SuggestedHandleCandidate) {
    const key = candidateKey(candidate);
    const handleMetaKey = `handles.${candidate.platform}` as IntakeTrackableField;
    setState((previous) => {
      const nextHandles = { ...previous.handles };
      const normalizedHandle = String(candidate.handle || "").trim();
      nextHandles[candidate.platform] = normalizedHandle;
      const nextHandlesV2 = {
        ...previous.handlesV2,
        [candidate.platform]: {
          primary: normalizedHandle,
          handles: Array.from(
            new Set([
              normalizedHandle,
              ...((previous.handlesV2?.[candidate.platform]?.handles || []).map((entry) =>
                String(entry || "").trim()
              )),
            ])
          ).slice(0, 5),
        },
      };
      return {
        ...previous,
        handles: nextHandles,
        handlesV2: nextHandlesV2,
        primaryChannel: previous.primaryChannel || candidate.platform,
      };
    });
    setFieldMeta((previous) =>
      mergeFieldMeta(previous, {
        [handleMetaKey]: "user",
        primaryChannel: "user",
      })
    );
    setSuggestedHandlePlatforms((previous) => new Set([...Array.from(previous), candidate.platform]));
    setSuggestedHandleCandidates((previous) =>
      previous.filter((item) => candidateKey(item) !== key)
    );
    setRejectedHandleCandidates((previous) => {
      const next = new Set(Array.from(previous));
      next.delete(key);
      return next;
    });
    setIgnoredHandleCandidates((previous) => {
      const next = new Set(Array.from(previous));
      next.delete(key);
      return next;
    });
    if (confirmationRequired) {
      setChannelsConfirmed(false);
    }
  }

  function handleRejectHandleCandidate(candidate: SuggestedHandleCandidate) {
    const key = candidateKey(candidate);
    setRejectedHandleCandidates((previous) => new Set([...Array.from(previous), key]));
    setSuggestedHandleCandidates((previous) =>
      previous.filter((item) => candidateKey(item) !== key)
    );
  }

  function handleIgnoreHandleCandidate(candidate: SuggestedHandleCandidate) {
    const key = candidateKey(candidate);
    setIgnoredHandleCandidates((previous) => new Set([...Array.from(previous), key]));
    setSuggestedHandleCandidates((previous) =>
      previous.filter((item) => candidateKey(item) !== key)
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="bat-surface p-6">
          {phase === "wizard" ? (
            <div className="space-y-4">
              {notice ? (
                <div
                  className="rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: "#b9e6de", background: "#f0fffb", color: "#0f766e" }}
                >
                  {notice}
                </div>
              ) : null}
              {hasPreScanEvidence ? (
                <div
                  className="rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)", color: "var(--bat-text)" }}
                >
                  Pre-scan evidence is available from signup enrichment. Autofill can now use website and DDG context.
                </div>
              ) : null}

              <IntakeWizardV2
                state={state}
                onChange={handleWizardStateChange}
                onAutoFillStep={handleAutoFillStep}
                onSaveDraft={handleSaveDraft}
                onSubmit={handleStartWorkflow}
                loading={loading}
                error={error}
                suggestedFields={suggestedFields}
                suggestedHandlePlatforms={suggestedHandlePlatforms}
                suggestedHandleValidation={suggestedHandleValidation}
                suggestedHandleCandidates={suggestedHandleCandidates}
                onAcceptHandleCandidate={handleAcceptHandleCandidate}
                onRejectHandleCandidate={handleRejectHandleCandidate}
                onIgnoreHandleCandidate={handleIgnoreHandleCandidate}
                confirmationRequired={confirmationRequired}
                confirmationReasons={confirmationReasons}
                channelsConfirmed={channelsConfirmed}
                onChannelsConfirmedChange={setChannelsConfirmed}
              />
            </div>
          ) : null}

          {phase === "starting" ? (
            <div className="space-y-3">
              <div
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl"
                style={{ background: "var(--bat-accent-soft)", color: "var(--bat-accent)" }}
              >
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold">Starting smart workflow</h2>
              <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
                Discovery is running for{" "}
                {filledHandles.map((item) => `@${item.handle}`).join(", ") ||
                  toUniqueWebsiteList(state).join(", ") ||
                  "your channels and website"}.
                Opening your chat workspace...
              </p>
            </div>
          ) : null}
        </div>

        {phase === "wizard" ? (
          <aside className="space-y-4">
            <section className="bat-surface space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--bat-text-muted)" }}>
                    Captured Knowledge
                  </p>
                  <h3 className="text-sm font-semibold">BAT setup progress</h3>
                </div>
                <span className="bat-chip">{captureStats.percent}% ready</span>
              </div>

              <div className="space-y-2 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                <p>
                  Brand: <span style={{ color: "var(--bat-text)" }}>{state.name || "Not set yet"}</span>
                </p>
                <p>
                  Websites:{" "}
                  <span style={{ color: "var(--bat-text)" }}>
                    {toUniqueWebsiteList(state).length ? toUniqueWebsiteList(state).join(", ") : "Not set yet"}
                  </span>
                </p>
                <p>
                  Offer:{" "}
                  <span style={{ color: "var(--bat-text)" }}>
                    {state.mainOffer || state.primaryGoal || "Not set yet"}
                  </span>
                </p>
                <p>
                  Audience:{" "}
                  <span style={{ color: "var(--bat-text)" }}>
                    {state.idealAudience || "Not set yet"}
                  </span>
                </p>
                <p>
                  Voice:{" "}
                  <span style={{ color: "var(--bat-text)" }}>
                    {state.brandVoiceWords.length ? state.brandVoiceWords.join(", ") : "Not set yet"}
                  </span>
                </p>
                <p>
                  Competitors:{" "}
                  <span style={{ color: "var(--bat-text)" }}>
                    {state.competitorLinks.length} link{state.competitorLinks.length === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
            </section>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
