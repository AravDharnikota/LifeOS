# Scheduler, calendar recurrence and task recurrence review

Scope: `packages/shared/src/scheduler.ts`, `apps/server/src/services/{scheduler,calendar,tasks,summary,replan,jobs}.ts`, `apps/server/src/tools/calendar.ts`, their tests and `docs/scheduler.md` / spec §6. Every finding below was reproduced with throwaway scripts run against the real services with `process.env.TZ` set to the named zone (the server does the same in `app.ts:36`). Dates: today is 2026-11-02; `America/Los_Angeles` left DST on 2026-11-01.

Summary: the pure scheduling engine is sound (including across both DST changes). The serious problems are all in recurrence expansion and local-day windowing in `services/calendar.ts` and `services/tasks.ts`, where UTC instants are handed to `rrule` (which reads them as floating local time) and UTC date strings are used as local dates.

---

## Critical

### C1. Recurring timed events are expanded at a fixed UTC time: one hour off after a DST change, and weekly `BYDAY` rules land on the wrong local weekday

`apps/server/src/services/calendar.ts:223-233` builds `dtstart = new Date(r.start)` (a UTC instant) and lets `rrule` iterate it. `rrule` treats the Date's **UTC** fields as the floating local time of the rule, so the time of day and the weekday are both taken from UTC.

Reproduction (TZ=America/Los_Angeles):

| Input | Expected | Actual |
| --- | --- | --- |
| `FREQ=DAILY`, start 2026-10-26 09:00 PDT (`16:00Z`); list Oct 31 to Nov 3 | 09:00 local every day | Oct 31 09:00, then **08:00** on Nov 1, 2, 3 (`16:00Z` kept) |
| `FREQ=WEEKLY;BYDAY=MO`, start Mon 2026-11-02 18:00 PST (`2026-11-03T02:00Z`, a Tuesday in UTC); list Nov 2 to 16 | Mon Nov 2, 9, 16 at 18:00 | **Sun** Nov 8 and **Sun** Nov 15 at 18:00; the Nov 2 occurrence is missing entirely |
| `FREQ=DAILY`, start 2026-11-01 00:00 PDT; `eventsOnDate("2026-11-02")` | Nov 2 00:00 | Nov 2 **23:00** |

Consequences: every local series created before Nov 1 is currently displayed an hour early; `services/scheduler.ts:213` feeds these instances to `scheduleTasks` as busy time, so the scheduler now reserves the wrong hour and places time boxes over the real meeting; exception keys built from the real instance time (for example the `originalStart` of Google instances of a series we pushed) no longer match the expanded start, so the exception is dropped and the un-shifted instance is shown instead (see H1/H2 for how an unmatched exception disappears).

Fix: expand in floating local time and convert back, since the process runs in the user's zone:

```ts
const toFloating = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
const fromFloating = (d: Date) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
const dtstart = r.allDay ? new Date(r.start + "T00:00:00Z") : toFloating(new Date(r.start));
const occ = rule.between(toFloating(windowStart), new Date(toFloating(to).getTime() - 1), true); // exclusive `to`, see M1
const start = r.allDay ? occ.toISOString().slice(0, 10) : fromFloating(occ).toISOString();
const end = r.allDay ? ... : new Date(fromFloating(occ).getTime() + durMs).toISOString();
```

Verified with a script: this yields Mon Nov 2/9/16 18:00 and 09:00 on every day across Nov 1. `UNTIL=...Z` values should be converted the same way (`toFloating`) before building the rule, otherwise an UNTIL expressed in UTC is compared against floating local times. (`rrule`'s `tzid` option is an alternative but it rebuilds offsets through `toLocaleString` parsing and is slower; the explicit conversion is deterministic.) Add tests that run `listEvents` under `TZ=America/Los_Angeles` spanning 2026-11-01 and 2026-03-08.

---

## High

### H1. An occurrence moved to another day disappears, and the original still shows

`calendar.ts:182-199` fetches exception rows only when their **current** `start/end` overlap the window; `calendar.ts:245-251` then skips any exception whose parent row was fetched, and the parent is fetched whenever `start <= to` (`calendar.ts:190`), which is almost always.

Reproduction: `Gym` daily `COUNT=5` from Nov 2 20:00Z; `overrideInstance(parent, "2026-11-04T20:00:00.000Z", { start: "2026-11-20T20:00Z", end: "2026-11-20T21:00Z" })`.
- `listEvents(Nov 4)`: expected nothing; actual the original 20:00 instance (the exception row is outside the window, so the key lookup at `calendar.ts:234` misses).
- `listEvents(Nov 20)`: expected one Gym; actual **nothing** (the row is fetched but skipped because the parent is "included"; the parent expands no occurrence on Nov 20).

Fix: fetch exception rows by `originalStart` as well as by current time, that is add `and(recurrenceParentId IS NOT NULL, originalStart >= windowStart, originalStart <= to)` to the `or(...)` (or simply load all exceptions of the recurring masters that were selected); in the final loop emit any exception whose parent produced no matching occurrence instead of skipping on `parentIncluded`. A test: move an instance to another week and list both weeks.

### H2. REST `scope: "this"` never normalises `originalStart` (or `start`/`end`), so the exception is silently ignored

`routes/calendar.ts:66` and `:78` pass the client's `originalStart` straight to `overrideInstance`; `calendar.ts:163` stores it and `calendar.ts:234` looks up exceptions by the exact string `${id}|${occ.toISOString()}` (millisecond `.000Z` form). The agent tools normalise (`tools/calendar.ts:41-44, 68, 196`), the REST route does not. `overrideInstance` also skips `validateRange`/`normalize` for the patch, unlike `createEvent`/`updateEvent`.

Reproduction: `PATCH /api/events/:id {scope:"this", originalStart:"2026-11-03T17:00:00Z", start:"2026-11-03T18:00:00Z", end:"2026-11-03T18:30:00Z"}` returns 200 with `start: "2026-11-03T18:00:00Z"` (not normalised) and `originalStart: "2026-11-03T17:00:00Z"`; listing Nov 2 to 7 still shows the untouched 17:00 instance on Nov 3 and the moved one is never shown. A value with an offset (`-08:00`) would additionally break the lexical `start < to` SQL comparisons at `calendar.ts:192`.

Fix: in `overrideInstance`, normalise `originalStart` (`new Date(s).toISOString()`, or `slice(0,10)` for all-day parents) and run `validateRange`/`normalize` on the resulting `start`/`end`; do the same in the route for consistency with the tools.

### H3. All-day events are shown on the wrong day (recurring: a day early; single: tomorrow's appear today)

Two separate mistakes:
- Recurring all-day masters (`calendar.ts:223,230-233`) are iterated at `00:00Z` but the window `[from, to]` is the UTC instant of local midnight (`2026-11-02T08:00Z` in LA), so the window `(Nov 2 07:59Z, Nov 3 08:00Z]` contains the Nov 3 instance and not the Nov 2 one.
- Single all-day rows (`calendar.ts:179-180,194`) use `opts.from.slice(0,10)` / `opts.to.slice(0,10)` (UTC dates) with `lte(start, toDate)`, which is inclusive of the exclusive `to` boundary.

Reproduction (TZ=America/Los_Angeles): weekly all-day `Trash day` on Mondays; `eventsOnDate("2026-11-02")` returns no Trash day, `eventsOnDate("2026-11-01")` (Sunday) returns the Nov 2 instance. Single all-day `Dentist` on Nov 3: `eventsOnDate("2026-11-02")` includes it. In UTC the second case still reproduces (`to` inclusive). These feed `getDaySummary`, the agent prompt's "Today's events" and `get_day_events`.

Fix: derive local dates from the window, `fromDate = toDateString(from)`, `lastDate = toDateString(new Date(to.getTime() - 1))`, use `lte(start, lastDate)`/`gte(end, fromDate)` for single rows, and for all-day masters call `rule.between(new Date(fromDate + "T00:00:00Z"), new Date(lastDate + "T00:00:00Z"), true)`.

### H4. Task recurrence computes the next due date from a local-midnight Date that `rrule` reads as UTC: wrong weekday in zones east of UTC

`services/tasks.ts:233-234`: `base = parseDateString(dueDate)` is local midnight; `rrule` reads its UTC fields, so in `Asia/Kolkata` Mon 2026-11-02 00:00 is Sun 18:30Z.

Reproduction: `FREQ=WEEKLY;BYDAY=MO`, dueDate 2026-11-02 (Monday), complete it. Expected next 2026-11-09. Actual in `Asia/Kolkata` and `Europe/Berlin`: **2026-11-03 (Tuesday)**, and each subsequent completion keeps landing on Tuesdays. Same for `DTSTART`-prefixed strings. Correct in `America/Los_Angeles` only because a negative offset keeps the UTC weekday.

Fix: do the recurrence maths in UTC-floating form and read UTC fields back:

```ts
const [y, m, d] = existing.dueDate.split("-").map(Number);
const base = new Date(Date.UTC(y!, m! - 1, d!));
const next = new RRule({ ...rule.origOptions, dtstart: base }).after(base, false);
const dueDate = next && next.toISOString().slice(0, 10);
```

Verified: gives 2026-11-09 in both zones.

### H5. Tasks completed after 16:00 PST are counted as done tomorrow

`services/tasks.ts:76` (`today` view, done half) and `:284` (`tasksDoneOn`, used by `getDaySummary` and `getWeekSummary`) compare `substr(completedAt, 1, 10)` (a UTC date) with a local `YYYY-MM-DD`.

Reproduction (TZ=America/Los_Angeles): a task with `completedAt = 2026-11-03T01:30:00Z` (Nov 2 17:30 PST). `tasksDoneOn("2026-11-02") = 0`, `tasksDoneOn("2026-11-03") = 1`; the today view for Nov 2 lists no done tasks and Nov 3 lists it.

Fix: compare against the local day's UTC bounds, for example `completedAt >= localDayBounds(date).startIso AND completedAt < localDayBounds(date).endIso` (helper already exists in `services/summary.ts:92-96`), or store a local `completedDate` column.

---

## Medium

### M1. `listEvents`' `to` is inclusive for recurring instances (and all-day rows)

`calendar.ts:231` calls `rule.between(windowStart, to, true)`; the `true` makes both bounds inclusive, so an occurrence starting exactly at `to` is emitted although the contract (`calendar.ts:175`) is `[from, to)`. Reproduction in UTC: daily event at 00:00; `eventsOnDate("2026-11-02")` returns both the Nov 2 and the **Nov 3** instance. A weekly all-day Monday series listed for the week `Nov 2 00:00 .. Nov 9 00:00` returns Nov 2 and Nov 9 (see H3 for the single-row variant). Fix: pass `new Date(to.getTime() - 1)` as the upper bound (and the local-date fix from H3).

### M2. `eventsOnDate` assumes a 24-hour day

`calendar.ts:258-259`: `end = start + 24h`. On the fall-back day the local day has 25 hours, on the spring-forward day 23. Reproduction (LA): event 2026-11-01 23:30 to 23:45; `eventsOnDate("2026-11-01")` returns nothing and `eventsOnDate("2026-11-02")` returns nothing either, so it vanishes from day views, the day summary and the agent prompt. On 2026-03-08 the window instead reaches 01:00 of Mar 9. Fix: `end = new Date(addDaysString(date, 1) + "T00:00:00")` exactly as `summary.localDayBounds` does, or reuse that helper.

### M3. `COUNT`-limited task recurrences never end

`tasks.ts:234` rebuilds the rule with `dtstart` reset to the current `dueDate` on every completion, so `COUNT` restarts each time. Reproduction: `FREQ=DAILY;COUNT=2` due 2026-11-02; completing it four times spawns Nov 3, 4, 5, 6 (expected Nov 3 only). Fix: keep the original anchor. Either store the series' first due date (a `DTSTART` line in `recurrence`, which `RRule.fromString` already understands) and count from it, or decrement/strip `COUNT` when copying the rule to the spawned task.

### M4. All-day exceptions are written with ISO-datetime `end` values and lose multi-day length

`overrideInstance` (`calendar.ts:137,144`) computes `durMs` from the parent's `YYYY-MM-DD` strings and writes `end = new Date(originalStart + durMs).toISOString()` with no `normalize`. Reproduction: all-day daily series, `overrideInstance(id, "2026-11-03", { title })` stores `start = "2026-11-03"`, `end = "2026-11-03T00:00:00.000Z"`, `allDay = true`, which breaks the `lte/gte` date comparisons and the web's `allDayForDay`. Separately, `calendar.ts:220` sets `durMs = 0` for all-day masters so a 3-day all-day series expands to single-day instances. Fix: for all-day parents, carry the day span (`daysBetween(parent.start, parent.end)`) and write `end = addDaysString(startDate, span)`; run `normalize` on the exception's start/end.

### M5. Any task with a time box is a candidate and all its unlocked boxes, even beyond the horizon, are pulled into the current week

`services/scheduler.ts:183-184` adds `hasTimebox` tasks regardless of due date, and `loadExistingBlocks` (`:195-210`) loads blocks with no date bound; in the engine they become `reusable` (`shared/scheduler.ts:262`) and are moved in place. Reproduction (engine, LA, horizon 7 from Nov 2): task due 2026-12-20 with an unlocked block on Nov 12 09:00 is re-placed to Nov 2 09:00. A user who drags a block to next week without locking it will see it jump back on the next 30-minute auto run. Fix: either treat blocks outside the horizon as kept (count their minutes, do not reuse them) or exclude such tasks from the automatic candidate set unless a block falls inside the horizon; document the choice in `docs/scheduler.md`.

### M6. Deleting a modified occurrence through its row id resurrects the original instance

An exception row is emitted with its own id (`calendar.ts:237`). `delete_event` with that id resolves to a plain `deleteEvent` (`tools/calendar.ts:209-214`), soft-deleting the exception; on the next listing the parent expands the original occurrence again. The web avoids this by always sending `scope=this` with `originalStart` (`useCalendarData.ts:97`), the tools do not. Fix: in `deleteEvent`/`resolveTarget`, when the row has `recurrenceParentId`, cancel it (`status = "cancelled"`) instead of soft-deleting, or route to `overrideInstance(parent, originalStart, { cancel: true })`.

---

## Low

### L1. Re-placing an in-progress block throws away the elapsed minutes
`shared/scheduler.ts:255-262`: an unlocked block that is in progress but no longer `insideFree` (a meeting was just added over its tail) is not kept, so the whole estimate is placed again. Reproduction: block 09:00-10:00, now 09:40, meeting 09:50-10:30 added: result is a fresh 60-minute block at 10:45 (expected ~20 minutes). Fix: when `iv.start < nowMin`, credit `nowMin - iv.start` to `keptMinutes` before treating the rest as reusable.

### L2. A task already covered by past boxes is reported as "could not be placed"
`shared/scheduler.ts:408` returns the reason `Earlier time boxes already cover the estimate` and `services/scheduler.ts:344-347` counts it in `unplaced` and the summary ("1 task could not be placed"). Report it separately (or not at all) and do not count it as unplaced.

### L3. `complete_task` claims `nextOccurrenceCreated: true` unconditionally
`tools/tasks.ts:175` derives it from `recurrence && dueDate`, which is also true when `after()` returned null (UNTIL passed) or the rule failed to parse (`tasks.ts:254` only logs). Return the spawned task's id from `completeTask` instead.

### L4. `snapMinutes` values that do not divide 60 misalign the grid with work hours
`schemas.ts:607` allows any integer 5..60; the grid is anchored at local midnight, so `snapMinutes = 25` turns a 09:00 start into 09:10 and a 30-minute estimate into 50 minutes. Restrict to divisors of 60 (5, 10, 12, 15, 20, 30, 60).

### L5. An instance that ends exactly at `from` is included
`calendar.ts:230` uses `from - durMs - 1`, which admits an occurrence with `end == from`. Reproduction (any zone): daily 23:00-00:00 event; `eventsOnDate("2026-11-03")` returns the Nov 2 and the Nov 3 instance. Use `from - durMs + 1` (an occurrence must satisfy `start + durMs > from`).

### L6. `between(...)` materialises every occurrence before `.slice(0, 400)`
`calendar.ts:231`. A `FREQ=MINUTELY` or `FREQ=SECONDLY` rule over a 30-day range (the scheduler horizon or the export route's two-year range) allocates millions of Dates. Use the iterator form `rule.between(a, b, true, (date, i) => i < 400)` and reject sub-hourly frequencies in `createEvent`/`updateEvent`.

### L7. Stored `rrule` strings are never validated
`calendar.ts:226-229` swallows parse errors at read time and silently shows the master as a one-off. A rule containing a `DTSTART` line, a typo, or `RRULE:` plus `EXDATE` lines becomes non-recurring with no feedback. Parse in `createEvent`/`updateEvent` and reject with 400.

### L8. `upcoming` view condition is loose
`tasks.ts:82`: `(due > today OR start > today) AND (due <= +30 OR start <= +30)`. A task with `startDate` in the past and `dueDate` 40 days out passes both halves. Pair the comparisons per field.

### L9. Time boxes of cancelled tasks stay forever and count as busy
`tasks.ts:189-192` sets `status = "cancelled"` without touching events; `services/scheduler.ts:214-215` only exempts candidates' boxes. Delete future boxes on cancel like `completeTask` does (`tasks.ts:219-222`).

### L10. A candidate's `tentative` time box is neither busy nor an existing block
`loadExistingBlocks` requires `status = "confirmed"` (`services/scheduler.ts:202`) while `busyIntervals` (`:214-215`) drops every timebox of a candidate regardless of status, so a tentative box can be double-booked. Drop only confirmed candidate boxes from busy.

### L11. `applyPlan` is not transactional
`services/scheduler.ts:245-271` creates, moves and deletes events one by one; an error midway leaves a half-applied plan and no `scheduler_runs` row. Wrap in `db.transaction`.

---

## Verified OK

- **Engine across DST** (TZ=America/Los_Angeles, runs spanning 2026-11-01 and 2026-03-08): blocks land at 09:00 local on both sides, the Saturday 10:00-14:00 window and the `sun: null` day are honoured, nothing is placed before `now`, the local-midnight-anchored grid (`localAt`, `midnight`) stays aligned through the 25-/23-hour days, deadlines without a time resolve to the next local midnight.
- **Lunch, busy intervals, buffers**: busy intervals are widened to whole minutes (`isoInterval`), padded by the buffer on both sides and snapped inward; lunch is subtracted before snapping; consecutive blocks of different tasks and chunks of the same task keep the buffer (`placeTask` cuts with buffer). No one-minute overlaps found.
- **Splitting**: estimates are snapped up to the grid, so `remaining` is always a grid multiple; `chunkSize` never leaves a remainder below `minBlockMinutes` and rejects slots that would; tasks shorter than the minimum are placed whole; whole-fit-later-same-day is skipped when it would cross the deadline.
- **Ordering**: score formula matches `docs/scheduler.md`; EDF fallback keeps the better of the two simulations; ties are deterministic.
- **Stability**: locked blocks are never moved or removed and count as busy; unlocked blocks within 60 minutes (or in progress) are kept when still in free time; past blocks are credited; identical intervals keep their row id; `removedBlockIds` only ever contains the candidates' own unlocked blocks, so restricted `taskIds` runs leave other tasks' boxes alone (they count as busy).
- **Horizon**: `loadCandidates` uses `today + h - 1` (inclusive), `dayWindows` iterates `i < h`, busy time is fetched to `today + h` midnight: consistent and end-exclusive.
- **Estimates and calibration**: `snapUpTo` rounds up with a floor of one grid step; calibration takes the newest 20 rows with a positive estimate, median of actual/estimate, shrink `(n·m + 5)/(n + 5)`, clamp `[0.75, 2]`, applied only to `source: "task"`; `learnedEstimate` title overlap ≥ 0.5 then list median with ≥ 3 samples.
- **completeTask**: deletes only future boxes (`start > now`), credits past box minutes via `timeboxedMinutes`, writes `duration_history`; monthly recurrence from Jan 31 skips to Mar 31 (standard), weekly `BYDAY` from a non-matching due date advances to the next matching weekday, `DTSTART:`/`RRULE:`-prefixed strings parse.
- **summary.ts**: `localDayBounds` uses `addDaysString` (DST-safe); `weekBounds` honours `weekStartsOn` via date-fns `startOfWeek`, end exclusive; `getWeekSummary` reports the inclusive last day.
- **find_free_time**: windows are local 08:00-22:00 per day, `to` is inclusive of the day as documented, busy intervals are merged, gap edges snap inward to the 15-minute grid, meetings straddling window edges are handled, all-day events are ignored as documented.
- **Instance ids**: `<uuid>_<start>` split at the first underscore is safe because ids are UUIDs; the tool path normalises `originalStart` for timed parents and keeps `YYYY-MM-DD` for all-day parents; `deleteEvent` on a master soft-deletes its exceptions.
- **replan.ts / jobs.ts**: pure interval timers, debounce coalesces bursts, nothing date-dependent.
