"use client";

import Link from "next/link";

type SignupActionBarProps = {
  formId: string;
  loading: boolean;
  invalidCount: number;
  submitLabel?: string;
};

export function SignupActionBar({
  formId,
  loading,
  invalidCount,
  submitLabel = "Create workspace",
}: SignupActionBarProps) {
  const summary = invalidCount > 0 ? `${invalidCount} field${invalidCount > 1 ? "s" : ""} need attention` : "Ready to create workspace";

  return (
    <div className="signup-action-sticky">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="min-h-6 text-sm" aria-live="polite" style={{ color: invalidCount > 0 ? "#9f2317" : "var(--bat-text-muted)" }}>
          {summary}
        </div>

        <div className="flex items-center gap-2">
          <Link href="/login" className="rounded-full border px-3 py-2 text-sm" style={{ borderColor: "var(--bat-border)", color: "var(--bat-text-muted)" }}>
            Already onboarded? Log in
          </Link>
          <button
            form={formId}
            type="submit"
            disabled={loading}
            className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-70"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            {loading ? "Creating workspace..." : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
