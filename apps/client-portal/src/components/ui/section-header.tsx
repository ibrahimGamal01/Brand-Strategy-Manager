import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function SectionHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2", className)} {...props} />;
}

export function SectionEyebrow({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("bat-chip", className)} {...props} />;
}

export function SectionTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h1 className={cn("bat-heading-lg", className)} {...props} />;
}

export function SectionDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("bat-text-muted text-sm md:text-base", className)} {...props} />;
}
