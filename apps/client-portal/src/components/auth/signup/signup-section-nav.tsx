"use client";

import { SignupSectionId, SignupValidationState } from "./use-signup-scroll";

type SectionItem = {
  id: SignupSectionId;
  label: string;
};

type SignupSectionNavProps = {
  sections: SectionItem[];
  activeSection: SignupSectionId;
  validation: SignupValidationState;
  onSelect: (id: SignupSectionId) => void;
};

export function SignupSectionNav({ sections, activeSection, validation, onSelect }: SignupSectionNavProps) {
  return (
    <div className="signup-nav-sticky">
      <div className="bat-scrollbar flex items-center gap-2 overflow-x-auto rounded-2xl border bg-white/85 p-2 backdrop-blur">
        {sections.map((section) => {
          const isActive = section.id === activeSection;
          const state = validation[section.id];
          const statusLabel = state.errorCount > 0 ? `${state.errorCount} fix` : state.complete ? "done" : "incomplete";

          return (
            <button
              key={section.id}
              type="button"
              aria-controls={`signup-section-${section.id}`}
              aria-current={isActive ? "step" : undefined}
              className="whitespace-nowrap rounded-full border px-3 py-2 text-sm font-medium transition"
              style={{
                borderColor: isActive ? "var(--bat-accent)" : "var(--bat-border)",
                background: isActive ? "var(--bat-accent-soft)" : "white",
                color: "var(--bat-text)",
              }}
              onClick={() => onSelect(section.id)}
            >
              <span>{section.label}</span>
              <span
                className="ml-2 rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.08em]"
                style={{
                  borderColor: state.errorCount > 0 ? "#f4b8b4" : "var(--bat-border)",
                  color: state.errorCount > 0 ? "#9f2317" : "var(--bat-text-muted)",
                }}
              >
                {statusLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
