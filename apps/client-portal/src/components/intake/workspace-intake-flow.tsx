"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  saveWorkspaceIntakeDraft,
  submitWorkspaceIntake,
  suggestWorkspaceIntakeCompletion,
  WorkspaceIntakeFormData,
} from "@/lib/runtime-api";
import { buildChannelsFromHandles, getFilledHandlesList, SuggestedHandleValidationItem } from "./social-handles-fields";
import { IntakeWizardV2 } from "./v2/intake-wizard-v2";
import {
  applySuggestedHandles,
  applySuggestedToState,
  fromPrefillToV2,
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
};

type IntakePhase = "wizard" | "starting";

export function WorkspaceIntakeFlow({ workspaceId, initialPrefill, onCompleted }: WorkspaceIntakeFlowProps) {
  const [phase, setPhase] = useState<IntakePhase>("wizard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [state, setState] = useState<IntakeStateV2>(fromPrefillToV2(initialPrefill));
  const [suggestedFields, setSuggestedFields] = useState<Set<string>>(new Set());
  const [suggestedHandlePlatforms, setSuggestedHandlePlatforms] = useState<Set<string>>(new Set());
  const [suggestedHandleValidation, setSuggestedHandleValidation] = useState<SuggestedHandleValidationState>();
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [confirmationReasons, setConfirmationReasons] = useState<string[]>([]);
  const [channelsConfirmed, setChannelsConfirmed] = useState(false);

  useEffect(() => {
    setState(fromPrefillToV2(initialPrefill));
  }, [initialPrefill]);

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

  const filledHandles = useMemo(() => buildChannelsFromHandles(state.handles), [state.handles]);

  async function handleAutoFillStep(step: IntakeWizardStepId) {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const suggestion = await suggestWorkspaceIntakeCompletion(workspaceId, toSuggestPayloadV2(state));
      let next = state;

      if (suggestion?.success && suggestion.suggested) {
        const suggestedResult = applySuggestedToState(next, suggestion.suggested, step);
        next = suggestedResult.next;
        setSuggestedFields((previous) => new Set([...Array.from(previous), ...Array.from(suggestedResult.suggestedKeys)]));
      }

      if (suggestion?.success && suggestion.suggestedHandles) {
        const handleResult = applySuggestedHandles(next, suggestion.suggestedHandles);
        next = handleResult.next;
        setSuggestedHandlePlatforms((previous) =>
          new Set([...Array.from(previous), ...Array.from(handleResult.suggestedPlatforms)])
        );
      }

      setState(next);
      setSuggestedHandleValidation(
        suggestion?.suggestedHandleValidation && typeof suggestion.suggestedHandleValidation === "object"
          ? suggestion.suggestedHandleValidation
          : undefined
      );

      const needsConfirmation = suggestion?.confirmationRequired === true;
      setConfirmationRequired(needsConfirmation);
      setConfirmationReasons(Array.isArray(suggestion?.confirmationReasons) ? suggestion.confirmationReasons : []);
      setChannelsConfirmed(!needsConfirmation);
      setNotice("Step suggestions applied.");
    } catch (suggestError: unknown) {
      setError(String((suggestError as Error)?.message || "Suggestion failed"));
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

  async function handleStartWorkflow() {
    setLoading(true);
    setError("");
    setNotice("");

    if (filledHandles.length === 0) {
      setError("At least one social handle is required.");
      setLoading(false);
      return;
    }

    if (!state.mainOffer.trim() && !state.primaryGoal.trim()) {
      setError("Add a primary goal or a main offer before starting BAT.");
      setLoading(false);
      return;
    }

    if (confirmationRequired && !channelsConfirmed) {
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

  return (
    <section className="space-y-4">
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
              confirmationRequired={confirmationRequired}
              confirmationReasons={confirmationReasons}
              channelsConfirmed={channelsConfirmed}
              onChannelsConfirmedChange={setChannelsConfirmed}
            />
          </div>
        ) : null}

        {phase === "starting" ? (
          <div className="space-y-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: "var(--bat-accent-soft)", color: "var(--bat-accent)" }}>
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold">Starting smart workflow</h2>
            <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
              Discovery is running for {getFilledHandlesList(state.handles).join(", ") || "your channels"}. Opening your chat workspace...
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
