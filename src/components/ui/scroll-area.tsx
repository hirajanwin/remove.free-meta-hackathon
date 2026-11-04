"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type Ref,
} from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";
import { useTouchPrimary } from "@/hooks/use-touch-primary";

const ScrollAreaContext = createContext<boolean>(false);
const ScrollbarVisibleContext = createContext<boolean>(true);
const SCROLL_LINGER_MS = 600;

type Orientation = "vertical" | "horizontal" | "both";

interface ScrollAreaProps
  extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  viewportClassName?: string;
  orientation?: Orientation;
  /**
   * Props for the scrolling element itself, not the wrapper.
   *
   * Needed because the thing that scrolls is the thing that has to be
   * focusable: a scroll region a keyboard user cannot reach can only be
   * scrolled with a pointer. Putting `tabIndex` on the Root would focus a
   * wrapper that does not scroll.
   */
  viewportProps?: ComponentPropsWithoutRef<"div">;
  /**
   * A ref to the scrolling element.
   *
   * The Root's own ref points at the wrapper. Anything that needs the element
   * that actually scrolls — a portal target, a scroll-position read — needs
   * this one instead.
   */
  viewportRef?: Ref<HTMLDivElement>;
}

const ScrollArea = forwardRef<
  ComponentRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(
  (
    {
      className,
      children,
      scrollHideDelay: _scrollHideDelay,
      viewportClassName,
      orientation = "vertical",
      viewportProps,
      viewportRef,
      ...props
    },
    ref
  ) => {
    // className has to be merged rather than spread, or a caller passing one
    // silently drops `size-full` off the viewport — which stops it being a
    // scroll container at all: it grows to fit its content and the overflow is
    // clipped by whatever ancestor has overflow-hidden, with no scrollbar and
    // no way to reach the rest of the page.
    const { className: viewportPropsClassName, ...viewportRest } =
      viewportProps ?? {};
    void viewportPropsClassName;

    const isTouch = useTouchPrimary();
    const [hovering, setHovering] = useState(false);
    const [scrolling, setScrolling] = useState(false);
    const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
      () => () => {
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      },
      []
    );

    const handleScroll = () => {
      setScrolling(true);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => setScrolling(false), SCROLL_LINGER_MS);
    };

    return (
      <ScrollAreaContext.Provider value={isTouch}>
        {isTouch ? (
          <div
            ref={ref}
            role="group"
            data-slot="scroll-area"
            aria-roledescription="scroll area"
            className={cn("relative overflow-hidden", className)}
            {...props}
          >
            <div
              data-slot="scroll-area-viewport"
              className={cn(
                "size-full rounded-[inherit]",
                orientation === "vertical" && "overflow-y-auto",
                orientation === "horizontal" && "overflow-x-auto",
                orientation === "both" && "overflow-auto",
                viewportClassName,
                viewportProps?.className
              )}
              tabIndex={0}
              ref={viewportRef}
              {...viewportRest}
            >
              {children}
            </div>
          </div>
        ) : (
          <ScrollbarVisibleContext.Provider value={hovering || scrolling}>
            <ScrollAreaPrimitive.Root
              ref={ref}
              data-slot="scroll-area"
              type="always"
              onPointerEnter={() => setHovering(true)}
              onPointerLeave={() => setHovering(false)}
              className={cn("relative overflow-hidden", className)}
              {...props}
            >
              <ScrollAreaPrimitive.Viewport
                data-slot="scroll-area-viewport"
                onScroll={handleScroll}
                className={cn(
                  "size-full rounded-[inherit]",
                  // Focus is on the element that scrolls, and the ring is inset
                  // because the Root clips its overflow — an outset one would be
                  // drawn and then cut off, which is how a focusable region ends
                  // up looking like a silent tab stop.
                  "outline-none focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring,#6B97FF)]",
                  viewportClassName,
                  viewportProps?.className
                )}
                // The touch branch has always had this; the Radix branch never
                // did, so any ScrollArea that actually overflowed on a
                // pointer device was unreachable by keyboard. It went unnoticed
                // because the tables that overflow only do so at narrow widths,
                // and a narrow window on a desktop browser is not a touch
                // device — so the branch with the bug is exactly the branch a
                // hand-run mobile check never exercised. The route harness
                // caught it on its first run.
                tabIndex={0}
                ref={viewportRef}
                {...viewportRest}
              >
                {children}
              </ScrollAreaPrimitive.Viewport>
              {orientation !== "horizontal" && <ScrollBar orientation="vertical" />}
              {orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
              {orientation === "both" && <ScrollAreaPrimitive.Corner />}
            </ScrollAreaPrimitive.Root>
          </ScrollbarVisibleContext.Provider>
        )}
      </ScrollAreaContext.Provider>
    );
  }
);
ScrollArea.displayName = "ScrollArea";

const ScrollBar = forwardRef<
  ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => {
  const isTouch = useContext(ScrollAreaContext);
  const visible = useContext(ScrollbarVisibleContext);
  const shape = useShape();

  if (isTouch) return null;

  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      data-slot="scroll-area-scrollbar"
      data-visible={visible ? "" : undefined}
      className={cn(
        "group/scrollbar z-20 flex touch-none select-none",
        "opacity-0 transition-opacity duration-80 ease-out delay-160",
        "data-[visible]:opacity-100 data-[visible]:duration-160 data-[visible]:delay-0",
        "pointer-events-none data-[visible]:pointer-events-auto",
        orientation === "vertical" && "h-full w-2.5",
        orientation === "horizontal" && "h-2.5 w-full flex-col",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative bg-muted-foreground/20 transition-[background-color,width,height] duration-160 ease-in-out",
          "group-hover/scrollbar:bg-muted-foreground/35 active:!bg-muted-foreground/50",
          shape.bg,
          orientation === "vertical" &&
            "mx-auto my-1 w-1 -translate-x-0.5 group-hover/scrollbar:w-1.5",
          orientation === "horizontal" &&
            "my-auto mx-1 h-1 -translate-y-0.5 group-hover/scrollbar:h-1.5"
        )}
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
});
ScrollBar.displayName = "ScrollBar";

export { ScrollArea, ScrollBar };
export type { ScrollAreaProps };
