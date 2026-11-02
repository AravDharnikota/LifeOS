import { useMemo, useState, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { selection } from "@/lib/haptics";

/** Nice upper bound for a sum axis: the tallest bar fills the plot. */
function niceMax(v: number): number {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

const AXIS_W = 44;
const PAD_TOP = 6;
const LABEL_H = 22;

export interface BarDatum {
  label: string;
  value: number;
  /** Secondary text for the X axis (unused when empty). */
  key: string;
}

/**
 * Minimal bar chart per the brief: one series in the metric colour, 4px top radius, 40% gap,
 * trailing Y labels, 2 grid lines, dashed target in the metric's text colour. Whole plot scrubs.
 */
export function BarChart({ data, color, textColor, target, height = 170, selected, onSelect, format, className }: { data: BarDatum[]; color: string; textColor?: string; target?: number | null; height?: number; selected: number | null; onSelect: (i: number | null) => void; format: (v: number) => string; className?: string }) {
  const [w, setW] = useState(320);
  const max = niceMax(Math.max(...data.map((d) => d.value), target ?? 0) * 1.02);
  const plotW = Math.max(0, w - AXIS_W);
  const plotH = height - PAD_TOP - LABEL_H;
  const n = Math.max(1, data.length);
  const slot = plotW / n;
  const barW = slot * 0.6;
  const y = (v: number) => PAD_TOP + plotH - (v / max) * plotH;

  const measure = (el: SVGSVGElement | null) => {
    if (el && el.clientWidth && el.clientWidth !== w) setW(el.clientWidth);
  };
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.min(n - 1, Math.max(0, Math.floor(x / slot)));
    if (i !== selected) {
      void selection();
      onSelect(i);
    }
  };
  const ticks = [max / 2, max];

  return (
    <svg
      ref={measure}
      className={cn("w-full touch-none select-none", className)}
      height={height}
      role="img"
      aria-label={`Bar chart, ${data.length} days`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === "mouse") pick(e); }}
      onPointerUp={() => onSelect(null)}
      onPointerCancel={() => onSelect(null)}
      onPointerLeave={() => onSelect(null)}
    >
      {[0, ...ticks].map((t) => (
        <line key={t} x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--separator)" strokeWidth={1} />
      ))}
      {ticks.map((t) => (
        <text key={t} x={w} y={y(t) + 4} textAnchor="end" fontSize={12} className="tabular" style={{ fill: "var(--text-tertiary)" }}>
          {format(t)}
        </text>
      ))}
      {target != null && target > 0 && target <= max && (
        <g>
          <line x1={0} x2={plotW} y1={y(target)} y2={y(target)} stroke={textColor ?? color} strokeWidth={1} strokeDasharray="3 3" />
        </g>
      )}
      {data.map((d, i) => {
        const x = i * slot + (slot - barW) / 2;
        const top = d.value > 0 ? Math.min(y(d.value), PAD_TOP + plotH - 2) : PAD_TOP + plotH;
        const h = PAD_TOP + plotH - top;
        const r = Math.min(4, barW / 2, h);
        const dim = selected != null && selected !== i;
        return (
          <g key={d.key}>
            {h > 0 && (
              <path
                d={`M${x},${PAD_TOP + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${PAD_TOP + plotH} Z`}
                fill={color}
                opacity={dim ? 0.35 : 1}
                style={{ transition: "opacity 150ms var(--ease-out)" }}
              />
            )}
            <text x={x + barW / 2} y={height - 5} textAnchor="middle" fontSize={12} style={{ fill: selected === i ? "var(--text-primary)" : "var(--text-tertiary)" }}>
              {d.label}
            </text>
          </g>
        );
      })}
      {selected != null && <line x1={selected * slot + slot / 2} x2={selected * slot + slot / 2} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke="var(--text-primary)" strokeWidth={1} />}
    </svg>
  );
}

export interface LinePoint {
  key: string;
  label: string;
  /** Smoothed value drawn as the line. */
  value: number;
  /** Raw value drawn as a point. */
  raw: number | null;
}

/** Trend line (2px, primary) over raw points (tertiary). Y range follows the data, never 0. */
export function LineChart({ points, height = 190, target, format, selected, onSelect, xLabelEvery, className }: { points: LinePoint[]; height?: number; target?: number | null; format: (v: number) => string; selected: number | null; onSelect: (i: number | null) => void; xLabelEvery?: number; className?: string }) {
  const [w, setW] = useState(320);
  const plotW = Math.max(0, w - AXIS_W);
  const plotH = height - PAD_TOP - LABEL_H;
  const n = points.length;
  const { lo, hi } = useMemo(() => {
    const vals = points.flatMap((p) => (p.raw == null ? [p.value] : [p.value, p.raw]));
    if (target != null) vals.push(target);
    if (!vals.length) return { lo: 0, hi: 1 };
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    const pad = Math.max(0.5, (max - min) * 0.15);
    min -= pad;
    max += pad;
    return { lo: Math.floor(min * 2) / 2, hi: Math.ceil(max * 2) / 2 };
  }, [points, target]);
  const x = (i: number) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * (plotW - 8) + 4);
  const y = (v: number) => PAD_TOP + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [lo, (lo + hi) / 2, hi];
  const every = xLabelEvery ?? Math.max(1, Math.round(n / 5));

  const measure = (el: SVGSVGElement | null) => {
    if (el && el.clientWidth && el.clientWidth !== w) setW(el.clientWidth);
  };
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(((px - 4) / (plotW - 8)) * (n - 1))));
    if (i !== selected) {
      void selection();
      onSelect(i);
    }
  };

  return (
    <svg
      ref={measure}
      className={cn("w-full touch-none select-none", className)}
      height={height}
      role="img"
      aria-label={`Trend line, ${n} points`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === "mouse") pick(e); }}
      onPointerUp={() => onSelect(null)}
      onPointerCancel={() => onSelect(null)}
      onPointerLeave={() => onSelect(null)}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--separator)" strokeWidth={1} />
          <text x={w} y={y(t) + 4} textAnchor="end" fontSize={12} className="tabular" style={{ fill: "var(--text-tertiary)" }}>
            {format(t)}
          </text>
        </g>
      ))}
      {target != null && target >= lo && target <= hi && <line x1={0} x2={plotW} y1={y(target)} y2={y(target)} stroke="var(--text-quaternary)" strokeWidth={1} strokeDasharray="3 3" />}
      {points.map((p, i) => p.raw != null && <circle key={p.key} cx={x(i)} cy={y(p.raw)} r={2.5} fill="var(--text-quaternary)" />)}
      {n > 1 && <path d={path} fill="none" stroke="var(--text-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {n === 1 && points[0] && <circle cx={x(0)} cy={y(points[0].value)} r={3} fill="var(--text-primary)" />}
      {points.map((p, i) =>
        (i % every === 0 && n - 1 - i >= every / 2) || i === n - 1 ? (
          <text key={p.key} x={Math.min(Math.max(x(i), 14), plotW - 14)} y={height - 5} textAnchor="middle" fontSize={12} style={{ fill: "var(--text-tertiary)" }}>
            {p.label}
          </text>
        ) : null,
      )}
      {selected != null && points[selected] && (
        <g>
          <line x1={x(selected)} x2={x(selected)} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke="var(--text-primary)" strokeWidth={1} />
          <circle cx={x(selected)} cy={y(points[selected].value)} r={4} fill="var(--bg-surface)" stroke="var(--text-primary)" strokeWidth={2} />
        </g>
      )}
    </svg>
  );
}
