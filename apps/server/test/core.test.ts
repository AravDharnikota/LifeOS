import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "./helpers.ts";
import type { Task, CalEvent, Goal, Layout } from "@aravos/shared";

const t = makeTestApp();
afterAll(() => t.cleanup());

describe("health + auth", () => {
  it("serves health without auth", async () => {
    const r = await t.api<{ ok: boolean }>("GET", "/api/health");
    expect(r.data.ok).toBe(true);
  });
  it("rejects unauthenticated requests when a token is set", async () => {
    const secured = makeTestApp({ token: "secret" });
    const res = await secured.fetch("/api/tasks");
    expect(res.status).toBe(401);
    const ok = await secured.fetch("/api/tasks", { headers: { authorization: "Bearer secret" } });
    expect(ok.status).toBe(200);
    secured.cleanup();
  });
});

describe("tasks", () => {
  it("creates, lists, completes with recurrence", async () => {
    const created = await t.api<Task>("POST", "/api/tasks", { title: "Water plants", dueDate: "2026-11-02", recurrence: "FREQ=WEEKLY;BYDAY=MO", estimateMinutes: 15 });
    expect(created.data.title).toBe("Water plants");
    expect(created.data.listId).toBeTruthy();
    const list = await t.api<Task[]>("GET", "/api/tasks?view=today&date=2026-11-02");
    expect(list.data.some((x) => x.id === created.data.id)).toBe(true);
    const done = await t.api<Task>("POST", `/api/tasks/${created.data.id}/complete`, { actualMinutes: 20 });
    expect(done.data.status).toBe("done");
    expect(done.data.actualMinutes).toBe(20);
    const all = await t.api<Task[]>("GET", "/api/tasks?view=all");
    const next = all.data.find((x) => x.title === "Water plants" && x.status === "open");
    expect(next?.dueDate).toBe("2026-11-09");
  });
  it("quick add parses natural language", async () => {
    const r = await t.api<Task>("POST", "/api/tasks/quick", { text: "Call dentist tomorrow 4pm !high 30m #health" });
    expect(r.data.title).toBe("Call dentist");
    expect(r.data.dueTime).toBe("16:00");
    expect(r.data.priority).toBe(3);
    expect(r.data.estimateMinutes).toBe(30);
    expect(r.data.tags).toEqual(["health"]);
    expect(r.data.dueDate).toBeTruthy();
  });
  it("validates input", async () => {
    const r = await t.api("POST", "/api/tasks", { title: "" }, { allowError: true });
    expect(r.status).toBe(400);
    const nf = await t.api("GET", "/api/tasks/nope", undefined, { allowError: true });
    expect(nf.status).toBe(404);
  });
  it("subtasks and deletion", async () => {
    const parent = await t.api<Task>("POST", "/api/tasks", { title: "Parent" });
    const child = await t.api<Task>("POST", "/api/tasks", { title: "Child", parentId: parent.data.id });
    const detail = await t.api<Task & { subtasks: Task[] }>("GET", `/api/tasks/${parent.data.id}`);
    expect(detail.data.subtasks.map((s) => s.id)).toEqual([child.data.id]);
    await t.api("DELETE", `/api/tasks/${parent.data.id}`);
    const gone = await t.api("GET", `/api/tasks/${child.data.id}`, undefined, { allowError: true });
    expect(gone.status).toBe(404);
  });
});

describe("calendar", () => {
  it("creates events and expands recurrence", async () => {
    const ev = await t.api<CalEvent>("POST", "/api/events", { title: "Standup", start: "2026-11-02T17:00:00.000Z", end: "2026-11-02T17:15:00.000Z", rrule: "FREQ=DAILY;COUNT=5" });
    expect(ev.data.kind).toBe("event");
    const range = await t.api<CalEvent[]>("GET", "/api/events?from=2026-11-01T00:00:00Z&to=2026-11-10T00:00:00Z");
    const instances = range.data.filter((e) => e.instanceOf === ev.data.id);
    expect(instances).toHaveLength(5);
    // cancel one instance
    await t.api("DELETE", `/api/events/${ev.data.id}?scope=this&originalStart=2026-11-03T17:00:00.000Z`);
    const after = await t.api<CalEvent[]>("GET", "/api/events?from=2026-11-01T00:00:00Z&to=2026-11-10T00:00:00Z");
    expect(after.data.filter((e) => e.instanceOf === ev.data.id)).toHaveLength(4);
    // move one instance
    const moved = await t.api<CalEvent>("PATCH", `/api/events/${ev.data.id}`, { scope: "this", originalStart: "2026-11-04T17:00:00.000Z", start: "2026-11-04T18:00:00.000Z", end: "2026-11-04T18:30:00.000Z" });
    expect(moved.data.start).toBe("2026-11-04T18:00:00.000Z");
    const after2 = await t.api<CalEvent[]>("GET", "/api/events?from=2026-11-04T00:00:00Z&to=2026-11-05T00:00:00Z");
    expect(after2.data.find((e) => e.instanceOf === ev.data.id)?.start).toBe("2026-11-04T18:00:00.000Z");
  });
  it("rejects end before start", async () => {
    const r = await t.api("POST", "/api/events", { title: "Bad", start: "2026-11-02T17:00:00Z", end: "2026-11-02T16:00:00Z" }, { allowError: true });
    expect(r.status).toBe(400);
  });
  it("timeboxes link to tasks", async () => {
    const task = await t.api<Task>("POST", "/api/tasks", { title: "Write report" });
    const tb = await t.api<CalEvent>("POST", "/api/events", { title: "Write report", start: "2026-11-05T10:00:00Z", end: "2026-11-05T11:00:00Z", taskId: task.data.id });
    expect(tb.data.kind).toBe("timebox");
    const detail = await t.api<Task>("GET", `/api/tasks/${task.data.id}`);
    expect(detail.data.scheduledBlocks?.[0]?.id).toBe(tb.data.id);
    const range = await t.api<CalEvent[]>("GET", "/api/events?from=2026-11-05T00:00:00Z&to=2026-11-06T00:00:00Z");
    expect(range.data.find((e) => e.id === tb.data.id)?.taskStatus).toBe("open");
  });
});

describe("goals + trackers + layout", () => {
  it("tracks number goal progress", async () => {
    const g = await t.api<Goal>("POST", "/api/goals", { title: "Read 12 books", kind: "number", targetValue: 12, unit: "books" });
    expect(g.data.progress).toBe(0);
    const logged = await t.api<Goal>("POST", `/api/goals/${g.data.id}/log`, { delta: 3 });
    expect(logged.data.currentValue).toBe(3);
    expect(logged.data.progress).toBeCloseTo(0.25);
  });
  it("habit toggles and streaks", async () => {
    const g = await t.api<Goal>("POST", "/api/goals", { title: "Meditate", kind: "habit", cadence: "daily" });
    const on = await t.api<Goal>("POST", `/api/goals/${g.data.id}/log`, {});
    expect(on.data.streak).toBe(1);
    const off = await t.api<Goal>("POST", `/api/goals/${g.data.id}/log`, {});
    expect(off.data.streak).toBe(0);
  });
  it("trackers count", async () => {
    const tr = await t.api<{ id: string }>("POST", "/api/trackers", { name: "Coffee", unit: "cups" });
    const a = await t.api<{ todayValue: number }>("POST", `/api/trackers/${tr.data.id}/log`, {});
    expect(a.data.todayValue).toBe(1);
    const b = await t.api<{ todayValue: number }>("POST", `/api/trackers/${tr.data.id}/log`, { value: 5 });
    expect(b.data.todayValue).toBe(5);
  });
  it("layout add/remove/revert with validation", async () => {
    const l = await t.api<Layout>("GET", "/api/layout/today");
    expect(l.data.spec.sections.length).toBeGreaterThan(0);
    const added = await t.api<Layout>("POST", "/api/layout/today/widgets", { widget: { id: "cd", type: "countdown", date: "2026-12-25", label: "Christmas" } });
    expect(added.data.version).toBe(l.data.version + 1);
    const dup = await t.api("POST", "/api/layout/today/widgets", { widget: { id: "cd", type: "countdown", date: "2026-12-25", label: "X" } }, { allowError: true });
    expect(dup.status).toBe(400);
    const bad = await t.api("PUT", "/api/layout/today", { spec: { sections: [{ id: "a", widgets: [{ id: "x", type: "nope" }] }] } }, { allowError: true });
    expect(bad.status).toBe(400);
    const reverted = await t.api<Layout>("POST", "/api/layout/today/revert");
    expect(reverted.data.version).toBe(l.data.version);
  });
});
