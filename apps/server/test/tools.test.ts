import { describe, it, expect, afterAll } from "vitest";
import { addDaysString, todayString } from "@aravos/shared";
import { makeTestApp } from "./helpers.ts";
import { schema } from "../src/db/client.ts";
import { newId, nowIso } from "../src/lib/ids.ts";
import { getHealthProfile } from "../src/services/settings.ts";
import { runTool, toolInputJsonSchema, toolsFor } from "../src/tools/index.ts";

const t = makeTestApp();
afterAll(() => t.cleanup());

const tools = toolsFor("mcp");
const today = todayString();
const targets = getHealthProfile(t.ctx.db).targets;

async function call<T = Record<string, unknown>>(name: string, input: unknown = {}): Promise<{ ok: boolean; result: T }> {
  const def = tools.find((d) => d.name === name);
  if (!def) throw new Error(`No tool ${name}`);
  const r = await runTool(def, input, { ctx: t.ctx, actor: "mcp:test" });
  return r as { ok: boolean; result: T };
}

async function ok<T = Record<string, unknown>>(name: string, input: unknown = {}): Promise<T> {
  const r = await call<T>(name, input);
  if (!r.ok) throw new Error(`${name} failed: ${JSON.stringify(r.result)}`);
  return r.result;
}

const errorOf = (r: { result: unknown }): string => String((r.result as { error?: string }).error ?? "");

describe("catalog", () => {
  it("exposes the expected tools with unique names and JSON schemas", () => {
    const names = tools.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    const expected = [
      "list_tasks", "get_task", "add_task", "quick_add_task", "update_task", "complete_task", "reopen_task", "delete_task", "list_task_lists", "search_tasks",
      "get_events", "get_day_events", "add_event", "update_event", "delete_event", "find_free_time", "move_event",
      "list_goals", "get_goal", "add_goal", "update_goal", "log_goal_progress", "add_milestone", "complete_milestone",
      "list_trackers", "add_tracker", "log_tracker",
      "get_nutrition_day", "log_water", "log_weight", "log_meal_text", "list_recent_workouts", "get_personal_records", "get_health_targets",
      "get_day_summary", "get_week_summary", "recent_activity", "whoami",
    ];
    for (const n of expected) expect(names).toContain(n);
    for (const d of tools) {
      expect(d.description.length).toBeGreaterThan(20);
      const js = toolInputJsonSchema(d);
      expect(js.type).toBe("object");
    }
    expect(tools.find((d) => d.name === "delete_task")?.destructive).toBe(true);
    expect(tools.find((d) => d.name === "list_tasks")?.readOnly).toBe(true);
  });
});

describe("tasks tools", () => {
  it("rejects invalid input", async () => {
    const r = await call("add_task", { title: "" });
    expect(r.ok).toBe(false);
    expect(errorOf(r)).toBe("Invalid input");
    const bad = await call("add_task", { title: "x", dueDate: "tomorrow" });
    expect(bad.ok).toBe(false);
    const noDate = await call("add_task", { title: "x", dueTime: "09:00" });
    expect(errorOf(noDate)).toContain("dueDate");
    const unknownList = await call("add_task", { title: "x", listName: "Nope" });
    expect(errorOf(unknownList)).toContain("Available lists");
    const nf = await call("get_task", { id: "missing" });
    expect(nf.ok).toBe(false);
  });
  it("adds, lists, updates, completes, reopens, searches and deletes", async () => {
    const lists = await ok<{ lists: { id: string; name: string; openCount: number }[] }>("list_task_lists");
    const work = lists.lists.find((l) => l.name === "Work")!;
    const added = await ok<{ id: string; listId: string; dueDate: string; tags: string[] }>("add_task", { title: "Write MCP docs", dueDate: today, dueTime: "15:00", priority: 2, estimateMinutes: 45, listName: "work", tags: ["docs"], recurrence: "FREQ=DAILY" });
    expect(added.listId).toBe(work.id);
    expect(added.tags).toEqual(["docs"]);
    const listed = await ok<{ view: string; tasks: { id: string }[] }>("list_tasks", {});
    expect(listed.view).toBe("today");
    expect(listed.tasks.some((x) => x.id === added.id)).toBe(true);
    const byList = await ok<{ view: string; tasks: { id: string }[] }>("list_tasks", { listId: work.id });
    expect(byList.view).toBe("list");
    expect(byList.tasks.map((x) => x.id)).toContain(added.id);
    const got = await ok<{ id: string; notes: string | null; subtasks: unknown[] }>("get_task", { id: added.id });
    expect(got.subtasks).toEqual([]);
    const updated = await ok<{ title: string; dueTime: string | null; priority: number }>("update_task", { id: added.id, title: "Write the MCP docs", dueTime: null, priority: 3 });
    expect(updated).toMatchObject({ title: "Write the MCP docs", dueTime: null, priority: 3 });
    const done = await ok<{ status: string; actualMinutes: number; nextOccurrenceCreated: boolean }>("complete_task", { id: added.id, actualMinutes: 50 });
    expect(done).toMatchObject({ status: "done", actualMinutes: 50, nextOccurrenceCreated: true });
    const next = await ok<{ tasks: { id: string; dueDate: string | null; status: string }[] }>("search_tasks", { q: "mcp docs" });
    expect(next.tasks.find((x) => x.status === "open")?.dueDate).toBe(addDaysString(today, 1));
    const reopened = await ok<{ status: string }>("reopen_task", { id: added.id });
    expect(reopened.status).toBe("open");
    const quick = await ok<{ title: string; priority: number; estimateMinutes: number }>("quick_add_task", { text: "Call dentist tomorrow 4pm !high 30m", listName: "Personal" });
    expect(quick).toMatchObject({ title: "Call dentist", priority: 3, estimateMinutes: 30 });
    const del = await ok<{ ok: boolean }>("delete_task", { id: added.id });
    expect(del.ok).toBe(true);
    const gone = await call("get_task", { id: added.id });
    expect(gone.ok).toBe(false);
  });
});

describe("calendar tools", () => {
  const day = "2026-12-01";
  it("adds events, lists by day and range, finds free time", async () => {
    const a = await ok<{ id: string; kind: string }>("add_event", { title: "Standup", start: `${day}T09:00:00Z`, end: `${day}T10:00:00Z` });
    expect(a.kind).toBe("event");
    await ok("add_event", { title: "Lunch", start: `${day}T12:00:00Z`, end: `${day}T13:00:00Z` });
    await ok("add_event", { title: "Holiday", start: day, end: day, allDay: true });
    const bad = await call("add_event", { title: "Bad", start: `${day}T12:00:00Z`, end: `${day}T11:00:00Z` });
    expect(bad.ok).toBe(false);
    const dayEvents = await ok<{ events: { title: string }[] }>("get_day_events", { date: day });
    expect(dayEvents.events.map((e) => e.title).sort()).toEqual(["Holiday", "Lunch", "Standup"]);
    const range = await ok<{ events: { id: string }[]; truncated: boolean }>("get_events", { from: day, to: day });
    expect(range.events.some((e) => e.id === a.id)).toBe(true);
    expect(range.truncated).toBe(false);
    const free = await ok<{ slots: { start: string; end: string; minutes: number }[] }>("find_free_time", { from: day, to: day, durationMinutes: 30, workHoursOnly: true });
    expect(free.slots.map((s) => [s.start, s.end])).toEqual([
      [`${day}T08:00:00.000Z`, `${day}T09:00:00.000Z`],
      [`${day}T10:00:00.000Z`, `${day}T12:00:00.000Z`],
      [`${day}T13:00:00.000Z`, `${day}T22:00:00.000Z`],
    ]);
    const long = await ok<{ slots: { minutes: number }[] }>("find_free_time", { from: day, to: day, durationMinutes: 180, workHoursOnly: true });
    expect(long.slots).toHaveLength(1);
    expect(long.slots[0]?.minutes).toBe(540);
    const moved = await ok<{ start: string; locked: boolean }>("move_event", { id: a.id, start: `${day}T16:00:00Z`, end: `${day}T16:30:00Z`, lock: true });
    expect(moved).toMatchObject({ start: `${day}T16:00:00.000Z`, locked: true });
  });
  it("handles recurring instances via instance ids and scope", async () => {
    const series = await ok<{ id: string }>("add_event", { title: "Gym", start: "2026-12-10T17:00:00Z", end: "2026-12-10T18:00:00Z", rrule: "FREQ=DAILY;COUNT=3" });
    const d2 = await ok<{ events: { id: string; instanceOf: string | null; start: string }[] }>("get_day_events", { date: "2026-12-11" });
    const inst = d2.events.find((e) => e.instanceOf === series.id)!;
    expect(inst.id).toBe(`${series.id}_2026-12-11T17:00:00.000Z`);
    const moved = await ok<{ start: string; instanceOf: string | null }>("move_event", { id: inst.id, start: "2026-12-11T18:00:00Z", end: "2026-12-11T18:30:00Z" });
    expect(moved.start).toBe("2026-12-11T18:00:00.000Z");
    const after = await ok<{ events: { instanceOf: string | null; start: string }[] }>("get_day_events", { date: "2026-12-11" });
    expect(after.events.find((e) => e.instanceOf === series.id)?.start).toBe("2026-12-11T18:00:00.000Z");
    const renamed = await ok<{ title: string }>("update_event", { id: series.id, scope: "this", originalStart: "2026-12-12T17:00:00.000Z", title: "Gym (late)" });
    expect(renamed.title).toBe("Gym (late)");
    const missing = await call("update_event", { id: series.id, scope: "this", title: "x" });
    expect(errorOf(missing)).toContain("originalStart");
    await ok("delete_event", { id: `${series.id}_2026-12-10T17:00:00.000Z` });
    const d1 = await ok<{ events: { instanceOf: string | null }[] }>("get_day_events", { date: "2026-12-10" });
    expect(d1.events.some((e) => e.instanceOf === series.id)).toBe(false);
    const all = await ok<{ title: string }>("update_event", { id: series.id, scope: "all", title: "Gym session" });
    expect(all.title).toBe("Gym session");
    await ok("delete_event", { id: series.id });
    const d3 = await ok<{ events: unknown[] }>("get_day_events", { date: "2026-12-12" });
    expect(d3.events).toHaveLength(0);
  });
});

describe("goals tools", () => {
  it("number goals, habits and milestones", async () => {
    const g = await ok<{ id: string; progress: number }>("add_goal", { title: "Read 12 books", targetValue: 12, unit: "books" });
    expect(g.progress).toBe(0);
    const none = await call("log_goal_progress", { id: g.id });
    expect(errorOf(none)).toContain("value or delta");
    const logged = await ok<{ currentValue: number; progress: number }>("log_goal_progress", { id: g.id, delta: 3 });
    expect(logged).toMatchObject({ currentValue: 3, progress: 0.25 });
    const set = await ok<{ currentValue: number }>("log_goal_progress", { id: g.id, value: 6, note: "halfway" });
    expect(set.currentValue).toBe(6);
    const habit = await ok<{ id: string }>("add_goal", { title: "Meditate", kind: "habit", cadence: "daily" });
    const on = await ok<{ checkedIn: boolean; streak: number }>("log_goal_progress", { id: habit.id });
    expect(on).toMatchObject({ checkedIn: true, streak: 1 });
    const off = await ok<{ checkedIn: boolean }>("log_goal_progress", { id: habit.id });
    expect(off.checkedIn).toBe(false);
    const ms = await ok<{ id: string }>("add_goal", { title: "Launch", kind: "milestone" });
    const m1 = await ok<{ id: string }>("add_milestone", { goalId: ms.id, title: "Design", dueDate: today });
    await ok("add_milestone", { goalId: ms.id, title: "Build" });
    const done = await ok<{ done: boolean }>("complete_milestone", { id: m1.id });
    expect(done.done).toBe(true);
    const detail = await ok<{ progress: number; milestones: { id: string; done: boolean }[] }>("get_goal", { id: ms.id });
    expect(detail.progress).toBe(0.5);
    expect(detail.milestones).toHaveLength(2);
    const paused = await ok<{ status: string }>("update_goal", { id: g.id, status: "paused" });
    expect(paused.status).toBe("paused");
    const active = await ok<{ goals: { id: string }[] }>("list_goals", {});
    expect(active.goals.some((x) => x.id === g.id)).toBe(false);
    const all = await ok<{ goals: { id: string }[] }>("list_goals", { status: "all" });
    expect(all.goals.some((x) => x.id === g.id)).toBe(true);
  });
});

describe("trackers tools", () => {
  it("creates and logs", async () => {
    const tr = await ok<{ id: string; value: number }>("add_tracker", { name: "Coffee", unit: "cups", target: 2 });
    expect(tr.value).toBe(0);
    const a = await ok<{ value: number }>("log_tracker", { id: tr.id });
    expect(a.value).toBe(1);
    const b = await ok<{ value: number }>("log_tracker", { id: tr.id, delta: 2 });
    expect(b.value).toBe(3);
    const c = await ok<{ value: number }>("log_tracker", { id: tr.id, value: 1 });
    expect(c.value).toBe(1);
    const list = await ok<{ trackers: { id: string }[] }>("list_trackers");
    expect(list.trackers.map((x) => x.id)).toContain(tr.id);
    const nf = await call("log_tracker", { id: "nope" });
    expect(nf.ok).toBe(false);
  });
});

describe("health tools", () => {
  it("logs water and weight", async () => {
    const w = await ok<{ ml: number; target: number; remaining: number }>("log_water", { ml: 500 });
    expect(w).toMatchObject({ ml: 500, target: targets.waterMl, remaining: targets.waterMl - 500 });
    const w2 = await ok<{ ml: number }>("log_water", { ml: 250 });
    expect(w2.ml).toBe(750);
    const first = await ok<{ changeKg: number | null }>("log_weight", { weightKg: 80, date: addDaysString(today, -1) });
    expect(first.changeKg).toBeNull();
    const second = await ok<{ changeKg: number | null; previous: { weightKg: number } }>("log_weight", { weightKg: 79.4, bodyFatPct: 18 });
    expect(second.changeKg).toBeCloseTo(-0.6);
    expect(second.previous.weightKg).toBe(80);
    const bad = await call("log_water", { ml: 0 });
    expect(bad.ok).toBe(false);
  });
  it("logs a meal from text with the AI provider and reads the day", async () => {
    const meal = await ok<{ meal: { id: string; mealType: string; name: string }; items: unknown[]; totals: { calories: number }; day: { totals: { calories: number } } }>("log_meal_text", { description: "chicken and rice", mealType: "dinner" });
    expect(meal.meal.mealType).toBe("dinner");
    expect(meal.items).toHaveLength(2);
    expect(meal.totals.calories).toBe(455);
    const day = await ok<{ totals: { calories: number }; remaining: { calories: number }; meals: { id: string; items: { name: string }[] }[]; water: { ml: number } }>("get_nutrition_day", {});
    expect(day.totals.calories).toBe(455);
    expect(day.remaining.calories).toBe(targets.calories - 455);
    expect(day.meals[0]?.id).toBe(meal.meal.id);
    expect(day.meals[0]?.items.map((i) => i.name)).toEqual(["Grilled chicken breast", "White rice"]);
    expect(day.water.ml).toBe(750);
    const ht = await ok<{ targets: { calories: number }; latestWeight: { weightKg: number }; suggested: { calories: number } }>("get_health_targets");
    expect(ht.targets.calories).toBe(targets.calories);
    expect(ht.latestWeight.weightKg).toBe(79.4);
    expect(ht.suggested.calories).toBeGreaterThan(0);
  });
  it("names the fix when AI is disabled", async () => {
    const offline = makeTestApp();
    offline.ai.enabled = false;
    const def = tools.find((d) => d.name === "log_meal_text")!;
    const r = await runTool(def, { description: "toast" }, { ctx: offline.ctx, actor: "mcp:test" });
    expect(r.ok).toBe(false);
    expect(errorOf(r)).toContain("ANTHROPIC_API_KEY");
    offline.cleanup();
  });
  it("lists workouts and personal records", async () => {
    const db = t.ctx.db;
    const exercise = db.select().from(schema.exercises).limit(1).get()!;
    const workoutId = newId();
    db.insert(schema.workouts).values({ id: workoutId, name: "Push", startedAt: nowIso(), finishedAt: nowIso(), durationSeconds: 2400, totalVolume: 4000, totalSets: 3, prCount: 1, status: "completed" }).run();
    const weId = newId();
    db.insert(schema.workoutExercises).values({ id: weId, workoutId, exerciseId: exercise.id }).run();
    db.insert(schema.workoutSets)
      .values([
        { id: newId(), workoutExerciseId: weId, sortOrder: 0, weight: 60, reps: 8, completed: true },
        { id: newId(), workoutExerciseId: weId, sortOrder: 1, weight: 70, reps: 5, completed: true },
        { id: newId(), workoutExerciseId: weId, sortOrder: 2, weight: 80, reps: 1, completed: false },
      ])
      .run();
    db.insert(schema.personalRecords).values({ id: newId(), exerciseId: exercise.id, type: "weight", value: 70, weight: 70, reps: 5, workoutId, achievedAt: nowIso() }).run();
    const recent = await ok<{ workouts: { id: string; exercises: { name: string; sets: number; topWeight: number }[] }[] }>("list_recent_workouts", { limit: 5 });
    expect(recent.workouts[0]?.id).toBe(workoutId);
    expect(recent.workouts[0]?.exercises).toEqual([{ name: exercise.name, sets: 2, topWeight: 70 }]);
    const prs = await ok<{ records: { exercise: string; type: string; value: number }[] }>("get_personal_records", { exerciseName: exercise.name.slice(0, 4).toLowerCase() });
    expect(prs.records).toEqual([expect.objectContaining({ exercise: exercise.name, type: "weight", value: 70 })]);
    const none = await ok<{ records: unknown[] }>("get_personal_records", { exerciseName: "zzzz-no-such-exercise" });
    expect(none.records).toEqual([]);
  });
});

describe("summary tools", () => {
  it("day and week summaries, activity and whoami", async () => {
    const day = await ok<{ date: string; tasks: { due: unknown[]; doneCount: number }; nutrition: { totals: { calories: number } }; water: { ml: number }; goals: unknown[]; trackers: unknown[] }>("get_day_summary");
    expect(day.date).toBe(today);
    expect(day.nutrition.totals.calories).toBe(455);
    expect(day.water.ml).toBe(750);
    expect(day.trackers.length).toBeGreaterThan(0);
    const other = await ok<{ date: string }>("get_day_summary", { date: "2026-12-01" });
    expect(other.date).toBe("2026-12-01");
    const week = await ok<{ days: { date: string }[]; totals: { calories: number } }>("get_week_summary");
    expect(week.days).toHaveLength(7);
    expect(week.totals.calories).toBe(455);
    const activity = await ok<{ activity: { actor: string; entity: string }[] }>("recent_activity", { limit: 5, entity: "meal" });
    expect(activity.activity[0]).toMatchObject({ actor: "mcp:test", entity: "meal" });
    const me = await ok<{ app: string; user: string; today: string; actor: string; surfaces: string[]; urls: { mcp: string } }>("whoami");
    expect(me).toMatchObject({ app: "AravOS", user: "Arav", today, actor: "mcp:test" });
    expect(me.surfaces).toContain("mcp");
    expect(me.urls.mcp).toBe("http://test.local/mcp");
  });
});
