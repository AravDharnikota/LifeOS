# Workouts backend

Strong-style workout tracking: exercise library, templates, live workouts with sets, personal records, history, exercise records and charts. Source: `apps/server/src/services/workouts.ts`, `apps/server/src/services/exercise-library.ts`, `apps/server/src/routes/workouts.ts`, calculation rules in `packages/shared/src/workouts.ts`.

## Units

Everything is stored and exchanged in metric: weights in kilograms, distances in kilometres, durations in seconds. The client converts for display (`kgToLb` / `lbToKg` in the shared package). Timestamps are ISO 8601 UTC; calendar and chart dates are `YYYY-MM-DD` in the server's timezone.

## Exercise categories

`barbell | dumbbell | machine | cable | bodyweight | assisted_bodyweight | weighted_bodyweight | cardio | duration | reps_only`. The category decides which set columns apply, how volume is counted and which record types exist. `machine` doubles as Strong's "Machine / Other" (kettlebells, sleds, plate loaded). `bodyweight` and `reps_only` behave identically (reps only, no weight).

Body parts: `chest | back | legs | shoulders | arms | core | full_body | cardio | other` (Strong's "Olympic" lifts are filed under `full_body`).

## Endpoints

All under `/api`. Errors follow the app convention `{ error, details }`.

### Exercises
| Method | Path | Notes |
|---|---|---|
| GET | `/exercises?q=&bodyPart=&category=` | Library plus custom exercises, alphabetical. Each row carries `lastPerformedAt` and `recordOneRm`. |
| POST | `/exercises` | Create a custom exercise (`ExerciseCreate`). Duplicate names are rejected. |
| GET | `/exercises/:id` | `ExerciseDetail`: exercise, current `records`, `bestByReps` (1 to 12: best weight and predicted), `history` (last 10 workouts with sets), `charts` (`oneRm`, `maxWeight`, `volume`, `maxReps`, `totalReps`, `distance`, `duration`; each `[{date, value, workoutId}]`), `workoutCount`. |
| GET | `/exercises/:id/history?limit&offset` | Paged history entries. |
| PATCH | `/exercises/:id` | Built-ins accept only `bodyPart` and `instructions` (name and category are locked, as in Strong). |
| DELETE | `/exercises/:id` | Soft delete, custom exercises only. |

### Templates
| Method | Path | Notes |
|---|---|---|
| GET | `/templates` | Non-deleted templates with exercises, sets and exercise objects, ordered by `sortOrder`. Group by `folder` client-side (`null` = My Templates, seeded ones use `Example Templates`). |
| POST | `/templates` | `WorkoutTemplateInput` (nested exercises and sets). |
| GET | `/templates/:id` | |
| PUT | `/templates/:id` | Full replacement. Exercise and set rows keep their ids when the exercise id and position match. |
| PATCH | `/templates/:id` | `name`, `notes`, `folder`, `sortOrder`. |
| DELETE | `/templates/:id` | Soft delete. |
| POST | `/templates/:id/duplicate` | Copy named `<name> (copy)` in the same folder. |
| POST | `/templates/reorder` | `{ ids }`; unnamed templates keep their relative order after the listed ones. |

### Workouts
| Method | Path | Notes |
|---|---|---|
| GET | `/workouts/settings` / PATCH | `WorkoutSettings`: `oneRmFormula` (hybrid, brzycki, epley), `countDumbbellsTwice`, `includeWeightedBodyweightVolume`, `includeAssistedBodyweightVolume`, `previousSetSource` (any, same_template), warm-up and drop-set rest defaults, `timerIncrementSeconds`. Stored under the settings key `workouts`. |
| POST | `/workouts/start` | `{ templateId?, name? }`. 409 with `details.workout` when a workout is already active. From a template: exercises, sets (template targets become the set's weight/reps/seconds/distance, `completed=false`), notes and rest (template rest, else app `defaultRestSeconds`, else 120). Empty workouts are named `<Weekday> Workout`. |
| GET | `/workouts/active` | Full nested workout or `null`. |
| GET | `/workouts?limit&offset` | Completed workouts, newest first, as `WorkoutListItem` with `exerciseSummary` (name, set count, best set, PR count per exercise) and totals. |
| GET | `/workouts/stats` | `thisWeek`, `lastWeek`, `weeklyTarget` (health profile `targets.workoutsPerWeek`), `streakWeeks`, `totalWorkouts`, `last`, `volumeByWeek` (12 weeks), `recentPrs` (10, with exercise names). Weeks follow app `weekStartsOn`. |
| GET | `/workouts/calendar?from&to` | `[{ date, workouts: [{ id, name, finishedAt }] }]`, defaults to the last 90 days. |
| GET | `/workouts/:id` | Full nested workout. Each exercise carries `exercise`, `sets` (with `prs`) and `previous`. |
| PATCH | `/workouts/:id` | `name`, `notes`, `startedAt`, `finishedAt`, `durationSeconds`. Changing `finishedAt` on a completed workout replays records. |
| DELETE | `/workouts/:id` | Hard delete; records of the affected exercises are recomputed. |
| POST | `/workouts/:id/discard` | Active workout only: child rows are deleted and the row is kept with `status=discarded`. |
| POST | `/workouts/:id/finish` | See below. |
| POST | `/workouts/:id/exercises` | `{ exerciseId, supersetGroup?, restSeconds? }`; adds the exercise with one empty set and its `previous`. |
| POST | `/workouts/:id/exercises/reorder` | `{ ids }`. |
| PATCH | `/workout-exercises/:id` | `restSeconds`, `notes`, `supersetGroup`. |
| DELETE | `/workout-exercises/:id` | Removes the exercise and its sets. |
| POST | `/workout-exercises/:id/replace` | `{ exerciseId }`: keeps the sets, swaps the exercise, clears PR flags and refreshes `previous`. |
| POST | `/workout-exercises/:id/sets` | Appends a set copying the last set's values (or the matching `previous` set when there is none). |
| PATCH | `/workout-sets/:id` | `WorkoutSetInput`. Completing sets `completedAt` and computes live `prs`; un-completing clears them. |
| DELETE | `/workout-sets/:id` | |
| POST | `/workout-sets/:id/type` | `{ setType: normal, warmup, drop, failure }`. |

Rest timers run on the client. The server only stores `restSeconds` per workout exercise.

### Previous
`previous` on a workout exercise is the list of completed sets (in order, warm-ups included) of the same exercise in the most recent completed workout other than the current one. With `previousSetSource = same_template` only workouts started from the same template count. The client matches rows by index and shows a dash when the previous workout had fewer sets.

## Finish

`POST /workouts/:id/finish` body:

```json
{ "discardIncomplete": true, "templateAction": "keep", "newTemplateName": "...", "newTemplateFolder": null, "durationSeconds": 3600 }
```

1. Empty sets (no reps, or no distance and seconds for cardio, or no seconds for duration) are always dropped. Sets with values that are not completed are dropped when `discardIncomplete` is `true` (default); with `false` the call returns 409 with `details: { incompleteSets, completedSets, emptySets }` so the client can show Strong's "Complete unfinished sets / Discard unfinished sets" dialog (completing them is a client-side loop of set patches).
2. Exercises left without sets are removed.
3. `finishedAt` is now, `durationSeconds` is the given value or `finishedAt - startedAt`.
4. Totals: `totalVolume` and `totalSets` per the volume rules.
5. Records: every completed workout containing each exercise is replayed in chronological order with `evaluateWorkoutPrs`; `personal_records` holds the current best per type, each set's `prs` JSON holds the types it beat at that moment, and `prCount` is the number of such badges in the workout.
6. Template action (`templateChanged` in the response says whether anything was written):
   - `keep` (default): nothing.
   - `update_values`: keep the template's structure, copy performed weight/reps/seconds/distance into matching template sets (matched by exercise and occurrence order, then set index).
   - `update_template`: replace the structure (exercises, order, supersets, set count and types, rest) with the workout's; matching sets keep their old targets, new sets take the performed values.
   - `update_both`: replace structure and values with the workout's.
   - `save_as_template`: create a new template (`newTemplateName` defaults to the workout name, `newTemplateFolder` to My Templates). Returned as `summary.templateId`.
   The `update_*` actions return 400 when the workout was not started from a template. Strong's diff text ("Adds 2 sets.") is derived client-side from the template and workout.
7. The template's `lastPerformedAt` is set and an activity entry is logged.

Response: `{ workout, summary: { durationSeconds, totalVolume, totalSets, prs: [{ exerciseId, exerciseName, type, value, weight, reps, workoutSetId }], templateChanged, templateId } }`. `summary.prs` lists one entry per flagged set and type in set order, so its length equals `workout.prCount`.

## PR rules

- Only completed sets count. Warm-up sets never count; drop and failure sets do.
- Record types by category: barbell, dumbbell, machine, cable: `weight`, `one_rm`, `volume`. `weighted_bodyweight`: `reps`, `weight` (added weight), `volume` (added weight x reps). `bodyweight`, `reps_only`, `assisted_bodyweight`: `reps`. `cardio`: `distance`, `duration`. `duration`: `duration`.
- Weight based records (`weight`, `one_rm`, `volume`) require 1 to 12 reps and a weight above zero. `reps` records have no cap (30 push-ups is a max reps record).
- Ties do not count; a value must be strictly greater. The first ever performance sets records.
- Within a workout, sets are evaluated in order, so a later set that beats an earlier set of the same workout is flagged too.
- Estimated 1RM: hybrid formula by default, Brzycki `w * 36 / (37 - r)` below 10 reps and Epley `w * (1 + r / 30)` from 10 reps; `r = 1` gives `w`. Selectable per `oneRmFormula`; changing it takes effect on the next record replay (finish, edit or delete).
- `bestByReps` (records table): best weight at exactly `n` reps for 1 to 12, and the predicted `n`RM from the highest estimated 1RM; the actual value is shown when it is higher.
- Editing or deleting a past workout, or changing its `finishedAt`, replays the affected exercises from scratch and rewrites `personal_records`, set badges and `prCount`.
- Live badges during an active workout use the stored records (which never include the active workout) plus earlier completed sets of the same exercise in that workout, and are refreshed for the whole exercise on every set change.

## Volume rules

- Barbell, machine, cable: `weight x reps`.
- Dumbbell: `weight x reps`, doubled when `countDumbbellsTwice` is on (off by default).
- Weighted bodyweight: `reps x (weight + bodyweight)` when `includeWeightedBodyweightVolume` is on (default); assisted bodyweight: `reps x (bodyweight - assistance)` when `includeAssistedBodyweightVolume` is on (default). Bodyweight is the latest `weight_logs` row; without one it counts as 0.
- Reps only, bodyweight, cardio and duration add 0.
- Workout `totalVolume` sums completed, non warm-up sets; `totalSets` counts every completed set. The exercise volume chart uses the same rule per workout.

## Seeding

`seedExercises(db)` runs at startup and is idempotent: it inserts any library exercise missing by name (336 built-ins) and creates the five example templates (`Strong 5x5 - Workout A`, `Strong 5x5 - Workout B`, `Legs`, `Back and Biceps`, `Chest and Triceps`) in the `Example Templates` folder unless a template with that name already exists, so deleted or renamed examples stay gone.

## Schema notes

The database schema was not changed. Mappings worth knowing: template folders are the `folder` text column; RPE lives on `workout_sets.rpe`; `personal_records` is unique per exercise and type and holds only current bests (records history is the set badges in workout history); sticky notes, bar types and per-exercise unit overrides from Strong have no column and are not modelled.
