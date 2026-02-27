import Link from "next/link";

export default function AdminPage() {
  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Admin Console</p>
        <h1 className="mt-3 text-3xl" style={{ fontFamily: "var(--font-display)" }}>
          Admin Home
        </h1>
        <p className="mt-2 text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Manage workspaces, access, and policy surfaces from one place.
        </p>
      </div>
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
