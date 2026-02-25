import Link from "next/link";

const pillars = [
  {
    title: "Evidence-linked answers",
    text: "Every recommendation is grounded in workspace intelligence with auditable source references."
  },
  {
    title: "Live activity visibility",
    text: "Clients watch progress in a friendly activity stream and guide work while it runs."
  },
  {
    title: "Approvals and reversibility",
    text: "Important changes are proposed first, then approved, tracked, and reversible."
  }
];

export default function HomePage() {
  return (
    <section className="bat-shell pb-20 pt-14 md:pt-20">
      <div className="grid gap-8 md:grid-cols-[1.2fr,0.8fr]">
        <div data-animate="fade-up">
          <p className="bat-chip mb-4">BAT • Brand Autopilot Terminal</p>
          <h1 className="text-4xl leading-tight md:text-6xl" style={{ fontFamily: "var(--font-display)" }}>
            Your marketing agency in chat.
          </h1>
          <p className="mt-5 max-w-xl text-lg" style={{ color: "var(--bat-text-muted)" }}>
            BAT runs strategy, intelligence gathering, and deliverables in one conversation. You can steer every
            decision live or let BAT operate with your approvals.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-full px-5 py-3 text-sm font-semibold"
              style={{ background: "var(--bat-accent)", color: "white" }}
            >
              Start Free Workspace
            </Link>
            <Link href="/security" className="rounded-full border px-5 py-3 text-sm" style={{ borderColor: "var(--bat-border)" }}>
              See Security Model
            </Link>
          </div>
          <p className="mt-6 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Everything is grounded to your brand data and evidence links. Every change is auditable and reversible.
          </p>
        </div>

        <div className="bat-surface p-6" data-animate="fade-up">
          <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--bat-text-muted)" }}>
            Live activity snapshot
          </p>
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--bat-border)" }}>
              <p className="text-sm font-semibold">Competitor discovery</p>
              <p className="mt-1 text-sm" style={{ color: "var(--bat-text-muted)" }}>
                38% complete • analyzing alternatives and social positioning.
              </p>
            </div>
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--bat-border)" }}>
              <p className="text-sm">Found 12 candidate competitors. BAT asks: approve top 8 for deep analysis?</p>
            </div>
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--bat-border)" }}>
              <p className="text-sm">A deliverable draft is assembling with evidence attached section-by-section.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {pillars.map((pillar, index) => (
          <article
            key={pillar.title}
            className="bat-surface p-5"
            data-animate="fade-up"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <h2 className="text-lg font-semibold">{pillar.title}</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
              {pillar.text}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
