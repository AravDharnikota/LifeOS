import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface RingProps {
  /** 0..n where 1 = complete. Values above 1 draw a second lap. */
  progress: number;
  size?: number;
  stroke?: number;
  color?: string; // css color, e.g. var(--protein)
  trackColor?: string;
  children?: ReactNode;
  label?: string;
  className?: string;
  animate?: boolean;
}

/** One ring per metric. Track at 12% alpha, fill in the metric color, round caps, 600ms first fill. */
export function Ring({ progress, size = 100, stroke = 10, color = "var(--accent)", trackColor, children, label, className, animate = true }: RingProps) {
  const [shown, setShown] = useState(animate ? 0 : progress);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(progress));
    return () => cancelAnimationFrame(id);
  }, [progress]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const lap1 = Math.min(1, Math.max(0, shown));
  const lap2 = Math.min(1, Math.max(0, shown - 1));
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor ?? `color-mix(in oklab, ${color} 14%, transparent)`} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - lap1)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: `stroke-dashoffset var(--dur-ring) var(--ease-out)` }} />
        {lap2 > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`color-mix(in oklab, ${color} 70%, var(--text-primary))`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - lap2)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: `stroke-dashoffset var(--dur-ring) var(--ease-out)` }} />
        )}
      </svg>
      <div className="relative flex flex-col items-center justify-center text-center leading-none">{children}</div>
    </div>
  );
}

/** Horizontal progress bar, 6px, radius full. */
export function Bar({ progress, color = "var(--accent)", className, height = 6 }: { progress: number; color?: string; className?: string; height?: number }) {
  const p = Math.min(1, Math.max(0, progress));
  return (
    <div className={cn("w-full rounded-full overflow-hidden", className)} style={{ height, background: `color-mix(in oklab, ${color} 14%, transparent)` }} role="progressbar" aria-valuenow={Math.round(p * 100)}>
      <div className="h-full rounded-full" style={{ width: `${p * 100}%`, background: color, transition: "width 300ms var(--ease-out)" }} />
    </div>
  );
}
