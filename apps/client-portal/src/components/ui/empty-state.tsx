import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bat-empty", className)} {...props} />;
}
