import { IntakeFormState } from './intake-form-types';

interface BusinessContextFieldsProps {
  formData: IntakeFormState;
  updateField: <K extends keyof IntakeFormState>(field: K, value: IntakeFormState[K]) => void;
  /** When true, show a small badge for suggested (AI-filled) fields. Keys are field names. */
  suggestedFields?: Set<string>;
  /** When true, fields are read-only (confirm step). */
  readOnly?: boolean;
}

function fieldClassName(isPrimary: boolean = false, readOnly?: boolean): string {
  const base = `w-full bg-zinc-900 border rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none transition-all ${
    isPrimary
      ? 'border-zinc-700 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500'
      : 'border-zinc-800 focus:ring-2 focus:ring-zinc-500/50 focus:border-zinc-600'
  }`;
  return readOnly ? `${base} opacity-90` : base;
}

function labelClassName(): string {
  return 'block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2';
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-zinc-300 mt-6 mb-3 first:mt-0 border-b border-zinc-800 pb-2">
      {children}
    </h3>
  );
}

function FieldBadge({ suggested }: { suggested?: boolean }) {
  if (!suggested) return null;
  return (
    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-normal uppercase">
      Suggested
    </span>
  );
}

export function BusinessContextFields({
  formData,
  updateField,
  suggestedFields,
  readOnly = false,
}: BusinessContextFieldsProps) {
  const isSuggested = (key: keyof IntakeFormState) => suggestedFields?.has(key);

  return (
    <>
      {/* 1. Identity */}
      <SectionTitle>Identity</SectionTitle>
      <div>
        <label className={labelClassName()}>
          Brand Name <FieldBadge suggested={isSuggested('name')} />
        </label>
        <input
          type="text"
          required
          value={formData.name}
          onChange={(e) => updateField('name', e.target.value)}
          className={fieldClassName(true, readOnly)}
          placeholder="e.g. Ummahpreneur"
          readOnly={readOnly}
        />
      </div>
      <div>
        <label className={labelClassName()}>
          Website <FieldBadge suggested={isSuggested('website')} />
        </label>
        <input
          type="text"
          value={formData.website}
          onChange={(e) => updateField('website', e.target.value)}
          className={fieldClassName()}
          placeholder="https://example.com"
          readOnly={readOnly}
        />
      </div>
      <div>
        <label className={labelClassName()}>
          What do you do in one sentence? <FieldBadge suggested={isSuggested('oneSentenceDescription')} />
        </label>
        <input
          type="text"
          value={formData.oneSentenceDescription}
          onChange={(e) => updateField('oneSentenceDescription', e.target.value)}
          className={fieldClassName()}
          placeholder="e.g. We deliver biophoton-based light and sound experiences to support coherence and wellbeing."
          readOnly={readOnly}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClassName()}>Niche / Industry</label>
          <input
            type="text"
            value={formData.niche}
            onChange={(e) => updateField('niche', e.target.value)}
            className={fieldClassName()}
            placeholder="e.g. Islamic business education"
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className={labelClassName()}>Business Type</label>
          <input
            type="text"
            value={formData.businessType}
            onChange={(e) => updateField('businessType', e.target.value)}
            className={fieldClassName()}
            placeholder="Agency, SaaS, Creator, E-commerce..."
            readOnly={readOnly}
          />
        </div>
      </div>

      {/* 2. Where & who */}
      <SectionTitle>Where & who</SectionTitle>
      <div>
        <label className={labelClassName()}>Where do you operate?</label>
        <input
          type="text"
          value={formData.operateWhere}
          onChange={(e) => updateField('operateWhere', e.target.value)}
          className={fieldClassName()}
          placeholder="e.g. Globally via 24/7 online streaming and digital access"
          readOnly={readOnly}
        />
      </div>
      <div>
        <label className={labelClassName()}>Where do you want more clients?</label>
        <input
          type="text"
          value={formData.wantClientsWhere}
          onChange={(e) => updateField('wantClientsWhere', e.target.value)}
          className={fieldClassName()}
          placeholder="e.g. US, Canada, UK, Australia, EU wellness audiences"
          readOnly={readOnly}
        />
      </div>
      <div>
        <label className={labelClassName()}>Ideal audience (primary for next 90 days)</label>
        <input
          type="text"
          value={formData.idealAudience}
          onChange={(e) => updateField('idealAudience', e.target.value)}
          className={fieldClassName()}
          placeholder="e.g. English-speaking wellness seekers 30–55, stressed, sleep-deprived, tech-comfortable"
          readOnly={readOnly}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClassName()}>Target Audience (general)</label>
          <input
            type="text"
            value={formData.targetAudience}
            onChange={(e) => updateField('targetAudience', e.target.value)}
            className={fieldClassName()}
            placeholder="Who are you trying to serve?"
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className={labelClassName()}>Geo Scope</label>
          <input
            type="text"
            value={formData.geoScope}
            onChange={(e) => updateField('geoScope', e.target.value)}
            className={fieldClassName()}
            placeholder="Global, GCC, US, MENA..."
            readOnly={readOnly}
          />
        </div>
      </div>

      {/* 3. Offer */}
      <SectionTitle>Offer</SectionTitle>
      <div>
        <label className={labelClassName()}>Services (list, one per line or comma-separated)</label>
        <textarea
          value={formData.servicesList}
          onChange={(e) => updateField('servicesList', e.target.value)}
          className={fieldClassName()}
          placeholder="BioHealing Stream, ELUUMIS SKY program, Self-Healing program..."
          rows={3}
          readOnly={readOnly}
        />
      </div>
      <div>
        <label className={labelClassName()}>Main offer to sell through content</label>
        <input
          type="text"
          value={formData.mainOffer}
          onChange={(e) => updateField('mainOffer', e.target.value)}
          className={fieldClassName()}
          placeholder="e.g. Free session then paid subscription, upsell to programs/devices"
          readOnly={readOnly}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClassName()}>Primary Goal</label>
          <input
            type="text"
            value={formData.primaryGoal}
            onChange={(e) => updateField('primaryGoal', e.target.value)}
            className={fieldClassName()}
            placeholder="Increase online sales, leads, or engagement"
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className={labelClassName()}>Secondary Goals (comma-separated)</label>
          <input
            type="text"
            value={formData.secondaryGoals}
            onChange={(e) => updateField('secondaryGoals', e.target.value)}
            className={fieldClassName()}
            placeholder="Improve retention, lower CAC, brand awareness"
            readOnly={readOnly}
          />
        </div>
      </div>
      <div>
        <label className={labelClassName()}>Future Business Goal</label>
        <input
          type="text"
          value={formData.futureGoal}
          onChange={(e) => updateField('futureGoal', e.target.value)}
          className={fieldClassName()}
          placeholder="Expand globally, launch products, build authority"
          readOnly={readOnly}
        />
      </div>
      <div>
        <label className={labelClassName()}>Why Join The Marketing AI Engine</label>
        <input
          type="text"
          value={formData.engineGoal}
          onChange={(e) => updateField('engineGoal', e.target.value)}
          className={fieldClassName()}
          placeholder="Automate growth operations and build a stronger strategy loop"
          readOnly={readOnly}
        />
      </div>

      {/* 4. Problems & results */}
      <SectionTitle>Problems & results</SectionTitle>
      <div>
        <label className={labelClassName()}>Top 3 problems you solve (one per line or comma-separated)</label>
        <textarea
          value={formData.topProblems}
          onChange={(e) => updateField('topProblems', e.target.value)}
          className={fieldClassName()}
          placeholder="Nervous system overload, stress, anxiety&#10;Poor sleep and recovery&#10;Low energy, hard to stay centered"
          rows={3}
          readOnly={readOnly}
        />
      </div>
      <div>
        <label className={labelClassName()}>Results content should drive in next 90 days (up to 2)</label>
        <input
          type="text"
          value={formData.resultsIn90Days}
          onChange={(e) => updateField('resultsIn90Days', e.target.value)}
          className={fieldClassName()}
          placeholder="e.g. Subscriber growth 3k–5k; Book free sessions and capture emails"
          readOnly={readOnly}
        />
      </div>

      {/* 5. Objections */}
      <SectionTitle>Objections</SectionTitle>
      <div>
        <label className={labelClassName()}>What do people usually ask before buying? (top 3)</label>
        <textarea
          value={formData.questionsBeforeBuying}
          onChange={(e) => updateField('questionsBeforeBuying', e.target.value)}
          className={fieldClassName()}
          placeholder="How does it work and what will I feel?&#10;How quickly do people see results?&#10;What do I need, pricing, support?"
          rows={3}
          readOnly={readOnly}
        />
      </div>

      {/* 6. Voice & constraints */}
      <SectionTitle>Voice & constraints</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClassName()}>Brand voice (3–5 words)</label>
          <input
            type="text"
            value={formData.brandVoiceWords}
            onChange={(e) => updateField('brandVoiceWords', e.target.value)}
            className={fieldClassName()}
            placeholder="e.g. Calm, grounded, visionary, experiential, empowering"
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className={labelClassName()}>Brand Tone</label>
          <input
            type="text"
            value={formData.brandTone}
            onChange={(e) => updateField('brandTone', e.target.value)}
            className={fieldClassName()}
            placeholder="Authoritative, playful, premium..."
            readOnly={readOnly}
          />
        </div>
      </div>
      <div>
        <label className={labelClassName()}>Topics to avoid / who you don&apos;t want to attract</label>
        <textarea
          value={formData.topicsToAvoid}
          onChange={(e) => updateField('topicsToAvoid', e.target.value)}
          className={fieldClassName()}
          placeholder="Avoid medical diagnosis language; avoid fear-based content; avoid religion/politics; avoid bargain-hunters."
          rows={2}
          readOnly={readOnly}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClassName()}>Constraints</label>
          <input
            type="text"
            value={formData.constraints}
            onChange={(e) => updateField('constraints', e.target.value)}
            className={fieldClassName()}
            placeholder="Compliance limits, staffing, budget..."
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className={labelClassName()}>Excluded Categories</label>
          <input
            type="text"
            value={formData.excludedCategories}
            onChange={(e) => updateField('excludedCategories', e.target.value)}
            className={fieldClassName()}
            placeholder="Coupon pages, meme pages, celebrity pages..."
            readOnly={readOnly}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={labelClassName()}>Language</label>
          <input
            type="text"
            value={formData.language}
            onChange={(e) => updateField('language', e.target.value)}
            className={fieldClassName()}
            placeholder="English, Arabic..."
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className={labelClassName()}>Planning Horizon</label>
          <input
            type="text"
            value={formData.planningHorizon}
            onChange={(e) => updateField('planningHorizon', e.target.value)}
            className={fieldClassName()}
            placeholder="90 days, 6 months..."
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className={labelClassName()}>Autonomy Level</label>
          <select
            value={formData.autonomyLevel}
            onChange={(e) => updateField('autonomyLevel', (e.target.value as 'assist' | 'auto') || 'assist')}
            className={fieldClassName()}
            disabled={readOnly}
          >
            <option value="assist">Assist (safe default)</option>
            <option value="auto">Auto (non-destructive)</option>
          </select>
        </div>
      </div>
      <div>
        <label className={labelClassName()}>Budget Sensitivity</label>
        <input
          type="text"
          value={formData.budgetSensitivity}
          onChange={(e) => updateField('budgetSensitivity', e.target.value)}
          className={fieldClassName()}
          placeholder="Low, medium, high"
          readOnly={readOnly}
        />
      </div>

      {/* 7. Channels & inspiration (competitor links in this component; handles in SocialHandlesFields) */}
      <SectionTitle>Channels & inspiration</SectionTitle>
      <div>
        <label className={labelClassName()}>Competitors or inspiration accounts (up to 3 links, one per line)</label>
        <textarea
          value={formData.competitorInspirationLinks}
          onChange={(e) => updateField('competitorInspirationLinks', e.target.value)}
          className={fieldClassName()}
          placeholder="https://www.instagram.com/example1&#10;https://www.instagram.com/example2"
          rows={3}
          readOnly={readOnly}
        />
      </div>
    </>
  );
}
