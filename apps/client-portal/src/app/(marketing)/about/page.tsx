export default function AboutPage() {
  return (
    <section className="bat-shell py-14 md:py-20">
      <p className="bat-chip">About BAT</p>
      <h1 className="mt-4 text-4xl md:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
        A client-ready agency operating layer
      </h1>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="bat-surface p-6">
          <h2 className="text-lg font-semibold">Why BAT exists</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Marketing teams juggle disconnected tools, unclear ownership, and low confidence in recommendations. BAT
            centralizes execution in one conversation where data, decisions, and deliverables stay connected.
          </p>
        </article>
        <article className="bat-surface p-6">
          <h2 className="text-lg font-semibold">How BAT works</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--bat-text-muted)" }}>
            Start from chat, watch activity updates live, open evidence from the library, and approve changes before
            they apply. BAT can run manually with you or autonomously with guardrails.
          </p>
        </article>
      </div>
    </section>
  );
}
