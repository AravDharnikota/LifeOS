import { addDays, differenceInCalendarDays, startOfWeek } from "date-fns";
import type { CalEvent, Calendar, Task } from "@aravos/shared";
import { parseDateString, toDateString } from "@aravos/shared";

export const HOUR_HEIGHT = 60;
export const GUTTER_WIDTH = 44;
export const SNAP_MINUTES = 15;
export const MINUTES_PER_DAY = 24 * 60;

export type View = "day" | "week";

export const CAL_COLORS = ["blue", "green", "yellow", "orange", "red", "pink", "purple", "gray", "graphite"] as const;

/** CSS color for a calendar or list color name. Token names map to the calendar palette; anything else is passed through. */
export function colorVar(name: string | null | undefined): string {
  if (!name) return "var(--cal-gray)";
  if ((CAL_COLORS as readonly string[]).includes(name)) return `var(--cal-${name})`;
  return name;
}

export function eventColor(ev: CalEvent, calendars: Map<string, Calendar> | undefined): string {
  if (ev.color) return colorVar(ev.color);
  const cal = ev.calendarId ? calendars?.get(ev.calendarId) : undefined;
  return colorVar(cal?.color ?? (ev.kind === "timebox" ? "graphite" : "gray"));
}

export const px = (minutes: number): number => (minutes / 60) * HOUR_HEIGHT;
export const minutesAt = (y: number): number => (y / HOUR_HEIGHT) * 60;
export const snap = (minutes: number, step = SNAP_MINUTES, mode: "round" | "floor" | "ceil" = "round"): number => {
  const f = mode === "floor" ? Math.floor : mode === "ceil" ? Math.ceil : Math.round;
  return f(minutes / step) * step;
};
export const clampMinutes = (m: number): number => Math.min(MINUTES_PER_DAY, Math.max(0, m));

export function dayStart(date: string): Date {
  return parseDateString(date);
}
export function dayMs(date: string): number {
  return parseDateString(date).getTime();
}
export function localDate(date: string, minutes: number): Date {
  const d = parseDateString(date);
  d.setMinutes(minutes);
  return d;
}
export function isoAt(date: string, minutes: number): string {
  return localDate(date, minutes).toISOString();
}
export function minutesOfDate(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function weekOf(date: string, weekStartsOn: 0 | 1 = 1): string[] {
  const start = startOfWeek(parseDateString(date), { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => toDateString(addDays(start, i)));
}
export function shiftDate(date: string, days: number): string {
  return toDateString(addDays(parseDateString(date), days));
}
export function daysApart(a: string, b: string): number {
  return differenceInCalendarDays(parseDateString(b), parseDateString(a));
}

/** A timed event clipped to one day's column, in minutes from local midnight. */
export interface DayItem {
  ev: CalEvent;
  startMin: number;
  endMin: number;
  /** True when the event starts on a previous day (no top gap). */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export function itemsForDay(events: CalEvent[], date: string): DayItem[] {
  const out: DayItem[] = [];
  for (const ev of events) {
    if (ev.allDay || ev.status === "cancelled") continue;
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) continue;
    // Wall-clock minutes, so a block sits where the clock says even on a DST day.
    const sd = toDateString(s);
    const ed = toDateString(e);
    if (sd > date || ed < date) continue;
    const startMin = sd < date ? 0 : minutesOfDate(s);
    const endMin = ed > date ? MINUTES_PER_DAY : minutesOfDate(e);
    if (endMin <= startMin) continue;
    out.push({ ev, startMin, endMin, continuesBefore: sd < date, continuesAfter: ed > date });
  }
  return out;
}

export function allDayForDay(events: CalEvent[], date: string): CalEvent[] {
  return events
    .filter((ev) => ev.allDay && ev.status !== "cancelled" && ev.start.slice(0, 10) <= date && ev.end.slice(0, 10) >= date)
    .sort((a, b) => (a.calendarId ?? "").localeCompare(b.calendarId ?? "") || a.title.localeCompare(b.title));
}

export interface Placed<T> {
  item: T;
  col: number;
  cols: number;
  span: number;
}

/**
 * Overlap layout (spec 3.3): sort by start then longest first, sweep into clusters, greedy columns,
 * then let each item expand rightward across columns with nothing overlapping it.
 */
export function packColumns<T extends { startMin: number; endMin: number }>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: Placed<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (!cluster.length) return;
    const columns: T[][] = [];
    const colOf = new Map<T, number>();
    for (const it of cluster) {
      // the minimum rendered height is 15 minutes, so very short items still take a column
      const idx = columns.findIndex((c) => (c[c.length - 1]?.endMin ?? -Infinity) <= it.startMin);
      if (idx >= 0) {
        columns[idx]!.push(it);
        colOf.set(it, idx);
      } else {
        columns.push([it]);
        colOf.set(it, columns.length - 1);
      }
    }
    const cols = columns.length;
    for (const it of cluster) {
      const col = colOf.get(it)!;
      let span = 1;
      for (let c = col + 1; c < cols; c++) {
        const blocked = columns[c]!.some((o) => o.startMin < it.endMin && o.endMin > it.startMin);
        if (blocked) break;
        span++;
      }
      out.push({ item: it, col, cols, span });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const it of sorted) {
    const visibleEnd = Math.max(it.endMin, it.startMin + SNAP_MINUTES);
    if (cluster.length && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, visibleEnd);
  }
  flush();
  return out;
}

/** First free slot of `duration` minutes on `date`, walking the 15-minute grid from `fromMin`. */
export function nextFreeSlot(events: CalEvent[], date: string, duration: number, fromMin: number, untilMin = 22 * 60): { start: string; end: string } {
  const items = itemsForDay(events, date);
  let t = snap(fromMin, SNAP_MINUTES, "ceil");
  while (t + duration <= untilMin) {
    const busy = items.some((it) => it.startMin < t + duration && it.endMin > t);
    if (!busy) return { start: isoAt(date, t), end: isoAt(date, t + duration) };
    t += SNAP_MINUTES;
  }
  const fallback = snap(fromMin, SNAP_MINUTES, "ceil");
  return { start: isoAt(date, fallback), end: isoAt(date, fallback + duration) };
}

export function defaultStartFor(date: string, now: Date): number {
  const today = toDateString(now);
  if (date === today) return Math.min(MINUTES_PER_DAY - 60, snap(minutesOfDate(now) + 1, 60, "ceil"));
  return 9 * 60;
}

export function taskHasBlockOn(task: Task, date: string): boolean {
  return (task.scheduledBlocks ?? []).some((b) => toDateString(new Date(b.start)) === date);
}

export const RRULE_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Never" },
  { value: "FREQ=DAILY", label: "Every day" },
  { value: "FREQ=WEEKLY", label: "Every week" },
  { value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "Every weekday" },
  { value: "FREQ=MONTHLY", label: "Every month" },
  { value: "FREQ=YEARLY", label: "Every year" },
];

export function rruleLabel(rrule: string | null): string {
  if (!rrule) return "Never";
  const key = rrule.replace(/^RRULE:/, "");
  return RRULE_PRESETS.find((p) => p.value === key)?.label ?? "Custom";
}

/** Ignore the click the browser synthesizes right after a touch gesture ends (it would land on whatever opened). */
export function swallowNextClick(ms = 400): void {
  if (typeof document === "undefined") return;
  let timer = 0;
  const handler = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    cleanup();
  };
  const cleanup = () => {
    document.removeEventListener("click", handler, true);
    window.clearTimeout(timer);
  };
  document.addEventListener("click", handler, true);
  timer = window.setTimeout(cleanup, ms);
}
