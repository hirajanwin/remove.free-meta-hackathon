"use client";

import {
  forwardRef,
  type ReactElement,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import { useSizeVariant, type SizeVariant } from "@/lib/size-context";
import { type IconComponent } from "@/lib/icon-context";

type ButtonVariant =
  | "default"
  | "primary"
  | "secondary"
  | "outline"
  | "tertiary"
  | "ghost"
  | "destructive"
  | "link";

type ButtonSize =
  | "default"
  | "compact"
  | "sm"
  | "lg"
  | "icon"
  | "icon-compact";

const buttonVariants = cva(
  "group relative inline-flex items-center justify-center [text-box:trim-both_cap_alphabetic] select-none cursor-pointer outline-none transition-all duration-80 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45 disabled:scale-100",
  {
    variants: {
      variant: {
        // Primary reads as the most raised thing in its container rather than
        // the brightest: surface-5 with the full inset ring and a drop, hover
        // steps to surface-6, press flattens the shadow instead of dimming.
        // That is the same vocabulary as the active tab pill (surface-5 on
        // surface-3), so a button and a segmented control agree.
        default:
          "bg-surface-5 text-foreground shadow-surface-3 hover:bg-surface-6 active:bg-surface-5 active:shadow-surface-1",
        primary:
          "bg-surface-5 text-foreground shadow-surface-3 hover:bg-surface-6 active:bg-surface-5 active:shadow-surface-1",
        secondary:
          "bg-surface-3 text-foreground shadow-surface-1 hover:bg-surface-4 active:bg-surface-3 active:shadow-surface-1",
        outline:
          "bg-transparent text-foreground shadow-[0_0_0_1px_hsl(var(--border)),inset_0_0_0_0px_hsl(var(--border))] hover:bg-hover active:bg-active active:shadow-[0_0_0_0px_hsl(var(--border)),inset_0_0_0_1px_hsl(var(--border))]",
        tertiary:
          "bg-transparent text-foreground shadow-[0_0_0_1px_hsl(var(--border)),inset_0_0_0_0px_hsl(var(--border))] hover:bg-hover active:bg-active active:shadow-[0_0_0_0px_hsl(var(--border)),inset_0_0_0_1px_hsl(var(--border))]",
        ghost:
          "bg-transparent text-muted-foreground hover:text-foreground hover:bg-hover active:bg-active shadow-[0_0_0_1px_transparent]",
        // The one variant that was still a filled colour slab, with a
        // shadow-sm from outside the 1-8 scale. Every other variant here moved
        // to the surface ladder in the aesthetic pass, and the theme comments
        // say state is separated by elevation rather than by colour — a red
        // slab is precisely the treatment `primary` was stripped of. It also
        // did not pass: white on the dark theme's #e75555 is 3.6:1.
        destructive:
          "bg-surface-3 text-destructive shadow-surface-1 hover:bg-destructive/15 active:bg-destructive/20 active:shadow-surface-1",
        link: "text-primary underline-offset-4 hover:underline !p-0 !h-auto",
      },
      size: {
        default: "h-9 px-3.5 text-[13px] gap-2",
        compact: "h-7 px-2.5 text-[12px] gap-1.5",
        sm: "h-7 px-2.5 text-[12px] gap-1.5",
        lg: "h-10 px-5 text-[14px] gap-2.5",
        icon: "size-9 p-0 [&_svg]:size-4",
        "icon-compact": "size-7 p-0 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  active?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size,
      asChild = false,
      loading = false,
      active = false,
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const shape = useShape();
    const contextSize = useSizeVariant();

    // Map size prop or fallback to context size
    let resolvedSize: ButtonSize = "default";
    if (size) {
      resolvedSize = size as ButtonSize;
    } else if (contextSize === "compact") {
      resolvedSize = "compact";
    }

    const isIconOnly = resolvedSize === "icon" || resolvedSize === "icon-compact";
    const isCompact = resolvedSize === "compact" || resolvedSize === "icon-compact" || resolvedSize === "sm";
    const iconSize = isCompact ? 14 : 16;

    const Comp = asChild ? Slot : "button";

    const content = (
      <>
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className={isCompact ? "size-3.5 animate-spin" : "size-4 animate-spin"}
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                pathLength="100"
                style={{
                  strokeDasharray: "25 75",
                  animation: "spinner-move 2s linear infinite, spinner-dash 3s ease-in-out infinite",
                }}
              />
            </svg>
            {!isIconOnly && (
              <>{children}</>
            )}
          </span>
        ) : (
          <>
            {LeadingIcon && !isIconOnly && (
              <LeadingIcon
                size={iconSize}
                strokeWidth={1.5}
                className="shrink-0 transition-all duration-80 group-hover:stroke-[2]"
                aria-hidden="true"
              />
            )}
            {children}
            {TrailingIcon && !isIconOnly && (
              <TrailingIcon
                size={iconSize}
                strokeWidth={1.5}
                className="shrink-0 transition-all duration-80 group-hover:stroke-[2]"
                aria-hidden="true"
              />
            )}
          </>
        )}
      </>
    );

    return (
      <Comp
        ref={ref}
        disabled={disabled || loading}
        data-active={active ? "true" : undefined}
        className={cn(
          buttonVariants({ variant, size: resolvedSize }),
          shape.button,
          className
        )}
        {...props}
      >
        {/* Under asChild, Comp is Radix Slot, which clones its single child with
            the merged props. `content` is always a Fragment, and a Fragment
            cannot take props — cloning one logs "Invalid prop supplied to
            React.Fragment" and silently drops className/disabled/handlers, so
            the element renders unstyled and still clickable when disabled.
            In asChild mode the caller supplies the element, so hand Slot the
            children directly; leading/trailing icon and loading decoration are
            then the caller's responsibility. */}
        {asChild ? children : content}
      </Comp>
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
