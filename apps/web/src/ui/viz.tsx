import { useEffect, useId, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./Icon";

/*
 * Glass kit: the building blocks of the AravOS look.
 * Frosted cards, thin big numbers, quiet labels, and small dense data visuals
 * (tick bars, dot columns, capsule bars, gauges, waves). Charts carry the color; chrome stays neutral.
 */

/* ---------- surfaces ---------- */

export interface GlassCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Make the whole card a button. */
  onPress?: () => void;
  label?: string;
  /** "strong" = more opaque (hero cards, sheets over busy content). */
  tone?: "default" | "strong";
  as?: ElementType;
}

/** Frosted glass panel: radius 20, 16px padding, bright 1px edge. Pressable when given onPress. */
export function GlassCard({ children, className, style, onPress, label, tone = "default", as }: GlassCardProps) {
  const Tag = (as ?? (onPress ? "button" : "div")) as ElementType;
  return (
    <Tag
      type={onPress && !as ? "button" : undefined}
      aria-label={label}
      onClick={onPress}
      style={style}
      className={cn("relative block text-left rounded-lg p-4", tone === "strong" ? "glass-strong" : "glass", onPress && "pressable-spring cursor-pointer w-full", className)}
    >
      {children}
    </Tag>
  );
}

/** Card header: small icon in a white well, a label, and an optional trailing slot (filter, "…", chevron). */
export function CardHeader({ icon, title, sub, trailing, className, iconColor }: { icon?: IconName; title: ReactNode; sub?: ReactNode; trailing?: ReactNode; className?: string; iconColor?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      {icon && (
        <span className="w-8 h-8 rounded-[10px] well inline-flex items-center justify-center shrink-0" style={iconColor ? { color: iconColor } : undefined}>
          <Icon name={icon} size={16} strokeWidth={1.8} />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[15px] leading-5 text-primary truncate">{title}</div>
        {sub != null && <div className="text-[12px] leading-4 text-tertiary truncate mt-0.5">{sub}</div>}
      </div>
      {trailing != null && <div className="shrink-0 text-[12px] text-tertiary flex items-center gap-1">{trailing}</div>}
    </div>
  );
}

/* ---------- numbers ---------- */

/** The hero number: thin, large, tabular. Unit sits small beside it. */
export function BigNumber({ value, unit, size = 34, className, style }: { value: ReactNode; unit?: ReactNode; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 min-w-0", className)} style={style}>
      <span className="num text-primary" style={{ fontSize: size, lineHeight: `${Math.round(size * 1.05)}px` }}>{value}</span>
      {unit != null && <span className="text-[13px] text-tertiary font-normal">{unit}</span>}
    </span>
  );
}

/** Trend badge: "↗ 18%" in green (good) or "↘ 12%" in red (bad). `good` decides the color, `up` the arrow. */
export function Trend({ value, up, good = up, className }: { value: ReactNode; up: boolean; good?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 h-5 px-1.5 rounded-[6px] text-[11px] font-medium tabular", good ? "bg-success-soft text-success-text" : "bg-danger-soft text-danger-text", className)}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {up ? <path d="M2 7l3-3 1.5 1.5L9 3M6.5 3H9v2.5" /> : <path d="M2 3l3 3 1.5-1.5L9 7M6.5 7H9V4.5" />}
      </svg>
      {value}
    </span>
  );
}

export type PillTone = "success" | "danger" | "warning" | "accent" | "neutral" | "highlight";
const pillTone: Record<PillTone, string> = {
  success: "text-success-text bg-success-soft border-success/30",
  danger: "text-danger-text bg-danger-soft border-danger/30",
  warning: "text-warning-text bg-warning-soft border-warning/30",
  accent: "text-accent-text bg-accent-soft border-accent/25",
  neutral: "text-secondary bg-surface-2 border-separator-strong",
  highlight: "text-on-highlight bg-highlight border-transparent",
};
/** Status pill like "Live", "Complete", "On going": tiny, bordered, tinted. */
export function StatusPill({ tone = "neutral", children, dot, className }: { tone?: PillTone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 h-[22px] px-2 rounded-[7px] border text-[11px] font-medium whitespace-nowrap", pillTone[tone], className)}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Counts up from 0 to `to` on mount and eases between later values. */
export function useCountUp(to: number, ms = 900): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(to);
      return;
    }
    let raf = 0;
    const from = v;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, ms]);
  return v;
}

/* ---------- charts ---------- */

function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setM(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return m;
}

/**
 * Tick bars: a row of thin vertical lines (like a barcode). Bars at or before `current` are colored,
 * later ones are faint. `accentAt` paints single ticks in another color (a spike, today).
 */
export function TickBars({ values, current = values.length - 1, color = "var(--protein)", height = 40, accentAt, className, gap = 4 }: { values: number[]; current?: number; color?: string; height?: number; accentAt?: Record<number, string>; className?: string; gap?: number }) {
  const max = Math.max(1, ...values);
  const shown = useMounted();
  return (
    <div className={cn("flex items-end w-full", className)} style={{ height, gap }} aria-hidden="true">
      {values.map((v, i) => {
        const h = Math.max(0.08, v / max);
        const c = accentAt?.[i] ?? (i <= current ? color : "var(--text-quaternary)");
        return <span key={i} className="flex-1 max-w-[3px] rounded-full origin-bottom" style={{ height: `${h * 100}%`, background: c, opacity: i <= current ? 1 : 0.45, transform: shown ? "scaleY(1)" : "scaleY(0)", transition: `transform 700ms var(--ease-out) ${i * 14}ms` }} />;
      })}
    </div>
  );
}

/** Dot columns (dot-matrix bars): each value is a stack of small dots. */
export function DotBars({ values, max: maxIn, rows = 8, color = "var(--protein)", current = values.length - 1, className }: { values: number[]; max?: number; rows?: number; color?: string; current?: number; className?: string }) {
  const max = maxIn ?? Math.max(1, ...values);
  return (
    <div className={cn("flex items-end justify-between w-full gap-[3px]", className)} aria-hidden="true">
      {values.map((v, i) => {
        const filled = Math.round((v / max) * rows);
        return (
          <div key={i} className="flex flex-col-reverse gap-[3px]">
            {Array.from({ length: rows }).map((_, r) => (
              <span key={r} className="w-[4px] h-[4px] rounded-full" style={{ background: r < filled ? (i <= current ? color : "var(--text-quaternary)") : "var(--bg-pressed)" }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Capsule bars: tall rounded tracks with a filled part (like a weekly activity chart).
 * Optional `labels` under each and `% `on top of the fill.
 */
export function CapsuleBars({ values, labels, max: maxIn, height = 120, color = "var(--accent)", activeIndex, showPct, className }: { values: number[]; labels?: string[]; max?: number; height?: number; color?: string; activeIndex?: number; showPct?: boolean; className?: string }) {
  const max = maxIn ?? Math.max(1, ...values);
  const shown = useMounted();
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-end justify-between gap-2" style={{ height }}>
        {values.map((v, i) => {
          const p = Math.min(1, v / max);
          const active = activeIndex === undefined || activeIndex === i;
          return (
            <div key={i} className="relative flex-1 h-full rounded-full well overflow-hidden">
              <div className="absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-700" style={{ height: shown ? `${Math.max(p * 100, p > 0 ? 14 : 0)}%` : "0%", background: active ? color : "var(--text-quaternary)", opacity: active ? 1 : 0.5, transitionTimingFunction: "var(--ease-out)", transitionDelay: `${i * 40}ms` }}>
                {showPct && p > 0.18 && <span className="absolute top-1.5 inset-x-0 text-center text-[9px] font-medium text-white/90 tabular">{Math.round(p * 100)}%</span>}
              </div>
            </div>
          );
        })}
      </div>
      {labels && (
        <div className="flex justify-between gap-2 mt-2">
          {labels.map((l, i) => (
            <span key={i} className={cn("flex-1 text-center text-[11px] tabular", activeIndex === i ? "text-primary font-medium" : "text-tertiary")}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Segment bar: a horizontal budget split into parts, each drawn its own way
 * (striped ticks, solid block, separate cells), with % labels above. Like a forecast bar.
 */
export function SegmentBar({ segments, height = 22, className }: { segments: { value: number; color: string; label?: string; style?: "ticks" | "solid" | "cells" }[]; height?: number; className?: string }) {
  const total = Math.max(1, segments.reduce((a, s) => a + s.value, 0));
  return (
    <div className={cn("w-full", className)}>
      <div className="flex gap-1.5 mb-1.5">
        {segments.map((s, i) => (
          <span key={i} className="text-[11px] text-secondary tabular" style={{ width: `${(s.value / total) * 100}%` }}>{s.label ?? `${Math.round((s.value / total) * 100)}%`}</span>
        ))}
      </div>
      <div className="flex gap-1.5 w-full" style={{ height }}>
        {segments.map((s, i) => {
          const w = `${(s.value / total) * 100}%`;
          if ((s.style ?? "solid") === "ticks") return <span key={i} className="h-full rounded-[4px]" style={{ width: w, background: `repeating-linear-gradient(90deg, ${s.color} 0 2px, transparent 2px 5px)` }} />;
          if (s.style === "cells") {
            const n = Math.max(1, Math.round((s.value / total) * 12));
            return (
              <span key={i} className="h-full flex gap-1" style={{ width: w }}>
                {Array.from({ length: n }).map((_, j) => <span key={j} className="flex-1 h-full rounded-[4px]" style={{ background: s.color }} />)}
              </span>
            );
          }
          return <span key={i} className="h-full rounded-[5px]" style={{ width: w, background: s.color }} />;
        })}
      </div>
    </div>
  );
}

/** Thin progress bar with a rounded track. */
export function ThinBar({ progress, color = "var(--accent)", height = 6, className }: { progress: number; color?: string; height?: number; className?: string }) {
  const p = Math.min(1, Math.max(0, progress));
  const shown = useMounted();
  return (
    <div className={cn("w-full rounded-full overflow-hidden bg-pressed", className)} style={{ height }} role="progressbar" aria-valuenow={Math.round(p * 100)}>
      <div className="h-full rounded-full" style={{ width: shown ? `${p * 100}%` : "0%", background: color, transition: "width 800ms var(--ease-out)" }} />
    </div>
  );
}

/**
 * Gauge: an open arc (default 240°) drawn as rounded segments with small gaps, filled up to `value`.
 * Pass several colors to get a multi-color gauge (orange → green → blue).
 */
export function Gauge({ value, size = 180, stroke = 14, colors = ["var(--energy)", "var(--protein)", "var(--water)"], sweep = 220, children, label, className }: { value: number; size?: number; stroke?: number; colors?: string[]; sweep?: number; children?: ReactNode; label?: string; className?: string }) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const start = 90 + (360 - sweep) / 2; // degrees, measured clockwise from +x, centered at the bottom gap
  const n = colors.length;
  const gapDeg = 8;
  const segDeg = (sweep - gapDeg * (n - 1)) / n;
  const shown = useMounted();
  const v = Math.min(1, Math.max(0, value));
  const pt = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const h = Math.round(size * (sweep > 200 ? 0.82 : 0.62));
  return (
    <div className={cn("relative inline-flex justify-center", className)} style={{ width: size, height: h }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute top-0 left-0">
        {colors.map((c, i) => {
          const a0 = start + i * (segDeg + gapDeg);
          const a1 = a0 + segDeg;
          const segStart = (i * (segDeg + gapDeg)) / sweep;
          const segEnd = (i * (segDeg + gapDeg) + segDeg) / sweep;
          const fill = Math.min(1, Math.max(0, (v - segStart) / (segEnd - segStart)));
          const len = (segDeg * Math.PI * r) / 180;
          return (
            <g key={i}>
              <path d={arc(a0, a1)} fill="none" stroke="var(--bg-pressed)" strokeWidth={stroke} strokeLinecap="round" />
              <path d={arc(a0, a1)} fill="none" stroke={c} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={shown ? len * (1 - fill) : len} style={{ transition: `stroke-dashoffset 900ms var(--ease-out) ${i * 120}ms`, opacity: fill > 0 ? 1 : 0 }} />
            </g>
          );
        })}
      </svg>
      <div className="relative flex flex-col items-center justify-center text-center" style={{ paddingTop: size * 0.3 }}>{children}</div>
    </div>
  );
}

/** Thin ring (full or open) with a soft gradient stroke, for a single progress value. */
export function ArcRing({ progress, size = 120, stroke = 8, color = "var(--accent)", color2, open = false, children, label, className }: { progress: number; size?: number; stroke?: number; color?: string; color2?: string; open?: boolean; children?: ReactNode; label?: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const r = (size - stroke) / 2;
  const sweep = open ? 0.75 : 1;
  const c = 2 * Math.PI * r;
  const track = c * sweep;
  const p = Math.min(1, Math.max(0, progress));
  const shown = useMounted();
  const rot = open ? 135 : -90;
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color2 ?? color} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-pressed)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${track} ${c}`} transform={`rotate(${rot} ${size / 2} ${size / 2})`} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#g${id})`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${shown ? track * p : 0} ${c}`} transform={`rotate(${rot} ${size / 2} ${size / 2})`} style={{ transition: "stroke-dasharray 1000ms var(--ease-out)", opacity: p > 0 ? 1 : 0 }} />
      </svg>
      <div className="relative flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** Smooth sparkline with an optional soft area fill and an end dot. Draws itself in. */
export function Sparkline({ values, color = "var(--accent)", height = 44, fill = true, dot = true, className, min: minIn, max: maxIn }: { values: number[]; color?: string; height?: number; fill?: boolean; dot?: boolean; className?: string; min?: number; max?: number }) {
  const id = useId().replace(/:/g, "");
  const w = 200;
  const pad = 4;
  const vs = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const min = minIn ?? Math.min(...vs);
  const max = maxIn ?? Math.max(...vs);
  const span = max - min || 1;
  const pts = vs.map((v, i) => [(i / (vs.length - 1)) * w, pad + (1 - (v - min) / span) * (height - pad * 2)] as [number, number]);
  const d = smoothPath(pts);
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn("w-full overflow-visible", className)} style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={`f${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d} L ${w} ${height} L 0 ${height} Z`} fill={`url(#f${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} className="viz-draw" />
      {dot && <circle cx={last[0]} cy={last[1]} r="3" fill={color} stroke="white" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Decorative organic wave: two or three soft sine lines weaving, tinted. For "score" cards. */
export function Wave({ colors = ["var(--accent)", "var(--energy)"], height = 56, amplitude = 0.32, className }: { colors?: string[]; height?: number; amplitude?: number; className?: string }) {
  const w = 300;
  const mid = height / 2;
  const lines = colors.map((c, k) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const x = (i / 12) * w;
      const env = Math.sin((i / 12) * Math.PI);
      pts.push([x, mid + Math.sin(i * 0.9 + k * 1.9) * mid * amplitude * 2 * env]);
    }
    return { c, d: smoothPath(pts) };
  });
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn("w-full", className)} style={{ height }} aria-hidden="true">
      {lines.map((l, i) => (
        <path key={i} d={l.d} fill="none" stroke={l.c} strokeWidth="1.4" strokeOpacity={0.85} vectorEffect="non-scaling-stroke" pathLength={1} className="viz-draw" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </svg>
  );
}

/** A tiny legend dot + label. */
export function Legend({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px] text-secondary", className)}>
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}
