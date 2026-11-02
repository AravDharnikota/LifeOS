import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CalEvent, SchedulerResult, Task } from "@aravos/shared";
import { makeTestApp, type TestApp } from "./helpers.ts";

// Tests run with TZ=UTC, so local work hours (09:00-18:00) are UTC hours. 2026-11-02 is a Monday.
const MONDAY_8 = new Date("2026-11-02T08:00:00.000Z");
const WEEK = "/api/events?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z";
const RANGE_END = "/api/events?from=2026-11-02T00:00:00Z&to=2026-12-02T00:00:00Z";

const ms = (iso: string): number => Date.parse(iso);
const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }): boolean => ms(a.start) < ms(b.end) && ms(a.end) > ms(b.start);
const hourUtc = (iso: string): number => new Date(iso).getUTCHours() + new Date(iso).getUTCMinutes() / 60;

async function timeboxes(t: TestApp, url = WEEK): Promise<CalEvent[]> {
  const r = await t.api<CalEvent[]>("GET", url);
  return r.data.filter((e) => e.kind === "timebox");
}

interface Runs {
  id: string;
  trigger: string;
  placed: number;
  moved: number;
  unplaced: number;
  summary: string;
}

interface Stats {
  historyCount: number;
  calibrationFactor: number;
  meanAbsErrorMinutes: number | null;
  lastRun: Runs | null;
}

interface Estimate {
  taskId: string;
  minutes: number;
  source: string;
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: MONDAY_8 });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("scheduler run", () => {
  const t = makeTestApp();
  afterAll(() => t.cleanup());

  let memo: Task;
  let report: Task;
  let pinned: Task;
  let later: Task;
  let meeting: CalEvent;
  let lockedBlock: CalEvent;
  let first: SchedulerResult;

  beforeAll(async () => {
    memo = (await t.api<Task>("POST", "/api/tasks", { title: "Urgent memo", estimateMinutes: 60, dueDate: "2026-11-02", dueTime: "12:00", priority: 0 })).data;
    report = (await t.api<Task>("POST", "/api/tasks", { title: "Big report", estimateMinutes: 120, dueDate: "2026-11-06", priority: 3 })).data;
    pinned = (await t.api<Task>("POST", "/api/tasks", { title: "Pinned task", estimateMinutes: 60, dueDate: "2026-11-03" })).data;
    later = (await t.api<Task>("POST", "/api/tasks", { title: "Later task", estimateMinutes: 30, startDate: "2026-11-04" })).data;
    await t.api<Task>("POST", "/api/tasks", { title: "Someday", estimateMinutes: 30 });
    await t.api<Task>("POST", "/api/tasks", { title: "Far away", estimateMinutes: 30, dueDate: "2026-12-20" });
    meeting = (await t.api<CalEvent>("POST", "/api/events", { title: "Standup", start: "2026-11-02T10:00:00.000Z", end: "2026-11-02T11:00:00.000Z" })).data;
    lockedBlock = (await t.api<CalEvent>("POST", "/api/events", { title: "Pinned task", taskId: pinned.id, kind: "timebox", locked: true, start: "2026-11-02T14:00:00.000Z", end: "2026-11-02T15:00:00.000Z" })).data;
    first = (await t.api<SchedulerResult>("POST", "/api/scheduler/run", {})).data;
  });

  it("creates time boxes in the Time boxes calendar for candidate tasks only", async () => {
    const boxes = await timeboxes(t, RANGE_END);
    const cals = await t.api<{ id: string; name: string }[]>("GET", "/api/calendars");
    const timeboxCal = cals.data.find((c) => c.name === "Time boxes")!;
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.calendarId).toBe(timeboxCal.id);
      expect(b.taskId).toBeTruthy();
    }
    const taskIds = new Set(boxes.map((b) => b.taskId));
    expect(taskIds.has(memo.id)).toBe(true);
    expect(taskIds.has(report.id)).toBe(true);
    expect(taskIds.has(later.id)).toBe(true);
    const all = await t.api<Task[]>("GET", "/api/tasks?view=all");
    const someday = all.data.find((x) => x.title === "Someday")!;
    const far = all.data.find((x) => x.title === "Far away")!;
    expect(taskIds.has(someday.id)).toBe(false);
    expect(taskIds.has(far.id)).toBe(false);
    expect(first.summary).toMatch(/^Placed \d+ tasks in \d+ blocks through/);
  });

  it("keeps every block inside work hours, out of lunch and never in the past", async () => {
    for (const b of await timeboxes(t)) {
      expect(ms(b.start)).toBeGreaterThanOrEqual(MONDAY_8.getTime());
      expect(hourUtc(b.start)).toBeGreaterThanOrEqual(9);
      expect(hourUtc(b.end)).toBeLessThanOrEqual(18);
      const lunch = { start: b.start.slice(0, 10) + "T12:30:00.000Z", end: b.start.slice(0, 10) + "T13:15:00.000Z" };
      expect(overlaps(b, lunch)).toBe(false);
    }
  });

  it("respects the meeting with a buffer and the locked block", async () => {
    const boxes = await timeboxes(t);
    for (const b of boxes) {
      expect(overlaps(b, meeting)).toBe(false);
      if (ms(b.start) >= ms(meeting.end)) expect(ms(b.start) - ms(meeting.end)).toBeGreaterThanOrEqual(10 * 60000);
      if (ms(b.end) <= ms(meeting.start)) expect(ms(meeting.start) - ms(b.end)).toBeGreaterThanOrEqual(10 * 60000);
      if (b.id !== lockedBlock.id) expect(overlaps(b, lockedBlock)).toBe(false);
    }
    const locked = boxes.find((b) => b.id === lockedBlock.id)!;
    expect(locked.start).toBe(lockedBlock.start);
    expect(locked.end).toBe(lockedBlock.end);
    expect(locked.locked).toBe(true);
    expect(boxes.filter((b) => b.taskId === pinned.id)).toHaveLength(1);
    const placedPinned = first.placed.find((p) => p.taskId === pinned.id)!;
    expect(placedPinned.blocks.map((b) => b.eventId)).toEqual([lockedBlock.id]);
  });

  it("orders by deadline and splits long tasks", async () => {
    const boxes = await timeboxes(t);
    const memoBlocks = boxes.filter((b) => b.taskId === memo.id).sort((a, b) => a.start.localeCompare(b.start));
    expect(memoBlocks.length).toBeGreaterThanOrEqual(1);
    expect(memoBlocks[0]!.start).toBe("2026-11-02T09:00:00.000Z");
    expect(memoBlocks.reduce((sum, b) => sum + (ms(b.end) - ms(b.start)) / 60000, 0)).toBe(60);
    for (const b of memoBlocks) expect(ms(b.end)).toBeLessThanOrEqual(ms("2026-11-02T12:00:00.000Z"));
    const reportBlocks = boxes.filter((b) => b.taskId === report.id).sort((a, b) => a.start.localeCompare(b.start));
    expect(reportBlocks.length).toBeGreaterThanOrEqual(2);
    expect(ms(reportBlocks[0]!.start)).toBeGreaterThanOrEqual(ms(memoBlocks[0]!.end));
    const total = reportBlocks.reduce((sum, b) => sum + (ms(b.end) - ms(b.start)) / 60000, 0);
    expect(total).toBe(120);
    for (const b of reportBlocks) expect((ms(b.end) - ms(b.start)) / 60000).toBeLessThanOrEqual(90);
    expect(ms(reportBlocks[reportBlocks.length - 1]!.end)).toBeLessThanOrEqual(ms("2026-11-07T00:00:00.000Z"));
    const laterBlocks = boxes.filter((b) => b.taskId === later.id);
    expect(laterBlocks).toHaveLength(1);
    expect(ms(laterBlocks[0]!.start)).toBeGreaterThanOrEqual(ms("2026-11-04T00:00:00.000Z"));
  });

  it("records the run and exposes stats", async () => {
    const runs = await t.api<Runs[]>("GET", "/api/scheduler/runs");
    expect(runs.data).toHaveLength(1);
    expect(runs.data[0]!.trigger).toBe("manual");
    expect(runs.data[0]!.placed).toBe(first.placed.length);
    expect(runs.data[0]!.summary).toBe(first.summary);
    const stats = await t.api<Stats>("GET", "/api/scheduler/stats");
    expect(stats.data.lastRun?.id).toBe(runs.data[0]!.id);
    expect(stats.data.calibrationFactor).toBe(1);
    expect(stats.data.historyCount).toBe(0);
    const activity = await t.api<{ actor: string; action: string }[]>("GET", "/api/activity?limit=200");
    expect(activity.data.some((a) => a.actor === "scheduler" && a.action === "scheduled")).toBe(true);
  });

  it("is stable on re-run", async () => {
    const before = (await timeboxes(t)).map((b) => [b.id, b.start, b.end]).sort();
    const again = (await t.api<SchedulerResult>("POST", "/api/scheduler/run", {})).data;
    expect(again.moved).toBe(0);
    const after = (await timeboxes(t)).map((b) => [b.id, b.start, b.end]).sort();
    expect(after).toEqual(before);
    const runs = await t.api<Runs[]>("GET", "/api/scheduler/runs");
    expect(runs.data).toHaveLength(2);
  });

  it("removes future blocks when a task is completed", async () => {
    expect((await timeboxes(t)).filter((b) => b.taskId === report.id).length).toBeGreaterThan(0);
    await t.api("POST", `/api/tasks/${report.id}/complete`, {});
    expect((await timeboxes(t)).filter((b) => b.taskId === report.id)).toHaveLength(0);
    const after = (await t.api<SchedulerResult>("POST", "/api/scheduler/run", {})).data;
    expect(after.placed.some((p) => p.taskId === report.id)).toBe(false);
  });

  it("restricts to the given task ids", async () => {
    const r = await t.api<SchedulerResult>("POST", "/api/scheduler/run", { taskIds: [memo.id] });
    expect(r.data.placed.map((p) => p.taskId)).toEqual([memo.id]);
  });

  it("validates the run body", async () => {
    const r = await t.api("POST", "/api/scheduler/run", { horizonDays: 0 }, { allowError: true });
    expect(r.status).toBe(400);
  });
});

describe("scheduler dry run", () => {
  const t = makeTestApp();
  afterAll(() => t.cleanup());

  it("writes nothing", async () => {
    await t.api<Task>("POST", "/api/tasks", { title: "Preview me", estimateMinutes: 45, dueDate: "2026-11-03" });
    const r = await t.api<SchedulerResult>("POST", "/api/scheduler/run", { dryRun: true });
    expect(r.data.placed).toHaveLength(1);
    expect(r.data.placed[0]!.blocks[0]!.eventId).toBe("preview");
    expect(r.data.summary.startsWith("Preview: ")).toBe(true);
    expect(await timeboxes(t)).toHaveLength(0);
    const runs = await t.api<Runs[]>("GET", "/api/scheduler/runs");
    expect(runs.data).toHaveLength(0);
    const stats = await t.api<Stats>("GET", "/api/scheduler/stats");
    expect(stats.data.lastRun).toBeNull();
  });

  it("returns nothing to schedule on an empty horizon", async () => {
    const empty = makeTestApp();
    const r = await empty.api<SchedulerResult>("POST", "/api/scheduler/run", {});
    expect(r.data.summary).toBe("Nothing to schedule.");
    expect(r.data.placed).toEqual([]);
    empty.cleanup();
  });

  it("returns null from the auto run when autoRun is off", async () => {
    const { runSchedulerIfEnabled } = await import("../src/services/scheduler.ts");
    await t.api("PATCH", "/api/settings/scheduler", { autoRun: false });
    expect(await runSchedulerIfEnabled(t.ctx, "auto")).toBeNull();
    await t.api("PATCH", "/api/settings/scheduler", { autoRun: true });
    const r = await runSchedulerIfEnabled(t.ctx, "auto");
    expect(r?.placed).toHaveLength(1);
    const runs = await t.api<Runs[]>("GET", "/api/scheduler/runs");
    expect(runs.data[0]!.trigger).toBe("auto");
  });
});

describe("scheduler estimates", () => {
  const t = makeTestApp();
  afterAll(() => t.cleanup());

  it("uses the task's own estimate, then history, then AI, then the default", async () => {
    const done = (await t.api<Task>("POST", "/api/tasks", { title: "Weekly review", estimateMinutes: 30 })).data;
    await t.api("POST", `/api/tasks/${done.id}/complete`, { actualMinutes: 45 });
    const own = (await t.api<Task>("POST", "/api/tasks", { title: "Own estimate", estimateMinutes: 20 })).data;
    const similar = (await t.api<Task>("POST", "/api/tasks", { title: "Weekly review notes" })).data;
    const novel = (await t.api<Task>("POST", "/api/tasks", { title: "Paint the fence" })).data;
    t.ai.durationHandler = async (req) => Object.fromEntries(req.tasks.map((x) => [x.id, 50]));
    const r = await t.api<Estimate[]>("POST", "/api/scheduler/estimate", { taskIds: [own.id, similar.id, novel.id] });
    expect(r.data).toEqual([
      { taskId: own.id, minutes: 20, source: "task" },
      { taskId: similar.id, minutes: 45, source: "history" },
      { taskId: novel.id, minutes: 50, source: "ai" },
    ]);
    t.ai.enabled = false;
    const walk = (await t.api<Task>("POST", "/api/tasks", { title: "Walk the dog" })).data;
    const d = await t.api<Estimate[]>("POST", "/api/scheduler/estimate", { taskIds: [walk.id] });
    expect(d.data).toEqual([{ taskId: walk.id, minutes: 30, source: "default" }]);
    t.ai.enabled = true;
  });

  it("falls back to the default when the AI call fails", async () => {
    t.ai.durationHandler = async () => {
      throw new Error("boom");
    };
    const task = (await t.api<Task>("POST", "/api/tasks", { title: "Fix the gutter" })).data;
    const r = await t.api<Estimate[]>("POST", "/api/scheduler/estimate", { taskIds: [task.id] });
    expect(r.data).toEqual([{ taskId: task.id, minutes: 30, source: "default" }]);
  });

  it("calibrates the user's own estimates from history and reports stats", async () => {
    for (let i = 0; i < 3; i++) {
      const task = (await t.api<Task>("POST", "/api/tasks", { title: `Chore ${i}`, estimateMinutes: 30 })).data;
      await t.api("POST", `/api/tasks/${task.id}/complete`, { actualMinutes: 60 });
    }
    const stats = await t.api<Stats>("GET", "/api/scheduler/stats");
    expect(stats.data.historyCount).toBe(4);
    expect(stats.data.calibrationFactor).toBeGreaterThan(1);
    expect(stats.data.calibrationFactor).toBeLessThanOrEqual(2);
    expect(stats.data.meanAbsErrorMinutes).toBeGreaterThan(0);
    const task = (await t.api<Task>("POST", "/api/tasks", { title: "Calibrated work", estimateMinutes: 60, dueDate: "2026-11-02" })).data;
    const r = await t.api<SchedulerResult>("POST", "/api/scheduler/run", { taskIds: [task.id] });
    const total = r.data.placed[0]!.blocks.reduce((sum, b) => sum + (ms(b.end) - ms(b.start)) / 60000, 0);
    expect(total).toBeGreaterThan(60);
  });
});

describe("scheduler tools", () => {
  const t = makeTestApp();
  afterAll(() => t.cleanup());

  it("plan_schedule and get_schedule_stats return compact results", async () => {
    const { schedulerTools } = await import("../src/tools/scheduler.ts");
    const { runTool } = await import("../src/tools/types.ts");
    await t.api<Task>("POST", "/api/tasks", { title: "Tool task", estimateMinutes: 30, dueDate: "2026-11-03" });
    const plan = schedulerTools.find((x) => x.name === "plan_schedule")!;
    const res = await runTool(plan, { dryRun: true }, { ctx: t.ctx, actor: "agent" });
    expect(res.ok).toBe(true);
    const data = res.result as { summary: string; placed: { title: string; blocks: { start: string; end: string }[] }[] };
    expect(data.placed[0]!.title).toBe("Tool task");
    expect(data.summary.startsWith("Preview: ")).toBe(true);
    const stats = schedulerTools.find((x) => x.name === "get_schedule_stats")!;
    expect(stats.readOnly).toBe(true);
    const s = await runTool(stats, {}, { ctx: t.ctx, actor: "agent" });
    expect(s.ok).toBe(true);
    expect((s.result as { historyCount: number }).historyCount).toBe(0);
  });
});
