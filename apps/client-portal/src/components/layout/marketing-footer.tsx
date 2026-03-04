import Link from "next/link";
import { BrandMark } from "@/components/layout/brand-mark";

export function MarketingFooter() {
  return (
    <footer className="mt-16 border-t border-[color:var(--bat-border-subtle)] pb-10 pt-8 md:mt-24">
      <div className="bat-shell grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="space-y-2">
          <BrandMark compact />
          <p className="max-w-md text-sm bat-text-muted">
            BAT keeps strategy execution grounded in evidence, approvals, and transparent activity.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/pricing" className="bat-button bat-button-ghost min-h-9 px-3 py-1.5 text-xs">
            Pricing
          </Link>
          <Link href="/security" className="bat-button bat-button-ghost min-h-9 px-3 py-1.5 text-xs">
            Security
          </Link>
          <Link href="/about" className="bat-button bat-button-ghost min-h-9 px-3 py-1.5 text-xs">
            About
          </Link>
        </div>
      </div>
    </footer>
  );
}
