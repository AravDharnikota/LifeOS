# Time-boxing scheduler

The scheduler turns open tasks into time boxes: calendar events with `kind = "timebox"` on the "Time boxes" calendar, one or more per task. It is deterministic, runs in a few milliseconds, and always diffs against the blocks that already exist so the calendar does not churn.

Code: the pure engine lives in `packages/shared/src/scheduler.ts` (`scheduleTasks`), the server glue in `apps/server/src/services/scheduler.ts`.

## What gets scheduled

A task is a candidate when it is open, top level (no parent) and either

- has a due date or a start date on or before the last day of the horizon (overdue tasks count), or
- already has a time box.

A run can be restricted to specific `taskIds`; other tasks' time boxes then count as busy time.

## How a run decides

1. **Free time.** For each day in the horizon take the work hours for that weekday, remove lunch, then remove every busy interval (timed, non-cancelled events that are not the candidates' own time boxes) padded by the buffer on both sides. Slot edges snap to the grid. Nothing is placed before now, rounded up to the grid, and nothing on a weekday whose hours are `null`.
2. **Estimates.** Each task needs a duration (see Learning). The estimate is rounded up to the grid. Time already boxed in the past, locked blocks and frozen blocks are subtracted, so only the remaining work is placed.
3. **What stays put.** Locked blocks (`locked = true`) are never moved or removed and count as busy. Unlocked blocks that start within 60 minutes (or are in progress) stay where they are as long as they still sit in free time; otherwise they are re-placed. Past blocks are left alone and count as time spent.
4. **Order.** Every task gets a score:

   ```
   urgency  = due ? clamp(1 - slackHours / 168, 0, 1) : 0.15   (slack = hours to deadline - remaining hours)
   priority = {3: 1.0, 2: 0.7, 1: 0.4, 0: 0.2}
   age      = min(days since created / 14, 1)
   size     = remaining <= 30 min ? 0.05 : 0
   score    = 0.55 urgency + 0.30 priority + 0.10 age + size
   ```

   Tasks are placed in score order (ties by creation time). If that leaves a deadline unmet, the dated tasks are re-run earliest-deadline-first (then the rest by score) and the order that misses fewer deadlines wins.
5. **Placement.** Each task walks the free slots from its start floor (now, or its start date) and takes the earliest fit. A chunk is at most `maxBlockMinutes`, at least `minBlockMinutes` unless the whole task is shorter, and a split never leaves a remainder below the minimum. A task that would be split around a meeting but fits whole later the same day takes the later slot, unless that would cross its deadline. A buffer is reserved after every block. A deadline without a time means the end of that day; with a time (`dueTime`) the task should finish before it. When it cannot, it is placed as early as possible anyway and reported as **at risk**.
6. **Diff.** New chunks reuse the task's existing unlocked blocks: identical times keep their row, other rows are moved in place, leftovers are deleted. Only then are events created, updated or removed through the calendar service, a `scheduler_runs` row is written and one activity entry is logged. A dry run skips all writes.

Tasks that do not fit in the horizon are listed in `unplaced` with a reason, including the partial case ("Only 60 of 120 minutes fit").

## Preferences

Stored under the `scheduler` settings key (`PATCH /api/settings/scheduler`).

| Pref | Default | Meaning |
| --- | --- | --- |
| `workHours` | Mon to Fri 09:00 to 18:00, Sat 10:00 to 14:00, Sun `null` | Window per weekday; `null` means never schedule that day |
| `lunch` | 12:30 to 13:15 | Removed from every work day; `null` disables it |
| `bufferMinutes` | 10 | Gap kept after events and between blocks |
| `minBlockMinutes` | 25 | Smallest chunk of a split task |
| `maxBlockMinutes` | 90 | Longest single block; longer tasks are split |
| `snapMinutes` | 15 | Grid for block edges and durations |
| `defaultEstimateMinutes` | 30 | Used when nothing else gives a duration |
| `horizonDays` | 7 | Days planned ahead, counting today |
| `autoRun` | true | Lets the background job run the scheduler |

## Learning

Completing a task writes a `duration_history` row (estimate, actual minutes, title, list, tags). The scheduler uses it in two ways.

- **Estimates** for tasks without one: the median actual of past tasks whose title shares at least half its words, otherwise the median of the same list when it has at least three samples, otherwise an AI estimate (`estimateDurations`, batched, only when AI is enabled and skipped on error), otherwise `defaultEstimateMinutes`. `POST /api/scheduler/estimate` shows which source was used.
- **Calibration** of the user's own estimates: the median of actual / estimate over the last 20 rows, shrunk toward 1 by `(n * median + 5) / (n + 5)` and clamped to 0.75 to 2.0. Only estimates typed by the user are multiplied; the task's own `estimateMinutes` field is never changed. `GET /api/scheduler/stats` reports the factor, the history size and the mean absolute error.

## Triggering a run

- **API**: `POST /api/scheduler/run` with an optional body `{ dryRun, horizonDays, taskIds }` returns `{ placed, unplaced, moved, summary }`. `GET /api/scheduler/runs` lists the last 20 runs, `GET /api/scheduler/stats` the learning stats, `POST /api/scheduler/estimate { taskIds }` the estimates.
- **Agent and MCP tools**: `plan_schedule` (`{ dryRun?, horizonDays? }`) and the read-only `get_schedule_stats`.
- **Background job**: `services/jobs.ts` calls `runSchedulerIfEnabled(ctx, "auto")` every 30 minutes; it does nothing while `autoRun` is false.

Each run is recorded in `scheduler_runs` with its trigger (`manual`, `mcp`, `agent`, `auto`), counts and a JSON summary.
