"use client";

import {
  useRef,
  useEffect,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { spring } from "@/lib/springs";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/size-context";
import { useProximityHover } from "@/hooks/use-proximity-hover";

interface TableContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
}

const TableContext = createContext<TableContextValue | null>(null);

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
  size?: SizeVariant;
}

const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ children, size, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sizeClasses = useSize(size);

    const {
      activeIndex,
      itemRects,
      sessionRef,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef, { axis: "y" });

    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    const activeRect = activeIndex !== null ? itemRects[activeIndex] : null;

    const contextValue = useMemo(
      () => ({ registerItem, activeIndex }),
      [registerItem, activeIndex]
    );

    const table = (
      <TableContext.Provider value={contextValue}>
        {/* Table owns its horizontal scroller.
            It used to be a bare `overflow-x-auto` div, which meant a caller
            that wrapped a Table in a ScrollArea got two nested scrollers and
            an inner one that no keyboard could reach — axe's
            scrollable-region-focusable, but only at narrow widths where the
            table actually overflows. Owning it here fixes every Table at once
            and makes wrapping unnecessary. */}
        <ScrollArea
          orientation="horizontal"
          className="relative"
          viewportRef={containerRef}
          viewportProps={{
            onMouseEnter: handlers.onMouseEnter,
            onMouseMove: handlers.onMouseMove,
            onMouseLeave: handlers.onMouseLeave,
          }}
        >
          {/* Proximity hover row highlight */}
          <AnimatePresence>
            {activeRect && (
              <motion.div
                key={sessionRef.current}
                className="absolute bg-hover pointer-events-none rounded-md"
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

          <table
            ref={ref}
            className={cn("w-full border-collapse", sizeClasses.text, className)}
            {...props}
          >
            {children}
          </table>
        </ScrollArea>
      </TableContext.Provider>
    );

    return size ? <SizeProvider size={size}>{table}</SizeProvider> : table;
  }
);

Table.displayName = "Table";

const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("border-b border-border/40", className)} {...props} />
));

TableHeader.displayName = "TableHeader";

const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("", className)} {...props} />
));

TableBody.displayName = "TableBody";

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  index?: number;
}

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ index, className, style, ...props }, ref) => {
    const internalRef = useRef<HTMLTableRowElement>(null);
    const ctx = useContext(TableContext);

    useEffect(() => {
      if (index === undefined || !ctx) return;
      ctx.registerItem(index, internalRef.current);
      return () => ctx.registerItem(index, null);
    }, [index, ctx]);

    const isBodyRow = index !== undefined;
    const activeIdx = ctx?.activeIndex ?? null;

    return (
      <tr
        ref={(node) => {
          (internalRef as React.MutableRefObject<HTMLTableRowElement | null>).current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLTableRowElement | null>).current = node;
        }}
        data-proximity-index={index}
        className={cn(
          "group/row relative z-10 border-b border-border/30 transition-[border-color] duration-80",
          isBodyRow && activeIdx === index && "is-active",
          className
        )}
        style={{
          ...style,
          fontVariationSettings: isBodyRow
            ? fontWeights.normal
            : fontWeights.semibold,
        }}
        {...props}
      />
    );
  }
);

TableRow.displayName = "TableRow";

const TableHead = forwardRef<
  HTMLTableCellElement,
  ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const sizeClasses = useSize();
  return (
    <th
      ref={ref}
      className={cn(
        "text-left font-semibold text-foreground/80 [text-box:trim-both_cap_alphabetic]",
        sizeClasses.variant === "compact" ? "px-2.5 py-2" : "px-3 py-2.5",
        className
      )}
      style={{ fontVariationSettings: fontWeights.semibold }}
      {...props}
    />
  );
});

TableHead.displayName = "TableHead";

const TableCell = forwardRef<
  HTMLTableCellElement,
  TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const sizeClasses = useSize();
  return (
    <td
      ref={ref}
      className={cn(
        "text-muted-foreground transition-colors duration-80 group-[.is-active]/row:text-foreground",
        sizeClasses.variant === "compact" ? "px-2.5 py-2" : "px-3 py-2.5",
        className
      )}
      {...props}
    />
  );
});

TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
