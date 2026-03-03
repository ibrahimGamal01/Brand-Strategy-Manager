"use client";

import { SignupSectionId, SignupValidationState } from "./use-signup-scroll";

type SectionItem = {
  id: SignupSectionId;
  label: string;
};

type SignupContextRailProps = {
  sections: SectionItem[];
  validation: SignupValidationState;
};

export function SignupContextRail({ sections, validation }: SignupContextRailProps) {
  const total = sections.length;
  const done = sections.filter((section) => validation[section.id].complete && validation[section.id].errorCount === 0).length;
  const percent = Math.round((done / total) * 100);

  return (
    <aside className="signup-rail-sticky space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--bat-text-muted)" }}>
            Signup progress
          </p>
          <h2 className="text-lg font-semibold">Create your BAT workspace</h2>
        </div>
        <span className="bat-chip">{percent}% ready</span>
      </div>

      <div className="h-2 rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(8, percent)}%`, background: "var(--bat-accent)" }}
        />
      </div>

      <div className="space-y-2">
        {sections.map((section) => {
          const state = validation[section.id];
          const status = state.errorCount > 0 ? `${state.errorCount} issues` : state.complete ? "Complete" : "In progress";
          return (
            <div
              key={section.id}
              className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
            >
              <span>{section.label}</span>
              <span style={{ color: state.errorCount > 0 ? "#9f2317" : "var(--bat-text-muted)" }}>{status}</span>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border px-3 py-3 text-sm" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}>
        BAT starts background research after signup. Source details will appear in Library.
      </div>

      <ul className="space-y-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
        <li>We verify your email before first login.</li>
        <li>Website and social references seed smarter intake autofill.</li>
        <li>Your workspace opens directly into guided setup.</li>
      </ul>
    </aside>
  );
}
