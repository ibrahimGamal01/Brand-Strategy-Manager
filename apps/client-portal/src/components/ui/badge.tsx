import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type BadgeTone = "neutral" | "success" | "warning" | "danger";

const toneClass: Record<BadgeTone, string> = {
  neutral: "border-[color:var(--bat-border)] bg-[color:var(--bat-surface-muted)] text-[color:var(--bat-text-muted)]",
  success: "bat-status-success",
  warning: "bat-status-warning",
  danger: "bat-status-danger",
};

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.08em]",
        toneClass[tone],
        className
      )}
      {...props}
    />
  );
}
