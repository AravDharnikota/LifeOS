# Calendar + Tasks: UX and System Spec

Status: research-backed proposal, 2026-11-02. Scope: the combined calendar/task module of AravOS (web + iOS via Capacitor). Stack assumptions from the repo: React 19 + Tailwind 4 + TanStack Query + Zustand + `chrono-node` on the client; Hono + SQLite (better-sqlite3) + Drizzle + `rrule` + `date-fns-tz` on the server; single user authenticated with a bearer token; Google OAuth redirect at `/api/google/callback`; `ARAVOS_TIMEZONE` for the user's home zone.

Positioning: one timeline for events *and* work, tasks that can be dragged into time, and an auto-planner that fills the gaps and re-plans when the day slips. Simpler than Google Calendar (fewer views, no settings sprawl), more opinionated than Google Tasks (estimates, "when" vs "deadline", time-boxing), and it syncs both ways so the user is never locked in.

---

## 1. What the best apps do (and what we take)

| App | Signature interactions (verified against sources in §11) | We take |
|---|---|---|
| **Amie** | Todos listed beside the week timeline; drag a todo onto the timeline to make it a time block; scheduled todos keep their checkbox; AI "shuffles your schedule" when plans change; focus timer | Todo rail next to the timeline with drag-to-schedule; checkbox inside the block |
| **Notion Calendar (Cron)** | Keyboard-first: `C` create at selected slot, `T` today, `D/W/M` views, `K`/`Cmd+K` command menu, `?` cheat sheet, `Z` time-zone travel; time-zone columns to the left of the grid, right-most column is primary; detects travel and offers to switch primary zone | Shortcut set, command palette, `?` overlay; time-zone strip as a nice-to-have |
| **Fantastical** | Single sentence input with a live preview that updates as you type ("Haircut tomorrow at Quick Cuts 10am alert 30 minutes"), `/w` picks calendar, `at` location, `every Tuesday until 2/5`, `todo`/`task` prefix switches to a task, `!!!` priority, quotes protect literal text; DayTicker (week strip above a day list; pull down to expand into a month) | Quick-capture grammar, live chips, task/event toggle, week strip that pulls down into a month |
| **Sunsama** | Daily planning ritual: review yesterday, pull tasks in, set *planned time* on each, workload check against a threshold (suggests ~5.5 h for a 9–5), timebox to calendar, shutdown that pushes leftovers to tomorrow; planned vs actual time via timer | "Plan my day" review sheet, workload meter, end-of-day sweep, planned vs actual logging |
| **Akiflow** | Command bar (`Alt/Opt`) captures from anywhere; type a name + Enter → Inbox; NL recognition for dates where Backspace/Esc removes a recognised phrase but keeps the title; snooze with "last used"; drag tasks onto the calendar | Chip-removal semantics in quick capture, global shortcut, "snooze" presets |
| **Morgen** | AI planner proposes blocks as a *preview* using "Frames" (ideal-week templates); nothing moves until you confirm; flags tasks "at risk of being late" | Preview-then-confirm for the first plan of the day; at-risk flag |
| **Motion** | Fully automatic: ranks by priority (ASAP/High/Medium/Low) + deadline + duration; needs a duration; start date gates scheduling; chunks long tasks with a minimum chunk; schedules within named schedules (work/personal); "Hard deadline" may go outside the schedule; breaks "15 min every 2 h"; external Busy events always win; past-due → next slot; "Could not fit" warning; lock a task when timing is critical | Ranking inputs, min/max chunk, schedules, hard-deadline escape hatch, breaks, lock |
| **Reclaim** | Tasks have duration (min 15), min/max *event* duration (max is also used to space sessions out so blocks aren't back-to-back), due date (default +3 d), earliest start, hours profile, P1–P4 where P1 can overbook lower; non-Reclaim events are P1 and never overbooked; task events start Free and flip to Busy as the due date gets at risk; reacts to conflicts in ~15 s; Habits = min/ideal/max duration in a window with an ideal time and "time defense" | Spacing rule, free→busy flip for mirrored blocks, at-risk logic, habits as v2 |
| **Vimcal** | `Z` time travel, Cmd+K palette, drag "Slots" to share availability as text | Time travel (nice), availability slots (later) |
| **Structured** | One vertical timeline of the day mixing tasks, events, routines; drag-and-drop; Inbox for unscheduled; "Replan" sweeps missed tasks; swipe actions in Inbox; subtasks directly in the timeline | Mobile day timeline as the primary view; Replan sweep |
| **Things 3** | Today / This Evening / Upcoming / Anytime / Someday / Logbook; **When** (start) separated from **Deadline**; calendar events shown above to-dos in Today/Upcoming; Magic Plus drag to position; shortcuts `Cmd+S` when, `Shift+Cmd+D` deadline, `Cmd+T` today, `Cmd+E` evening, `Cmd+K` complete, `Cmd+1..6` lists | List taxonomy, When vs Deadline, events inside task lists, shortcut bindings |
| **Todoist** | Quick Add: NL dates, `#project`, `/section`, `%label` (`@` retiring), `p1..p3`, `!time` reminder, `{date}` deadline, `every mon, fri at 20:00`, `every! 3 hours` (from completion), `for 1h15m` duration, `Q` opens Quick Add; clicking a calendar slot opens Quick Add with a 30-min default; drag bottom edge to resize | `every!` semantics, duration token, calendar-click-to-capture |
| **TickTick** | "Arrange tasks" side panel of undated tasks in calendar view (sort by list/tag/priority), drag into slots, 30-min minimum, view options to show/hide completed | Rail filters, show-completed toggle |
| **Apple Reminders** | Smart Lists (Today, Scheduled, Flagged, All, Completed); swipe right → Indent (subtask) or drag onto another item; sections with column view; quick toolbar (date, time, location, flag) under the keyboard | Swipe-to-indent, keyboard quick toolbar |

What none of them do well together, and what we optimise for: (1) tasks and events in one vertical timeline on the phone with *drag from a rail*, (2) auto-planning that is a preview you can accept in one tap, (3) honest "planned vs actual" that improves the planner, (4) two-way Google sync that is invisible.

---

## 2. Prioritised interaction list

### Must-have (v1)
1. **Quick capture** (`Q`/FAB/global shortcut): one input, chrono-node dates, `#list`, `@tag`, `!`–`!!!`/`p1–p4`, `30m`/`for 1h`, `every …`, `by <date>` = deadline, bare date = scheduled "when"; live chips; task/event auto-detect with toggle; Enter saves, `Cmd+Enter` saves and keeps the sheet open.
2. **Day timeline (mobile)** with week strip, all-day row, now line, auto-scroll to now, horizontal swipe between days, pull-down month.
3. **Week grid (desktop)** with Day/3-day/Week/Month switch, drag-to-create, drag-to-move, drag handle to resize, 15-min magnetic snapping, overlap column packing.
4. **Task rail** (desktop right rail; mobile bottom sheet) listing unplanned tasks; **drag a task onto the timeline** to create a locked time block sized to its estimate.
5. **Time blocks as distinct blocks**: dashed border, checkbox, est chip, progress fill when in progress, fade when done, amber when missed.
6. **Tasks screen**: Today (Overdue, Scheduled, Due, Evening), Upcoming (by day, events included), Anytime (by list), Someday, Logbook; inline edit; swipe right complete; swipe left schedule/plan; subtasks; priority; est chips; due vs scheduled badges.
7. **Auto-planner** (§6): runs on triggers, fills free time within availability, respects buffers/breaks/caps, chunks long tasks, re-plans on slips, marks at-risk, learns a calibration factor from actuals. First run of the day shows a **"Plan my day"** review sheet (accept / adjust).
8. **Google Calendar two-way sync** (§7) with incremental `syncToken`, push channels + polling fallback, etag/If-Match, tombstones; **Google Tasks two-way sync** by polling `updatedMin`.
9. **Event/task/time-block detail sheet** (§5) with inline editing, RSVP, join link, replan/lock/log-time actions.
10. **Keyboard shortcuts** (§5.6) and `Cmd+K` palette on web.
11. **Undo** for complete/delete/move (toast, 6 s) and `Cmd+Z` on web.

### Should-have (v1.1)
12. Timer on a time block (start/stop → actual minutes); "didn't finish → remaining" slider.
13. End-of-day sweep ("Replan"): unfinished blocks → remaining minutes → re-plan tomorrow; prompt at shutdown time.
14. Workload meter in "Plan my day" (planned minutes vs daily cap, Sunsama-style warning).
15. Agenda list view (desktop) and 3-day landscape view (mobile).
16. Mirror time blocks into Google Calendar as events (Free by default; Busy when at risk).
17. Natural-language recurrence beyond rrule's `fromText` (`every other tue`, `every 2nd fri`, `every weekday`, `every! 3 days`).

### Nice-to-have (v2)
18. Habits/routines with window + ideal time + min/max duration (Reclaim), protected by the planner.
19. Time-zone strip and `Z` travel (Cron/Vimcal).
20. Availability "Slots" drag-to-share.
21. Pinch-zoom hour height; snapping to neighbouring event edges.
22. Voice capture; Siri/Shortcuts intents via Capacitor.
23. Widgets / Live Activity for the current block (Structured).

---

## 3. Calendar screen

### 3.1 Mobile (iOS, 390×844 reference)

```
┌──────────────────────────────────────┐
│ November 2026        🔍   ⊙today   + │  header 44pt; title tap → month picker
│ M  T  W  T  F  S  S                  │  week strip 56pt; selected day = filled pill;
│ 2  3  4 [5] 6  7  8                  │  under each day: ●● event dots + a thin task-load bar
│  •• ▂   •▅  •▃                       │  swipe strip ⇄ pages weeks; pull strip ↓ = month grid
├──────────────────────────────────────┤
│ all-day  [Dentist bill due] [+1]     │  all-day row ≤2 rows then "+n"; collapsible
├──────────────────────────────────────┤
│  9 ─┬─────────────────────────────   │  hour gutter 44pt; 64pt per hour (pinch 48–96 v2)
│     │ ▌Standup            9:00–9:30  │  event: 2pt left stripe in calendar colour, 8pt radius
│ 10 ─┤                                │
│     │ ┆ ☐ Write proposal   45m ┆     │  time block: 1.5pt dashed border, 12% tint, checkbox
│ 11 ─┤ ┆▓▓▓▓▓▓░░░░░░░░░░░░░░░░┆       │  in-progress: progress fill from top (planned elapsed)
│  ●━━━━━━━━━━━━━━━━━━━━━━━━━ 11:20    │  now line: 2pt accent, left dot, time label in gutter
│ 12 ─┤ ▌Lunch w/ Sam  12:00–1:00      │
│  1 ─┤ ┆ ☑ Reply to lease  15m ┆      │  done: filled check, strikethrough, opacity .45
│  2 ─┤ ┆ ☐ Gym (missed)   1h   ┆      │  missed: amber outline + "Didn't finish?" on tap
│     │                                │
│ ═══ Unplanned · 5 tasks · 2h 15m ═══ │  bottom sheet handle (collapsed 48pt)
│ ☐ Call plumber        30m  !!        │  expanded: half-height list; drag a row up onto
│ ☐ Draft birthday msg  15m            │  the timeline → ghost block of est length, snaps 15m
│ ☐ Book flights        1h   due Fri   │  haptic (Capacitor Haptics) on each snap
└──────────────────────────────────────┘
  [Today] [Calendar] [Tasks] [More]        tab bar; FAB "+" bottom-right above the sheet
```

Interactions
- **Navigate**: horizontal swipe on the timeline = previous/next day (paged, spring); vertical scroll inside the day; tapping a strip day jumps; `⊙today` re-centres and scrolls to now − 1 h. Scroll offset is preserved across days.
- **Create**: long-press empty timeline → ghost block at the snapped 15-min slot (default 30 min for events, est for tasks) with an inline title field; the Task/Event toggle sits in the field. Tapping the FAB opens Quick Capture prefilled with the selected day.
- **Move**: long-press a block → lifts (scale 1.03, shadow), drag; time label follows; drop snaps. Dragging to the top/bottom edge auto-scrolls; dragging onto the week strip moves to another day.
- **Resize**: select a block → bottom handle (44pt hit area, 20pt visual) appears; drag changes end in 15-min steps; minimum 15 min.
- **Complete**: tap the checkbox inside a time block → block fades, task completes (undo toast). Tapping the body opens the detail sheet.
- **Task rail**: handle shows count and total estimate; expanded sheet lists tasks sorted by planner score; filter chips All / Due soon / List. Drag out of the sheet onto the timeline creates a **locked** block (origin `manual`). Dragging a block back into the sheet unplans it.
- **Plan my day**: on first open of a day with unplanned tasks, a pill under the header: "Plan 5 tasks · 2h 15m". Tap → runs the planner and shows the review sheet (list of proposed blocks with times, "Accept all", per-row remove/lock; "Adjust" toggles the daily cap and work hours).
- **Overdue/missed**: a block whose end passed without completion gets an amber outline; tapping offers *Done*, *Didn't finish → remaining 20m* (slider in 5-min steps), *Skip today*. The planner re-plans on the answer.
- Landscape (v1.1): 3-day columns.

### 3.2 Desktop (≥1024px)

```
┌─ sidebar 260 ─┬────────────────── grid ───────────────────────┬─ rail 320 ─┐
│ ‹ Nov 2026 ›  │  [Day] [3d] [Week] [Month]   ‹ Today ›  ⌘K ?  │ Tasks       │
│ mini month    │  Mon 2   Tue 3   Wed 4   Thu 5   Fri 6  Sat Sun│ [Today][Up][Any]│
│               │  2ev·1h  3ev·2h  1ev·3h  ...                   │ ⚡ Plan 4 tasks │
│ ☑ Personal    │ all-day ──────────────────────────────────     │  "3h, fits by Thu"│
│ ☑ Work (G)    │  8 ┼───────┼───────┼───────┼───────┼───────    │ ☐ Write proposal│
│ ☐ Family (G)  │    │Standup│       │       │       │           │   45m · due Thu │
│ ☑ Aravos Tasks│  9 ┼───────┼┆Prop ┆┼───────┼───────┼───────    │ ☐ Call plumber  │
│               │    │       │┆45m  ┆│       │       │           │   30m · !!      │
│ Time zones ▸  │ 10 ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━     │ ☐ Book flights  │
│ (v2)          │    │       │       │       │       │           │   1h · due Fri ⚠│
│               │ 11 ┼───────┼───────┼───────┼───────┼───────    │ At risk (1)     │
└───────────────┴────────────────────────────────────────────────┴─────────────┘
```

- Week view default (Mon–Sun per locale; weekend columns narrower, 60%). Day header shows "n events · Xh tasks". Today column has a tinted background; the now line spans all columns with a dot in today's column.
- **Drag-to-create** on empty cells: pointer down + move draws a ghost (15-min snapping; hold `Shift` for 5-min); release opens a small popover anchored to the block with the quick-capture field focused (text, chips, Task/Event toggle). `Esc` cancels and removes the ghost.
- **Hover** on empty space shows a faint "+" at the snapped slot; single click creates a 30-min event ghost (Todoist/Google behaviour).
- **Move / resize** with the pointer; `Alt`-drag duplicates (Fantastical). Arrow keys nudge a selected block by 15 min; `Shift+↑/↓` changes the end.
- **Rail**: Today / Upcoming / Anytime tabs; rows show checkbox, title, est chip, due badge, priority dots. Drag a row into the grid (pointer-events based, not HTML5 DnD, so the same code path works on touch). "⚡ Plan" runs the planner and shows the diff inline (new blocks appear with a pulse; a banner "Planned 4 blocks · Undo").
- **Popover detail** (not a page): opened by click/`Enter`; `E` edits in place; `Backspace` deletes with undo.
- Month view: event chips (max 3 + "+n"), task counts per day, click a day → Day view.

### 3.3 Rendering rules
- **Granularity**: 15 min. Hour height 64px (desktop 56px). Minimum rendered height 16px; blocks < 30 min render title only.
- **Now line**: recomputed every 30 s; auto-scroll on open to now − 1 h; a "↓ now" chip appears when the now line is off-screen.
- **All-day row**: pinned under the week strip/header; sorted by calendar then title; task *deadlines* with no time show here as muted chips ("Due: Taxes").
- **Overlap layout (column packing)**:
  1. Sort by start ascending, then by end descending (longer first).
  2. Sweep to build clusters: an item joins the current cluster if `start < clusterEnd`, where `clusterEnd = max(end)` so far; otherwise start a new cluster.
  3. Inside a cluster assign columns greedily: place each item in the first column whose last item `end <= item.start`; else open a new column.
  4. Width = clusterWidth / columns; left = col × width. Then let an item expand rightward across subsequent columns that contain nothing overlapping it (so a lone 9:00 event next to two 10:00 overlaps still takes full width).
  5. Events and time blocks share the same packer; the planner never produces overlaps, so only manual blocks can collide.
- **Time blocks vs events**: time blocks use a dashed 1.5px border and a 12% tint of the task list colour, a checkbox at left, est chip at right; events use a solid 2px left stripe of the calendar colour. In-progress block: progress fill top→bottom = elapsed/planned. Done: opacity .45 + strikethrough. Missed: amber outline. Google-mirrored blocks look identical locally (the mirror is invisible to the UI).
- **Declined events**: struck through at 40% opacity (hidden via a view option). Tentative: hatched stripe.
- **Snapping**: 15 min default; magnetic to the now line and to adjacent block edges within 5 min (v2, Kalender-style `snapToOtherEvents`).

---

## 4. Tasks screen

```
Mobile                                     Desktop (list in center, detail on the right)
┌──────────────────────────────────┐       ┌─ lists 240 ─┬─ list ──────────────┬─ detail 360 ─┐
│ [Today] [Upcoming] [Anytime] [Lists]     │ Inbox 3     │ Today               │ Write proposal│
│ Overdue (2)                    ▾ │       │ Today 6     │ ▸ Overdue (2)       │ ☐  !!  45m    │
│ ☐ Pay parking ticket   Mon ⚠     │       │ Upcoming    │ ▸ Scheduled         │ When: Today   │
│ Scheduled                        │       │ Anytime     │   9:30 ☐ Write…  45m│ Deadline: Thu │
│  9:30 ☐ Write proposal 45m  ⏱    │       │ Someday     │  13:00 ☐ Reply… 15m │ List: Work    │
│ 13:00 ☐ Reply to lease 15m       │       │ Logbook     │ ▸ Due today         │ Repeat: —     │
│ Due today                        │       │ ─────────   │   ☐ Submit expense  │ Planned       │
│ ☐ Submit expense report  !       │       │ Work (G) 12 │ ▸ This evening      │  Thu 9:30–10:15 🔒│
│ This evening                     │       │ Errands 4   │   ☐ Call mum        │  [Replan][Log]│
│ ☐ Call mum                       │       │ Home 7      │ ▸ Done today (3)    │ Subtasks 1/3  │
│ Done today (3)                 ▸ │       │             │                     │ Notes…        │
│                              (+) │       └─────────────┴─────────────────────┴──────────────┘
└──────────────────────────────────┘
```

- **Today** = tasks with `scheduled_date = today` ∪ `due_at` today ∪ a time block today ∪ overdue. Sections in order: Overdue, Scheduled (sorted by block start, time prefix shown), Due today, Anytime-today (no block), This evening (`evening` flag, Things), Done today (collapsed, faded, cleared at day rollover into Logbook).
- **Upcoming** = next 14 days grouped by day, then by week/month; calendar events appear as muted rows inside each day (Things). Drag a task between day groups to reschedule.
- **Anytime** = open tasks with no `scheduled_date`, grouped by list; **Someday** collapsed at the bottom. **Lists** tab: user lists with counts and colour; Google Tasks lists show a "G" badge.
- **Row** (44pt): checkbox · title · meta line (est chip, due badge: red overdue / amber today / grey later, repeat icon, subtask progress "2/5", tags). Tap title → inline edit; `Enter` creates the next task below; swipe right on mobile → Indent (Reminders) when below a sibling.
- **Swipes**: right = complete (300 ms delay, undo toast); left (short) = **Schedule** (sheet: Today · This evening · Tomorrow · This weekend · Next week · Pick date · Someday); left (full) = **Plan now** (planner places it today if it fits, else next free slot; toast shows the time).
- **Due vs scheduled**: every task has an optional **When** (`scheduled_date`, "I'll work on it") and an optional **Deadline** (`due_at`, "it must be done by"). Quick capture maps a bare date to When and `by`/`due`/`{date}` to Deadline. The planner uses Deadline for urgency and When as "not before".
- **Estimates**: chips 15m / 30m / 1h / 2h / custom; required for auto-planning (tasks without an estimate show "Add estimate to plan" and the planner assumes nothing). Default estimate per list is a setting.
- **Priority**: P1 ! (critical) … P4 (low); default P3. Shown as 0–3 accent dots.
- **Recurrence**: stored as an RRULE on the series; the list shows only the current occurrence. Completing creates the next occurrence: `fixed` mode advances from the scheduled date; `after_completion` (Todoist `every!`) advances from `completed_at`.
- **Subtasks**: one level (Google Tasks also allows one). Completing the parent completes children (Reminders behaviour) with undo.
- **Logbook**: completed/cancelled grouped by day; search.

---

## 5. Sheets

### 5.1 Quick-capture sheet
```
┌──────────────────────────────────────┐
│ ✕                       Task ⇄ Event │  auto-detected; tap to flip
│ Call plumber tomorrow 4pm 30m #Home !!│  single input, grows to 3 lines, parsed spans underlined
│ [Tue 3 Nov · 4:00 PM ×] [30m ×] [#Home ×] [P2 ×] [Plan ⚡ on]   ← live chips
│ Task · Tue 4:00–4:30 PM · Home           ← preview line (planner slot if "Plan" is on and no time)
│ [Today] [Tomorrow] [Evening] [15m 30m 1h] [!] [#] [Repeat] [Deadline]   ← quick toolbar
│                                  [Add ↵]│
└──────────────────────────────────────┘
```
- Opens from the FAB, `Q`/`N` on web, the global desktop shortcut, and from a calendar slot (prefilled time). On iOS the input is focused and the keyboard is up on open (`@capacitor/keyboard`).
- Grammar (client-side, `chrono-node` casual with `forwardDate: true`, ref = now in the user zone):
  - Date/time: anything chrono parses ("tomorrow 4pm", "next fri", "nov 12 9-10:30", "in 2 weeks"). A time *range* or `with <name>` or `at <place>` flips the default to Event. An event with no end gets 30 min; an event from a dragged slot keeps the slot.
  - Deadline: `by <date>`, `due <date>`, `{date}` → `due_at` (date-only unless a time is given).
  - Duration: `30m`, `1h`, `1h15m`, `for 45 min`, `~2h` → `est_minutes` (task) or end time (event).
  - List `#home`, tag `@errand`, priority `!`…`!!!` or `p1`…`p4`, calendar `/work` (event).
  - Recurrence: `every day|weekday|week|month|year`, `every mon,wed`, `every other tue`, `every 2nd fri`, `every 3 days`, `every last workday`, `every! 3 days` (from completion), `until <date>`, `for 6 weeks`, `starting <date>`. Parsed to an RRULE by our grammar; `RRule.fromText` is the fallback.
  - Quotes protect literal text (Fantastical). Backspace at the end of a recognised span removes the span but keeps the title (Akiflow). Each chip is tappable to open its picker.
- Submit: `Enter` saves and closes; `Cmd/Ctrl+Enter` saves and keeps the sheet for the next item; `Esc` discards (asks only if > 20 chars typed).
- Offline: the item is written locally and synced later.

### 5.2 Detail sheet (task)
Half-sheet on mobile (drag to full), popover/right panel on desktop. Top: checkbox + editable title. Chip row: **When** · **Deadline** · **Est** · **Priority** · **List** · **Tags** · **Repeat** · **Plan ⚡** (auto-schedule toggle, on by default once an estimate exists). "Planned" section: each time block as `Thu 9:30–10:15 🔒` with Replan / Remove; "+ Plan a block" and "Plan now". Subtasks (inline add, drag to reorder). Notes (markdown-lite). Footer: "Usually takes ~1.3× your estimate" (from `duration_history`), created/completed stamps, Duplicate · Move · Delete. Google-synced tasks show a "G · Work" badge; fields Google can't hold (time of day, est, priority, repeat) show a tiny "local only" hint.

### 5.3 Detail sheet (event)
Title · calendar (colour swatch picker, only writable calendars) · start/end with inline wheel/time pickers and "All day" switch · Repeat (rrule presets + custom) · Location · Conference link with a **Join** button · Attendees with RSVP Yes/No/Maybe (writes `attendees[].responseStatus` for self) · Reminders · Notes · Busy/Free · Visibility. Actions: Duplicate · Delete (series dialog: this / this and following / all) · "Make a task" (creates a task linked to the event) · "Add prep block" (v2). Read-only calendars render fields disabled with a lock icon.

### 5.4 Detail sheet (time block)
Task title with checkbox · `start – end` editable · **Locked** toggle (manual blocks default on; auto blocks off) · Timer Start/Stop (writes `actual_minutes`) · "Done & log time" · "Didn't finish → remaining [slider]" · "Replan later today / tomorrow" · "Unplan" · link to the task. Blocks are never visible in Tasks lists as separate items.

### 5.5 "Plan my day" review sheet
Header: `Planned 4 tasks · 3h 10m · ends 5:20 PM` with a workload bar (planned vs daily cap; red if over). Rows: proposed blocks in time order (title, est, time, lock toggle, remove). Footer: "Accept" (writes blocks), "Shuffle" (re-run with a different seed for ties), "Edit hours". After acceptance the planner keeps running silently; only the first run of a day is a preview.

### 5.6 Keyboard shortcuts (web)
| Key | Action |
|---|---|
| `Q` / `N` | Quick capture (`Shift+N` forces Event) |
| `Cmd/Ctrl+K` | Command palette (actions, go to date, switch list, "hide calendar X") |
| `?` | Shortcut overlay with search |
| `/` | Search tasks and events |
| `1` `2` `3` `4` | Today · Upcoming · Anytime · Calendar |
| `T` · `←/→` or `J/K` | Today · previous/next day (week in week view) |
| `D` `W` `M` | Day · Week · Month (calendar focused) |
| `C` | Create event at the selected slot |
| `↑/↓` + `Enter` | Move selection, open detail |
| `E` · `Backspace` | Edit · Delete (with undo) |
| `Space` (or `Cmd+Enter`) | Complete selected task |
| `S` · `Shift+D` · `Shift+E` | Set When · set Deadline · move to This Evening |
| `A` · `L` · `U` | Plan now · lock/unlock block · unplan |
| `P` then `1–4` | Set priority |
| `Shift+↑/↓` · `Alt+↑/↓` | Change end by 15 min · move block by 15 min |
| `Cmd/Ctrl+Z` | Undo |
| `Z` | Time-zone travel (v2) |

---

## 6. Time-boxing scheduler

Deterministic, synchronous, runs server-side in SQLite on each trigger (target < 50 ms for 500 open tasks over a 14-day horizon). Always a *diff* against existing auto blocks so the calendar does not churn.

### 6.1 Inputs
- **Tasks**: open, `auto_schedule = 1`, `est_minutes` set, `remaining = est × calibration − logged ≥ 15`. Fields: `priority` 1–4, `due_at` (nullable), `scheduled_date` ("not before"), `earliest_start_at`, `hours_profile` (`work`|`personal`|`any`), `min_chunk` (default 30), `max_chunk` (default 90), `splittable` (default true if est > max_chunk), `hard_deadline` (bool), `locked blocks` already on the calendar (they reduce `remaining`).
- **Busy intervals**: event instances with `transparency = opaque` and own response ≠ declined, across *all selected calendars* (expanded from RRULEs for the horizon), locked time blocks, in-progress blocks, routines (v2).
- **Availability**: per-weekday windows for `work` and `personal` (settings), days off, `lead_minutes` (don't schedule within 15 min of now), `planning_horizon_days` (14), `daily_cap_minutes` (default 330 ≈ Sunsama's 5.5 h), `buffer_minutes` after fixed events (10) and between blocks (5), `break_after_minutes` (120) + `break_minutes` (15), `deep_work_window` (optional, e.g. 09:00–12:00 preferred for P1/P2), `granularity` 15.
- **Calibration**: per list/tag factor from `duration_history` (§6.5).

### 6.2 Build free slots
1. For each day in `[now, now + horizon]` take the union of windows allowed by any task's `hours_profile` (keep the profile label on each slot).
2. Subtract busy intervals, each padded by `buffer_minutes` on both sides.
3. Subtract `[now, now + lead_minutes]`.
4. Round slot edges outward to the 15-min grid, drop slots shorter than the global `min_chunk`.
5. Per day, track `used_minutes` (existing locked/manual blocks count toward the cap) and `continuous_minutes` for break insertion.

### 6.3 Order tasks
Score each candidate; higher first; ties by `created_at`:
```
hours_to_due   = (due_at − now) in hours, or +∞ if no due
slack_hours    = hours_to_due − remaining_hours
urgency        = due ? clamp(1 − slack_hours / 168, 0, 1) : 0.15     // 168 h = one week
priority_w     = {1: 1.0, 2: 0.7, 3: 0.4, 4: 0.2}[priority]
age            = min(days_since_created / 14, 1)
size_bias      = remaining_minutes <= 30 ? 0.05 : 0                      // let small wins fill gaps
score          = 0.55·urgency + 0.30·priority_w + 0.10·age + size_bias
```
Then a feasibility pass: run EDF (earliest deadline first) on the subset with deadlines; if EDF fits and score-order does not, a task's chunks are allowed to preempt lower-score chunks *only* when its `slack_hours < 24`. This reproduces Motion/Reclaim's "an earlier deadline can beat a higher priority".

### 6.4 Place
For each task in order:
1. `start_floor = max(now + lead, earliest_start_at, scheduled_date 00:00)`.
2. Walk slots from `start_floor` forward, only slots whose profile matches `hours_profile` (or any).
3. Chunk = `min(remaining, max_chunk, slot_remaining)`. Reject if `chunk < min_chunk` unless `remaining < min_chunk` (then take `remaining`). Reject if `day.used + chunk > daily_cap` (unless `hard_deadline` and no other option).
4. Slot preference (choose the best slot among those that keep the task before its deadline; otherwise the earliest):
   - +2 inside `deep_work_window` for P1/P2 tasks longer than 45 min;
   - +1 if the chunk fills a slot exactly or leaves ≥ 30 min (avoid 15-min orphans);
   - −1 if another chunk of the same task ends < `max_chunk` minutes earlier (Reclaim's spacing rule: no back-to-back sessions of one task);
   - −1 if the day already holds ≥ 3 chunks of this task.
5. Write the chunk, add `buffer_minutes` after it, update `day.used` and `continuous_minutes`; if `continuous_minutes ≥ break_after_minutes`, reserve a `break_minutes` gap before the next chunk.
6. Repeat until `remaining = 0` or the horizon ends. If the deadline passes before `remaining = 0`: keep scheduling after the deadline (a personal app should still get the work done) and mark the task **at_risk** with `eta = end of last chunk`; with `hard_deadline` first try slots outside the profile (Motion's "Hard Deadline" behaviour) before giving up.

### 6.5 Learning from actuals
- On completion, `actual = sum(block actual_minutes if timed, else planned minutes of blocks marked done) + manual adjustments`; write `duration_history(task_id, list_id, tags, est_minutes, actual_minutes, source)`.
- Calibration factor per list (fallback: global): `median(actual/est)` over the last 20 samples, shrunk toward 1 for small n: `factor = (n·median + 5·1.0) / (n + 5)`, clamped to `[0.75, 2.0]`. Applied to `remaining` for planning only; the user's estimate text is never changed. Surface it in the detail sheet ("usually ~1.3×").

### 6.6 Output and diffing
Produce a proposed set of blocks `{task_id, start, end, chunk_index}`. Compare with existing `origin='auto'` blocks for the same horizon:
- Identical `(task_id, start, end)` → keep the row (stable id, no UI flash).
- Otherwise update in place when the task matches, else insert/delete.
- **Frozen window**: blocks that started, are in progress, or start within 60 min are never moved by an automatic run (only by the user or when their task completes).
- Record a `scheduler_runs` row (trigger, counts, at-risk ids, ms). Blocks mirrored to Google (§7.6) are pushed by the sync worker, not by the planner.

### 6.7 When to run
Debounced 2 s, coalesced per user:
- Task created/edited (estimate, deadline, When, priority, `auto_schedule`, list), completed, deleted, or reordered within Today.
- A block is dragged, resized, locked, unplanned, completed, or marked "didn't finish" (remaining recomputed).
- Google sync applies any change to a selected calendar's busy time (only re-plan if an interval inside the horizon changed).
- Clock: every 15 min while the app is open (catches overruns: a planned block that ended without completion → remaining stays, it is re-planned forward and the block is marked missed); day rollover at 00:05 local (sweeps yesterday).
- Settings change (hours, caps, buffers).
- The first run on a new day is a **preview** (review sheet); every other run applies silently and shows a 6-s "Re-planned 2 blocks · Undo" toast when anything in *today* moved.

---

## 7. Google sync design

### 7.1 OAuth
- Scopes: `https://www.googleapis.com/auth/calendar.events` (read/write events on all accessible calendars), `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (list + colours), `https://www.googleapis.com/auth/tasks`. Add `calendar.calendars.readonly` only if we need calendar default time zones beyond what `calendarList` returns.
- Use `access_type=offline`, `prompt=consent` on first connect, `include_granted_scopes=true`. Store the refresh token encrypted at rest in `google_accounts`.
- Gotcha for a personal app: an *external* OAuth consent screen in **Testing** status issues refresh tokens that **expire after 7 days**. Publish the app (it can remain unverified for one's own account) or use a Workspace *internal* app. Also: max 100 refresh tokens per client per account, and tokens die after 6 months unused.

### 7.2 Endpoints
Calendar (`https://www.googleapis.com/calendar/v3`):
- `GET /users/me/calendarList` → calendars (id, summary, backgroundColor, accessRole, primary, selected, timeZone).
- `GET /calendars/{id}/events` with `maxResults=2500`, `showDeleted=true`, `singleEvents=false`; full sync adds `timeMin=now−90d`; incremental sends only `syncToken` + `pageToken` (never `timeMin/timeMax/updatedMin/orderBy/q/iCalUID` with a token).
- `GET /calendars/{id}/events/{eventId}`; `GET …/events/{eventId}/instances` (used only to resolve an exception we can't match locally).
- `POST /calendars/{id}/events` (we supply `id` = base32hex-encoded UUID, 5–1024 chars of `[a-v0-9]`, for idempotent retries; `sendUpdates=all` only when attendees exist).
- `PATCH /calendars/{id}/events/{eventId}` with header `If-Match: <etag>` (never `PUT`/update: it resets unspecified fields and 403s `forbiddenForNonOrganizer` on shared copies).
- `DELETE /calendars/{id}/events/{eventId}`.
- `POST /calendars/{id}/events/watch` body `{id, type:"web_hook", address, token, params:{ttl:"604800"}}` → `resourceId`, `expiration`; `POST /channels/stop` `{id, resourceId}`.
Tasks (`https://tasks.googleapis.com/tasks/v1`):
- `GET /users/@me/lists` (`maxResults` ≤ 1000); `POST/PATCH/DELETE /users/@me/lists/{id}`.
- `GET /lists/{id}/tasks?showCompleted=true&showHidden=true&showDeleted=true&maxResults=100&updatedMin=<rfc3339>&pageToken=…`.
- `POST /lists/{id}/tasks?parent=&previous=`; `PATCH /lists/{id}/tasks/{taskId}`; `DELETE …`; `POST /lists/{id}/tasks/{taskId}/move?parent=&previous=&destinationTasklist=`.
- There is **no watch/push API for Tasks**: poll.

### 7.3 Calendar pull
1. **Calendar list**: refresh hourly and on connect; upsert `calendars` (provider `google`), keep the user's `selected` flag locally (Google's `selected` seeds it).
2. **Full sync** per selected calendar: page through with `timeMin`; on the last page store `nextSyncToken` in `sync_state`. Store **masters** (events with `recurrence`), **single events**, and **exceptions** (events with `recurringEventId` + `originalStartTime`), all with `status`, `etag`, `updated`.
3. **Incremental**: `events.list?syncToken=…`; paginate until `nextSyncToken` appears; apply each item: `status=cancelled` → tombstone (soft delete) locally, else upsert. On **410 `fullSyncRequired`** (or `updatedMinTooLongAgo`): drop the token, wipe that calendar's non-dirty rows, full sync again. 403/429 `rateLimitExceeded`/`userRateLimitExceeded` and 5xx → exponential backoff (1 s → 64 s, jitter), stored in `sync_state.backoff_until`.
4. **Routing**: an item whose `extendedProperties.private.aravos_kind = "time_block"` is a mirror of our block → update `time_blocks` (user moved/deleted it in Google), never `events`.
5. **Expansion**: for display and for the planner, expand masters locally with `rrule` (`rrulestr(recurrence.join('\n'), {dtstart, tzid: start.timeZone})`), subtract `EXDATE`s, then overlay exceptions by `originalStartTime` (an exception with `status=cancelled` removes that instance). Cache expanded instances for `[−30 d, +400 d]` in `event_instances`, rebuilt when the master or any exception changes. `dtstart` handling: build with `Date.UTC`/`datetime()` and read with `getUTC*` (rrule treats dates as floating), then convert with `date-fns-tz` using the master's `timeZone`.
6. **Push channel**: on connect and every 6 days renew `events.watch` per selected calendar (TTL 7 d); the webhook (`POST /api/google/notify`) verifies `X-Goog-Channel-Token` against the stored secret, ignores `X-Goog-Resource-State: sync`, and enqueues an incremental sync for the calendar identified by `X-Goog-Channel-ID`; respond `200` immediately. Because notifications are "not 100% reliable", also poll incrementally every 10 min while the app has been active in the last hour, else hourly, and on app foreground (Capacitor `App.appStateChange`). Local dev without a public HTTPS URL falls back to polling only.

### 7.4 Calendar push (local → Google)
- Rows with `dirty=1` are pushed by a worker (debounced 1 s after the last local edit, so a drag-resize generates one PATCH).
- Create: `events.insert` with our `id`; on 409 `duplicate` treat as success and `GET` it. Update: `events.patch` with `If-Match: etag`; on 412 `conditionNotMet` → `GET`, resolve (§7.5), re-patch. Delete: `events.delete`; on 410 `deleted`/404 treat as done.
- Recurring edits: "this only" → patch the instance (exception) identified via `events.instances`; "this and following" → patch the master's `RRULE` with `UNTIL=<instance start − 1 s in UTC>` and insert a new master starting at the instance; "all" → patch the master.
- After every successful write, store the returned `etag`/`updated` and set `dirty=0`; the next pull will see the same `etag` and skip (echo suppression).

### 7.5 Conflict resolution (both directions)
Per row: `remote_etag`, `remote_updated_at`, `local_updated_at`, `dirty`, `sync_hash` (hash of the mapped fields as last synced), `deleted_at`.
- **Pull applies remote** when the row is clean, or when it is dirty but `remote_updated_at > local_updated_at` (last-writer-wins by timestamp; the losing local version is saved to `sync_conflicts` and surfaced as an undo-able toast "Google changed 'Standup'").
- **Local wins** when dirty and `local_updated_at ≥ remote_updated_at`: keep local, push with the new etag.
- **Deletes**: remote `cancelled` → local tombstone + cascade-delete auto time blocks whose busy time changed (the planner re-runs). Local delete → tombstone row (keeps `remote_id`) so a stale incremental page can't resurrect it; purge tombstones after 30 days. If a dirty local edit meets a remote delete, the remote delete wins (Google is the home of events) and the edit is kept in `sync_conflicts`.
- **Field scope**: only mapped fields participate; changing a local-only field (e.g. a linked task) never marks the row dirty.
- Clock skew: compare using Google's `updated` for remote and our server clock for local; never the device clock.

### 7.6 Field mapping (events)
| AravOS `events` | Google Event |
|---|---|
| `remote_id` / `ical_uid` / `etag` | `id` / `iCalUID` / `etag` |
| `title` / `description` / `location` | `summary` / `description` (HTML allowed; we store as text) / `location` |
| `start_at`, `end_at` (UTC ISO) + `tz` | `start.dateTime`, `end.dateTime`, `start.timeZone` (required for masters) |
| `all_day=1`, `start_date`, `end_date` | `start.date`, `end.date` (end exclusive) |
| `status` | `status` confirmed/tentative/cancelled |
| `transparency` (`opaque`/`transparent`) | `transparency` (drives busy detection) |
| `visibility` | `visibility` |
| `color` | `colorId` (map via `colors.get`; fallback to calendar colour) |
| `recurrence` (JSON array of lines) | `recurrence[]` (RRULE/RDATE/EXDATE; no DTSTART) |
| `recurring_event_id`, `original_start_at` | `recurringEventId`, `originalStartTime` |
| `attendees_json`, `my_response` | `attendees[]` (`email`, `responseStatus`, `self`) |
| `organizer_email` | `organizer.email` |
| `conference_url` | `hangoutLink` or `conferenceData.entryPoints[video].uri` |
| `reminders_json` | `reminders.useDefault` / `overrides[]` |
| `remote_updated_at` | `updated` |
| mirrored block marker | `extendedProperties.private.{aravos_kind:"time_block", aravos_task_id, aravos_block_id}` |

Time-block mirroring (setting: Off / Primary as Free / Primary as Busy; default Primary as Free): title `⧗ <task title>`, `transparency=transparent` unless the task is at risk (then `opaque`, Reclaim-style), `reminders.useDefault=false`. Completing the task renames to `✓ <title>` and shrinks to actual minutes if timed, or deletes it (setting). Moving the mirrored event in Google locks the block locally.

### 7.7 Tasks sync (polling)
- Lists: `tasklists.list` hourly; each Google list maps to a `task_lists` row with `google_tasklist_id`; the user chooses which lists sync (default: all, with the `@default` list mapped to our Inbox).
- Pull: per synced list `tasks.list` with `updatedMin = last_poll − 5 min` (overlap guards against clock skew), `showCompleted=showHidden=showDeleted=true`, page until done; store the max `updated` seen as the next `updatedMin`. Poll every 5 min while active, 30 min in background, immediately after our own writes and on foreground. `deleted=true` → tombstone; `hidden=true` + `completed` → keep as done.
- Mapping: `title`↔`title`, `notes`↔`notes`, `status open/done`↔`needsAction/completed` (+`completed` timestamp), `due_at`↔`due` (**date only**; Google discards the time, so a local due time is kept locally and only the date is pushed), `parent_id`↔`parent` via `tasks.move`, `sort_order`↔`position` via `tasks.move(previous=…)` when the user reorders a synced list. Local-only: `est_minutes`, `priority`, `scheduled_date`, time of due, tags, recurrence (we push only the *current* occurrence as a plain task and insert the next one on completion). Google recurring tasks can't be moved across lists or nested; respect both.
- Push: `insert` (with `parent`/`previous`), `patch`, `delete`, `move`; last-writer-wins by `updated` as in §7.5. Google Tasks has etags on resources but no documented `If-Match` precondition, so conflicts are detected by comparing `updated` after a fresh `get` when the pull shows a change to a dirty row.
- Limits: 20,000 non-hidden tasks per list; 100 per page; 2,000 subtasks per parent.

### 7.8 Sync worker
One in-process queue (`sync_jobs` table or in-memory with persistence on failure) with job types `calendar_list`, `calendar_pull(calendar_id)`, `calendar_push`, `tasks_pull(list_id)`, `tasks_push`, `watch_renew`. Serialised per account to keep ordering simple; retries with backoff; `sync_state.last_error` surfaces in Settings → Google ("Last synced 2 min ago").

---

## 8. Natural-language libraries

**chrono-node 2.x** (already in `apps/web`): `import * as chrono from 'chrono-node'` (or `chrono-node/en` to avoid loading all locales). `chrono.parse(text, ref?, { forwardDate: true })` → `ParsedResult[]` with `index`, `text`, `start`, `end?`, `date()`; `ParsedComponents.get('hour')`, `isCertain('hour')` tell us whether a time was explicit (if not, a task gets a date-only When and an event gets the default 9:00). `ref` can be `{ instant: Date, timezone: 'America/Los_Angeles' | minutesOffset }`. `chrono.casual` (default) accepts "today", "next fri", "in 2 weeks", "this friday from 13:00 - 16:00"; `chrono.strict` only formal dates. Extend with `const c = chrono.casual.clone(); c.parsers.push({ pattern: () => /\bthis weekend\b/i, extract: … })` and `c.refiners.push(…)` to strip our `#`/`@`/`!` tokens before date parsing and to prefer the next occurrence for bare weekdays.

**rrule 2.8** (already in `apps/server`): `new RRule({ freq: RRule.WEEKLY, interval: 2, byweekday: [RRule.TU], dtstart, until | count, tzid })`; `rule.between(after, before, true)`, `rule.after(dt, true)`, `rule.toString()` (→ `RRULE:…`), `rule.toText()` ("every 2 weeks on Tuesday"), `RRule.fromText('every week on monday')`, `rrulestr(str, { dtstart, tzid, forceset: true })` → `RRuleSet` with `rrule()/rdate()/exdate()/exrule()`. Caveats we must code around: `dtstart` is *not* an occurrence unless it matches the rule (add it with `rdate`); dates come back as UTC-"floating" (`getUTC*`), convert with `date-fns-tz`; `tzid` relies on `Intl` (fine on Node 22 and iOS WebKit); `byweekday: RRule.FR.nth(2)` for "2nd Friday". Google's `recurrence[]` is directly loadable with `rrulestr` after joining lines.

Recurrence grammar we own (maps to RRULE options): `every (N )?(day|days|weekday|workday|week|weeks|month|months|year)`, `every (other|2nd|3rd) <unit>` (interval), `every (mon|tue|…)(,…)*` (BYDAY), `every (1st|2nd|3rd|4th|last) <weekday>( of <month>)?` (BYDAY+BYSETPOS / BYMONTH), `every last (day|workday)` (BYMONTHDAY=-1 / BYDAY=MO..FR;BYSETPOS=-1), `at <time>` (DTSTART time), `until <date>` / `for N (times|weeks)` (UNTIL / COUNT), `starting <date>` (DTSTART), `every!` → `recurrence_mode = after_completion` (no RRULE change; next = completed_at + interval).

---

## 9. Data model (SQLite via Drizzle)

Conventions: `id` = ULID text; timestamps are ISO-8601 UTC text; all-day values are `YYYY-MM-DD` text; booleans are integers; JSON columns are text. Soft deletes via `deleted_at` (tombstones) on every synced table.

```sql
google_accounts (
  id TEXT PK, email TEXT UNIQUE, refresh_token_enc TEXT, access_token TEXT, access_expires_at TEXT,
  scopes TEXT, connected_at TEXT, last_error TEXT
);

calendars (
  id TEXT PK, provider TEXT CHECK(provider IN ('local','google')), google_account_id TEXT NULL,
  remote_id TEXT NULL,            -- Google calendarId
  name TEXT, color TEXT, time_zone TEXT, access_role TEXT,  -- owner|writer|reader|freeBusyReader
  is_primary INTEGER DEFAULT 0, selected INTEGER DEFAULT 1, is_default_for_new INTEGER DEFAULT 0,
  sort_order REAL, created_at TEXT, updated_at TEXT, deleted_at TEXT NULL,
  UNIQUE(google_account_id, remote_id)
);

events (
  id TEXT PK, calendar_id TEXT REFERENCES calendars(id),
  remote_id TEXT NULL, ical_uid TEXT NULL, etag TEXT NULL,
  title TEXT, description TEXT, location TEXT,
  all_day INTEGER DEFAULT 0, start_at TEXT NULL, end_at TEXT NULL, start_date TEXT NULL, end_date TEXT NULL,
  tz TEXT,                                   -- IANA; required when recurrence is set
  status TEXT DEFAULT 'confirmed',           -- confirmed|tentative|cancelled
  transparency TEXT DEFAULT 'opaque', visibility TEXT DEFAULT 'default', color TEXT NULL,
  recurrence TEXT NULL,                      -- JSON array of RRULE/RDATE/EXDATE lines (master only)
  recurring_event_id TEXT NULL REFERENCES events(id),  -- set on exceptions
  original_start_at TEXT NULL,               -- exception's original instance start (UTC or date)
  attendees_json TEXT NULL, organizer_email TEXT NULL, my_response TEXT NULL,
  conference_url TEXT NULL, reminders_json TEXT NULL,
  linked_task_id TEXT NULL,                  -- "Make a task"
  remote_updated_at TEXT NULL, local_updated_at TEXT, sync_hash TEXT NULL, dirty INTEGER DEFAULT 0,
  created_at TEXT, deleted_at TEXT NULL,
  UNIQUE(calendar_id, remote_id)
);
CREATE INDEX events_range ON events(calendar_id, start_at, end_at);
CREATE INDEX events_master ON events(recurring_event_id, original_start_at);

event_instances (                            -- materialised expansion cache, [-30d, +400d]
  event_id TEXT REFERENCES events(id),      -- master or single event
  instance_start TEXT, instance_end TEXT, all_day INTEGER,
  exception_event_id TEXT NULL,              -- overriding exception row, if any
  cancelled INTEGER DEFAULT 0,
  PRIMARY KEY(event_id, instance_start)
);
CREATE INDEX event_instances_range ON event_instances(instance_start, instance_end);

task_lists (
  id TEXT PK, name TEXT, color TEXT, icon TEXT, sort_order REAL,
  is_inbox INTEGER DEFAULT 0, default_est_minutes INTEGER NULL, hours_profile TEXT DEFAULT 'any',
  google_account_id TEXT NULL, google_tasklist_id TEXT NULL, sync_enabled INTEGER DEFAULT 0, etag TEXT NULL,
  remote_updated_at TEXT NULL, local_updated_at TEXT, dirty INTEGER DEFAULT 0,
  created_at TEXT, deleted_at TEXT NULL,
  UNIQUE(google_account_id, google_tasklist_id)
);

tasks (
  id TEXT PK, list_id TEXT REFERENCES task_lists(id), parent_id TEXT NULL REFERENCES tasks(id),
  title TEXT NOT NULL, notes TEXT NULL,
  status TEXT DEFAULT 'open',                -- open|done|cancelled
  completed_at TEXT NULL,
  priority INTEGER DEFAULT 3,                -- 1 (critical) .. 4 (low)
  est_minutes INTEGER NULL, logged_minutes INTEGER DEFAULT 0,
  due_at TEXT NULL, due_has_time INTEGER DEFAULT 0,       -- deadline
  scheduled_date TEXT NULL, evening INTEGER DEFAULT 0,     -- "When"; NULL = anytime
  someday INTEGER DEFAULT 0, earliest_start_at TEXT NULL,
  rrule TEXT NULL, recurrence_mode TEXT NULL,              -- fixed|after_completion
  series_id TEXT NULL,                                     -- links occurrences of one recurring task
  auto_schedule INTEGER DEFAULT 1, hard_deadline INTEGER DEFAULT 0, hours_profile TEXT NULL,
  min_chunk INTEGER NULL, max_chunk INTEGER NULL,
  at_risk INTEGER DEFAULT 0, eta_at TEXT NULL,
  tags_json TEXT NULL, sort_order REAL,
  linked_event_id TEXT NULL,
  google_task_id TEXT NULL, google_tasklist_id TEXT NULL, etag TEXT NULL,
  remote_updated_at TEXT NULL, local_updated_at TEXT, sync_hash TEXT NULL, dirty INTEGER DEFAULT 0,
  created_at TEXT, deleted_at TEXT NULL,
  UNIQUE(google_tasklist_id, google_task_id)
);
CREATE INDEX tasks_today ON tasks(status, scheduled_date, due_at);
CREATE INDEX tasks_list ON tasks(list_id, parent_id, sort_order);

time_blocks (
  id TEXT PK, task_id TEXT REFERENCES tasks(id),
  start_at TEXT, end_at TEXT,
  status TEXT DEFAULT 'planned',             -- planned|in_progress|done|missed|skipped
  origin TEXT DEFAULT 'auto',                -- auto|manual
  locked INTEGER DEFAULT 0, chunk_index INTEGER DEFAULT 0, run_id TEXT NULL,
  timer_started_at TEXT NULL, actual_minutes INTEGER NULL,
  mirror_calendar_id TEXT NULL, mirror_event_remote_id TEXT NULL, mirror_etag TEXT NULL,
  dirty INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, deleted_at TEXT NULL
);
CREATE INDEX time_blocks_range ON time_blocks(start_at, end_at);
CREATE INDEX time_blocks_task ON time_blocks(task_id);

scheduler_runs (
  id TEXT PK, started_at TEXT, duration_ms INTEGER, trigger TEXT,
  horizon_start TEXT, horizon_end TEXT,
  blocks_created INTEGER, blocks_moved INTEGER, blocks_removed INTEGER,
  at_risk_task_ids_json TEXT, preview INTEGER DEFAULT 0, accepted_at TEXT NULL
);

duration_history (
  id TEXT PK, task_id TEXT, list_id TEXT NULL, tags_json TEXT NULL,
  est_minutes INTEGER, actual_minutes INTEGER, source TEXT,   -- timer|blocks|manual
  completed_at TEXT
);
CREATE INDEX duration_history_list ON duration_history(list_id, completed_at);

sync_state (
  id TEXT PK, google_account_id TEXT,
  resource TEXT,                             -- calendar_list|calendar_events|tasklists|tasks_list
  resource_id TEXT NULL,                     -- calendarId or tasklistId
  sync_token TEXT NULL, updated_min TEXT NULL,
  last_full_sync_at TEXT NULL, last_incremental_at TEXT NULL,
  watch_channel_id TEXT NULL, watch_resource_id TEXT NULL, watch_token TEXT NULL, watch_expires_at TEXT NULL,
  next_poll_at TEXT NULL, backoff_until TEXT NULL, failure_count INTEGER DEFAULT 0, last_error TEXT NULL,
  UNIQUE(google_account_id, resource, resource_id)
);

sync_conflicts (
  id TEXT PK, entity_type TEXT, entity_id TEXT, local_json TEXT, remote_json TEXT,
  resolved_as TEXT, created_at TEXT, dismissed_at TEXT NULL
);

settings (key TEXT PK, value_json TEXT);     -- availability windows, caps, buffers, breaks,
                                             -- deep_work_window, mirror mode, snap minutes, default est
```

Derived/cached client state (Zustand + TanStack Query): visible range instances (`event_instances` ∪ single events ∪ `time_blocks`), rail list, planner summary. All writes are optimistic with server reconciliation; a local `op_log` for offline queueing is recommended on iOS (Capacitor Preferences is too small; use IndexedDB).

---

## 10. Open decisions
1. Mirror time blocks into Google by default (visible on the phone's native calendar and to colleagues as Free) vs off by default (cleaner Google calendar). Proposal: on, as Free.
2. Mobile primary view: paged single-day timeline (proposed) vs. continuous infinite scroll across days. Paged keeps the week strip in sync and is cheaper to virtualise.
3. Whether tasks with no estimate get a default (list default, else 30 min) and are auto-planned, or are excluded until estimated. Proposal: excluded, with a one-tap "30m" in the rail.
4. Horizon 14 days vs 28. Proposal: 14 (Motion-like results beyond that are noise); deadlines beyond the horizon still produce at-risk warnings via a capacity check.

---

## 11. Sources

Apps
- Amie: https://amie.so/ ; TechCrunch on Amie's sidebar/week-view todos: https://techcrunch.com/2022/03/17/amie-is-a-new-calendar-app-with-a-social-twist ; review: https://clickup.com/blog/amie-calendar-review/
- Notion Calendar time zones: https://www.notion.com/help/time-zones ; shortcuts page: https://www.notion.com/help/notion-calendar-keyboard-shortcuts ; third-party shortcut list (C/T/D/W/M/Cmd+K): https://itsourcecode.com/notion/how-to-use-notion-calendar/ ; Cron changelogs (`?` cheat sheet, `K` command menu, time zones): https://www.cron.com/changelog/2021-03-29-shortcuts-help-and-feedback-button , https://www.cron.com/changelog/2022-05-23-time-zone-improvements , https://cron.com/changelog/2021-07-05-time-zone-switcher-and-calendar-reordering
- Fantastical NL entry: https://flexibits.com/fantastical/help/adding-events-and-tasks ; shortcuts: https://flexibits.com/fantastical/help/keyboard-shortcuts ; DayTicker description: https://blogs.the-hospitalist.org/content/fantastical-2 ; parser languages: https://www.macstories.net/news/fantastical-1-2-adds-international-languages-to-event-parsing-engine/
- Sunsama legacy daily planning (steps, 5.5 h guidance, D/Z keys): https://help.sunsama.com/docs/usage-guides/daily-planning/legacy ; agentic planning: https://help.sunsama.com/docs/daily-planning ; evening planning: https://help.sunsama.com/docs/evening-daily-planning ; timeboxing basics: https://help.sunsama.com/docs/timeboxing-the-basics ; planned vs actual gap (user roadmap): https://roadmap.sunsama.com/improvements/p/make-completed-tasks-on-the-calendar-reflect-actual-time-rather-than-planned-tim
- Akiflow: https://akiflow.com/ ; keyboard shortcuts: https://akiflow.com/features/keyboard-shortcuts/ ; command bar changelog: https://akiflow.featurebase.app/en/changelog/fire-upgrade-alert-experience-the-magic-of-our-new-command ; review: https://www.morgen.so/blog-posts/akiflow-review
- Morgen: https://www.morgen.so/ ; review: https://dhruvirzala.com/morgen-review/
- Rise (features; product status unclear): https://www.alternativeto.net/software/rise-calendar/about/ , https://toolradar.com/tools/rise-calendar-app
- Vimcal Time Travel: https://docs.vimcal.com/most-popular-features/time-travel ; TechCrunch: https://techcrunch.com/2022/11/15/vimcal-wants-be-the-most-nifty-calendar-app-on-the-block
- Motion: behind the scenes: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes ; what it considers: https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/what-auto-scheduling-considers ; how-to (priorities, schedules, hard deadline, breaks): https://www.usemotion.com/help/time-management/auto-scheduling/auto-scheduling-how-to-guide ; concept: https://www.usemotion.com/help/time-management/auto-scheduling/concept-auto-scheduling
- Reclaim: how it manages your schedule (priority ordering, free/busy, locking, 15 s): https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically ; tasks (duration ≥15, min/max, due +3 d, spacing): https://help.reclaim.ai/en/articles/5108936 ; habits: https://help.reclaim.ai/en/articles/4129152 ; time defense: https://help.reclaim.ai/en/articles/4129290-how-time-defense-settings-work ; habits vs tasks: https://reclaim.ai/blog/habits-vs-tasks
- Structured: https://structured.app/ ; App Store (timeline, Inbox, Replan, subtasks in timeline, swipe in Inbox): https://apps.apple.com/app/structured-daily-planner/id1499198946 ; review: https://daveswift.com/structured/
- Things 3 features: https://culturedcode.com/things/features/ ; shortcuts: https://culturedcode.com/things/support/articles/2939808/ ; MacStories review (Upcoming/Anytime/Someday): https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/ ; design study (When vs Deadline): https://blakecrosley.com/guides/design/things
- Todoist quick add: https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz ; recurring dates (`every!`, until, starting): https://www.todoist.com/help/articles/set-a-recurring-due-date-YUYVJJAV ; durations (`for 1h15m`, 30-min calendar default, drag bottom edge): https://todoist.com/help/articles/set-a-task-duration-L1kYkZv8d
- TickTick calendar quickstart (Arrange tasks, 30-min min): https://blog.ticktick.com/2020/11/30/ticktick-calendar-quickstart/ ; features: https://ticktick.com/features ; TidBITS: https://tidbits.com/2025/08/14/ticktick-provides-a-focused-daily-task-list-and-more/
- Apple Reminders: edit and organise a list (Indent, sections, columns): https://support.apple.com/en-gw/guide/iphone/iph82596cb20/ios ; Reminders guide index: https://support.apple.com/en-au/guide/reminders/toc ; Smart Lists list: https://apps.apple.com/app/reminders/id1108187841

Calendar UI mechanics
- BusyCal 15-minute snap with Shift override: https://support.busymac.com/help/70587 ; Kalender interaction (tap vs long-press create, snap to time indicator/other events): https://pub.dev/documentation/kalender/0.33.0/topics/Interaction-topic.html ; angular-calendar interactions (drag body, edges, empty space; `snapMinutes`): https://angular-calendar.ascentspark.com/interactions ; SVAR day view now line: https://docs.svar.dev/vue/calendar/core-features/day-view/ ; Google Calendar Android 15-min gesture: https://9to5google.com/2017/07/19/google-calendar-android-quick-time-edit-gesture/
- Overlap packing: react-big-calendar lane assignment PR: https://github.com/jquense/react-big-calendar/pull/1473 ; forceCalendar greedy column packing: https://github.com/forceCalendar/interface/pull/22 ; calendar-core resolvers: https://npmjs.com/package/calendar-core

Google APIs
- Calendar sync guide: https://developers.google.com/workspace/calendar/api/guides/sync ; push notifications: https://developers.google.com/workspace/calendar/api/guides/push ; events.watch (ttl default 604800): https://developers.google.com/workspace/calendar/api/v3/reference/events/watch ; events.list (params incompatible with syncToken): https://developers.google.com/workspace/calendar/api/v3/reference/events/list ; Event resource: https://developers.google.com/workspace/calendar/api/v3/reference/events ; events.insert (client `id` rules): https://developers.google.com/workspace/calendar/api/v3/reference/events/insert ; errors (410 fullSyncRequired, 412 conditionNotMet, 403 forbiddenForNonOrganizer): https://developers.google.com/workspace/calendar/api/guides/errors ; concepts (calendars vs calendarList, recurrence, time zones): https://developers.google.com/workspace/calendar/api/concepts/events-calendars ; recurring events: https://developers.google.com/workspace/calendar/api/guides/recurringevents ; scopes: https://developers.google.com/workspace/calendar/api/auth
- Tasks resource (`due` date-only, `position`, `hidden`): https://developers.google.com/workspace/tasks/reference/rest/v1/tasks ; tasks.list: https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list ; tasks.move: https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/move ; tasklists: https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists , https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists/list ; scopes: https://developers.google.com/workspace/tasks/auth ; no push for Tasks (third-party): https://rollout.com/integration-guides/google-tasks/quick-guide-to-realtime-data-in-google-tasks-without-webhooks
- OAuth refresh-token expiry (7 days in Testing, 100-token cap): https://developers.google.com/identity/protocols/oauth2

Libraries
- chrono-node README: https://github.com/wanasit/chrono ; rrule README: https://github.com/jkbrzt/rrule
