"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

type SizeVariant = "default" | "compact";

interface SizeClasses {
  control: string;
  text: string;
  icon: number;
  px: string;
  gap: string;
  variant: SizeVariant;
}

const sizeMap: Record<SizeVariant, SizeClasses> = {
  default: {
    control: "h-9",
    text: "text-[13px]",
    icon: 16,
    px: "px-3",
    gap: "gap-2",
    variant: "default",
  },
  compact: {
    control: "h-7",
    text: "text-[12px]",
    icon: 14,
    px: "px-2",
    gap: "gap-1.5",
    variant: "compact",
  },
};

type TypeScaleRole = "headline" | "title" | "body" | "caption";

interface TypeScaleStep {
  size: string;
  leading: string;
  tracking?: string;
  weight: string;
}

const typeScale: Record<SizeVariant, Record<TypeScaleRole, TypeScaleStep>> = {
  default: {
    headline: { size: "text-[18px]", leading: "leading-6", weight: "'wght' 550, 'opsz' 18" },
    title: { size: "text-[14px]", leading: "leading-5", weight: "'wght' 550, 'opsz' 18" },
    body: { size: "text-[13px]", leading: "leading-4", weight: "'wght' 400, 'opsz' 14" },
    caption: { size: "text-[11px]", leading: "leading-3", tracking: "tracking-wide", weight: "'wght' 450, 'opsz' 14" },
  },
  compact: {
    headline: { size: "text-[16px]", leading: "leading-5", weight: "'wght' 550, 'opsz' 18" },
    title: { size: "text-[13px]", leading: "leading-4", weight: "'wght' 550, 'opsz' 18" },
    body: { size: "text-[12px]", leading: "leading-4", weight: "'wght' 400, 'opsz' 14" },
    caption: { size: "text-[10px]", leading: "leading-3", tracking: "tracking-wide", weight: "'wght' 450, 'opsz' 14" },
  },
};

interface SizeContextValue {
  size: SizeVariant;
  classes: SizeClasses;
}

const SizeContext = createContext<SizeContextValue | null>(null);

function useSize(override?: SizeVariant): SizeClasses {
  const ctx = useContext(SizeContext);
  if (override) return sizeMap[override];
  if (!ctx) return sizeMap.default;
  return ctx.classes;
}

function useSizeVariant(override?: SizeVariant): SizeVariant {
  const ctx = useContext(SizeContext);
  if (override) return override;
  return ctx?.size ?? "default";
}

function useSizeContext() {
  const ctx = useContext(SizeContext);
  if (!ctx) throw new Error("useSizeContext must be used within a SizeProvider");
  return ctx;
}

function useTypeScale(role: TypeScaleRole, override?: SizeVariant): TypeScaleStep {
  const variant = useSizeVariant(override);
  return typeScale[variant][role];
}

function SizeProvider({
  children,
  size = "default",
}: {
  children: ReactNode;
  size?: SizeVariant;
}) {
  const value = useMemo(
    () => ({ size, classes: sizeMap[size] }),
    [size]
  );

  return <SizeContext.Provider value={value}>{children}</SizeContext.Provider>;
}

export {
  SizeProvider,
  useSize,
  useSizeVariant,
  useSizeContext,
  useTypeScale,
  sizeMap,
  typeScale,
};
export type { SizeVariant, SizeClasses, TypeScaleRole, TypeScaleStep };
