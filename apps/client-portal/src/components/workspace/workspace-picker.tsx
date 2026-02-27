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
  const formatLastActivity = (value?: string | null) => {
    if (!value) return "No activity yet";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "No activity yet";
    return `Updated ${date.toLocaleDateString()}`;
  };

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
          <article key={workspace.id} className="bat-surface p-5 transition-transform hover:-translate-y-0.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-lg font-semibold">{workspace.name}</p>
                <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
                  {workspace.members} members • {workspace.plan}
                </p>
              </div>
              {workspace.status ? (
                <span className="bat-chip">{workspace.status.toLowerCase()}</span>
              ) : null}
            </div>

            <p className="mt-2 text-xs uppercase tracking-[0.08em]" style={{ color: "var(--bat-text-muted)" }}>
              {formatLastActivity(workspace.startedAt)}
            </p>

            {!workspace.intakeReady ? (
              <p className="mt-2 text-xs uppercase tracking-[0.07em]" style={{ color: "var(--bat-warning)" }}>
                Setup needed before smart chat
              </p>
            ) : (
              <p className="mt-2 text-xs uppercase tracking-[0.07em]" style={{ color: "var(--bat-success)" }}>
                Ready for chat intelligence
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/app/w/${workspace.id}`}
                className="rounded-full px-3 py-1.5 text-sm font-semibold"
                style={{ background: "var(--bat-accent)", color: "white" }}
              >
                Open Chat
              </Link>
              <Link
                href={`/app/w/${workspace.id}/library`}
                className="rounded-full border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--bat-border)" }}
              >
                Open Library
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
