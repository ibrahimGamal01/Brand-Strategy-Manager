import Link from "next/link";
import { BrandMark } from "@/components/layout/brand-mark";

const links = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
  { href: "/about", label: "About" }
];

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b backdrop-blur-sm" style={{ borderColor: "var(--bat-border)", background: "color-mix(in srgb, var(--bat-bg-soft) 85%, transparent)" }}>
      <div className="bat-shell flex items-center justify-between py-4">
        <Link href="/">
          <BrandMark />
        </Link>
        <nav className="hidden items-center gap-5 text-sm md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="transition-opacity hover:opacity-70">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="rounded-full px-4 py-2 text-sm" style={{ border: "1px solid var(--bat-border)" }}>
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
