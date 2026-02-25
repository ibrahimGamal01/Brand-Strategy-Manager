export default async function WorkspaceBillingPage({
  params
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Billing • {workspaceId}</h1>
      <div className="bat-surface p-5">
        <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Manage subscription, usage, and invoices from this workspace billing surface.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
            <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
              AI credits used
            </p>
            <p className="mt-1 text-xl font-semibold">72%</p>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
            <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
              Refresh runs
            </p>
            <p className="mt-1 text-xl font-semibold">43</p>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--bat-border)" }}>
            <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
              Exports
            </p>
            <p className="mt-1 text-xl font-semibold">9</p>
          </div>
        </div>
        <button
          type="button"
          className="mt-5 rounded-full px-4 py-2 text-sm font-semibold"
          style={{ background: "var(--bat-accent)", color: "white" }}
        >
          Manage Plan
        </button>
      </div>
    </section>
  );
}
