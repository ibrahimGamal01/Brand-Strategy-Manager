const plans = [
  {
    name: "Starter",
    price: "$99",
    subtitle: "For solo founders",
    points: ["1 workspace", "Live activity stream", "Evidence-linked answers", "PDF exports"]
  },
  {
    name: "Pro",
    price: "$299",
    subtitle: "For growth teams",
    points: ["5 workspaces", "Approvals + audit trail", "Team invites", "Priority runs"]
  },
  {
    name: "Scale",
    price: "Custom",
    subtitle: "For agencies and enterprise",
    points: ["Unlimited workspaces", "SSO & role policies", "Custom playbooks", "Dedicated support"]
  }
];

export default function PricingPage() {
  return (
    <section className="bat-shell py-14 md:py-20">
      <p className="bat-chip">Simple pricing</p>
      <h1 className="mt-4 text-4xl md:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
        Plans built for marketing operators
      </h1>
      <p className="mt-3 max-w-2xl" style={{ color: "var(--bat-text-muted)" }}>
        Start with one workspace and scale into multi-client operations. Every plan keeps chat, activity, library, and
        evidence traceability as first-class features.
      </p>

      <div className="mt-9 grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <article key={plan.name} className="bat-surface p-6">
            <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
              {plan.subtitle}
            </p>
            <h2 className="mt-1 text-2xl font-semibold">{plan.name}</h2>
            <p className="mt-2 text-3xl" style={{ fontFamily: "var(--font-display)" }}>
              {plan.price}
              {plan.price !== "Custom" ? <span className="ml-1 text-base">/ month</span> : null}
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {plan.points.map((point) => (
                <li key={point} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--bat-border)" }}>
                  {point}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-5 w-full rounded-full px-4 py-2 text-sm font-semibold"
              style={{
                background: plan.name === "Scale" ? "var(--bat-surface-muted)" : "var(--bat-accent)",
                color: plan.name === "Scale" ? "var(--bat-text)" : "white"
              }}
            >
              {plan.name === "Scale" ? "Talk to Sales" : "Start with " + plan.name}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
