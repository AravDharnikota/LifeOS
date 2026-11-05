import { z } from "zod";
import { BodyPart, ExerciseCategory, SetType, TemplateAction, kgToLb, lbToKg, round2, type Exercise, type PrType, type Workout, type WorkoutExercise, type WorkoutTemplate, type WorkoutTemplateInput } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { HttpError } from "../lib/errors.ts";
import { getHealthProfile } from "../services/settings.ts";
import * as svc from "../services/workouts.ts";
import { defineTool, type ToolDef } from "./types.ts";

/*
 * Workout tools: the exercise library, templates (routines) and workouts, live or logged after the fact.
 * They are thin wrappers over services/workouts.ts, the same code the REST routes use, so the app and
 * agents follow one set of rules (PR replay, template updates, activity log).
 *
 * Units: the database stores kg and km. Agents talk in Arav's units, so every tool takes an optional
 * `units` (default: his profile setting), converts inputs on the way in and outputs on the way out,
 * and states the unit in each result.
 */

type Units = "metric" | "imperial";
const KM_PER_MI = 1.609344;

const UnitsInput = z.enum(["metric", "imperial"]).optional().describe("Units for weights and distances in this call, both in and out: imperial = lb and mi, metric = kg and km. Default: Arav's profile setting. Results state the unit.");

const unitsFor = (db: Db, u?: Units): Units => u ?? getHealthProfile(db).units;
const unitLabels = (u: Units) => ({ weight: u === "imperial" ? "lb" : "kg", distance: u === "imperial" ? "mi" : "km" });

const outWeight = (kg: number | null | undefined, u: Units): number | null => (kg == null ? null : Math.round((u === "imperial" ? kgToLb(kg) : kg) * 10) / 10);
const outDistance = (km: number | null | undefined, u: Units): number | null => (km == null ? null : round2(u === "imperial" ? km / KM_PER_MI : km));
// `undefined` means "leave unchanged" in the service layer, so it must survive conversion.
function inWeight(v: number | null | undefined, u: Units): number | null | undefined {
  return v == null ? v : round2(u === "imperial" ? lbToKg(v) : v);
}
function inDistance(v: number | null | undefined, u: Units): number | null | undefined {
  return v == null ? v : round2(u === "imperial" ? v * KM_PER_MI : v);
}

/** HttpError details (unknown exercise ids, incomplete set counts) would be lost by runTool, which keeps only the message. */
function explain<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HttpError && e.details !== undefined && e.details !== null) {
      const d = e.details as Record<string, unknown>;
      const brief = typeof d === "object" && d.workout ? { ...d, workout: { id: (d.workout as Workout).id, name: (d.workout as Workout).name } } : d;
      throw new Error(`${e.message}: ${JSON.stringify(brief)}`);
    }
    throw e;
  }
}

function workoutIdOrActive(db: Db, id: string | undefined): string {
  if (id) return id;
  const active = svc.getActiveWorkout(db);
  if (!active) throw new Error("No workout is in progress. Call start_workout first, or use log_workout to record a workout that already happened.");
  return active.id;
}

// ---------- input shapes ----------

const SetIn = z.object({
  setType: SetType.optional().describe("normal (default), warmup, drop or failure"),
  weight: z.number().min(0).nullable().optional().describe("In the call's weight unit. Dumbbell: one dumbbell. Weighted bodyweight: the added weight. Assisted bodyweight: the assistance"),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  seconds: z.number().int().min(0).max(86400).nullable().optional().describe("For timed exercises such as planks, or cardio duration"),
  distance: z.number().min(0).nullable().optional().describe("For cardio, in the call's distance unit"),
});
const WorkoutSetIn = SetIn.extend({
  rpe: z.number().min(1).max(10).nullable().optional().describe("Rate of perceived exertion, 1 to 10"),
  completed: z.boolean().optional(),
});
type SetInT = z.infer<typeof WorkoutSetIn>;

const exerciseId = z.string().min(1).describe("Exercise id from search_exercises");
const restSeconds = z.number().int().min(0).max(3600).nullable().optional().describe("Rest timer after each set; default from settings");

const TemplateExerciseIn = z.object({
  exerciseId,
  sets: z.array(SetIn).max(30).optional().describe("Target sets in order. Omit for no preset sets"),
  restSeconds,
  supersetGroup: z.number().int().nullable().optional().describe("Exercises that share a number form a superset"),
  notes: z.string().max(2000).nullable().optional(),
});

function templateExercisesIn(list: z.infer<typeof TemplateExerciseIn>[], u: Units): NonNullable<WorkoutTemplateInput["exercises"]> {
  return list.map((e) => ({
    exerciseId: e.exerciseId,
    restSeconds: e.restSeconds,
    supersetGroup: e.supersetGroup,
    notes: e.notes,
    sets: (e.sets ?? []).map((s) => ({ setType: s.setType, targetWeight: inWeight(s.weight, u), targetReps: s.reps, targetSeconds: s.seconds, targetDistance: inDistance(s.distance, u) })),
  }));
}

/** Writes the given values into sets of a workout exercise, reusing its blank first set and adding the rest. */
function fillSets(db: Db, we: WorkoutExercise, sets: SetInT[], u: Units, completedByDefault: boolean): void {
  sets.forEach((s, i) => {
    const first = i === 0 ? we.sets?.[0] : undefined;
    const setId = first ? first.id : svc.addWorkoutSet(db, we.id).id;
    svc.updateWorkoutSet(db, setId, {
      setType: s.setType ?? "normal",
      weight: inWeight(s.weight ?? null, u),
      reps: s.reps ?? null,
      seconds: s.seconds ?? null,
      distance: inDistance(s.distance ?? null, u),
      rpe: s.rpe ?? null,
      completed: s.completed ?? completedByDefault,
    });
  });
}

// ---------- output shapes ----------

const setOut = (s: { setType: string; weight: number | null; reps: number | null; seconds?: number | null; distance?: number | null }, u: Units) => ({
  setType: s.setType,
  weight: outWeight(s.weight, u),
  reps: s.reps,
  seconds: s.seconds ?? null,
  distance: outDistance(s.distance, u),
});

const exerciseOut = (e: Exercise) => ({ id: e.id, name: e.name, category: e.category, bodyPart: e.bodyPart, isCustom: e.isCustom, lastPerformedAt: e.lastPerformedAt ?? null });

function workoutExerciseOut(e: WorkoutExercise, u: Units) {
  return {
    workoutExerciseId: e.id,
    exerciseId: e.exerciseId,
    name: e.exercise?.name ?? "Unknown exercise",
    category: e.exercise?.category ?? null,
    restSeconds: e.restSeconds,
    supersetGroup: e.supersetGroup,
    notes: e.notes,
    sets: (e.sets ?? []).map((s) => ({ setId: s.id, ...setOut(s, u), rpe: s.rpe, completed: s.completed, prs: s.prs })),
    previous: e.previous?.length ? e.previous.map((p) => setOut(p, u)) : undefined,
  };
}

function workoutOut(w: Workout, u: Units) {
  return {
    id: w.id,
    name: w.name,
    status: w.status,
    templateId: w.templateId,
    templateName: w.templateName ?? null,
    notes: w.notes,
    startedAt: w.startedAt,
    finishedAt: w.finishedAt,
    durationMinutes: w.durationSeconds == null ? null : Math.round(w.durationSeconds / 60),
    totalVolume: w.totalVolume == null ? null : Math.round(outWeight(w.totalVolume, u) ?? 0),
    totalSets: w.totalSets,
    prCount: w.prCount,
    units: unitLabels(u),
    exercises: (w.exercises ?? []).map((e) => workoutExerciseOut(e, u)),
  };
}

function templateOut(t: WorkoutTemplate, u: Units) {
  return {
    id: t.id,
    name: t.name,
    folder: t.folder,
    notes: t.notes,
    lastPerformedAt: t.lastPerformedAt,
    units: unitLabels(u),
    exercises: (t.exercises ?? []).map((e) => ({
      exerciseId: e.exerciseId,
      name: e.exercise?.name ?? "Unknown exercise",
      category: e.exercise?.category ?? null,
      restSeconds: e.restSeconds,
      supersetGroup: e.supersetGroup,
      notes: e.notes,
      sets: (e.sets ?? []).map((s) => setOut({ setType: s.setType, weight: s.targetWeight, reps: s.targetReps, seconds: s.targetSeconds, distance: s.targetDistance }, u)),
    })),
  };
}

const WEIGHT_PRS: PrType[] = ["weight", "one_rm", "volume"];
function prValueOut(type: PrType, value: number, u: Units): number | null {
  if (WEIGHT_PRS.includes(type)) return outWeight(value, u);
  if (type === "distance") return outDistance(value, u);
  return value;
}

// ---------- exercises ----------

const searchExercisesTool = defineTool({
  name: "search_exercises",
  description:
    "Search the exercise library (about 900 built-in exercises plus Arav's custom ones) by name or common alias (\"rdl\", \"shoulder press\"), optionally filtered by body part or equipment category. Best matches first. Returns ids for templates and workouts. Call this before create_template, add_workout_exercise or log_workout.",
  input: z.object({
    q: z.string().max(120).optional().describe("Name or alias; omit to browse"),
    bodyPart: BodyPart.optional(),
    category: ExerciseCategory.optional().describe("Equipment or tracking type"),
    limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
  }),
  readOnly: true,
  handler: ({ q, bodyPart, category, limit }, { ctx }) => {
    const all = svc.listExercises(ctx.db, { q, bodyPart, category });
    return { total: all.length, exercises: all.slice(0, limit ?? 20).map(exerciseOut) };
  },
});

const createExerciseTool = defineTool({
  name: "create_exercise",
  description: "Add a custom exercise when search_exercises finds nothing suitable. category decides what a set records: barbell, dumbbell (per hand), machine and cable take weight and reps; weighted_bodyweight takes added weight and reps; assisted_bodyweight takes assistance weight and reps; bodyweight and reps_only take reps; duration takes seconds; cardio takes distance and seconds.",
  input: z.object({ name: z.string().trim().min(1).max(120), category: ExerciseCategory, bodyPart: BodyPart, instructions: z.string().max(5000).nullable().optional() }),
  handler: (input, { ctx, actor }) => explain(() => exerciseOut(svc.createExercise(ctx.db, input, actor))),
});

// ---------- templates ----------

const listTemplatesTool = defineTool({
  name: "list_templates",
  description: "Workout templates (routines) in Arav's order, with folder, when each was last performed and its exercises with set counts. Use get_template for target weights and reps.",
  input: z.object({}),
  readOnly: true,
  handler: (_input, { ctx }) => {
    const templates = svc.listTemplates(ctx.db).map((t) => ({
      id: t.id,
      name: t.name,
      folder: t.folder,
      lastPerformedAt: t.lastPerformedAt,
      exercises: (t.exercises ?? []).map((e) => ({ exerciseId: e.exerciseId, name: e.exercise?.name ?? "Unknown exercise", sets: e.sets?.length ?? 0 })),
    }));
    return { count: templates.length, templates };
  },
});

const getTemplateTool = defineTool({
  name: "get_template",
  description: "One workout template with notes and every exercise's target sets (set type, weight, reps, seconds, distance), rest timers and supersets.",
  input: z.object({ templateId: z.string().min(1), units: UnitsInput }),
  readOnly: true,
  handler: ({ templateId, units }, { ctx }) => explain(() => templateOut(svc.getTemplate(ctx.db, templateId), unitsFor(ctx.db, units))),
});

const createTemplateTool = defineTool({
  name: "create_template",
  description:
    "Create a workout template (routine). Find each exercise id with search_exercises first. Each exercise lists its target sets in order, for example 3 sets of 5 reps at 185 lb: sets: [{weight: 185, reps: 5}, {weight: 185, reps: 5}, {weight: 185, reps: 5}]. Exercises with the same supersetGroup number form a superset.",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    exercises: z.array(TemplateExerciseIn).max(50),
    notes: z.string().max(5000).nullable().optional(),
    folder: z.string().max(100).nullable().optional().describe("Group name, for example \"Push Pull Legs\""),
    units: UnitsInput,
  }),
  handler: ({ name, exercises, notes, folder, units }, { ctx, actor }) =>
    explain(() => {
      const u = unitsFor(ctx.db, units);
      return templateOut(svc.createTemplate(ctx.db, { name, notes, folder, exercises: templateExercisesIn(exercises, u) }, actor), u);
    }),
});

const updateTemplateTool = defineTool({
  name: "update_template",
  description:
    "Change a template's name, notes or folder. Passing exercises replaces the whole exercise list, so read it with get_template first and send every exercise you want to keep, in order. Omitted fields stay as they are; null clears notes or folder.",
  input: z.object({
    templateId: z.string().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    notes: z.string().max(5000).nullable().optional(),
    folder: z.string().max(100).nullable().optional(),
    exercises: z.array(TemplateExerciseIn).max(50).optional().describe("The full new exercise list"),
    units: UnitsInput,
  }),
  handler: ({ templateId, name, notes, folder, exercises, units }, { ctx, actor }) =>
    explain(() => {
      const u = unitsFor(ctx.db, units);
      if (!exercises) return templateOut(svc.patchTemplate(ctx.db, templateId, { name, notes, folder }, actor), u);
      const current = svc.getTemplate(ctx.db, templateId);
      const input = { name: name ?? current.name, notes: notes === undefined ? current.notes : notes, folder: folder === undefined ? current.folder : folder, exercises: templateExercisesIn(exercises, u) };
      return templateOut(svc.replaceTemplate(ctx.db, templateId, input, actor), u);
    }),
});

const duplicateTemplateTool = defineTool({
  name: "duplicate_template",
  description: "Copy a template with all its exercises and sets as \"<name> (copy)\". Rename it afterwards with update_template.",
  input: z.object({ templateId: z.string().min(1), units: UnitsInput }),
  handler: ({ templateId, units }, { ctx, actor }) => explain(() => templateOut(svc.duplicateTemplate(ctx.db, templateId, actor), unitsFor(ctx.db, units))),
});

const deleteTemplateTool = defineTool({
  name: "delete_template",
  description: "Delete a workout template. Past workouts started from it are kept.",
  input: z.object({ templateId: z.string().min(1) }),
  destructive: true,
  handler: ({ templateId }, { ctx, actor }) =>
    explain(() => {
      const t = svc.getTemplate(ctx.db, templateId);
      svc.deleteTemplate(ctx.db, templateId, actor);
      return { deleted: true, id: t.id, name: t.name };
    }),
});

// ---------- workouts ----------

const getActiveWorkoutTool = defineTool({
  name: "get_active_workout",
  description: "The workout in progress, if any: every exercise with its sets (setId, values, completed, PRs) and the previous performance of each exercise. Use the setId and workoutExerciseId values with log_workout_set and add_workout_set.",
  input: z.object({ units: UnitsInput }),
  readOnly: true,
  handler: ({ units }, { ctx }) => {
    const w = svc.getActiveWorkout(ctx.db);
    return w ? { active: true, workout: workoutOut(w, unitsFor(ctx.db, units)) } : { active: false };
  },
});

const getWorkoutTool = defineTool({
  name: "get_workout",
  description: "One workout (in progress or completed) with every exercise and set. Ids come from list_recent_workouts.",
  input: z.object({ workoutId: z.string().min(1), units: UnitsInput }),
  readOnly: true,
  handler: ({ workoutId, units }, { ctx }) => explain(() => workoutOut(svc.getWorkout(ctx.db, workoutId), unitsFor(ctx.db, units))),
});

const startWorkoutTool = defineTool({
  name: "start_workout",
  description:
    "Start a live workout, empty or from a template (its exercises and target sets are copied in, not yet completed). Only one workout can be in progress. Then log sets with log_workout_set and end with finish_workout. For a workout that already happened, use log_workout instead.",
  input: z.object({ templateId: z.string().min(1).optional(), name: z.string().trim().max(120).optional().describe("Default: the template name, or \"<Weekday> Workout\""), units: UnitsInput }),
  handler: ({ templateId, name, units }, { ctx, actor }) => explain(() => workoutOut(svc.startWorkout(ctx.db, { templateId, name }, actor), unitsFor(ctx.db, units))),
});

const addWorkoutExerciseTool = defineTool({
  name: "add_workout_exercise",
  description: "Add an exercise to a workout (default: the one in progress). Without sets it gets one blank set; with sets they are added as planned (not completed) unless a set says completed: true.",
  input: z.object({ exerciseId, workoutId: z.string().min(1).optional(), sets: z.array(WorkoutSetIn).max(30).optional(), restSeconds, units: UnitsInput }),
  handler: ({ exerciseId: exId, workoutId, sets, restSeconds: rest, units }, { ctx }) =>
    explain(() => {
      const u = unitsFor(ctx.db, units);
      const id = workoutIdOrActive(ctx.db, workoutId);
      const we = svc.addWorkoutExercise(ctx.db, id, { exerciseId: exId, restSeconds: rest });
      if (sets?.length) fillSets(ctx.db, we, sets, u, false);
      const fresh = svc.getWorkout(ctx.db, id).exercises?.find((e) => e.id === we.id);
      return { workoutId: id, units: unitLabels(u), exercise: fresh ? workoutExerciseOut(fresh, u) : null };
    }),
});

const logWorkoutSetTool = defineTool({
  name: "log_workout_set",
  description: "Record or correct one set by setId (from get_active_workout or get_workout): weight, reps, seconds, distance, RPE, set type. completed defaults to true, which also checks for personal records. Omitted values stay as they are; null clears one.",
  input: WorkoutSetIn.extend({ setId: z.string().min(1), units: UnitsInput }),
  handler: ({ setId, units, completed, weight, distance, ...rest }, { ctx }) =>
    explain(() => {
      const u = unitsFor(ctx.db, units);
      const s = svc.updateWorkoutSet(ctx.db, setId, { ...rest, weight: inWeight(weight, u), distance: inDistance(distance, u), completed: completed ?? true });
      return { setId: s.id, ...setOut(s, u), rpe: s.rpe, completed: s.completed, prs: s.prs, units: unitLabels(u) };
    }),
});

const addWorkoutSetTool = defineTool({
  name: "add_workout_set",
  description: "Add a set to an exercise in a workout by workoutExerciseId. Values you leave out are copied from the previous set. completed defaults to true.",
  input: WorkoutSetIn.extend({ workoutExerciseId: z.string().min(1), units: UnitsInput }),
  handler: ({ workoutExerciseId, units, completed, weight, distance, ...rest }, { ctx }) =>
    explain(() => {
      const u = unitsFor(ctx.db, units);
      const added = svc.addWorkoutSet(ctx.db, workoutExerciseId);
      const s = svc.updateWorkoutSet(ctx.db, added.id, { ...rest, weight: inWeight(weight, u), distance: inDistance(distance, u), completed: completed ?? true });
      return { setId: s.id, ...setOut(s, u), rpe: s.rpe, completed: s.completed, prs: s.prs, units: unitLabels(u) };
    }),
});

const finishWorkoutTool = defineTool({
  name: "finish_workout",
  description:
    "Finish a workout (default: the one in progress). Sets not marked completed are dropped; pass discardIncomplete: false to fail instead and get the counts. templateAction: keep (default) leaves the template alone, update_values copies today's weights and reps into it, update_template copies today's exercise list, update_both does both, save_as_template saves this workout as a new template (newTemplateName). Returns the summary with new personal records.",
  input: z.object({
    workoutId: z.string().min(1).optional(),
    templateAction: TemplateAction.optional(),
    newTemplateName: z.string().trim().min(1).max(120).optional(),
    newTemplateFolder: z.string().max(100).nullable().optional(),
    discardIncomplete: z.boolean().optional(),
    units: UnitsInput,
  }),
  handler: ({ workoutId, units, ...body }, { ctx, actor }) =>
    explain(() => {
      const u = unitsFor(ctx.db, units);
      const r = svc.finishWorkout(ctx.db, workoutIdOrActive(ctx.db, workoutId), body, actor);
      return {
        workout: workoutOut(r.workout, u),
        prs: r.summary.prs.map((p) => ({ exercise: p.exerciseName, type: p.type, value: prValueOut(p.type, p.value, u), weight: outWeight(p.weight, u), reps: p.reps })),
        templateChanged: r.summary.templateChanged,
        templateId: r.summary.templateId,
      };
    }),
});

const discardWorkoutTool = defineTool({
  name: "discard_workout",
  description: "Throw away the workout in progress (or workoutId) and all its sets. Nothing is saved to history.",
  input: z.object({ workoutId: z.string().min(1).optional() }),
  destructive: true,
  handler: ({ workoutId }, { ctx, actor }) =>
    explain(() => {
      const w = svc.discardWorkout(ctx.db, workoutIdOrActive(ctx.db, workoutId), actor);
      return { discarded: true, id: w.id, name: w.name };
    }),
});

const localDateTime = z
  .string()
  .regex(/T\d{2}:\d{2}/, "Expected a date and time such as 2026-11-03T18:00")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Expected an ISO date and time")
  .describe("When it started: ISO date and time; without an offset it is Arav's local time. Default: it ended just now");

const logWorkoutTool = defineTool({
  name: "log_workout",
  description:
    "Record a workout that already happened, in one call, as a completed workout with personal records checked. Find exercise ids with search_exercises first. Example: bench 3x5 at 185 lb yesterday evening: startedAt \"2026-11-03T18:00\", exercises: [{exerciseId, sets: [{weight: 185, reps: 5}, {weight: 185, reps: 5}, {weight: 185, reps: 5}]}]. Fails while a live workout is in progress.",
  input: z.object({
    exercises: z.array(z.object({ exerciseId, sets: z.array(WorkoutSetIn.omit({ completed: true })).min(1).max(30), restSeconds })).min(1).max(50),
    name: z.string().trim().max(120).optional().describe("Default: \"<Weekday> Workout\""),
    startedAt: localDateTime.optional(),
    durationMinutes: z.number().int().min(1).max(600).optional().describe("Default 60"),
    notes: z.string().max(5000).nullable().optional(),
    units: UnitsInput,
  }),
  handler: (input, { ctx, actor }) =>
    explain(() => {
      const db = ctx.db;
      const u = unitsFor(db, input.units);
      const active = svc.getActiveWorkout(db);
      if (active) throw new Error(`Workout "${active.name}" (id ${active.id}) is in progress. Finish or discard it before logging another one.`);
      const durationSeconds = (input.durationMinutes ?? 60) * 60;
      const endMs = input.startedAt ? Date.parse(input.startedAt) + durationSeconds * 1000 : Date.now();
      if (endMs > Date.now() + 60_000) throw new Error("That workout would end in the future. Use start_workout for a workout that is happening now.");
      const startedAt = new Date(endMs - durationSeconds * 1000).toISOString();
      const finishedAt = new Date(endMs).toISOString();

      const started = svc.startWorkout(db, { name: input.name }, actor);
      try {
        for (const e of input.exercises) {
          const we = svc.addWorkoutExercise(db, started.id, { exerciseId: e.exerciseId, restSeconds: e.restSeconds });
          fillSets(db, we, e.sets, u, true);
        }
        svc.finishWorkout(db, started.id, { templateAction: "keep", durationSeconds }, actor);
        // Backdate after finishing: updateWorkout only moves finishedAt on completed workouts and then replays PRs in date order.
        const done = svc.updateWorkout(db, started.id, { startedAt, finishedAt, durationSeconds, ...(input.notes === undefined ? {} : { notes: input.notes }) }, actor);
        return workoutOut(done, u);
      } catch (err) {
        // Do not leave a half-built workout behind (an active one would also block the next start_workout).
        try {
          svc.deleteWorkout(db, started.id, actor);
        } catch {
          /* already gone */
        }
        throw err;
      }
    }),
});

const updateWorkoutTool = defineTool({
  name: "update_workout",
  description: "Rename a workout, change its notes, or correct when it happened (startedAt and durationMinutes, completed workouts only for the end time). Personal records are re-checked in date order when the date moves.",
  input: z.object({ workoutId: z.string().min(1), name: z.string().trim().min(1).max(120).optional(), notes: z.string().max(5000).nullable().optional(), startedAt: localDateTime.optional(), durationMinutes: z.number().int().min(1).max(600).optional(), units: UnitsInput }),
  handler: ({ workoutId, name, notes, startedAt, durationMinutes, units }, { ctx, actor }) =>
    explain(() => {
      const current = svc.getWorkout(ctx.db, workoutId);
      const patch: Parameters<typeof svc.updateWorkout>[2] = { name, notes };
      if (startedAt !== undefined || durationMinutes !== undefined) {
        const startMs = startedAt !== undefined ? Date.parse(startedAt) : Date.parse(current.startedAt);
        patch.startedAt = new Date(startMs).toISOString();
        const seconds = durationMinutes !== undefined ? durationMinutes * 60 : current.durationSeconds;
        if (seconds != null) {
          patch.durationSeconds = seconds;
          if (current.status === "completed") patch.finishedAt = new Date(startMs + seconds * 1000).toISOString();
        }
      }
      return workoutOut(svc.updateWorkout(ctx.db, workoutId, patch, actor), unitsFor(ctx.db, units));
    }),
});

const deleteWorkoutTool = defineTool({
  name: "delete_workout",
  description: "Delete a workout from history with all its sets. Personal records are recalculated without it.",
  input: z.object({ workoutId: z.string().min(1) }),
  destructive: true,
  handler: ({ workoutId }, { ctx, actor }) =>
    explain(() => {
      const w = svc.getWorkout(ctx.db, workoutId);
      svc.deleteWorkout(ctx.db, workoutId, actor);
      return { deleted: true, id: w.id, name: w.name };
    }),
});

export const workoutTools: ToolDef[] = [
  searchExercisesTool,
  createExerciseTool,
  listTemplatesTool,
  getTemplateTool,
  createTemplateTool,
  updateTemplateTool,
  duplicateTemplateTool,
  deleteTemplateTool,
  getActiveWorkoutTool,
  getWorkoutTool,
  startWorkoutTool,
  addWorkoutExerciseTool,
  logWorkoutSetTool,
  addWorkoutSetTool,
  finishWorkoutTool,
  discardWorkoutTool,
  logWorkoutTool,
  updateWorkoutTool,
  deleteWorkoutTool,
];
