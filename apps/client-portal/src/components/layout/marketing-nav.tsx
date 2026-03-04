import Link from "next/link";
import { BrandMark } from "@/components/layout/brand-mark";

const links = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
  { href: "/about", label: "About" },
];

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--bat-border-subtle)] bg-[color:color-mix(in_srgb,var(--bat-bg-soft)_84%,transparent)] backdrop-blur">
      <div className="bat-shell flex min-h-18 items-center justify-between gap-3 py-3">
        <Link href="/" className="shrink-0">
          <BrandMark />
        </Link>

        <nav className="hidden items-center gap-2 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="bat-button bat-button-ghost min-h-9 px-3 py-1.5 text-xs"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/login" className="bat-button bat-button-secondary min-h-9 px-4 py-1.5 text-xs">
            Log in
          </Link>
          <Link href="/signup" className="bat-button bat-button-primary min-h-9 px-4 py-1.5 text-xs">
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
