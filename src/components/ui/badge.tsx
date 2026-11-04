"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import { fontWeights } from "@/lib/font-weight";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium transition-colors select-none",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background shadow-xs",
        secondary:
          "bg-muted/80 text-foreground border border-border/40",
        destructive:
          "bg-destructive/15 text-destructive border border-destructive/20",
        outline:
          "text-foreground border border-border/60 bg-transparent",
        success:
          "bg-ok/15 text-ok border border-ok/20",
        warning:
          "bg-warn/15 text-warn border border-warn/20",
        info:
          "bg-surface-3 text-foreground shadow-surface-1",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  const shape = useShape();

  return (
    <div
      className={cn(badgeVariants({ variant }), shape.item, className)}
      style={{ fontVariationSettings: fontWeights.medium }}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full shrink-0",
            variant === "success" && "bg-ok animate-pulse",
            variant === "warning" && "bg-warn",
            variant === "destructive" && "bg-destructive",
            variant === "info" && "bg-blue-500",
            (!variant || variant === "default") && "bg-background",
            variant === "secondary" && "bg-foreground/50",
            variant === "outline" && "bg-foreground/50"
          )}
        />
      )}
      <span className="[text-box:trim-both_cap_alphabetic]">{children}</span>
    </div>
  );
}

export { Badge, badgeVariants };
