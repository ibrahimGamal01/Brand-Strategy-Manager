import Link from "next/link";

export default async function WorkspaceBillingPage({
  params
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Workspace Billing</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Plan and Usage</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Track workspace consumption and billing metrics tied to runs, exports, and automation usage.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/app/w/${workspaceId}`}
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            Back to Chat
          </Link>
          <Link href={`/app/w/${workspaceId}/settings`} className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--bat-border)" }}>
            Workspace Settings
          </Link>
        </div>
      </div>

      <div className="bat-surface p-5">
        <div className="grid gap-3 md:grid-cols-3">
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
        <button type="button" className="mt-5 rounded-full px-4 py-2 text-sm font-semibold" style={{ background: "var(--bat-accent)", color: "white" }}>
          Manage Plan
        </button>
      </div>
    </section>
  );
}
