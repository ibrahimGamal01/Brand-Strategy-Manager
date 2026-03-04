import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Pill({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("bat-chip", className)} {...props} />;
}
