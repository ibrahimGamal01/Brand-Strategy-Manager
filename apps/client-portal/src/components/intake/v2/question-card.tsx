import { ReactNode } from "react";

interface QuestionCardProps {
  title: string;
  description?: string;
  suggested?: boolean;
  children: ReactNode;
  actions?: ReactNode;
}

export function QuestionCard({ title, description, suggested = false, children, actions }: QuestionCardProps) {
  return (
    <section
      className="space-y-3 rounded-2xl border p-4"
      style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--bat-text)" }}>
            {title}
            {suggested ? (
              <span
                className="ml-2 rounded-full px-2 py-0.5 text-[10px]"
                style={{ color: "var(--bat-accent)", background: "var(--bat-accent-soft)" }}
              >
                Suggested
              </span>
            ) : null}
          </h3>
          {description ? (
            <p className="mt-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
