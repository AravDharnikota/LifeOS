import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/ui/Icon";
import { ThinBar, Wave } from "@/ui/viz";

/*
 * Small pieces shared by the health, nutrition and body screens.
 * They compose the glass kit (ui/viz) and add nothing loud: wells, a range bar, the one blue banner.
 */

/** Stagger index for the `rise` entrance. */
export const riseStyle = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

/** Hairline rows inside a whiter `well` (for use inside cards and sheets, where a glass Group would double the frost). */
export const WellGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { inset?: boolean }>(function WellGroup({ className, inset = true, children, ...rest }, ref) {
  return (
    <div ref={ref} className={cn("well rounded-[16px] overflow-hidden group-rows", inset && "mx-[var(--gutter)]", className)} {...rest}>
      {children}
    </div>
  );
});

/** Value in a small white chip, like the iHealth metric cards ("37.1°" in a white pill). */
export function ValueChip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("well inline-flex items-baseline gap-1 rounded-[12px] px-2.5 py-1.5 shrink-0", className)}>{children}</span>;
}

/** Small icon tile in a white well. */
export function IconTile({ name, color, size = 32 }: { name: Parameters<typeof Icon>[0]["name"]; color?: string; size?: number }) {
  return (
    <span className="well rounded-[10px] inline-flex items-center justify-center shrink-0" style={{ width: size, height: size, color: color ?? "var(--text-secondary)" }}>
      <Icon name={name} size={Math.round(size / 2)} strokeWidth={1.8} />
    </span>
  );
}

/**
 * Range bar with a marker (MediFlex "Blood Pressure" style): a thin track, the value filled in,
 * and a small upright tick where the target or limit sits. The scale runs a bit past the mark so the
 * mark never sits on the edge.
 */
export function RangeBar({ value, mark, color, overColor = "var(--fat)", kind = "goal", className }: { value: number; mark: number; color: string; overColor?: string; kind?: "goal" | "limit"; className?: string }) {
  const scale = Math.max(mark * 1.25, value, 1);
  const p = Math.min(1, Math.max(0, value / scale));
  const m = Math.min(1, mark / scale);
  const over = kind === "limit" && value > mark;
  return (
    <div className={cn("relative h-[14px] flex items-center", className)} aria-hidden="true">
      <div className="absolute inset-x-0 h-[6px] rounded-full bg-pressed overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${p * 100}%`, background: over ? overColor : color, transitionTimingFunction: "var(--ease-out)" }} />
      </div>
      <span className="absolute w-[2px] h-[14px] rounded-full bg-primary/70" style={{ left: `calc(${m * 100}% - 1px)` }} />
    </div>
  );
}

/**
 * The one blue banner per screen (iHealth "Reset & Relax"): accent gradient, white text, a white pill button,
 * and two faint waves for depth.
 */
export function Banner({ title, text, action, onAction, actionTestId, className, style }: { title: ReactNode; text: ReactNode; action: string; onAction: () => void; actionTestId?: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg p-4 pr-3 flex items-center gap-3 shadow-card", className)} style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))", color: "var(--on-accent)", ...style }}>
      <Wave colors={["var(--on-accent)", "var(--on-accent)"]} height={70} amplitude={0.28} className="absolute inset-x-0 bottom-0 opacity-25 pointer-events-none" />
      <div className="relative flex-1 min-w-0">
        <div className="text-[17px] leading-[22px] font-medium">{title}</div>
        <div className="text-[13px] leading-[18px] opacity-80 mt-0.5">{text}</div>
      </div>
      <button type="button" onClick={onAction} data-testid={actionTestId} className="relative shrink-0 h-9 px-4 rounded-full text-[14px] font-medium pressable-spring shadow-thumb" style={{ background: "var(--on-accent)", color: "var(--accent)" }}>
        {action}
      </button>
    </div>
  );
}

/** A quiet check mark in a soft success circle, for goals reached. */
export function GoalCheck({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center justify-center rounded-full bg-success-soft text-success-text shrink-0", className)} style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="check" size={Math.round(size * 0.62)} strokeWidth={2.4} />
    </span>
  );
}

/** Score out of 10 as a thin number with a small arc, green when it is good. */
export function ScoreValue({ score }: { score: number }) {
  const color = score >= 7 ? "var(--protein)" : score >= 4 ? "var(--carbs)" : "var(--fat)";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-baseline gap-0.5">
        <span className="num text-[22px] leading-6 text-primary">{score}</span>
        <span className="text-[11px] text-tertiary">/10</span>
      </span>
      <span className="w-10"><ThinBar progress={score / 10} color={color} height={4} /></span>
    </span>
  );
}
