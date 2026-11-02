import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { impact } from "@/lib/haptics";

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Stroke color token name when unchecked, e.g. "var(--cal-blue)" */
  tint?: string;
  size?: number;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Things-style check: 22px circle, stroke fills clockwise (200ms), checkmark pops in (pop spring),
 * light impact at the moment the fill completes. Unchecking reverses in 150ms with no haptic.
 */
export function Checkbox({ checked, onChange, tint, size = 22, label, disabled, className }: CheckboxProps) {
  const [animating, setAnimating] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (checked) {
      setAnimating(true);
      const t = window.setTimeout(() => setAnimating(false), 500);
      return () => window.clearTimeout(t);
    }
  }, [checked]);

  const r = (size - 2) / 2;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!checked) void impact("light");
        onChange(!checked);
      }}
      className={cn("hit-44 inline-flex items-center justify-center -m-[11px] shrink-0", disabled && "opacity-40", className)}
      style={{ width: 44, height: 44 }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tint ?? "var(--border-interactive)"} strokeWidth={1.5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill={checked ? "var(--success)" : "transparent"}
          stroke="var(--success)"
          strokeWidth={1.5}
          strokeDasharray={c}
          strokeDashoffset={checked ? 0 : c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: checked ? `stroke-dashoffset 200ms var(--ease-inout), fill 120ms linear 180ms` : "stroke-dashoffset 150ms var(--ease-out), fill 100ms linear" }}
        />
        <path
          d={`M${size * 0.3} ${size * 0.52} l${size * 0.14} ${size * 0.14} l${size * 0.27} -${size * 0.3}`}
          fill="none"
          stroke="white"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transformOrigin: "center",
            transform: checked ? "scale(1)" : "scale(0.6)",
            opacity: checked ? 1 : 0,
            transition: checked ? `transform 340ms var(--spring-pop) 200ms, opacity 100ms linear 200ms` : "transform 150ms var(--ease-out), opacity 100ms linear",
          }}
        />
      </svg>
      <span className="sr-only">{animating ? "" : ""}</span>
    </button>
  );
}
