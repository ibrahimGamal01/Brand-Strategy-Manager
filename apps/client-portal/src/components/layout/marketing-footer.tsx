import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="mt-20 border-t py-10" style={{ borderColor: "var(--bat-border)" }}>
      <div className="bat-shell flex flex-col gap-4 text-sm md:flex-row md:items-center md:justify-between">
        <p style={{ color: "var(--bat-text-muted)" }}>
          BAT. Evidence-grounded marketing operations for modern teams.
        </p>
        <div className="flex items-center gap-4">
          <Link href="/pricing">Pricing</Link>
          <Link href="/security">Security</Link>
          <Link href="/about">About</Link>
        </div>
      </div>
    </footer>
  );
}
