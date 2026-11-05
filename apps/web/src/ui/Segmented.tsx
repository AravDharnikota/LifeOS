import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { selection } from "@/lib/haptics";

export interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}

/** 32px track, 2px inset, sliding thumb (smooth spring), selection haptic. Title Case nouns only. */
export function Segmented<T extends string>({ options, value, onChange, className, size = "md" }: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const seg = el.children[idx + 1] as HTMLElement | undefined;
      if (seg) setThumb({ x: seg.offsetLeft, w: seg.offsetWidth });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [idx, options.length]);
  return (
    <div ref={ref} role="tablist" className={cn("relative grid well rounded-full p-[3px] select-none", size === "sm" ? "h-8" : "h-10", className)} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      <div className="absolute top-[3px] bottom-[3px] rounded-full bg-primary shadow-thumb" style={{ left: thumb?.x ?? 3, width: thumb?.w ?? 0, transition: "left 400ms var(--spring-snappy), width 200ms var(--ease-out)", opacity: thumb ? 1 : 0 }} />
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} type="button" onClick={() => { if (o.value !== value) { void selection(); onChange(o.value); } }} className={cn("relative z-10 rounded-full px-3 truncate transition-colors duration-200", size === "sm" ? "text-[13px]" : "text-[14px]", o.value === value ? "text-canvas font-medium" : "text-secondary")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
