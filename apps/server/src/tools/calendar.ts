import { z } from "zod";
import { format } from "date-fns";
import { addDaysString, DATE_RE, toDateString, type CalEvent, type EventUpdate } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { badRequest } from "../lib/errors.ts";
import { createEvent, deleteEvent, eventsOnDate, getEvent, listEvents, overrideInstance, updateEvent } from "../services/calendar.ts";
import { defineTool, type ToolDef } from "./types.ts";

const DATETIME_DOC = "ISO 8601 datetime; include an offset (2026-11-02T14:00:00-08:00) or Z, a value without offset is read as local time";
const eventId = z.string().min(1).describe("Event id. Expanded recurring instances have ids like <parentId>_<instanceStart> and are handled as one occurrence");
const scope = z.enum(["this", "all"]).describe("For recurring events: this changes one occurrence (needs originalStart or an instance id), all changes the series");

/** Compact event row: no notes, ids and task state included. */
export function compactEvent(e: CalEvent) {
  return {
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    kind: e.kind,
    status: e.status,
    calendarId: e.calendarId,
    location: e.location,
    taskId: e.taskId,
    taskStatus: e.taskStatus ?? null,
    locked: e.locked,
    rrule: e.rrule,
    instanceOf: e.instanceOf ?? null,
    originalStart: e.originalStart,
  };
}

function parseBoundary(value: string, endOfDay: boolean): Date {
  if (DATE_RE.test(value)) return new Date((endOfDay ? addDaysString(value, 1) : value) + "T00:00:00");
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid datetime "${value}". Use ISO 8601 or YYYY-MM-DD.`);
  return d;
}

function normalizeDateTime(value: string): string {
  if (DATE_RE.test(value)) return value;
  return parseBoundary(value, false).toISOString();
}

function splitInstanceId(id: string): { parentId: string; originalStart: string } | null {
  const idx = id.indexOf("_");
  if (idx <= 0) return null;
  const originalStart = id.slice(idx + 1);
  return /^\d{4}-\d{2}-\d{2}/.test(originalStart) ? { parentId: id.slice(0, idx), originalStart } : null;
}

interface Target {
  id: string;
  /** originalStart of the single occurrence to change, or null for the whole event */
  instance: string | null;
}

function resolveTarget(db: Db, input: { id: string; scope?: "this" | "all"; originalStart?: string }): Target {
  const split = splitInstanceId(input.id);
  const id = split ? split.parentId : input.id;
  const originalStart = input.originalStart ?? split?.originalStart;
  if (input.scope === "all" || !originalStart) {
    if (input.scope === "this") throw badRequest("scope \"this\" needs originalStart (the occurrence's start) or an instance id");
    return { id, instance: null };
  }
  const parent = getEvent(db, id);
  return { id, instance: parent.rrule ? normalizeDateTime(originalStart) : null };
}

const SNAP_MS = 15 * 60 * 1000;
const snapUp = (ms: number): number => Math.ceil(ms / SNAP_MS) * SNAP_MS;
const snapDown = (ms: number): number => Math.floor(ms / SNAP_MS) * SNAP_MS;

function busyIntervals(db: Db, from: Date, to: Date): [number, number][] {
  const events = listEvents(db, { from: from.toISOString(), to: to.toISOString() }).filter((e) => !e.allDay && e.status === "confirmed");
  const sorted = events.map((e): [number, number] => [Date.parse(e.start), Date.parse(e.end)]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

function searchWindows(from: Date, to: Date, workHoursOnly: boolean): [number, number][] {
  if (!workHoursOnly) return [[from.getTime(), to.getTime()]];
  const out: [number, number][] = [];
  const last = toDateString(to);
  for (let date = toDateString(from); date <= last; date = addDaysString(date, 1)) {
    const s = Math.max(from.getTime(), new Date(date + "T08:00:00").getTime());
    const e = Math.min(to.getTime(), new Date(date + "T22:00:00").getTime());
    if (e > s) out.push([s, e]);
  }
  return out;
}

function freeSlots(windows: [number, number][], busy: [number, number][], durationMs: number, limit: number): [number, number][] {
  const slots: [number, number][] = [];
  for (const [ws, we] of windows) {
    let cursor = snapUp(ws);
    for (const [bs, be] of busy) {
      if (be <= cursor) continue;
      if (bs >= we) break;
      const gapEnd = snapDown(Math.min(bs, we));
      if (gapEnd - cursor >= durationMs) slots.push([cursor, gapEnd]);
      cursor = Math.max(cursor, snapUp(be));
      if (cursor >= we) break;
    }
    const tail = snapDown(we);
    if (tail - cursor >= durationMs) slots.push([cursor, tail]);
    if (slots.length >= limit) break;
  }
  return slots.slice(0, limit);
}

const localLabel = (s: number, e: number): string => `${format(new Date(s), "EEE yyyy-MM-dd HH:mm")}-${format(new Date(e), "HH:mm")}`;

const getEventsTool = defineTool({
  name: "get_events",
  description:
    "List calendar events and time boxes overlapping a range, with recurring events expanded into instances. from/to accept ISO datetimes or YYYY-MM-DD local dates (a date-only to is inclusive of that whole day). Default: the next 7 days from now. Time boxes (kind timebox) carry taskId and taskStatus. Timestamps in results are UTC ISO; all-day events use YYYY-MM-DD.",
  input: z.object({
    from: z.string().optional().describe("ISO datetime or YYYY-MM-DD; default now"),
    to: z.string().optional().describe("ISO datetime or YYYY-MM-DD (inclusive day); default from + 7 days"),
    limit: z.number().int().min(1).max(200).optional().describe("Maximum rows, default 100"),
  }),
  readOnly: true,
  handler: (i, { ctx }) => {
    const from = i.from ? parseBoundary(i.from, false) : new Date();
    const to = i.to ? parseBoundary(i.to, true) : new Date(from.getTime() + 7 * 24 * 3600 * 1000);
    if (to <= from) throw badRequest("to must be after from");
    const limit = i.limit ?? 100;
    const events = listEvents(ctx.db, { from: from.toISOString(), to: to.toISOString() });
    return { from: from.toISOString(), to: to.toISOString(), count: events.length, truncated: events.length > limit, events: events.slice(0, limit).map(compactEvent) };
  },
});

const getDayEventsTool = defineTool({
  name: "get_day_events",
  description: "Events and time boxes on one local day (YYYY-MM-DD), recurring events expanded.",
  input: z.object({ date: z.string().regex(DATE_RE, "Expected YYYY-MM-DD").describe("YYYY-MM-DD local") }),
  readOnly: true,
  handler: ({ date }, { ctx }) => {
    const events = eventsOnDate(ctx.db, date);
    return { date, count: events.length, events: events.map(compactEvent) };
  },
});

const addEventTool = defineTool({
  name: "add_event",
  description:
    `Create a calendar event. start/end: ${DATETIME_DOC}; for allDay events pass YYYY-MM-DD dates (end on or after start). Pass taskId to create a time box for a task (kind becomes timebox). locked keeps the scheduler from moving it. rrule makes it recurring (RRULE string such as FREQ=WEEKLY;BYDAY=MO,WE).`,
  input: z.object({
    title: z.string().trim().min(1).max(500),
    start: z.string().min(10).describe(DATETIME_DOC),
    end: z.string().min(10).describe("Must be after start"),
    allDay: z.boolean().optional(),
    calendarId: z.string().optional().describe("Default: the default calendar (or the Time boxes calendar for time boxes)"),
    notes: z.string().max(10000).optional(),
    location: z.string().max(500).optional(),
    rrule: z.string().max(500).optional(),
    color: z.string().max(40).optional(),
    taskId: z.string().optional().describe("Make this a time box for the task"),
    locked: z.boolean().optional().describe("Pin it so the scheduler never moves it"),
  }),
  handler: (i, { ctx, actor }) => compactEvent(createEvent(ctx.db, i, actor)),
});

const updateEventTool = defineTool({
  name: "update_event",
  description:
    `Update an event. Only passed fields change. For a recurring series pass scope "this" with originalStart (or just the instance id from get_events) to change one occurrence, or scope "all" for the whole series. start/end: ${DATETIME_DOC}.`,
  input: z.object({
    id: eventId,
    scope: scope.optional(),
    originalStart: z.string().optional().describe("Start of the occurrence to change (from get_events), used with scope this"),
    title: z.string().trim().min(1).max(500).optional(),
    start: z.string().min(10).optional(),
    end: z.string().min(10).optional(),
    allDay: z.boolean().optional(),
    notes: z.string().max(10000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    calendarId: z.string().optional(),
    rrule: z.string().max(500).nullable().optional().describe("null removes the recurrence"),
    color: z.string().max(40).nullable().optional(),
    taskId: z.string().nullable().optional(),
    locked: z.boolean().optional(),
    status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
  }),
  handler: (i, { ctx, actor }) => {
    const { id, scope: sc, originalStart, ...patch } = i;
    const target = resolveTarget(ctx.db, { id, scope: sc, originalStart });
    if (target.instance) {
      const instancePatch: EventUpdate = { ...patch, start: patch.start ? normalizeDateTime(patch.start) : undefined, end: patch.end ? normalizeDateTime(patch.end) : undefined };
      const res = overrideInstance(ctx.db, target.id, target.instance, instancePatch, actor);
      return res ? compactEvent(res) : { ok: true };
    }
    return compactEvent(updateEvent(ctx.db, target.id, patch, actor));
  },
});

const deleteEventTool = defineTool({
  name: "delete_event",
  description: "Delete an event. For a recurring series, scope \"this\" with originalStart (or an instance id) cancels only that occurrence; otherwise the whole series is deleted.",
  input: z.object({ id: eventId, scope: scope.optional(), originalStart: z.string().optional() }),
  destructive: true,
  handler: (i, { ctx, actor }) => {
    const target = resolveTarget(ctx.db, i);
    if (target.instance) overrideInstance(ctx.db, target.id, target.instance, { cancel: true }, actor);
    else deleteEvent(ctx.db, target.id, actor);
    return { ok: true, id: target.id, occurrence: target.instance };
  },
});

const findFreeTimeTool = defineTool({
  name: "find_free_time",
  description:
    "Find free gaps between confirmed timed events (all-day events are ignored) that are at least durationMinutes long. Gaps are snapped to a 15-minute grid. workHoursOnly limits the search to 08:00-22:00 local on each day. from/to accept ISO datetimes or YYYY-MM-DD (to is inclusive of the day). Each slot is a whole gap; pick a start inside it when adding an event.",
  input: z.object({
    from: z.string().describe("ISO datetime or YYYY-MM-DD"),
    to: z.string().describe("ISO datetime or YYYY-MM-DD (inclusive day)"),
    durationMinutes: z.number().int().min(5).max(1440),
    workHoursOnly: z.boolean().optional().describe("Only 08:00-22:00 local; default false"),
    limit: z.number().int().min(1).max(50).optional().describe("Maximum slots, default 20"),
  }),
  readOnly: true,
  handler: (i, { ctx }) => {
    const from = parseBoundary(i.from, false);
    const to = parseBoundary(i.to, true);
    if (to <= from) throw badRequest("to must be after from");
    const slots = freeSlots(searchWindows(from, to, i.workHoursOnly ?? false), busyIntervals(ctx.db, from, to), i.durationMinutes * 60 * 1000, i.limit ?? 20);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      durationMinutes: i.durationMinutes,
      count: slots.length,
      slots: slots.map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), minutes: Math.round((e - s) / 60000), local: localLabel(s, e) })),
    };
  },
});

const moveEventTool = defineTool({
  name: "move_event",
  description: `Move an event or time box to a new start/end (${DATETIME_DOC}). lock true pins it so the scheduler will not move it again. Instance ids move one occurrence of a recurring event.`,
  input: z.object({ id: eventId, start: z.string().min(10), end: z.string().min(10), lock: z.boolean().optional() }),
  handler: ({ id, start, end, lock }, { ctx, actor }) => {
    const target = resolveTarget(ctx.db, { id });
    const patch: EventUpdate = { start, end, ...(lock === undefined ? {} : { locked: lock }) };
    if (target.instance) {
      const res = overrideInstance(ctx.db, target.id, target.instance, { ...patch, start: normalizeDateTime(start), end: normalizeDateTime(end) }, actor);
      return res ? compactEvent(res) : { ok: true };
    }
    return compactEvent(updateEvent(ctx.db, target.id, patch, actor));
  },
});

export const calendarTools: ToolDef[] = [getEventsTool, getDayEventsTool, addEventTool, updateEventTool, deleteEventTool, findFreeTimeTool, moveEventTool];
