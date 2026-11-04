"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type RefObject,
} from "react";

export interface ItemRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ProximityHoverOptions {
  axis?: "x" | "y" | "xy";
  measurementAttempts?: number;
  isItemDisabled?: (element: HTMLElement) => boolean;
}

export function useProximityHover(
  containerRef: RefObject<HTMLElement | null>,
  options: ProximityHoverOptions = {}
) {
  const { axis = "y", measurementAttempts = 3, isItemDisabled } = options;

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [itemRects, setItemRects] = useState<ItemRect[]>([]);
  const [isMeasured, setIsMeasured] = useState(false);

  const itemsRef = useRef<Map<number, HTMLElement>>(new Map());
  const itemRectsRef = useRef<ItemRect[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const remeasureRafIdRef = useRef<number | null>(null);
  const itemRoRef = useRef<ResizeObserver | null>(null);
  const sessionRef = useRef<number>(0);

  const measureItems = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;

    const newRects: ItemRect[] = [];
    const maxIndex = Math.max(...Array.from(itemsRef.current.keys()), -1);

    for (let i = 0; i <= maxIndex; i++) {
      const el = itemsRef.current.get(i);
      if (el) {
        newRects[i] = {
          left: el.offsetLeft,
          top: el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        };
      }
    }

    itemRectsRef.current = newRects;
    setItemRects(newRects);
    setIsMeasured(true);
    return true;
  }, [containerRef]);

  const scheduleMeasurement = useCallback(
    (attemptsRemaining: number) => {
      requestAnimationFrame(() => {
        const success = measureItems();
        if (!success && attemptsRemaining > 1) {
          scheduleMeasurement(attemptsRemaining - 1);
        }
      });
    },
    [measureItems]
  );

  const remeasure = useCallback(() => {
    if (remeasureRafIdRef.current !== null) {
      cancelAnimationFrame(remeasureRafIdRef.current);
    }
    remeasureRafIdRef.current = requestAnimationFrame(() => {
      remeasureRafIdRef.current = null;
      measureItems();
    });
  }, [measureItems]);

  const getItemRo = useCallback(() => {
    if (itemRoRef.current === null && typeof ResizeObserver !== "undefined") {
      itemRoRef.current = new ResizeObserver(() =>
        scheduleMeasurement(measurementAttempts)
      );
    }
    return itemRoRef.current;
  }, [scheduleMeasurement, measurementAttempts]);

  const registerItem = useCallback(
    (index: number, element: HTMLElement | null) => {
      if (element) {
        itemsRef.current.set(index, element);
        getItemRo()?.observe(element);
      } else {
        const previous = itemsRef.current.get(index);
        if (previous) itemRoRef.current?.unobserve(previous);
        itemsRef.current.delete(index);
      }
      remeasure();
    },
    [remeasure, getItemRo]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const container = containerRef.current;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();

        if (axis === "xy") {
          let closestIndex: number | null = null;
          let closestDistance = Infinity;
          let containingIndex: number | null = null;

          const rects = itemRectsRef.current;
          const scrollX = container.scrollLeft;
          const scrollY = container.scrollTop;
          const borderX = container.clientLeft;
          const borderY = container.clientTop;

          const scaleX =
            container.offsetWidth > 0
              ? containerRect.width / container.offsetWidth
              : 1;
          const scaleY =
            container.offsetHeight > 0
              ? containerRect.height / container.offsetHeight
              : 1;

          for (let index = 0; index < rects.length; index++) {
            const r = rects[index];
            if (!r) continue;
            const el = itemsRef.current.get(index);
            if (el && isItemDisabled?.(el)) continue;

            const left = containerRect.left + (borderX + r.left - scrollX) * scaleX;
            const top = containerRect.top + (borderY + r.top - scrollY) * scaleY;
            const width = r.width * scaleX;
            const height = r.height * scaleY;

            if (
              mouseX >= left &&
              mouseX <= left + width &&
              mouseY >= top &&
              mouseY <= top + height
            ) {
              containingIndex = index;
            }

            const dx = mouseX - (left + width / 2);
            const dy = mouseY - (top + height / 2);
            const distance = Math.hypot(dx, dy);

            if (distance < closestDistance) {
              closestDistance = distance;
              closestIndex = index;
            }
          }

          setActiveIndex(containingIndex ?? closestIndex);
          return;
        }

        const mousePos = axis === "x" ? mouseX : mouseY;
        let closestIndex: number | null = null;
        let closestDistance = Infinity;
        let containingIndex: number | null = null;

        const rects = itemRectsRef.current;
        const scrollOffset = axis === "x" ? container.scrollLeft : container.scrollTop;
        const borderOffset = axis === "x" ? container.clientLeft : container.clientTop;
        const containerEdge = axis === "x" ? containerRect.left : containerRect.top;

        const layoutSize = axis === "x" ? container.offsetWidth : container.offsetHeight;
        const visualSize = axis === "x" ? containerRect.width : containerRect.height;
        const scale = layoutSize > 0 ? visualSize / layoutSize : 1;

        for (let index = 0; index < rects.length; index++) {
          const r = rects[index];
          if (!r) continue;
          const el = itemsRef.current.get(index);
          if (el && isItemDisabled?.(el)) continue;

          const contentPos = axis === "x" ? r.left : r.top;
          const itemStart = containerEdge + (borderOffset + contentPos - scrollOffset) * scale;
          const itemSize = (axis === "x" ? r.width : r.height) * scale;
          const itemEnd = itemStart + itemSize;

          if (mousePos >= itemStart && mousePos <= itemEnd) {
            containingIndex = index;
          }

          const itemCenter = itemStart + itemSize / 2;
          const distance = Math.abs(mousePos - itemCenter);

          if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
          }
        }

        setActiveIndex(containingIndex ?? closestIndex);
      });
    },
    [axis, containerRef, isItemDisabled]
  );

  const handleMouseEnter = useCallback(() => {
    sessionRef.current += 1;
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setActiveIndex(null);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => scheduleMeasurement(measurementAttempts));
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, scheduleMeasurement, measurementAttempts]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (remeasureRafIdRef.current !== null) {
        cancelAnimationFrame(remeasureRafIdRef.current);
      }
      itemRoRef.current?.disconnect();
      itemRoRef.current = null;
    };
  }, []);

  return {
    activeIndex,
    setActiveIndex,
    itemRects,
    isMeasured,
    sessionRef,
    handlers: {
      onMouseMove: handleMouseMove,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    },
    registerItem,
    remeasure,
    measureItems,
  };
}

export function useRegisterProximityItem(
  registerItem: (index: number, element: HTMLElement | null) => void,
  index: number,
  ref: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    registerItem(index, ref.current);
    return () => registerItem(index, null);
  }, [index, registerItem, ref]);
}
