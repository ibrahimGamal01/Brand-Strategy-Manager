import Image from "next/image";
import { cn } from "@/lib/cn";

export function BrandMark({ compact = false, invert = false }: { compact?: boolean; invert?: boolean }) {
  return (
    <div className="inline-flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "grid h-10 w-10 place-items-center overflow-hidden rounded-2xl border p-1.5",
          invert
            ? "border-[color:color-mix(in_srgb,var(--bat-accent)_30%,transparent)] bg-[color:var(--bat-accent)]"
            : "border-[color:var(--bat-border)] bg-[color:var(--bat-surface)]"
        )}
      >
        <Image src="/brand/bat-monogram.svg" width={36} height={36} alt="" priority={false} />
      </span>
      {!compact ? (
        <span className="min-w-0 space-y-0.5">
          <span className="bat-heading-sm block leading-none">Brand Autopilot Terminal</span>
          <span className="block text-xs bat-text-muted">Marketing operations with evidence first</span>
        </span>
      ) : null}
    </div>
  );
}
