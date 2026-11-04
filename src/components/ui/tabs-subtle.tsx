"use client";

import {
  Children,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/size-context";
import { type IconComponent } from "@/lib/icon-context";
import { useProximityHover } from "@/hooks/use-proximity-hover";

interface TabsSubtleContextValue {
  registerTab: (index: number, element: HTMLButtonElement | null) => void;
  hoveredIndex: number | null;
  selectedIndex: number;
  idPrefix?: string;
  activeLabel?: boolean;
}

const TabsSubtleContext = createContext<TabsSubtleContextValue | null>(null);

function useTabsSubtle() {
  const ctx = useContext(TabsSubtleContext);
  if (!ctx) throw new Error("useTabsSubtle must be used within TabsSubtle");
  return ctx;
}

interface TabsSubtleProps
  extends Omit<
    HTMLAttributes<HTMLDivElement>,
    "defaultValue" | "onChange" | "onSelect"
  > {
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  idPrefix?: string;
  activeLabel?: boolean;
  size?: SizeVariant;
  children: ReactNode;
}

const TabsSubtle = forwardRef<HTMLDivElement, TabsSubtleProps>(
  (
    {
      selectedIndex = 0,
      onSelect,
      idPrefix,
      activeLabel = false,
      size,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const tabsRef = useRef<Map<number, HTMLButtonElement>>(new Map());
    const [selectedRect, setSelectedRect] = useState<{
      left: number;
      top: number;
      width: number;
      height: number;
    } | null>(null);
    const [isMeasured, setIsMeasured] = useState(false);

    const shape = useShape();
    const sizeClasses = useSize(size);

    const {
      activeIndex: hoveredIndex,
      itemRects,
      sessionRef,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef, { axis: "x" });

    const measureSelectedTab = useCallback(() => {
      const el = tabsRef.current.get(selectedIndex);
      if (el) {
        setSelectedRect({
          left: el.offsetLeft,
          top: el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        });
        setIsMeasured(true);
      }
    }, [selectedIndex]);

    const registerTab = useCallback(
      (index: number, element: HTMLButtonElement | null) => {
        if (element) {
          tabsRef.current.set(index, element);
        } else {
          tabsRef.current.delete(index);
        }
        registerItem(index, element);
        if (index === selectedIndex) {
          requestAnimationFrame(() => measureSelectedTab());
        }
      },
      [registerItem, selectedIndex, measureSelectedTab]
    );

    useEffect(() => {
      measureSelectedTab();
    }, [selectedIndex, measureSelectedTab]);

    useEffect(() => {
      const handleResize = () => {
        measureItems();
        measureSelectedTab();
      };
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, [measureItems, measureSelectedTab]);

    const contextValue = useMemo(
      () => ({
        registerTab,
        hoveredIndex,
        selectedIndex,
        idPrefix,
        activeLabel,
      }),
      [registerTab, hoveredIndex, selectedIndex, idPrefix, activeLabel]
    );

    const hoveredRect = hoveredIndex !== null ? itemRects[hoveredIndex] : null;

    const root = (
      <TabsSubtleContext.Provider value={contextValue}>
        <TabsPrimitive.Root
          value={String(selectedIndex)}
          onValueChange={(val) => onSelect?.(Number(val))}
        >
          <TabsPrimitive.List
            ref={(node) => {
              containerRef.current = node;
              if (typeof ref === "function") ref(node);
              else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
            }}
            className={cn(
              "relative inline-flex items-center select-none bg-surface-3 shadow-surface-1 p-1",
              shape.container,
              className
            )}
            onMouseEnter={handlers.onMouseEnter}
            onMouseMove={handlers.onMouseMove}
            onMouseLeave={handlers.onMouseLeave}
            {...props}
          >
            {/* Proximity hover background pill */}
            <AnimatePresence>
              {hoveredRect && (
                <motion.div
                  key={sessionRef.current}
                  className={cn("absolute bg-hover pointer-events-none", shape.bg)}
                  initial={{
                    opacity: 0,
                    left: hoveredRect.left,
                    top: hoveredRect.top,
                    width: hoveredRect.width,
                    height: hoveredRect.height,
                  }}
                  animate={{
                    opacity: 1,
                    left: hoveredRect.left,
                    top: hoveredRect.top,
                    width: hoveredRect.width,
                    height: hoveredRect.height,
                  }}
                  exit={{ opacity: 0, transition: spring.fast.exit }}
                  transition={{
                    ...spring.fast,
                    opacity: { duration: spring.fast.duration },
                  }}
                />
              )}
            </AnimatePresence>

            {/* Selected active tab pill */}
            {selectedRect && (
              <motion.div
                className={cn(
                  "absolute bg-surface-5 shadow-surface-2 pointer-events-none z-0",
                  shape.bg
                )}
                initial={false}
                animate={{
                  left: selectedRect.left,
                  top: selectedRect.top,
                  width: selectedRect.width,
                  height: selectedRect.height,
                }}
                transition={spring.moderate}
              />
            )}

            {children}
          </TabsPrimitive.List>
        </TabsPrimitive.Root>
      </TabsSubtleContext.Provider>
    );

    return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
  }
);

TabsSubtle.displayName = "TabsSubtle";

interface TabsSubtleItemProps extends HTMLAttributes<HTMLButtonElement> {
  icon?: IconComponent;
  label: string;
  index: number;
}

const TabsSubtleItem = forwardRef<HTMLButtonElement, TabsSubtleItemProps>(
  ({ icon: Icon, label, index, className, ...props }, ref) => {
    const internalRef = useRef<HTMLButtonElement | null>(null);
    const shape = useShape();
    const sizeClasses = useSize();
    const { registerTab, hoveredIndex, selectedIndex, idPrefix, activeLabel } =
      useTabsSubtle();

    useEffect(() => {
      registerTab(index, internalRef.current);
      return () => registerTab(index, null);
    }, [index, registerTab]);

    const isSelected = selectedIndex === index;
    const isActive = hoveredIndex === index || isSelected;

    return (
      <TabsPrimitive.Trigger
        ref={(node: HTMLButtonElement | null) => {
          internalRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
        }}
        value={String(index)}
        data-proximity-index={index}
        id={idPrefix ? `${idPrefix}-tab-${index}` : undefined}
        aria-controls={idPrefix ? `${idPrefix}-panel-${index}` : undefined}
        className={cn(
          "relative z-10 flex flex-1 justify-center items-center cursor-pointer bg-transparent border-none outline-none",
          sizeClasses.control,
          sizeClasses.px,
          sizeClasses.gap,
          shape.bg,
          className
        )}
        {...props}
      >
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={isActive ? 2 : 1.5}
            className={cn(
              "shrink-0 transition-[color,stroke-width] duration-80",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}
            aria-hidden="true"
          />
        )}
        {/* Ghost-span pattern, per the design system's motion guidelines:
            "State changes make text heavier, and a heavier weight is wider.
            Animate that on a bare text node and the layout reflows."

            It reflowed. Measured on the Background Type tabs, switching from
            Alpha to Gradient moved every button: Alpha -1.28px, Color -2.61px,
            Gradient +2.09px, and Blur -9.62px as flex redistributed the freed
            space. The sliding pill measures the button it is travelling to, so
            it was animating toward a target that moved while it moved.

            An invisible copy at the heaviest weight reserves the width; the
            visible copy animates on top of it in a shared grid cell. Both carry
            the text-box trim so the two boxes stay identical. */}
        <span className={cn("inline-grid whitespace-nowrap", sizeClasses.text)}>
          <span
            aria-hidden="true"
            className="col-start-1 row-start-1 invisible [text-box:trim-both_cap_alphabetic]"
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {label}
          </span>
          <span
            className={cn(
              // Named properties rather than transition-all: the whole point is
              // that geometry does not animate here.
              "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
              isActive ? "text-foreground" : "text-muted-foreground"
            )}
            style={{
              fontVariationSettings: isSelected
                ? fontWeights.semibold
                : fontWeights.normal,
            }}
          >
            {label}
          </span>
        </span>
      </TabsPrimitive.Trigger>
    );
  }
);

TabsSubtleItem.displayName = "TabsSubtleItem";

interface TabsSubtlePanelProps extends HTMLAttributes<HTMLDivElement> {
  index: number;
  selectedIndex: number;
  idPrefix: string;
  children: ReactNode;
}

const TabsSubtlePanel = forwardRef<HTMLDivElement, TabsSubtlePanelProps>(
  ({ index, selectedIndex, idPrefix, children, className, ...props }, ref) => {
    const isSelected = selectedIndex === index;

    return (
      <div
        ref={ref}
        id={`${idPrefix}-panel-${index}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${index}`}
        hidden={!isSelected}
        tabIndex={-1}
        className={cn("outline-none", className)}
        {...props}
      >
        {isSelected && children}
      </div>
    );
  }
);

TabsSubtlePanel.displayName = "TabsSubtlePanel";

export { TabsSubtle, TabsSubtleItem, TabsSubtlePanel };
export default TabsSubtle;
