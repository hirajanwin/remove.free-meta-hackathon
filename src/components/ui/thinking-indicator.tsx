"use client";

import { forwardRef, useState, useEffect, type HTMLAttributes } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { fontWeights } from "@/lib/font-weight";
import { useSize, type SizeVariant } from "@/lib/size-context";
import { spring } from "@/lib/springs"

const infinity =
  "M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z";

const DEFAULT_WORDS = [
  "Separating foreground...",
  "Computing alpha matte...",
  "Refining fine hair edges...",
  "Polishing cutout...",
];

export interface ThinkingIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  showIcon?: boolean;
  words?: string[];
  size?: SizeVariant;
}

const ThinkingIndicator = forwardRef<HTMLDivElement, ThinkingIndicatorProps>(
  (
    {
      className,
      showIcon = true,
      words = DEFAULT_WORDS,
      size,
      ...props
    },
    ref
  ) => {
    const compactStep = useSize(size).variant === "compact";
    const [index, setIndex] = useState(0);
    const prefersReducedMotion = useReducedMotion();

    useEffect(() => {
      if (prefersReducedMotion || words.length <= 1) return;
      const interval = setInterval(() => {
        setIndex((prev) => (prev + 1) % words.length);
      }, 2400);
      return () => clearInterval(interval);
    }, [prefersReducedMotion, words.length]);

    const glyphSize = compactStep ? 18 : 22;

    return (
      <div
        ref={ref}
        role="status"
        aria-live="polite"
        // Named so an automated contrast audit can exclude it deliberately
        // rather than fail at random. The word underneath cross-fades on a
        // timer, so a sampled frame catches it at partial opacity and reads as
        // a contrast violation that does not exist in the resting state — it
        // cost several passes to work out that this was the intermittent
        // `.whitespace-nowrap` failure on /batch.
        data-slot="thinking-indicator"
        className={cn(
          "inline-flex items-center select-none",
          compactStep ? "gap-1.5 text-[12px]" : "gap-2 text-[13px]",
          className
        )}
        {...props}
      >
        {showIcon && (
          <div
            className="flex items-center justify-center shrink-0 text-foreground"
            style={{ width: glyphSize, height: glyphSize }}
          >
            {prefersReducedMotion ? (
              <svg
                width={glyphSize}
                height={glyphSize}
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d={infinity}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg
                width={glyphSize}
                height={glyphSize}
                viewBox="0 0 24 24"
                fill="none"
              >
                <motion.path
                  d={infinity}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, pathOffset: 0 }}
                  animate={{ pathLength: [0, 1, 1], pathOffset: [0, 0, 1] }}
                  transition={{
                    duration: 3.6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: [0, 0.5, 1],
                  }}
                />
              </svg>
            )}
          </div>
        )}

        <div className="relative overflow-hidden h-5 flex items-center min-w-[160px]">
          <AnimatePresence mode="wait">
            <motion.span
              key={index}
              className="text-muted-foreground font-medium whitespace-nowrap [text-box:trim-both_cap_alphabetic]"
              style={{ fontVariationSettings: fontWeights.medium }}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: spring.slow.duration }}
            >
              {words[index]}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    );
  }
);

ThinkingIndicator.displayName = "ThinkingIndicator";

export { ThinkingIndicator };
export default ThinkingIndicator;
