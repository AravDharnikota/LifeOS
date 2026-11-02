import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { addDaysString, dateOfIso, sumNutrients, todayString, weekStartString, type CalEvent, type Goal, type HealthProfile, type Nutrients, type Task, type Tracker } from "@aravos/shared";
import type { AppContext } from "../app.ts";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { eventsOnDate } from "./calendar.ts";
import { listGoals } from "./goals.ts";
import { getAppSettings, getHealthProfile } from "./settings.ts";
import { countOpenTasks, listTasks, tasksDoneOn } from "./tasks.ts";
import { serializeTracker, trackerValue } from "../routes/trackers.ts";

export type HealthTargets = HealthProfile["targets"];

export interface NutrientRemaining {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

export interface MealSummary {
  id: string;
  mealType: string;
  name: string | null;
  loggedAt: string;
  calories: number;
  proteinG: number;
}

export interface NutritionDay {
  date: string;
  totals: Nutrients;
  targets: HealthTargets;
  remaining: NutrientRemaining;
  meals: MealSummary[];
}

export interface WorkoutSummary {
  id: string;
  name: string;
  startedAt: string;
  durationSeconds: number | null;
  totalVolume: number | null;
  prCount: number;
}

export interface HabitDue {
  id: string;
  title: string;
  done: boolean;
  cadence: string | null;
  streak: number;
  periodCount: number;
  timesPerPeriod: number | null;
}

export interface DaySummary {
  date: string;
  events: CalEvent[];
  tasks: { due: Task[]; overdue: Task[]; doneCount: number; openCount: number };
  nutrition: NutritionDay;
  water: { ml: number; target: number };
  weight: { latestKg: number; date: string } | null;
  workouts: { today: WorkoutSummary[]; thisWeekCount: number; weeklyTarget: number };
  goals: Goal[];
  habitsDueToday: HabitDue[];
  trackers: Tracker[];
}

export interface WeekDaySummary {
  date: string;
  calories: number;
  proteinG: number;
  waterMl: number;
  workouts: number;
  tasksDone: number;
}

export interface WeekSummary {
  start: string;
  end: string;
  days: WeekDaySummary[];
  totals: { calories: number; proteinG: number; waterMl: number; workouts: number; tasksDone: number };
  targets: { caloriesPerDay: number; waterMlPerDay: number; workoutsPerWeek: number };
  weight: { firstKg: number; lastKg: number; changeKg: number } | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Local-day window as UTC ISO strings. The process runs in the user's timezone. */
export function localDayBounds(date: string): { startIso: string; endIso: string } {
  const start = new Date(date + "T00:00:00");
  const end = new Date(addDaysString(date, 1) + "T00:00:00");
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function weekBounds(db: Db, date: string): { start: string; end: string } {
  const start = weekStartString(date, getAppSettings(db).weekStartsOn);
  return { start, end: addDaysString(start, 7) };
}

export function nutritionForDate(db: Db, date: string): NutritionDay {
  const mealRows = db
    .select()
    .from(schema.meals)
    .where(and(eq(schema.meals.date, date), isNull(schema.meals.deletedAt)))
    .orderBy(schema.meals.loggedAt)
    .all();
  const items = mealRows.length ? db.select().from(schema.mealItems).where(inArray(schema.mealItems.mealId, mealRows.map((m) => m.id))).all() : [];
  const totals = sumNutrients(items);
  const targets = getHealthProfile(db).targets;
  const meals: MealSummary[] = mealRows.map((m) => {
    const mine = items.filter((i) => i.mealId === m.id);
    const t = sumNutrients(mine);
    return { id: m.id, mealType: m.mealType, name: m.name, loggedAt: m.loggedAt, calories: Math.round(t.calories), proteinG: round1(t.proteinG) };
  });
  return {
    date,
    totals: roundNutrients(totals),
    targets,
    remaining: {
      calories: Math.round(targets.calories - totals.calories),
      proteinG: round1(targets.proteinG - totals.proteinG),
      carbsG: round1(targets.carbsG - totals.carbsG),
      fatG: round1(targets.fatG - totals.fatG),
      fiberG: round1(targets.fiberG - (totals.fiberG ?? 0)),
    },
    meals,
  };
}

function roundNutrients(n: Nutrients): Nutrients {
  const r = (v: number | null | undefined) => (v == null ? v : round1(v));
  return {
    calories: Math.round(n.calories),
    proteinG: round1(n.proteinG),
    carbsG: round1(n.carbsG),
    fatG: round1(n.fatG),
    fiberG: r(n.fiberG),
    sugarG: r(n.sugarG),
    sodiumMg: r(n.sodiumMg),
    saturatedFatG: r(n.saturatedFatG),
    cholesterolMg: r(n.cholesterolMg),
    potassiumMg: r(n.potassiumMg),
  };
}

export function waterForDate(db: Db, date: string): number {
  return db.select({ ml: sql<number>`coalesce(sum(${schema.waterLogs.ml}), 0)` }).from(schema.waterLogs).where(eq(schema.waterLogs.date, date)).get()?.ml ?? 0;
}

export function latestWeight(db: Db, onOrBefore: string): { latestKg: number; date: string; bodyFatPct: number | null } | null {
  const row = db
    .select()
    .from(schema.weightLogs)
    .where(sql`${schema.weightLogs.date} <= ${onOrBefore}`)
    .orderBy(desc(schema.weightLogs.date), desc(schema.weightLogs.loggedAt))
    .limit(1)
    .get();
  return row ? { latestKg: row.weightKg, date: row.date, bodyFatPct: row.bodyFatPct } : null;
}

function completedWorkoutsBetween(db: Db, startIso: string, endIso: string): WorkoutSummary[] {
  return db
    .select({ id: schema.workouts.id, name: schema.workouts.name, startedAt: schema.workouts.startedAt, durationSeconds: schema.workouts.durationSeconds, totalVolume: schema.workouts.totalVolume, prCount: schema.workouts.prCount })
    .from(schema.workouts)
    .where(and(eq(schema.workouts.status, "completed"), gte(schema.workouts.startedAt, startIso), lt(schema.workouts.startedAt, endIso)))
    .orderBy(schema.workouts.startedAt)
    .all();
}

function habitsForDate(db: Db, goals: Goal[], date: string): HabitDue[] {
  const habits = goals.filter((g) => g.kind === "habit");
  if (habits.length === 0) return [];
  const done = new Set(
    db
      .select({ goalId: schema.goalEntries.goalId })
      .from(schema.goalEntries)
      .where(and(inArray(schema.goalEntries.goalId, habits.map((h) => h.id)), eq(schema.goalEntries.date, date)))
      .all()
      .map((r) => r.goalId),
  );
  return habits.map((h) => ({ id: h.id, title: h.title, done: done.has(h.id), cadence: h.cadence, streak: h.streak ?? 0, periodCount: h.periodCount ?? 0, timesPerPeriod: h.timesPerPeriod }));
}

function trackersForDate(db: Db, date: string): Tracker[] {
  return db
    .select()
    .from(schema.trackers)
    .where(isNull(schema.trackers.deletedAt))
    .orderBy(schema.trackers.createdAt)
    .all()
    .map((row) => ({ ...serializeTracker(db, row), todayValue: trackerValue(db, row, date) }));
}

export function getDaySummary(ctx: AppContext, date: string = todayString()): DaySummary {
  const { db } = ctx;
  const todayView = listTasks(db, { view: "today", date });
  const overdue = listTasks(db, { view: "overdue", date });
  const overdueIds = new Set(overdue.map((t) => t.id));
  const due = todayView.filter((t) => t.status === "open" && !overdueIds.has(t.id));
  const week = weekBounds(db, date);
  const weekStartIso = localDayBounds(week.start).startIso;
  const weekEndIso = localDayBounds(week.end).startIso;
  const day = localDayBounds(date);
  const profile = getHealthProfile(db);
  const goals = listGoals(db, { status: "active" });
  const weight = latestWeight(db, date);
  return {
    date,
    events: eventsOnDate(db, date),
    tasks: { due, overdue, doneCount: tasksDoneOn(db, date), openCount: countOpenTasks(db) },
    nutrition: nutritionForDate(db, date),
    water: { ml: waterForDate(db, date), target: profile.targets.waterMl },
    weight: weight ? { latestKg: weight.latestKg, date: weight.date } : null,
    workouts: {
      today: completedWorkoutsBetween(db, day.startIso, day.endIso),
      thisWeekCount: completedWorkoutsBetween(db, weekStartIso, weekEndIso).length,
      weeklyTarget: profile.targets.workoutsPerWeek,
    },
    goals,
    habitsDueToday: habitsForDate(db, goals, date),
    trackers: trackersForDate(db, date),
  };
}

export function getWeekSummary(ctx: AppContext, weekStart?: string): WeekSummary {
  const { db } = ctx;
  const start = weekStart ?? weekBounds(db, todayString()).start;
  const end = addDaysString(start, 7);
  const lastDay = addDaysString(start, 6);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysString(start, i));
  const nutrition = db
    .select({ date: schema.meals.date, calories: sql<number>`coalesce(sum(${schema.mealItems.calories}), 0)`, proteinG: sql<number>`coalesce(sum(${schema.mealItems.proteinG}), 0)` })
    .from(schema.mealItems)
    .innerJoin(schema.meals, eq(schema.mealItems.mealId, schema.meals.id))
    .where(and(gte(schema.meals.date, start), lt(schema.meals.date, end), isNull(schema.meals.deletedAt)))
    .groupBy(schema.meals.date)
    .all();
  const water = db
    .select({ date: schema.waterLogs.date, ml: sql<number>`coalesce(sum(${schema.waterLogs.ml}), 0)` })
    .from(schema.waterLogs)
    .where(and(gte(schema.waterLogs.date, start), lt(schema.waterLogs.date, end)))
    .groupBy(schema.waterLogs.date)
    .all();
  const workouts = completedWorkoutsBetween(db, localDayBounds(start).startIso, localDayBounds(end).startIso);
  const workoutsByDate = new Map<string, number>();
  for (const w of workouts) {
    const d = dateOfIso(w.startedAt);
    workoutsByDate.set(d, (workoutsByDate.get(d) ?? 0) + 1);
  }
  const days: WeekDaySummary[] = dates.map((date) => {
    const n = nutrition.find((r) => r.date === date);
    return {
      date,
      calories: Math.round(n?.calories ?? 0),
      proteinG: round1(n?.proteinG ?? 0),
      waterMl: water.find((r) => r.date === date)?.ml ?? 0,
      workouts: workoutsByDate.get(date) ?? 0,
      tasksDone: tasksDoneOn(db, date),
    };
  });
  const totals = days.reduce(
    (acc, d) => ({ calories: acc.calories + d.calories, proteinG: round1(acc.proteinG + d.proteinG), waterMl: acc.waterMl + d.waterMl, workouts: acc.workouts + d.workouts, tasksDone: acc.tasksDone + d.tasksDone }),
    { calories: 0, proteinG: 0, waterMl: 0, workouts: 0, tasksDone: 0 },
  );
  const targets = getHealthProfile(db).targets;
  const weights = db
    .select({ weightKg: schema.weightLogs.weightKg })
    .from(schema.weightLogs)
    .where(and(gte(schema.weightLogs.date, start), lt(schema.weightLogs.date, end)))
    .orderBy(schema.weightLogs.date, schema.weightLogs.loggedAt)
    .all();
  const first = weights[0];
  const last = weights[weights.length - 1];
  return {
    start,
    end: lastDay,
    days,
    totals,
    targets: { caloriesPerDay: targets.calories, waterMlPerDay: targets.waterMl, workoutsPerWeek: targets.workoutsPerWeek },
    weight: first && last ? { firstKg: first.weightKg, lastKg: last.weightKg, changeKg: round1(last.weightKg - first.weightKg) } : null,
  };
}
