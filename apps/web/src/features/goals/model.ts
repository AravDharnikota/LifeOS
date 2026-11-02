import type { Goal } from "@aravos/shared";
import { daysBetween, todayString } from "@aravos/shared";
import { fmt1, fmtInt } from "@/lib/format";

export const AREAS = ["health", "work", "learning", "money", "life", "other"] as const;
export type Area = (typeof AREAS)[number];
export const AREA_LABEL: Record<string, string> = { health: "Health", work: "Work", learning: "Learning", money: "Money", life: "Life", other: "Other" };
export const areaLabel = (a: string): string => AREA_LABEL[a] ?? "Other";

export const KINDS = [
  { value: "number", label: "Number" },
  { value: "habit", label: "Habit" },
  { value: "milestone", label: "Milestones" },
  { value: "boolean", label: "Yes/No" },
] as const;
export const KIND_LABEL: Record<Goal["kind"], string> = { number: "Number", habit: "Habit", milestone: "Milestones", boolean: "Yes/No" };

/** Calendar palette names; the goal stores the name, the UI resolves the token. */
export const COLORS = ["blue", "green", "yellow", "orange", "red", "pink", "purple", "gray"] as const;
export const COLOR_LABEL: Record<string, string> = { blue: "Blue", green: "Green", yellow: "Yellow", orange: "Orange", red: "Red", pink: "Pink", purple: "Purple", gray: "Gray" };
export function colorVar(color: string | null | undefined): string {
  return color && (COLORS as readonly string[]).includes(color) ? `var(--cal-${color})` : "var(--accent)";
}

export const STATUS_LABEL: Record<Goal["status"], string> = { active: "Active", done: "Done", paused: "Paused", archived: "Archived" };

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? fmtInt(n) : fmt1(n);
}

export function withUnit(n: number, unit: string | null | undefined): string {
  return unit ? `${fmtNum(n)} ${unit}` : fmtNum(n);
}

/** "12 days left", "Due today", "3 days overdue". */
export function deadlineLabel(deadline: string | null): { text: string; overdue: boolean } | null {
  if (!deadline) return null;
  const d = daysBetween(todayString(), deadline);
  if (d === 0) return { text: "Due today", overdue: false };
  if (d === 1) return { text: "1 day left", overdue: false };
  if (d > 1) return { text: `${fmtInt(d)} days left`, overdue: false };
  if (d === -1) return { text: "1 day overdue", overdue: true };
  return { text: `${fmtInt(-d)} days overdue`, overdue: true };
}

export function streakLabel(g: Goal): { n: number; unit: string } {
  const n = g.streak ?? 0;
  const weekly = g.cadence === "weekly";
  return { n, unit: weekly ? (n === 1 ? "week streak" : "week streak") : "day streak" };
}

/** "3 of 4 this week", "Every day" */
export function periodLabel(g: Goal): string {
  const n = g.periodCount ?? 0;
  const target = g.timesPerPeriod ?? 1;
  if (g.cadence === "weekly") return `${fmtInt(n)} of ${fmtInt(target)} this week`;
  return "Every day";
}

/** True when today has a check-in. Exact for daily habits; weekly habits need recentEntries. */
export function habitDoneToday(g: Goal): boolean {
  if (g.recentEntries) {
    const today = todayString();
    return g.recentEntries.some((e) => e.date === today);
  }
  if (g.cadence !== "weekly") return (g.periodCount ?? 0) > 0;
  return false;
}

export function milestoneCounts(g: Goal): { done: number; total: number } {
  const ms = g.milestones ?? [];
  return { done: ms.filter((m) => m.done).length, total: ms.length };
}

/** Remaining distance to the target, respecting direction. */
export function remaining(g: Goal): number | null {
  if (g.targetValue == null || g.currentValue == null) return null;
  const r = g.direction === "decrease" ? g.currentValue - g.targetValue : g.targetValue - g.currentValue;
  return Math.max(0, r);
}

/** Sensible stepper increment for a number goal. */
export function stepFor(g: Goal): number {
  const vals = [g.currentValue, g.targetValue, g.startValue].filter((v): v is number => v != null);
  if (vals.some((v) => !Number.isInteger(v))) return 0.1;
  const span = Math.abs((g.targetValue ?? 0) - (g.startValue ?? 0));
  if (span >= 10000) return 100;
  if (span >= 1000) return 10;
  return 1;
}

export function groupByArea<T extends { area: string }>(items: T[]): { area: string; items: T[] }[] {
  const order = [...AREAS] as string[];
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = order.includes(it.area) ? it.area : "other";
    map.set(key, [...(map.get(key) ?? []), it]);
  }
  return order.filter((a) => map.has(a)).map((a) => ({ area: a, items: map.get(a)! }));
}
