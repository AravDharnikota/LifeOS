import { useId, useMemo, useState } from "react";
import { selection } from "@/lib/haptics";
import { cn } from "@/lib/cn";

export interface ChartPointIn {
  label: string;
  value: number;
  /** Shown while scrubbing. */
  title?: string;
}

interface ChartProps {
  points: ChartPointIn[];
  height?: number;
  format: (v: number) => string;
  /** Index of the point shown in the summary; controlled from outside so the summary row above can change. */
  selected?: number | null;
  onSelect?: (i: number | null) => void;
  className?: string;
  /** Lower bound 0 for sums, free for rates. */
  fromZero?: boolean;
  /** How many x labels to show at most. */
  xLabels?: number;
}

function niceTicks(min: number, max: number, fromZero: boolean): { ticks: number[]; lo: number; hi: number } {
  const lo0 = fromZero ? 0 : min;
  const span = Math.max(1e-9, max - lo0);
  const rough = span / 2;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const steps = [1, 2, 2.5, 5, 10].map((s) => s * mag);
  const step = steps.find((s) => span / s <= 3) ?? steps[steps.length - 1]!;
  const lo = fromZero ? 0 : Math.floor(lo0 / step) * step;
  const hi = Math.ceil(max / step) * step || step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return { ticks, lo, hi };
}

const AXIS_W = 44;

/** Catmull-Rom style smoothing (same curve as the kit Sparkline) so lines read soft, not jagged. */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
const PAD_T = 6;
const PAD_B = 18;

function useScrub(count: number, onSelect?: (i: number | null) => void) {
  const [w, setW] = useState(0);
  const pick = (clientX: number, rect: DOMRect) => {
    if (!onSelect || !count) return;
    const x = clientX - rect.left;
    const plotW = rect.width - AXIS_W;
    const i = Math.max(0, Math.min(count - 1, Math.round((x / plotW) * (count - 1))));
    onSelect(i);
    void selection();
  };
  return { w, setW, pick };
}

/** Bars: thin rounded capsules over a faint dashed grid, trailing axis, tertiary labels. Whole plot is the scrub target. */
export function BarChart({ points, height = 140, format, selected, onSelect, className, fromZero = true, xLabels = 4 }: ChartProps) {
  const { w, setW, pick } = useScrub(points.length, onSelect);
  const max = Math.max(0, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const { ticks, lo, hi } = niceTicks(min, max, fromZero);
  const plotW = Math.max(0, w - AXIS_W);
  const plotH = height - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const slot = points.length ? plotW / points.length : 0;
  const barW = Math.max(3, Math.min(8, slot * 0.42));
  const labelEvery = Math.max(1, Math.ceil(points.length / xLabels));
  return (
    <div ref={(el) => { if (el && el.clientWidth !== w) setW(el.clientWidth); }} className={cn("w-full select-none touch-pan-y", className)} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerMove={(e) => { if (e.buttons) pick(e.clientX, e.currentTarget.getBoundingClientRect()); }} onPointerUp={() => onSelect?.(null)} onPointerCancel={() => onSelect?.(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} className="wk-chart-grid" />
              <text x={w - 2} y={y(t) + 4} textAnchor="end" className="wk-chart-label">{format(t)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            const x = i * slot + (slot - barW) / 2;
            const top = y(p.value);
            const h = Math.max(0, y(lo) - top);
            const r = Math.min(barW / 2, h / 2);
            const dim = selected != null && selected !== i;
            return (
              <g key={i}>
                <rect x={x} y={PAD_T} width={barW} height={Math.max(0, y(lo) - PAD_T)} rx={barW / 2} fill="var(--bg-pressed)" />
                {h > 0 && <rect x={x} y={top} width={barW} height={h} rx={r} className="wk-chart-bar" style={{ opacity: dim ? 0.3 : 1, transition: "opacity 150ms var(--ease-out)" }} />}
                {i % labelEvery === 0 && <text x={x + barW / 2} y={height - 4} textAnchor="middle" className="wk-chart-label">{p.label}</text>}
              </g>
            );
          })}
          {selected != null && points[selected] && <line x1={selected * slot + slot / 2} x2={selected * slot + slot / 2} y1={PAD_T} y2={y(lo)} className="wk-chart-cursor" />}
        </svg>
      )}
    </div>
  );
}

/** Line: thin smooth stroke with a soft area fill and an end dot; dashed faint grid; trailing axis. */
export function LineChart({ points, height = 140, format, selected, onSelect, className, fromZero = false, xLabels = 4 }: ChartProps) {
  const { w, setW, pick } = useScrub(points.length, onSelect);
  const values = points.map((p) => p.value);
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const { ticks, lo, hi } = niceTicks(min, max, fromZero);
  const plotW = Math.max(0, w - AXIS_W);
  const plotH = height - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const x = (i: number) => (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const path = useMemo(() => smooth(points.map((p, i) => [x(i), y(p.value)])), [points, plotW, plotH, lo, hi]); // eslint-disable-line react-hooks/exhaustive-deps
  const fillId = `wkf${useId().replace(/:/g, "")}`;
  const lastPt = points.length ? ([x(points.length - 1), y(points[points.length - 1]!.value)] as const) : null;
  const labelEvery = Math.max(1, Math.ceil(points.length / xLabels));
  return (
    <div ref={(el) => { if (el && el.clientWidth !== w) setW(el.clientWidth); }} className={cn("w-full select-none touch-pan-y", className)} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerMove={(e) => { if (e.buttons) pick(e.clientX, e.currentTarget.getBoundingClientRect()); }} onPointerUp={() => onSelect?.(null)} onPointerCancel={() => onSelect?.(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} className="wk-chart-grid" />
              <text x={w - 2} y={y(t) + 4} textAnchor="end" className="wk-chart-label">{format(t)}</text>
            </g>
          ))}
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.22 }} />
              <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {points.length > 1 && <path d={`${path} L${x(points.length - 1).toFixed(1)} ${y(lo).toFixed(1)} L${x(0).toFixed(1)} ${y(lo).toFixed(1)} Z`} fill={`url(#${fillId})`} />}
          {points.length > 1 && <path d={path} className="wk-chart-line viz-draw" pathLength={1} />}
          {lastPt && selected == null && <circle cx={lastPt[0]} cy={lastPt[1]} r={3.5} fill="var(--accent)" stroke="var(--glass-fill-strong)" strokeWidth={2} />}
          {points.map((p, i) => {
            const last = i === points.length - 1;
            const show = points.length > 1 && (i % labelEvery === 0 ? !last || labelEvery === 1 || (points.length - 1) % labelEvery === 0 : last && (points.length - 1) % labelEvery >= Math.ceil(labelEvery / 2));
            return show ? <text key={i} x={x(i)} y={height - 4} textAnchor={i === 0 ? "start" : last ? "end" : "middle"} className="wk-chart-label">{p.label}</text> : null;
          })}
          {selected != null && points[selected] && (
            <g>
              <line x1={x(selected)} x2={x(selected)} y1={PAD_T} y2={y(lo)} className="wk-chart-cursor" />
              <circle cx={x(selected)} cy={y(points[selected]!.value)} r={4.5} fill="var(--accent)" stroke="var(--glass-fill-strong)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
