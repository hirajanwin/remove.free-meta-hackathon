"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/size-context";
import { type IconComponent } from "@/lib/icon-context";
import { useProximityHover } from "@/hooks/use-proximity-hover";

// ── Card Context ──────────────────────────────────────────

interface CardGroupContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
  framed: boolean;
}

const CardGroupContext = createContext<CardGroupContextValue | null>(null);

// ── CardGroup ────────────────────────────────────────────

interface CardGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  framed?: boolean;
  axis?: "x" | "y" | "xy";
  size?: SizeVariant;
}

const CardGroup = forwardRef<HTMLDivElement, CardGroupProps>(
  (
    {
      children,
      framed = false,
      axis = "xy",
      size,
      className,
      ...props
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const shape = useShape();
    const sizeClasses = useSize(size);

    const {
      activeIndex,
      itemRects,
      sessionRef,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef, { axis });

    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    const activeRect = activeIndex !== null ? itemRects[activeIndex] : null;

    const contextValue = useMemo(
      () => ({ registerItem, activeIndex, framed }),
      [registerItem, activeIndex, framed]
    );

    const group = (
      <CardGroupContext.Provider value={contextValue}>
        <div
          ref={(node) => {
            containerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }}
          className={cn("relative", className)}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          {...props}
        >
          {/* Proximity magnetic hover highlight */}
          <AnimatePresence>
            {activeRect && (
              <motion.div
                key={sessionRef.current}
                className={cn("absolute bg-hover pointer-events-none z-0", shape.bg)}
                initial={{
                  opacity: 0,
                  top: activeRect.top,
                  left: activeRect.left,
                  width: activeRect.width,
                  height: activeRect.height,
                }}
                animate={{
                  opacity: 1,
                  top: activeRect.top,
                  left: activeRect.left,
                  width: activeRect.width,
                  height: activeRect.height,
                }}
                exit={{ opacity: 0, transition: spring.fast.exit }}
                transition={{
                  ...spring.fast,
                  opacity: { duration: spring.fast.duration },
                }}
              />
            )}
          </AnimatePresence>

          {children}
        </div>
      </CardGroupContext.Provider>
    );

    return size ? <SizeProvider size={size}>{group}</SizeProvider> : group;
  }
);

CardGroup.displayName = "CardGroup";

// ── Card ─────────────────────────────────────────────────

interface CardProps extends HTMLAttributes<HTMLElement> {
  index?: number;
  /**
   * Render a real `<button>` instead of a div.
   *
   * Required whenever the card itself is the control. A div with an onClick
   * looks identical and is completely unreachable by keyboard — and because it
   * carries no role, no ARIA contract is violated, so an automated audit stays
   * silent about it.
   */
  asButton?: boolean;
}

const Card = forwardRef<HTMLElement, CardProps>(
  ({ index, asButton, className, children, ...props }, ref) => {
    const internalRef = useRef<HTMLElement | null>(null);
    const shape = useShape();
    const ctx = useContext(CardGroupContext);

    useEffect(() => {
      if (index === undefined || !ctx) return;
      ctx.registerItem(index, internalRef.current);
      return () => ctx.registerItem(index, null);
    }, [index, ctx]);

    const isHovered = ctx?.activeIndex === index;

    const Comp = (asButton ? "button" : "div") as "button";

    return (
      <Comp
        {...(asButton ? { type: "button" as const } : {})}
        ref={(node: HTMLElement | null) => {
          internalRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLElement | null>).current = node;
        }}
        data-proximity-index={index}
        className={cn(
          "relative z-10 flex flex-col rounded-xl border border-border/60 bg-card/60 backdrop-blur-[2px] p-5 shadow-sm transition-all duration-80 hover:border-border hover:bg-card/90",
          shape.item,
          isHovered && "border-border/80 shadow-md",
          // A button centres its text and shrinks to fit by default; a card
          // does neither.
          asButton && "text-left appearance-none w-full",
          className
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  }
);

Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1 pb-3", className)}
      {...props}
    />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "text-base font-semibold leading-tight tracking-tight text-foreground transition-all duration-80 [text-box:trim-both_cap_alphabetic]",
        className
      )}
      style={{ fontVariationSettings: fontWeights.semibold }}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-[13px] text-muted-foreground leading-relaxed", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex-1 py-1", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center pt-3 gap-2", className)}
      {...props}
    />
  )
);
CardFooter.displayName = "CardFooter";

const CardEyebrow = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1",
        className
      )}
      style={{ fontVariationSettings: fontWeights.semibold }}
      {...props}
    />
  )
);
CardEyebrow.displayName = "CardEyebrow";

interface CardFeatureProps {
  icon?: IconComponent;
  title: string;
  description?: string;
}

function CardFeature({ icon: Icon, title, description }: CardFeatureProps) {
  return (
    <div className="flex items-start gap-2.5 py-1">
      {Icon && (
        <div className="mt-0.5 shrink-0 size-5 flex items-center justify-center rounded bg-muted/60 text-muted-foreground">
          <Icon size={13} strokeWidth={1.5} />
        </div>
      )}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span
          className="text-[13px] text-foreground font-medium [text-box:trim-both_cap_alphabetic]"
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          {title}
        </span>
        {description && (
          <span className="text-[12px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        )}
      </div>
    </div>
  );
}

export {
  Card,
  CardGroup,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  CardEyebrow,
  CardFeature,
};
