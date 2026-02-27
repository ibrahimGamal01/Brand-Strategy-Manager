import Link from "next/link";

export default async function WorkspaceLibraryPage({
  params
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Workspace Library</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Evidence Library</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Explore workspace evidence, imports, and generated assets. The same sources are available in the in-chat library drawer.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/app/w/${workspaceId}`}
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            Return to Chat
          </Link>
          <Link href="/app" className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--bat-border)" }}>
            Switch Workspace
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {[
          { title: "Web evidence", detail: "Crawls, snapshots, and extracted website sections." },
          { title: "Competitor intelligence", detail: "Profiles, findings, and ranking notes from discovery runs." },
          { title: "Deliverables", detail: "Reports and client-ready exports generated from chat." },
        ].map((card) => (
          <article key={card.title} className="bat-surface p-5">
            <p className="text-sm font-semibold">{card.title}</p>
            <p className="mt-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
              {card.detail}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
