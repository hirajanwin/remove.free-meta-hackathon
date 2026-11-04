"use client";

import {
  forwardRef,
  useState,
  useCallback,
  type HTMLAttributes,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { useSize, type SizeVariant } from "@/lib/size-context";

type InputCopyVariant = "icon" | "button";
type InputCopyAlign = "right" | "left";

export interface InputCopyProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  value: string;
  label?: string;
  onCopy?: () => void;
  disabled?: boolean;
  variant?: InputCopyVariant;
  align?: InputCopyAlign;
  size?: SizeVariant;
}

const InputCopy = forwardRef<HTMLDivElement, InputCopyProps>(
  (
    {
      value,
      label,
      onCopy,
      disabled = false,
      variant = "icon",
      align = "right",
      size,
      className,
      ...props
    },
    ref
  ) => {
    const [copied, setCopied] = useState(false);
    const shape = useShape();
    const sizeClasses = useSize(size);

    const handleCopy = useCallback(async () => {
      if (disabled || copied) return;
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        onCopy?.();
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error("Failed to copy:", e);
      }
    }, [value, disabled, copied, onCopy]);

    const isButton = variant === "button";

    const copyTrigger = (
      <button
        type="button"
        onClick={handleCopy}
        disabled={disabled}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
        className={cn(
          "relative z-10 flex items-center justify-center cursor-pointer select-none transition-colors duration-80 outline-none",
          isButton
            ? "px-2.5 h-6 text-[12px] gap-1.5 font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-95"
            : "size-6 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-hover active:bg-active active:scale-90",
          disabled && "opacity-50 pointer-events-none"
        )}
        style={{ fontVariationSettings: fontWeights.medium }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.span
              key="copied"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={spring.fast}
              className="flex items-center gap-1 text-ok font-medium"
            >
              <Check size={14} strokeWidth={2} />
              {isButton && <span>Copied</span>}
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={spring.fast}
              className="flex items-center gap-1"
            >
              <Copy size={14} strokeWidth={1.5} />
              {isButton && <span>Copy</span>}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    );

    return (
      <div ref={ref} className={cn("flex flex-col gap-1 w-full", className)} {...props}>
        {label && (
          <span
            className="text-[12px] text-muted-foreground font-medium [text-box:trim-both_cap_alphabetic]"
            style={{ fontVariationSettings: fontWeights.medium }}
          >
            {label}
          </span>
        )}
        <div
          className={cn(
            "relative flex items-center w-full px-2.5 bg-muted/40 border border-border/60 transition-colors duration-80 focus-within:border-border focus-within:ring-1 focus-within:ring-[color:var(--focus-ring,#6B97FF)]",
            sizeClasses.control,
            shape.input
          )}
        >
          {align === "left" && <div className="mr-1.5">{copyTrigger}</div>}

          <input
            type="text"
            readOnly
            value={value}
            disabled={disabled}
            aria-label={label || "Text to copy"}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className={cn(
              "w-full bg-transparent font-mono outline-none text-foreground select-all",
              sizeClasses.text
            )}
          />

          {align === "right" && <div className="ml-1.5">{copyTrigger}</div>}
        </div>
      </div>
    );
  }
);

InputCopy.displayName = "InputCopy";

export { InputCopy };
export default InputCopy;
