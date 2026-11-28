"use client";
/**
 * Zero-dependency virtualized list for large SKU and ledger collections.
 * Renders only visible rows plus overscan inside a bounded scroll viewport.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  maxHeightClass?: string;
  className?: string;
  empty?: ReactNode;
}

export function VirtualList<T>({
  items,
  itemHeight,
  getKey,
  renderItem,
  overscan = 6,
  maxHeightClass = "max-h-[62dvh]",
  className = "",
  empty,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight || 480);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) setViewportHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [items]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  if (items.length === 0) {
    return <>{empty ?? null}</>;
  }

  // For small lists, render directly without extra wrapper height overhead.
  if (items.length <= 25) {
    return (
      <div className={className}>
        {items.map((item, index) => (
          <div key={getKey(item, index)}>{renderItem(item, index)}</div>
        ))}
      </div>
    );
  }

  const totalHeight = items.length * itemHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + overscan * 2;
  const endIdx = Math.min(items.length, startIdx + visibleCount);
  const offsetY = startIdx * itemHeight;

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={`overflow-y-auto overscroll-contain ${maxHeightClass} ${className}`}
      style={{ willChange: "scroll-position" }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {items.slice(startIdx, endIdx).map((item, i) => {
            const index = startIdx + i;
            return (
              <div key={getKey(item, index)} style={{ height: itemHeight }}>
                {renderItem(item, index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
