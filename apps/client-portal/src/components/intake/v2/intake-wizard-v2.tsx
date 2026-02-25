"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Bot, Loader2, Save, Sparkles } from "lucide-react";
import { buildChannelsFromHandles, getFilledHandlesCount, SocialHandlesFields, SuggestedHandleValidationItem } from "../social-handles-fields";
import { PlatformId } from "../platforms";
import { IntakeStateV2, IntakeWizardStepId } from "./intake-types";
import { QuestionCard } from "./question-card";
import { SmartListAnswer } from "./smart-list-answer";
import { SmartTagsAnswer } from "./smart-tags-answer";
import { SmartLinksAnswer } from "./smart-links-answer";

type IntakeWizardV2Props = {
  state: IntakeStateV2;
  onChange: (next: IntakeStateV2) => void;
  onAutoFillStep: (step: IntakeWizardStepId) => Promise<void>;
  onSaveDraft: () => Promise<void>;
  onSubmit: () => Promise<void>;
  loading: boolean;
  error?: string;
  suggestedFields: Set<string>;
  suggestedHandlePlatforms: Set<string>;
  suggestedHandleValidation?: {
    instagram?: SuggestedHandleValidationItem;
    tiktok?: SuggestedHandleValidationItem;
  };
  confirmationRequired: boolean;
  confirmationReasons: string[];
  channelsConfirmed: boolean;
  onChannelsConfirmedChange: (value: boolean) => void;
};

type WizardStep = {
  id: IntakeWizardStepId;
  title: string;
  description: string;
  optional: boolean;
};

const STEPS: WizardStep[] = [
  {
    id: "brand",
    title: "Brand basics",
    description: "Core identity BAT uses for planning and positioning.",
    optional: false,
  },
  {
    id: "channels",
    title: "Channels",
    description: "Add channels when available. BAT can also start from websites and enrich socials later.",
    optional: false,
  },
  {
    id: "offer",
    title: "Offer and funnel",
    description: "Define your offer, services, and conversion intent.",
    optional: true,
  },
  {
    id: "audience",
    title: "Audience and goals",
    description: "Who BAT should focus on and what outcomes matter this quarter.",
    optional: true,
  },
  {
    id: "voice",
    title: "Voice and competitors",
    description: "Guardrails, voice, and inspiration links for better recommendations.",
    optional: true,
  },
];

const CONFIRMATION_REASON_LABELS: Record<string, string> = {
  MISSING_PRIMARY_CHANNEL:
    "No confirmed primary channel was detected yet (Instagram, TikTok, YouTube, or X).",
  LOW_CONFIDENCE_SUGGESTION:
    "One or more suggested channels have low confidence and need your confirmation.",
  AI_NOT_CONFIGURED:
    "Suggestion service is unavailable right now. You can continue manually.",
};

function sectionInputStyle() {
  return {
    borderColor: "var(--bat-border)",
    background: "var(--bat-surface)",
    color: "var(--bat-text)",
  };
}

export function IntakeWizardV2({
  state,
  onChange,
  onAutoFillStep,
  onSaveDraft,
  onSubmit,
  loading,
  error,
  suggestedFields,
  suggestedHandlePlatforms,
  suggestedHandleValidation,
  confirmationRequired,
  confirmationReasons,
  channelsConfirmed,
  onChannelsConfirmedChange,
}: IntakeWizardV2Props) {
  const [stepIndex, setStepIndex] = useState(0);

  const step = STEPS[stepIndex];
  const filledCount = useMemo(() => getFilledHandlesCount(state.handles), [state.handles]);
  const normalizedChannels = useMemo(() => buildChannelsFromHandles(state.handles), [state.handles]);

  const hasName = state.name.trim().length > 0;
  const hasChannel = normalizedChannels.length > 0;
  const hasWebsite =
    state.website.trim().length > 0 || state.websites.some((item) => String(item || "").trim().length > 0);
  const hasOfferOrGoal = state.mainOffer.trim().length > 0 || state.primaryGoal.trim().length > 0;
  const requireChannelConfirmation = confirmationRequired && hasChannel;

  const disableContinue =
    loading ||
    (step.id === "brand" && !hasName) ||
    (step.id === "channels" && !hasChannel && !hasWebsite) ||
    (step.id === "voice" && (!hasOfferOrGoal || (requireChannelConfirmation && !channelsConfirmed)));

  function updateField<K extends keyof IntakeStateV2>(field: K, value: IntakeStateV2[K]) {
    onChange({ ...state, [field]: value });
  }

  function updateHandle(platform: PlatformId, value: string) {
    const next = {
      ...state,
      handles: {
        ...state.handles,
        [platform]: value,
      },
      primaryChannel: state.primaryChannel || platform,
    };
    onChange(next);
    if (confirmationRequired) {
      onChannelsConfirmedChange(false);
    }
  }

  function goBack() {
    setStepIndex((previous) => Math.max(previous - 1, 0));
  }

  function goNext() {
    setStepIndex((previous) => Math.min(previous + 1, STEPS.length - 1));
  }

  async function handleAdvance() {
    if (stepIndex < STEPS.length - 1) {
      goNext();
      return;
    }
    await onSubmit();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--bat-text-muted)" }}>
            Workspace setup
          </p>
          <h2 className="text-xl font-semibold">Initialize BAT Brain</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Guided setup with smart answers. You can skip optional groups and continue in chat later.
          </p>
        </div>
        <span className="bat-chip">
          Step {stepIndex + 1} of {STEPS.length}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-5">
        {STEPS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="rounded-xl border px-3 py-2 text-left"
            style={{
              borderColor: index === stepIndex ? "var(--bat-accent)" : "var(--bat-border)",
              background: index === stepIndex ? "var(--bat-accent-soft)" : "var(--bat-surface)",
            }}
            onClick={() => setStepIndex(index)}
          >
            <p className="text-xs font-semibold">{item.title}</p>
            <p className="text-[11px]" style={{ color: "var(--bat-text-muted)" }}>
              {item.optional ? "Optional" : "Required"}
            </p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }}>
        <div>
          <p className="text-sm font-semibold">{step.title}</p>
          <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
            {step.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void onAutoFillStep(step.id);
            }}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs disabled:opacity-60"
            style={{ borderColor: "var(--bat-border)" }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Auto-fill this step
          </button>
          <button
            type="button"
            onClick={() => {
              void onSaveDraft();
            }}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs disabled:opacity-60"
            style={{ borderColor: "var(--bat-border)" }}
          >
            <Save className="h-3.5 w-3.5" />
            Save draft
          </button>
        </div>
      </div>

      {step.id === "brand" ? (
        <div className="space-y-3">
          <QuestionCard title="Brand name" suggested={suggestedFields.has("name")}>
            <input
              type="text"
              value={state.name}
              onChange={(event) => updateField("name", event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={sectionInputStyle()}
              placeholder="e.g. Bright Growth Studio"
              required
            />
          </QuestionCard>

          <QuestionCard title="Website" suggested={suggestedFields.has("website")}>
            <input
              type="url"
              value={state.website}
              onChange={(event) => updateField("website", event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={sectionInputStyle()}
              placeholder="https://example.com"
            />
          </QuestionCard>

          <QuestionCard
            title="Additional websites to scrape"
            description="Add multiple domains/pages BAT should crawl and persist into intelligence."
            suggested={suggestedFields.has("websites")}
          >
            <SmartListAnswer
              value={state.websites}
              onChange={(next) => updateField("websites", next)}
              maxItems={5}
              placeholder="Add a site URL or domain and press Enter"
              helperText="Up to 5 sites. BAT will scrape these into your workspace data."
            />
          </QuestionCard>

          <QuestionCard
            title="One-sentence description"
            suggested={suggestedFields.has("oneSentenceDescription")}
            actions={
              <button
                type="button"
                onClick={() => {
                  void onAutoFillStep("brand");
                }}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]"
                style={{ borderColor: "var(--bat-border)" }}
              >
                <Bot className="h-3.5 w-3.5" />
                Help me write this
              </button>
            }
          >
            <textarea
              rows={2}
              value={state.oneSentenceDescription}
              onChange={(event) => updateField("oneSentenceDescription", event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={sectionInputStyle()}
              placeholder="What your brand does and for whom"
            />
          </QuestionCard>

          <QuestionCard title="Niche / industry" suggested={suggestedFields.has("niche")}>
            <input
              type="text"
              value={state.niche}
              onChange={(event) => updateField("niche", event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={sectionInputStyle()}
              placeholder="e.g. Fitness coaching"
            />
          </QuestionCard>
        </div>
      ) : null}

      {step.id === "channels" ? (
        <div className="space-y-3">
          <QuestionCard title="Primary channel" description="Choose one channel BAT should prioritize first.">
            <div className="flex flex-wrap gap-2">
              {normalizedChannels.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
                  {hasWebsite
                    ? "No channels added yet. You can continue in website-first mode."
                    : "Add at least one channel below, or add a website in Brand basics."}
                </p>
              ) : (
                normalizedChannels.map((channel) => (
                  <button
                    key={`${channel.platform}:${channel.handle}`}
                    type="button"
                    onClick={() => updateField("primaryChannel", channel.platform)}
                    className="rounded-full border px-3 py-1.5 text-xs"
                    style={{
                      borderColor: state.primaryChannel === channel.platform ? "var(--bat-accent)" : "var(--bat-border)",
                      background:
                        state.primaryChannel === channel.platform ? "var(--bat-accent-soft)" : "var(--bat-surface)",
                    }}
                  >
                    {channel.platform} @{channel.handle}
                  </button>
                ))
              )}
            </div>
          </QuestionCard>

          <QuestionCard title="Add channels" description="Paste URL, @handle, or handle. BAT will normalize it.">
            <SocialHandlesFields
              handles={state.handles}
              onChange={updateHandle}
              suggestedPlatforms={suggestedHandlePlatforms}
              suggestedHandleValidation={suggestedHandleValidation}
            />
          </QuestionCard>

          <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
            {filledCount} channel{filledCount === 1 ? "" : "s"} selected.
            {!hasChannel && hasWebsite ? " Website-first mode is enabled." : ""}
          </p>
        </div>
      ) : null}

      {step.id === "offer" ? (
        <div className="space-y-3">
          <QuestionCard title="Main offer" suggested={suggestedFields.has("mainOffer")}>
            <input
              type="text"
              value={state.mainOffer}
              onChange={(event) => updateField("mainOffer", event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={sectionInputStyle()}
              placeholder="Primary offer to push through content"
            />
          </QuestionCard>

          <QuestionCard title="Services / products" suggested={suggestedFields.has("servicesList")}>
            <SmartListAnswer
              value={state.servicesList}
              onChange={(next) => updateField("servicesList", next)}
              maxItems={20}
              placeholder="Add a service and press Enter"
            />
          </QuestionCard>

          <QuestionCard title="Primary goal" suggested={suggestedFields.has("primaryGoal")}>
            <input
              type="text"
              value={state.primaryGoal}
              onChange={(event) => updateField("primaryGoal", event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={sectionInputStyle()}
              placeholder="Leads, revenue, demos, awareness"
            />
          </QuestionCard>

          <QuestionCard title="Price range" description="Use this as a simple budget sensitivity signal.">
            <select
              value={state.budgetSensitivity}
              onChange={(event) => updateField("budgetSensitivity", event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={sectionInputStyle()}
            >
              <option value="">Select range</option>
              <option value="low">Low ticket</option>
              <option value="mid">Mid ticket</option>
              <option value="high">High ticket</option>
            </select>
          </QuestionCard>
        </div>
      ) : null}

      {step.id === "audience" ? (
        <div className="space-y-3">
          <QuestionCard title="Primary audience (next 90 days)" suggested={suggestedFields.has("idealAudience")}>
            <input
              type="text"
              value={state.idealAudience}
              onChange={(event) => updateField("idealAudience", event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={sectionInputStyle()}
              placeholder="Who BAT should focus on first"
            />
          </QuestionCard>

          <QuestionCard title="Where you operate and where you want clients">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={state.operateWhere}
                onChange={(event) => updateField("operateWhere", event.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={sectionInputStyle()}
                placeholder="Current market"
              />
              <input
                type="text"
                value={state.wantClientsWhere}
                onChange={(event) => updateField("wantClientsWhere", event.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={sectionInputStyle()}
                placeholder="Target market"
              />
            </div>
          </QuestionCard>

          <QuestionCard title="Top problems you solve" suggested={suggestedFields.has("topProblems")}>
            <SmartListAnswer
              value={state.topProblems}
              onChange={(next) => updateField("topProblems", next)}
              maxItems={3}
              placeholder="Add a problem"
              helperText="Add up to 3 problems."
            />
          </QuestionCard>

          <QuestionCard title="Expected results in 90 days" suggested={suggestedFields.has("resultsIn90Days")}>
            <SmartListAnswer
              value={state.resultsIn90Days}
              onChange={(next) => updateField("resultsIn90Days", next)}
              maxItems={2}
              placeholder="Add a measurable outcome"
              helperText="Add up to 2 outcomes."
            />
          </QuestionCard>

          <QuestionCard title="Pre-purchase questions" suggested={suggestedFields.has("questionsBeforeBuying")}>
            <SmartListAnswer
              value={state.questionsBeforeBuying}
              onChange={(next) => updateField("questionsBeforeBuying", next)}
              maxItems={3}
              placeholder="Add a common question"
              helperText="Add up to 3 questions prospects ask before buying."
            />
          </QuestionCard>
        </div>
      ) : null}

      {step.id === "voice" ? (
        <div className="space-y-3">
          <QuestionCard title="Brand voice words" suggested={suggestedFields.has("brandVoiceWords")}>
            <SmartTagsAnswer
              value={state.brandVoiceWords}
              onChange={(next) => updateField("brandVoiceWords", next)}
              placeholder="e.g. calm, direct, evidence-based"
              maxItems={12}
            />
          </QuestionCard>

          <QuestionCard title="Topics to avoid" suggested={suggestedFields.has("topicsToAvoid")}>
            <SmartTagsAnswer
              value={state.topicsToAvoid}
              onChange={(next) => updateField("topicsToAvoid", next)}
              placeholder="Unsafe claims, off-brand topics"
              maxItems={12}
            />
          </QuestionCard>

          <QuestionCard title="Constraints">
            <textarea
              rows={3}
              value={state.constraints}
              onChange={(event) => updateField("constraints", event.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={sectionInputStyle()}
              placeholder="Compliance, legal, budget, team bandwidth..."
            />
          </QuestionCard>

          <QuestionCard title="Competitors / inspiration links" suggested={suggestedFields.has("competitorInspirationLinks")}>
            <SmartLinksAnswer
              value={state.competitorLinks}
              onChange={(next) => {
                onChange({
                  ...state,
                  competitorLinks: next,
                  competitorInspirationLinks: next
                    .filter((item) => item.valid)
                    .map((item) => item.normalizedUrl || item.raw),
                });
              }}
              maxItems={5}
            />
          </QuestionCard>

          {requireChannelConfirmation ? (
            <div
              className="rounded-xl border px-4 py-3"
              style={{
                borderColor: "color-mix(in srgb, var(--bat-warning) 45%, var(--bat-border))",
                background: "color-mix(in srgb, var(--bat-warning) 12%, white)",
              }}
            >
              <p className="mb-2 inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--bat-warning)" }}>
                <AlertTriangle className="h-4 w-4" />
                Confirmation required
              </p>
              <div className="space-y-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                {confirmationReasons.map((reason) => (
                  <p key={reason}>- {CONFIRMATION_REASON_LABELS[reason] || reason}</p>
                ))}
              </div>
              <label className="mt-3 inline-flex items-start gap-2 text-xs" style={{ color: "var(--bat-text)" }}>
                <input
                  type="checkbox"
                  checked={channelsConfirmed}
                  onChange={(event) => onChannelsConfirmedChange(event.target.checked)}
                  className="mt-0.5"
                />
                I confirm these channels are correct and should be used to start BAT.
              </label>
            </div>
          ) : null}
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

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={goBack}
            disabled={loading || stepIndex === 0}
            className="rounded-full border px-4 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Back
          </button>
          {step.optional ? (
            <button
              type="button"
              onClick={goNext}
              disabled={loading || stepIndex >= STEPS.length - 1}
              className="rounded-full border px-4 py-2 text-sm disabled:opacity-50"
              style={{ borderColor: "var(--bat-border)" }}
            >
              Skip (do later in chat)
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => {
            void handleAdvance();
          }}
          disabled={disableContinue}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
          style={{ background: "var(--bat-accent)", color: "white" }}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {stepIndex < STEPS.length - 1 ? "Save and continue" : "Confirm and start BAT"}
        </button>
      </div>
    </div>
  );
}
