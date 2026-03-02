"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Globe, Loader2 } from "lucide-react";
import {
  createWorkspaceIntakeEventsSource,
  fetchWorkspaceIntakeScanRun,
  saveWorkspaceIntakeDraft,
  scanWorkspaceIntakeWebsites,
  submitWorkspaceIntake,
  suggestWorkspaceIntakeCompletion,
  WorkspaceIntakeFormData,
  WorkspaceIntakeLiveEvent,
  WorkspaceIntakeScanMode,
} from "@/lib/runtime-api";
import {
  buildChannelsFromHandles,
  extractHandleFromUrlOrRaw,
  getFilledHandlesList,
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
import { IntakeStateV2, IntakeWizardStepId } from "./v2/intake-types";

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
type ScanStatus = "idle" | "running" | "done" | "error";

const MAX_FEED_EVENTS = 80;
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

function formatRelativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSeconds < 5) return "now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function eventTone(type: string): "info" | "warn" | "error" | "success" {
  const key = String(type || "").toUpperCase();
  if (key.includes("FAILED")) return "error";
  if (key.includes("WARNING")) return "warn";
  if (key.includes("DONE") || key.includes("SAVED") || key.includes("COMPLETED")) return "success";
  return "info";
}

function toUniqueWebsiteList(state: IntakeStateV2): string[] {
  return classifyStateWebsiteInputs(state).crawlWebsites.slice(0, 5);
}

function toSocialReferenceList(state: IntakeStateV2): string[] {
  return classifyStateWebsiteInputs(state).socialReferences.slice(0, 12);
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

export function WorkspaceIntakeFlow({ workspaceId, initialPrefill, onCompleted }: WorkspaceIntakeFlowProps) {
  const [phase, setPhase] = useState<IntakePhase>("wizard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [state, setState] = useState<IntakeStateV2>(fromPrefillToV2(initialPrefill));
  const [suggestedFields, setSuggestedFields] = useState<Set<string>>(new Set());
  const [suggestedHandlePlatforms, setSuggestedHandlePlatforms] = useState<Set<string>>(new Set());
  const [suggestedHandleValidation, setSuggestedHandleValidation] = useState<SuggestedHandleValidationState>();
  const [suggestedHandleCandidates, setSuggestedHandleCandidates] = useState<SuggestedHandleCandidate[]>([]);
  const [rejectedHandleCandidates, setRejectedHandleCandidates] = useState<Set<string>>(new Set());
  const [ignoredHandleCandidates, setIgnoredHandleCandidates] = useState<Set<string>>(new Set());
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [confirmationReasons, setConfirmationReasons] = useState<string[]>([]);
  const [channelsConfirmed, setChannelsConfirmed] = useState(false);
  const [scanMode, setScanMode] = useState<WorkspaceIntakeScanMode>("quick");
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [activeScanRunId, setActiveScanRunId] = useState<string | null>(null);
  const [liveFeedUnavailable, setLiveFeedUnavailable] = useState(false);
  const [liveEvents, setLiveEvents] = useState<WorkspaceIntakeLiveEvent[]>([]);

  const lastEventIdRef = useRef(0);

  useEffect(() => {
    setState(fromPrefillToV2(initialPrefill));
    setSuggestedHandleCandidates([]);
    setRejectedHandleCandidates(new Set());
    setIgnoredHandleCandidates(new Set());
  }, [initialPrefill]);

  useEffect(() => {
    setSuggestedHandleCandidates((previous) =>
      previous.filter((candidate) => {
        const current = extractHandleFromUrlOrRaw(candidate.platform, state.handles[candidate.platform] || "");
        if (!current) return true;
        return current !== String(candidate.handle || "").trim().toLowerCase();
      })
    );
  }, [state.handles]);

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

    const source = createWorkspaceIntakeEventsSource(workspaceId, lastEventIdRef.current || undefined, {
      ...(activeScanRunId ? { scanRunId: activeScanRunId } : {}),
    });
    let receivedAnyEvent = false;
    setLiveFeedUnavailable(false);

    const handleEvent = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(String(event.data || "{}")) as WorkspaceIntakeLiveEvent;
        if (!parsed || typeof parsed.id !== "number") return;
        if (activeScanRunId && parsed.scanRunId && parsed.scanRunId !== activeScanRunId) return;
        receivedAnyEvent = true;

        lastEventIdRef.current = Math.max(lastEventIdRef.current, parsed.id);
        setLiveEvents((previous) => {
          if (previous.some((item) => item.id === parsed.id)) return previous;
          const next = [...previous, parsed];
          return next.slice(Math.max(0, next.length - MAX_FEED_EVENTS));
        });

        const type = String(parsed.type || "").toUpperCase();
        if (type === "SCAN_STARTED" || type === "SCAN_TARGET_STARTED") {
          setScanStatus("running");
        } else if (type === "SCAN_DONE") {
          setScanStatus("done");
        } else if (type === "SCAN_FAILED") {
          setScanStatus("error");
        }
      } catch {
        // ignore malformed events
      }
    };

    source.addEventListener("intake_event", handleEvent as EventListener);
    source.onerror = () => {
      if (!receivedAnyEvent) {
        setLiveFeedUnavailable(true);
        source.close();
      }
    };

    return () => {
      source.close();
    };
  }, [workspaceId, phase, activeScanRunId]);

  useEffect(() => {
    if (phase !== "wizard") return;
    if (scanStatus !== "running") return;
    if (!activeScanRunId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const result = await fetchWorkspaceIntakeScanRun(workspaceId, activeScanRunId);
        if (cancelled || !result?.scanRun) return;
        const status = String(result.scanRun.status || "").trim().toUpperCase();
        if (status === "COMPLETED") {
          setScanStatus("done");
        } else if (status === "FAILED" || status === "CANCELLED") {
          setScanStatus("error");
        } else {
          setScanStatus("running");
        }
      } catch {
        // Best-effort polling for resumability.
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 3500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeScanRunId, phase, scanStatus, workspaceId]);

  const filledHandles = useMemo(() => buildChannelsFromHandles(state.handles), [state.handles]);
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

  const feedEvents = useMemo(() => [...liveEvents].reverse().slice(0, 14), [liveEvents]);
  const hasPreScanEvidence = useMemo(
    () =>
      liveEvents.some((event) => {
        const type = String(event.type || "").toUpperCase();
        return type.startsWith("ENRICHMENT_") || type.startsWith("DDG_");
      }),
    [liveEvents]
  );

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
            socialReferences: toSocialReferenceList(state),
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
        const suggestedResult = applySuggestedToState(next, suggestion.suggested, step);
        next = suggestedResult.next;
        updatedFieldCount = suggestedResult.suggestedKeys.size;
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
      setConfirmationRequired(needsConfirmation);
      setConfirmationReasons(reasonCodes);
      setChannelsConfirmed(!needsConfirmation);

      if (updatedFieldCount > 0 || updatedHandleCount > 0) {
        setNotice("Step suggestions applied.");
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
      const rawMessage = String((suggestError as Error)?.message || "Suggestion failed");
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
      const result = await saveWorkspaceIntakeDraft(workspaceId, payload);
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

  async function handleScanWebsites() {
    setError("");
    setNotice("");
    const websites = toUniqueWebsiteList(state);
    if (!websites.length) {
      setError("Add at least one website in Brand basics before starting a scan.");
      return;
    }

    setScanStatus("running");

    try {
      const result = await scanWorkspaceIntakeWebsites(workspaceId, {
        website: websites[0],
        websites,
        mode: scanMode,
        socialReferences: toSocialReferenceList(state),
        includeSocialProfileCrawl: state.includeSocialProfileCrawl,
      });
      if (!result?.ok) {
        throw new Error("Failed to start website scan");
      }
      setActiveScanRunId(result.scanRunId);
      setNotice(`Website scan started (${scanMode}). BAT is enriching your workspace now.`);
    } catch (scanError: unknown) {
      const message = String((scanError as Error)?.message || "Failed to start website scan");
      if (message.includes("404")) {
        setScanStatus("idle");
        setLiveFeedUnavailable(true);
        setNotice(
          "Live website scan is not available on the current backend deployment yet. Sites will still be scanned automatically after intake submission."
        );
        return;
      }
      setScanStatus("error");
      setError(message);
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
      setError("Add a primary goal or a main offer before starting BAT.");
      setLoading(false);
      return;
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
    setState((previous) => {
      const nextHandles = { ...previous.handles };
      nextHandles[candidate.platform] = String(candidate.handle || "").trim();
      return {
        ...previous,
        handles: nextHandles,
        primaryChannel: previous.primaryChannel || candidate.platform,
      };
    });
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
                onChange={setState}
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
                {getFilledHandlesList(state.handles).join(", ") ||
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

            <section className="bat-surface space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--bat-text-muted)" }}>
                    Live Enrichment
                  </p>
                  <h3 className="text-sm font-semibold">Website intelligence feed</h3>
                </div>
                <span
                  className="bat-chip"
                  style={{
                    color:
                      scanStatus === "error"
                        ? "#9f2317"
                        : scanStatus === "running"
                          ? "var(--bat-accent)"
                          : scanStatus === "done"
                            ? "var(--bat-success)"
                            : "var(--bat-text-muted)",
                  }}
                >
                  {scanStatus === "running"
                    ? "Running"
                    : scanStatus === "done"
                      ? "Done"
                      : scanStatus === "error"
                        ? "Needs attention"
                        : "Idle"}
                </span>
              </div>

              <div className="grid gap-2">
                <label className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
                  Scan depth
                </label>
                <select
                  value={scanMode}
                  onChange={(event) => setScanMode(event.target.value as WorkspaceIntakeScanMode)}
                  className="rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)", color: "var(--bat-text)" }}
                >
                  <option value="quick">Quick (homepage + short crawl)</option>
                  <option value="standard">Standard (broader crawl)</option>
                  <option value="deep">Deep (full website pass)</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    void handleScanWebsites();
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--bat-border)" }}
                  disabled={scanStatus === "running"}
                >
                  {scanStatus === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                  {scanStatus === "running" ? "Scanning websites..." : "Scan websites now"}
                </button>
                <label className="inline-flex items-start gap-2 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                  <input
                    type="checkbox"
                    checked={state.includeSocialProfileCrawl}
                    onChange={(event) =>
                      setState((previous) => ({
                        ...previous,
                        includeSocialProfileCrawl: event.target.checked,
                      }))
                    }
                    className="mt-0.5"
                  />
                  Include social profile URLs from references in this scan.
                </label>
              </div>

              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {feedEvents.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
                    {liveFeedUnavailable
                      ? "Live feed endpoint is unavailable on this backend deployment. Deploy the latest backend build to enable real-time enrichment events."
                      : "No live events yet. Start a website scan to see BAT extracting data in real time."}
                  </p>
                ) : (
                  feedEvents.map((event) => {
                    const tone = eventTone(event.type);
                    return (
                      <article
                        key={event.id}
                        className="rounded-lg border px-2.5 py-2 text-xs"
                        style={{
                          borderColor:
                            tone === "error"
                              ? "#f4b8b4"
                              : tone === "warn"
                                ? "color-mix(in srgb, var(--bat-warning) 45%, var(--bat-border))"
                                : "var(--bat-border)",
                          background:
                            tone === "error"
                              ? "#fff5f4"
                              : tone === "warn"
                                ? "color-mix(in srgb, var(--bat-warning) 10%, white)"
                                : "var(--bat-surface-muted)",
                        }}
                        data-animate="fade-up"
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 font-medium">
                            {tone === "error" ? (
                              <AlertTriangle className="h-3.5 w-3.5" />
                            ) : tone === "success" ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <Activity className="h-3.5 w-3.5" />
                            )}
                            {String(event.type || "").replaceAll("_", " ")}
                          </span>
                          <span style={{ color: "var(--bat-text-muted)" }}>{formatRelativeTime(event.createdAt)}</span>
                        </div>
                        <p>{event.message}</p>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
