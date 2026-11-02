import { describe, it, expect, afterAll } from "vitest";
import { addDaysString, todayString, weekStartString } from "@aravos/shared";
import { makeTestApp } from "./helpers.ts";
import { schema } from "../src/db/client.ts";
import { newId, nowIso } from "../src/lib/ids.ts";
import { getHealthProfile } from "../src/services/settings.ts";
import { getDaySummary, getWeekSummary, type DaySummary, type WeekSummary } from "../src/services/summary.ts";

const t = makeTestApp();
afterAll(() => t.cleanup());

const today = todayString();
const yesterday = addDaysString(today, -1);
const db = t.ctx.db;
const targets = getHealthProfile(db).targets;

async function seed(): Promise<{ dueId: string; overdueId: string; doneId: string; eventId: string; timeboxId: string }> {
  const due = await t.api<{ id: string }>("POST", "/api/tasks", { title: "Due today", dueDate: today, estimateMinutes: 30 });
  const overdue = await t.api<{ id: string }>("POST", "/api/tasks", { title: "Late", dueDate: yesterday });
  const done = await t.api<{ id: string }>("POST", "/api/tasks", { title: "Finished", dueDate: today });
  await t.api("POST", `/api/tasks/${done.data.id}/complete`, {});
  const event = await t.api<{ id: string }>("POST", "/api/events", { title: "Dentist", start: `${today}T10:00:00`, end: `${today}T11:00:00` });
  const timebox = await t.api<{ id: string }>("POST", "/api/events", { title: "Due today", start: `${today}T14:00:00`, end: `${today}T14:30:00`, taskId: due.data.id });

  const mealId = newId();
  db.insert(schema.meals).values({ id: mealId, date: today, mealType: "lunch", name: "Chicken bowl", loggedAt: nowIso(), source: "manual" }).run();
  db.insert(schema.mealItems)
    .values([
      { id: newId(), mealId, name: "Chicken", calories: 250, proteinG: 46, carbsG: 0, fatG: 5.5, fiberG: 0 },
      { id: newId(), mealId, name: "Rice", calories: 205, proteinG: 4.2, carbsG: 45, fatG: 0.4, fiberG: 0.6 },
    ])
    .run();
  const deletedMeal = newId();
  db.insert(schema.meals).values({ id: deletedMeal, date: today, mealType: "snack", loggedAt: nowIso(), deletedAt: nowIso() }).run();
  db.insert(schema.mealItems).values({ id: newId(), mealId: deletedMeal, name: "Ignored", calories: 999, proteinG: 0, carbsG: 0, fatG: 0 }).run();

  db.insert(schema.waterLogs)
    .values([
      { id: newId(), date: today, ml: 500, loggedAt: nowIso() },
      { id: newId(), date: today, ml: 250, loggedAt: nowIso() },
      { id: newId(), date: yesterday, ml: 1000, loggedAt: nowIso() },
    ])
    .run();
  db.insert(schema.weightLogs)
    .values([
      { id: newId(), date: yesterday, weightKg: 80, loggedAt: nowIso() },
      { id: newId(), date: today, weightKg: 79.5, loggedAt: nowIso() },
    ])
    .run();
  db.insert(schema.workouts).values({ id: newId(), name: "Push day", startedAt: new Date(`${today}T07:00:00`).toISOString(), finishedAt: nowIso(), durationSeconds: 3600, totalVolume: 5000, prCount: 1, status: "completed" }).run();
  db.insert(schema.workouts).values({ id: newId(), name: "Abandoned", startedAt: new Date(`${today}T08:00:00`).toISOString(), status: "discarded" }).run();

  const habit = await t.api<{ id: string }>("POST", "/api/goals", { title: "Meditate", kind: "habit" });
  await t.api("POST", `/api/goals/${habit.data.id}/log`, { date: today });
  await t.api("POST", "/api/goals", { title: "Read", kind: "habit" });
  await t.api("POST", "/api/goals", { title: "Save money", kind: "number", targetValue: 1000, unit: "usd" });
  const tracker = await t.api<{ id: string }>("POST", "/api/trackers", { name: "Coffee", unit: "cups" });
  await t.api("POST", `/api/trackers/${tracker.data.id}/log`, { date: today, delta: 2 });
  return { dueId: due.data.id, overdueId: overdue.data.id, doneId: done.data.id, eventId: event.data.id, timeboxId: timebox.data.id };
}

const seeded = seed();

describe("day summary", () => {
  it("has the full shape with correct totals", async () => {
    const ids = await seeded;
    const r = await t.api<DaySummary>("GET", `/api/summary/day?date=${today}`);
    const s = r.data;
    expect(s.date).toBe(today);
    expect(s.events.map((e) => e.id).sort()).toEqual([ids.eventId, ids.timeboxId].sort());
    expect(s.events.find((e) => e.id === ids.timeboxId)?.taskStatus).toBe("open");
    expect(s.tasks.due.map((x) => x.id)).toEqual([ids.dueId]);
    expect(s.tasks.overdue.map((x) => x.id)).toEqual([ids.overdueId]);
    expect(s.tasks.doneCount).toBe(1);
    expect(s.tasks.openCount).toBe(2);
    expect(s.nutrition.totals.calories).toBe(455);
    expect(s.nutrition.totals.proteinG).toBeCloseTo(50.2);
    expect(s.nutrition.targets.calories).toBe(targets.calories);
    expect(s.nutrition.remaining.calories).toBe(targets.calories - 455);
    expect(s.nutrition.meals).toHaveLength(1);
    expect(s.nutrition.meals[0]?.calories).toBe(455);
    expect(s.water).toEqual({ ml: 750, target: targets.waterMl });
    expect(s.weight).toEqual({ latestKg: 79.5, date: today });
    expect(s.workouts.today.map((w) => w.name)).toEqual(["Push day"]);
    expect(s.workouts.thisWeekCount).toBe(1);
    expect(s.workouts.weeklyTarget).toBe(targets.workoutsPerWeek);
    expect(s.goals).toHaveLength(3);
    const habits = s.habitsDueToday.map((h) => [h.title, h.done]);
    expect(habits).toEqual(expect.arrayContaining([["Meditate", true], ["Read", false]]));
    expect(s.habitsDueToday).toHaveLength(2);
    expect(s.trackers[0]?.todayValue).toBe(2);
  });
  it("defaults to today and validates the date", async () => {
    await seeded;
    const r = await t.api<DaySummary>("GET", "/api/summary/day");
    expect(r.data.date).toBe(today);
    const bad = await t.api("GET", "/api/summary/day?date=nope", undefined, { allowError: true });
    expect(bad.status).toBe(400);
  });
  it("is empty for a day with nothing logged", async () => {
    await seeded;
    const s = getDaySummary(t.ctx, "2020-01-01");
    expect(s.events).toEqual([]);
    expect(s.nutrition.totals.calories).toBe(0);
    expect(s.water.ml).toBe(0);
    expect(s.weight).toBeNull();
    expect(s.workouts.today).toEqual([]);
    expect(s.trackers[0]?.todayValue).toBe(0);
  });
});

describe("week summary", () => {
  it("aggregates per day and in total", async () => {
    await seeded;
    const start = weekStartString(today);
    const r = await t.api<WeekSummary>("GET", `/api/summary/week?start=${start}`);
    const w = r.data;
    expect(w.start).toBe(start);
    expect(w.days).toHaveLength(7);
    expect(w.days[0]?.date).toBe(start);
    const day = w.days.find((d) => d.date === today);
    expect(day).toMatchObject({ calories: 455, waterMl: 750, workouts: 1, tasksDone: 1 });
    expect(w.totals.calories).toBe(455);
    expect(w.totals.workouts).toBe(1);
    expect(w.totals.tasksDone).toBe(1);
    const inWeek = yesterday >= start;
    expect(w.totals.waterMl).toBe(inWeek ? 1750 : 750);
    expect(w.targets).toEqual({ caloriesPerDay: targets.calories, waterMlPerDay: targets.waterMl, workoutsPerWeek: targets.workoutsPerWeek });
    if (inWeek) expect(w.weight).toEqual({ firstKg: 80, lastKg: 79.5, changeKg: -0.5 });
  });
  it("defaults to the current week", async () => {
    await seeded;
    const w = getWeekSummary(t.ctx);
    expect(w.start).toBe(weekStartString(today));
  });
});
