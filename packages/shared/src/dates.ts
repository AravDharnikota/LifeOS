// Date helpers shared by server and web. All "local" dates are YYYY-MM-DD strings.
import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toDateString(d: Date): string {
  return format(d, "yyyy-MM-dd");
}
export function todayString(): string {
  return toDateString(new Date());
}
export function parseDateString(s: string): Date {
  // local midnight
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}
export function addDaysString(s: string, n: number): string {
  return toDateString(addDays(parseDateString(s), n));
}
export function daysBetween(a: string, b: string): number {
  return differenceInCalendarDays(parseDateString(b), parseDateString(a));
}
export function weekStartString(s: string, weekStartsOn: 0 | 1 = 1): string {
  return toDateString(startOfWeek(parseDateString(s), { weekStartsOn }));
}
export function dateOfIso(iso: string): string {
  return toDateString(parseISO(iso));
}
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}
export function minutesToHhmm(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
export function roundToStep(min: number, step: number, mode: "floor" | "ceil" | "round" = "round"): number {
  const f = mode === "floor" ? Math.floor : mode === "ceil" ? Math.ceil : Math.round;
  return f(min / step) * step;
}
/** Combine YYYY-MM-DD + HH:mm (local) into a Date */
export function localDateTime(date: string, hhmm: string): Date {
  const d = parseDateString(date);
  const m = hhmmToMinutes(hhmm);
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d;
}
export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
