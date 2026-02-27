import Link from "next/link";

export default async function AdminWorkspaceDetailsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Workspace Details</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Workspace {id.slice(0, 8)}</h1>
        <p className="mt-2 text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          This surface is used for role management, policy visibility, and audit controls.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/admin/workspaces" className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--bat-border)" }}>
            Back to Workspaces
          </Link>
          <Link href={`/app/w/${id}`} className="rounded-full px-4 py-2 text-sm font-semibold" style={{ background: "var(--bat-accent)", color: "white" }}>
            Open Workspace Chat
          </Link>
        </div>
      </div>
    </section>
  );
}
