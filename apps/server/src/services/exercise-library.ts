import { inArray } from "drizzle-orm";
import type { Exercise, ExerciseCategory, SetType } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId } from "../lib/ids.ts";

type BodyPart = Exercise["bodyPart"];

export interface LibraryExercise {
  name: string;
  category: ExerciseCategory;
  bodyPart: BodyPart;
}

type Cat = ExerciseCategory;
const def = (category: Cat, bodyPart: BodyPart, names: string[]): LibraryExercise[] => names.map((name) => ({ name, category, bodyPart }));

// Names follow Strong's "Name (Equipment)" convention. Weights are logged in kilograms.
export const EXERCISE_LIBRARY: LibraryExercise[] = [
  // chest
  ...def("barbell", "chest", ["Bench Press (Barbell)", "Incline Bench Press (Barbell)", "Decline Bench Press (Barbell)", "Floor Press (Barbell)", "Landmine Press (Barbell)"]),
  ...def("dumbbell", "chest", ["Bench Press (Dumbbell)", "Incline Bench Press (Dumbbell)", "Decline Bench Press (Dumbbell)", "Chest Fly (Dumbbell)", "Incline Chest Fly (Dumbbell)", "Pullover (Dumbbell)", "Floor Press (Dumbbell)", "Squeeze Press (Dumbbell)"]),
  ...def("machine", "chest", ["Bench Press (Smith Machine)", "Incline Bench Press (Smith Machine)", "Chest Press (Machine)", "Incline Chest Press (Machine)", "Chest Fly (Machine)", "Pec Deck (Machine)"]),
  ...def("cable", "chest", ["Cable Crossover", "Low Cable Crossover", "Chest Fly (Cable)", "Bench Press (Cable)"]),
  ...def("bodyweight", "chest", ["Push Up", "Incline Push Up", "Decline Push Up", "Diamond Push Up", "Wide Push Up", "Archer Push Up"]),
  ...def("weighted_bodyweight", "chest", ["Push Up (Weighted)", "Chest Dip"]),
  ...def("assisted_bodyweight", "chest", ["Chest Dip (Assisted)"]),
  // back
  ...def("barbell", "back", ["Deadlift (Barbell)", "Sumo Deadlift (Barbell)", "Deadlift (Trap Bar)", "Rack Pull (Barbell)", "Bent Over Row (Barbell)", "Pendlay Row (Barbell)", "T Bar Row (Barbell)", "Meadows Row (Barbell)", "Seal Row (Barbell)", "Good Morning (Barbell)", "Shrug (Barbell)", "Yates Row (Barbell)"]),
  ...def("dumbbell", "back", ["Deadlift (Dumbbell)", "Bent Over Row (Dumbbell)", "Bent Over One Arm Row (Dumbbell)", "Incline Row (Dumbbell)", "Shrug (Dumbbell)", "Kroc Row (Dumbbell)"]),
  ...def("machine", "back", ["Seated Row (Machine)", "Chest Supported Row (Machine)", "Lat Pulldown (Machine)", "Back Extension (Machine)", "Shrug (Machine)", "Row (Smith Machine)", "Iso Lateral Row (Machine)", "High Row (Machine)"]),
  ...def("cable", "back", ["Seated Row (Cable)", "Lat Pulldown (Cable)", "Lat Pulldown - Underhand (Cable)", "Lat Pulldown - Wide Grip (Cable)", "Lat Pulldown - Close Grip (Cable)", "Straight Arm Pulldown (Cable)", "Single Arm Row (Cable)", "Rope Pulldown (Cable)", "Shrug (Cable)"]),
  ...def("bodyweight", "back", ["Pull Up", "Chin Up", "Inverted Row (Bodyweight)", "Back Extension", "Neutral Grip Pull Up", "Wide Grip Pull Up"]),
  ...def("weighted_bodyweight", "back", ["Pull Up (Weighted)", "Chin Up (Weighted)"]),
  ...def("assisted_bodyweight", "back", ["Pull Up (Assisted)", "Chin Up (Assisted)"]),
  ...def("reps_only", "back", ["Kneeling Pulldown (Band)", "Row (Band)", "Pull Apart (Band)"]),
  // legs
  ...def("barbell", "legs", ["Squat (Barbell)", "Front Squat (Barbell)", "Box Squat (Barbell)", "Pause Squat (Barbell)", "Zercher Squat (Barbell)", "Hack Squat (Barbell)", "Romanian Deadlift (Barbell)", "Stiff Leg Deadlift (Barbell)", "Lunge (Barbell)", "Bulgarian Split Squat (Barbell)", "Step Up (Barbell)", "Hip Thrust (Barbell)", "Standing Calf Raise (Barbell)", "Glute Bridge (Barbell)", "Overhead Squat (Barbell)"]),
  ...def("dumbbell", "legs", ["Squat (Dumbbell)", "Goblet Squat (Dumbbell)", "Sumo Squat (Dumbbell)", "Romanian Deadlift (Dumbbell)", "Lunge (Dumbbell)", "Walking Lunge (Dumbbell)", "Reverse Lunge (Dumbbell)", "Bulgarian Split Squat (Dumbbell)", "Step Up (Dumbbell)", "Standing Calf Raise (Dumbbell)", "Single Leg Romanian Deadlift (Dumbbell)", "Hip Thrust (Dumbbell)"]),
  ...def("machine", "legs", ["Squat (Smith Machine)", "Hack Squat (Machine)", "Leg Press (Machine)", "Single Leg Press (Machine)", "Leg Extension (Machine)", "Lying Leg Curl (Machine)", "Seated Leg Curl (Machine)", "Standing Leg Curl (Machine)", "Hip Thrust (Machine)", "Glute Kickback (Machine)", "Hip Abduction (Machine)", "Hip Adduction (Machine)", "Standing Calf Raise (Machine)", "Standing Calf Raise (Smith Machine)", "Seated Calf Raise (Machine)", "Calf Press (Machine)", "Donkey Calf Raise (Machine)", "Pendulum Squat (Machine)", "Belt Squat (Machine)", "Goblet Squat (Kettlebell)", "Romanian Deadlift (Smith Machine)"]),
  ...def("cable", "legs", ["Glute Kickback (Cable)", "Hip Abduction (Cable)", "Pull Through (Cable)", "Hip Adduction (Cable)"]),
  ...def("bodyweight", "legs", ["Squat (Bodyweight)", "Lunge (Bodyweight)", "Split Squat (Bodyweight)", "Hip Thrust (Bodyweight)", "Glute Bridge (Bodyweight)", "Standing Calf Raise (Bodyweight)", "Nordic Hamstring Curl", "Sissy Squat", "Pistol Squat", "Jump Squat", "Single Leg Glute Bridge"]),
  ...def("reps_only", "legs", ["Box Jump", "Broad Jump", "Lateral Walk (Band)"]),
  ...def("duration", "legs", ["Wall Sit"]),
  // shoulders
  ...def("barbell", "shoulders", ["Overhead Press (Barbell)", "Seated Overhead Press (Barbell)", "Push Press (Barbell)", "Behind the Neck Press (Barbell)", "Upright Row (Barbell)", "Front Raise (Barbell)", "Z Press (Barbell)"]),
  ...def("dumbbell", "shoulders", ["Overhead Press (Dumbbell)", "Seated Overhead Press (Dumbbell)", "Arnold Press (Dumbbell)", "Lateral Raise (Dumbbell)", "Front Raise (Dumbbell)", "Reverse Fly (Dumbbell)", "Upright Row (Dumbbell)", "Cuban Press (Dumbbell)", "Y Raise (Dumbbell)", "Seated Lateral Raise (Dumbbell)"]),
  ...def("machine", "shoulders", ["Shoulder Press (Machine)", "Shoulder Press (Smith Machine)", "Lateral Raise (Machine)", "Reverse Fly (Machine)", "Front Raise (Plate)", "Rear Delt Fly (Machine)"]),
  ...def("cable", "shoulders", ["Lateral Raise (Cable)", "Front Raise (Cable)", "Reverse Fly (Cable)", "Face Pull (Cable)", "Upright Row (Cable)", "External Rotation (Cable)", "Internal Rotation (Cable)", "Rear Delt Row (Cable)"]),
  ...def("bodyweight", "shoulders", ["Handstand Push Up", "Pike Push Up"]),
  ...def("reps_only", "shoulders", ["Face Pull (Band)", "Lateral Raise (Band)", "External Rotation (Band)"]),
  // arms
  ...def("barbell", "arms", ["Bicep Curl (Barbell)", "Bicep Curl (EZ Bar)", "Preacher Curl (Barbell)", "Drag Curl (Barbell)", "Reverse Curl (Barbell)", "Wrist Curl (Barbell)", "Reverse Wrist Curl (Barbell)", "Close Grip Bench Press (Barbell)", "Skullcrusher (Barbell)", "JM Press (Barbell)", "Lying Triceps Extension (EZ Bar)", "Overhead Triceps Extension (Barbell)"]),
  ...def("dumbbell", "arms", ["Bicep Curl (Dumbbell)", "Hammer Curl (Dumbbell)", "Preacher Curl (Dumbbell)", "Incline Curl (Dumbbell)", "Concentration Curl (Dumbbell)", "Spider Curl (Dumbbell)", "Zottman Curl (Dumbbell)", "Reverse Curl (Dumbbell)", "Wrist Curl (Dumbbell)", "Skullcrusher (Dumbbell)", "Overhead Triceps Extension (Dumbbell)", "Triceps Kickback (Dumbbell)", "Tate Press (Dumbbell)"]),
  ...def("machine", "arms", ["Bicep Curl (Machine)", "Preacher Curl (Machine)", "Triceps Extension (Machine)", "Triceps Dip (Machine)", "Wrist Roller", "Close Grip Bench Press (Smith Machine)"]),
  ...def("cable", "arms", ["Bicep Curl (Cable)", "Hammer Curl (Cable)", "Reverse Curl (Cable)", "Overhead Curl (Cable)", "Triceps Pushdown (Cable)", "Triceps Rope Pushdown (Cable)", "Overhead Triceps Extension (Cable)", "Triceps Kickback (Cable)", "Single Arm Triceps Pushdown (Cable)", "Wrist Curl (Cable)"]),
  ...def("bodyweight", "arms", ["Bench Dip", "Close Grip Push Up"]),
  ...def("weighted_bodyweight", "arms", ["Triceps Dip"]),
  ...def("assisted_bodyweight", "arms", ["Triceps Dip (Assisted)"]),
  ...def("reps_only", "arms", ["Bicep Curl (Band)", "Hammer Curl (Band)", "Triceps Pushdown (Band)"]),
  // core
  ...def("bodyweight", "core", ["Crunch", "Sit Up", "Decline Crunch", "Decline Sit Up", "Flat Leg Raise", "Hanging Leg Raise", "Hanging Knee Raise", "Ab Wheel", "Russian Twist", "Bicycle Crunch", "Mountain Climber", "Dead Bug", "Bird Dog", "Dragon Flag", "Toes to Bar", "V Up", "Reverse Crunch", "Oblique Crunch", "Superman", "Flutter Kick", "Lying Leg Raise", "Knee Raise (Captain's Chair)"]),
  ...def("weighted_bodyweight", "core", ["Sit Up (Weighted)", "Russian Twist (Weighted)", "Decline Crunch (Weighted)"]),
  ...def("machine", "core", ["Crunch (Machine)", "Torso Rotation (Machine)", "Ab Coaster (Machine)"]),
  ...def("cable", "core", ["Cable Crunch", "Cable Woodchop", "Pallof Press (Cable)", "Kneeling Cable Crunch"]),
  ...def("dumbbell", "core", ["Side Bend (Dumbbell)", "Weighted Plank Row (Dumbbell)"]),
  ...def("duration", "core", ["Plank", "Side Plank", "Hollow Hold", "L Sit Hold", "Dead Hang"]),
  // full body and olympic
  ...def("barbell", "full_body", ["Clean (Barbell)", "Clean and Jerk (Barbell)", "Power Clean (Barbell)", "Hang Clean (Barbell)", "Snatch (Barbell)", "Power Snatch (Barbell)", "Hang Snatch (Barbell)", "Clean Pull (Barbell)", "Snatch Pull (Barbell)", "Thruster (Barbell)", "Split Jerk (Barbell)", "Push Jerk (Barbell)"]),
  ...def("dumbbell", "full_body", ["Thruster (Dumbbell)", "Man Maker (Dumbbell)", "Devils Press (Dumbbell)", "Farmers Walk (Dumbbell)", "Suitcase Carry (Dumbbell)", "Snatch (Dumbbell)", "Clean and Press (Dumbbell)"]),
  ...def("machine", "full_body", ["Kettlebell Swing", "Turkish Get Up (Kettlebell)", "Sled Push", "Sled Pull", "Clean and Press (Kettlebell)", "Farmers Walk (Trap Bar)"]),
  ...def("bodyweight", "full_body", ["Burpee", "Muscle Up", "Bear Crawl"]),
  ...def("reps_only", "full_body", ["Wall Ball", "Tire Flip", "Jumping Jack", "Medicine Ball Slam", "Rope Climb"]),
  ...def("duration", "full_body", ["Battle Ropes"]),
  // cardio
  ...def("cardio", "cardio", ["Running", "Running (Treadmill)", "Walking", "Hiking", "Cycling", "Cycling (Stationary)", "Rowing (Machine)", "Elliptical Trainer", "Stair Machine", "Swimming", "Jump Rope", "Ski Erg (Machine)", "Air Bike", "Sprint", "Skating", "Kayaking"]),
  ...def("duration", "cardio", ["Boxing", "Kickboxing", "Dancing", "Climbing", "Sports (General)"]),
  // other
  ...def("duration", "other", ["Stretching", "Yoga", "Foam Rolling", "Mobility", "Sauna", "Cold Plunge"]),
  ...def("machine", "other", ["Neck Curl (Machine)", "Neck Extension (Machine)", "Grip Trainer"]),
  ...def("dumbbell", "other", ["Neck Curl (Plate)", "Neck Extension (Plate)"]),
];

interface TemplateSetSeed {
  setType?: SetType;
  reps?: number;
  seconds?: number;
}
interface TemplateExerciseSeed {
  exercise: string;
  sets: TemplateSetSeed[];
  restSeconds?: number;
}
interface TemplateSeed {
  name: string;
  folder: string;
  notes?: string;
  exercises: TemplateExerciseSeed[];
}

const reps = (count: number, n: number, restSeconds?: number) => ({ sets: Array.from({ length: count }, () => ({ reps: n })), restSeconds });
const ex = (exercise: string, count: number, n: number, restSeconds?: number): TemplateExerciseSeed => ({ exercise, ...reps(count, n, restSeconds) });

export const EXAMPLE_TEMPLATES_FOLDER = "Example Templates";

export const EXAMPLE_TEMPLATES: TemplateSeed[] = [
  { name: "Strong 5x5 - Workout A", folder: EXAMPLE_TEMPLATES_FOLDER, notes: "Alternate with Workout B. Add 2.5 kg each session.", exercises: [ex("Squat (Barbell)", 5, 5, 180), ex("Bench Press (Barbell)", 5, 5, 180), ex("Bent Over Row (Barbell)", 5, 5, 180)] },
  { name: "Strong 5x5 - Workout B", folder: EXAMPLE_TEMPLATES_FOLDER, notes: "Alternate with Workout A. Add 2.5 kg each session.", exercises: [ex("Squat (Barbell)", 5, 5, 180), ex("Overhead Press (Barbell)", 5, 5, 180), ex("Deadlift (Barbell)", 1, 5, 180)] },
  { name: "Legs", folder: EXAMPLE_TEMPLATES_FOLDER, exercises: [ex("Squat (Barbell)", 3, 8, 150), ex("Leg Extension (Machine)", 3, 12, 90), ex("Flat Leg Raise", 3, 15, 60), ex("Standing Calf Raise (Dumbbell)", 3, 12, 60)] },
  { name: "Back and Biceps", folder: EXAMPLE_TEMPLATES_FOLDER, exercises: [ex("Deadlift (Barbell)", 3, 5, 180), ex("Seated Row (Cable)", 3, 10, 90), ex("Lat Pulldown (Cable)", 3, 10, 90), ex("Bicep Curl (Barbell)", 3, 10, 60)] },
  { name: "Chest and Triceps", folder: EXAMPLE_TEMPLATES_FOLDER, exercises: [ex("Bench Press (Barbell)", 3, 8, 150), ex("Incline Bench Press (Dumbbell)", 3, 10, 90), ex("Chest Fly (Dumbbell)", 3, 12, 60), ex("Triceps Pushdown (Cable)", 3, 12, 60), ex("Skullcrusher (Barbell)", 3, 10, 60)] },
];

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Adds any library exercises missing by name. Never touches custom or deleted exercises. */
function seedLibrary(db: Db): void {
  const existing = new Set(db.select({ name: schema.exercises.name }).from(schema.exercises).all().map((r) => r.name));
  const missing = EXERCISE_LIBRARY.filter((e) => !existing.has(e.name));
  for (const batch of chunk(missing, 100)) {
    db.insert(schema.exercises).values(batch.map((e) => ({ id: newId(), name: e.name, category: e.category, bodyPart: e.bodyPart, isCustom: false }))).run();
  }
}

/** Creates the example templates once; a template the user deleted or renamed is not recreated. */
function seedExampleTemplates(db: Db): void {
  const existing = new Set(db.select({ name: schema.workoutTemplates.name }).from(schema.workoutTemplates).all().map((r) => r.name));
  const missing = EXAMPLE_TEMPLATES.filter((t) => !existing.has(t.name));
  if (missing.length === 0) return;
  const names = Array.from(new Set(missing.flatMap((t) => t.exercises.map((e) => e.exercise))));
  const byName = new Map(db.select().from(schema.exercises).where(inArray(schema.exercises.name, names)).all().map((r) => [r.name, r.id]));
  let sortOrder = db.select({ n: schema.workoutTemplates.sortOrder }).from(schema.workoutTemplates).all().reduce((m, r) => Math.max(m, r.n), -1);
  for (const t of missing) {
    const templateId = newId();
    sortOrder += 1;
    db.insert(schema.workoutTemplates).values({ id: templateId, name: t.name, notes: t.notes ?? null, folder: t.folder, sortOrder }).run();
    t.exercises.forEach((e, i) => {
      const exerciseId = byName.get(e.exercise);
      if (!exerciseId) return;
      const templateExerciseId = newId();
      db.insert(schema.templateExercises).values({ id: templateExerciseId, templateId, exerciseId, sortOrder: i, restSeconds: e.restSeconds ?? null }).run();
      db.insert(schema.templateSets)
        .values(e.sets.map((s, j) => ({ id: newId(), templateExerciseId, sortOrder: j, setType: s.setType ?? "normal", targetReps: s.reps ?? null, targetSeconds: s.seconds ?? null })))
        .run();
    });
  }
}

/** Idempotent: seeds the exercise library and the example templates. */
export function seedExercises(db: Db): void {
  db.transaction((tx) => {
    seedLibrary(tx);
    seedExampleTemplates(tx);
  });
}
