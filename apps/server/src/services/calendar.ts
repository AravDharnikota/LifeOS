import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import rrulePkg from "rrule";
import type { RRule as RRuleType } from "rrule";
import { buildRule, occurrencesBetween, validateRrule } from "../lib/rrule.ts";
const { RRule } = rrulePkg;
import { addDaysString, daysBetween, toDateString, type CalEvent, type EventCreate, type EventUpdate } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { logActivity } from "./activity.ts";

type Row = typeof schema.events.$inferSelect;

export function serializeEvent(row: Row, extra: Partial<CalEvent> = {}): CalEvent {
  return {
    id: row.id,
    calendarId: row.calendarId,
    title: row.title,
    notes: row.notes,
    location: row.location,
    start: row.start,
    end: row.end,
    allDay: row.allDay,
    timezone: row.timezone,
    color: row.color,
    kind: row.kind as CalEvent["kind"],
    taskId: row.taskId,
    locked: row.locked,
    status: row.status as CalEvent["status"],
    rrule: row.rrule,
    recurrenceParentId: row.recurrenceParentId,
    originalStart: row.originalStart,
    source: row.source,
    googleId: row.googleId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ...extra,
  };
}

export function defaultCalendarId(db: Db): string | null {
  return (
    db.select({ id: schema.calendars.id }).from(schema.calendars).where(and(eq(schema.calendars.isDefault, true), isNull(schema.calendars.deletedAt))).get()?.id ??
    db.select({ id: schema.calendars.id }).from(schema.calendars).where(isNull(schema.calendars.deletedAt)).get()?.id ??
    null
  );
}

export function timeboxCalendarId(db: Db): string | null {
  return db.select({ id: schema.calendars.id }).from(schema.calendars).where(and(eq(schema.calendars.name, "Time boxes"), isNull(schema.calendars.deletedAt))).get()?.id ?? defaultCalendarId(db);
}

function validateRange(start: string, end: string, allDay: boolean): void {
  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(start) || !/^\d{4}-\d{2}-\d{2}/.test(end)) throw badRequest("All-day events need YYYY-MM-DD start/end");
    if (end.slice(0, 10) < start.slice(0, 10)) throw badRequest("end must be on or after start");
  } else {
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (Number.isNaN(s) || Number.isNaN(e)) throw badRequest("start/end must be ISO datetimes");
    if (e <= s) throw badRequest("end must be after start");
  }
}

function normalize(start: string, end: string, allDay: boolean): { start: string; end: string } {
  if (allDay) return { start: start.slice(0, 10), end: end.slice(0, 10) };
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

function assertCalendar(db: Db, id: string): void {
  if (!db.select({ id: schema.calendars.id }).from(schema.calendars).where(and(eq(schema.calendars.id, id), isNull(schema.calendars.deletedAt))).get()) throw badRequest("Unknown calendarId");
}

export function createEvent(db: Db, input: EventCreate, actor = "user"): CalEvent {
  const allDay = input.allDay ?? false;
  if (input.calendarId) assertCalendar(db, input.calendarId);
  validateRange(input.start, input.end, allDay);
  const { start, end } = normalize(input.start, input.end, allDay);
  const id = newId();
  const kind = input.kind ?? (input.taskId ? "timebox" : "event");
  db.insert(schema.events)
    .values({
      id,
      calendarId: input.calendarId ?? (kind === "timebox" ? timeboxCalendarId(db) : defaultCalendarId(db)),
      title: input.title,
      notes: input.notes ?? null,
      location: input.location ?? null,
      start,
      end,
      allDay,
      timezone: input.timezone ?? null,
      color: input.color ?? null,
      kind,
      taskId: input.taskId ?? null,
      locked: input.locked ?? false,
      status: input.status ?? "confirmed",
      rrule: validateRrule(input.rrule),
      source: input.source ?? (actor === "user" ? "app" : actor),
    })
    .run();
  logActivity(db, { actor, action: "created", entity: "event", entityId: id, summary: `Added event "${input.title}"` });
  return getEvent(db, id);
}

export function getEvent(db: Db, id: string): CalEvent {
  const row = db.select().from(schema.events).where(and(eq(schema.events.id, id), isNull(schema.events.deletedAt))).get();
  if (!row) throw notFound("Event");
  return serializeEvent(row);
}

export function updateEvent(db: Db, id: string, input: EventUpdate, actor = "user"): CalEvent {
  const existing = db.select().from(schema.events).where(and(eq(schema.events.id, id), isNull(schema.events.deletedAt))).get();
  if (!existing) throw notFound("Event");
  const allDay = input.allDay ?? existing.allDay;
  const start = input.start ?? existing.start;
  const end = input.end ?? existing.end;
  validateRange(start, end, allDay);
  const norm = normalize(start, end, allDay);
  const set: Partial<typeof schema.events.$inferInsert> = { updatedAt: nowIso(), start: norm.start, end: norm.end, allDay };
  for (const k of ["title", "notes", "location", "calendarId", "timezone", "color", "kind", "taskId", "locked", "status", "source"] as const) {
    if (input[k] !== undefined) (set as Record<string, unknown>)[k] = input[k];
  }
  if (input.rrule !== undefined) set.rrule = validateRrule(input.rrule);
  if (input.calendarId) assertCalendar(db, input.calendarId);
  db.update(schema.events).set(set).where(eq(schema.events.id, id)).run();
  logActivity(db, { actor, action: "updated", entity: "event", entityId: id, summary: `Updated event "${set.title ?? existing.title}"`, data: input });
  return getEvent(db, id);
}

export function deleteEvent(db: Db, id: string, actor = "user"): void {
  const existing = db.select().from(schema.events).where(and(eq(schema.events.id, id), isNull(schema.events.deletedAt))).get();
  if (!existing) throw notFound("Event");
  const now = nowIso();
  db.update(schema.events).set({ deletedAt: now, updatedAt: now }).where(or(eq(schema.events.id, id), eq(schema.events.recurrenceParentId, id))).run();
  logActivity(db, { actor, action: "deleted", entity: "event", entityId: id, summary: `Deleted event "${existing.title}"` });
}

/** Local wall-clock fields of an instant, encoded as a UTC "floating" date for rrule. */
const toFloating = (d: Date): Date => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
/** Inverse of toFloating: a floating date back to the real instant in the process timezone. */
const fromFloating = (d: Date): Date => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
const utcMidnight = (date: string): Date => new Date(date + "T00:00:00Z");

function normalizeOriginalStart(parent: Row, originalStart: string): string {
  if (parent.allDay) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(originalStart)) throw badRequest("originalStart must be YYYY-MM-DD for all-day events");
    return originalStart.slice(0, 10);
  }
  const t = Date.parse(originalStart);
  if (Number.isNaN(t)) throw badRequest("originalStart must be an ISO datetime");
  return new Date(t).toISOString();
}

/** Create an exception for one instance of a recurring event (edit or cancel). */
export function overrideInstance(db: Db, parentId: string, originalStartRaw: string, patch: EventUpdate & { cancel?: boolean }, actor = "user"): CalEvent | null {
  const parent = db.select().from(schema.events).where(and(eq(schema.events.id, parentId), isNull(schema.events.deletedAt))).get();
  if (!parent) throw notFound("Event");
  if (!parent.rrule) throw badRequest("Event is not recurring");
  const originalStart = normalizeOriginalStart(parent, originalStartRaw);
  const existing = db.select().from(schema.events).where(and(eq(schema.events.recurrenceParentId, parentId), eq(schema.events.originalStart, originalStart), isNull(schema.events.deletedAt))).get();
  const defaultEnd = parent.allDay ? addDaysString(originalStart, Math.max(0, daysBetween(parent.start, parent.end))) : new Date(Date.parse(originalStart) + (new Date(parent.end).getTime() - new Date(parent.start).getTime())).toISOString();
  const base = {
    calendarId: parent.calendarId,
    title: parent.title,
    notes: parent.notes,
    location: parent.location,
    start: patch.start ?? existing?.start ?? originalStart,
    end: patch.end ?? existing?.end ?? defaultEnd,
    allDay: parent.allDay,
    timezone: parent.timezone,
    color: parent.color,
    kind: parent.kind,
    taskId: parent.taskId,
    locked: parent.locked,
    status: patch.cancel ? "cancelled" : (patch.status ?? existing?.status ?? "confirmed"),
    rrule: null,
    recurrenceParentId: parentId,
    originalStart,
    source: parent.source,
  };
  const set = { ...base, ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && !["cancel", "rrule", "recurrenceParentId", "originalStart", "allDay"].includes(k))), updatedAt: nowIso() } as typeof schema.events.$inferInsert;
  validateRange(set.start, set.end, parent.allDay);
  Object.assign(set, normalize(set.start, set.end, parent.allDay));
  if (existing) {
    db.update(schema.events).set(set).where(eq(schema.events.id, existing.id)).run();
    return patch.cancel ? null : getEvent(db, existing.id);
  }
  const id = newId();
  db.insert(schema.events).values({ ...set, id }).run();
  logActivity(db, { actor, action: patch.cancel ? "deleted" : "updated", entity: "event", entityId: id, summary: `${patch.cancel ? "Removed" : "Changed"} one occurrence of "${parent.title}"` });
  return patch.cancel ? null : getEvent(db, id);
}

export interface RangeOptions {
  from: string; // ISO datetime
  to: string; // exclusive
  calendarIds?: string[];
  includeCancelled?: boolean;
}

function overlapsWindow(r: Row, from: Date, to: Date, fromDate: string, lastDate: string): boolean {
  if (r.allDay) return r.start <= lastDate && r.end >= fromDate;
  return r.start < to.toISOString() && r.end > from.toISOString();
}

/**
 * All events overlapping [from, to), with recurring rules expanded into instances.
 * Timed series are expanded in the user's local wall-clock time (process TZ), so an 09:00 daily
 * event stays at 09:00 across DST changes and weekly BYDAY rules follow local weekdays.
 */
export function listEvents(db: Db, opts: RangeOptions): CalEvent[] {
  const from = new Date(opts.from);
  const to = new Date(opts.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw badRequest("Invalid range");
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const fromDate = toDateString(from);
  const lastDate = toDateString(new Date(to.getTime() - 1));
  const e = schema.events;
  const rows = db
    .select()
    .from(e)
    .where(
      and(
        isNull(e.deletedAt),
        or(
          and(sql`${e.rrule} IS NOT NULL`, eq(e.allDay, false), sql`${e.start} < ${toIso}`),
          and(sql`${e.rrule} IS NOT NULL`, eq(e.allDay, true), lte(e.start, lastDate)),
          and(sql`${e.rrule} IS NULL`, eq(e.allDay, false), sql`${e.start} < ${toIso}`, sql`${e.end} > ${fromIso}`),
          and(sql`${e.rrule} IS NULL`, eq(e.allDay, true), lte(e.start, lastDate), gte(e.end, fromDate)),
        ),
      ),
    )
    .orderBy(asc(e.start))
    .all();

  const masters = rows.filter((r) => r.rrule);
  const exceptionRows = new Map<string, Row>();
  for (const r of rows) if (r.recurrenceParentId) exceptionRows.set(r.id, r);
  if (masters.length) {
    const extra = db.select().from(e).where(and(isNull(e.deletedAt), inArray(e.recurrenceParentId, masters.map((m) => m.id)))).all();
    for (const r of extra) exceptionRows.set(r.id, r);
  }
  const exceptionByKey = new Map<string, Row>();
  for (const r of exceptionRows.values()) if (r.recurrenceParentId && r.originalStart) exceptionByKey.set(`${r.recurrenceParentId}|${r.originalStart}`, r);

  const taskIds = new Set([...rows, ...exceptionRows.values()].filter((r) => r.taskId).map((r) => r.taskId!));
  const taskStatus = new Map<string, string>();
  if (taskIds.size) {
    const ts = db.select({ id: schema.tasks.id, status: schema.tasks.status }).from(schema.tasks).where(inArray(schema.tasks.id, [...taskIds])).all();
    for (const t of ts) taskStatus.set(t.id, t.status);
  }
  const extraFor = (r: Row): Partial<CalEvent> => (r.taskId ? { taskStatus: (taskStatus.get(r.taskId) as CalEvent["taskStatus"]) ?? "open" } : {});
  const visibleCalendar = (r: Row) => !opts.calendarIds || !r.calendarId || opts.calendarIds.includes(r.calendarId);

  const out: CalEvent[] = [];
  for (const r of rows) {
    if (r.recurrenceParentId || !visibleCalendar(r)) continue;
    if (!r.rrule) {
      if (r.status === "cancelled" && !opts.includeCancelled) continue;
      out.push(serializeEvent(r, extraFor(r)));
      continue;
    }
    let rule: RRuleType;
    let occurrences: Date[];
    try {
      if (r.allDay) {
        rule = buildRule(r.rrule, utcMidnight(r.start));
        occurrences = occurrencesBetween(rule, utcMidnight(fromDate), utcMidnight(lastDate), 400);
      } else {
        const durMs = new Date(r.end).getTime() - new Date(r.start).getTime();
        const base = buildRule(r.rrule, toFloating(new Date(r.start)));
        const until = base.origOptions.until ? toFloating(base.origOptions.until) : undefined;
        rule = until ? new RRule({ ...base.origOptions, until }) : base;
        occurrences = occurrencesBetween(rule, new Date(toFloating(from).getTime() - durMs + 1), new Date(toFloating(to).getTime() - 1), 400);
      }
    } catch {
      out.push(serializeEvent(r, extraFor(r)));
      continue;
    }
    const spanDays = r.allDay ? Math.max(0, daysBetween(r.start, r.end)) : 0;
    const durMs = r.allDay ? 0 : new Date(r.end).getTime() - new Date(r.start).getTime();
    for (const occ of occurrences) {
      const instant = r.allDay ? null : fromFloating(occ);
      const startIso = r.allDay ? occ.toISOString().slice(0, 10) : instant!.toISOString();
      if (exceptionByKey.has(`${r.id}|${startIso}`)) continue;
      const endIso = r.allDay ? addDaysString(startIso, spanDays) : new Date(instant!.getTime() + durMs).toISOString();
      out.push(serializeEvent({ ...r, start: startIso, end: endIso }, { ...extraFor(r), instanceOf: r.id, originalStart: startIso, id: `${r.id}_${startIso}` }));
    }
  }
  for (const r of exceptionRows.values()) {
    if (!visibleCalendar(r) || !overlapsWindow(r, from, to, fromDate, lastDate)) continue;
    if (r.status === "cancelled" && !opts.includeCancelled) continue;
    out.push(serializeEvent(r, { ...extraFor(r), instanceOf: r.recurrenceParentId ?? undefined }));
  }
  out.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
  return out;
}

/** Events on a local calendar day (DST-safe: the window ends at the next local midnight). */
export function eventsOnDate(db: Db, date: string): CalEvent[] {
  const start = new Date(date + "T00:00:00");
  const end = new Date(addDaysString(date, 1) + "T00:00:00");
  return listEvents(db, { from: start.toISOString(), to: end.toISOString() });
}
