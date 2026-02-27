import Link from "next/link";

export default async function WorkspaceSettingsPage({
  params
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Workspace Settings</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Configure Strategy Controls</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Update priorities that influence tool planning, evidence ranking, and output style.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/app/w/${workspaceId}`}
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            Back to Chat
          </Link>
          <Link href={`/app/w/${workspaceId}/library`} className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--bat-border)" }}>
            Open Library
          </Link>
        </div>
      </div>

      <div className="bat-surface p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Primary KPI
            <select className="mt-1 w-full rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
              <option>Lead quality</option>
              <option>Revenue</option>
              <option>Audience growth</option>
            </select>
          </label>
          <label className="text-sm">
            Main channel focus
            <select className="mt-1 w-full rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
              <option>Mixed</option>
              <option>Web</option>
              <option>Social</option>
            </select>
          </label>
        </div>
        <button type="button" className="mt-5 rounded-full px-4 py-2 text-sm font-semibold" style={{ background: "var(--bat-accent)", color: "white" }}>
          Save and Continue in Chat
        </button>
      </div>
    </section>
  );
}
