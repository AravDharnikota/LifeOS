import { count } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId } from "../lib/ids.ts";

// TODO: expanded in the workouts step
export const EXERCISE_LIBRARY: { name: string; category: string; bodyPart: string }[] = [
  { name: "Bench Press (Barbell)", category: "barbell", bodyPart: "chest" },
  { name: "Squat (Barbell)", category: "barbell", bodyPart: "legs" },
  { name: "Deadlift (Barbell)", category: "barbell", bodyPart: "back" },
  { name: "Overhead Press (Barbell)", category: "barbell", bodyPart: "shoulders" },
  { name: "Pull Up", category: "bodyweight", bodyPart: "back" },
];

export function seedExercises(db: Db): void {
  const n = db.select({ n: count() }).from(schema.exercises).get()?.n ?? 0;
  if (n > 0) return;
  db.insert(schema.exercises).values(EXERCISE_LIBRARY.map((e) => ({ id: newId(), name: e.name, category: e.category, bodyPart: e.bodyPart, isCustom: false }))).run();
}
