export default async function WorkspaceSettingsPage({
  params
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings • {workspaceId}</h1>
      <div className="bat-surface p-5">
        <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Configure workspace goals, constraints, and policy preferences.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Primary KPI
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            >
              <option>Lead quality</option>
              <option>Revenue</option>
              <option>Audience growth</option>
            </select>
          </label>
          <label className="text-sm">
            Main channel focus
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            >
              <option>Mixed</option>
              <option>Web</option>
              <option>Social</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="mt-5 rounded-full px-4 py-2 text-sm font-semibold"
          style={{ background: "var(--bat-accent)", color: "white" }}
        >
          Save and Continue in Chat
        </button>
      </div>
    </section>
  );
}
