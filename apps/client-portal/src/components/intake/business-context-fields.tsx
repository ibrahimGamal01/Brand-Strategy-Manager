import { IntakeFormState } from "./intake-form-types";

interface BusinessContextFieldsProps {
  formData: IntakeFormState;
  updateField: <K extends keyof IntakeFormState>(field: K, value: IntakeFormState[K]) => void;
  suggestedFields?: Set<string>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="border-b pb-2 text-sm font-semibold"
      style={{ borderColor: "var(--bat-border)", color: "var(--bat-text)" }}
    >
      {children}
    </h3>
  );
}

function FieldLabel({
  children,
  suggested = false,
}: {
  children: React.ReactNode;
  suggested?: boolean;
}) {
  return (
    <span className="mb-1.5 block text-xs uppercase tracking-[0.1em]" style={{ color: "var(--bat-text-muted)" }}>
      {children}
      {suggested ? (
        <span
          className="ml-2 rounded-full px-2 py-0.5 text-[10px]"
          style={{ color: "var(--bat-accent)", background: "var(--bat-accent-soft)" }}
        >
          Suggested
        </span>
      ) : null}
    </span>
  );
}

function InputField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border px-3 py-2 text-sm ${props.className || ""}`}
      style={{
        borderColor: "var(--bat-border)",
        background: "var(--bat-surface)",
        color: "var(--bat-text)",
        ...(props.style || {}),
      }}
    />
  );
}

function TextAreaField(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border px-3 py-2 text-sm ${props.className || ""}`}
      style={{
        borderColor: "var(--bat-border)",
        background: "var(--bat-surface)",
        color: "var(--bat-text)",
        ...(props.style || {}),
      }}
    />
  );
}

export function BusinessContextFields({ formData, updateField, suggestedFields }: BusinessContextFieldsProps) {
  const isSuggested = (field: keyof IntakeFormState) => suggestedFields?.has(field);

  return (
    <div className="space-y-5">
      <SectionTitle>Identity</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <FieldLabel suggested={isSuggested("name")}>Brand name</FieldLabel>
          <InputField
            type="text"
            value={formData.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="e.g. Bright Growth Studio"
            required
          />
        </label>
        <label>
          <FieldLabel suggested={isSuggested("website")}>Website</FieldLabel>
          <InputField
            type="text"
            value={formData.website}
            onChange={(event) => updateField("website", event.target.value)}
            placeholder="https://example.com"
          />
        </label>
      </div>

      <label>
        <FieldLabel suggested={isSuggested("oneSentenceDescription")}>One-sentence business description</FieldLabel>
        <InputField
          type="text"
          value={formData.oneSentenceDescription}
          onChange={(event) => updateField("oneSentenceDescription", event.target.value)}
          placeholder="What your brand does and for whom"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <FieldLabel>Niche / industry</FieldLabel>
          <InputField
            type="text"
            value={formData.niche}
            onChange={(event) => updateField("niche", event.target.value)}
            placeholder="e.g. Fitness coaching"
          />
        </label>
        <label>
          <FieldLabel>Business type</FieldLabel>
          <InputField
            type="text"
            value={formData.businessType}
            onChange={(event) => updateField("businessType", event.target.value)}
            placeholder="Agency, SaaS, Creator, E-commerce..."
          />
        </label>
      </div>

      <SectionTitle>Audience & Market</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <FieldLabel>Where you operate</FieldLabel>
          <InputField
            type="text"
            value={formData.operateWhere}
            onChange={(event) => updateField("operateWhere", event.target.value)}
            placeholder="Local, regional, global..."
          />
        </label>
        <label>
          <FieldLabel>Where you want more clients</FieldLabel>
          <InputField
            type="text"
            value={formData.wantClientsWhere}
            onChange={(event) => updateField("wantClientsWhere", event.target.value)}
            placeholder="US, GCC, Europe..."
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <FieldLabel>Ideal audience (next 90 days)</FieldLabel>
          <InputField
            type="text"
            value={formData.idealAudience}
            onChange={(event) => updateField("idealAudience", event.target.value)}
            placeholder="Who should BAT focus on first?"
          />
        </label>
        <label>
          <FieldLabel>Target audience</FieldLabel>
          <InputField
            type="text"
            value={formData.targetAudience}
            onChange={(event) => updateField("targetAudience", event.target.value)}
            placeholder="Who are you trying to serve?"
          />
        </label>
      </div>
      <label>
        <FieldLabel>Geo scope</FieldLabel>
        <InputField
          type="text"
          value={formData.geoScope}
          onChange={(event) => updateField("geoScope", event.target.value)}
          placeholder="Global, MENA, US..."
        />
      </label>

      <SectionTitle>Offer & Goals</SectionTitle>
      <label>
        <FieldLabel>Services list (comma or new line)</FieldLabel>
        <TextAreaField
          rows={3}
          value={formData.servicesList}
          onChange={(event) => updateField("servicesList", event.target.value)}
          placeholder="Audit, Strategy, Content operations..."
        />
      </label>
      <label>
        <FieldLabel>Main offer</FieldLabel>
        <InputField
          type="text"
          value={formData.mainOffer}
          onChange={(event) => updateField("mainOffer", event.target.value)}
          placeholder="Primary offer to push through content"
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <FieldLabel>Primary goal</FieldLabel>
          <InputField
            type="text"
            value={formData.primaryGoal}
            onChange={(event) => updateField("primaryGoal", event.target.value)}
            placeholder="Leads, revenue, awareness..."
          />
        </label>
        <label>
          <FieldLabel>Secondary goals</FieldLabel>
          <InputField
            type="text"
            value={formData.secondaryGoals}
            onChange={(event) => updateField("secondaryGoals", event.target.value)}
            placeholder="Retention, engagement..."
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <FieldLabel>Future business goal</FieldLabel>
          <InputField
            type="text"
            value={formData.futureGoal}
            onChange={(event) => updateField("futureGoal", event.target.value)}
            placeholder="Expansion goal"
          />
        </label>
        <label>
          <FieldLabel>Engine goal</FieldLabel>
          <InputField
            type="text"
            value={formData.engineGoal}
            onChange={(event) => updateField("engineGoal", event.target.value)}
            placeholder="What BAT should optimize for"
          />
        </label>
      </div>

      <SectionTitle>Problems & Outcomes</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <FieldLabel>Top problems solved</FieldLabel>
          <TextAreaField
            rows={3}
            value={formData.topProblems}
            onChange={(event) => updateField("topProblems", event.target.value)}
            placeholder="3 main problems you solve"
          />
        </label>
        <label>
          <FieldLabel>Results expected in 90 days</FieldLabel>
          <TextAreaField
            rows={3}
            value={formData.resultsIn90Days}
            onChange={(event) => updateField("resultsIn90Days", event.target.value)}
            placeholder="2 measurable outcomes"
          />
        </label>
      </div>

      <label>
        <FieldLabel>Common pre-purchase questions</FieldLabel>
        <TextAreaField
          rows={3}
          value={formData.questionsBeforeBuying}
          onChange={(event) => updateField("questionsBeforeBuying", event.target.value)}
          placeholder="What clients ask before buying"
        />
      </label>

      <SectionTitle>Voice & Constraints</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <FieldLabel>Brand voice words</FieldLabel>
          <InputField
            type="text"
            value={formData.brandVoiceWords}
            onChange={(event) => updateField("brandVoiceWords", event.target.value)}
            placeholder="Calm, precise, direct..."
          />
        </label>
        <label>
          <FieldLabel>Brand tone</FieldLabel>
          <InputField
            type="text"
            value={formData.brandTone}
            onChange={(event) => updateField("brandTone", event.target.value)}
            placeholder="Premium, playful, formal..."
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <FieldLabel>Topics to avoid</FieldLabel>
          <InputField
            type="text"
            value={formData.topicsToAvoid}
            onChange={(event) => updateField("topicsToAvoid", event.target.value)}
            placeholder="Unsafe promises, off-brand subjects..."
          />
        </label>
        <label>
          <FieldLabel>Business constraints</FieldLabel>
          <InputField
            type="text"
            value={formData.constraints}
            onChange={(event) => updateField("constraints", event.target.value)}
            placeholder="Compliance, budget, team bandwidth..."
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <FieldLabel>Excluded categories</FieldLabel>
          <InputField
            type="text"
            value={formData.excludedCategories}
            onChange={(event) => updateField("excludedCategories", event.target.value)}
            placeholder="Coupon sites, meme pages..."
          />
        </label>
        <label>
          <FieldLabel>Language</FieldLabel>
          <InputField
            type="text"
            value={formData.language}
            onChange={(event) => updateField("language", event.target.value)}
            placeholder="English, Arabic..."
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label>
          <FieldLabel>Planning horizon</FieldLabel>
          <InputField
            type="text"
            value={formData.planningHorizon}
            onChange={(event) => updateField("planningHorizon", event.target.value)}
            placeholder="90 days, 6 months..."
          />
        </label>
        <label>
          <FieldLabel>Autonomy level</FieldLabel>
          <select
            value={formData.autonomyLevel}
            onChange={(event) => updateField("autonomyLevel", (event.target.value as "assist" | "auto") || "assist")}
            className="w-full rounded-xl border px-3 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)", color: "var(--bat-text)" }}
          >
            <option value="assist">Assist (recommended)</option>
            <option value="auto">Auto (non-destructive)</option>
          </select>
        </label>
        <label>
          <FieldLabel>Budget sensitivity</FieldLabel>
          <InputField
            type="text"
            value={formData.budgetSensitivity}
            onChange={(event) => updateField("budgetSensitivity", event.target.value)}
            placeholder="Low, medium, high"
          />
        </label>
      </div>

      <SectionTitle>Competitive Inspiration</SectionTitle>
      <label>
        <FieldLabel>Competitor/inspiration links</FieldLabel>
        <TextAreaField
          rows={3}
          value={formData.competitorInspirationLinks}
          onChange={(event) => updateField("competitorInspirationLinks", event.target.value)}
          placeholder="Up to 3 links, one per line"
        />
      </label>
    </div>
  );
}
