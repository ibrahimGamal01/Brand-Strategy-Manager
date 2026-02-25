import Link from "next/link";

export default function AdminPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl" style={{ fontFamily: "var(--font-display)" }}>
        Admin Home
      </h1>
      <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
        Manage workspaces, users, and policy templates.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Link href="/admin/workspaces" className="bat-surface p-5">
          <p className="text-lg font-semibold">Workspaces</p>
          <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Review client access and workspace status.
          </p>
        </Link>
      </div>
    </section>
  );
}
