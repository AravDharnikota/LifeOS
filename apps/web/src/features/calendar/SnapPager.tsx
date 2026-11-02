import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Three-page horizontal carousel (previous, current, next) with mandatory scroll snapping.
 * When a swipe settles on a neighbour, `onPage(delta)` fires and the pager re-centres in the same
 * paint, so the parent only has to move its "current" value. Keyboard and button navigation simply
 * change the content in place.
 */
export function SnapPager({ render, onPage, className, disabled }: { render: (offset: -1 | 0 | 1) => ReactNode; onPage: (delta: -1 | 1) => void; className?: string; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [gen, setGen] = useState(0);
  const settling = useRef<number | null>(null);
  const busy = useRef(false);

  const recenter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const prev = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollLeft = el.clientWidth;
    el.style.scrollBehavior = prev;
  }, []);

  useLayoutEffect(() => {
    recenter();
    busy.current = false;
  }, [gen, recenter]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(recenter);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recenter]);

  const settle = useCallback(() => {
    const el = ref.current;
    if (!el || busy.current) return;
    const w = el.clientWidth;
    if (!w) return;
    const idx = Math.round(el.scrollLeft / w);
    if (Math.abs(el.scrollLeft - idx * w) > 2) return; // still moving
    if (idx === 1) return;
    busy.current = true;
    onPage(idx === 0 ? -1 : 1);
    setGen((g) => g + 1);
  }, [onPage]);

  const onScroll = () => {
    if (settling.current) window.clearTimeout(settling.current);
    settling.current = window.setTimeout(settle, 90);
  };

  return (
    <div ref={ref} onScroll={onScroll} onScrollEnd={settle} className={cn("flex overflow-x-auto overflow-y-hidden no-scrollbar snap-x snap-mandatory", disabled && "overflow-x-hidden", className)} style={{ overscrollBehaviorX: "contain" }}>
      {([-1, 0, 1] as const).map((o) => (
        <div key={o} className="w-full shrink-0 snap-start snap-always h-full">
          {render(o)}
        </div>
      ))}
    </div>
  );
}
