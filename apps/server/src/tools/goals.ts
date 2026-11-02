import { z } from "zod";
import { isoDate, todayString, type Goal } from "@aravos/shared";
import { badRequest } from "../lib/errors.ts";
import { addMilestone, createGoal, getGoal, listGoals, logGoalEntry, updateGoal, updateMilestone } from "../services/goals.ts";
import { defineTool, type ToolDef } from "./types.ts";

const GOAL_KINDS = ["number", "habit", "milestone", "boolean"] as const;
const GOAL_STATUS = ["active", "done", "paused", "archived"] as const;
const goalId = z.string().min(1).describe("Goal id (from list_goals)");
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Compact goal row with derived progress; milestones summarized as counts. */
export function compactGoal(g: Goal) {
  const milestones = g.milestones ?? [];
  return {
    id: g.id,
    title: g.title,
    kind: g.kind,
    area: g.area,
    status: g.status,
    unit: g.unit,
    startValue: g.startValue,
    currentValue: g.currentValue,
    targetValue: g.targetValue,
    direction: g.direction,
    progress: round2(g.progress ?? 0),
    streak: g.streak ?? null,
    cadence: g.cadence,
    timesPerPeriod: g.timesPerPeriod,
    periodCount: g.periodCount ?? 0,
    deadline: g.deadline,
    milestones: { total: milestones.length, done: milestones.filter((m) => m.done).length },
  };
}

const listGoalsTool = defineTool({
  name: "list_goals",
  description: "List goals with progress (0-1), habit streaks and milestone counts. status defaults to active; pass all for every status. area filters by life area (health, work, learning, money, life, ...).",
  input: z.object({ status: z.enum([...GOAL_STATUS, "all"]).optional().describe("Default active"), area: z.string().max(40).optional() }),
  readOnly: true,
  handler: ({ status, area }, { ctx }) => {
    const goals = listGoals(ctx.db, { status: status ?? "active", area });
    return { count: goals.length, goals: goals.map(compactGoal) };
  },
});

const getGoalTool = defineTool({
  name: "get_goal",
  description: "Get one goal with its description, milestones and recent progress entries.",
  input: z.object({ id: goalId }),
  readOnly: true,
  handler: ({ id }, { ctx }) => {
    const g = getGoal(ctx.db, id);
    return { ...compactGoal(g), description: g.description, color: g.color, milestones: g.milestones ?? [], recentEntries: (g.recentEntries ?? []).slice(0, 30) };
  },
});

const addGoalTool = defineTool({
  name: "add_goal",
  description:
    "Create a goal. kind number tracks a value toward targetValue (default; use direction decrease for things like weight); habit tracks check-ins with cadence daily or weekly and timesPerPeriod; milestone is a checklist (add milestones with add_milestone); boolean is done or not. deadline is YYYY-MM-DD local.",
  input: z.object({
    title: z.string().trim().min(1).max(300),
    kind: z.enum(GOAL_KINDS).optional().describe("Default number"),
    targetValue: z.number().optional(),
    startValue: z.number().optional().describe("Number goals: the baseline; default currentValue or 0"),
    currentValue: z.number().optional(),
    direction: z.enum(["increase", "decrease"]).optional(),
    unit: z.string().max(30).optional().describe("For example kg, books, km"),
    deadline: isoDate.optional().describe("YYYY-MM-DD local"),
    area: z.string().max(40).optional().describe("health, work, learning, money, life or any short label"),
    cadence: z.enum(["daily", "weekly"]).optional().describe("Habits only; default daily"),
    timesPerPeriod: z.number().int().min(1).max(100).optional().describe("Habits: check-ins wanted per period, for example 4 per week"),
    description: z.string().max(5000).optional(),
  }),
  handler: (i, { ctx, actor }) => compactGoal(createGoal(ctx.db, i, actor)),
});

const updateGoalTool = defineTool({
  name: "update_goal",
  description: "Update a goal's fields or status (active, paused, done, archived). Only passed fields change. Use log_goal_progress to record progress rather than setting currentValue here.",
  input: z.object({
    id: goalId,
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().max(5000).nullable().optional(),
    area: z.string().max(40).optional(),
    status: z.enum(GOAL_STATUS).optional(),
    unit: z.string().max(30).nullable().optional(),
    targetValue: z.number().nullable().optional(),
    startValue: z.number().nullable().optional(),
    currentValue: z.number().nullable().optional(),
    direction: z.enum(["increase", "decrease"]).optional(),
    deadline: isoDate.nullable().optional(),
    cadence: z.enum(["daily", "weekly"]).nullable().optional(),
    timesPerPeriod: z.number().int().min(1).max(100).nullable().optional(),
  }),
  handler: ({ id, ...patch }, { ctx, actor }) => compactGoal(updateGoal(ctx.db, id, patch, actor)),
});

const logGoalProgressTool = defineTool({
  name: "log_goal_progress",
  description:
    "Record progress. Number goals: pass value (new absolute value) or delta (added to the current value); the goal completes when the target is reached. Habit goals: toggles the check-in for date (default today), so calling it again unmarks the day. Boolean goals: toggles done. date is YYYY-MM-DD local.",
  input: z.object({
    id: goalId,
    value: z.number().optional().describe("Number goals: absolute new value"),
    delta: z.number().optional().describe("Number goals: amount to add (negative to subtract)"),
    date: isoDate.optional().describe("YYYY-MM-DD local; default today"),
    note: z.string().max(1000).optional(),
  }),
  handler: ({ id, value, delta, date, note }, { ctx, actor }) => {
    const existing = getGoal(ctx.db, id);
    if (existing.kind === "number" && value === undefined && delta === undefined) throw badRequest("Number goals need value or delta");
    const g = logGoalEntry(ctx.db, id, { value, delta, date, note }, actor);
    const day = date ?? todayString();
    if (g.kind === "habit") return { ...compactGoal(g), date: day, checkedIn: (g.recentEntries ?? []).some((e) => e.date === day) };
    return compactGoal(g);
  },
});

const addMilestoneTool = defineTool({
  name: "add_milestone",
  description: "Add a milestone (checklist step) to a goal. dueDate is YYYY-MM-DD local.",
  input: z.object({ goalId: z.string().min(1), title: z.string().trim().min(1).max(300), dueDate: isoDate.optional() }),
  handler: ({ goalId: gid, title, dueDate }, { ctx }) => addMilestone(ctx.db, gid, { title, dueDate }),
});

const completeMilestoneTool = defineTool({
  name: "complete_milestone",
  description: "Mark a milestone done (default) or not done with done false. Milestone ids come from get_goal.",
  input: z.object({ id: z.string().min(1).describe("Milestone id"), done: z.boolean().optional().describe("Default true") }),
  handler: ({ id, done }, { ctx }) => updateMilestone(ctx.db, id, { done: done ?? true }),
});

export const goalsTools: ToolDef[] = [listGoalsTool, getGoalTool, addGoalTool, updateGoalTool, logGoalProgressTool, addMilestoneTool, completeMilestoneTool];
