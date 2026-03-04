import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[linear-gradient(90deg,color-mix(in_srgb,var(--bat-surface-muted)_72%,transparent),color-mix(in_srgb,var(--bat-surface-contrast)_45%,transparent),color-mix(in_srgb,var(--bat-surface-muted)_72%,transparent))]",
        className
      )}
      {...props}
    />
  );
}
