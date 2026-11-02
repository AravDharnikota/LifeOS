import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { format } from "date-fns";
import { isoDate, suggestTargets, sumNutrients, todayString, type FoodAnalysis } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { logActivity } from "../services/activity.ts";
import { getHealthProfile } from "../services/settings.ts";
import { latestWeight, nutritionForDate, waterForDate } from "../services/summary.ts";
import { defineTool, type ToolDef } from "./types.ts";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
const round1 = (n: number): number => Math.round(n * 10) / 10;

function waterStatus(db: Db, date: string) {
  const ml = waterForDate(db, date);
  const target = getHealthProfile(db).targets.waterMl;
  return { date, ml, target, remaining: Math.max(0, target - ml) };
}

function insertMealFromAnalysis(db: Db, analysis: FoodAnalysis, opts: { date: string; mealType?: string; loggedAt: string }): string {
  const mealId = newId();
  db.transaction((tx) => {
    tx.insert(schema.meals)
      .values({ id: mealId, date: opts.date, mealType: opts.mealType ?? analysis.mealType, name: analysis.mealName, loggedAt: opts.loggedAt, source: "text", aiNotes: analysis.notes, healthScore: analysis.healthScore })
      .run();
    if (analysis.items.length === 0) return;
    tx.insert(schema.mealItems)
      .values(
        analysis.items.map((it, i) => ({
          id: newId(),
          mealId,
          name: it.name,
          quantity: 1,
          unit: it.portion || "serving",
          grams: it.grams,
          calories: it.calories,
          proteinG: it.proteinG,
          carbsG: it.carbsG,
          fatG: it.fatG,
          fiberG: it.fiberG,
          sugarG: it.sugarG,
          sodiumMg: it.sodiumMg,
          saturatedFatG: it.saturatedFatG,
          confidence: it.confidence,
          sortOrder: i,
        })),
      )
      .run();
  });
  return mealId;
}

const getNutritionDayTool = defineTool({
  name: "get_nutrition_day",
  description: "Nutrition for one local day (YYYY-MM-DD, default today): meals with their items, macro totals, targets from the health profile, what remains, and water.",
  input: z.object({ date: isoDate.optional() }),
  readOnly: true,
  handler: ({ date }, { ctx }) => {
    const day = date ?? todayString();
    const n = nutritionForDate(ctx.db, day);
    const items = n.meals.length ? ctx.db.select().from(schema.mealItems).where(inArray(schema.mealItems.mealId, n.meals.map((m) => m.id))).orderBy(schema.mealItems.sortOrder).all() : [];
    const meals = n.meals.map((m) => ({
      ...m,
      items: items.filter((i) => i.mealId === m.id).map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unit: i.unit, grams: i.grams, calories: Math.round(i.calories), proteinG: round1(i.proteinG), carbsG: round1(i.carbsG), fatG: round1(i.fatG) })),
    }));
    return { date: day, totals: n.totals, targets: n.targets, remaining: n.remaining, meals, water: waterStatus(ctx.db, day) };
  },
});

const logWaterTool = defineTool({
  name: "log_water",
  description: "Log water intake in millilitres for a local day (default today). One glass is about 250 ml, one US cup 240 ml, one litre 1000 ml. Returns the day's total against the target.",
  input: z.object({ ml: z.number().int().min(1).max(10000), date: isoDate.optional() }),
  handler: ({ ml, date }, { ctx, actor }) => {
    const day = date ?? todayString();
    const id = newId();
    ctx.db.insert(schema.waterLogs).values({ id, date: day, ml, loggedAt: nowIso() }).run();
    const status = waterStatus(ctx.db, day);
    logActivity(ctx.db, { actor, action: "logged", entity: "water", entityId: id, summary: `Logged ${ml} ml water (${status.ml}/${status.target} ml today)` });
    return { id, logged: ml, ...status };
  },
});

const logWeightTool = defineTool({
  name: "log_weight",
  description: "Log body weight in kilograms (convert from pounds first: lb / 2.2046) for a local day (default today), optionally with body fat percent. Returns the change since the previous entry.",
  input: z.object({ weightKg: z.number().positive().max(500), date: isoDate.optional(), bodyFatPct: z.number().min(1).max(80).optional(), note: z.string().max(500).optional() }),
  handler: ({ weightKg, date, bodyFatPct, note }, { ctx, actor }) => {
    const day = date ?? todayString();
    const previous = latestWeight(ctx.db, day);
    const id = newId();
    ctx.db.insert(schema.weightLogs).values({ id, date: day, weightKg, bodyFatPct: bodyFatPct ?? null, note: note ?? null, loggedAt: nowIso() }).run();
    logActivity(ctx.db, { actor, action: "logged", entity: "weight", entityId: id, summary: `Logged weight ${weightKg} kg` });
    return { id, date: day, weightKg, bodyFatPct: bodyFatPct ?? null, previous: previous ? { weightKg: previous.latestKg, date: previous.date } : null, changeKg: previous ? round1(weightKg - previous.latestKg) : null };
  },
});

const logMealTextTool = defineTool({
  name: "log_meal_text",
  description:
    "Log a meal from a plain-text description such as \"2 eggs, toast with butter and a black coffee\". The server's AI estimates items, portions and macros, then saves the meal. mealType defaults to the AI's guess from the time of day; date is YYYY-MM-DD local (default today). Needs ANTHROPIC_API_KEY on the server.",
  input: z.object({ description: z.string().trim().min(1).max(2000), mealType: z.enum(MEAL_TYPES).optional(), date: isoDate.optional() }),
  handler: async ({ description, mealType, date }, { ctx, actor }) => {
    if (!ctx.ai.enabled) throw new Error("AI features are disabled on this server, so meals cannot be analyzed from text. Set ANTHROPIC_API_KEY in the server environment and restart to enable log_meal_text.");
    const now = new Date();
    const analysis = await ctx.ai.analyzeFood({ text: description, localTime: format(now, "HH:mm") });
    const day = date ?? todayString();
    const mealId = insertMealFromAnalysis(ctx.db, analysis, { date: day, mealType, loggedAt: now.toISOString() });
    const totals = sumNutrients(analysis.items);
    logActivity(ctx.db, { actor, action: "logged", entity: "meal", entityId: mealId, summary: `Logged meal "${analysis.mealName}" (${Math.round(totals.calories)} kcal)` });
    const n = nutritionForDate(ctx.db, day);
    return {
      meal: { id: mealId, date: day, mealType: mealType ?? analysis.mealType, name: analysis.mealName, healthScore: analysis.healthScore, notes: analysis.notes },
      items: analysis.items.map((it) => ({ name: it.name, portion: it.portion, grams: it.grams, calories: Math.round(it.calories), proteinG: round1(it.proteinG), carbsG: round1(it.carbsG), fatG: round1(it.fatG), confidence: it.confidence })),
      totals: { calories: Math.round(totals.calories), proteinG: round1(totals.proteinG), carbsG: round1(totals.carbsG), fatG: round1(totals.fatG) },
      day: { totals: n.totals, remaining: n.remaining },
    };
  },
});

const listRecentWorkoutsTool = defineTool({
  name: "list_recent_workouts",
  description: "Most recent completed workouts (newest first) with duration, total volume, personal record count and the exercises performed with their completed set counts and top weight.",
  input: z.object({ limit: z.number().int().min(1).max(50).optional().describe("Default 10") }),
  readOnly: true,
  handler: ({ limit }, { ctx }) => {
    const rows = ctx.db.select().from(schema.workouts).where(eq(schema.workouts.status, "completed")).orderBy(desc(schema.workouts.startedAt)).limit(limit ?? 10).all();
    const exRows = rows.length
      ? ctx.db
          .select({ id: schema.workoutExercises.id, workoutId: schema.workoutExercises.workoutId, name: schema.exercises.name, sortOrder: schema.workoutExercises.sortOrder })
          .from(schema.workoutExercises)
          .innerJoin(schema.exercises, eq(schema.workoutExercises.exerciseId, schema.exercises.id))
          .where(inArray(schema.workoutExercises.workoutId, rows.map((r) => r.id)))
          .orderBy(schema.workoutExercises.sortOrder)
          .all()
      : [];
    const setRows = exRows.length
      ? ctx.db
          .select({ workoutExerciseId: schema.workoutSets.workoutExerciseId, sets: sql<number>`count(*)`, topWeight: sql<number | null>`max(${schema.workoutSets.weight})` })
          .from(schema.workoutSets)
          .where(and(inArray(schema.workoutSets.workoutExerciseId, exRows.map((e) => e.id)), eq(schema.workoutSets.completed, true)))
          .groupBy(schema.workoutSets.workoutExerciseId)
          .all()
      : [];
    const setsByExercise = new Map(setRows.map((s) => [s.workoutExerciseId, s]));
    const workouts = rows.map((w) => ({
      id: w.id,
      name: w.name,
      startedAt: w.startedAt,
      finishedAt: w.finishedAt,
      durationSeconds: w.durationSeconds,
      totalVolume: w.totalVolume,
      totalSets: w.totalSets,
      prCount: w.prCount,
      exercises: exRows.filter((e) => e.workoutId === w.id).map((e) => ({ name: e.name, sets: setsByExercise.get(e.id)?.sets ?? 0, topWeight: setsByExercise.get(e.id)?.topWeight ?? null })),
    }));
    return { count: workouts.length, workouts };
  },
});

const getPersonalRecordsTool = defineTool({
  name: "get_personal_records",
  description: "Personal records per exercise: type weight (heaviest set), one_rm (estimated one-rep max), volume (weight x reps in one set) or reps. exerciseName filters by substring, for example \"bench\". Newest first.",
  input: z.object({ exerciseName: z.string().trim().min(1).max(120).optional(), limit: z.number().int().min(1).max(100).optional().describe("Default 50") }),
  readOnly: true,
  handler: ({ exerciseName, limit }, { ctx }) => {
    const where = exerciseName ? sql`lower(${schema.exercises.name}) like ${"%" + exerciseName.toLowerCase() + "%"}` : undefined;
    const records = ctx.db
      .select({ exerciseId: schema.personalRecords.exerciseId, exercise: schema.exercises.name, type: schema.personalRecords.type, value: schema.personalRecords.value, weight: schema.personalRecords.weight, reps: schema.personalRecords.reps, achievedAt: schema.personalRecords.achievedAt, workoutId: schema.personalRecords.workoutId })
      .from(schema.personalRecords)
      .innerJoin(schema.exercises, eq(schema.personalRecords.exerciseId, schema.exercises.id))
      .where(where)
      .orderBy(desc(schema.personalRecords.achievedAt))
      .limit(limit ?? 50)
      .all();
    return { count: records.length, records };
  },
});

const getHealthTargetsTool = defineTool({
  name: "get_health_targets",
  description: "Daily nutrition and activity targets from the health profile (calories, protein, carbs, fat, fibre, water, workouts per week) plus the profile's goal, pace, units and latest weight, with suggested targets computed from the profile.",
  input: z.object({}),
  readOnly: true,
  handler: (_i, { ctx }) => {
    const profile = getHealthProfile(ctx.db);
    const weight = latestWeight(ctx.db, todayString());
    return {
      targets: profile.targets,
      goal: profile.goal,
      paceKgPerWeek: profile.paceKgPerWeek,
      targetWeightKg: profile.targetWeightKg,
      activityLevel: profile.activityLevel,
      units: profile.units,
      heightCm: profile.heightCm,
      sex: profile.sex,
      birthDate: profile.birthDate,
      latestWeight: weight ? { weightKg: weight.latestKg, date: weight.date } : null,
      suggested: suggestTargets(profile, weight?.latestKg ?? null),
    };
  },
});

export const healthTools: ToolDef[] = [getNutritionDayTool, logWaterTool, logWeightTool, logMealTextTool, listRecentWorkoutsTool, getPersonalRecordsTool, getHealthTargetsTool];
