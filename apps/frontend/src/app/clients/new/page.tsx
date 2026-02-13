'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Rocket, Search } from 'lucide-react';
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
} from './_components/social-handles-fields';

function parseCsvList(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function NewClientPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [isExistingClient, setIsExistingClient] = useState(false);
  const [formData, setFormData] = useState<IntakeFormState>(INITIAL_INTAKE_FORM_STATE);

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

    setStep(2);

    try {
      const secondaryGoals = parseCsvList(formData.secondaryGoals);
      const excludedCategories = parseCsvList(formData.excludedCategories);

      const payload = await apiClient.createClientIntakeV2({
        name: formData.name,
        niche: formData.niche,
        businessType: formData.businessType,
        website: formData.website,
        primaryGoal: formData.primaryGoal,
        secondaryGoals,
        futureGoal: formData.futureGoal,
        offerModel: formData.engineGoal,
        targetAudience: formData.targetAudience,
        geoScope: formData.geoScope,
        language: formData.language,
        planningHorizon: formData.planningHorizon,
        autonomyLevel: formData.autonomyLevel,
        budgetSensitivity: formData.budgetSensitivity,
        brandTone: formData.brandTone,
        channels: filledHandles,
        handles: formData.handles,
        platform: filledHandles[0].platform,
        handle: filledHandles[0].handle,
        surfaces: filledHandles.map((row) => row.platform),
        constraints: {
          operatorGoal: formData.engineGoal,
          businessConstraints: formData.constraints,
          excludedCategories,
          autonomyLevel: formData.autonomyLevel,
          budgetSensitivity: formData.budgetSensitivity,
          brandTone: formData.brandTone,
          language: formData.language,
          planningHorizon: formData.planningHorizon,
        },
      });

      if (!payload?.success || !payload?.researchJob?.id) {
        setStep(1);
        throw new Error(payload?.error || 'Failed to create client intake');
      }

      const existing = payload.isExisting === true;
      setIsExistingClient(existing);

      setTimeout(() => {
        router.push(`/research/${payload.researchJob.id}`);
      }, existing ? 800 : 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to process intake');
      setLoading(false);
      setStep(1);
    }
  }

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
                <Search size={18} />
                Start BAT Brain ({filledCount} platform{filledCount !== 1 ? 's' : ''})
              </button>
            </form>
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
