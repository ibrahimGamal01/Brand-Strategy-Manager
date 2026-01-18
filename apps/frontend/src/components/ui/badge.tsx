import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground border-border",
        // Status variants
        success: "border-success/30 bg-success/20 text-success",
        warning: "border-warning/30 bg-warning/20 text-warning",
        processing: "border-processing/30 bg-processing/20 text-processing",
        pending: "border-border bg-muted text-muted-foreground",
        // Platform variants
        instagram: "border-pink-500/30 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-pink-400",
        tiktok: "border-cyan-500/30 bg-cyan-500/20 text-cyan-400",
        twitter: "border-blue-500/30 bg-blue-500/20 text-blue-400",
        linkedin: "border-blue-600/30 bg-blue-600/20 text-blue-400",
        // Sentiment variants
        positive: "border-success/30 bg-success/15 text-success",
        negative: "border-destructive/30 bg-destructive/15 text-destructive",
        neutral: "border-border bg-muted text-muted-foreground",
        // Source variants  
        google: "border-blue-500/30 bg-blue-500/20 text-blue-400",
        duckduckgo: "border-orange-500/30 bg-orange-500/20 text-orange-400",
        reddit: "border-orange-600/30 bg-orange-600/20 text-orange-400",
        trustpilot: "border-green-500/30 bg-green-500/20 text-green-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
