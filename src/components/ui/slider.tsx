"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  AnimatePresence,
  type MotionValue,
} from "framer-motion";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { useShape } from "@/lib/shape-context";
import { useSizeVariant, type SizeVariant } from "@/lib/size-context";
import { fontWeights } from "@/lib/font-weight";

export interface SliderProps {
  value?: number[] | number;
  defaultValue?: number[] | number;
  onValueChange?: (value: number[]) => void;
  onChange?: (value: number) => void;
  label?: string;
  formatValue?: (val: number) => string;
  size?: SizeVariant;
  variant?: "scrubber" | "compact";
  showValue?: boolean;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  (
    {
      className,
      value,
      defaultValue,
      onValueChange,
      onChange,
      label,
      formatValue = (v) => `${v}`,
      size,
      variant = "scrubber",
      showValue = true,
      min = 0,
      max = 100,
      step = 1,
      disabled = false,
    },
    ref
  ) => {
    const shape = useShape();
    const resolvedSize = useSizeVariant(size);
    const isCompact = resolvedSize === "compact";

    // Extract scalar numeric value
    const currentValue =
      Array.isArray(value)
        ? value[0]
        : typeof value === "number"
        ? value
        : Array.isArray(defaultValue)
        ? defaultValue[0]
        : defaultValue ?? min;

    const emitChange = React.useCallback(
      (newVal: number) => {
        if (onValueChange) onValueChange([newVal]);
        if (onChange) onChange(newVal);
      },
      [onValueChange, onChange]
    );

    // ─────────────────────────────────────────────────────────────
    // COMPACT SLIDER VARIANT (Official Fluid Functionalism Compact)
    // ─────────────────────────────────────────────────────────────
    if (variant === "compact") {
      const fillPct = max === min ? 0 : Math.max(0, Math.min(100, ((currentValue - min) / (max - min)) * 100));

      return (
        <div className={cn("w-full flex flex-col gap-1.5 select-none", className)}>
          {(label || showValue) && (
            <div className="flex items-center justify-between text-[12px]">
              {label && (
                <span className="text-muted-foreground font-medium [text-box:trim-both_cap_alphabetic]">
                  {label}
                </span>
              )}
              {showValue && (
                <span className="tabular-nums text-foreground/80 font-mono text-[11px]">
                  {formatValue(currentValue)}
                </span>
              )}
            </div>
          )}

          <SliderPrimitive.Root
            value={[currentValue]}
            defaultValue={defaultValue ? (Array.isArray(defaultValue) ? defaultValue : [defaultValue]) : undefined}
            onValueChange={(vals) => emitChange(vals[0])}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            className={cn(
              "relative flex w-full touch-none select-none items-center group cursor-pointer",
              isCompact ? "h-6" : "h-7"
            )}
          >
            <SliderPrimitive.Track
              className={cn(
                // Same surface language as TabsSubtle: a recessed surface-3
                // trough with the inset ring, so the sliders and the segmented
                // controls beside them read as one control family. The old
                // treatment was a transparent box with a hard 1px border, which
                // was the only outlined control in the panel.
                "relative w-full grow overflow-hidden bg-surface-3 shadow-surface-1 transition-colors",
                isCompact ? "h-4 rounded-full" : "h-5 rounded-full"
              )}
            >
              <div
                // --selected, the token the design system defines for a filled
                // selection. A surface step cannot do this job: the light ramp
                // is flat white above step 2, so bg-surface-8 on a surface-3
                // trough was white on white. --selected carries a real value in
                // both themes (#D4D4D4 / #525252) for that reason.
                className="absolute h-full bg-selected transition-[width] duration-80"
                style={{ width: `${fillPct}%` }}
              />
            </SliderPrimitive.Track>

            <SliderPrimitive.Thumb
              aria-label={label || "Slider"}
              className={cn(
                "block rounded-full bg-foreground shadow-[0_1px_2px_rgba(0,0,0,0.1)] transition-transform duration-80 outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] disabled:pointer-events-none disabled:opacity-50",
                isCompact ? "size-3.5 hover:scale-110 active:scale-95" : "size-4 hover:scale-110 active:scale-95"
              )}
            />
          </SliderPrimitive.Root>
        </div>
      );
    }

    // ─────────────────────────────────────────────────────────────
    // FLUID FUNCTIONALISM CHUNKY SCRUBBER (Official Specification)
    // ─────────────────────────────────────────────────────────────
    const containerRef = React.useRef<HTMLDivElement>(null);
    const dragging = React.useRef(false);
    const handleDragging = React.useRef(false);
    const [isHovered, setIsHovered] = React.useState(false);
    const [isPressed, setIsPressed] = React.useState(false);
    const [isFocused, setIsFocused] = React.useState(false);
    const [hoverPreview, setHoverPreview] = React.useState<{
      left: number;
      width: number;
      snappedValue: number;
      cursorX: number;
    } | null>(null);
    const [showHoverTooltip, setShowHoverTooltip] = React.useState(false);
    const hoverDelayRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Show hover tooltip after 100ms delay (matches FF specification)
    React.useEffect(() => {
      if (isHovered) {
        hoverDelayRef.current = setTimeout(() => setShowHoverTooltip(true), 100);
      } else {
        if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current);
        setShowHoverTooltip(false);
      }
      return () => {
        if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current);
      };
    }, [isHovered]);

    // Fill motion value
    const fillPercent = useMotionValue(
      max === min ? 0 : Math.max(0, Math.min(1, (currentValue - min) / (max - min)))
    );
    // Small offset when value is at min so the handle line stays visible
    const zeroTarget = 17;
    const zeroOffset = useMotionValue(currentValue === min ? zeroTarget : 0);

    const fillWidthStyle = useTransform(fillPercent, (p) => `${p * 100}%`);
    const handleLeftStyle = useTransform(
      [fillPercent, zeroOffset] as MotionValue<number>[],
      ([p, zo]) => `calc(${(p as number) * 100}% - 8px + ${zo as number}px)`
    );
    const handleLineLeftStyle = useTransform(
      [fillPercent, zeroOffset] as MotionValue<number>[],
      ([p, zo]) => `calc(${(p as number) * 100}% - 9px + ${zo as number}px)`
    );

    // Sync fill on programmatic value change
    React.useEffect(() => {
      if (dragging.current || handleDragging.current) return;
      const percent = max === min ? 0 : Math.max(0, Math.min(1, (currentValue - min) / (max - min)));
      animate(fillPercent, percent, spring.fast);
      animate(zeroOffset, currentValue === min ? zeroTarget : 0, spring.fast);
    }, [currentValue, min, max, fillPercent, zeroOffset, zeroTarget]);

    const computeHoverPreview = React.useCallback(
      (clientX: number) => {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const w = el.clientWidth;
        if (w <= 0 || rect.width <= 0) return;

        const scale = rect.width / el.offsetWidth;
        const borderLeftLayout = (el.offsetWidth - w) / 2;
        const visualX = clientX - rect.left;
        const layoutX = visualX / scale - borderLeftLayout;
        const clamped = Math.max(0, Math.min(w, layoutX));

        const raw = min + (clamped / w) * (max - min);
        const snappedVal = Math.max(min, Math.min(max, Math.round((raw - min) / step) * step + min));
        const snappedPercent = max === min ? 0 : (snappedVal - min) / (max - min);
        const snappedX = snappedPercent * w;

        const currentPercent = fillPercent.get();
        const handleX = currentPercent * w;

        const edgeX = snappedVal === min ? 0 : snappedVal === max ? w : snappedX;
        const left = Math.min(handleX, edgeX);
        const width = Math.abs(edgeX - handleX);
        setHoverPreview({ left, width, snappedValue: snappedVal, cursorX: snappedX });
      },
      [min, max, step, fillPercent]
    );

    const getValueFromX = React.useCallback(
      (clientX: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return min;
        const x = clientX - rect.left;
        const clamped = Math.max(0, Math.min(rect.width, x));
        const raw = min + (clamped / rect.width) * (max - min);
        const snapped = Math.round((raw - min) / step) * step + min;
        return Math.max(min, Math.min(max, snapped));
      },
      [min, max, step]
    );

    const handlePointerDown = React.useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (disabled) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        dragging.current = true;
        setIsPressed(true);
        const newVal = getValueFromX(e.clientX);
        emitChange(newVal);
        const newPercent = Math.max(0, Math.min(1, (newVal - min) / (max - min)));
        animate(fillPercent, newPercent, spring.fast);
        animate(zeroOffset, newVal === min ? zeroTarget : 0, spring.fast);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      },
      [disabled, getValueFromX, emitChange, fillPercent, zeroOffset, zeroTarget, min, max]
    );

    const handlePointerMove = React.useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging.current) return;
        const newVal = getValueFromX(e.clientX);
        emitChange(newVal);
        const newPercent = Math.max(0, Math.min(1, (newVal - min) / (max - min)));
        fillPercent.set(newPercent);
        animate(zeroOffset, newVal === min ? zeroTarget : 0, spring.fast);
      },
      [getValueFromX, emitChange, fillPercent, zeroOffset, zeroTarget, min, max]
    );

    const handlePointerUp = React.useCallback(() => {
      dragging.current = false;
      setIsPressed(false);
      setHoverPreview(null);
    }, []);

    // Resize handle drag handlers (direct cursor position)
    const handleResizePointerDown = React.useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (disabled) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        handleDragging.current = true;
        setIsPressed(true);
        const newVal = getValueFromX(e.clientX);
        emitChange(newVal);
        fillPercent.set(Math.max(0, Math.min(1, (newVal - min) / (max - min))));
        animate(zeroOffset, newVal === min ? zeroTarget : 0, spring.fast);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      },
      [disabled, getValueFromX, emitChange, fillPercent, zeroOffset, zeroTarget, min, max]
    );

    const handleResizePointerMove = React.useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (!handleDragging.current) return;
        const newVal = getValueFromX(e.clientX);
        emitChange(newVal);
        fillPercent.set(Math.max(0, Math.min(1, (newVal - min) / (max - min))));
        animate(zeroOffset, newVal === min ? zeroTarget : 0, spring.fast);
      },
      [getValueFromX, emitChange, fillPercent, zeroOffset, zeroTarget, min, max]
    );

    const handleResizePointerUp = React.useCallback(() => {
      handleDragging.current = false;
      setIsPressed(false);
      setHoverPreview(null);
    }, []);

    const isActive = isHovered || isFocused;

    return (
      <div
        ref={ref}
        className={cn("relative w-full touch-none select-none", className)}
        onPointerEnter={() => {
          if (!disabled) setIsHovered(true);
        }}
        onPointerLeave={() => {
          if (!disabled) {
            setIsHovered(false);
            setHoverPreview(null);
          }
        }}
        onMouseMove={(e) => {
          if (disabled || dragging.current || handleDragging.current) return;
          computeHoverPreview(e.clientX);
        }}
      >
        {/* Extended hit area — 8px beyond each edge */}
        <div
          className="absolute cursor-ew-resize"
          style={{ left: -8, right: -8, top: 0, bottom: 0 }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        {/* Hover value tooltip — outside overflow-hidden container */}
        <AnimatePresence>
          {hoverPreview && showHoverTooltip && !isPressed && (
            <motion.div
              key="hover-tooltip"
              className="absolute -translate-x-1/2 pointer-events-none z-20"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4, transition: spring.fast.exit }}
              transition={spring.fast}
              style={{
                left: hoverPreview.cursorX,
                top: -30,
              }}
            >
              <span
                className={cn(
                  "text-[12px] text-background tabular-nums whitespace-nowrap bg-foreground px-2 py-1",
                  shape.bg
                )}
                style={{ fontVariationSettings: fontWeights.medium }}
              >
                {formatValue(hoverPreview.snappedValue)}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scrubber track container */}
        <motion.div
          ref={containerRef}
          className={cn(
            "relative w-full select-none touch-none border border-border overflow-hidden outline-offset-2 flex items-center gap-3 px-4 cursor-ew-resize",
            isCompact ? "h-7 text-[12px]" : "h-8 text-[13px]",
            shape.bg,
            disabled && "opacity-50 pointer-events-none"
          )}
          initial={false}
          animate={{
            outline: isFocused ? "1px solid var(--focus-ring, #6B97FF)" : "1px solid transparent",
          }}
          transition={spring.fast}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Invisible Radix Slider for keyboard navigation + a11y */}
          <SliderPrimitive.Root
            value={[currentValue]}
            onValueChange={(vals) => emitChange(vals[0])}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            className="absolute inset-0 opacity-0 pointer-events-none [&_*]:pointer-events-none"
          >
            <SliderPrimitive.Track className="w-full h-full">
              <SliderPrimitive.Range />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb
              aria-label={label || "Scrubber"}
              className="block outline-none"
              onFocus={(e) => {
                if ((e.currentTarget as HTMLElement).matches(":focus-visible")) setIsFocused(true);
              }}
              onBlur={() => setIsFocused(false)}
            />
          </SliderPrimitive.Root>

          {/* Hover preview */}
          <motion.div
            className="absolute inset-y-0 pointer-events-none z-[3]"
            initial={false}
            animate={{
              opacity: hoverPreview && !isPressed ? 1 : 0,
            }}
            transition={{ opacity: { duration: spring.moderate.duration } }}
            style={{
              left: hoverPreview ? hoverPreview.left : 0,
              width: hoverPreview ? hoverPreview.width : 0,
              backgroundColor: "color-mix(in srgb, var(--color-accent, hsl(var(--accent))) 40%, transparent)",
            }}
          />

          {/* Scrubber: fill */}
          <motion.div
            className="absolute left-0 top-0 bottom-0 pointer-events-none"
            style={{
              width: fillWidthStyle,
              backgroundColor: "var(--active)",
            }}
          />

          {/* Scrubber: handle line */}
          <motion.div
            className="absolute rounded-full pointer-events-none z-10"
            initial={false}
            animate={{
              top: isActive ? 7 : 8,
              bottom: isActive ? 7 : 8,
              backgroundColor: isFocused
                ? "hsl(var(--foreground))"
                : isHovered
                ? "color-mix(in srgb, hsl(var(--foreground)) 50%, transparent)"
                : "color-mix(in srgb, hsl(var(--foreground)) 25%, transparent)",
            }}
            transition={spring.fast}
            style={{
              left: handleLineLeftStyle,
              width: 2,
            }}
          />

          {/* Scrubber: label */}
          {label && (
            <motion.span
              className="text-[13px] shrink-0 z-10 [text-box:trim-both_cap_alphabetic] select-none pointer-events-none"
              initial={false}
              animate={{ color: isActive ? "hsl(var(--foreground))" : "var(--muted-foreground)" }}
              transition={spring.fast}
              style={{ fontVariationSettings: fontWeights.medium }}
            >
              {label}
            </motion.span>
          )}

          {/* Scrubber: flex-1 spacer + value */}
          {showValue && (
            <>
              <div className="flex-1" />
              <motion.span
                className="text-[13px] shrink-0 tabular-nums text-right z-10 [text-box:trim-both_cap_alphabetic] select-none pointer-events-none"
                initial={false}
                animate={{ color: isActive ? "hsl(var(--foreground))" : "var(--muted-foreground)" }}
                transition={spring.fast}
                style={{ minWidth: `${String(formatValue(max)).length}ch` }}
              >
                {formatValue(currentValue)}
              </motion.span>
            </>
          )}

          {/* Resize handle (scrubber only) */}
          <motion.div
            className="absolute top-0 bottom-0 w-2 cursor-ew-resize z-20"
            style={{ left: handleLeftStyle }}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
          />
        </motion.div>
      </div>
    );
  }
);

Slider.displayName = "Slider";

export { Slider };
