import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CalEvent, Calendar, EventCreate, EventUpdate } from "@aravos/shared";
import { api } from "@/lib/api";
import { useApiMutation, useCalendars, useEvents, useAppSettings } from "@/data/queries";
import { useCalendar } from "./state";
import { isoAt, shiftDate, weekOf } from "./model";

/** Keep the last loaded value while a new range is loading, so paging between weeks never blanks the grid. */
function useSticky<T>(value: T | undefined): T | undefined {
  const last = useRef<T | undefined>(value);
  useEffect(() => {
    if (value !== undefined) last.current = value;
  }, [value]);
  return value ?? last.current;
}

/**
 * Events for the week around the selected date (plus a week either side on mobile so the day pager
 * always has its neighbours), filtered by hidden calendars.
 */
export function useCalendarData(opts: { padWeeks?: number } = {}) {
  const date = useCalendar((s) => s.date);
  const hidden = useCalendar((s) => s.hidden);
  const { weekStartsOn } = useAppSettings();
  const week = useMemo(() => weekOf(date, weekStartsOn), [date, weekStartsOn]);
  const pad = opts.padWeeks ?? 0;
  const from = useMemo(() => isoAt(shiftDate(week[0]!, -7 * pad), 0), [week, pad]);
  const to = useMemo(() => isoAt(shiftDate(week[6]!, 1 + 7 * pad), 0), [week, pad]);
  const eventsQ = useEvents(from, to);
  const calendarsQ = useCalendars();
  const rawEvents = useSticky(eventsQ.data);
  const calendars = useMemo(() => {
    const m = new Map<string, Calendar>();
    for (const c of calendarsQ.data ?? []) m.set(c.id, c as Calendar);
    return m;
  }, [calendarsQ.data]);
  const events = useMemo(() => {
    const list = rawEvents ?? [];
    return list.filter((ev) => {
      if (!ev.calendarId) return true;
      if (hidden.includes(ev.calendarId)) return false;
      const cal = calendars.get(ev.calendarId);
      return cal ? cal.isVisible !== false || ev.kind === "timebox" : true;
    });
  }, [rawEvents, hidden, calendars]);
  return {
    date,
    week,
    weekStartsOn,
    events,
    allEvents: rawEvents ?? [],
    calendars,
    calendarList: (calendarsQ.data ?? []) as Calendar[],
    loading: eventsQ.isLoading && rawEvents === undefined,
    error: eventsQ.error ?? calendarsQ.error ?? null,
    refetch: () => {
      void eventsQ.refetch();
      void calendarsQ.refetch();
    },
  };
}

export interface MoveInput {
  ev: CalEvent;
  start: string;
  end: string;
}

/** Writes that update the events cache optimistically so a drop never flashes back. */
export function useEventMutations() {
  const qc = useQueryClient();
  const patchCache = (fn: (list: CalEvent[]) => CalEvent[]) => qc.setQueriesData<CalEvent[]>({ queryKey: ["events"] }, (old) => (old ? fn(old) : old));

  const create = useApiMutation((input: EventCreate) => api.post<CalEvent>("/api/events", input), ["events", "tasks", "summary"]);

  const move = useApiMutation(async ({ ev, start, end }: MoveInput) => {
    patchCache((list) => list.map((e) => (e.id === ev.id ? { ...e, start, end } : e)));
    if (ev.instanceOf && ev.originalStart) {
      return api.patch<CalEvent>(`/api/events/${ev.instanceOf}`, { scope: "this", originalStart: ev.originalStart, start, end });
    }
    return api.patch<CalEvent>(`/api/events/${ev.id}`, { start, end });
  }, ["events", "tasks", "summary"]);

  const update = useApiMutation(async ({ ev, patch, scope }: { ev: CalEvent; patch: EventUpdate; scope?: "this" | "all" }) => {
    patchCache((list) => list.map((e) => (e.id === ev.id ? { ...e, ...patch } : e)));
    if (ev.instanceOf && (scope ?? "this") === "this" && ev.originalStart) {
      return api.patch<CalEvent>(`/api/events/${ev.instanceOf}`, { scope: "this", originalStart: ev.originalStart, ...patch });
    }
    const id = ev.instanceOf ?? ev.id;
    return api.patch<CalEvent>(`/api/events/${id}`, patch);
  }, ["events", "tasks", "summary"]);

  const remove = useApiMutation(async ({ ev, scope }: { ev: CalEvent; scope?: "this" | "all" }) => {
    patchCache((list) => list.filter((e) => (scope === "all" && ev.instanceOf ? e.instanceOf !== ev.instanceOf && e.id !== ev.instanceOf : e.id !== ev.id)));
    if (ev.instanceOf && (scope ?? "this") === "this" && ev.originalStart) {
      return api.delete(`/api/events/${ev.instanceOf}?scope=this&originalStart=${encodeURIComponent(ev.originalStart)}`);
    }
    return api.delete(`/api/events/${ev.instanceOf ?? ev.id}`);
  }, ["events", "tasks", "summary"]);

  const completeTask = useApiMutation(async (ev: CalEvent) => {
    if (!ev.taskId) return null;
    patchCache((list) => list.map((e) => (e.taskId === ev.taskId ? { ...e, taskStatus: "done" } : e)));
    return api.post(`/api/tasks/${ev.taskId}/complete`, {});
  }, ["events", "tasks", "summary"]);

  const reopenTask = useApiMutation(async (ev: CalEvent) => {
    if (!ev.taskId) return null;
    patchCache((list) => list.map((e) => (e.taskId === ev.taskId ? { ...e, taskStatus: "open" } : e)));
    return api.post(`/api/tasks/${ev.taskId}/reopen`, {});
  }, ["events", "tasks", "summary"]);

  return { create, move, update, remove, completeTask, reopenTask };
}
