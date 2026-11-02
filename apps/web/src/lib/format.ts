import { format, isToday, isTomorrow, isYesterday, parseISO, differenceInCalendarDays } from "date-fns";
import { parseDateString } from "@aravos/shared";

const nf = new Intl.NumberFormat("en-US");
export const fmtInt = (n: number): string => nf.format(Math.round(n));
export const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });

/** "Mon 2 Nov" */
export function fmtDate(d: Date | string): string {
  const date = typeof d === "string" ? (d.length === 10 ? parseDateString(d) : parseISO(d)) : d;
  return format(date, "EEE d MMM");
}
/** "Monday 2 November" */
export function fmtDateLong(d: Date | string): string {
  const date = typeof d === "string" ? (d.length === 10 ? parseDateString(d) : parseISO(d)) : d;
  return format(date, "EEEE d MMMM");
}
/** "Today", "Tomorrow", "Yesterday", "Mon 2 Nov" */
export function fmtRelativeDate(d: Date | string, withWeekday = true): string {
  const date = typeof d === "string" ? (d.length === 10 ? parseDateString(d) : parseISO(d)) : d;
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isYesterday(date)) return "Yesterday";
  const diff = differenceInCalendarDays(date, new Date());
  if (diff > 1 && diff < 7) return format(date, "EEEE");
  return withWeekday ? format(date, "EEE d MMM") : format(date, "d MMM");
}
/** "14:30" or "2:30 PM" based on locale preference; AravOS uses 24h by default. */
export function fmtTime(d: Date | string, hour12 = false): string {
  const date = typeof d === "string" ? parseISO(d) : d;
  return hour12 ? format(date, "h:mm a") : format(date, "HH:mm");
}
export function fmtTimeRange(start: string, end: string, hour12 = false): string {
  return `${fmtTime(start, hour12)} to ${fmtTime(end, hour12)}`;
}
/** "7h 40m", "45m" */
export function fmtMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
export function fmtWeight(kg: number, units: "metric" | "imperial"): string {
  return units === "imperial" ? `${fmt1(kg / 0.45359237)} lb` : `${fmt1(kg)} kg`;
}
export function toDisplayWeight(kg: number, units: "metric" | "imperial"): number {
  return units === "imperial" ? Math.round((kg / 0.45359237) * 10) / 10 : Math.round(kg * 10) / 10;
}
export function fromDisplayWeight(v: number, units: "metric" | "imperial"): number {
  return units === "imperial" ? v * 0.45359237 : v;
}
export function fmtMl(ml: number, units: "metric" | "imperial"): string {
  return units === "imperial" ? `${Math.round(ml / 29.5735)} oz` : ml >= 1000 ? `${fmt1(ml / 1000)} L` : `${ml} ml`;
}
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}
