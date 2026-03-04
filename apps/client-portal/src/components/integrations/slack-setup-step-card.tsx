"use client";

import { SlackSetupStepState } from "@/types/chat";

function stepBadge(state: SlackSetupStepState) {
  if (state === "done") {
    return { label: "Done", style: { borderColor: "#b8e2c9", background: "#f0fbf4", color: "#166534" } };
  }
  if (state === "in_progress") {
    return { label: "In progress", style: { borderColor: "#7db5f8", background: "#eef5ff", color: "#1f3c72" } };
  }
  if (state === "locked") {
    return { label: "Locked", style: { borderColor: "#d1d5db", background: "#f8fafc", color: "#6b7280" } };
  }
  return { label: "To do", style: { borderColor: "#f5d08b", background: "#fff8eb", color: "#7a4a00" } };
}

type SlackSetupStepCardProps = {
  number: number;
  title: string;
  detail: string;
  state: SlackSetupStepState;
  locked?: boolean;
  children: React.ReactNode;
};

export function SlackSetupStepCard({
  number,
  title,
  detail,
  state,
  locked = false,
  children,
}: SlackSetupStepCardProps) {
  const badge = stepBadge(state);
  return (
    <article
      className="rounded-2xl border p-4"
      style={{
        borderColor: "var(--bat-border)",
        background: "var(--bat-surface)",
        opacity: locked ? 0.65 : 1,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
            Step {number}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            {detail}
          </p>
        </div>
        <span className="rounded-full border px-2 py-0.5 text-xs" style={badge.style}>
          {badge.label}
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </article>
  );
}

