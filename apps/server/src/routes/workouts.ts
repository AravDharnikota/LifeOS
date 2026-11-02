import { z } from "zod";
import { BodyPart, ExerciseCategory, ExerciseCreate, ExerciseUpdate, SetType, TemplatePatch, WorkoutExerciseAdd, WorkoutExerciseUpdate, WorkoutFinish, WorkoutSetInput, WorkoutSettings, WorkoutStart, WorkoutTemplateInput, WorkoutUpdate, isoDate, todayString, addDaysString } from "@aravos/shared";
import type { App } from "../app.ts";
import { parseBody, parseQuery } from "../lib/http.ts";
import {
  addWorkoutExercise,
  addWorkoutSet,
  createExercise,
  createTemplate,
  deleteExercise,
  deleteTemplate,
  deleteWorkout,
  deleteWorkoutSet,
  discardWorkout,
  duplicateTemplate,
  exerciseHistory,
  finishWorkout,
  getActiveWorkout,
  getExerciseDetail,
  getTemplate,
  getWorkout,
  getWorkoutSettings,
  listExercises,
  listTemplates,
  listWorkouts,
  patchTemplate,
  removeWorkoutExercise,
  reorderTemplates,
  reorderWorkoutExercises,
  replaceTemplate,
  replaceWorkoutExercise,
  setWorkoutSetType,
  startWorkout,
  updateExercise,
  updateWorkout,
  updateWorkoutExercise,
  updateWorkoutSet,
  updateWorkoutSettings,
  workoutCalendar,
  workoutStats,
} from "../services/workouts.ts";

const ExerciseQuery = z.object({ q: z.string().max(120).optional(), bodyPart: BodyPart.optional(), category: ExerciseCategory.optional() });
const PageQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional() });
const CalendarQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const Ids = z.object({ ids: z.array(z.string().min(1)).max(500) });
const ExerciseRef = z.object({ exerciseId: z.string().min(1) });

export function workoutsRoutes(app: App): void {
  // exercises
  app.get("/api/exercises", (c) => c.json(listExercises(c.get("ctx").db, parseQuery(c, ExerciseQuery))));
  app.post("/api/exercises", async (c) => c.json(createExercise(c.get("ctx").db, await parseBody(c, ExerciseCreate), c.get("actor")), 201));
  app.get("/api/exercises/:id", (c) => c.json(getExerciseDetail(c.get("ctx").db, c.req.param("id"))));
  app.get("/api/exercises/:id/history", (c) => {
    const q = parseQuery(c, PageQuery);
    return c.json(exerciseHistory(c.get("ctx").db, c.req.param("id"), { limit: q.limit, offset: q.offset }));
  });
  app.patch("/api/exercises/:id", async (c) => c.json(updateExercise(c.get("ctx").db, c.req.param("id"), await parseBody(c, ExerciseUpdate), c.get("actor"))));
  app.delete("/api/exercises/:id", (c) => {
    deleteExercise(c.get("ctx").db, c.req.param("id"), c.get("actor"));
    return c.json({ ok: true });
  });

  // templates
  app.get("/api/templates", (c) => c.json(listTemplates(c.get("ctx").db)));
  app.post("/api/templates", async (c) => c.json(createTemplate(c.get("ctx").db, await parseBody(c, WorkoutTemplateInput), c.get("actor")), 201));
  app.post("/api/templates/reorder", async (c) => c.json(reorderTemplates(c.get("ctx").db, (await parseBody(c, Ids)).ids)));
  app.get("/api/templates/:id", (c) => c.json(getTemplate(c.get("ctx").db, c.req.param("id"))));
  app.put("/api/templates/:id", async (c) => c.json(replaceTemplate(c.get("ctx").db, c.req.param("id"), await parseBody(c, WorkoutTemplateInput), c.get("actor"))));
  app.patch("/api/templates/:id", async (c) => c.json(patchTemplate(c.get("ctx").db, c.req.param("id"), await parseBody(c, TemplatePatch), c.get("actor"))));
  app.delete("/api/templates/:id", (c) => {
    deleteTemplate(c.get("ctx").db, c.req.param("id"), c.get("actor"));
    return c.json({ ok: true });
  });
  app.post("/api/templates/:id/duplicate", (c) => c.json(duplicateTemplate(c.get("ctx").db, c.req.param("id"), c.get("actor")), 201));

  // workouts (static paths before /:id)
  app.get("/api/workouts/settings", (c) => c.json(getWorkoutSettings(c.get("ctx").db)));
  app.patch("/api/workouts/settings", async (c) => c.json(updateWorkoutSettings(c.get("ctx").db, await parseBody(c, WorkoutSettings.partial()))));
  app.post("/api/workouts/start", async (c) => c.json(startWorkout(c.get("ctx").db, await parseBody(c, WorkoutStart), c.get("actor")), 201));
  app.get("/api/workouts/active", (c) => c.json(getActiveWorkout(c.get("ctx").db)));
  app.get("/api/workouts/stats", (c) => c.json(workoutStats(c.get("ctx").db)));
  app.get("/api/workouts/calendar", (c) => {
    const q = parseQuery(c, CalendarQuery);
    const today = todayString();
    return c.json(workoutCalendar(c.get("ctx").db, q.from ?? addDaysString(today, -90), q.to ?? today));
  });
  app.get("/api/workouts", (c) => {
    const q = parseQuery(c, PageQuery);
    return c.json(listWorkouts(c.get("ctx").db, { limit: q.limit, offset: q.offset }));
  });
  app.get("/api/workouts/:id", (c) => c.json(getWorkout(c.get("ctx").db, c.req.param("id"))));
  app.patch("/api/workouts/:id", async (c) => c.json(updateWorkout(c.get("ctx").db, c.req.param("id"), await parseBody(c, WorkoutUpdate), c.get("actor"))));
  app.delete("/api/workouts/:id", (c) => {
    deleteWorkout(c.get("ctx").db, c.req.param("id"), c.get("actor"));
    return c.json({ ok: true });
  });
  app.post("/api/workouts/:id/discard", (c) => c.json(discardWorkout(c.get("ctx").db, c.req.param("id"), c.get("actor"))));
  app.post("/api/workouts/:id/finish", async (c) => c.json(finishWorkout(c.get("ctx").db, c.req.param("id"), await parseBody(c, WorkoutFinish), c.get("actor"))));
  app.post("/api/workouts/:id/exercises", async (c) => c.json(addWorkoutExercise(c.get("ctx").db, c.req.param("id"), await parseBody(c, WorkoutExerciseAdd)), 201));
  app.post("/api/workouts/:id/exercises/reorder", async (c) => c.json(reorderWorkoutExercises(c.get("ctx").db, c.req.param("id"), (await parseBody(c, Ids)).ids)));

  // exercises within a workout
  app.patch("/api/workout-exercises/:id", async (c) => c.json(updateWorkoutExercise(c.get("ctx").db, c.req.param("id"), await parseBody(c, WorkoutExerciseUpdate))));
  app.delete("/api/workout-exercises/:id", (c) => {
    removeWorkoutExercise(c.get("ctx").db, c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/workout-exercises/:id/replace", async (c) => c.json(replaceWorkoutExercise(c.get("ctx").db, c.req.param("id"), (await parseBody(c, ExerciseRef)).exerciseId)));
  app.post("/api/workout-exercises/:id/sets", (c) => c.json(addWorkoutSet(c.get("ctx").db, c.req.param("id")), 201));

  // sets
  app.patch("/api/workout-sets/:id", async (c) => c.json(updateWorkoutSet(c.get("ctx").db, c.req.param("id"), await parseBody(c, WorkoutSetInput))));
  app.delete("/api/workout-sets/:id", (c) => {
    deleteWorkoutSet(c.get("ctx").db, c.req.param("id"));
    return c.json({ ok: true });
  });
  app.post("/api/workout-sets/:id/type", async (c) => c.json(setWorkoutSetType(c.get("ctx").db, c.req.param("id"), (await parseBody(c, z.object({ setType: SetType }))).setType)));
}
