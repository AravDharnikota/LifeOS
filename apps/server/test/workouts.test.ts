import { describe, it, expect, afterAll } from "vitest";
import { count } from "drizzle-orm";
import type { Exercise, ExerciseDetail, Workout, WorkoutExercise, WorkoutFinishResult, WorkoutListItem, WorkoutSet, WorkoutStats, WorkoutTemplate, WorkoutCalendarDay } from "@aravos/shared";
import { estimateOneRepMax, todayString } from "@aravos/shared";
import { makeTestApp, type TestApp } from "./helpers.ts";
import { seedExercises } from "../src/services/exercise-library.ts";
import { schema } from "../src/db/client.ts";

const t = makeTestApp();
afterAll(() => t.cleanup());

async function findExercise(app: TestApp, name: string): Promise<Exercise> {
  const r = await app.api<Exercise[]>("GET", `/api/exercises?q=${encodeURIComponent(name)}`);
  const found = r.data.find((e) => e.name === name);
  if (!found) throw new Error(`Exercise ${name} not seeded`);
  return found;
}

const completeSet = (app: TestApp, setId: string, values: { weight?: number | null; reps?: number | null; seconds?: number; distance?: number }) => app.api<WorkoutSet>("PATCH", `/api/workout-sets/${setId}`, { ...values, completed: true });

const exerciseOf = (w: Workout, exerciseId: string): WorkoutExercise => {
  const found = w.exercises?.find((e) => e.exerciseId === exerciseId);
  if (!found) throw new Error("exercise missing from workout");
  return found;
};
const setAt = (we: WorkoutExercise, i: number): WorkoutSet => {
  const s = we.sets?.[i];
  if (!s) throw new Error(`set ${i} missing`);
  return s;
};

describe("exercise library", () => {
  it("seeds the library and the five example templates idempotently", async () => {
    const exercises = await t.api<Exercise[]>("GET", "/api/exercises");
    expect(exercises.data.length).toBeGreaterThan(150);
    expect(exercises.data.every((e) => !e.isCustom)).toBe(true);
    const templates = await t.api<WorkoutTemplate[]>("GET", "/api/templates");
    expect(templates.data).toHaveLength(5);
    expect(templates.data.map((x) => x.name)).toEqual(["Strong 5x5 - Workout A", "Strong 5x5 - Workout B", "Legs", "Back and Biceps", "Chest and Triceps"]);
    const a = templates.data[0]!;
    expect(a.folder).toBe("Example Templates");
    expect(a.exercises?.map((e) => e.exercise?.name)).toEqual(["Squat (Barbell)", "Bench Press (Barbell)", "Bent Over Row (Barbell)"]);
    expect(a.exercises?.every((e) => e.sets?.length === 5 && e.sets.every((s) => s.targetReps === 5))).toBe(true);
    const b = templates.data[1]!;
    expect(b.exercises?.[2]?.exercise?.name).toBe("Deadlift (Barbell)");
    expect(b.exercises?.[2]?.sets).toHaveLength(1);
    const before = t.ctx.db.select({ n: count() }).from(schema.exercises).get()?.n;
    seedExercises(t.ctx.db);
    expect(t.ctx.db.select({ n: count() }).from(schema.exercises).get()?.n).toBe(before);
    expect((await t.api<WorkoutTemplate[]>("GET", "/api/templates")).data).toHaveLength(5);
  });
  it("filters by search, body part and category", async () => {
    const chest = await t.api<Exercise[]>("GET", "/api/exercises?bodyPart=chest");
    expect(chest.data.length).toBeGreaterThan(10);
    expect(chest.data.every((e) => e.bodyPart === "chest")).toBe(true);
    const cardio = await t.api<Exercise[]>("GET", "/api/exercises?category=cardio");
    expect(cardio.data.some((e) => e.name === "Running")).toBe(true);
    const bench = await t.api<Exercise[]>("GET", "/api/exercises?q=bench%20press");
    expect(bench.data.some((e) => e.name === "Bench Press (Barbell)")).toBe(true);
    expect(bench.data.every((e) => /bench press/i.test(e.name))).toBe(true);
    const bad = await t.api("GET", "/api/exercises?category=nope", undefined, { allowError: true });
    expect(bad.status).toBe(400);
  });
  it("manages custom exercises and locks built-ins", async () => {
    const created = await t.api<Exercise>("POST", "/api/exercises", { name: "Cable Pullover", category: "cable", bodyPart: "back" });
    expect(created.status).toBe(201);
    expect(created.data.isCustom).toBe(true);
    const dup = await t.api("POST", "/api/exercises", { name: "cable pullover", category: "cable", bodyPart: "back" }, { allowError: true });
    expect(dup.status).toBe(400);
    const renamed = await t.api<Exercise>("PATCH", `/api/exercises/${created.data.id}`, { name: "Cable Pullover (Rope)", instructions: "Keep arms straight." });
    expect(renamed.data.name).toBe("Cable Pullover (Rope)");
    const detail = await t.api<ExerciseDetail>("GET", `/api/exercises/${created.data.id}`);
    expect(detail.data.records).toEqual([]);
    expect(detail.data.history).toEqual([]);
    expect(detail.data.charts.oneRm).toEqual([]);
    await t.api("DELETE", `/api/exercises/${created.data.id}`);
    expect((await t.api("GET", `/api/exercises/${created.data.id}`, undefined, { allowError: true })).status).toBe(404);
    const builtin = await findExercise(t, "Pull Up");
    expect((await t.api("DELETE", `/api/exercises/${builtin.id}`, undefined, { allowError: true })).status).toBe(400);
    expect((await t.api("PATCH", `/api/exercises/${builtin.id}`, { name: "Pull Up 2" }, { allowError: true })).status).toBe(400);
    const ok = await t.api<Exercise>("PATCH", `/api/exercises/${builtin.id}`, { bodyPart: "arms" });
    expect(ok.data.bodyPart).toBe("arms");
    await t.api("PATCH", `/api/exercises/${builtin.id}`, { bodyPart: "back" });
  });
});

describe("templates", () => {
  it("creates, replaces keeping stable ids, patches, duplicates, reorders and deletes", async () => {
    const bench = await findExercise(t, "Bench Press (Barbell)");
    const row = await findExercise(t, "Bent Over Row (Barbell)");
    const curl = await findExercise(t, "Bicep Curl (Dumbbell)");
    const created = await t.api<WorkoutTemplate>("POST", "/api/templates", {
      name: "Push day",
      folder: "Strength",
      exercises: [
        { exerciseId: bench.id, restSeconds: 150, sets: [{ targetWeight: 60, targetReps: 5 }, { targetWeight: 60, targetReps: 5 }] },
        { exerciseId: row.id, sets: [{ targetWeight: 40, targetReps: 8 }] },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.data.exercises).toHaveLength(2);
    expect(created.data.exercises?.[0]?.exercise?.name).toBe("Bench Press (Barbell)");
    expect(created.data.exercises?.[0]?.sets?.[0]?.targetWeight).toBe(60);
    const benchRowId = created.data.exercises![0]!.id;
    const benchSetId = created.data.exercises![0]!.sets![0]!.id;
    const replaced = await t.api<WorkoutTemplate>("PUT", `/api/templates/${created.data.id}`, {
      name: "Push day",
      folder: "Strength",
      exercises: [
        { exerciseId: bench.id, sets: [{ targetWeight: 62.5, targetReps: 5 }, { targetWeight: 62.5, targetReps: 5 }, { setType: "drop", targetWeight: 40, targetReps: 10 }] },
        { exerciseId: curl.id, sets: [{ targetWeight: 12, targetReps: 12 }] },
      ],
    });
    expect(replaced.data.exercises?.[0]?.id).toBe(benchRowId);
    expect(replaced.data.exercises?.[0]?.sets?.[0]?.id).toBe(benchSetId);
    expect(replaced.data.exercises?.[0]?.sets).toHaveLength(3);
    expect(replaced.data.exercises?.[0]?.sets?.[2]?.setType).toBe("drop");
    expect(replaced.data.exercises?.[1]?.exerciseId).toBe(curl.id);
    expect(replaced.data.exercises?.[1]?.id).not.toBe(created.data.exercises?.[1]?.id);
    const patched = await t.api<WorkoutTemplate>("PATCH", `/api/templates/${created.data.id}`, { folder: null, notes: "Go heavy" });
    expect(patched.data.folder).toBeNull();
    expect(patched.data.notes).toBe("Go heavy");
    const copy = await t.api<WorkoutTemplate>("POST", `/api/templates/${created.data.id}/duplicate`);
    expect(copy.data.name).toBe("Push day (copy)");
    expect(copy.data.exercises?.map((e) => e.sets?.length)).toEqual([3, 1]);
    const reordered = await t.api<WorkoutTemplate[]>("POST", "/api/templates/reorder", { ids: [copy.data.id, created.data.id] });
    expect(reordered.data.slice(0, 2).map((x) => x.id)).toEqual([copy.data.id, created.data.id]);
    await t.api("DELETE", `/api/templates/${copy.data.id}`);
    expect((await t.api("GET", `/api/templates/${copy.data.id}`, undefined, { allowError: true })).status).toBe(404);
    const unknown = await t.api("POST", "/api/templates", { name: "Bad", exercises: [{ exerciseId: "nope" }] }, { allowError: true });
    expect(unknown.status).toBe(400);
  });
});

describe("workout lifecycle", () => {
  const w = makeTestApp();
  afterAll(() => w.cleanup());
  let bench: Exercise;
  let pullUp: Exercise;
  let squat: Exercise;
  let template: WorkoutTemplate;
  let first: Workout;
  let second: Workout;

  it("starts a workout from a template with sets copied and no previous the first time", async () => {
    bench = await findExercise(w, "Bench Press (Barbell)");
    pullUp = await findExercise(w, "Pull Up");
    squat = await findExercise(w, "Squat (Barbell)");
    template = (
      await w.api<WorkoutTemplate>("POST", "/api/templates", {
        name: "Test push",
        exercises: [
          { exerciseId: bench.id, restSeconds: 120, sets: [{ targetWeight: 60, targetReps: 5 }, { targetWeight: 60, targetReps: 5 }] },
          { exerciseId: pullUp.id, sets: [{ targetReps: 8 }] },
        ],
      })
    ).data;
    const started = await w.api<Workout>("POST", "/api/workouts/start", { templateId: template.id });
    expect(started.status).toBe(201);
    first = started.data;
    expect(first.status).toBe("active");
    expect(first.name).toBe("Test push");
    expect(first.templateName).toBe("Test push");
    const b = exerciseOf(first, bench.id);
    expect(b.sets).toHaveLength(2);
    expect(setAt(b, 0)).toMatchObject({ weight: 60, reps: 5, completed: false, prs: [] });
    expect(b.previous).toEqual([]);
    expect(b.restSeconds).toBe(120);
    expect(exerciseOf(first, pullUp.id).restSeconds).toBe(90);
    const active = await w.api<Workout>("GET", "/api/workouts/active");
    expect(active.data.id).toBe(first.id);
  });

  it("refuses a second active workout with 409 and returns the active one", async () => {
    const r = await w.api<{ error: string; details: { workout: Workout } }>("POST", "/api/workouts/start", {}, { allowError: true });
    expect(r.status).toBe(409);
    expect(r.data.details.workout.id).toBe(first.id);
  });

  it("computes live PR flags as sets are completed", async () => {
    const b = exerciseOf(first, bench.id);
    const s1 = await completeSet(w, setAt(b, 0).id, { weight: 100, reps: 5 });
    expect(s1.data.completed).toBe(true);
    expect(s1.data.completedAt).toBeTruthy();
    expect(s1.data.prs).toEqual(["weight", "one_rm", "volume"]);
    const s2 = await completeSet(w, setAt(b, 1).id, { weight: 100, reps: 5 });
    expect(s2.data.prs).toEqual([]);
    const s2b = await w.api<WorkoutSet>("PATCH", `/api/workout-sets/${s2.data.id}`, { weight: 105 });
    expect(s2b.data.prs).toEqual(["weight", "one_rm", "volume"]);
    const uncompleted = await w.api<WorkoutSet>("PATCH", `/api/workout-sets/${s2.data.id}`, { completed: false });
    expect(uncompleted.data.prs).toEqual([]);
    expect(uncompleted.data.completedAt).toBeNull();
    await completeSet(w, s2.data.id, { weight: 105, reps: 5 });
  });

  it("adds sets copying the last set, and warm-up sets never earn PRs", async () => {
    const b = exerciseOf(first, bench.id);
    const added = await w.api<WorkoutSet>("POST", `/api/workout-exercises/${b.id}/sets`);
    expect(added.status).toBe(201);
    expect(added.data).toMatchObject({ weight: 105, reps: 5, completed: false, sortOrder: 2 });
    const typed = await w.api<WorkoutSet>("POST", `/api/workout-sets/${added.data.id}/type`, { setType: "warmup" });
    expect(typed.data.setType).toBe("warmup");
    const done = await completeSet(w, added.data.id, { weight: 120, reps: 5 });
    expect(done.data.prs).toEqual([]);
    const p = await completeSet(w, setAt(exerciseOf(first, pullUp.id), 0).id, { reps: 10 });
    expect(p.data.prs).toEqual(["reps"]);
  });

  it("adds, edits, reorders and replaces exercises within the workout", async () => {
    const added = await w.api<WorkoutExercise>("POST", `/api/workouts/${first.id}/exercises`, { exerciseId: squat.id, supersetGroup: 1 });
    expect(added.status).toBe(201);
    expect(added.data.sets).toHaveLength(1);
    expect(added.data.previous).toEqual([]);
    expect(added.data.supersetGroup).toBe(1);
    const patched = await w.api<WorkoutExercise>("PATCH", `/api/workout-exercises/${added.data.id}`, { restSeconds: 180, notes: "Belt on", supersetGroup: null });
    expect(patched.data).toMatchObject({ restSeconds: 180, notes: "Belt on", supersetGroup: null });
    const reordered = await w.api<Workout>("POST", `/api/workouts/${first.id}/exercises/reorder`, { ids: [added.data.id] });
    expect(reordered.data.exercises?.[0]?.id).toBe(added.data.id);
    const deadlift = await findExercise(w, "Deadlift (Barbell)");
    const replaced = await w.api<WorkoutExercise>("POST", `/api/workout-exercises/${added.data.id}/replace`, { exerciseId: deadlift.id });
    expect(replaced.data.exerciseId).toBe(deadlift.id);
    expect(replaced.data.sets).toHaveLength(1);
    const extra = await w.api<WorkoutSet>("POST", `/api/workout-exercises/${added.data.id}/sets`);
    await w.api("PATCH", `/api/workout-sets/${extra.data.id}`, { weight: 140, reps: 3 });
    const renamed = await w.api<Workout>("PATCH", `/api/workouts/${first.id}`, { name: "Push A", notes: "Felt strong" });
    expect(renamed.data.name).toBe("Push A");
  });

  it("refuses to finish with incomplete sets unless they are discarded, then computes totals, PRs and updates template values", async () => {
    const refused = await w.api<{ details: { incompleteSets: number; emptySets: number } }>("POST", `/api/workouts/${first.id}/finish`, { discardIncomplete: false }, { allowError: true });
    expect(refused.status).toBe(409);
    expect(refused.data.details.incompleteSets).toBe(1);
    expect(refused.data.details.emptySets).toBe(1);
    const finished = await w.api<WorkoutFinishResult>("POST", `/api/workouts/${first.id}/finish`, { templateAction: "update_values" });
    const { workout, summary } = finished.data;
    expect(workout.status).toBe("completed");
    expect(workout.finishedAt).toBeTruthy();
    expect(workout.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(summary.totalVolume).toBe(1025);
    expect(summary.totalSets).toBe(4);
    expect(workout.totalVolume).toBe(1025);
    expect(workout.exercises?.map((e) => e.exerciseId)).toEqual([bench.id, pullUp.id]);
    expect(summary.prs).toHaveLength(7);
    const b0 = exerciseOf(workout, bench.id);
    const topSetPrs = summary.prs.filter((p) => p.workoutSetId === setAt(b0, 1).id);
    expect(topSetPrs.map((p) => `${p.exerciseName}:${p.type}:${p.value}`)).toEqual([`Bench Press (Barbell):weight:105`, `Bench Press (Barbell):one_rm:${Math.round(estimateOneRepMax(105, 5) * 100) / 100}`, "Bench Press (Barbell):volume:525"]);
    expect(summary.prs.at(-1)).toMatchObject({ exerciseName: "Pull Up", type: "reps", value: 10, reps: 10 });
    expect(workout.prCount).toBe(7);
    expect(summary.templateChanged).toBe(true);
    const b = exerciseOf(workout, bench.id);
    expect(setAt(b, 1).prs).toEqual(["weight", "one_rm", "volume"]);
    expect(setAt(b, 2).prs).toEqual([]);
    const tpl = await w.api<WorkoutTemplate>("GET", `/api/templates/${template.id}`);
    expect(tpl.data.lastPerformedAt).toBe(workout.finishedAt);
    expect(tpl.data.exercises?.map((e) => e.sets?.map((s) => s.targetWeight))).toEqual([[100, 105], [null]]);
    expect(tpl.data.exercises?.[1]?.sets?.[0]?.targetReps).toBe(10);
    expect(await w.api<Workout | null>("GET", "/api/workouts/active").then((r) => r.data)).toBeNull();
    const again = await w.api("POST", `/api/workouts/${first.id}/finish`, {}, { allowError: true });
    expect(again.status).toBe(409);
  });

  it("lists history with best sets and the exercise list carries last performed and record 1RM", async () => {
    const list = await w.api<WorkoutListItem[]>("GET", "/api/workouts");
    expect(list.data).toHaveLength(1);
    const item = list.data[0]!;
    expect(item.prCount).toBe(7);
    expect(item.exerciseSummary[0]?.prCount).toBe(6);
    expect(item.exerciseSummary.map((e) => e.name)).toEqual(["Bench Press (Barbell)", "Pull Up"]);
    expect(item.exerciseSummary[0]?.bestSet).toMatchObject({ weight: 105, reps: 5 });
    expect(item.exerciseSummary[0]?.setCount).toBe(2);
    expect(item.exerciseSummary[1]?.bestSet).toMatchObject({ reps: 10 });
    const exercises = await w.api<Exercise[]>("GET", "/api/exercises?q=Bench%20Press%20(Barbell)");
    const benchRow = exercises.data.find((e) => e.id === bench.id);
    expect(benchRow?.lastPerformedAt).toBe(first.finishedAt ?? benchRow?.lastPerformedAt);
    expect(benchRow?.recordOneRm).toBeCloseTo(estimateOneRepMax(105, 5), 1);
  });

  it("shows previous from the first workout and only flags new PRs when beaten; reps above 12 never count", async () => {
    second = (await w.api<Workout>("POST", "/api/workouts/start", { templateId: template.id })).data;
    const b = exerciseOf(second, bench.id);
    expect(b.previous).toEqual([
      { setType: "normal", weight: 100, reps: 5, seconds: null, distance: null },
      { setType: "normal", weight: 105, reps: 5, seconds: null, distance: null },
      { setType: "warmup", weight: 120, reps: 5, seconds: null, distance: null },
    ]);
    expect(setAt(b, 0).weight).toBe(100);
    expect(setAt(b, 1).weight).toBe(105);
    expect((await completeSet(w, setAt(b, 0).id, { weight: 100, reps: 5 })).data.prs).toEqual([]);
    expect((await completeSet(w, setAt(b, 1).id, { weight: 110, reps: 5 })).data.prs).toEqual(["weight", "one_rm", "volume"]);
    const heavy = await w.api<WorkoutSet>("POST", `/api/workout-exercises/${b.id}/sets`);
    expect((await completeSet(w, heavy.data.id, { weight: 115, reps: 13 })).data.prs).toEqual([]);
    expect((await completeSet(w, setAt(exerciseOf(second, pullUp.id), 0).id, { reps: 10 })).data.prs).toEqual([]);
    const running = await findExercise(w, "Running");
    const cardio = await w.api<WorkoutExercise>("POST", `/api/workouts/${second.id}/exercises`, { exerciseId: running.id });
    expect((await completeSet(w, setAt(cardio.data, 0).id, { distance: 5, seconds: 1500 })).data.prs).toEqual(["distance", "duration"]);
    const finished = await w.api<WorkoutFinishResult>("POST", `/api/workouts/${second.id}/finish`, { durationSeconds: 3600 });
    expect(finished.data.summary.durationSeconds).toBe(3600);
    expect(finished.data.workout.prCount).toBe(5);
    expect(finished.data.summary.prs).toHaveLength(5);
    expect(finished.data.summary.templateChanged).toBe(false);
    expect(finished.data.summary.totalVolume).toBe(500 + 550 + 115 * 13);
    second = finished.data.workout;
  });

  it("returns exercise detail with records, rep table, history and chart series", async () => {
    const detail = await w.api<ExerciseDetail>("GET", `/api/exercises/${bench.id}`);
    const byType = Object.fromEntries(detail.data.records.map((r) => [r.type, r]));
    expect(byType.weight?.value).toBe(110);
    expect(byType.weight?.workoutId).toBe(second.id);
    expect(byType.volume?.value).toBe(550);
    expect(byType.one_rm?.value).toBeCloseTo(estimateOneRepMax(110, 5), 1);
    expect(detail.data.bestByReps).toHaveLength(12);
    expect(detail.data.bestByReps[4]).toMatchObject({ reps: 5, best: 110 });
    expect(detail.data.bestByReps[0]?.predicted).toBeCloseTo(estimateOneRepMax(110, 5), 1);
    expect(detail.data.bestByReps[12 - 1]?.best).toBeNull();
    expect(detail.data.history.map((h) => h.workoutId)).toEqual([second.id, first.id]);
    expect(detail.data.history[0]?.sets.length).toBe(3);
    expect(detail.data.charts.maxWeight.map((p) => p.value)).toEqual([105, 115]);
    expect(detail.data.charts.volume.map((p) => p.value)).toEqual([1025, 500 + 550 + 115 * 13]);
    expect(detail.data.charts.oneRm).toHaveLength(2);
    expect(detail.data.charts.oneRm[0]?.date).toBe(todayString());
    expect(detail.data.workoutCount).toBe(2);
    const history = await w.api<ExerciseDetail["history"]>("GET", `/api/exercises/${bench.id}/history?limit=1&offset=1`);
    expect(history.data.map((h) => h.workoutId)).toEqual([first.id]);
    const running = await w.api<ExerciseDetail>("GET", `/api/exercises/${(await findExercise(w, "Running")).id}`);
    expect(running.data.records.map((r) => [r.type, r.value])).toEqual([
      ["distance", 5],
      ["duration", 1500],
    ]);
    expect(running.data.charts.distance[0]?.value).toBe(5);
    expect(running.data.bestByReps).toEqual([]);
  });

  it("reports stats and the calendar", async () => {
    const stats = await w.api<WorkoutStats>("GET", "/api/workouts/stats");
    expect(stats.data.thisWeek).toBe(2);
    expect(stats.data.lastWeek).toBe(0);
    expect(stats.data.weeklyTarget).toBe(4);
    expect(stats.data.streakWeeks).toBe(1);
    expect(stats.data.totalWorkouts).toBe(2);
    expect(stats.data.last?.id).toBe(second.id);
    expect(stats.data.volumeByWeek).toHaveLength(12);
    expect(stats.data.volumeByWeek[11]).toMatchObject({ count: 2, volume: 1025 + 500 + 550 + 115 * 13 });
    expect(stats.data.recentPrs.length).toBeGreaterThanOrEqual(5);
    expect(stats.data.recentPrs[0]?.exerciseName).toBeTruthy();
    const today = todayString();
    const cal = await w.api<WorkoutCalendarDay[]>("GET", `/api/workouts/calendar?from=${today}&to=${today}`);
    expect(cal.data).toHaveLength(1);
    expect(cal.data[0]?.workouts.map((x) => x.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("deleting a workout recomputes personal records", async () => {
    await w.api("DELETE", `/api/workouts/${second.id}`);
    expect((await w.api("GET", `/api/workouts/${second.id}`, undefined, { allowError: true })).status).toBe(404);
    const detail = await w.api<ExerciseDetail>("GET", `/api/exercises/${bench.id}`);
    const weight = detail.data.records.find((r) => r.type === "weight");
    expect(weight?.value).toBe(105);
    expect(weight?.workoutId).toBe(first.id);
    const running = await w.api<ExerciseDetail>("GET", `/api/exercises/${(await findExercise(w, "Running")).id}`);
    expect(running.data.records).toEqual([]);
    const list = await w.api<WorkoutListItem[]>("GET", "/api/workouts");
    expect(list.data.map((x) => x.id)).toEqual([first.id]);
    expect(list.data[0]?.prCount).toBe(7);
    const prs = w.ctx.db.select().from(schema.personalRecords).all();
    expect(prs.every((p) => p.workoutId === first.id)).toBe(true);
  });

  it("edits a past workout and replays records", async () => {
    const detailBefore = await w.api<Workout>("GET", `/api/workouts/${first.id}`);
    const top = setAt(exerciseOf(detailBefore.data, bench.id), 1);
    const edited = await w.api<WorkoutSet>("PATCH", `/api/workout-sets/${top.id}`, { weight: 107.5 });
    expect(edited.data.prs).toEqual(["weight", "one_rm", "volume"]);
    const detail = await w.api<ExerciseDetail>("GET", `/api/exercises/${bench.id}`);
    expect(detail.data.records.find((r) => r.type === "weight")?.value).toBe(107.5);
    const after = await w.api<Workout>("GET", `/api/workouts/${first.id}`);
    expect(after.data.totalVolume).toBe(500 + 537.5);
    await w.api("DELETE", `/api/workout-sets/${top.id}`);
    const detail2 = await w.api<ExerciseDetail>("GET", `/api/exercises/${bench.id}`);
    expect(detail2.data.records.find((r) => r.type === "weight")?.value).toBe(100);
    expect((await w.api<Workout>("GET", `/api/workouts/${first.id}`)).data.prCount).toBe(4);
  });

  it("names empty workouts by weekday and discards them cleanly", async () => {
    const started = await w.api<Workout>("POST", "/api/workouts/start", {});
    expect(started.data.name).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) Workout$/);
    expect(started.data.exercises).toEqual([]);
    expect(started.data.templateName).toBeNull();
    await w.api("POST", `/api/workouts/${started.data.id}/exercises`, { exerciseId: bench.id });
    const discarded = await w.api<Workout>("POST", `/api/workouts/${started.data.id}/discard`);
    expect(discarded.data.status).toBe("discarded");
    expect(discarded.data.exercises).toEqual([]);
    expect((await w.api<Workout | null>("GET", "/api/workouts/active")).data).toBeNull();
    expect((await w.api<WorkoutListItem[]>("GET", "/api/workouts")).data).toHaveLength(1);
  });
});

describe("template actions on finish", () => {
  const w = makeTestApp();
  afterAll(() => w.cleanup());

  it("saves an empty workout as a new template", async () => {
    const bench = await findExercise(w, "Bench Press (Barbell)");
    const started = await w.api<Workout>("POST", "/api/workouts/start", { name: "Quick bench" });
    const we = await w.api<WorkoutExercise>("POST", `/api/workouts/${started.data.id}/exercises`, { exerciseId: bench.id });
    await completeSet(w, setAt(we.data, 0).id, { weight: 50, reps: 8 });
    const finished = await w.api<WorkoutFinishResult>("POST", `/api/workouts/${started.data.id}/finish`, { templateAction: "save_as_template", newTemplateName: "Bench only", newTemplateFolder: "Quick" });
    expect(finished.data.summary.templateChanged).toBe(true);
    const tpl = await w.api<WorkoutTemplate>("GET", `/api/templates/${finished.data.summary.templateId}`);
    expect(tpl.data.name).toBe("Bench only");
    expect(tpl.data.folder).toBe("Quick");
    expect(tpl.data.lastPerformedAt).toBe(finished.data.workout.finishedAt);
    expect(tpl.data.exercises?.[0]?.sets?.[0]).toMatchObject({ targetWeight: 50, targetReps: 8 });
    const bad = await w.api("POST", "/api/workouts/start", {});
    const refused = await w.api("POST", `/api/workouts/${(bad.data as Workout).id}/finish`, { templateAction: "update_template" }, { allowError: true });
    expect(refused.status).toBe(400);
    await w.api("POST", `/api/workouts/${(bad.data as Workout).id}/discard`);
  });

  it("update_template changes structure but keeps old targets; update_both copies everything", async () => {
    const squat = await findExercise(w, "Squat (Barbell)");
    const legPress = await findExercise(w, "Leg Press (Machine)");
    const template = (await w.api<WorkoutTemplate>("POST", "/api/templates", { name: "Legs test", exercises: [{ exerciseId: squat.id, sets: [{ targetWeight: 80, targetReps: 5 }, { targetWeight: 80, targetReps: 5 }] }] })).data;
    const started = (await w.api<Workout>("POST", "/api/workouts/start", { templateId: template.id })).data;
    const sq = exerciseOf(started, squat.id);
    await completeSet(w, setAt(sq, 0).id, { weight: 100, reps: 5 });
    await completeSet(w, setAt(sq, 1).id, { weight: 100, reps: 5 });
    const third = await w.api<WorkoutSet>("POST", `/api/workout-exercises/${sq.id}/sets`);
    await completeSet(w, third.data.id, { weight: 100, reps: 5 });
    const lp = await w.api<WorkoutExercise>("POST", `/api/workouts/${started.id}/exercises`, { exerciseId: legPress.id });
    await completeSet(w, setAt(lp.data, 0).id, { weight: 200, reps: 10 });
    const finished = await w.api<WorkoutFinishResult>("POST", `/api/workouts/${started.id}/finish`, { templateAction: "update_template" });
    expect(finished.data.summary.templateChanged).toBe(true);
    const updated = await w.api<WorkoutTemplate>("GET", `/api/templates/${template.id}`);
    expect(updated.data.exercises?.map((e) => e.exerciseId)).toEqual([squat.id, legPress.id]);
    expect(updated.data.exercises?.[0]?.sets?.map((s) => s.targetWeight)).toEqual([80, 80, 100]);
    expect(updated.data.exercises?.[1]?.sets?.[0]).toMatchObject({ targetWeight: 200, targetReps: 10 });

    const again = (await w.api<Workout>("POST", "/api/workouts/start", { templateId: template.id })).data;
    const sq2 = exerciseOf(again, squat.id);
    expect(sq2.previous).toHaveLength(3);
    await completeSet(w, setAt(sq2, 0).id, { weight: 110, reps: 3 });
    await w.api("DELETE", `/api/workout-sets/${setAt(sq2, 1).id}`);
    await w.api("DELETE", `/api/workout-sets/${setAt(sq2, 2).id}`);
    await w.api("DELETE", `/api/workout-exercises/${exerciseOf(again, legPress.id).id}`);
    const both = await w.api<WorkoutFinishResult>("POST", `/api/workouts/${again.id}/finish`, { templateAction: "update_both" });
    expect(both.data.summary.prs.map((p) => p.type)).toEqual(["weight", "one_rm"]);
    const final = await w.api<WorkoutTemplate>("GET", `/api/templates/${template.id}`);
    expect(final.data.exercises).toHaveLength(1);
    expect(final.data.exercises?.[0]?.sets?.map((s) => [s.targetWeight, s.targetReps])).toEqual([[110, 3]]);
  });

  it("stores and applies workout settings such as counting dumbbells twice", async () => {
    const defaults = await w.api<{ countDumbbellsTwice: boolean; oneRmFormula: string }>("GET", "/api/workouts/settings");
    // Dumbbell weight is per hand, so both hands count by default.
    expect(defaults.data).toMatchObject({ countDumbbellsTwice: true, oneRmFormula: "hybrid" });
    const curl = await findExercise(w, "Bicep Curl (Dumbbell)");
    const started = (await w.api<Workout>("POST", "/api/workouts/start", { name: "Arms" })).data;
    const we = await w.api<WorkoutExercise>("POST", `/api/workouts/${started.id}/exercises`, { exerciseId: curl.id });
    await completeSet(w, setAt(we.data, 0).id, { weight: 12, reps: 10 });
    const finished = await w.api<WorkoutFinishResult>("POST", `/api/workouts/${started.id}/finish`, {});
    expect(finished.data.summary.totalVolume).toBe(240);
    await w.api("PATCH", "/api/workouts/settings", { countDumbbellsTwice: false });
    const again = (await w.api<Workout>("POST", "/api/workouts/start", { name: "Arms 2" })).data;
    const we2 = await w.api<WorkoutExercise>("POST", `/api/workouts/${again.id}/exercises`, { exerciseId: curl.id });
    await completeSet(w, setAt(we2.data, 0).id, { weight: 12, reps: 10 });
    const finished2 = await w.api<WorkoutFinishResult>("POST", `/api/workouts/${again.id}/finish`, {});
    expect(finished2.data.summary.totalVolume).toBe(120);
    await w.api("PATCH", "/api/workouts/settings", { countDumbbellsTwice: true });
  });
});

describe("exercise tracking type", () => {
  it("lets a built-in exercise change its tracking type but not its name", async () => {
    const t = makeTestApp();
    const list = await t.api<{ id: string; name: string; category: string; isCustom: boolean }[]>("GET", "/api/exercises?q=plank");
    const plank = list.data.find((e) => e.name === "Plank")!;
    expect(plank.category).toBe("duration");
    const changed = await t.api<{ category: string }>("PATCH", `/api/exercises/${plank.id}`, { category: "weighted_bodyweight" });
    expect(changed.data.category).toBe("weighted_bodyweight");
    const renamed = await t.api("PATCH", `/api/exercises/${plank.id}`, { name: "Board" }, { allowError: true });
    expect(renamed.status).toBe(400);
    t.cleanup();
  });
});
