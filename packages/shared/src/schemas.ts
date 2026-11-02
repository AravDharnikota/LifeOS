import { z } from "zod";

// ---------- primitives ----------
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const isoDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Expected ISO datetime");
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");
export const id = z.string().min(1);

// ---------- tasks ----------
export const TaskStatus = z.enum(["open", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id,
  listId: id.nullable(),
  parentId: id.nullable(),
  goalId: id.nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  status: TaskStatus,
  completedAt: z.string().nullable(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  startDate: z.string().nullable(),
  priority: z.number().int().min(0).max(3),
  estimateMinutes: z.number().int().nullable(),
  actualMinutes: z.number().int().nullable(),
  tags: z.array(z.string()),
  recurrence: z.string().nullable(),
  sortOrder: z.number().int(),
  source: z.string(),
  googleId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  // derived
  scheduledBlocks: z.array(z.object({ id, start: z.string(), end: z.string() })).optional(),
});
export type Task = z.infer<typeof Task>;

export const TaskCreate = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(10000).nullable().optional(),
  listId: id.nullable().optional(),
  parentId: id.nullable().optional(),
  goalId: id.nullable().optional(),
  status: TaskStatus.optional(),
  dueDate: isoDate.nullable().optional(),
  dueTime: hhmm.nullable().optional(),
  startDate: isoDate.nullable().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  estimateMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  recurrence: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
  source: z.string().max(100).optional(),
});
export type TaskCreate = z.infer<typeof TaskCreate>;

export const TaskUpdate = TaskCreate.partial().extend({
  actualMinutes: z.number().int().min(0).nullable().optional(),
  completedAt: isoDateTime.nullable().optional(),
});
export type TaskUpdate = z.infer<typeof TaskUpdate>;

export const TaskList = z.object({
  id,
  name: z.string(),
  color: z.string().nullable(),
  sortOrder: z.number().int(),
  isDefault: z.boolean(),
  googleId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type TaskList = z.infer<typeof TaskList>;
export const TaskListCreate = z.object({ name: z.string().trim().min(1).max(100), color: z.string().max(40).nullable().optional(), sortOrder: z.number().int().optional() });
export const TaskListUpdate = TaskListCreate.partial();

// ---------- calendar ----------
export const EventKind = z.enum(["event", "timebox", "habit"]);
export const EventStatus = z.enum(["confirmed", "tentative", "cancelled"]);

export const Calendar = z.object({
  id,
  name: z.string(),
  color: z.string(),
  kind: z.string(),
  isDefault: z.boolean(),
  isVisible: z.boolean(),
  googleId: z.string().nullable(),
  syncEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Calendar = z.infer<typeof Calendar>;
export const CalendarCreate = z.object({ name: z.string().trim().min(1).max(100), color: z.string().max(40).optional(), isDefault: z.boolean().optional(), isVisible: z.boolean().optional() });
export const CalendarUpdate = CalendarCreate.partial().extend({ syncEnabled: z.boolean().optional() });

export const CalEvent = z.object({
  id,
  calendarId: id.nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  location: z.string().nullable(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  timezone: z.string().nullable(),
  color: z.string().nullable(),
  kind: EventKind,
  taskId: id.nullable(),
  locked: z.boolean(),
  status: EventStatus,
  rrule: z.string().nullable(),
  recurrenceParentId: id.nullable(),
  originalStart: z.string().nullable(),
  source: z.string(),
  googleId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  // present on expanded recurring instances
  instanceOf: id.optional(),
  taskStatus: TaskStatus.optional(),
});
export type CalEvent = z.infer<typeof CalEvent>;

export const EventCreate = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(10000).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  calendarId: id.nullable().optional(),
  start: z.string().min(10),
  end: z.string().min(10),
  allDay: z.boolean().optional(),
  timezone: z.string().nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  kind: EventKind.optional(),
  taskId: id.nullable().optional(),
  locked: z.boolean().optional(),
  status: EventStatus.optional(),
  rrule: z.string().max(500).nullable().optional(),
  source: z.string().max(100).optional(),
});
export type EventCreate = z.infer<typeof EventCreate>;
export const EventUpdate = EventCreate.partial();
export type EventUpdate = z.infer<typeof EventUpdate>;

// ---------- goals ----------
export const GoalKind = z.enum(["number", "habit", "milestone", "boolean"]);
export const GoalStatus = z.enum(["active", "done", "paused", "archived"]);
export const Goal = z.object({
  id,
  title: z.string(),
  description: z.string().nullable(),
  area: z.string(),
  kind: GoalKind,
  unit: z.string().nullable(),
  startValue: z.number().nullable(),
  targetValue: z.number().nullable(),
  currentValue: z.number().nullable(),
  direction: z.enum(["increase", "decrease"]),
  cadence: z.string().nullable(),
  timesPerPeriod: z.number().int().nullable(),
  deadline: z.string().nullable(),
  color: z.string().nullable(),
  status: GoalStatus,
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  // derived
  progress: z.number().min(0).max(1).optional(),
  streak: z.number().int().optional(),
  milestones: z.array(z.lazy(() => GoalMilestone)).optional(),
  recentEntries: z.array(z.lazy(() => GoalEntry)).optional(),
  periodCount: z.number().optional(),
});
export type Goal = z.infer<typeof Goal>;
export const GoalCreate = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  area: z.string().max(40).optional(),
  kind: GoalKind.optional(),
  unit: z.string().max(30).nullable().optional(),
  startValue: z.number().nullable().optional(),
  targetValue: z.number().nullable().optional(),
  currentValue: z.number().nullable().optional(),
  direction: z.enum(["increase", "decrease"]).optional(),
  cadence: z.enum(["daily", "weekly"]).nullable().optional(),
  timesPerPeriod: z.number().int().min(1).max(100).nullable().optional(),
  deadline: isoDate.nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  status: GoalStatus.optional(),
  sortOrder: z.number().int().optional(),
});
export type GoalCreate = z.infer<typeof GoalCreate>;
export const GoalUpdate = GoalCreate.partial();
export const GoalEntry = z.object({ id, goalId: id, date: z.string(), value: z.number(), note: z.string().nullable(), createdAt: z.string() });
export type GoalEntry = z.infer<typeof GoalEntry>;
export const GoalEntryCreate = z.object({ date: isoDate.optional(), value: z.number().optional(), note: z.string().max(1000).nullable().optional() });
export const GoalMilestone = z.object({ id, goalId: id, title: z.string(), done: z.boolean(), doneAt: z.string().nullable(), dueDate: z.string().nullable(), sortOrder: z.number().int(), createdAt: z.string() });
export type GoalMilestone = z.infer<typeof GoalMilestone>;
export const GoalMilestoneCreate = z.object({ title: z.string().trim().min(1).max(300), dueDate: isoDate.nullable().optional(), sortOrder: z.number().int().optional() });
export const GoalMilestoneUpdate = GoalMilestoneCreate.partial().extend({ done: z.boolean().optional() });

// ---------- trackers ----------
export const Tracker = z.object({
  id,
  name: z.string(),
  kind: z.enum(["counter", "number", "toggle"]),
  unit: z.string().nullable(),
  step: z.number(),
  target: z.number().nullable(),
  reset: z.enum(["daily", "weekly", "never"]),
  color: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  todayValue: z.number().optional(),
});
export type Tracker = z.infer<typeof Tracker>;
export const TrackerCreate = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["counter", "number", "toggle"]).optional(),
  unit: z.string().max(30).nullable().optional(),
  step: z.number().positive().optional(),
  target: z.number().nullable().optional(),
  reset: z.enum(["daily", "weekly", "never"]).optional(),
  color: z.string().max(40).nullable().optional(),
});
export const TrackerUpdate = TrackerCreate.partial();
export const TrackerLog = z.object({ date: isoDate.optional(), delta: z.number().optional(), value: z.number().optional() });

// ---------- workouts ----------
export const ExerciseCategory = z.enum(["barbell", "dumbbell", "machine", "cable", "bodyweight", "assisted_bodyweight", "weighted_bodyweight", "cardio", "duration", "reps_only"]);
export type ExerciseCategory = z.infer<typeof ExerciseCategory>;
export const BodyPart = z.enum(["chest", "back", "legs", "shoulders", "arms", "core", "full_body", "cardio", "other"]);
export const SetType = z.enum(["normal", "warmup", "drop", "failure"]);
export type SetType = z.infer<typeof SetType>;
export const PrType = z.enum(["weight", "one_rm", "volume", "reps"]);
export type PrType = z.infer<typeof PrType>;

export const Exercise = z.object({
  id,
  name: z.string(),
  category: ExerciseCategory,
  bodyPart: BodyPart,
  instructions: z.string().nullable(),
  isCustom: z.boolean(),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Exercise = z.infer<typeof Exercise>;
export const ExerciseCreate = z.object({ name: z.string().trim().min(1).max(120), category: ExerciseCategory, bodyPart: BodyPart, instructions: z.string().max(5000).nullable().optional() });
export const ExerciseUpdate = ExerciseCreate.partial();

export const TemplateSet = z.object({ id, templateExerciseId: id, sortOrder: z.number().int(), setType: SetType, targetWeight: z.number().nullable(), targetReps: z.number().int().nullable(), targetSeconds: z.number().int().nullable(), targetDistance: z.number().nullable() });
export type TemplateSet = z.infer<typeof TemplateSet>;
export const TemplateExercise = z.object({ id, templateId: id, exerciseId: id, sortOrder: z.number().int(), supersetGroup: z.number().int().nullable(), restSeconds: z.number().int().nullable(), notes: z.string().nullable(), exercise: Exercise.optional(), sets: z.array(TemplateSet).optional() });
export type TemplateExercise = z.infer<typeof TemplateExercise>;
export const WorkoutTemplate = z.object({ id, name: z.string(), notes: z.string().nullable(), folder: z.string().nullable(), sortOrder: z.number().int(), lastPerformedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(), deletedAt: z.string().nullable(), exercises: z.array(TemplateExercise).optional() });
export type WorkoutTemplate = z.infer<typeof WorkoutTemplate>;

export const TemplateSetInput = z.object({ setType: SetType.optional(), targetWeight: z.number().nullable().optional(), targetReps: z.number().int().nullable().optional(), targetSeconds: z.number().int().nullable().optional(), targetDistance: z.number().nullable().optional() });
export const TemplateExerciseInput = z.object({ exerciseId: id, supersetGroup: z.number().int().nullable().optional(), restSeconds: z.number().int().nullable().optional(), notes: z.string().max(2000).nullable().optional(), sets: z.array(TemplateSetInput).optional() });
export const WorkoutTemplateInput = z.object({ name: z.string().trim().min(1).max(120), notes: z.string().max(5000).nullable().optional(), folder: z.string().max(100).nullable().optional(), sortOrder: z.number().int().optional(), exercises: z.array(TemplateExerciseInput).optional() });
export type WorkoutTemplateInput = z.infer<typeof WorkoutTemplateInput>;

export const WorkoutSet = z.object({
  id,
  workoutExerciseId: id,
  sortOrder: z.number().int(),
  setType: SetType,
  weight: z.number().nullable(),
  reps: z.number().int().nullable(),
  seconds: z.number().int().nullable(),
  distance: z.number().nullable(),
  rpe: z.number().nullable(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  prs: z.array(PrType),
});
export type WorkoutSet = z.infer<typeof WorkoutSet>;
export const WorkoutExercise = z.object({
  id,
  workoutId: id,
  exerciseId: id,
  sortOrder: z.number().int(),
  supersetGroup: z.number().int().nullable(),
  restSeconds: z.number().int().nullable(),
  notes: z.string().nullable(),
  exercise: Exercise.optional(),
  sets: z.array(WorkoutSet).optional(),
  previous: z.array(z.object({ setType: SetType, weight: z.number().nullable(), reps: z.number().int().nullable(), seconds: z.number().int().nullable(), distance: z.number().nullable() })).optional(),
});
export type WorkoutExercise = z.infer<typeof WorkoutExercise>;
export const Workout = z.object({
  id,
  templateId: id.nullable(),
  name: z.string(),
  notes: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  totalVolume: z.number().nullable(),
  totalSets: z.number().int().nullable(),
  prCount: z.number().int(),
  status: z.enum(["active", "completed", "discarded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  exercises: z.array(WorkoutExercise).optional(),
});
export type Workout = z.infer<typeof Workout>;

export const WorkoutSetInput = z.object({
  setType: SetType.optional(),
  weight: z.number().min(0).nullable().optional(),
  reps: z.number().int().min(0).nullable().optional(),
  seconds: z.number().int().min(0).nullable().optional(),
  distance: z.number().min(0).nullable().optional(),
  rpe: z.number().min(1).max(10).nullable().optional(),
  completed: z.boolean().optional(),
});
export type WorkoutSetInput = z.infer<typeof WorkoutSetInput>;
export const WorkoutExerciseInput = z.object({ exerciseId: id, supersetGroup: z.number().int().nullable().optional(), restSeconds: z.number().int().nullable().optional(), notes: z.string().max(2000).nullable().optional(), sets: z.array(WorkoutSetInput).optional() });
export const WorkoutStart = z.object({ templateId: id.nullable().optional(), name: z.string().max(120).optional() });
export const WorkoutUpdate = z.object({ name: z.string().trim().min(1).max(120).optional(), notes: z.string().max(5000).nullable().optional(), startedAt: isoDateTime.optional() });
export const WorkoutFinish = z.object({ updateTemplate: z.boolean().optional(), durationSeconds: z.number().int().min(0).optional() });

export const PersonalRecord = z.object({ id, exerciseId: id, type: PrType, value: z.number(), weight: z.number().nullable(), reps: z.number().int().nullable(), workoutId: id.nullable(), workoutSetId: id.nullable(), achievedAt: z.string() });
export type PersonalRecord = z.infer<typeof PersonalRecord>;

// ---------- nutrition ----------
export const Nutrients = z.object({
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  fiberG: z.number().nullable().optional(),
  sugarG: z.number().nullable().optional(),
  sodiumMg: z.number().nullable().optional(),
  saturatedFatG: z.number().nullable().optional(),
  cholesterolMg: z.number().nullable().optional(),
  potassiumMg: z.number().nullable().optional(),
});
export type Nutrients = z.infer<typeof Nutrients>;

export const MealType = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type MealType = z.infer<typeof MealType>;

export const Food = z.object({ id, name: z.string(), brand: z.string().nullable(), source: z.string(), barcode: z.string().nullable(), per100: Nutrients, servings: z.array(z.object({ label: z.string(), grams: z.number() })), createdAt: z.string() });
export type Food = z.infer<typeof Food>;

export const MealItem = z.object({
  id,
  mealId: id,
  foodId: id.nullable(),
  name: z.string(),
  quantity: z.number(),
  unit: z.string(),
  grams: z.number().nullable(),
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  fiberG: z.number().nullable(),
  sugarG: z.number().nullable(),
  sodiumMg: z.number().nullable(),
  saturatedFatG: z.number().nullable(),
  cholesterolMg: z.number().nullable(),
  potassiumMg: z.number().nullable(),
  confidence: z.number().nullable(),
  sortOrder: z.number().int(),
});
export type MealItem = z.infer<typeof MealItem>;
export const MealItemInput = z.object({
  foodId: id.nullable().optional(),
  name: z.string().trim().min(1).max(200),
  quantity: z.number().positive().optional(),
  unit: z.string().max(30).optional(),
  grams: z.number().min(0).nullable().optional(),
  calories: z.number().min(0),
  proteinG: z.number().min(0).optional(),
  carbsG: z.number().min(0).optional(),
  fatG: z.number().min(0).optional(),
  fiberG: z.number().min(0).nullable().optional(),
  sugarG: z.number().min(0).nullable().optional(),
  sodiumMg: z.number().min(0).nullable().optional(),
  saturatedFatG: z.number().min(0).nullable().optional(),
  cholesterolMg: z.number().min(0).nullable().optional(),
  potassiumMg: z.number().min(0).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});
export type MealItemInput = z.infer<typeof MealItemInput>;
export const Meal = z.object({
  id,
  date: z.string(),
  mealType: MealType,
  name: z.string().nullable(),
  loggedAt: z.string(),
  photoPath: z.string().nullable(),
  source: z.string(),
  aiNotes: z.string().nullable(),
  healthScore: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  items: z.array(MealItem).optional(),
  totals: Nutrients.optional(),
});
export type Meal = z.infer<typeof Meal>;
export const MealCreate = z.object({
  date: isoDate.optional(),
  mealType: MealType.optional(),
  name: z.string().max(200).nullable().optional(),
  loggedAt: isoDateTime.optional(),
  source: z.string().max(30).optional(),
  aiNotes: z.string().max(5000).nullable().optional(),
  healthScore: z.number().int().min(0).max(10).nullable().optional(),
  items: z.array(MealItemInput).optional(),
});
export type MealCreate = z.infer<typeof MealCreate>;
export const MealUpdate = MealCreate.partial();

export const FoodAnalysisItem = z.object({
  name: z.string(),
  portion: z.string(),
  grams: z.number(),
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  fiberG: z.number().nullable(),
  sugarG: z.number().nullable(),
  sodiumMg: z.number().nullable(),
  saturatedFatG: z.number().nullable(),
  confidence: z.number().min(0).max(1),
});
export const FoodAnalysis = z.object({
  mealName: z.string(),
  items: z.array(FoodAnalysisItem),
  totals: z.object({ calories: z.number(), proteinG: z.number(), carbsG: z.number(), fatG: z.number() }),
  healthScore: z.number().int().min(0).max(10),
  notes: z.string(),
  mealType: MealType,
});
export type FoodAnalysis = z.infer<typeof FoodAnalysis>;

export const WaterLog = z.object({ id, date: z.string(), ml: z.number().int(), loggedAt: z.string() });
export type WaterLog = z.infer<typeof WaterLog>;
export const WeightLog = z.object({ id, date: z.string(), weightKg: z.number(), bodyFatPct: z.number().nullable(), note: z.string().nullable(), loggedAt: z.string() });
export type WeightLog = z.infer<typeof WeightLog>;
export const WeightLogCreate = z.object({ date: isoDate.optional(), weightKg: z.number().positive().max(500), bodyFatPct: z.number().min(1).max(80).nullable().optional(), note: z.string().max(500).nullable().optional() });

export const BodyPhoto = z.object({ id, date: z.string(), takenAt: z.string(), path: z.string(), pose: z.enum(["front", "side", "back"]), weightKg: z.number().nullable(), note: z.string().nullable(), createdAt: z.string(), deletedAt: z.string().nullable(), analysis: z.lazy(() => PhotoAnalysis).nullable().optional() });
export type BodyPhoto = z.infer<typeof BodyPhoto>;
export const PhotoAnalysis = z.object({ id, photoId: id, comparedToPhotoId: id.nullable(), summary: z.string(), observations: z.array(z.string()), progressScore: z.number().int().nullable(), createdAt: z.string() });
export type PhotoAnalysis = z.infer<typeof PhotoAnalysis>;

export const HealthProfile = z.object({
  sex: z.enum(["male", "female"]).nullable().default(null),
  birthDate: isoDate.nullable().default(null),
  heightCm: z.number().positive().nullable().default(null),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).default("moderate"),
  goal: z.enum(["lose", "maintain", "gain"]).default("maintain"),
  paceKgPerWeek: z.number().min(0).max(1.5).default(0.5),
  targetWeightKg: z.number().positive().nullable().default(null),
  units: z.enum(["metric", "imperial"]).default("imperial"),
  targets: z
    .object({
      calories: z.number().int().positive().default(2400),
      proteinG: z.number().int().positive().default(160),
      carbsG: z.number().int().positive().default(260),
      fatG: z.number().int().positive().default(75),
      fiberG: z.number().int().positive().default(30),
      sugarMaxG: z.number().int().positive().default(50),
      sodiumMaxMg: z.number().int().positive().default(2300),
      waterMl: z.number().int().positive().default(3000),
      workoutsPerWeek: z.number().int().min(0).max(14).default(4),
      stepsPerDay: z.number().int().positive().nullable().default(null),
    })
    .prefault({}),
});
export type HealthProfile = z.infer<typeof HealthProfile>;

// ---------- layout (agent-editable dashboard) ----------
export const WidgetSize = z.enum(["s", "m", "l"]);
const widgetBase = { id: z.string().min(1), size: WidgetSize.default("m"), title: z.string().max(60).optional() };
export const Widget = z.discriminatedUnion("type", [
  z.object({ ...widgetBase, type: z.literal("agenda"), hours: z.number().int().min(1).max(24).default(12) }),
  z.object({ ...widgetBase, type: z.literal("tasks"), filter: z.enum(["today", "overdue", "upcoming", "list"]).default("today"), listId: z.string().optional(), limit: z.number().int().min(1).max(50).default(8) }),
  z.object({ ...widgetBase, type: z.literal("nutrition_rings") }),
  z.object({ ...widgetBase, type: z.literal("water") }),
  z.object({ ...widgetBase, type: z.literal("workout_streak") }),
  z.object({ ...widgetBase, type: z.literal("weight_trend"), days: z.number().int().min(7).max(365).default(30) }),
  z.object({ ...widgetBase, type: z.literal("goal"), goalId: z.string() }),
  z.object({ ...widgetBase, type: z.literal("goals_overview"), area: z.string().optional(), limit: z.number().int().min(1).max(20).default(5) }),
  z.object({ ...widgetBase, type: z.literal("tracker"), trackerId: z.string() }),
  z.object({ ...widgetBase, type: z.literal("habit_grid"), goalId: z.string(), weeks: z.number().int().min(4).max(26).default(12) }),
  z.object({ ...widgetBase, type: z.literal("note"), text: z.string().max(2000) }),
  z.object({ ...widgetBase, type: z.literal("quick_actions"), actions: z.array(z.enum(["log_meal", "start_workout", "add_task", "add_water", "log_weight", "add_event"])).default(["log_meal", "start_workout", "add_task"]) }),
  z.object({ ...widgetBase, type: z.literal("stat"), metric: z.enum(["calories_today", "protein_today", "water_today", "tasks_done_today", "workouts_this_week", "weight_latest", "open_tasks", "events_today"]), label: z.string().max(40).optional() }),
  z.object({ ...widgetBase, type: z.literal("countdown"), date: isoDate, label: z.string().max(60) }),
  z.object({ ...widgetBase, type: z.literal("recent_prs"), limit: z.number().int().min(1).max(20).default(5) }),
]);
export type Widget = z.infer<typeof Widget>;
export const WidgetType = z.enum(["agenda", "tasks", "nutrition_rings", "water", "workout_streak", "weight_trend", "goal", "goals_overview", "tracker", "habit_grid", "note", "quick_actions", "stat", "countdown", "recent_prs"]);

export const LayoutSection = z.object({ id: z.string().min(1), title: z.string().max(60).optional(), widgets: z.array(Widget) });
export const LayoutSpec = z.object({ sections: z.array(LayoutSection), theme: z.object({ accent: z.string().optional() }).optional() });
export type LayoutSpec = z.infer<typeof LayoutSpec>;
export const Layout = z.object({ id: z.string(), spec: LayoutSpec, version: z.number().int(), updatedAt: z.string() });
export type Layout = z.infer<typeof Layout>;

// ---------- scheduler ----------
export const DayHours = z.object({ start: hhmm, end: hhmm }).nullable();
export const SchedulerPrefs = z.object({
  workHours: z.object({ mon: DayHours, tue: DayHours, wed: DayHours, thu: DayHours, fri: DayHours, sat: DayHours, sun: DayHours }).default({
    mon: { start: "09:00", end: "18:00" },
    tue: { start: "09:00", end: "18:00" },
    wed: { start: "09:00", end: "18:00" },
    thu: { start: "09:00", end: "18:00" },
    fri: { start: "09:00", end: "18:00" },
    sat: { start: "10:00", end: "14:00" },
    sun: null,
  }),
  bufferMinutes: z.number().int().min(0).max(60).default(10),
  minBlockMinutes: z.number().int().min(5).max(240).default(25),
  maxBlockMinutes: z.number().int().min(15).max(480).default(90),
  defaultEstimateMinutes: z.number().int().min(5).max(480).default(30),
  horizonDays: z.number().int().min(1).max(30).default(7),
  lunch: z.object({ start: hhmm, end: hhmm }).nullable().default({ start: "12:30", end: "13:15" }),
  autoRun: z.boolean().default(true),
  snapMinutes: z.number().int().min(5).max(60).default(15),
});
export type SchedulerPrefs = z.infer<typeof SchedulerPrefs>;

export const SchedulerResult = z.object({
  placed: z.array(z.object({ taskId: id, title: z.string(), blocks: z.array(z.object({ eventId: id, start: z.string(), end: z.string() })) })),
  unplaced: z.array(z.object({ taskId: id, title: z.string(), reason: z.string() })),
  moved: z.number().int(),
  summary: z.string(),
});
export type SchedulerResult = z.infer<typeof SchedulerResult>;

// ---------- agent ----------
export const AgentToolCall = z.object({ name: z.string(), input: z.unknown(), result: z.string().optional(), ok: z.boolean().optional() });
export const AgentMessage = z.object({ id, threadId: id, role: z.enum(["user", "assistant"]), displayText: z.string().nullable(), toolCalls: z.array(AgentToolCall), createdAt: z.string() });
export type AgentMessage = z.infer<typeof AgentMessage>;
export const AgentThread = z.object({ id, title: z.string().nullable(), createdAt: z.string(), updatedAt: z.string() });
export type AgentThread = z.infer<typeof AgentThread>;

// ---------- activity ----------
export const Activity = z.object({ id, at: z.string(), actor: z.string(), action: z.string(), entity: z.string(), entityId: z.string().nullable(), summary: z.string(), data: z.unknown().nullable() });
export type Activity = z.infer<typeof Activity>;

// ---------- settings ----------
export const AppSettings = z.object({
  name: z.string().max(60).default("Arav"),
  timezone: z.string().default("America/Los_Angeles"),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
  units: z.enum(["metric", "imperial"]).default("imperial"),
  defaultRestSeconds: z.number().int().min(0).max(600).default(90),
  haptics: z.boolean().default(true),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  accent: z.string().default("ink"),
});
export type AppSettings = z.infer<typeof AppSettings>;
