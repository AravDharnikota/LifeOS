import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// Conventions
// - ids: uuid v4 strings
// - timestamps: ISO 8601 strings (UTC, e.g. 2026-11-02T18:30:00.000Z)
// - dates: YYYY-MM-DD in the user's local timezone
// - booleans: integer 0/1 via mode "boolean"
// - soft delete via deleted_at where the row syncs externally (tasks, events)

const ts = () => text();
const now = () => text().notNull().$defaultFn(() => new Date().toISOString());

// ---------- settings (key/value JSON) ----------
export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(), // JSON
  updatedAt: now(),
});

// ---------- tasks ----------
export const taskLists = sqliteTable("task_lists", {
  id: text().primaryKey(),
  name: text().notNull(),
  color: text(), // token name like "blue", or hex
  sortOrder: integer().notNull().default(0),
  isDefault: integer({ mode: "boolean" }).notNull().default(false),
  googleId: text(),
  createdAt: now(),
  updatedAt: now(),
  deletedAt: ts(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text().primaryKey(),
    listId: text().references(() => taskLists.id),
    parentId: text(),
    goalId: text(),
    title: text().notNull(),
    notes: text(),
    status: text().notNull().default("open"), // open | done | cancelled
    completedAt: ts(),
    dueDate: text(), // YYYY-MM-DD
    dueTime: text(), // HH:mm (local)
    startDate: text(), // YYYY-MM-DD: "when" I intend to do it (Things-style)
    priority: integer().notNull().default(0), // 0 none, 1 low, 2 medium, 3 high
    estimateMinutes: integer(),
    actualMinutes: integer(),
    tags: text().notNull().default("[]"), // JSON string[]
    recurrence: text(), // RRULE string
    sortOrder: integer().notNull().default(0),
    source: text().notNull().default("app"), // app | mcp:<client> | google | agent
    googleId: text(),
    googleEtag: text(),
    googleListId: text(),
    createdAt: now(),
    updatedAt: now(),
    deletedAt: ts(),
  },
  (t) => [index("tasks_due_idx").on(t.dueDate), index("tasks_status_idx").on(t.status), index("tasks_list_idx").on(t.listId)],
);

// ---------- calendar ----------
export const calendars = sqliteTable("calendars", {
  id: text().primaryKey(),
  name: text().notNull(),
  color: text().notNull().default("blue"),
  kind: text().notNull().default("local"), // local | google
  isDefault: integer({ mode: "boolean" }).notNull().default(false),
  isVisible: integer({ mode: "boolean" }).notNull().default(true),
  googleId: text(),
  syncEnabled: integer({ mode: "boolean" }).notNull().default(true),
  createdAt: now(),
  updatedAt: now(),
  deletedAt: ts(),
});

export const events = sqliteTable(
  "events",
  {
    id: text().primaryKey(),
    calendarId: text().references(() => calendars.id),
    title: text().notNull(),
    notes: text(),
    location: text(),
    start: text().notNull(), // ISO datetime (UTC) or YYYY-MM-DD when allDay
    end: text().notNull(),
    allDay: integer({ mode: "boolean" }).notNull().default(false),
    timezone: text(),
    color: text(),
    kind: text().notNull().default("event"), // event | timebox | habit
    taskId: text(),
    locked: integer({ mode: "boolean" }).notNull().default(false), // user pinned; scheduler must not move
    status: text().notNull().default("confirmed"), // confirmed | tentative | cancelled
    rrule: text(),
    recurrenceParentId: text(),
    originalStart: text(),
    source: text().notNull().default("app"),
    googleId: text(),
    googleEtag: text(),
    googleCalendarId: text(),
    createdAt: now(),
    updatedAt: now(),
    deletedAt: ts(),
  },
  (t) => [index("events_start_idx").on(t.start), index("events_task_idx").on(t.taskId), index("events_cal_idx").on(t.calendarId)],
);

// ---------- goals ----------
export const goals = sqliteTable("goals", {
  id: text().primaryKey(),
  title: text().notNull(),
  description: text(),
  area: text().notNull().default("life"), // health | work | learning | money | life | ...
  kind: text().notNull().default("number"), // number | habit | milestone | boolean
  unit: text(),
  startValue: real(),
  targetValue: real(),
  currentValue: real(),
  direction: text().notNull().default("increase"), // increase | decrease
  cadence: text(), // for habit: daily | weekly
  timesPerPeriod: integer(), // habit: e.g. 4 per week
  deadline: text(), // YYYY-MM-DD
  color: text(),
  status: text().notNull().default("active"), // active | done | paused | archived
  sortOrder: integer().notNull().default(0),
  createdAt: now(),
  updatedAt: now(),
  deletedAt: ts(),
});

export const goalEntries = sqliteTable(
  "goal_entries",
  {
    id: text().primaryKey(),
    goalId: text().notNull().references(() => goals.id),
    date: text().notNull(), // YYYY-MM-DD
    value: real().notNull().default(1),
    note: text(),
    createdAt: now(),
  },
  (t) => [index("goal_entries_goal_idx").on(t.goalId, t.date)],
);

export const goalMilestones = sqliteTable("goal_milestones", {
  id: text().primaryKey(),
  goalId: text().notNull().references(() => goals.id),
  title: text().notNull(),
  done: integer({ mode: "boolean" }).notNull().default(false),
  doneAt: ts(),
  dueDate: text(),
  sortOrder: integer().notNull().default(0),
  createdAt: now(),
});

// ---------- trackers (user/agent-defined counters shown as widgets) ----------
export const trackers = sqliteTable("trackers", {
  id: text().primaryKey(),
  name: text().notNull(),
  kind: text().notNull().default("counter"), // counter | number | toggle
  unit: text(),
  step: real().notNull().default(1),
  target: real(),
  reset: text().notNull().default("daily"), // daily | weekly | never
  color: text(),
  createdAt: now(),
  updatedAt: now(),
  deletedAt: ts(),
});

export const trackerEntries = sqliteTable(
  "tracker_entries",
  {
    id: text().primaryKey(),
    trackerId: text().notNull().references(() => trackers.id),
    date: text().notNull(),
    value: real().notNull(),
    createdAt: now(),
  },
  (t) => [index("tracker_entries_idx").on(t.trackerId, t.date)],
);

// ---------- workouts (Strong-style) ----------
export const exercises = sqliteTable("exercises", {
  id: text().primaryKey(),
  name: text().notNull(),
  category: text().notNull().default("barbell"), // barbell | dumbbell | machine | cable | bodyweight | assisted_bodyweight | weighted_bodyweight | cardio | duration | reps_only
  bodyPart: text().notNull().default("other"), // chest | back | legs | shoulders | arms | core | full_body | cardio | other
  instructions: text(),
  isCustom: integer({ mode: "boolean" }).notNull().default(false),
  createdAt: now(),
  deletedAt: ts(),
});

export const workoutTemplates = sqliteTable("workout_templates", {
  id: text().primaryKey(),
  name: text().notNull(),
  notes: text(),
  folder: text(),
  sortOrder: integer().notNull().default(0),
  lastPerformedAt: ts(),
  createdAt: now(),
  updatedAt: now(),
  deletedAt: ts(),
});

export const templateExercises = sqliteTable("template_exercises", {
  id: text().primaryKey(),
  templateId: text().notNull().references(() => workoutTemplates.id),
  exerciseId: text().notNull().references(() => exercises.id),
  sortOrder: integer().notNull().default(0),
  supersetGroup: integer(),
  restSeconds: integer(),
  notes: text(),
});

export const templateSets = sqliteTable("template_sets", {
  id: text().primaryKey(),
  templateExerciseId: text().notNull().references(() => templateExercises.id),
  sortOrder: integer().notNull().default(0),
  setType: text().notNull().default("normal"), // normal | warmup | drop | failure
  targetWeight: real(),
  targetReps: integer(),
  targetSeconds: integer(),
  targetDistance: real(),
});

export const workouts = sqliteTable(
  "workouts",
  {
    id: text().primaryKey(),
    templateId: text(),
    name: text().notNull(),
    notes: text(),
    startedAt: text().notNull(),
    finishedAt: ts(),
    durationSeconds: integer(),
    totalVolume: real(),
    totalSets: integer(),
    prCount: integer().notNull().default(0),
    status: text().notNull().default("active"), // active | completed | discarded
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [index("workouts_started_idx").on(t.startedAt), index("workouts_status_idx").on(t.status)],
);

export const workoutExercises = sqliteTable("workout_exercises", {
  id: text().primaryKey(),
  workoutId: text().notNull().references(() => workouts.id),
  exerciseId: text().notNull().references(() => exercises.id),
  sortOrder: integer().notNull().default(0),
  supersetGroup: integer(),
  restSeconds: integer(),
  notes: text(),
});

export const workoutSets = sqliteTable(
  "workout_sets",
  {
    id: text().primaryKey(),
    workoutExerciseId: text().notNull().references(() => workoutExercises.id),
    sortOrder: integer().notNull().default(0),
    setType: text().notNull().default("normal"),
    weight: real(),
    reps: integer(),
    seconds: integer(),
    distance: real(),
    rpe: real(),
    completed: integer({ mode: "boolean" }).notNull().default(false),
    completedAt: ts(),
    prs: text().notNull().default("[]"), // JSON: ("weight"|"one_rm"|"volume"|"reps")[]
  },
  (t) => [index("workout_sets_we_idx").on(t.workoutExerciseId)],
);

export const personalRecords = sqliteTable(
  "personal_records",
  {
    id: text().primaryKey(),
    exerciseId: text().notNull().references(() => exercises.id),
    type: text().notNull(), // weight | one_rm | volume | reps
    value: real().notNull(),
    weight: real(),
    reps: integer(),
    workoutId: text(),
    workoutSetId: text(),
    achievedAt: text().notNull(),
  },
  (t) => [uniqueIndex("pr_exercise_type_idx").on(t.exerciseId, t.type)],
);

// ---------- nutrition ----------
export const foods = sqliteTable(
  "foods",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    brand: text(),
    source: text().notNull().default("bundled"), // bundled | usda | off | custom | ai
    barcode: text(),
    per100: text().notNull(), // JSON Nutrients per 100 g
    servings: text().notNull().default("[]"), // JSON {label, grams}[]
    createdAt: now(),
  },
  (t) => [index("foods_name_idx").on(t.name), index("foods_barcode_idx").on(t.barcode)],
);

export const meals = sqliteTable(
  "meals",
  {
    id: text().primaryKey(),
    date: text().notNull(), // YYYY-MM-DD local
    mealType: text().notNull().default("snack"), // breakfast | lunch | dinner | snack
    name: text(),
    loggedAt: text().notNull(),
    photoPath: text(),
    source: text().notNull().default("manual"), // photo | manual | search | barcode | text
    aiNotes: text(),
    healthScore: integer(), // 0-10
    createdAt: now(),
    updatedAt: now(),
    deletedAt: ts(),
  },
  (t) => [index("meals_date_idx").on(t.date)],
);

export const mealItems = sqliteTable(
  "meal_items",
  {
    id: text().primaryKey(),
    mealId: text().notNull().references(() => meals.id),
    foodId: text(),
    name: text().notNull(),
    quantity: real().notNull().default(1),
    unit: text().notNull().default("serving"),
    grams: real(),
    calories: real().notNull().default(0),
    proteinG: real().notNull().default(0),
    carbsG: real().notNull().default(0),
    fatG: real().notNull().default(0),
    fiberG: real(),
    sugarG: real(),
    sodiumMg: real(),
    saturatedFatG: real(),
    cholesterolMg: real(),
    potassiumMg: real(),
    confidence: real(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index("meal_items_meal_idx").on(t.mealId)],
);

export const waterLogs = sqliteTable(
  "water_logs",
  {
    id: text().primaryKey(),
    date: text().notNull(),
    ml: integer().notNull(),
    loggedAt: text().notNull(),
  },
  (t) => [index("water_date_idx").on(t.date)],
);

export const weightLogs = sqliteTable(
  "weight_logs",
  {
    id: text().primaryKey(),
    date: text().notNull(),
    weightKg: real().notNull(),
    bodyFatPct: real(),
    note: text(),
    loggedAt: text().notNull(),
  },
  (t) => [index("weight_date_idx").on(t.date)],
);

export const bodyPhotos = sqliteTable(
  "body_photos",
  {
    id: text().primaryKey(),
    date: text().notNull(),
    takenAt: text().notNull(),
    path: text().notNull(),
    pose: text().notNull().default("front"), // front | side | back
    weightKg: real(),
    note: text(),
    createdAt: now(),
    deletedAt: ts(),
  },
  (t) => [index("body_photos_date_idx").on(t.date)],
);

export const photoAnalyses = sqliteTable("photo_analyses", {
  id: text().primaryKey(),
  photoId: text().notNull().references(() => bodyPhotos.id),
  comparedToPhotoId: text(),
  summary: text().notNull(),
  observations: text().notNull().default("[]"), // JSON string[]
  progressScore: integer(), // -2..2 relative to compared photo
  createdAt: now(),
});

// ---------- dashboard layout (agent-editable) ----------
export const layouts = sqliteTable("layouts", {
  id: text().primaryKey(), // "today" | "health" | ...
  spec: text().notNull(), // JSON LayoutSpec
  version: integer().notNull().default(1),
  updatedAt: now(),
});

export const layoutVersions = sqliteTable("layout_versions", {
  id: text().primaryKey(),
  layoutId: text().notNull(),
  version: integer().notNull(),
  spec: text().notNull(),
  reason: text(),
  createdAt: now(),
});

// ---------- agent ----------
export const agentThreads = sqliteTable("agent_threads", {
  id: text().primaryKey(),
  title: text(),
  createdAt: now(),
  updatedAt: now(),
});

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text().primaryKey(),
    threadId: text().notNull().references(() => agentThreads.id),
    role: text().notNull(), // user | assistant
    content: text().notNull(), // JSON content blocks (Anthropic shape)
    displayText: text(), // plain text for UI
    toolCalls: text().notNull().default("[]"), // JSON summaries of tool calls made in this turn
    createdAt: now(),
  },
  (t) => [index("agent_messages_thread_idx").on(t.threadId)],
);

export const memories = sqliteTable("memories", {
  id: text().primaryKey(),
  kind: text().notNull().default("fact"), // fact | preference | pattern
  content: text().notNull(),
  source: text().notNull().default("agent"),
  createdAt: now(),
  updatedAt: now(),
});

// ---------- scheduler ----------
export const durationHistory = sqliteTable(
  "duration_history",
  {
    id: text().primaryKey(),
    taskId: text(),
    title: text().notNull(),
    tags: text().notNull().default("[]"),
    listId: text(),
    estimateMinutes: integer(),
    actualMinutes: integer().notNull(),
    completedAt: text().notNull(),
  },
  (t) => [index("duration_history_completed_idx").on(t.completedAt)],
);

export const schedulerRuns = sqliteTable("scheduler_runs", {
  id: text().primaryKey(),
  ranAt: now(),
  trigger: text().notNull().default("manual"), // manual | mcp | auto | agent
  placed: integer().notNull().default(0),
  moved: integer().notNull().default(0),
  unplaced: integer().notNull().default(0),
  summary: text().notNull(), // JSON
});

// ---------- sync ----------
export const syncState = sqliteTable("sync_state", {
  id: text().primaryKey(), // `${provider}:${remoteId}`
  provider: text().notNull(), // google_calendar | google_tasks
  remoteId: text().notNull(),
  localId: text(),
  syncToken: text(),
  lastSyncedAt: ts(),
  lastError: text(),
});

// ---------- activity log ----------
export const activityLog = sqliteTable(
  "activity_log",
  {
    id: text().primaryKey(),
    at: now(),
    actor: text().notNull().default("user"), // user | agent | mcp:<client> | scheduler | sync
    action: text().notNull(), // created | updated | completed | deleted | scheduled | ...
    entity: text().notNull(), // task | event | goal | workout | meal | layout | ...
    entityId: text(),
    summary: text().notNull(),
    data: text(), // JSON
  },
  (t) => [index("activity_at_idx").on(t.at)],
);
