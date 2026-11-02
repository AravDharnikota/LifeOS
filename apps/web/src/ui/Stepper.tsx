import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { selection } from "@/lib/haptics";
import { Icon } from "./Icon";

export interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Format for display; default rounds to the step precision. */
  format?: (v: number) => string;
  unit?: string;
  /** Allow typing the value directly (tap the number). */
  editable?: boolean;
  size?: "md" | "lg";
  className?: string;
  label?: string;
}

function precisionOf(step: number): number {
  const s = String(step);
  return s.includes(".") ? s.split(".")[1]!.length : 0;
}

/**
 * Two 44px glyph buttons flanking a hero number. Tap = one step; hold repeats after 400ms every 100ms,
 * 10x faster after 2s. Selection haptic per tick.
 */
export function Stepper({ value, onChange, step = 1, min = -Infinity, max = Infinity, format, unit, editable = true, size = "md", className, label }: StepperProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;
  const timers = useRef<{ t?: number; i?: number; start?: number }>({});
  const prec = precisionOf(step);
  const show = format ?? ((v: number) => v.toFixed(prec));

  const clamp = (v: number) => Math.min(max, Math.max(min, Number(v.toFixed(prec))));
  const bump = (dir: 1 | -1, mult = 1) => {
    const next = clamp(latest.current + dir * step * mult);
    if (next !== latest.current) {
      latest.current = next;
      onChange(next);
      void selection();
    }
  };
  const stop = () => {
    if (timers.current.t) window.clearTimeout(timers.current.t);
    if (timers.current.i) window.clearInterval(timers.current.i);
    timers.current = {};
  };
  const hold = (dir: 1 | -1) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    bump(dir);
    timers.current.start = performance.now();
    timers.current.t = window.setTimeout(() => {
      timers.current.i = window.setInterval(() => {
        const held = performance.now() - (timers.current.start ?? 0);
        bump(dir, held > 2000 ? 10 : 1);
      }, 100);
    }, 400);
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const n = Number(draft.replace(",", "."));
    if (!Number.isNaN(n)) onChange(clamp(n));
    setEditing(false);
  };

  const btn = "hit-44 w-11 h-11 rounded-md bg-surface-2 text-primary inline-flex items-center justify-center active:bg-pressed transition-colors duration-100 select-none touch-none";
  return (
    <div className={cn("flex items-center gap-3", className)} aria-label={label}>
      <button type="button" aria-label="Decrease" className={btn} onPointerDown={hold(-1)} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}>
        <Icon name="minus" size={20} />
      </button>
      <div className="flex-1 min-w-0 text-center">
        {editing ? (
          <input ref={inputRef} inputMode="decimal" enterKeyHint="done" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} className={cn("num w-full text-center bg-transparent outline-none", size === "lg" ? "text-display-44" : "text-title-1")} />
        ) : (
          <button type="button" className="w-full min-h-[44px]" onClick={() => { if (editable) { setDraft(show(value)); setEditing(true); } }}>
            <span className={cn("num text-primary", size === "lg" ? "text-display-44" : "text-title-1")}>{show(value)}</span>
            {unit && <span className="text-subhead text-secondary ml-1.5">{unit}</span>}
          </button>
        )}
      </div>
      <button type="button" aria-label="Increase" className={btn} onPointerDown={hold(1)} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}>
        <Icon name="plus" size={20} />
      </button>
    </div>
  );
}
