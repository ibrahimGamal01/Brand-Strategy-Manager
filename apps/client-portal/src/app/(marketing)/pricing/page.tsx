import Link from "next/link";

const plans = [
  {
    name: "Starter",
    price: "$99",
    subtitle: "For solo founders",
    points: ["1 workspace", "Live activity stream", "Evidence-linked answers", "PDF exports"],
  },
  {
    name: "Pro",
    price: "$299",
    subtitle: "For growth teams",
    points: ["5 workspaces", "Approvals + audit trail", "Team invites", "Priority runs"],
  },
  {
    name: "Scale",
    price: "Custom",
    subtitle: "For agencies and enterprise",
    points: ["Unlimited workspaces", "SSO & role policies", "Custom playbooks", "Dedicated support"],
  },
];

export default function PricingPage() {
  return (
    <section className="bat-shell py-10 md:py-16">
      <div className="bat-panel space-y-3 p-7 md:p-9">
        <p className="bat-chip">Pricing</p>
        <h1 className="bat-heading-lg">Plans built for modern marketing operators</h1>
        <p className="max-w-3xl text-sm bat-text-muted md:text-base">
          Start with one workspace and scale into multi-client operations while keeping evidence traceability and
          approvals first class.
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <article key={plan.name} className="bat-panel flex h-full flex-col p-6">
            <p className="text-xs uppercase tracking-[0.08em] bat-text-faint">{plan.subtitle}</p>
            <h2 className="mt-2 bat-heading-md">{plan.name}</h2>
            <p className="mt-2 bat-heading-sm">
              {plan.price}
              {plan.price !== "Custom" ? <span className="ml-1 text-sm font-medium bat-text-muted">/ month</span> : null}
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {plan.points.map((point) => (
                <li key={point} className="bat-panel-muted rounded-xl px-3 py-2">
                  {point}
                </li>
              ))}
            </ul>
            <Link
              href={
                plan.name === "Scale"
                  ? "/signup?plan=scale&intent=sales"
                  : `/signup?plan=${encodeURIComponent(plan.name.toLowerCase())}`
              }
              className={
                plan.name === "Scale" ? "bat-button bat-button-secondary mt-5" : "bat-button bat-button-primary mt-5"
              }
            >
              {plan.name === "Scale" ? "Talk to Sales" : `Start with ${plan.name}`}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
