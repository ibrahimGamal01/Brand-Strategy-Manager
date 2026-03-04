const blocks = [
  {
    title: "Why BAT exists",
    text: "Marketing teams juggle disconnected tools, unclear ownership, and low confidence in recommendations. BAT centralizes execution in one conversation.",
  },
  {
    title: "How BAT works",
    text: "Start from chat, watch activity updates, open evidence, and approve changes before they apply. BAT can run with you or autonomously with guardrails.",
  },
];

export default function AboutPage() {
  return (
    <section className="bat-shell py-10 md:py-16">
      <div className="bat-panel space-y-4 p-7 md:p-9">
        <p className="bat-chip">About BAT</p>
        <h1 className="bat-heading-lg">A client-ready agency operating layer</h1>
        <p className="max-w-3xl text-sm bat-text-muted md:text-base">
          BAT is designed for teams that need transparent strategy execution with context, not disconnected outputs.
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {blocks.map((block) => (
          <article key={block.title} className="bat-panel p-6">
            <h2 className="bat-heading-sm">{block.title}</h2>
            <p className="mt-2 text-sm bat-text-muted">{block.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
