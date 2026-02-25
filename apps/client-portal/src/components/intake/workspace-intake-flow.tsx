"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Rocket } from "lucide-react";
import {
  submitWorkspaceIntake,
  suggestWorkspaceIntakeCompletion,
  WorkspaceIntakeFormData,
} from "@/lib/runtime-api";
import { BusinessContextFields } from "./business-context-fields";
import {
  buildChannelsFromHandles,
  getFilledHandlesCount,
  getFilledHandlesList,
  SocialHandlesFields,
  SuggestedHandleValidationItem,
} from "./social-handles-fields";
import { INITIAL_INTAKE_FORM_STATE, IntakeFormState } from "./intake-form-types";

type IntakeStep = 1 | 2 | 3;

type WorkspaceIntakeFlowProps = {
  workspaceId: string;
  initialPrefill?: WorkspaceIntakeFormData;
  onCompleted: () => Promise<void>;
};

type SuggestedHandleValidationState = {
  instagram?: SuggestedHandleValidationItem;
  tiktok?: SuggestedHandleValidationItem;
};

function parseCsvList(value: string): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseList(value: string, maxItems = 10): string[] {
  return String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function mergePrefill(prefill?: WorkspaceIntakeFormData): IntakeFormState {
  if (!prefill) return { ...INITIAL_INTAKE_FORM_STATE };
  return {
    ...INITIAL_INTAKE_FORM_STATE,
    ...prefill,
    handles: {
      ...INITIAL_INTAKE_FORM_STATE.handles,
      ...(prefill.handles || {}),
    },
  };
}

function suggestedToFormState(
  current: IntakeFormState,
  suggested: Record<string, unknown>,
  suggestedHandles?: Record<string, string>
): { formData: IntakeFormState; suggestedKeys: Set<string>; suggestedHandlePlatforms: Set<string> } {
  const suggestedKeys = new Set<string>();
  const suggestedHandlePlatforms = new Set<string>();
  const next = { ...current };

  for (const [key, value] of Object.entries(suggested || {})) {
    if (!(key in next)) continue;
    const k = key as keyof IntakeFormState;
    if (value == null) continue;
    if (Array.isArray(value)) {
      (next as Record<string, unknown>)[k] = (value as string[]).join("\n");
    } else {
      (next as Record<string, unknown>)[k] = String(value);
    }
    suggestedKeys.add(key);
  }

  if (suggestedHandles && typeof suggestedHandles === "object") {
    const mergedHandles = { ...next.handles };
    for (const [platform, handle] of Object.entries(suggestedHandles)) {
      if (!handle || typeof handle !== "string") continue;
      if (!(platform in mergedHandles)) continue;
      mergedHandles[platform as keyof typeof mergedHandles] = handle.trim();
      suggestedHandlePlatforms.add(platform);
    }
    next.handles = mergedHandles;
  }

  return { formData: next, suggestedKeys, suggestedHandlePlatforms };
}

function buildIntakePayload(formData: IntakeFormState, filledHandles: Array<{ platform: string; handle: string }>) {
  const secondaryGoals = parseCsvList(formData.secondaryGoals);
  const excludedCategories = parseCsvList(formData.excludedCategories);

  return {
    ...formData,
    servicesList: parseList(formData.servicesList, 20),
    topProblems: parseList(formData.topProblems, 3),
    resultsIn90Days: parseList(formData.resultsIn90Days, 2),
    questionsBeforeBuying: parseList(formData.questionsBeforeBuying, 3),
    competitorInspirationLinks: parseList(formData.competitorInspirationLinks, 3),
    secondaryGoals,
    excludedCategories,
    channels: filledHandles,
    handle: filledHandles[0]?.handle,
    platform: filledHandles[0]?.platform,
    surfaces: filledHandles.map((item) => item.platform),
    constraints: {
      operatorGoal: formData.engineGoal,
      businessConstraints: formData.constraints,
      excludedCategories,
      autonomyLevel: formData.autonomyLevel,
      budgetSensitivity: formData.budgetSensitivity,
      brandTone: formData.brandTone,
      brandVoiceWords: formData.brandVoiceWords,
      topicsToAvoid: parseList(formData.topicsToAvoid, 15),
      language: formData.language,
      planningHorizon: formData.planningHorizon,
    },
  };
}

export function WorkspaceIntakeFlow({ workspaceId, initialPrefill, onCompleted }: WorkspaceIntakeFlowProps) {
  const [step, setStep] = useState<IntakeStep>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState<IntakeFormState>(mergePrefill(initialPrefill));
  const [suggestedFields, setSuggestedFields] = useState<Set<string>>(new Set());
  const [suggestedHandlePlatforms, setSuggestedHandlePlatforms] = useState<Set<string>>(new Set());
  const [suggestedHandleValidation, setSuggestedHandleValidation] = useState<SuggestedHandleValidationState>();
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [confirmationReasons, setConfirmationReasons] = useState<string[]>([]);
  const [channelsConfirmed, setChannelsConfirmed] = useState(false);

  useEffect(() => {
    setFormData(mergePrefill(initialPrefill));
  }, [initialPrefill]);

  useEffect(() => {
    if (step !== 3) return;
    const timer = setTimeout(() => {
      void onCompleted().catch((completionError: unknown) => {
        setError(String((completionError as Error)?.message || "Failed to open chat workspace"));
        setStep(2);
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, [onCompleted, step]);

  const filledCount = useMemo(() => getFilledHandlesCount(formData.handles), [formData.handles]);
  const filledHandles = useMemo(() => buildChannelsFromHandles(formData.handles), [formData.handles]);

  const reasonLabels: Record<string, string> = {
    MISSING_PRIMARY_CHANNEL:
      "No confirmed primary channel was detected yet (Instagram, TikTok, YouTube, or X/Twitter).",
    LOW_CONFIDENCE_SUGGESTION:
      "One or more suggested channels have low confidence and need your confirmation.",
    AI_NOT_CONFIGURED:
      "Suggestion service is currently unavailable. You can continue manually.",
  };

  const canSubmitForReview = loading || filledCount === 0;
  const canStartWorkflow = loading || filledCount === 0 || (confirmationRequired && !channelsConfirmed);

  function updateField<K extends keyof IntakeFormState>(field: K, value: IntakeFormState[K]) {
    setFormData((previous) => ({ ...previous, [field]: value }));
  }

  function updateHandle(platform: keyof IntakeFormState["handles"], value: string) {
    setFormData((previous) => ({
      ...previous,
      handles: {
        ...previous.handles,
        [platform]: value,
      },
    }));
    if (confirmationRequired) {
      setChannelsConfirmed(false);
    }
  }

  async function handleSuggestAndContinue(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    if (filledHandles.length === 0) {
      setError("Add at least one social handle to continue.");
      setLoading(false);
      return;
    }

    try {
      const suggestion = await suggestWorkspaceIntakeCompletion(workspaceId, {
        ...formData,
        handles: formData.handles,
      });

      if (suggestion?.success && (suggestion.suggested || suggestion.suggestedHandles)) {
        const { formData: merged, suggestedKeys, suggestedHandlePlatforms: platforms } = suggestedToFormState(
          formData,
          suggestion.suggested || {},
          suggestion.suggestedHandles
        );
        setFormData(merged);
        setSuggestedFields(suggestedKeys);
        setSuggestedHandlePlatforms(platforms);
        setSuggestedHandleValidation(
          suggestion.suggestedHandleValidation && typeof suggestion.suggestedHandleValidation === "object"
            ? suggestion.suggestedHandleValidation
            : undefined
        );
      }

      const needsConfirmation = suggestion?.confirmationRequired === true;
      setConfirmationRequired(needsConfirmation);
      setConfirmationReasons(Array.isArray(suggestion?.confirmationReasons) ? suggestion.confirmationReasons : []);
      setChannelsConfirmed(!needsConfirmation);
      setStep(2);
    } catch (suggestError: unknown) {
      setError(String((suggestError as Error)?.message || "Suggestion failed"));
      setConfirmationRequired(false);
      setConfirmationReasons([]);
      setChannelsConfirmed(true);
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartWorkflow() {
    setLoading(true);
    setError("");

    if (filledHandles.length === 0) {
      setError("At least one social handle is required.");
      setLoading(false);
      return;
    }

    if (confirmationRequired && !channelsConfirmed) {
      setError("Please confirm the suggested channels before starting.");
      setLoading(false);
      return;
    }

    try {
      const payload = buildIntakePayload(formData, filledHandles);
      const result = await submitWorkspaceIntake(workspaceId, payload as Record<string, unknown>);
      if (!result?.success) {
        throw new Error("Failed to start smart workflow");
      }
      setStep(3);
    } catch (submitError: unknown) {
      setError(String((submitError as Error)?.message || "Failed to submit intake"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="bat-surface p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--bat-text-muted)" }}>
              Workspace Setup
            </p>
            <h1 className="text-2xl font-semibold">Initialize BAT Brain</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
              Complete this intro once so BAT can run smart discovery and tailored planning.
            </p>
          </div>
          <span className="bat-chip">
            Step {step} of 3
          </span>
        </div>

        {step === 1 ? (
          <form className="space-y-5" onSubmit={handleSuggestAndContinue}>
            <BusinessContextFields formData={formData} updateField={updateField} />
            <SocialHandlesFields handles={formData.handles} onChange={updateHandle} />

            {error ? (
              <div
                className="rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={canSubmitForReview}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              style={{ background: "var(--bat-accent)", color: "white" }}
            >
              <Rocket className="h-4 w-4" />
              {loading ? "Checking suggestions..." : `Continue (${filledCount} channel${filledCount === 1 ? "" : "s"})`}
            </button>
          </form>
        ) : null}

        {step === 2 ? (
          <div className="space-y-5">
            <div
              className="rounded-xl border px-4 py-3 text-sm"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)", color: "var(--bat-text-muted)" }}
            >
              Review and edit your setup, then start smart workflow.
            </div>

            <BusinessContextFields formData={formData} updateField={updateField} suggestedFields={suggestedFields} />
            <SocialHandlesFields
              handles={formData.handles}
              onChange={updateHandle}
              suggestedPlatforms={suggestedHandlePlatforms}
              suggestedHandleValidation={suggestedHandleValidation}
            />

            {confirmationRequired ? (
              <div
                className="rounded-xl border px-4 py-3"
                style={{ borderColor: "color-mix(in srgb, var(--bat-warning) 45%, var(--bat-border))", background: "color-mix(in srgb, var(--bat-warning) 12%, white)" }}
              >
                <p className="mb-2 inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--bat-warning)" }}>
                  <AlertTriangle className="h-4 w-4" />
                  Confirmation required
                </p>
                <div className="space-y-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                  {confirmationReasons.map((reason) => (
                    <p key={reason}>• {reasonLabels[reason] || reason}</p>
                  ))}
                </div>
                <label className="mt-3 inline-flex items-start gap-2 text-xs" style={{ color: "var(--bat-text)" }}>
                  <input
                    type="checkbox"
                    checked={channelsConfirmed}
                    onChange={(event) => setChannelsConfirmed(event.target.checked)}
                    className="mt-0.5"
                  />
                  I confirm these channels are correct and should be used to start BAT.
                </label>
              </div>
            ) : null}

            {error ? (
              <div
                className="rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}
              >
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-full border px-4 py-2 text-sm"
                style={{ borderColor: "var(--bat-border)" }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleStartWorkflow}
                disabled={canStartWorkflow}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
                style={{ background: "var(--bat-accent)", color: "white" }}
              >
                <Rocket className="h-4 w-4" />
                {loading ? "Starting..." : "Confirm and start BAT"}
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: "var(--bat-accent-soft)", color: "var(--bat-accent)" }}>
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold">Starting smart workflow</h2>
            <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
              Discovery is running for {getFilledHandlesList(formData.handles).join(", ")}. Opening your chat workspace...
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
