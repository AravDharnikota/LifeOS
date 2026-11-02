import { useMemo, useState } from "react";
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

/** Bars: 4px top radius, 40% gap, trailing axis, 2 to 3 grid lines. Whole plot is the scrub target. */
export function BarChart({ points, height = 140, format, selected, onSelect, className, fromZero = true, xLabels = 4 }: ChartProps) {
  const { w, setW, pick } = useScrub(points.length, onSelect);
  const max = Math.max(0, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const { ticks, lo, hi } = niceTicks(min, max, fromZero);
  const plotW = Math.max(0, w - AXIS_W);
  const plotH = height - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const slot = points.length ? plotW / points.length : 0;
  const barW = Math.max(2, slot * 0.6);
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
            const r = Math.min(4, barW / 2, h);
            const d = h > 0 ? `M${x} ${top + r} a${r} ${r} 0 0 1 ${r} -${r} h${barW - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${h - r} h-${barW} z` : "";
            const dim = selected != null && selected !== i;
            return (
              <g key={i}>
                {d && <path d={d} className="wk-chart-bar" style={{ opacity: dim ? 0.35 : 1, transition: "opacity 150ms var(--ease-out)" }} />}
                {i % labelEvery === 0 && <text x={x + barW / 2} y={height - 4} textAnchor="middle" className="wk-chart-label">{p.label}</text>}
              </g>
            );
          })}
          {selected != null && points[selected] && <line x1={selected * slot + slot / 2} x2={selected * slot + slot / 2} y1={PAD_T} y2={y(lo)} stroke="var(--text-primary)" strokeWidth={1} />}
        </svg>
      )}
    </div>
  );
}

/** Line: 2px, no dots except the selected point, trailing axis. */
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
  const path = useMemo(() => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" "), [points, plotW, plotH, lo, hi]); // eslint-disable-line react-hooks/exhaustive-deps
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
          {points.length > 1 && <path d={path} className="wk-chart-line" />}
          {points.length === 1 && <circle cx={x(0)} cy={y(points[0]!.value)} r={3} fill="var(--activity)" />}
          {points.map((p, i) => {
            const last = i === points.length - 1;
            const show = points.length > 1 && (i % labelEvery === 0 ? !last || labelEvery === 1 || (points.length - 1) % labelEvery === 0 : last && (points.length - 1) % labelEvery >= Math.ceil(labelEvery / 2));
            return show ? <text key={i} x={x(i)} y={height - 4} textAnchor={i === 0 ? "start" : last ? "end" : "middle"} className="wk-chart-label">{p.label}</text> : null;
          })}
          {selected != null && points[selected] && (
            <g>
              <line x1={x(selected)} x2={x(selected)} y1={PAD_T} y2={y(lo)} stroke="var(--text-primary)" strokeWidth={1} />
              <circle cx={x(selected)} cy={y(points[selected]!.value)} r={4} fill="var(--activity)" stroke="var(--bg-surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
