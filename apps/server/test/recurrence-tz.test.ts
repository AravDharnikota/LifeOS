import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "./helpers.ts";
import type { CalEvent, Task } from "@aravos/shared";

// Runs with process TZ = America/Los_Angeles (set by createApp). DST ended on 2026-11-01.
const t = makeTestApp({ timezone: "America/Los_Angeles" });
afterAll(() => t.cleanup());

const la = (local: string) => new Date(local).toISOString(); // local wall-clock -> ISO instant

describe("recurring timed events across DST", () => {
  it("keeps a daily 09:00 event at 09:00 local after the DST change", async () => {
    const ev = await t.api<CalEvent>("POST", "/api/events", { title: "Standup", start: la("2026-10-26T09:00:00"), end: la("2026-10-26T09:15:00"), rrule: "FREQ=DAILY" });
    const r = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-10-31T00:00:00")}&to=${la("2026-11-04T00:00:00")}`);
    const inst = r.data.filter((e) => e.instanceOf === ev.data.id);
    expect(inst.map((e) => new Date(e.start).getHours())).toEqual([9, 9, 9, 9]);
    expect(inst.map((e) => e.start)).toEqual([la("2026-10-31T09:00:00"), la("2026-11-01T09:00:00"), la("2026-11-02T09:00:00"), la("2026-11-03T09:00:00")]);
  });

  it("weekly BYDAY follows the local weekday for an evening event", async () => {
    const ev = await t.api<CalEvent>("POST", "/api/events", { title: "Office hours", start: la("2026-11-02T18:00:00"), end: la("2026-11-02T19:00:00"), rrule: "FREQ=WEEKLY;BYDAY=MO" });
    const r = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-11-02T00:00:00")}&to=${la("2026-11-17T00:00:00")}`);
    const inst = r.data.filter((e) => e.instanceOf === ev.data.id);
    expect(inst.map((e) => e.start)).toEqual([la("2026-11-02T18:00:00"), la("2026-11-09T18:00:00"), la("2026-11-16T18:00:00")]);
    expect(inst.every((e) => new Date(e.start).getDay() === 1)).toBe(true);
  });

  it("a day window is end-exclusive and midnight events stay on their day", async () => {
    const ev = await t.api<CalEvent>("POST", "/api/events", { title: "Midnight", start: la("2026-11-01T00:00:00"), end: la("2026-11-01T00:30:00"), rrule: "FREQ=DAILY;COUNT=5" });
    const r = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-11-02T00:00:00")}&to=${la("2026-11-03T00:00:00")}`);
    const inst = r.data.filter((e) => e.instanceOf === ev.data.id);
    expect(inst).toHaveLength(1);
    expect(inst[0]!.start).toBe(la("2026-11-02T00:00:00"));
  });

  it("UNTIL is honored in local time", async () => {
    const ev = await t.api<CalEvent>("POST", "/api/events", { title: "Short series", start: la("2026-11-02T22:00:00"), end: la("2026-11-02T23:00:00"), rrule: "FREQ=DAILY;UNTIL=20261105T000000Z" });
    const r = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-11-02T00:00:00")}&to=${la("2026-11-10T00:00:00")}`);
    const inst = r.data.filter((e) => e.instanceOf === ev.data.id);
    expect(inst.length).toBeGreaterThanOrEqual(2);
    expect(inst.every((e) => new Date(e.start).getHours() === 22)).toBe(true);
  });
});

describe("all-day events", () => {
  it("recurring all-day shows on the right local day and single all-day not a day early", async () => {
    const weekly = await t.api<CalEvent>("POST", "/api/events", { title: "Trash day", start: "2026-10-26", end: "2026-10-26", allDay: true, rrule: "FREQ=WEEKLY;BYDAY=MO" });
    const single = await t.api<CalEvent>("POST", "/api/events", { title: "Dentist", start: "2026-11-03", end: "2026-11-03", allDay: true });
    const nov2 = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-11-02T00:00:00")}&to=${la("2026-11-03T00:00:00")}`);
    expect(nov2.data.some((e) => e.instanceOf === weekly.data.id && e.start === "2026-11-02")).toBe(true);
    expect(nov2.data.some((e) => e.id === single.data.id)).toBe(false);
    const nov1 = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-11-01T00:00:00")}&to=${la("2026-11-02T00:00:00")}`);
    expect(nov1.data.some((e) => e.instanceOf === weekly.data.id)).toBe(false);
    const nov3 = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-11-03T00:00:00")}&to=${la("2026-11-04T00:00:00")}`);
    expect(nov3.data.some((e) => e.id === single.data.id)).toBe(true);
  });

  it("multi-day all-day series keep their span", async () => {
    const ev = await t.api<CalEvent>("POST", "/api/events", { title: "Retreat", start: "2026-11-05", end: "2026-11-07", allDay: true, rrule: "FREQ=MONTHLY;COUNT=2" });
    const r = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-11-01T00:00:00")}&to=${la("2026-12-31T00:00:00")}`);
    const inst = r.data.filter((e) => e.instanceOf === ev.data.id);
    expect(inst.map((e) => [e.start, e.end])).toEqual([["2026-11-05", "2026-11-07"], ["2026-12-05", "2026-12-07"]]);
  });
});

describe("exceptions", () => {
  it("a moved occurrence disappears from its day and appears on the new day", async () => {
    const ev = await t.api<CalEvent>("POST", "/api/events", { title: "Gym", start: la("2026-11-02T20:00:00"), end: la("2026-11-02T21:00:00"), rrule: "FREQ=DAILY;COUNT=5" });
    await t.api("PATCH", `/api/events/${ev.data.id}`, { scope: "this", originalStart: la("2026-11-04T20:00:00"), start: la("2026-11-20T20:00:00"), end: la("2026-11-20T21:00:00") });
    const nov4 = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-11-04T00:00:00")}&to=${la("2026-11-05T00:00:00")}`);
    expect(nov4.data.filter((e) => e.instanceOf === ev.data.id)).toHaveLength(0);
    const nov20 = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-11-20T00:00:00")}&to=${la("2026-11-21T00:00:00")}`);
    expect(nov20.data.filter((e) => e.instanceOf === ev.data.id)).toHaveLength(1);
  });

  it("accepts originalStart without milliseconds and rejects bad rrules", async () => {
    const ev = await t.api<CalEvent>("POST", "/api/events", { title: "Yoga", start: la("2026-11-02T07:00:00"), end: la("2026-11-02T08:00:00"), rrule: "FREQ=DAILY;COUNT=3" });
    const os = la("2026-11-03T07:00:00").replace(".000Z", "Z");
    await t.api("DELETE", `/api/events/${ev.data.id}?scope=this&originalStart=${encodeURIComponent(os)}`);
    const r = await t.api<CalEvent[]>("GET", `/api/events?from=${la("2026-11-02T00:00:00")}&to=${la("2026-11-06T00:00:00")}`);
    expect(r.data.filter((e) => e.instanceOf === ev.data.id)).toHaveLength(2);
    const bad = await t.api("POST", "/api/events", { title: "Bad", start: la("2026-11-02T07:00:00"), end: la("2026-11-02T08:00:00"), rrule: "FREQ=MINUTELY" }, { allowError: true });
    expect(bad.status).toBe(400);
    const bad2 = await t.api("POST", "/api/events", { title: "Bad", start: la("2026-11-02T07:00:00"), end: la("2026-11-02T08:00:00"), rrule: "FREQ=DAILY\nRDATE:20260101T000000Z" }, { allowError: true });
    expect(bad2.status).toBe(400);
  });
});

describe("task recurrence and completion days", () => {
  it("weekly task recurs on the same local weekday and COUNT ends the series", async () => {
    const task = await t.api<Task>("POST", "/api/tasks", { title: "Laundry", dueDate: "2026-11-02", recurrence: "FREQ=WEEKLY;BYDAY=MO;COUNT=2" });
    await t.api("POST", `/api/tasks/${task.data.id}/complete`);
    const open = await t.api<Task[]>("GET", "/api/tasks?view=all");
    const next = open.data.find((x) => x.title === "Laundry" && x.status === "open");
    expect(next?.dueDate).toBe("2026-11-09");
    expect(next?.recurrence).toBeNull();
  });

  it("evening completions count on the local day", async () => {
    const task = await t.api<Task>("POST", "/api/tasks", { title: "Evening", dueDate: "2026-11-02" });
    await t.api("PATCH", `/api/tasks/${task.data.id}`, { status: "done" });
    await t.api("PATCH", `/api/tasks/${task.data.id}`, { completedAt: la("2026-11-02T17:30:00") });
    const today = await t.api<Task[]>("GET", "/api/tasks?view=today&date=2026-11-02");
    expect(today.data.some((x) => x.id === task.data.id)).toBe(true);
    const tomorrow = await t.api<Task[]>("GET", "/api/tasks?view=today&date=2026-11-03");
    expect(tomorrow.data.some((x) => x.id === task.data.id)).toBe(false);
  });
});
