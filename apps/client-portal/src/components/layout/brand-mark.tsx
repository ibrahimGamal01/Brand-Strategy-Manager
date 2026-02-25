export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="inline-flex items-center gap-2">
      <div
        aria-hidden
        className="grid h-8 w-8 place-items-center rounded-xl border"
        style={{
          borderColor: "var(--bat-border)",
          background: "linear-gradient(135deg, var(--bat-accent-soft), var(--bat-surface))"
        }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--bat-accent)" }}>
          BAT
        </span>
      </div>
      {!compact ? (
        <div>
          <p className="text-sm font-semibold leading-none">Brand Autopilot Terminal</p>
          <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
            Your marketing agency in chat
          </p>
        </div>
      ) : null}
    </div>
  );
}
