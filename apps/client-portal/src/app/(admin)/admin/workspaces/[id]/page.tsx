import Link from "next/link";

export default async function AdminWorkspaceDetailsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Workspace Details • {id}</h1>
      <div className="bat-surface p-5">
        <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
          This page is the entry point for admin controls such as role management, prompt policy visibility, and audit
          logs.
        </p>
      </div>
      <Link href="/admin/workspaces" className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--bat-border)" }}>
        Back to workspaces
      </Link>
    </section>
  );
}
