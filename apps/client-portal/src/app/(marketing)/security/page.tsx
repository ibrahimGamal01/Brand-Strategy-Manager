const controls = [
  "Role-based access for admins and client users",
  "Workspace-level data isolation",
  "Auditable action history with reversible mutations",
  "Evidence-linked outputs to prevent unsupported claims",
  "Approval gates before high-impact mutations",
];

export default function SecurityPage() {
  return (
    <section className="bat-shell py-10 md:py-16">
      <div className="bat-panel space-y-3 p-7 md:p-9">
        <p className="bat-chip">Security</p>
        <h1 className="bat-heading-lg">Built for accountable marketing operations</h1>
        <p className="max-w-3xl text-sm bat-text-muted md:text-base">
          BAT keeps client work transparent by default with source-backed recommendations and explicit approval
          checkpoints.
        </p>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {controls.map((control) => (
          <article key={control} className="bat-panel p-5 text-sm">
            {control}
          </article>
        ))}
      </div>
    </section>
  );
}
