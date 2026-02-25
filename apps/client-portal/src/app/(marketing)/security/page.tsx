const controls = [
  "Role-based access for admins and client users",
  "Workspace-level data isolation",
  "Auditable action history with reversible mutations",
  "Evidence-linked outputs to prevent unsupported claims",
  "Approval gates before high-impact mutations"
];

export default function SecurityPage() {
  return (
    <section className="bat-shell py-14 md:py-20">
      <p className="bat-chip">Security and trust</p>
      <h1 className="mt-4 text-4xl md:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
        Built for accountable marketing operations
      </h1>
      <p className="mt-3 max-w-2xl" style={{ color: "var(--bat-text-muted)" }}>
        BAT keeps client work transparent by default: clear plans, source-backed recommendations, and explicit approval
        checkpoints.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {controls.map((control) => (
          <div key={control} className="bat-surface p-5 text-sm">
            {control}
          </div>
        ))}
      </div>
    </section>
  );
}
