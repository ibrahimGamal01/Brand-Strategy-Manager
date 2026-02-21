'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Rocket, Search, CheckCircle, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { BusinessContextFields } from './_components/business-context-fields';
import { IntakeLoadingStep } from './_components/intake-loading-step';
import { INITIAL_INTAKE_FORM_STATE, IntakeFormState } from './_components/intake-form-types';
import {
  buildChannelsFromHandles,
  getFilledHandlesCount,
  getFilledHandlesList,
  SocialHandlesFields,
  type SuggestedHandleValidationItem,
} from './_components/social-handles-fields';

type SuggestedHandleValidationState = {
  instagram?: SuggestedHandleValidationItem;
  tiktok?: SuggestedHandleValidationItem;
};

function suggestedToFormState(
  current: IntakeFormState,
  suggested: Record<string, unknown>,
  suggestedHandles?: Record<string, string>
): { formData: IntakeFormState; suggestedKeys: Set<string>; suggestedHandlePlatforms: Set<string> } {
  const suggestedKeys = new Set<string>();
  const suggestedHandlePlatforms = new Set<string>();
  const next = { ...current };
  for (const [key, value] of Object.entries(suggested)) {
    if (!(key in next)) continue;
    const k = key as keyof IntakeFormState;
    if (value == null) continue;
    if (Array.isArray(value)) {
      (next as Record<string, unknown>)[k] = (value as string[]).join('\n');
    } else {
      (next as Record<string, unknown>)[k] = String(value);
    }
    suggestedKeys.add(key);
  }
  if (suggestedHandles && typeof suggestedHandles === 'object') {
    const nextHandles = { ...next.handles };
    for (const [platform, handle] of Object.entries(suggestedHandles)) {
      if (handle && typeof handle === 'string' && platform in nextHandles) {
        nextHandles[platform as keyof typeof nextHandles] = handle.trim();
        suggestedHandlePlatforms.add(platform);
      }
    }
    next.handles = nextHandles;
  }
  return { formData: next, suggestedKeys, suggestedHandlePlatforms };
}

function parseCsvList(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseList(value: string, maxItems = 10): string[] {
  return String(value || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildIntakePayload(formData: IntakeFormState, filledHandles: Array<{ platform: string; handle: string }>) {
  const secondaryGoals = parseCsvList(formData.secondaryGoals);
  const excludedCategories = parseCsvList(formData.excludedCategories);
  return {
    name: formData.name,
    niche: formData.niche,
    businessType: formData.businessType,
    website: formData.website,
    oneSentenceDescription: formData.oneSentenceDescription,
    operateWhere: formData.operateWhere,
    wantClientsWhere: formData.wantClientsWhere,
    idealAudience: formData.idealAudience,
    targetAudience: formData.targetAudience,
    geoScope: formData.geoScope,
    servicesList: parseList(formData.servicesList, 20),
    mainOffer: formData.mainOffer,
    primaryGoal: formData.primaryGoal,
    secondaryGoals,
    futureGoal: formData.futureGoal,
    engineGoal: formData.engineGoal,
    offerModel: formData.engineGoal,
    topProblems: parseList(formData.topProblems, 3),
    resultsIn90Days: parseList(formData.resultsIn90Days, 2),
    questionsBeforeBuying: parseList(formData.questionsBeforeBuying, 3),
    brandVoiceWords: formData.brandVoiceWords,
    brandTone: formData.brandTone,
    topicsToAvoid: formData.topicsToAvoid,
    excludedCategories,
    competitorInspirationLinks: parseList(formData.competitorInspirationLinks, 3),
    language: formData.language,
    planningHorizon: formData.planningHorizon,
    autonomyLevel: formData.autonomyLevel,
    budgetSensitivity: formData.budgetSensitivity,
    channels: filledHandles,
    handles: formData.handles,
    platform: filledHandles[0]?.platform,
    handle: filledHandles[0]?.handle,
    surfaces: filledHandles.map((row) => row.platform),
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

export default function NewClientPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [isExistingClient, setIsExistingClient] = useState(false);
  const [formData, setFormData] = useState<IntakeFormState>(INITIAL_INTAKE_FORM_STATE);
  const [suggestedFields, setSuggestedFields] = useState<Set<string>>(new Set());
  const [suggestedHandlePlatforms, setSuggestedHandlePlatforms] = useState<Set<string>>(new Set());
  const [suggestedHandleValidation, setSuggestedHandleValidation] = useState<SuggestedHandleValidationState | undefined>(undefined);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [confirmationReasons, setConfirmationReasons] = useState<string[]>([]);
  const [channelsConfirmed, setChannelsConfirmed] = useState(false);

  const filledCount = getFilledHandlesCount(formData.handles);
  const filledHandles = buildChannelsFromHandles(formData.handles);

  function updateField<K extends keyof IntakeFormState>(field: K, value: IntakeFormState[K]) {
    setFormData((previous) => ({ ...previous, [field]: value }));
  }

  function updateHandle(platform: keyof IntakeFormState['handles'], value: string) {
    setFormData((previous) => ({
      ...previous,
      handles: { ...previous.handles, [platform]: value },
    }));
    if (confirmationRequired) {
      setChannelsConfirmed(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (filledHandles.length === 0) {
      setError('Please provide at least one social media handle');
      setLoading(false);
      return;
    }

    try {
      const partialPayload = {
        ...formData,
        handles: formData.handles,
        secondaryGoals: formData.secondaryGoals,
        excludedCategories: formData.excludedCategories,
      } as Record<string, unknown>;
      const res = await apiClient.suggestIntakeCompletion(partialPayload);
      if (res?.success && (res.suggested || res.suggestedHandles)) {
        const { formData: merged, suggestedKeys, suggestedHandlePlatforms } = suggestedToFormState(
          formData,
          res.suggested || {},
          res.suggestedHandles
        );
        setFormData(merged);
        setSuggestedFields(suggestedKeys);
        setSuggestedHandlePlatforms(suggestedHandlePlatforms);
        setSuggestedHandleValidation(
          res.suggestedHandleValidation && typeof res.suggestedHandleValidation === 'object'
            ? (res.suggestedHandleValidation as SuggestedHandleValidationState)
            : undefined
        );
        const needsConfirmation = res.confirmationRequired === true;
        setConfirmationRequired(needsConfirmation);
        setConfirmationReasons(
          Array.isArray(res.confirmationReasons)
            ? res.confirmationReasons.map((item) => String(item))
            : []
        );
        setChannelsConfirmed(!needsConfirmation);
      }
      setStep(2);
    } catch {
      setConfirmationRequired(false);
      setConfirmationReasons([]);
      setChannelsConfirmed(true);
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (filledHandles.length === 0) return;
    if (confirmationRequired && !channelsConfirmed) {
      setError('Please confirm your suggested channels before starting BAT Brain.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = await apiClient.createClientIntakeV2(
        buildIntakePayload(formData, filledHandles) as Record<string, unknown>
      );
      if (!payload?.success || !payload?.researchJob?.id) {
        throw new Error(payload?.error || 'Failed to create client intake');
      }
      setIsExistingClient(payload.isExisting === true);
      setStep(3);
      setTimeout(() => {
        router.push(`/research/${payload.researchJob.id}`);
      }, payload.isExisting ? 800 : 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create client intake');
    } finally {
      setLoading(false);
    }
  }

  const canStart = loading || filledCount === 0 || (confirmationRequired && !channelsConfirmed);
  const reasonLabels: Record<string, string> = {
    MISSING_PRIMARY_CHANNEL:
      'No confirmed primary channel found yet (Instagram, TikTok, YouTube, or X/Twitter).',
    LOW_CONFIDENCE_SUGGESTION:
      'At least one suggested channel has low confidence and needs confirmation.',
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col">
      <header className="h-16 px-6 border-b border-zinc-900 flex items-center">
        <Link
          href="/"
          className="text-zinc-500 hover:text-white flex items-center gap-2 text-sm font-medium transition-colors"
        >
          <ChevronLeft size={16} />
          Back to BAT Control Center
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6">
        {step === 1 ? (
          <div className="w-full max-w-2xl animate-in fade-in zoom-in duration-300">
            <div className="text-center mb-10">
              <div className="w-12 h-12 bg-blue-600/10 text-blue-500 rounded-xl flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                <Rocket size={24} />
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Initialize BAT Brain</h1>
              <p className="text-zinc-500">
                Capture business goals, context, and channels so orchestration can run the right sequence.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <BusinessContextFields formData={formData} updateField={updateField} />
              <SocialHandlesFields handles={formData.handles} onChange={updateHandle} />

              {error ? (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
                  Error: {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading || filledCount === 0}
                className="w-full bg-white text-zinc-950 hover:bg-zinc-200 py-3.5 px-6 rounded-lg font-bold transition-all transform active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
              >
                {loading ? (
                  'Getting suggestions...'
                ) : (
                  <>
                    <Search size={18} />
                    Continue ({filledCount} platform{filledCount !== 1 ? 's' : ''})
                  </>
                )}
              </button>
            </form>
          </div>
        ) : step === 2 ? (
          <div className="w-full max-w-2xl animate-in fade-in duration-300">
            <div className="text-center mb-6">
              <div className="w-12 h-12 bg-green-600/10 text-green-500 rounded-xl flex items-center justify-center mx-auto mb-4 border border-green-500/20">
                <CheckCircle size={24} />
              </div>
              <h1 className="text-xl font-bold text-white mb-2">Confirm and start</h1>
              <p className="text-zinc-500 text-sm">
                Review your info. Edit if needed, then start BAT Brain.
              </p>
            </div>
            <div className="space-y-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 max-h-[60vh] overflow-y-auto">
              <BusinessContextFields
                formData={formData}
                updateField={updateField}
                suggestedFields={suggestedFields}
              />
              <SocialHandlesFields
                handles={formData.handles}
                onChange={updateHandle}
                suggestedPlatforms={suggestedHandlePlatforms}
                suggestedHandleValidation={suggestedHandleValidation}
              />
              {confirmationRequired ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold">
                    <AlertTriangle size={16} />
                    Channel confirmation required
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-amber-100/90">
                    {confirmationReasons.map((reason) => (
                      <p key={reason}>• {reasonLabels[reason] || reason}</p>
                    ))}
                  </div>
                  <label className="mt-3 flex items-start gap-2 text-xs text-amber-50">
                    <input
                      type="checkbox"
                      checked={channelsConfirmed}
                      onChange={(event) => setChannelsConfirmed(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>I confirm these channels are correct and should be used to start BAT Brain.</span>
                  </label>
                </div>
              ) : null}
            </div>
            {error ? (
              <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
                {error}
              </div>
            ) : null}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 py-3 px-4 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 font-medium"
              >
                Back to edit
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={canStart}
                className="flex-1 bg-white text-zinc-950 hover:bg-zinc-200 py-3 px-4 rounded-lg font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? 'Starting...' : (
                  <>
                    <Rocket size={18} />
                    Confirm and start BAT Brain
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <IntakeLoadingStep
            isExistingClient={isExistingClient}
            filledCount={filledCount}
            handles={getFilledHandlesList(formData.handles)}
          />
        )}
      </main>
    </div>
  );
}
