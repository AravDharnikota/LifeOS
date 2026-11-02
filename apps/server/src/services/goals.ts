import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { addDaysString, todayString, weekStartString, type Goal, type GoalCreate, type GoalEntry, type GoalMilestone } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { notFound } from "../lib/errors.ts";
import { logActivity } from "./activity.ts";

type Row = typeof schema.goals.$inferSelect;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeProgress(g: Row, periodCount: number): number {
  if (g.status === "done") return 1;
  switch (g.kind) {
    case "boolean":
      return 0;
    case "habit": {
      const target = g.timesPerPeriod ?? 1;
      return clamp01(periodCount / target);
    }
    case "milestone":
      return 0; // computed from milestones by caller
    default: {
      if (g.targetValue == null || g.currentValue == null) return 0;
      const start = g.startValue ?? 0;
      const span = g.targetValue - start;
      if (span === 0) return 1;
      return clamp01((g.currentValue - start) / span);
    }
  }
}

export function habitStreak(entries: { date: string }[], cadence: string | null, today = todayString()): number {
  const dates = new Set(entries.map((e) => e.date));
  if (cadence === "weekly") {
    let streak = 0;
    let wk = weekStartString(today);
    const weeks = new Set(entries.map((e) => weekStartString(e.date)));
    while (weeks.has(wk)) {
      streak++;
      wk = addDaysString(wk, -7);
    }
    return streak;
  }
  let streak = 0;
  let d = today;
  if (!dates.has(d)) d = addDaysString(d, -1); // allow today to be unfinished
  while (dates.has(d)) {
    streak++;
    d = addDaysString(d, -1);
  }
  return streak;
}

export function serializeGoal(db: Db, g: Row, opts: { withDetails?: boolean } = {}): Goal {
  const today = todayString();
  const periodStart = g.cadence === "weekly" ? weekStartString(today) : today;
  const entries = db.select().from(schema.goalEntries).where(and(eq(schema.goalEntries.goalId, g.id), gte(schema.goalEntries.date, addDaysString(today, -120)))).orderBy(desc(schema.goalEntries.date)).all();
  const periodCount = entries.filter((e) => e.date >= periodStart).reduce((n, e) => n + (g.kind === "habit" ? 1 : e.value), 0);
  const milestones = db.select().from(schema.goalMilestones).where(eq(schema.goalMilestones.goalId, g.id)).orderBy(asc(schema.goalMilestones.sortOrder), asc(schema.goalMilestones.createdAt)).all();
  let progress = computeProgress(g, periodCount);
  if (g.kind === "milestone" && milestones.length) progress = milestones.filter((m) => m.done).length / milestones.length;
  if (g.kind === "boolean") progress = g.status === "done" ? 1 : 0;
  const goal: Goal = {
    id: g.id,
    title: g.title,
    description: g.description,
    area: g.area,
    kind: g.kind as Goal["kind"],
    unit: g.unit,
    startValue: g.startValue,
    targetValue: g.targetValue,
    currentValue: g.currentValue,
    direction: g.direction as Goal["direction"],
    cadence: g.cadence,
    timesPerPeriod: g.timesPerPeriod,
    deadline: g.deadline,
    color: g.color,
    status: g.status as Goal["status"],
    sortOrder: g.sortOrder,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    deletedAt: g.deletedAt,
    progress,
    streak: g.kind === "habit" ? habitStreak(entries, g.cadence, today) : undefined,
    periodCount,
    milestones: milestones.map(serializeMilestone),
  };
  if (opts.withDetails) goal.recentEntries = entries.slice(0, 60).map(serializeEntry);
  return goal;
}

export const serializeEntry = (e: typeof schema.goalEntries.$inferSelect): GoalEntry => ({ id: e.id, goalId: e.goalId, date: e.date, value: e.value, note: e.note, createdAt: e.createdAt });
export const serializeMilestone = (m: typeof schema.goalMilestones.$inferSelect): GoalMilestone => ({ id: m.id, goalId: m.goalId, title: m.title, done: m.done, doneAt: m.doneAt, dueDate: m.dueDate, sortOrder: m.sortOrder, createdAt: m.createdAt });

export function listGoals(db: Db, opts: { status?: string; area?: string } = {}): Goal[] {
  const conds = [isNull(schema.goals.deletedAt)];
  if (opts.status && opts.status !== "all") conds.push(eq(schema.goals.status, opts.status));
  if (opts.area) conds.push(eq(schema.goals.area, opts.area));
  const rows = db.select().from(schema.goals).where(and(...conds)).orderBy(asc(schema.goals.sortOrder), asc(schema.goals.createdAt)).all();
  return rows.map((r) => serializeGoal(db, r));
}

export function getGoal(db: Db, id: string): Goal {
  const row = db.select().from(schema.goals).where(and(eq(schema.goals.id, id), isNull(schema.goals.deletedAt))).get();
  if (!row) throw notFound("Goal");
  return serializeGoal(db, row, { withDetails: true });
}

export function createGoal(db: Db, input: GoalCreate, actor = "user"): Goal {
  const id = newId();
  const maxSort = db.select({ m: sql<number>`coalesce(max(${schema.goals.sortOrder}), 0)` }).from(schema.goals).get()?.m ?? 0;
  db.insert(schema.goals)
    .values({
      id,
      title: input.title,
      description: input.description ?? null,
      area: input.area ?? "life",
      kind: input.kind ?? "number",
      unit: input.unit ?? null,
      startValue: input.startValue ?? (input.kind === "number" ? (input.currentValue ?? 0) : null),
      targetValue: input.targetValue ?? null,
      currentValue: input.currentValue ?? (input.kind === "number" || !input.kind ? (input.startValue ?? 0) : null),
      direction: input.direction ?? "increase",
      cadence: input.cadence ?? (input.kind === "habit" ? "daily" : null),
      timesPerPeriod: input.timesPerPeriod ?? (input.kind === "habit" ? 1 : null),
      deadline: input.deadline ?? null,
      color: input.color ?? null,
      status: input.status ?? "active",
      sortOrder: input.sortOrder ?? maxSort + 1,
    })
    .run();
  logActivity(db, { actor, action: "created", entity: "goal", entityId: id, summary: `Added goal "${input.title}"` });
  return getGoal(db, id);
}

export function updateGoal(db: Db, id: string, input: Partial<GoalCreate>, actor = "user"): Goal {
  const existing = db.select().from(schema.goals).where(and(eq(schema.goals.id, id), isNull(schema.goals.deletedAt))).get();
  if (!existing) throw notFound("Goal");
  const set: Record<string, unknown> = { updatedAt: nowIso() };
  for (const [k, v] of Object.entries(input)) if (v !== undefined) set[k] = v;
  db.update(schema.goals).set(set).where(eq(schema.goals.id, id)).run();
  logActivity(db, { actor, action: "updated", entity: "goal", entityId: id, summary: `Updated goal "${input.title ?? existing.title}"`, data: input });
  return getGoal(db, id);
}

export function deleteGoal(db: Db, id: string, actor = "user"): void {
  const existing = db.select().from(schema.goals).where(and(eq(schema.goals.id, id), isNull(schema.goals.deletedAt))).get();
  if (!existing) throw notFound("Goal");
  db.update(schema.goals).set({ deletedAt: nowIso() }).where(eq(schema.goals.id, id)).run();
  logActivity(db, { actor, action: "deleted", entity: "goal", entityId: id, summary: `Deleted goal "${existing.title}"` });
}

/** Log progress: for number goals this sets currentValue (absolute) or adds delta; for habits it records a check-in. */
export function logGoalEntry(db: Db, id: string, input: { date?: string; value?: number; delta?: number; note?: string | null }, actor = "user"): Goal {
  const existing = db.select().from(schema.goals).where(and(eq(schema.goals.id, id), isNull(schema.goals.deletedAt))).get();
  if (!existing) throw notFound("Goal");
  const date = input.date ?? todayString();
  if (existing.kind === "habit") {
    const already = db.select().from(schema.goalEntries).where(and(eq(schema.goalEntries.goalId, id), eq(schema.goalEntries.date, date))).get();
    if (already) {
      // toggle off
      db.delete(schema.goalEntries).where(eq(schema.goalEntries.id, already.id)).run();
    } else {
      db.insert(schema.goalEntries).values({ id: newId(), goalId: id, date, value: 1, note: input.note ?? null }).run();
    }
  } else if (existing.kind === "boolean") {
    db.update(schema.goals).set({ status: existing.status === "done" ? "active" : "done", updatedAt: nowIso() }).where(eq(schema.goals.id, id)).run();
  } else {
    const value = input.value ?? (existing.currentValue ?? 0) + (input.delta ?? 0);
    db.insert(schema.goalEntries).values({ id: newId(), goalId: id, date, value, note: input.note ?? null }).run();
    const set: Record<string, unknown> = { currentValue: value, updatedAt: nowIso() };
    if (existing.targetValue != null && ((existing.direction === "increase" && value >= existing.targetValue) || (existing.direction === "decrease" && value <= existing.targetValue))) set.status = "done";
    db.update(schema.goals).set(set).where(eq(schema.goals.id, id)).run();
  }
  logActivity(db, { actor, action: "logged", entity: "goal", entityId: id, summary: `Logged progress on "${existing.title}"`, data: input });
  return getGoal(db, id);
}

export function addMilestone(db: Db, goalId: string, input: { title: string; dueDate?: string | null; sortOrder?: number }): GoalMilestone {
  if (!db.select().from(schema.goals).where(and(eq(schema.goals.id, goalId), isNull(schema.goals.deletedAt))).get()) throw notFound("Goal");
  const id = newId();
  const maxSort = db.select({ m: sql<number>`coalesce(max(${schema.goalMilestones.sortOrder}), 0)` }).from(schema.goalMilestones).where(eq(schema.goalMilestones.goalId, goalId)).get()?.m ?? 0;
  db.insert(schema.goalMilestones).values({ id, goalId, title: input.title, dueDate: input.dueDate ?? null, sortOrder: input.sortOrder ?? maxSort + 1 }).run();
  return serializeMilestone(db.select().from(schema.goalMilestones).where(eq(schema.goalMilestones.id, id)).get()!);
}

export function updateMilestone(db: Db, id: string, input: { title?: string; done?: boolean; dueDate?: string | null; sortOrder?: number }): GoalMilestone {
  const existing = db.select().from(schema.goalMilestones).where(eq(schema.goalMilestones.id, id)).get();
  if (!existing) throw notFound("Milestone");
  const set: Record<string, unknown> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.dueDate !== undefined) set.dueDate = input.dueDate;
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  if (input.done !== undefined) {
    set.done = input.done;
    set.doneAt = input.done ? nowIso() : null;
  }
  db.update(schema.goalMilestones).set(set).where(eq(schema.goalMilestones.id, id)).run();
  return serializeMilestone(db.select().from(schema.goalMilestones).where(eq(schema.goalMilestones.id, id)).get()!);
}

export function deleteMilestone(db: Db, id: string): void {
  db.delete(schema.goalMilestones).where(eq(schema.goalMilestones.id, id)).run();
}
