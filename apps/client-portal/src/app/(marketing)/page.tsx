import Link from "next/link";

const pillars = [
  {
    title: "Evidence-linked answers",
    text: "Every recommendation is grounded in workspace intelligence with auditable source references.",
  },
  {
    title: "Live activity visibility",
    text: "Clients watch progress in a clear activity stream and guide work while it runs.",
  },
  {
    title: "Approvals and reversibility",
    text: "High-impact changes are proposed first, then approved, tracked, and reversible.",
  },
];

const telemetry = [
  "Competitor discovery: 38% complete.",
  "12 candidates found. BAT asks for shortlist approval.",
  "Deliverable draft now assembling with evidence links.",
];

export default function HomePage() {
  return (
    <section className="bat-shell pb-18 pt-10 md:pb-24 md:pt-16">
      <div className="grid gap-5 lg:grid-cols-[1.15fr,0.85fr]">
        <article className="bat-panel space-y-6 p-7 md:p-9" data-animate="fade-up">
          <p className="bat-chip">BAT platform</p>
          <h1 className="bat-heading-xl">Your marketing agency, operating inside chat.</h1>
          <p className="max-w-2xl text-base bat-text-muted md:text-lg">
            BAT runs strategy, intelligence gathering, and deliverable production in one workspace where every claim can
            be traced to evidence.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/signup" className="bat-button bat-button-primary px-5">
              Start Free Workspace
            </Link>
            <Link href="/security" className="bat-button bat-button-secondary px-5">
              Security Model
            </Link>
          </div>
        </article>

        <article className="bat-panel-muted p-5" data-animate="fade-up">
          <p className="bat-chip">Live Activity Snapshot</p>
          <div className="mt-3 space-y-2">
            {telemetry.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-[color:var(--bat-border-subtle)] bg-[color:var(--bat-surface-raised)] px-4 py-3 text-sm"
              >
                {item}
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {pillars.map((pillar, index) => (
          <article
            key={pillar.title}
            className="bat-panel p-5"
            data-animate="fade-up"
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <h2 className="bat-heading-sm">{pillar.title}</h2>
            <p className="mt-2 text-sm bat-text-muted">{pillar.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
