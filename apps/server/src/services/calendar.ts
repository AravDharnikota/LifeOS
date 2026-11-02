import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import rrulePkg from "rrule";
import type { RRule as RRuleType } from "rrule";
const { RRule, rrulestr } = rrulePkg;
import type { CalEvent, EventCreate, EventUpdate } from "@aravos/shared";
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

export function createEvent(db: Db, input: EventCreate, actor = "user"): CalEvent {
  const allDay = input.allDay ?? false;
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
      rrule: input.rrule ?? null,
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
  for (const k of ["title", "notes", "location", "calendarId", "timezone", "color", "kind", "taskId", "locked", "status", "rrule", "source"] as const) {
    if (input[k] !== undefined) (set as Record<string, unknown>)[k] = input[k];
  }
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

/** Create an exception for one instance of a recurring event (edit or cancel). */
export function overrideInstance(db: Db, parentId: string, originalStart: string, patch: EventUpdate & { cancel?: boolean }, actor = "user"): CalEvent | null {
  const parent = db.select().from(schema.events).where(and(eq(schema.events.id, parentId), isNull(schema.events.deletedAt))).get();
  if (!parent) throw notFound("Event");
  const existing = db.select().from(schema.events).where(and(eq(schema.events.recurrenceParentId, parentId), eq(schema.events.originalStart, originalStart), isNull(schema.events.deletedAt))).get();
  const durMs = new Date(parent.end).getTime() - new Date(parent.start).getTime();
  const base = {
    calendarId: parent.calendarId,
    title: parent.title,
    notes: parent.notes,
    location: parent.location,
    start: patch.start ?? existing?.start ?? originalStart,
    end: patch.end ?? existing?.end ?? new Date(new Date(originalStart).getTime() + durMs).toISOString(),
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
  const set = { ...base, ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && k !== "cancel")), updatedAt: nowIso() } as typeof schema.events.$inferInsert;
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
  to: string;
  calendarIds?: string[];
  includeCancelled?: boolean;
}

/** All events overlapping [from, to), with recurring rules expanded into instances. */
export function listEvents(db: Db, opts: RangeOptions): CalEvent[] {
  const from = new Date(opts.from);
  const to = new Date(opts.to);
  const fromDate = opts.from.slice(0, 10);
  const toDate = opts.to.slice(0, 10);
  const e = schema.events;
  const rows = db
    .select()
    .from(e)
    .where(
      and(
        isNull(e.deletedAt),
        or(
          // recurring masters: start before range end
          and(sql`${e.rrule} IS NOT NULL`, lte(e.start, opts.to)),
          // single timed events overlapping
          and(sql`${e.rrule} IS NULL`, eq(e.allDay, false), sql`${e.start} < ${opts.to}`, sql`${e.end} > ${opts.from}`),
          // all-day events overlapping by date
          and(sql`${e.rrule} IS NULL`, eq(e.allDay, true), lte(e.start, toDate), gte(e.end, fromDate)),
        ),
      ),
    )
    .orderBy(asc(e.start))
    .all();

  const taskIds = new Set(rows.filter((r) => r.taskId).map((r) => r.taskId!));
  const taskStatus = new Map<string, string>();
  if (taskIds.size) {
    const ts = db.select({ id: schema.tasks.id, status: schema.tasks.status }).from(schema.tasks).where(sql`${schema.tasks.id} in ${[...taskIds]}`).all();
    for (const t of ts) taskStatus.set(t.id, t.status);
  }
  const exceptions = new Map<string, Row>();
  for (const r of rows) if (r.recurrenceParentId && r.originalStart) exceptions.set(`${r.recurrenceParentId}|${r.originalStart}`, r);

  const out: CalEvent[] = [];
  for (const r of rows) {
    if (opts.calendarIds && r.calendarId && !opts.calendarIds.includes(r.calendarId)) continue;
    if (r.recurrenceParentId) continue; // exceptions are emitted while expanding their parent (or standalone below)
    const extra: Partial<CalEvent> = r.taskId ? { taskStatus: (taskStatus.get(r.taskId) as CalEvent["taskStatus"]) ?? "open" } : {};
    if (!r.rrule) {
      if (r.status === "cancelled" && !opts.includeCancelled) continue;
      out.push(serializeEvent(r, extra));
      continue;
    }
    const durMs = r.allDay ? 0 : new Date(r.end).getTime() - new Date(r.start).getTime();
    let rule: RRuleType;
    try {
      const dtstart = r.allDay ? new Date(r.start + "T00:00:00Z") : new Date(r.start);
      const parsed = rrulestr(r.rrule.startsWith("RRULE:") ? r.rrule : `RRULE:${r.rrule}`, { dtstart });
      rule = parsed instanceof RRule ? parsed : new RRule({ ...(parsed as RRuleType).origOptions, dtstart });
    } catch {
      out.push(serializeEvent(r, extra));
      continue;
    }
    const windowStart = new Date(from.getTime() - durMs - 1);
    const occurrences = rule.between(windowStart, to, true).slice(0, 400);
    for (const occ of occurrences) {
      const startIso = r.allDay ? occ.toISOString().slice(0, 10) : occ.toISOString();
      const ex = exceptions.get(`${r.id}|${startIso}`);
      if (ex) {
        if (ex.status === "cancelled" && !opts.includeCancelled) continue;
        out.push(serializeEvent(ex, { ...extra, instanceOf: r.id }));
        continue;
      }
      const endIso = r.allDay ? startIso : new Date(occ.getTime() + durMs).toISOString();
      out.push(serializeEvent({ ...r, start: startIso, end: endIso }, { ...extra, instanceOf: r.id, originalStart: startIso, id: `${r.id}_${startIso}` }));
    }
  }
  // standalone exceptions whose parent is outside the fetched window
  for (const r of rows) {
    if (!r.recurrenceParentId || !r.originalStart) continue;
    const parentIncluded = rows.some((p) => p.id === r.recurrenceParentId);
    if (parentIncluded) continue;
    if (r.status === "cancelled" && !opts.includeCancelled) continue;
    out.push(serializeEvent(r, { instanceOf: r.recurrenceParentId }));
  }
  out.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
  return out;
}

export function eventsOnDate(db: Db, date: string, tz?: string): CalEvent[] {
  // local-day window; the server runs in the user's timezone (set TZ) so Date parsing works
  const start = new Date(date + "T00:00:00");
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  void tz;
  return listEvents(db, { from: start.toISOString(), to: end.toISOString() });
}
