import { IntakeFormState } from './intake-form-types';

interface BusinessContextFieldsProps {
  formData: IntakeFormState;
  updateField: <K extends keyof IntakeFormState>(field: K, value: IntakeFormState[K]) => void;
}

function fieldClassName(isPrimary: boolean = false): string {
  return `w-full bg-zinc-900 border rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none transition-all ${
    isPrimary
      ? 'border-zinc-700 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500'
      : 'border-zinc-800 focus:ring-2 focus:ring-zinc-500/50 focus:border-zinc-600'
  }`;
}

function labelClassName(): string {
  return 'block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2';
}

export function BusinessContextFields({ formData, updateField }: BusinessContextFieldsProps) {
  return (
    <>
      <div>
        <label className={labelClassName()}>Brand Name</label>
        <input
          type="text"
          required
          value={formData.name}
          onChange={(e) => updateField('name', e.target.value)}
          className={fieldClassName(true)}
          placeholder="e.g. Ummahpreneur"
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
          />
        </div>
      </div>

      <div>
        <label className={labelClassName()}>Website</label>
        <input
          type="text"
          value={formData.website}
          onChange={(e) => updateField('website', e.target.value)}
          className={fieldClassName()}
          placeholder="https://example.com"
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
          />
        </div>
        <div>
          <label className={labelClassName()}>Secondary Goals (comma-separated)</label>
          <input
            type="text"
            value={formData.secondaryGoals}
            onChange={(e) => updateField('secondaryGoals', e.target.value)}
            className={fieldClassName()}
            placeholder="Improve retention, lower CAC, improve brand awareness"
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
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClassName()}>Target Audience</label>
          <input
            type="text"
            value={formData.targetAudience}
            onChange={(e) => updateField('targetAudience', e.target.value)}
            className={fieldClassName()}
            placeholder="Who are you trying to serve?"
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
          />
        </div>
        <div>
          <label className={labelClassName()}>Autonomy Level</label>
          <select
            value={formData.autonomyLevel}
            onChange={(e) => updateField('autonomyLevel', (e.target.value as 'assist' | 'auto') || 'assist')}
            className={fieldClassName()}
          >
            <option value="assist">Assist (safe default)</option>
            <option value="auto">Auto (non-destructive)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClassName()}>Budget Sensitivity</label>
          <input
            type="text"
            value={formData.budgetSensitivity}
            onChange={(e) => updateField('budgetSensitivity', e.target.value)}
            className={fieldClassName()}
            placeholder="Low, medium, high"
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
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelClassName()}>Constraints</label>
          <input
            type="text"
            value={formData.constraints}
            onChange={(e) => updateField('constraints', e.target.value)}
            className={fieldClassName()}
            placeholder="Compliance limits, staffing limits, budget limits..."
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
          />
        </div>
      </div>
    </>
  );
}

