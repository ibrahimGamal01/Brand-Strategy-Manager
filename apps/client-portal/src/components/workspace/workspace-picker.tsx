import Link from "next/link";

interface Workspace {
  id: string;
  name: string;
  members: number;
  plan: string;
  status?: string;
  startedAt?: string | null;
  intakeReady?: boolean;
}

export function WorkspacePicker({
  workspaces,
  loading = false,
  error = null,
  onRetry,
}: {
  workspaces: Workspace[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  return (
    <section className="space-y-4">
      <div>
        <p className="bat-chip">Workspace switcher</p>
        <h1 className="mt-3 text-3xl md:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
          Choose a client workspace
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Chat is the default route after workspace selection.
        </p>
      </div>
      {error ? (
        <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#f4b8b4", background: "#fff5f4", color: "#9f2317" }}>
          <p>Could not load workspaces: {error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 rounded-full border px-3 py-1.5 text-xs"
              style={{ borderColor: "currentColor" }}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {loading && workspaces.length === 0 ? (
          <article className="bat-surface p-5">
            <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
              Loading workspaces...
            </p>
          </article>
        ) : null}
        {!loading && workspaces.length === 0 ? (
          <article className="bat-surface p-5">
            <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
              No workspaces were found yet.
            </p>
          </article>
        ) : null}
        {workspaces.map((workspace) => (
          <Link
            key={workspace.id}
            href={`/app/w/${workspace.id}`}
            className="bat-surface block p-5 transition-transform hover:-translate-y-0.5"
          >
            <p className="text-lg font-semibold">{workspace.name}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
              {workspace.members} members • {workspace.plan}
            </p>
            {!workspace.intakeReady ? (
              <p className="mt-2 text-xs uppercase tracking-[0.07em]" style={{ color: "var(--bat-warning)" }}>
                Setup needed before smart chat
              </p>
            ) : null}
            {workspace.status ? (
              <p className="mt-1 text-xs uppercase tracking-[0.07em]" style={{ color: "var(--bat-text-muted)" }}>
                Status: {workspace.status}
              </p>
            ) : null}
            <p className="mt-3 text-sm" style={{ color: "var(--bat-accent)" }}>
              Open Chat Workspace →
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
