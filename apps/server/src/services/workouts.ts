import { and, asc, desc, eq, inArray, isNull, like, ne, notInArray, sql } from "drizzle-orm";
import { format } from "date-fns";
import {
  addDaysString,
  bestSet,
  dateOfIso,
  estimateOneRepMax,
  evaluateWorkoutPrs,
  isEmptySet,
  isRepsOnlyCategory,
  isWeightCategory,
  MAX_RECORD_REPS,
  recordValueForSet,
  repMaxTable,
  round2,
  setCountsForRecords,
  setVolume,
  todayString,
  weekStartString,
  workoutTotals,
  WorkoutSettings,
  type Exercise,
  type ExerciseCategory,
  type ExerciseDetail,
  type ExerciseHistoryEntry,
  type PersonalRecord,
  type PrType,
  type RecordMap,
  type SetLike,
  type SetType,
  type TemplateAction,
  type TemplateExercise,
  type TemplatePatch,
  type TemplateSet,
  type VolumeOptions,
  type Workout,
  type WorkoutCalendarDay,
  type WorkoutExercise,
  type WorkoutExerciseAdd,
  type WorkoutExerciseUpdate,
  type WorkoutFinish,
  type WorkoutFinishResult,
  type WorkoutListItem,
  type WorkoutSet,
  type WorkoutSetInput,
  type WorkoutStats,
  type WorkoutTemplate,
  type WorkoutTemplateInput,
  type WorkoutUpdate,
} from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { HttpError, badRequest, notFound } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { parseJson } from "../lib/json.ts";
import { logActivity } from "./activity.ts";
import { getAppSettings, getHealthProfile, getSetting, setSetting } from "./settings.ts";

const ex = schema.exercises;
const tpl = schema.workoutTemplates;
const tex = schema.templateExercises;
const tset = schema.templateSets;
const wk = schema.workouts;
const wex = schema.workoutExercises;
const wset = schema.workoutSets;
const pr = schema.personalRecords;

type ExerciseRow = typeof ex.$inferSelect;
type TemplateRow = typeof tpl.$inferSelect;
type TemplateExerciseRow = typeof tex.$inferSelect;
type TemplateSetRow = typeof tset.$inferSelect;
type WorkoutRow = typeof wk.$inferSelect;
type WorkoutExerciseRow = typeof wex.$inferSelect;
type WorkoutSetRow = typeof wset.$inferSelect;
type PrRow = typeof pr.$inferSelect;

type PreviousSet = NonNullable<WorkoutExercise["previous"]>[number];

const STRONG_DEFAULT_REST_SECONDS = 120;

// ---------- settings and context ----------

export const getWorkoutSettings = (db: Db): WorkoutSettings => getSetting(db, "workouts", WorkoutSettings);

export function updateWorkoutSettings(db: Db, patch: Partial<WorkoutSettings>): WorkoutSettings {
  const merged = WorkoutSettings.parse({ ...getWorkoutSettings(db), ...patch });
  setSetting(db, "workouts", merged);
  return merged;
}

function latestBodyweightKg(db: Db): number | null {
  const row = db.select({ weightKg: schema.weightLogs.weightKg }).from(schema.weightLogs).orderBy(desc(schema.weightLogs.loggedAt)).limit(1).get();
  return row?.weightKg ?? null;
}

interface CalcContext {
  settings: WorkoutSettings;
  volume: Omit<VolumeOptions, "category">;
}

function calcContext(db: Db): CalcContext {
  const settings = getWorkoutSettings(db);
  return {
    settings,
    volume: { bodyweightKg: latestBodyweightKg(db), countDumbbellsTwice: settings.countDumbbellsTwice, includeWeightedBodyweight: settings.includeWeightedBodyweightVolume, includeAssistedBodyweight: settings.includeAssistedBodyweightVolume },
  };
}

// ---------- serializers ----------

export function serializeExercise(row: ExerciseRow, extra: { lastPerformedAt?: string | null; recordOneRm?: number | null } = {}): Exercise {
  const out: Exercise = { id: row.id, name: row.name, category: row.category as ExerciseCategory, bodyPart: row.bodyPart as Exercise["bodyPart"], instructions: row.instructions, isCustom: row.isCustom, createdAt: row.createdAt, deletedAt: row.deletedAt };
  if (extra.lastPerformedAt !== undefined) out.lastPerformedAt = extra.lastPerformedAt;
  if (extra.recordOneRm !== undefined) out.recordOneRm = extra.recordOneRm;
  return out;
}

const serializeTemplateSet = (s: TemplateSetRow): TemplateSet => ({ id: s.id, templateExerciseId: s.templateExerciseId, sortOrder: s.sortOrder, setType: s.setType as SetType, targetWeight: s.targetWeight, targetReps: s.targetReps, targetSeconds: s.targetSeconds, targetDistance: s.targetDistance });

const serializeWorkoutSet = (s: WorkoutSetRow): WorkoutSet => ({ id: s.id, workoutExerciseId: s.workoutExerciseId, sortOrder: s.sortOrder, setType: s.setType as SetType, weight: s.weight, reps: s.reps, seconds: s.seconds, distance: s.distance, rpe: s.rpe, completed: s.completed, completedAt: s.completedAt, prs: parseJson<PrType[]>(s.prs, []) });

const serializeRecord = (r: PrRow, exerciseName?: string): PersonalRecord => ({ id: r.id, exerciseId: r.exerciseId, type: r.type as PrType, value: r.value, weight: r.weight, reps: r.reps, workoutId: r.workoutId, workoutSetId: r.workoutSetId, achievedAt: r.achievedAt, ...(exerciseName === undefined ? {} : { exerciseName }) });

function serializeWorkoutRow(row: WorkoutRow, templateName: string | null): Omit<Workout, "exercises"> {
  return { id: row.id, templateId: row.templateId, name: row.name, notes: row.notes, startedAt: row.startedAt, finishedAt: row.finishedAt, durationSeconds: row.durationSeconds, totalVolume: row.totalVolume, totalSets: row.totalSets, prCount: row.prCount, status: row.status as Workout["status"], createdAt: row.createdAt, updatedAt: row.updatedAt, templateName };
}

const toSetLike = (s: WorkoutSetRow): SetLike & { id: string } => ({ id: s.id, setType: s.setType as SetType, weight: s.weight, reps: s.reps, seconds: s.seconds, distance: s.distance, completed: s.completed });

// ---------- loaders ----------

function exerciseMap(db: Db, ids: string[]): Map<string, ExerciseRow> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  return new Map(db.select().from(ex).where(inArray(ex.id, unique)).all().map((r) => [r.id, r]));
}

function templateNames(db: Db, ids: (string | null)[]): Map<string, string> {
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (unique.length === 0) return new Map();
  return new Map(db.select({ id: tpl.id, name: tpl.name }).from(tpl).where(inArray(tpl.id, unique)).all().map((r) => [r.id, r.name]));
}

function setsByWorkoutExercise(db: Db, workoutExerciseIds: string[]): Map<string, WorkoutSetRow[]> {
  const map = new Map<string, WorkoutSetRow[]>();
  if (workoutExerciseIds.length === 0) return map;
  const rows = db.select().from(wset).where(inArray(wset.workoutExerciseId, workoutExerciseIds)).orderBy(asc(wset.sortOrder)).all();
  for (const r of rows) {
    const arr = map.get(r.workoutExerciseId) ?? [];
    arr.push(r);
    map.set(r.workoutExerciseId, arr);
  }
  return map;
}

function requireExercise(db: Db, id: string): ExerciseRow {
  const row = db.select().from(ex).where(and(eq(ex.id, id), isNull(ex.deletedAt))).get();
  if (!row) throw notFound("Exercise");
  return row;
}

function requireTemplate(db: Db, id: string): TemplateRow {
  const row = db.select().from(tpl).where(and(eq(tpl.id, id), isNull(tpl.deletedAt))).get();
  if (!row) throw notFound("Template");
  return row;
}

function requireWorkout(db: Db, id: string): WorkoutRow {
  const row = db.select().from(wk).where(eq(wk.id, id)).get();
  if (!row) throw notFound("Workout");
  return row;
}

function requireWorkoutExercise(db: Db, id: string): { we: WorkoutExerciseRow; workout: WorkoutRow } {
  const we = db.select().from(wex).where(eq(wex.id, id)).get();
  if (!we) throw notFound("Workout exercise");
  return { we, workout: requireWorkout(db, we.workoutId) };
}

function requireWorkoutSet(db: Db, id: string): { set: WorkoutSetRow; we: WorkoutExerciseRow; workout: WorkoutRow } {
  const set = db.select().from(wset).where(eq(wset.id, id)).get();
  if (!set) throw notFound("Set");
  return { set, ...requireWorkoutExercise(db, set.workoutExerciseId) };
}

function getActiveRow(db: Db): WorkoutRow | undefined {
  return db.select().from(wk).where(eq(wk.status, "active")).orderBy(desc(wk.startedAt)).limit(1).get();
}

// ---------- previous sets ----------

function previousSets(db: Db, exerciseId: string, opts: { excludeWorkoutId: string; templateId: string | null; sameTemplateOnly: boolean }): PreviousSet[] {
  const conds = [eq(wex.exerciseId, exerciseId), eq(wk.status, "completed"), ne(wk.id, opts.excludeWorkoutId)];
  if (opts.sameTemplateOnly && opts.templateId) conds.push(eq(wk.templateId, opts.templateId));
  const row = db.select({ weId: wex.id }).from(wex).innerJoin(wk, eq(wk.id, wex.workoutId)).where(and(...conds)).orderBy(desc(wk.finishedAt), asc(wex.sortOrder)).limit(1).get();
  if (!row) return [];
  return db
    .select()
    .from(wset)
    .where(and(eq(wset.workoutExerciseId, row.weId), eq(wset.completed, true)))
    .orderBy(asc(wset.sortOrder))
    .all()
    .map((s) => ({ setType: s.setType as SetType, weight: s.weight, reps: s.reps, seconds: s.seconds, distance: s.distance }));
}

// ---------- full workout ----------

function buildWorkoutExercise(db: Db, we: WorkoutExerciseRow, workout: WorkoutRow, exercise: ExerciseRow | undefined, sets: WorkoutSetRow[], sameTemplateOnly: boolean, cache: Map<string, PreviousSet[]>): WorkoutExercise {
  let previous = cache.get(we.exerciseId);
  if (!previous) {
    previous = previousSets(db, we.exerciseId, { excludeWorkoutId: workout.id, templateId: workout.templateId, sameTemplateOnly });
    cache.set(we.exerciseId, previous);
  }
  return { id: we.id, workoutId: we.workoutId, exerciseId: we.exerciseId, sortOrder: we.sortOrder, supersetGroup: we.supersetGroup, restSeconds: we.restSeconds, notes: we.notes, exercise: exercise ? serializeExercise(exercise) : undefined, sets: sets.map(serializeWorkoutSet), previous };
}

function fullWorkout(db: Db, row: WorkoutRow): Workout {
  const weRows = db.select().from(wex).where(eq(wex.workoutId, row.id)).orderBy(asc(wex.sortOrder)).all();
  const exercises = exerciseMap(db, weRows.map((r) => r.exerciseId));
  const sets = setsByWorkoutExercise(db, weRows.map((r) => r.id));
  const sameTemplateOnly = getWorkoutSettings(db).previousSetSource === "same_template";
  const cache = new Map<string, PreviousSet[]>();
  const templateName = row.templateId ? (templateNames(db, [row.templateId]).get(row.templateId) ?? null) : null;
  return { ...serializeWorkoutRow(row, templateName), exercises: weRows.map((we) => buildWorkoutExercise(db, we, row, exercises.get(we.exerciseId), sets.get(we.id) ?? [], sameTemplateOnly, cache)) };
}

function workoutExerciseView(db: Db, weId: string): WorkoutExercise {
  const { we, workout } = requireWorkoutExercise(db, weId);
  const exercise = exerciseMap(db, [we.exerciseId]).get(we.exerciseId);
  const sets = setsByWorkoutExercise(db, [we.id]).get(we.id) ?? [];
  return buildWorkoutExercise(db, we, workout, exercise, sets, getWorkoutSettings(db).previousSetSource === "same_template", new Map());
}

// ---------- records ----------

function recordMapFor(db: Db, exerciseId: string): RecordMap {
  const out: RecordMap = {};
  for (const r of db.select().from(pr).where(eq(pr.exerciseId, exerciseId)).all()) out[r.type as PrType] = r.value;
  return out;
}

function writeSetPrs(db: Db, sets: WorkoutSetRow[], prs: Map<string, PrType[]>): void {
  for (const s of sets) {
    const next = JSON.stringify(prs.get(s.id) ?? []);
    if (next !== s.prs) db.update(wset).set({ prs: next }).where(eq(wset.id, s.id)).run();
  }
}

function recountPrs(db: Db, workoutIds: string[]): void {
  for (const id of new Set(workoutIds)) {
    const row = db
      .select({ n: sql<number>`coalesce(sum(json_array_length(${wset.prs})), 0)` })
      .from(wset)
      .innerJoin(wex, eq(wex.id, wset.workoutExerciseId))
      .where(eq(wex.workoutId, id))
      .get();
    db.update(wk).set({ prCount: row?.n ?? 0 }).where(eq(wk.id, id)).run();
  }
}

/** Live PR flags for an active workout: records as they stand (the workout is not yet part of them) plus earlier sets in this workout. */
function refreshLivePrs(db: Db, workout: WorkoutRow, exerciseId: string): void {
  const exercise = exerciseMap(db, [exerciseId]).get(exerciseId);
  const rows = db
    .select({ set: wset })
    .from(wset)
    .innerJoin(wex, eq(wex.id, wset.workoutExerciseId))
    .where(and(eq(wex.workoutId, workout.id), eq(wex.exerciseId, exerciseId)))
    .orderBy(asc(wex.sortOrder), asc(wset.sortOrder))
    .all()
    .map((r) => r.set);
  const result = evaluateWorkoutPrs(rows.map(toSetLike), recordMapFor(db, exerciseId), { category: exercise?.category as ExerciseCategory | undefined, formula: getWorkoutSettings(db).oneRmFormula });
  writeSetPrs(db, rows, result.prs);
}

/** Replays every completed workout containing the exercise in chronological order and rebuilds its personal records and set flags. */
function replayExerciseRecords(db: Db, exerciseId: string): void {
  const exercise = exerciseMap(db, [exerciseId]).get(exerciseId);
  const rows = db
    .select({ set: wset, workoutId: wk.id, finishedAt: wk.finishedAt })
    .from(wset)
    .innerJoin(wex, eq(wex.id, wset.workoutExerciseId))
    .innerJoin(wk, eq(wk.id, wex.workoutId))
    .where(and(eq(wex.exerciseId, exerciseId), eq(wk.status, "completed")))
    .orderBy(asc(wk.finishedAt), asc(wk.startedAt), asc(wex.sortOrder), asc(wset.sortOrder))
    .all();
  const category = exercise?.category as ExerciseCategory | undefined;
  const result = evaluateWorkoutPrs(rows.map((r) => toSetLike(r.set)), {}, { category, formula: getWorkoutSettings(db).oneRmFormula });
  writeSetPrs(
    db,
    rows.map((r) => r.set),
    result.prs,
  );
  const byId = new Map(rows.map((r) => [r.set.id, r]));
  db.delete(pr).where(eq(pr.exerciseId, exerciseId)).run();
  for (const [type, holder] of result.holders) {
    const value = result.records[type];
    const src = byId.get(holder.id);
    if (value === undefined || !src) continue;
    db.insert(pr).values({ id: newId(), exerciseId, type, value: round2(value), weight: src.set.weight, reps: src.set.reps, workoutId: src.workoutId, workoutSetId: src.set.id, achievedAt: src.set.completedAt ?? src.finishedAt ?? nowIso() }).run();
  }
  recountPrs(
    db,
    rows.map((r) => r.workoutId),
  );
}

function recomputeTotals(db: Db, workoutId: string): void {
  const rows = db
    .select({ set: wset, category: ex.category })
    .from(wset)
    .innerJoin(wex, eq(wex.id, wset.workoutExerciseId))
    .innerJoin(ex, eq(ex.id, wex.exerciseId))
    .where(eq(wex.workoutId, workoutId))
    .all();
  const totals = workoutTotals(
    rows.map((r) => ({ ...toSetLike(r.set), category: r.category as ExerciseCategory })),
    calcContext(db).volume,
  );
  db.update(wk).set({ totalVolume: round2(totals.volume), totalSets: totals.completedSets, updatedAt: nowIso() }).where(eq(wk.id, workoutId)).run();
}

/** After any set or exercise change: live flags while active, full replay once the workout is part of history. */
function afterSetChange(db: Db, workout: WorkoutRow, exerciseIds: string[]): void {
  const unique = Array.from(new Set(exerciseIds));
  if (workout.status === "active") {
    for (const id of unique) refreshLivePrs(db, workout, id);
    return;
  }
  if (workout.status !== "completed") return;
  recomputeTotals(db, workout.id);
  for (const id of unique) replayExerciseRecords(db, id);
  recountPrs(db, [workout.id]);
}

// ---------- exercises ----------

export function listExercises(db: Db, opts: { q?: string; bodyPart?: string; category?: string } = {}): Exercise[] {
  const conds = [isNull(ex.deletedAt)];
  if (opts.q?.trim()) conds.push(like(ex.name, `%${opts.q.trim().replace(/[%_]/g, "")}%`));
  if (opts.bodyPart) conds.push(eq(ex.bodyPart, opts.bodyPart));
  if (opts.category) conds.push(eq(ex.category, opts.category));
  const rows = db.select().from(ex).where(and(...conds)).orderBy(asc(ex.name)).all();
  const q = opts.q?.trim().toLowerCase();
  if (q) {
    // Name starts with the query first, then word starts, then substrings; shorter (plainer) names before variants.
    const tier = (name: string) => (name.toLowerCase().startsWith(q) ? 0 : name.toLowerCase().split(/[\s(]+/).some((w) => w.startsWith(q)) ? 1 : 2);
    rows.sort((a, b) => tier(a.name) - tier(b.name) || a.name.length - b.name.length || a.name.localeCompare(b.name));
  }
  const last = new Map(
    db
      .select({ exerciseId: wex.exerciseId, at: sql<string | null>`max(${wk.finishedAt})` })
      .from(wex)
      .innerJoin(wk, eq(wk.id, wex.workoutId))
      .where(eq(wk.status, "completed"))
      .groupBy(wex.exerciseId)
      .all()
      .map((r) => [r.exerciseId, r.at]),
  );
  const oneRm = new Map(db.select({ exerciseId: pr.exerciseId, value: pr.value }).from(pr).where(eq(pr.type, "one_rm")).all().map((r) => [r.exerciseId, r.value]));
  return rows.map((r) => serializeExercise(r, { lastPerformedAt: last.get(r.id) ?? null, recordOneRm: oneRm.get(r.id) ?? null }));
}

export function createExercise(db: Db, input: { name: string; category: ExerciseCategory; bodyPart: Exercise["bodyPart"]; instructions?: string | null }, actor = "user"): Exercise {
  const clash = db.select({ id: ex.id }).from(ex).where(and(isNull(ex.deletedAt), sql`lower(${ex.name}) = lower(${input.name})`)).get();
  if (clash) throw badRequest("An exercise with that name already exists");
  const id = newId();
  db.insert(ex).values({ id, name: input.name, category: input.category, bodyPart: input.bodyPart, instructions: input.instructions ?? null, isCustom: true }).run();
  logActivity(db, { actor, action: "created", entity: "exercise", entityId: id, summary: `Added exercise "${input.name}"` });
  return serializeExercise(requireExercise(db, id));
}

export function updateExercise(db: Db, id: string, input: { name?: string; category?: ExerciseCategory; bodyPart?: Exercise["bodyPart"]; instructions?: string | null }, actor = "user"): Exercise {
  const existing = requireExercise(db, id);
  if (!existing.isCustom && ((input.name !== undefined && input.name !== existing.name) || (input.category !== undefined && input.category !== existing.category))) {
    throw badRequest("Built-in exercises cannot be renamed or change category");
  }
  const set: Partial<ExerciseRow> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.category !== undefined) set.category = input.category;
  if (input.bodyPart !== undefined) set.bodyPart = input.bodyPart;
  if (input.instructions !== undefined) set.instructions = input.instructions;
  if (Object.keys(set).length) db.update(ex).set(set).where(eq(ex.id, id)).run();
  logActivity(db, { actor, action: "updated", entity: "exercise", entityId: id, summary: `Updated exercise "${set.name ?? existing.name}"`, data: input });
  return serializeExercise(requireExercise(db, id));
}

export function deleteExercise(db: Db, id: string, actor = "user"): void {
  const existing = requireExercise(db, id);
  if (!existing.isCustom) throw badRequest("Built-in exercises cannot be deleted");
  db.update(ex).set({ deletedAt: nowIso() }).where(eq(ex.id, id)).run();
  logActivity(db, { actor, action: "deleted", entity: "exercise", entityId: id, summary: `Deleted exercise "${existing.name}"` });
}

interface ExerciseWorkoutRows {
  workout: WorkoutRow;
  we: WorkoutExerciseRow;
  sets: WorkoutSetRow[];
}

function exerciseWorkouts(db: Db, exerciseId: string, opts: { limit?: number; offset?: number } = {}): ExerciseWorkoutRows[] {
  let q = db
    .select({ workout: wk, we: wex })
    .from(wex)
    .innerJoin(wk, eq(wk.id, wex.workoutId))
    .where(and(eq(wex.exerciseId, exerciseId), eq(wk.status, "completed")))
    .orderBy(desc(wk.finishedAt), asc(wex.sortOrder))
    .$dynamic();
  if (opts.limit !== undefined) q = q.limit(opts.limit).offset(opts.offset ?? 0);
  const rows = q.all();
  const sets = setsByWorkoutExercise(db, rows.map((r) => r.we.id));
  return rows.map((r) => ({ workout: r.workout, we: r.we, sets: sets.get(r.we.id) ?? [] }));
}

const historyEntry = (r: ExerciseWorkoutRows): ExerciseHistoryEntry => ({ workoutId: r.workout.id, workoutExerciseId: r.we.id, name: r.workout.name, startedAt: r.workout.startedAt, finishedAt: r.workout.finishedAt, notes: r.we.notes, sets: r.sets.map(serializeWorkoutSet) });

export function exerciseHistory(db: Db, exerciseId: string, opts: { limit?: number; offset?: number } = {}): ExerciseHistoryEntry[] {
  requireExercise(db, exerciseId);
  return exerciseWorkouts(db, exerciseId, { limit: opts.limit ?? 20, offset: opts.offset ?? 0 }).map(historyEntry);
}

type ChartKey = keyof ExerciseDetail["charts"];

function chartSeries(entries: ExerciseWorkoutRows[], category: ExerciseCategory, ctx: CalcContext): ExerciseDetail["charts"] {
  const charts: ExerciseDetail["charts"] = { oneRm: [], maxWeight: [], volume: [], maxReps: [], totalReps: [], distance: [], duration: [] };
  const push = (key: ChartKey, workout: WorkoutRow, value: number) => {
    if (value > 0) charts[key].push({ date: dateOfIso(workout.finishedAt ?? workout.startedAt), value: round2(value), workoutId: workout.id });
  };
  const weightBased = isWeightCategory(category) || category === "weighted_bodyweight";
  for (const e of [...entries].reverse()) {
    const eligible = e.sets.map(toSetLike).filter(setCountsForRecords);
    if (eligible.length === 0) continue;
    if (isWeightCategory(category)) push("oneRm", e.workout, Math.max(0, ...eligible.filter((s) => (s.reps ?? 0) <= MAX_RECORD_REPS).map((s) => estimateOneRepMax(s.weight ?? 0, s.reps ?? 0, ctx.settings.oneRmFormula))));
    if (weightBased) push("maxWeight", e.workout, Math.max(0, ...eligible.map((s) => s.weight ?? 0)));
    if (weightBased || category === "assisted_bodyweight") push("volume", e.workout, eligible.reduce((n, s) => n + setVolume(s, { ...ctx.volume, category }), 0));
    if (isRepsOnlyCategory(category) || category === "weighted_bodyweight") {
      push("maxReps", e.workout, Math.max(0, ...eligible.map((s) => s.reps ?? 0)));
      push("totalReps", e.workout, eligible.reduce((n, s) => n + (s.reps ?? 0), 0));
    }
    if (category === "cardio") push("distance", e.workout, eligible.reduce((n, s) => n + (s.distance ?? 0), 0));
    if (category === "cardio" || category === "duration") push("duration", e.workout, eligible.reduce((n, s) => n + (s.seconds ?? 0), 0));
  }
  return charts;
}

export function getExerciseDetail(db: Db, id: string): ExerciseDetail {
  const exercise = requireExercise(db, id);
  const category = exercise.category as ExerciseCategory;
  const ctx = calcContext(db);
  const entries = exerciseWorkouts(db, id);
  const records = db.select().from(pr).where(eq(pr.exerciseId, id)).orderBy(asc(pr.type)).all().map((r) => serializeRecord(r));
  const weightBased = isWeightCategory(category) || category === "weighted_bodyweight";
  const performances = weightBased ? entries.flatMap((e) => e.sets.map(toSetLike).filter(setCountsForRecords).map((s) => ({ weight: s.weight ?? 0, reps: s.reps ?? 0 }))) : [];
  return {
    exercise: serializeExercise(exercise, { lastPerformedAt: entries[0]?.workout.finishedAt ?? null, recordOneRm: records.find((r) => r.type === "one_rm")?.value ?? null }),
    records,
    bestByReps: weightBased ? repMaxTable(performances, ctx.settings.oneRmFormula) : [],
    history: entries.slice(0, 10).map(historyEntry),
    charts: chartSeries(entries, category, ctx),
    workoutCount: entries.length,
  };
}

// ---------- templates ----------

interface TemplateSetSpec {
  setType: SetType;
  targetWeight: number | null;
  targetReps: number | null;
  targetSeconds: number | null;
  targetDistance: number | null;
}
interface TemplateExerciseSpec {
  exerciseId: string;
  supersetGroup: number | null;
  restSeconds: number | null;
  notes: string | null;
  sets: TemplateSetSpec[];
}

function specFromInput(exercises: WorkoutTemplateInput["exercises"]): TemplateExerciseSpec[] {
  return (exercises ?? []).map((e) => ({
    exerciseId: e.exerciseId,
    supersetGroup: e.supersetGroup ?? null,
    restSeconds: e.restSeconds ?? null,
    notes: e.notes ?? null,
    sets: (e.sets ?? []).map((s) => ({ setType: s.setType ?? "normal", targetWeight: s.targetWeight ?? null, targetReps: s.targetReps ?? null, targetSeconds: s.targetSeconds ?? null, targetDistance: s.targetDistance ?? null })),
  }));
}

function templateSpec(db: Db, templateId: string): TemplateExerciseSpec[] {
  const exercises = db.select().from(tex).where(eq(tex.templateId, templateId)).orderBy(asc(tex.sortOrder)).all();
  const setRows = exercises.length ? db.select().from(tset).where(inArray(tset.templateExerciseId, exercises.map((e) => e.id))).orderBy(asc(tset.sortOrder)).all() : [];
  return exercises.map((e) => ({
    exerciseId: e.exerciseId,
    supersetGroup: e.supersetGroup,
    restSeconds: e.restSeconds,
    notes: e.notes,
    sets: setRows.filter((s) => s.templateExerciseId === e.id).map((s) => ({ setType: s.setType as SetType, targetWeight: s.targetWeight, targetReps: s.targetReps, targetSeconds: s.targetSeconds, targetDistance: s.targetDistance })),
  }));
}

function specFromWorkout(db: Db, workoutId: string): TemplateExerciseSpec[] {
  const exercises = db.select().from(wex).where(eq(wex.workoutId, workoutId)).orderBy(asc(wex.sortOrder)).all();
  const sets = setsByWorkoutExercise(db, exercises.map((e) => e.id));
  return exercises.map((e) => ({
    exerciseId: e.exerciseId,
    supersetGroup: e.supersetGroup,
    restSeconds: e.restSeconds,
    notes: e.notes,
    sets: (sets.get(e.id) ?? []).map((s) => ({ setType: s.setType as SetType, targetWeight: s.weight, targetReps: s.reps, targetSeconds: s.seconds, targetDistance: s.distance })),
  }));
}

function assertExercisesExist(db: Db, spec: TemplateExerciseSpec[]): void {
  const ids = Array.from(new Set(spec.map((e) => e.exerciseId)));
  if (ids.length === 0) return;
  const found = new Set(db.select({ id: ex.id }).from(ex).where(and(inArray(ex.id, ids), isNull(ex.deletedAt))).all().map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw badRequest("Unknown exercise", { exerciseIds: missing });
}

/** Replaces a template's exercises and sets, keeping row ids where the exercise and position match. */
function replaceTemplateExercises(db: Db, templateId: string, spec: TemplateExerciseSpec[]): void {
  assertExercisesExist(db, spec);
  const existing = db.select().from(tex).where(eq(tex.templateId, templateId)).orderBy(asc(tex.sortOrder)).all();
  const existingSets = existing.length ? db.select().from(tset).where(inArray(tset.templateExerciseId, existing.map((e) => e.id))).orderBy(asc(tset.sortOrder)).all() : [];
  const keptExerciseIds = new Set<string>();
  const keptSetIds = new Set<string>();
  spec.forEach((e, i) => {
    const match = existing[i]?.exerciseId === e.exerciseId ? existing[i] : undefined;
    const exerciseRowId = match?.id ?? newId();
    const values = { templateId, exerciseId: e.exerciseId, sortOrder: i, supersetGroup: e.supersetGroup, restSeconds: e.restSeconds, notes: e.notes };
    if (match) db.update(tex).set(values).where(eq(tex.id, match.id)).run();
    else db.insert(tex).values({ id: exerciseRowId, ...values }).run();
    keptExerciseIds.add(exerciseRowId);
    const oldSets = match ? existingSets.filter((s) => s.templateExerciseId === match.id) : [];
    e.sets.forEach((s, j) => {
      const oldSet = oldSets[j];
      const setValues = { templateExerciseId: exerciseRowId, sortOrder: j, setType: s.setType, targetWeight: s.targetWeight, targetReps: s.targetReps, targetSeconds: s.targetSeconds, targetDistance: s.targetDistance };
      if (oldSet) {
        db.update(tset).set(setValues).where(eq(tset.id, oldSet.id)).run();
        keptSetIds.add(oldSet.id);
      } else db.insert(tset).values({ id: newId(), ...setValues }).run();
    });
  });
  const staleSets = existingSets.filter((s) => !keptSetIds.has(s.id)).map((s) => s.id);
  if (staleSets.length) db.delete(tset).where(inArray(tset.id, staleSets)).run();
  const staleExercises = existing.filter((e) => !keptExerciseIds.has(e.id)).map((e) => e.id);
  if (staleExercises.length) db.delete(tex).where(inArray(tex.id, staleExercises)).run();
  db.update(tpl).set({ updatedAt: nowIso() }).where(eq(tpl.id, templateId)).run();
}

function serializeTemplates(db: Db, rows: TemplateRow[]): WorkoutTemplate[] {
  if (rows.length === 0) return [];
  const exRows = db.select().from(tex).where(inArray(tex.templateId, rows.map((r) => r.id))).orderBy(asc(tex.sortOrder)).all();
  const setRows = exRows.length ? db.select().from(tset).where(inArray(tset.templateExerciseId, exRows.map((e) => e.id))).orderBy(asc(tset.sortOrder)).all() : [];
  const exercises = exerciseMap(db, exRows.map((e) => e.exerciseId));
  const setsByTex = new Map<string, TemplateSetRow[]>();
  for (const s of setRows) setsByTex.set(s.templateExerciseId, [...(setsByTex.get(s.templateExerciseId) ?? []), s]);
  const build = (e: TemplateExerciseRow): TemplateExercise => {
    const exercise = exercises.get(e.exerciseId);
    return { id: e.id, templateId: e.templateId, exerciseId: e.exerciseId, sortOrder: e.sortOrder, supersetGroup: e.supersetGroup, restSeconds: e.restSeconds, notes: e.notes, exercise: exercise ? serializeExercise(exercise) : undefined, sets: (setsByTex.get(e.id) ?? []).map(serializeTemplateSet) };
  };
  return rows.map((t) => ({ id: t.id, name: t.name, notes: t.notes, folder: t.folder, sortOrder: t.sortOrder, lastPerformedAt: t.lastPerformedAt, createdAt: t.createdAt, updatedAt: t.updatedAt, deletedAt: t.deletedAt, exercises: exRows.filter((e) => e.templateId === t.id).map(build) }));
}

export function listTemplates(db: Db): WorkoutTemplate[] {
  return serializeTemplates(db, db.select().from(tpl).where(isNull(tpl.deletedAt)).orderBy(asc(tpl.sortOrder), asc(tpl.createdAt)).all());
}

export function getTemplate(db: Db, id: string): WorkoutTemplate {
  const row = requireTemplate(db, id);
  const [out] = serializeTemplates(db, [row]);
  if (!out) throw notFound("Template");
  return out;
}

function nextTemplateSortOrder(db: Db): number {
  return (db.select({ m: sql<number>`coalesce(max(${tpl.sortOrder}), -1)` }).from(tpl).get()?.m ?? -1) + 1;
}

function insertTemplate(db: Db, input: { name: string; notes?: string | null; folder?: string | null; sortOrder?: number }, spec: TemplateExerciseSpec[]): string {
  const id = newId();
  db.insert(tpl).values({ id, name: input.name, notes: input.notes ?? null, folder: input.folder ?? null, sortOrder: input.sortOrder ?? nextTemplateSortOrder(db) }).run();
  replaceTemplateExercises(db, id, spec);
  return id;
}

export function createTemplate(db: Db, input: WorkoutTemplateInput, actor = "user"): WorkoutTemplate {
  const id = db.transaction((tx) => insertTemplate(tx, input, specFromInput(input.exercises)));
  logActivity(db, { actor, action: "created", entity: "workout_template", entityId: id, summary: `Created template "${input.name}"` });
  return getTemplate(db, id);
}

export function replaceTemplate(db: Db, id: string, input: WorkoutTemplateInput, actor = "user"): WorkoutTemplate {
  requireTemplate(db, id);
  db.transaction((tx) => {
    tx.update(tpl).set({ name: input.name, notes: input.notes ?? null, folder: input.folder ?? null, ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }), updatedAt: nowIso() }).where(eq(tpl.id, id)).run();
    replaceTemplateExercises(tx, id, specFromInput(input.exercises));
  });
  logActivity(db, { actor, action: "updated", entity: "workout_template", entityId: id, summary: `Updated template "${input.name}"` });
  return getTemplate(db, id);
}

export function patchTemplate(db: Db, id: string, input: TemplatePatch, actor = "user"): WorkoutTemplate {
  const existing = requireTemplate(db, id);
  const set: Partial<TemplateRow> = { updatedAt: nowIso() };
  if (input.name !== undefined) set.name = input.name;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.folder !== undefined) set.folder = input.folder;
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  db.update(tpl).set(set).where(eq(tpl.id, id)).run();
  logActivity(db, { actor, action: "updated", entity: "workout_template", entityId: id, summary: `Updated template "${set.name ?? existing.name}"`, data: input });
  return getTemplate(db, id);
}

export function deleteTemplate(db: Db, id: string, actor = "user"): void {
  const existing = requireTemplate(db, id);
  db.update(tpl).set({ deletedAt: nowIso(), updatedAt: nowIso() }).where(eq(tpl.id, id)).run();
  logActivity(db, { actor, action: "deleted", entity: "workout_template", entityId: id, summary: `Deleted template "${existing.name}"` });
}

export function duplicateTemplate(db: Db, id: string, actor = "user"): WorkoutTemplate {
  const existing = requireTemplate(db, id);
  const copyId = db.transaction((tx) => insertTemplate(tx, { name: `${existing.name} (copy)`, notes: existing.notes, folder: existing.folder }, templateSpec(tx, id)));
  logActivity(db, { actor, action: "created", entity: "workout_template", entityId: copyId, summary: `Duplicated template "${existing.name}"` });
  return getTemplate(db, copyId);
}

export function reorderTemplates(db: Db, ids: string[]): WorkoutTemplate[] {
  db.transaction((tx) => {
    ids.forEach((id, i) => tx.update(tpl).set({ sortOrder: i, updatedAt: nowIso() }).where(eq(tpl.id, id)).run());
    const rest = tx.select({ id: tpl.id }).from(tpl).where(ids.length ? and(isNull(tpl.deletedAt), notInArray(tpl.id, ids)) : isNull(tpl.deletedAt)).orderBy(asc(tpl.sortOrder), asc(tpl.createdAt)).all();
    rest.forEach((r, i) => tx.update(tpl).set({ sortOrder: ids.length + i }).where(eq(tpl.id, r.id)).run());
  });
  return listTemplates(db);
}

// ---------- workouts ----------

export function getActiveWorkout(db: Db): Workout | null {
  const row = getActiveRow(db);
  return row ? fullWorkout(db, row) : null;
}

export function getWorkout(db: Db, id: string): Workout {
  return fullWorkout(db, requireWorkout(db, id));
}

function defaultWorkoutName(): string {
  return `${format(new Date(), "EEEE")} Workout`;
}

export function startWorkout(db: Db, input: { templateId?: string | null; name?: string }, actor = "user"): Workout {
  const active = getActiveRow(db);
  if (active) throw new HttpError(409, "A workout is already in progress", { workout: fullWorkout(db, active) });
  const template = input.templateId ? requireTemplate(db, input.templateId) : null;
  const defaultRest = getAppSettings(db).defaultRestSeconds ?? STRONG_DEFAULT_REST_SECONDS;
  const id = newId();
  const now = nowIso();
  db.transaction((tx) => {
    tx.insert(wk).values({ id, templateId: template?.id ?? null, name: input.name?.trim() || template?.name || defaultWorkoutName(), notes: template?.notes ?? null, startedAt: now, status: "active" }).run();
    if (!template) return;
    templateSpec(tx, template.id).forEach((e, i) => {
      const weId = newId();
      tx.insert(wex).values({ id: weId, workoutId: id, exerciseId: e.exerciseId, sortOrder: i, supersetGroup: e.supersetGroup, restSeconds: e.restSeconds ?? defaultRest, notes: e.notes }).run();
      if (e.sets.length === 0) return;
      tx.insert(wset)
        .values(e.sets.map((s, j) => ({ id: newId(), workoutExerciseId: weId, sortOrder: j, setType: s.setType, weight: s.targetWeight, reps: s.targetReps, seconds: s.targetSeconds, distance: s.targetDistance, completed: false })))
        .run();
    });
  });
  logActivity(db, { actor, action: "started", entity: "workout", entityId: id, summary: template ? `Started workout from "${template.name}"` : "Started an empty workout" });
  return getWorkout(db, id);
}

export function listWorkouts(db: Db, opts: { limit?: number; offset?: number } = {}): WorkoutListItem[] {
  const rows = db
    .select()
    .from(wk)
    .where(eq(wk.status, "completed"))
    .orderBy(desc(wk.finishedAt), desc(wk.startedAt))
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0)
    .all();
  if (rows.length === 0) return [];
  const weRows = db.select().from(wex).where(inArray(wex.workoutId, rows.map((r) => r.id))).orderBy(asc(wex.sortOrder)).all();
  const sets = setsByWorkoutExercise(db, weRows.map((r) => r.id));
  const exercises = exerciseMap(db, weRows.map((r) => r.exerciseId));
  const names = templateNames(db, rows.map((r) => r.templateId));
  const formula = getWorkoutSettings(db).oneRmFormula;
  return rows.map((row) => ({
    ...serializeWorkoutRow(row, row.templateId ? (names.get(row.templateId) ?? null) : null),
    exerciseSummary: weRows
      .filter((we) => we.workoutId === row.id)
      .map((we) => {
        const exercise = exercises.get(we.exerciseId);
        const category = exercise?.category as ExerciseCategory | undefined;
        const ownSets = sets.get(we.id) ?? [];
        const best = bestSet(ownSets.map(toSetLike), category, formula);
        return {
          workoutExerciseId: we.id,
          exerciseId: we.exerciseId,
          name: exercise?.name ?? "Unknown exercise",
          category: category ?? "barbell",
          supersetGroup: we.supersetGroup,
          setCount: ownSets.filter((s) => s.setType !== "warmup").length,
          bestSet: best ? { setType: best.setType, weight: best.weight, reps: best.reps, seconds: best.seconds ?? null, distance: best.distance ?? null } : null,
          prCount: ownSets.reduce((n, s) => n + parseJson<PrType[]>(s.prs, []).length, 0),
        };
      }),
  }));
}

export function updateWorkout(db: Db, id: string, input: WorkoutUpdate, actor = "user"): Workout {
  const existing = requireWorkout(db, id);
  const set: Partial<WorkoutRow> = { updatedAt: nowIso() };
  if (input.name !== undefined) set.name = input.name;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.startedAt !== undefined) set.startedAt = input.startedAt;
  if (input.finishedAt !== undefined && existing.status === "completed") set.finishedAt = input.finishedAt;
  if (input.durationSeconds !== undefined) set.durationSeconds = input.durationSeconds;
  else if (existing.status === "completed" && (set.startedAt || set.finishedAt)) {
    set.durationSeconds = Math.max(0, Math.round((Date.parse(set.finishedAt ?? existing.finishedAt ?? existing.startedAt) - Date.parse(set.startedAt ?? existing.startedAt)) / 1000));
  }
  db.update(wk).set(set).where(eq(wk.id, id)).run();
  if (set.finishedAt && set.finishedAt !== existing.finishedAt) {
    const exerciseIds = db.select({ id: wex.exerciseId }).from(wex).where(eq(wex.workoutId, id)).all().map((r) => r.id);
    for (const exerciseId of new Set(exerciseIds)) replayExerciseRecords(db, exerciseId);
  }
  logActivity(db, { actor, action: "updated", entity: "workout", entityId: id, summary: `Updated workout "${set.name ?? existing.name}"`, data: input });
  return getWorkout(db, id);
}

function deleteWorkoutRows(db: Db, workoutId: string): string[] {
  const weRows = db.select({ id: wex.id, exerciseId: wex.exerciseId }).from(wex).where(eq(wex.workoutId, workoutId)).all();
  if (weRows.length) {
    db.delete(wset).where(inArray(wset.workoutExerciseId, weRows.map((r) => r.id))).run();
    db.delete(wex).where(eq(wex.workoutId, workoutId)).run();
  }
  return Array.from(new Set(weRows.map((r) => r.exerciseId)));
}

export function deleteWorkout(db: Db, id: string, actor = "user"): void {
  const existing = requireWorkout(db, id);
  const exerciseIds = db.transaction((tx) => {
    const ids = deleteWorkoutRows(tx, id);
    tx.delete(wk).where(eq(wk.id, id)).run();
    return ids;
  });
  if (existing.status === "completed") for (const exerciseId of exerciseIds) replayExerciseRecords(db, exerciseId);
  logActivity(db, { actor, action: "deleted", entity: "workout", entityId: id, summary: `Deleted workout "${existing.name}"` });
}

export function discardWorkout(db: Db, id: string, actor = "user"): Workout {
  const existing = requireWorkout(db, id);
  if (existing.status !== "active") throw badRequest("Only an active workout can be discarded");
  db.transaction((tx) => {
    deleteWorkoutRows(tx, id);
    tx.update(wk).set({ status: "discarded", finishedAt: nowIso(), updatedAt: nowIso() }).where(eq(wk.id, id)).run();
  });
  logActivity(db, { actor, action: "discarded", entity: "workout", entityId: id, summary: `Discarded workout "${existing.name}"` });
  return getWorkout(db, id);
}

// ---------- exercises within a workout ----------

function nextSortOrder(rows: { sortOrder: number }[]): number {
  return rows.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1;
}

export function addWorkoutExercise(db: Db, workoutId: string, input: WorkoutExerciseAdd): WorkoutExercise {
  const workout = requireWorkout(db, workoutId);
  if (workout.status === "discarded") throw badRequest("Workout was discarded");
  requireExercise(db, input.exerciseId);
  const weId = newId();
  const sortOrder = nextSortOrder(db.select({ sortOrder: wex.sortOrder }).from(wex).where(eq(wex.workoutId, workoutId)).all());
  const restSeconds = input.restSeconds === undefined ? (getAppSettings(db).defaultRestSeconds ?? STRONG_DEFAULT_REST_SECONDS) : input.restSeconds;
  db.transaction((tx) => {
    tx.insert(wex).values({ id: weId, workoutId, exerciseId: input.exerciseId, sortOrder, supersetGroup: input.supersetGroup ?? null, restSeconds }).run();
    tx.insert(wset).values({ id: newId(), workoutExerciseId: weId, sortOrder: 0, setType: "normal", completed: false }).run();
  });
  return workoutExerciseView(db, weId);
}

export function reorderWorkoutExercises(db: Db, workoutId: string, ids: string[]): Workout {
  const workout = requireWorkout(db, workoutId);
  const rows = db.select().from(wex).where(eq(wex.workoutId, workoutId)).orderBy(asc(wex.sortOrder)).all();
  const known = new Set(rows.map((r) => r.id));
  const ordered = [...ids.filter((id) => known.has(id)), ...rows.map((r) => r.id).filter((id) => !ids.includes(id))];
  db.transaction((tx) => ordered.forEach((id, i) => tx.update(wex).set({ sortOrder: i }).where(eq(wex.id, id)).run()));
  afterSetChange(
    db,
    workout,
    rows.map((r) => r.exerciseId),
  );
  return getWorkout(db, workoutId);
}

export function updateWorkoutExercise(db: Db, weId: string, input: WorkoutExerciseUpdate): WorkoutExercise {
  requireWorkoutExercise(db, weId);
  const set: Partial<WorkoutExerciseRow> = {};
  if (input.restSeconds !== undefined) set.restSeconds = input.restSeconds;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.supersetGroup !== undefined) set.supersetGroup = input.supersetGroup;
  if (Object.keys(set).length) db.update(wex).set(set).where(eq(wex.id, weId)).run();
  return workoutExerciseView(db, weId);
}

export function removeWorkoutExercise(db: Db, weId: string): void {
  const { we, workout } = requireWorkoutExercise(db, weId);
  db.transaction((tx) => {
    tx.delete(wset).where(eq(wset.workoutExerciseId, weId)).run();
    tx.delete(wex).where(eq(wex.id, weId)).run();
  });
  afterSetChange(db, workout, [we.exerciseId]);
}

export function replaceWorkoutExercise(db: Db, weId: string, exerciseId: string): WorkoutExercise {
  const { we, workout } = requireWorkoutExercise(db, weId);
  requireExercise(db, exerciseId);
  db.transaction((tx) => {
    tx.update(wex).set({ exerciseId }).where(eq(wex.id, weId)).run();
    tx.update(wset).set({ prs: "[]" }).where(eq(wset.workoutExerciseId, weId)).run();
  });
  afterSetChange(db, workout, [we.exerciseId, exerciseId]);
  return workoutExerciseView(db, weId);
}

// ---------- sets ----------

export function addWorkoutSet(db: Db, weId: string): WorkoutSet {
  const { we, workout } = requireWorkoutExercise(db, weId);
  const existing = db.select().from(wset).where(eq(wset.workoutExerciseId, weId)).orderBy(asc(wset.sortOrder)).all();
  const last = existing[existing.length - 1];
  const source: { weight: number | null; reps: number | null; seconds: number | null; distance: number | null } = last ?? previousSets(db, we.exerciseId, { excludeWorkoutId: workout.id, templateId: workout.templateId, sameTemplateOnly: getWorkoutSettings(db).previousSetSource === "same_template" })[existing.length] ?? { weight: null, reps: null, seconds: null, distance: null };
  const id = newId();
  db.insert(wset).values({ id, workoutExerciseId: weId, sortOrder: nextSortOrder(existing), setType: "normal", weight: source.weight, reps: source.reps, seconds: source.seconds, distance: source.distance, completed: false }).run();
  const row = db.select().from(wset).where(eq(wset.id, id)).get();
  if (!row) throw notFound("Set");
  return serializeWorkoutSet(row);
}

export function updateWorkoutSet(db: Db, setId: string, input: WorkoutSetInput): WorkoutSet {
  const { set: existing, we, workout } = requireWorkoutSet(db, setId);
  const patch: Partial<WorkoutSetRow> = {};
  if (input.setType !== undefined) patch.setType = input.setType;
  if (input.weight !== undefined) patch.weight = input.weight;
  if (input.reps !== undefined) patch.reps = input.reps;
  if (input.seconds !== undefined) patch.seconds = input.seconds;
  if (input.distance !== undefined) patch.distance = input.distance;
  if (input.rpe !== undefined) patch.rpe = input.rpe;
  if (input.completed !== undefined && input.completed !== existing.completed) {
    patch.completed = input.completed;
    patch.completedAt = input.completed ? nowIso() : null;
    if (!input.completed) patch.prs = "[]";
  }
  if (Object.keys(patch).length) db.update(wset).set(patch).where(eq(wset.id, setId)).run();
  afterSetChange(db, workout, [we.exerciseId]);
  const row = db.select().from(wset).where(eq(wset.id, setId)).get();
  if (!row) throw notFound("Set");
  return serializeWorkoutSet(row);
}

export function deleteWorkoutSet(db: Db, setId: string): void {
  const { we, workout } = requireWorkoutSet(db, setId);
  db.delete(wset).where(eq(wset.id, setId)).run();
  afterSetChange(db, workout, [we.exerciseId]);
}

export const setWorkoutSetType = (db: Db, setId: string, setType: SetType): WorkoutSet => updateWorkoutSet(db, setId, { setType });

// ---------- finish ----------

/** Matches template exercises to workout exercises by exercise id and occurrence order, so inserted exercises do not shift values. */
function matchByExercise(target: TemplateExerciseSpec[], source: TemplateExerciseSpec[]): Map<number, TemplateExerciseSpec> {
  const occurrences = new Map<string, TemplateExerciseSpec[]>();
  for (const s of source) occurrences.set(s.exerciseId, [...(occurrences.get(s.exerciseId) ?? []), s]);
  const out = new Map<number, TemplateExerciseSpec>();
  target.forEach((t, i) => {
    const match = occurrences.get(t.exerciseId)?.shift();
    if (match) out.set(i, match);
  });
  return out;
}

const copyTargets = (into: TemplateSetSpec, from: TemplateSetSpec): TemplateSetSpec => ({ ...into, targetWeight: from.targetWeight, targetReps: from.targetReps, targetSeconds: from.targetSeconds, targetDistance: from.targetDistance });

function applyTemplateAction(db: Db, workout: WorkoutRow, action: TemplateAction, body: WorkoutFinish): { changed: boolean; templateId: string | null } {
  if (action === "keep") return { changed: false, templateId: workout.templateId };
  const fromWorkout = specFromWorkout(db, workout.id);
  if (action === "save_as_template") {
    const id = insertTemplate(db, { name: body.newTemplateName ?? workout.name, notes: workout.notes, folder: body.newTemplateFolder ?? null }, fromWorkout);
    db.update(tpl).set({ lastPerformedAt: workout.finishedAt }).where(eq(tpl.id, id)).run();
    return { changed: true, templateId: id };
  }
  const templateId = workout.templateId;
  if (!templateId) throw badRequest("Workout was not started from a template");
  const current = templateSpec(db, templateId);
  if (action === "update_both") {
    replaceTemplateExercises(db, templateId, fromWorkout);
    return { changed: true, templateId };
  }
  if (action === "update_template") {
    const matches = matchByExercise(fromWorkout, current);
    const next = fromWorkout.map((e, i) => {
      const old = matches.get(i);
      return old ? { ...e, sets: e.sets.map((s, j) => (old.sets[j] ? copyTargets(s, old.sets[j]) : s)) } : e;
    });
    replaceTemplateExercises(db, templateId, next);
    return { changed: true, templateId };
  }
  const matches = matchByExercise(current, fromWorkout);
  const next = current.map((e, i) => {
    const performed = matches.get(i);
    return performed ? { ...e, sets: e.sets.map((s, j) => (performed.sets[j] ? copyTargets(s, performed.sets[j]) : s)) } : e;
  });
  replaceTemplateExercises(db, templateId, next);
  return { changed: true, templateId };
}

/** One entry per set and record type flagged in the workout, in set order (the finish summary's records list). */
function workoutPrEvents(db: Db, workoutId: string): WorkoutFinishResult["summary"]["prs"] {
  const formula = getWorkoutSettings(db).oneRmFormula;
  return db
    .select({ set: wset, exerciseId: ex.id, exerciseName: ex.name, category: ex.category })
    .from(wset)
    .innerJoin(wex, eq(wex.id, wset.workoutExerciseId))
    .innerJoin(ex, eq(ex.id, wex.exerciseId))
    .where(eq(wex.workoutId, workoutId))
    .orderBy(asc(wex.sortOrder), asc(wset.sortOrder))
    .all()
    .flatMap((r) =>
      parseJson<PrType[]>(r.set.prs, []).map((type) => ({
        exerciseId: r.exerciseId,
        exerciseName: r.exerciseName,
        type,
        value: round2(recordValueForSet(toSetLike(r.set), type, r.category as ExerciseCategory, formula) ?? 0),
        weight: r.set.weight,
        reps: r.set.reps,
        workoutSetId: r.set.id,
      })),
    );
}

export function finishWorkout(db: Db, id: string, body: WorkoutFinish, actor = "user"): WorkoutFinishResult {
  const workout = requireWorkout(db, id);
  if (workout.status !== "active") throw new HttpError(409, "Workout is not in progress", { status: workout.status });
  const action: TemplateAction = body.templateAction ?? (body.updateTemplate ? "update_both" : "keep");
  if (action.startsWith("update_")) {
    if (!workout.templateId) throw badRequest("Workout was not started from a template");
    requireTemplate(db, workout.templateId);
  }
  const rows = db
    .select({ set: wset, category: ex.category })
    .from(wset)
    .innerJoin(wex, eq(wex.id, wset.workoutExerciseId))
    .innerJoin(ex, eq(ex.id, wex.exerciseId))
    .where(eq(wex.workoutId, id))
    .all();
  const empty = rows.filter((r) => isEmptySet(toSetLike(r.set), r.category as ExerciseCategory));
  const incomplete = rows.filter((r) => !r.set.completed && !empty.includes(r));
  if (incomplete.length && body.discardIncomplete === false) {
    throw new HttpError(409, "Workout has sets that are not marked complete", { incompleteSets: incomplete.length, completedSets: rows.filter((r) => r.set.completed).length, emptySets: empty.length });
  }
  const finishedAt = nowIso();
  const durationSeconds = body.durationSeconds ?? Math.max(0, Math.round((Date.parse(finishedAt) - Date.parse(workout.startedAt)) / 1000));
  const template = db.transaction((tx) => {
    const dropIds = [...empty, ...incomplete].map((r) => r.set.id);
    if (dropIds.length) tx.delete(wset).where(inArray(wset.id, dropIds)).run();
    const emptyExercises = tx
      .select({ id: wex.id })
      .from(wex)
      .where(and(eq(wex.workoutId, id), sql`not exists (select 1 from ${wset} where ${wset.workoutExerciseId} = ${wex.id})`))
      .all();
    if (emptyExercises.length) tx.delete(wex).where(inArray(wex.id, emptyExercises.map((r) => r.id))).run();
    const kept = rows.filter((r) => !dropIds.includes(r.set.id)).map((r) => ({ ...toSetLike(r.set), category: r.category as ExerciseCategory }));
    const totals = workoutTotals(kept, calcContext(tx).volume);
    tx.update(wk).set({ status: "completed", finishedAt, durationSeconds, totalVolume: round2(totals.volume), totalSets: totals.completedSets, updatedAt: finishedAt }).where(eq(wk.id, id)).run();
    const exerciseIds = new Set(tx.select({ id: wex.exerciseId }).from(wex).where(eq(wex.workoutId, id)).all().map((r) => r.id));
    for (const exerciseId of exerciseIds) replayExerciseRecords(tx, exerciseId);
    const finished = { ...workout, status: "completed", finishedAt };
    const result = applyTemplateAction(tx, finished, action, body);
    if (workout.templateId) tx.update(tpl).set({ lastPerformedAt: finishedAt }).where(eq(tpl.id, workout.templateId)).run();
    return result;
  });
  const done = requireWorkout(db, id);
  const prs = workoutPrEvents(db, id);
  logActivity(db, { actor, action: "completed", entity: "workout", entityId: id, summary: `Finished workout "${done.name}" (${done.totalSets ?? 0} sets, ${prs.length} PRs)`, data: { durationSeconds, totalVolume: done.totalVolume, prCount: prs.length, templateAction: action } });
  return { workout: getWorkout(db, id), summary: { durationSeconds, totalVolume: done.totalVolume ?? 0, totalSets: done.totalSets ?? 0, prs, templateChanged: template.changed, templateId: template.templateId } };
}

// ---------- stats and calendar ----------

export function workoutStats(db: Db): WorkoutStats {
  const weekStartsOn = getAppSettings(db).weekStartsOn;
  const weeklyTarget = getHealthProfile(db).targets.workoutsPerWeek;
  const rows = db.select({ id: wk.id, name: wk.name, finishedAt: wk.finishedAt, startedAt: wk.startedAt, totalVolume: wk.totalVolume }).from(wk).where(eq(wk.status, "completed")).orderBy(desc(wk.finishedAt)).all();
  const byWeek = new Map<string, { volume: number; count: number }>();
  for (const r of rows) {
    const week = weekStartString(dateOfIso(r.finishedAt ?? r.startedAt), weekStartsOn);
    const agg = byWeek.get(week) ?? { volume: 0, count: 0 };
    agg.volume += r.totalVolume ?? 0;
    agg.count += 1;
    byWeek.set(week, agg);
  }
  const thisWeekStart = weekStartString(todayString(), weekStartsOn);
  const lastWeekStart = addDaysString(thisWeekStart, -7);
  let streakWeeks = 0;
  let cursor = (byWeek.get(thisWeekStart)?.count ?? 0) > 0 ? thisWeekStart : lastWeekStart;
  while ((byWeek.get(cursor)?.count ?? 0) > 0) {
    streakWeeks += 1;
    cursor = addDaysString(cursor, -7);
  }
  const volumeByWeek = Array.from({ length: 12 }, (_, i) => {
    const weekStart = addDaysString(thisWeekStart, -7 * (11 - i));
    const agg = byWeek.get(weekStart);
    return { weekStart, volume: round2(agg?.volume ?? 0), count: agg?.count ?? 0 };
  });
  const recentPrs = db.select({ record: pr, exerciseName: ex.name }).from(pr).innerJoin(ex, eq(ex.id, pr.exerciseId)).orderBy(desc(pr.achievedAt)).limit(10).all().map((r) => serializeRecord(r.record, r.exerciseName));
  const last = rows[0];
  return {
    thisWeek: byWeek.get(thisWeekStart)?.count ?? 0,
    lastWeek: byWeek.get(lastWeekStart)?.count ?? 0,
    weeklyTarget,
    streakWeeks,
    totalWorkouts: rows.length,
    last: last ? { id: last.id, name: last.name, finishedAt: last.finishedAt ?? last.startedAt } : null,
    volumeByWeek,
    recentPrs,
  };
}

export function workoutCalendar(db: Db, from: string, to: string): WorkoutCalendarDay[] {
  const rows = db.select({ id: wk.id, name: wk.name, finishedAt: wk.finishedAt, startedAt: wk.startedAt }).from(wk).where(eq(wk.status, "completed")).orderBy(asc(wk.finishedAt)).all();
  const days = new Map<string, WorkoutCalendarDay>();
  for (const r of rows) {
    const date = dateOfIso(r.finishedAt ?? r.startedAt);
    if (date < from || date > to) continue;
    const day = days.get(date) ?? { date, workouts: [] };
    day.workouts.push({ id: r.id, name: r.name, finishedAt: r.finishedAt });
    days.set(date, day);
  }
  return Array.from(days.values());
}

