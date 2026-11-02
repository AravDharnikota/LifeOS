# Strong (iOS) — Feature & UX Specification for Reproduction

Research date: 2026-11-02. Target: Strong Workout Tracker Gym Log (Strong Fitness PTE Ltd), iOS 6.x (6.0.2 screenshots from Apr 2025; App Store listing at 6.5.1, Oct 2026). Where behaviour differs between Strong 5 (2021 help-center screenshots) and Strong 6, both are noted; build to the 6.x behaviour.

Evidence tiers used below:
- **[HC]** Strong Help Center (help.strongapp.io) — official text.
- **[SS]** Screenshots viewed directly (help-center images, App Store screenshots, a 154-screen UX teardown of v6.0.2). Verbatim UI strings quoted from these.
- **[AS]** App Store / Google Play listing text and release notes.
- **[3P]** Third-party reviews, CSV parsers, forum posts.
- **[INF]** Inference where no source states the rule; flagged so the implementer can decide.

---

## 0. App shell and global conventions

**Tab bar (5 tabs, left→right, 6.x):** `Profile` · `History` · `Start Workout` (big "+" icon, centre) · `Exercises` · `Store` (crown icon; PRO upsell). In Strong 5 the 5th tab was `Measure`; in 6.x Measurements moved under Profile. [SS]

**Common visual language** [SS]:
- Accent blue `#4DA3FF`-ish for primary buttons, exercise names, links. Green `#4CD080`-ish for "Finish" and completed sets. Red tint for destructive (Cancel Workout, Delete, Remove). Yellow `#FFF3C4` background for sticky/pinned notes.
- Exercise names are rendered in blue and are tappable (opens Exercise Detail).
- Context menus are dark-grey rounded popovers with icon + label rows.
- Workout and template editors open as full-height modal sheets (grab handle at top).
- Themes: Light, Dark, Black, plus seasonal (Halloween). "Switch Automatically" follows system. [SS]

---

## 1. Exercise library and custom exercises

### 1.1 Library
- ~200–450 built-in exercises ("over 200" [HC], "hundreds" [AS]). Each has an animated illustration (two-frame image / video), numbered instructions, a body part and a category. [SS]
- Naming convention: `Name (Equipment)` — e.g. `Bench Press (Barbell)`, `Lat Pulldown (Cable)`, `Leg Extension (Machine)`, `Incline Bench Press (Smith Machine)`, `Inverted Row (Bodyweight)`, `Kneeling Pulldown (Band)`, `Rowing (Machine)`, `Running (Treadmill)`. Bodyweight-only moves may have no suffix (`Push Up`, `Flat Leg Raise`, `Ab Wheel`). [SS]

### 1.2 Enumerations (verified from the picker UI) [SS]
**Body Part** (filter order): `Core`, `Arms`, `Back`, `Chest`, `Legs`, `Shoulders`, `Other`, `Olympic`, `Full Body`, `Cardio`.
(Create-exercise chips show the same set alphabetised: Arms, Back, Cardio, Chest, Core, Full Body, Legs, Olympic, Other, Shoulders.)

**Category** (exercise type — drives which columns a set row has and how volume/PRs are computed):

| Category | Set-row columns | Notes |
|---|---|---|
| `Barbell` | kg/lbs · Reps | Plate calculator + Bar Type available |
| `Dumbbell` | kg/lbs · Reps | "Count Dumbbells Twice" volume option |
| `Machine / Other` | kg/lbs · Reps | Plate calculator available |
| `Weighted Bodyweight` | `+kg`/`+lbs` · Reps | header shows `+kg` (added weight) |
| `Assisted Bodyweight` | `-kg`/`-lbs` · Reps | assistance weight (sign inferred from the volume formula `Reps × (Weight − Bodyweight)`) [INF for header text] |
| `Reps Only` | Reps | no weight column |
| `Cardio` | km/mi · Time | Time entered as h:mm:ss |
| `Duration` | Time | time only |

### 1.3 Exercises tab [SS]
- Header: `New` (top-left, opens Create New Exercise), title `Exercises`, `…` (top-right).
- Search field; two filter chips `Any Body Part` / `Any Category` (chip turns solid blue and shows the chosen value, e.g. `Chest`); sort button (A-Z / recent).
- Alphabetical sectioned list (A, B, C…) with right-edge A–Z index. Row = thumbnail · name · body-part subtitle. In the add-to-workout picker each row also has a `?` info button that opens Exercise Detail. [HC][SS]
- Swipe-left on a row to **hide** a built-in exercise; restore via History → workout → Edit Workout → tap exercise → Edit → "Restore Exercise". [HC]

### 1.4 Create / Edit Exercise [SS][HC]
- Sheet `Create New Exercise` (X · Save). Fields: `Name` (text), `Body Part` (single-select chips), `Category` (dropdown "Select an Option"). Save disabled until valid.
- `Edit Exercise` for built-ins: Name and Category are locked (padlock) with copy "<Name> can't be edited because it's shared by all Strong users." Body Part chips still shown. Custom exercises can be renamed (6.1.1+). [AS]
- `Transfer Exercise Data` button: "Transfer all data from this exercise into another exercise. This operation cannot be undone." Only to an exercise in the same category. [HC]
- `Archive Exercise` (red) with confirm dialog (Archive Exercise / Cancel).

---

## 2. Templates (a.k.a. Routines in Strong 5)

### 2.1 Start Workout tab (home) [SS]
```
New in 6.0                       (link)
Start Workout                    (large title)
Quick Start
[ Start an Empty Workout ]       (full-width blue button)
Templates            [+ Template] [folder icon] [...]
My Templates (N)                              [...]
  ┌──────────────┐ ┌──────────────┐
  │ Morning      │ │ Tuesday      │   2-column grid of cards:
  │ Workout  ... │ │ Workout  ... │   title, "…" button, exercise
  │ Flat Leg     │ │ Bent Over…   │   names joined by ", " and " and ",
  │ Raise and …  │ │              │   truncated with "…"
  └──────────────┘ └──────────────┘
  (empty state card: "Tap to Add New Template")
<Folder name> (N)                             [...]
  (empty folder card: "Tap to Add / or drag template here to move")
Example Templates (5)                         [...]
```
- Strong 5 cards also showed a relative "last performed" stamp ("An hour ago", "2 minutes ago"). [SS]
- Tapping a card opens a **preview modal**: X · template name · `Edit`; list of `N × Exercise Name` with thumbnail, body part, `?`; superset members get a coloured vertical bar; `[Start Workout]` button. [SS]
- Card `…` menu (6.x): `Edit Template`, `Rename`, `Duplicate`, `Archive`, `Share`, `Delete`. (Strong 5 also had `Add to Siri`.) [SS]
- Templates are reorderable by drag (6.3+ release notes) and can be dragged into folders. [AS][HC]

### 2.2 Example templates shipped by default (5) [SS]
| Name | Exercises |
|---|---|
| Strong 5x5 - Workout A | Squat (Barbell), Bench Press (Barbell), Bent Over Row (Barbell) |
| Strong 5x5 - Workout B | Squat (Barbell), Overhead Press (Barbell), Deadlift (Barbell) |
| Legs | Squat (Barbell), Leg Extension (Machine), Flat Leg Raise, Standing Calf Raise (Dumbbell) |
| Back and Biceps | Deadlift (Barbell), Seated Row (Cable), Lat Pulldown (Cable), Bicep Curl (Barbell) |
| Chest and Triceps | (fifth card, name inferred from the split; exercises not captured) [INF] |
Set counts for the 5x5 templates are 5 sets each (3 exercises × 5 sets; Deadlift conventionally 1×5 but not verified). Toggle `Show Example Templates` in Settings › Advanced hides them. [SS]

### 2.3 Template editor [SS][HC]
- Sheet `New Template` (X · Save). Title row: editable name + `…` menu → `Edit Template Name`, `Add Note`.
- Body is the same exercise-block layout as the workout screen except: the ✓ column header is a **padlock** (sets cannot be completed), no running timer, no date. Each set row still has `Previous` and empty value fields; each block shows a per-set rest value line (`2:00`) and `+ Add Set (2:00)`.
- `Add Exercises` opens the picker (multi-select; `Superset` and `Add` in the header).
- On Save: confirm dialog `Save Template?` (Cancel / Save). On Save a toast confirms creation. Template limit: free = 3, PRO = unlimited. [HC][AS]
- Edit existing: card `…` → Edit Template, or preview → Edit. Delete from editor (`Delete Template`) or card menu.
- Delete dialog: `Delete "<name>"?` "Are you sure you want to delete this template? Anyone you may have shared this with in the past will no longer be able to access it." Buttons: `Delete` (red) · `Archive Only` (blue) · `Cancel`. Archived templates live in an `Archived` folder/screen. [SS][HC]

### 2.4 Folders [SS][HC]
- `Add New Folder` dialog: single text field, Cancel / Save.
- Folder header row `[folder icon] Name (N)` with `…`; tap name to collapse/expand. Folder `…` → create template inside folder, rename, delete.
- `Delete Folder` dialog: "You're about to delete folder <name>. What would you like to do with the templates?" → `Move to My Templates` (blue) · `Delete` (red) · `Cancel`.
- `Save as Template` dialog (from a finished workout) has a `Folder` picker defaulting to `My Templates`.

### 2.5 Template content model
A template stores: name, note, ordered exercises; per exercise: superset group id, exercise note, rest-timer override, weight-unit/bar-type preference; ordered sets with set type (warm-up/normal/drop/failure), target weight, target reps (or distance/seconds), and per-set rest duration. Values in a template are **suggestions**: when a workout starts from it they are pre-filled as placeholders (grey) and the `Previous` column is computed live from history. [SS][HC]

---

## 3. Starting and logging a workout

### 3.1 Entry points
- `Start an Empty Workout` → new workout named by time of day (`Morning Workout`, `Afternoon Workout`, "Monday's session") with no exercises; shows `Add Exercises` and `Cancel Workout` buttons only. [SS]
- Template preview → `Start Workout` → workout pre-populated; subtitle under the name shows the template name ("My Morning Routine"). [SS]
- History card `…` → `Perform Again` (repeat a past workout). [SS]
- Siri Shortcuts: "Start <template>" / start empty workout. [SS]
- Only one workout can be in progress; it persists across app restarts and runs in the background (duration keeps counting). A notification `Unfinished Workout Alert` fires after N minutes of inactivity (default 15m; options list). [SS]

### 3.2 Workout screen anatomy (6.x) [SS]
```
[⏱ 1:59]  [⌚]                               [ Finish ]   ← timer pill (blue while running,
                                                            grey icon when idle), Apple Watch
Morning Workout  [...]                                      sync button, green Finish
📅 Apr 24, 2025
⏱ 0:06                                                   ← elapsed, counts up
Notes                                                     ← placeholder; tap to add workout note
─────────────────────────────────────────────
Flat Leg Raise                      [+161%] [🔗] [...]    ← name (blue), focus-metric chip,
┃ (coloured bar at left = superset)                        superset button, exercise menu
▒ Pinned/sticky note (yellow)                        [📍]
  Exercise note (white)                              [📍]
Set   Previous        kg     Reps    ✓
 1    25 kg × 5       20      5     [✓]   ← green row when completed
─────────── 2:00 ───────────              ← rest value for this set (blue; green once done)
 2    —               20      5     [ ]   ← placeholders grey until typed
[ + Add Set (2:00) ]
...
[ Add Exercises ]
[ Cancel Workout ]
```
- Strong 5 layout was identical minus the per-set rest line (rest was shown only in the header pill). [SS]
- Workout `…` menu: rename, add note, `Adjust Start/End Time` (toggle "Automatic Timing" off and pick start/end — used to log a past workout), share. [HC]

### 3.3 Set row semantics
- **Set** column: number for normal sets; tag letter for typed sets: `W` orange (Warm-up), `D` purple (Drop Set), `F` red (Failure). Tap the set number to open the `Set Tag Menu` (W Warm-up / D Drop Set / F Failure, each with a `?`); tap the same tag again to remove it. Numbering: only normal sets are numbered 1..n; W/D/F rows show the letter instead. [SS][HC]
- **Previous**: last performance for this exercise at the same set index, formatted `25 kg × 5` (weight exercises), `12 reps` (reps-only), `0.478 km | 2:00` (cardio), `—` when none, `No Previous` in 6.5 marketing shots. Source controlled by Settings › Previous Set: `Any Workout` (default) or `Workouts from Same Template Only`. [SS] Tapping Previous copies it into the fields (standard Strong behaviour; [INF] — not stated in HC).
- **Weight / Reps**: numeric fields; grey placeholder = template value or previous value, black = entered. A set is valid when it has values (weight may be 0 for bodyweight).
- **✓**: tapping marks the set complete, turns the row green, fills the check green, and auto-starts the rest timer. Tap again to un-complete.
- **Delete a set**: swipe left on the row. [HC]
- **Add set**: `+ Add Set (m:ss)` appends a set copying the previous set's values and rest. [SS]
- **RPE**: when the Reps field is focused the keypad shows an `RPE` key; a strip `6 · 6.5 · 7 · 7.5 · 8 · 8.5 · 9 · 9.5 · 10` appears with copy "RPE is a way to measure the difficulty of a set. Tap a number to select an RPE value." RPE ↔ RIR mapping: 6→4, 6.5→3-4, 7→3, 7.5→2-3, 8→2, 8.5→1-2, 9→1, 9.5→0-1, 10→0. Tap again to clear. [HC][SS]

### 3.4 Custom keypad [SS]
Numeric keypad replaces the system keyboard: digits, `.`, backspace; right column: plate-calculator key (weight field) / `RPE` (reps field), `− +` stepper (increments weight by the plate-rounding step, reps by 1), and a blue `Next` key that advances to the next empty field (next set, or next exercise in the superset group). [HC]

### 3.5 Rest timer [HC][SS]
- Default 2:00 for every exercise; starts automatically when a set is checked; shown in the top-left pill (`⏱ 1:59`) and, in 6.x, inline as a blue progress bar under the completed set (tooltip "Timer running. Tap to edit or skip.").
- Manual start: tap the timer pill when idle.
- Full-screen modal `Rest Timer` (X · ? help): circular progress ring, big remaining time, small total (`2:30` / `3:00`); buttons `−10s` `+10s` `Skip` (increment configurable; App Store shots show `−30s/+30s`). Copy: "Adjust duration via the +/− buttons." / "Select a predefined value or create your own. Any past custom timers will show first in the list."
- Bottom-panel variant (6.x inline mode): big `Pause` circle, `− +`, `Reset`, `Skip`.
- Per-exercise override: exercise `…` → `Auto Rest Timer` (Strong 5) / `Update Rest Timers` (6.x) → sheet with `Working | Warm-up` segmented tabs, `Enabled` toggle, duration wheel in 5-second steps (…1:50, 1:55, **2:00**, 2:05…). Per-set rest values are also editable by tapping the `2:00` line between sets (6.x).
- Completion: sound (Settings › Rest Timer › Sound Effect: Boxing Bell (default), Double Gong, Short Bell, Long Bell, Iron Plates, Tri Tone, None), `Override Mute Switch` toggle, vibration/notification when backgrounded (requires notification permission prompt: "enable notifications for rest timers and reminders"). Live Activity + Dynamic Island since 6.5.0. [AS]
- Settings › Rest Timer also has `Timer Increment` (segmented, 5s/10s/… up to 30s), `Rest Timer Mode` (full-screen modal vs inline; HC: "Full Screen by default: you can set this in Strong Settings"), and `DEFAULT TIMER VALUES`: `Work Set` (2:00), `Warm-up Set`, `Drop Set` (default None/off), plus `Update Rest Timers for All Templates` action. [SS]
- Supersets: timer behaviour unchanged; `Next` jumps to the paired exercise. Drop sets default to no rest. [HC][SS]

### 3.6 Exercise header controls
- **Focus Metric chip** (top-right of block): per-exercise live metric comparing this session to the last. Options depend on category: weight exercises → Total Volume, Volume Increase (shows `+161%` / `N/A`), Total Reps, Weight/Rep; reps-only → `Total Reps`, `Reps/Set`; cardio → Time/Distance. Tap chip → `Set a Focus Metric` popover listing options with current values. [HC][SS]
- **Superset button** (link icon) → `Create Superset` sheet: Cancel · title · Save; checklist of the workout's exercises ("Select two or more exercises to create a superset"); selected rows get the group colour bar. Grouped exercises are drawn with a vertical coloured bar on their left edge (teal, red, … one colour per group). 3+ exercises = circuit. Superset can also be created from the picker (`Superset` header button after multi-select). [HC][SS]
- **`…` menu (6.x)**: `Add Note`, `Add Sticky Note`, `Update Rest Timers`, `Replace Exercise`, `Create Superset`, `Remove Exercise`. Strong 5 menu: `Add a Note`, `Add Warm-up Sets`, `Replace Exercise`, `Auto Rest Timer (Off ›)`, `Weight Unit (kg ›)`, `Bar Type`. A `Preferences` sub-sheet holds `Weight Unit` (Default (kg) / Metric (kg) / US/Imperial (lbs) — "You can change the Default option for all exercises in Settings") and `Bar Type` (Olympic Bar 20 kg · Short Bar · EZ Bar · Hex Bar · None — "Bar Type is used by the Plate Calculator and Warm-up Calculator"). [SS][HC]
- **Replace Exercise** → picker → confirm `Replace Exercise?` "All previously entered sets will be replaced." (Cancel / Replace red). [SS]
- **Remove Exercise** → `Remove Exercise?` "This removes '<name>' and all of its sets from your workout. You cannot undo this action." (Cancel / Remove red). [SS]
- **Reorder**: long-press the exercise name and drag. [HC]
- **Notes** [HC][SS]: three kinds —
  1. Workout note (field under the title; copied from template each time).
  2. Exercise note (white row under the exercise header, pin icon; belongs to this workout; copied from template).
  3. Pinned / Sticky note (yellow row; belongs to the *exercise*, shown in every workout and in Exercise Detail › About; not shown in History). Toggle by tapping the pin. Dialog `About Sticky Note`: "A sticky note is attached to an exercise and is always visible as you log your workouts. It can be used to write reminders, cues or anything else that you want to remember about this exercise." / `Cool!`.

### 3.7 Calculators (PRO) [HC][SS]
- **Plate Calculator**: barbell/machine exercises; opened via weight field or keypad key. Uses Bar Type weight (Olympic = 20 kg / 45 lb) and shows plates per side ("if a 15 kg plate appears, place one on each side"). Android shows an inline bar graphic with plate stack.
- **Warm-up Calculator**: exercise `…` → `Add Warm-up Sets` (label becomes `Update Warm-up Sets` if some exist). Sheet `Warm-up Sets` (Insert): `Work Set (kg)` input; table Set (W badge) · Formula · Warm-up, e.g. `Bar × 5 → Bar × 5`, `50% × 3 → 35 kg × 3`, `80% × 3 → …`; `+ Add a Set`. Inserted sets are tagged W. Only for Barbell/Dumbbell/Machine.
- Settings › Warm-up Calculator › FORMULA: `Default` (40%×5, 60%×5, 80%×3), `With Empty Bar` (Empty×5, Empty×5, 40%×5, 60%×5, 80%×3), `Alternative` (Empty×5, Empty×5, 30%×5, 70%×3, 100%×1), `Custom`. PLATE ROUNDING: `Loose` 10 kg/20 lb, `Normal` 5 kg/10 lb (default), `Strict` 2.5 kg/5 lb, `Minimal` 0.5 kg/0.5 lb.

### 3.8 1RM display during logging
No live 1RM is shown on the set row; estimated 1RM appears in Records/Charts and on the finish summary. [SS][3P]

---

## 4. Finishing a workout

1. Tap `Finish` → dialog `🎉 Finish Workout?` (Cancel / Finish green). [SS]
2. If any set has values but is not checked: `Finish Workout?` "There are valid sets in this workout that have not been marked as complete. Invalid or empty sets will be removed." Buttons: `Complete Unfinished Sets` (green) · `Discard Unfinished Sets` (red text) · `Cancel`. Empty sets are always dropped. [SS]
3. Workout end time = now (unless Automatic Timing was disabled). PRs are computed. Apple Health workout written if enabled. [HC][AS]
4. **Summary screen** [SS]: X (top-left), share icon (top-right). Header: gold stars + `Congratulations!` + subtitle (`That's your 1st workout!`, or a streak/record message). Card: workout name, `10:42 AM, Thursday, Apr 24 2025`, stat row `⏱ 4m` · `▲ 0 kg` (total volume) · `🏆 2 PRs`; then each exercise with its sets (`1  12 reps  [🏆 badge]`), superset bars preserved. Bottom button `🏆 2 Personal Records` opens the records list. Share icon opens the iOS share sheet.
5. **Template prompts** (shown over the summary) [HC][SS]:
   - Started from empty: `Save as Template?` "Save this workout as a template so you can perform it again in the future." → `Save as Template` / `No thanks!` → `Save as Template` sheet: `Template Name` (prefilled with workout name), `Folder` (My Templates ›), `Save`.
   - Started from a template and changed it: `Update Template` "You've made changes from your original template. Would you like to update it?" with context-sensitive buttons:
     - `Update Template` + subtitle describing the structural diff ("Adds 2 sets.", "Removes 1 set. Adds 1 exercise."). Rendered **red** when destructive (removes exercises/sets).
     - `Update Values Only` + "Updates values for N sets." (only weights/reps changed).
     - `Update Template and Values` + diff subtitle (both structure and values changed).
     - `Keep Original Template`.
     Rule: structural diff = exercises/sets/order/set types differ; value diff = any weight/reps on a matching set differ. Show only the buttons that apply. Toggle `Show Update Template` in Settings › Advanced disables the prompt.
6. `Cancel Workout` (red, bottom of editor) discards after confirmation.

---

## 5. History

- **List** [SS]: title `History`, `Calendar` link top-right. Month section headers (`APRIL 2025`). Card per workout: name + `…`; `Thursday, Apr 24`; stat row `⏱ 4m` · `▲ 0 kg` · `🏆 2 PRs`; two-column table `Exercise | Best Set` with rows `2 × Flat Leg Raise | 12 reps` (count × name, best set formatted `100 kg × 5` / `12 reps` / distance-time), superset colour bars preserved. Very short workouts show seconds (`9s`).
- **Card `…` menu** (6.x): `Edit Workout`, `Save as Template`, `Perform Again`, `Share`, `Delete`. Delete confirm has red `Delete` / `Cancel`. [SS][HC]
- **Calendar modal** [SS]: X · `Calendar`; weekday header `S M T W T F S` (first weekday from Settings › Start Week On); month label `Apr 2025`; scrollable months; days with workouts get a dark filled circle with a green dot; tap a day to jump to that workout in the list.
- **Detail**: tapping a card opens the full workout (read-only summary identical to the finish card; same `…` actions). [SS]
- **Edit past workout** [HC]: `…` → `Edit Workout` opens the workout editor on the saved data (add/remove sets, exercises, change values, adjust start/end time). Saving recomputes PRs.
- `Start History From` (Settings › Advanced) hides workouts before a date from History/charts/PRs without deleting them ("You can change this date anytime. Your full workout history is always safe and will not be deleted."). [HC][SS]

---

## 6. Exercise Detail screen

Opened from: exercise name in a workout, `?` in the picker, or any row in the Exercises tab. Modal: X · `Deadlift (Barbell)` · `Edit`. Segmented tabs `About | History | Charts | Records`. [HC][SS]

- **About**: animated illustration (two frames) with play button, sticky note (yellow, dismissible X) if present, `Instructions` numbered list.
- **History**: every workout containing this exercise, newest first: workout name, date, and the sets (`W 20 kg × 5`, `1 100 kg × 5 …`). Empty state with `Edit` button. [HC][SS]
- **Charts** (PRO; free users see blurred cards with `Unlock Charts with PRO`): a card per metric, each with expand (landscape full-screen) and `…` (`+ Add to Profile`). Range selector (e.g. 1M/3M/6M/1Y/All) at the bottom of each card. Metrics by category [SS]:
  - Weight exercises: `Best Set (Est. 1RM)`, `Best Set (Max Weight)`, `Total Volume` (per workout).
  - Reps-only / weighted bodyweight: `Total Volume Added`, `Max Consecutive Reps`, `Total Reps`.
  - Cardio/duration: distance/time equivalents [INF].
- **Records** [SS][HC]:
  - Section `PERSONAL RECORDS` — weight exercises: `1RM` · `Weight` · `Max Volume` (value at right); reps-only / weighted bodyweight: `Max Reps` · `Max Weight Added` · `Max Volume Added`.
  - Button `View Records History` → `Records History` screen (`Record Progression`: chronological list of every PR event; empty copy "Personal Records for this exercise will display here – check back later!").
  - Table `REPS | BEST PERFORMANCE | PREDICTED` for reps 1…12. Best Performance = heaviest actual set at exactly that rep count. Predicted = xRM derived from the single best lift (highest estimated 1RM, reps < 12). If actual ≥ predicted, the actual value is shown in the Predicted column. "Strong only supports records for sets with 12 or fewer reps."
- **Edit** (top-right) → Edit Exercise sheet (§1.4).

---

## 7. Measurements and Profile

### 7.1 Measurements [HC][SS]
Screen `Measurements` (X). Sections:
- `CORE`: `Weight` (kg/lb, syncs with Apple Health), `Body Fat` (%), `Caloric Intake` (kCal).
- `BODY PART` (PRO): `Neck`, `Shoulders`, `Chest`, `Left Bicep`, `Right Bicep`, `Left Forearm`, `Right Forearm`, `Upper Abs`, `Waist`, `Lower Abs`, `Hips`, `Left Thigh`, `Right Thigh`, `Left Calf`, `Right Calf` (cm/in per `Size Unit`).
Each row: current value + `+` quick-add. `Add Measurement` sheet: X · Save; value field labelled `WEIGHT (KG)`; month calendar to pick the date; `Time` picker (defaults now). Tap a row for the full entry list + chart; swipe to delete an entry. Progress photos: attach photos to a workout ("progress pictures" [AS]); `Save Photos to Camera Roll` setting.

### 7.2 Profile tab [SS][HC]
- Header: gear (Settings) + PRO icon top-left; `Profile`; optional yellow banner "Please verify your email address."; avatar (crown badge when PRO), display name, bio line, `N workouts completed`.
- `Dashboard` + `+ Widget`. `Add Widget` sheet: `Workouts Per Week` ("Display workout consistency"), `Calories This Week`, `Daily Macros`, `Exercises ›` ("Track a specific exercise" → pick exercise + metric), `Measurements ›` ("Track a specific body metric").
- `Workouts Per Week` widget: purple weekly bars labelled by week start (`3/2, 3/9 …`), dashed goal line; target set via `Set Workout Target` ("Target Workouts per Week", numeric). Also available as a home-screen widget; 6.4 added Calendar and Activity home-screen widgets; 6.4.3 added "Week of Year" label option. [AS]
- Widgets: long-press drag to reorder; `…` → Remove.

---

## 8. Settings (complete list as observed, 6.0.2) [SS][HC]

```
Settings                                   [Store]
Apple Watch ›
GENERAL
  Notifications ›        → Unfinished Workout Alert (15m ›), Device Settings
  Apple Health ›         → connect, read/write toggles, Active Calorie Rate (Low/Medium/High)
  Siri Shortcuts ›       → "Start empty workout", one per template
  Advanced ›             → see below
APPEARANCE
  Theme (Light ›)        → Switch Automatically; Light / Dark / Black / Halloween
  App Icon (Strong ›)    → icon grid (PRO)
LOG WORKOUT
  Rest Timer ›           → Timer Increment (5s|10s|…|30s), Override Mute Switch, Sound Effect,
                           Rest Timer Mode, DEFAULT TIMER VALUES: Work Set 2:00 / Warm-up Set /
                           Drop Set, [Update Rest Timers for All Templates]
  Warm-up Calculator ›   → Formula + Plate Rounding (see §3.7)
  Previous Set (Any Workout ›) → Any Workout | Workouts from Same Template Only
UNITS AND LOCALIZATION
  Language (English ›)
  Weight Unit            → Metric (kg) | US/Imperial (lbs)   (exercise default; per-exercise override)
  Distance Unit          → km | miles  [INF: present, options assumed]
  Measurement Weight Unit → Metric (kg) | US/Imperial (lbs)
  Size Unit (Metric (cm) ›) → cm | in
  Start Week On (Sunday ›)
DATA MANAGEMENT
  Sync ›                 → last sync time, Sync Now, Sync Entire Account
  Export Strong Data     → CSV via share sheet (6.2: with/without timers and notes)
HELP & SUPPORT
  Help & Support ›, Review Strong in the App Store
Privacy Policy, Terms of Service, Privacy Settings ›
[ Log Out ]
footer: "Workouts logged: N … pending for sync" + version
```
**Advanced** [SS]: `Sound Effects` ("This does not include the timer alert sound"), `Disable Sleep` ("Prevents the screen from turning off during a workout" = keep screen on), `Count Dumbbells Twice` ("Doubles the volume when calculating dumbbell exercises"; iOS only, Android always doubles), `Show Update Template` ("Shows update template prompt when changes are made to a workout"), `Start History From` (Off / date), `Show Example Templates`, `xRM Formula (Hybrid ›)`, `Show "New in 6.0" Button`; section `TOTAL WORKOUT VOLUME`: `Include Weighted Bodyweight Exercises` ("Volume = Reps × (Weight + Bodyweight)"), `Include Assisted Bodyweight Exercises` ("Volume = Reps × (Weight − Bodyweight)").

**xRM Formula screen** [SS]: banner "Please allow a few minutes for any changes to the xRM settings to come into effect as the app needs to re-calculate PRs and Charts." Options `Hybrid (Recommended)` ✓ · `Brzycki` · `Epley`. Copy: "Hybrid Formula uses Brzycki for lower reps (< 10) and Epley for higher reps." "xRM (x Repetition Maximum) is an estimate of your best performance in weight for 'x' repetitions for a given set. This metric is used in various parts of the app such as Personal Records, Charts and more." Toggle `Factor in RPE` — "Adjusts the xRM estimate based on RPE."

Strong 5 equivalents lived under `Bonus Options` (Sound Effects, Disable Sleep, Count Dumbbells Twice, Previous Set, Save Photos to Camera Roll, Show Example Routines). [SS]

---

## 9. Free vs PRO [HC][AS][SS]
Free: unlimited workouts and history, 3 templates, custom exercises, rest timer, set tags, supersets, RPE, Apple Watch, cloud sync, Apple Health, CSV export, records table, weight/body-fat measurements, no ads.
PRO ($4.99/mo, $29.99/yr, $99.99 lifetime; varies): unlimited templates, all charts (exercise + profile widgets), body-part measurements, plate calculator, warm-up calculator, themes/app icons. Paywall copy: "Get Strong PRO and unlock all features to take your workouts to the next level." bullets: Store unlimited templates · Charts, analytics and insights · Track body part measurements · Tools to speed up your workout.

---

## 10. CSV export format (useful as an interchange baseline) [3P: StrongCsvParser, intervals.icu]
Header (order may vary; parsers match by name):
`Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE`
- `Date`: workout start, `yyyy-MM-dd HH:mm:ss` (also seen `yyyy-MM-dd'T'HH:mm:ss`, `yyyy-MM-dd HH:mm`), local time, no zone. All rows of one workout share it.
- `Duration`: `53m`, `1h 5m`.
- `Set Order`: `W` warm-up, `1..n` working sets, `D` drop set (failure sets export as numbered — the F tag is not in the CSV).
- `Weight`: in display unit; newer exports label the header `Weight (kg)` / `Weight (lbs)`. Cardio/duration rows have weight 0, reps 0, `Distance` (m) and `Seconds`.
- `Notes` = exercise note, `Workout Notes` = workout note (multi-line quoted). `RPE` blank or 6–10 in 0.5 steps.
- UTF-8 BOM, quoted commas, one row per set. Strong cannot re-import its own CSV.

---

## 11. Proposed data model

```sql
-- Reference ----------------------------------------------------------------
CREATE TABLE exercises (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,               -- "Bench Press (Barbell)"
  body_part     TEXT NOT NULL CHECK (body_part IN
                ('core','arms','back','chest','legs','shoulders','other','olympic','full_body','cardio')),
  category      TEXT NOT NULL CHECK (category IN
                ('barbell','dumbbell','machine_other','weighted_bodyweight','assisted_bodyweight',
                 'reps_only','cardio','duration')),
  is_builtin    BOOLEAN NOT NULL DEFAULT 0,  -- builtin: name/category locked
  instructions  TEXT, media_url TEXT,
  sticky_note   TEXT,                         -- pinned note shown in every workout
  default_bar_type TEXT,                      -- olympic|short|ez|hex|none (barbell only)
  weight_unit_override TEXT,                  -- NULL=default, 'kg', 'lb'
  rest_working_s INTEGER, rest_warmup_s INTEGER,  -- per-exercise default rest overrides
  archived_at   DATETIME, hidden BOOLEAN DEFAULT 0,
  user_id       TEXT                          -- NULL for builtins
);

-- Templates ----------------------------------------------------------------
CREATE TABLE template_folders (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, sort_order INT);
CREATE TABLE templates (
  id TEXT PRIMARY KEY, user_id TEXT, folder_id TEXT REFERENCES template_folders(id),
  name TEXT NOT NULL, note TEXT, is_example BOOLEAN DEFAULT 0,
  sort_order INT, archived_at DATETIME, last_performed_at DATETIME,
  created_at DATETIME, updated_at DATETIME
);
CREATE TABLE template_exercises (
  id TEXT PRIMARY KEY, template_id TEXT REFERENCES templates(id) ON DELETE CASCADE,
  exercise_id TEXT REFERENCES exercises(id), position INT NOT NULL,
  superset_group INT,                         -- NULL or small int; same int = same superset
  note TEXT, rest_working_s INT, rest_warmup_s INT
);
CREATE TABLE template_sets (
  id TEXT PRIMARY KEY, template_exercise_id TEXT REFERENCES template_exercises(id) ON DELETE CASCADE,
  position INT NOT NULL,
  set_type TEXT NOT NULL DEFAULT 'normal' CHECK (set_type IN ('warmup','normal','drop','failure')),
  weight REAL, reps INT, distance_m REAL, seconds INT, rest_s INT
);

-- Workouts -----------------------------------------------------------------
CREATE TABLE workouts (
  id TEXT PRIMARY KEY, user_id TEXT,
  template_id TEXT REFERENCES templates(id),  -- NULL for empty workouts
  name TEXT NOT NULL, note TEXT,
  started_at DATETIME NOT NULL, ended_at DATETIME,   -- NULL while in progress
  automatic_timing BOOLEAN DEFAULT 1,
  bodyweight_kg REAL,                         -- snapshot for bodyweight volume
  total_volume_kg REAL, pr_count INT,         -- denormalised for list cards
  status TEXT CHECK (status IN ('in_progress','finished','cancelled')),
  created_at DATETIME, updated_at DATETIME
);
CREATE TABLE workout_exercises (
  id TEXT PRIMARY KEY, workout_id TEXT REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id TEXT REFERENCES exercises(id), position INT NOT NULL,
  superset_group INT, note TEXT,
  weight_unit TEXT, bar_type TEXT,            -- resolved at log time
  focus_metric TEXT                           -- total_volume|volume_increase|total_reps|weight_per_rep|reps_per_set|...
);
CREATE TABLE sets (
  id TEXT PRIMARY KEY, workout_exercise_id TEXT REFERENCES workout_exercises(id) ON DELETE CASCADE,
  position INT NOT NULL,
  set_type TEXT NOT NULL DEFAULT 'normal' CHECK (set_type IN ('warmup','normal','drop','failure')),
  weight REAL,                                -- always stored in kg; convert for display
  reps INT, distance_m REAL, seconds INT,
  rpe REAL CHECK (rpe IS NULL OR (rpe BETWEEN 6 AND 10)),
  completed BOOLEAN NOT NULL DEFAULT 0, completed_at DATETIME,
  rest_s INT,                                 -- rest that follows this set
  est_1rm REAL, volume REAL                   -- cached, recomputed on save
);

-- Records ------------------------------------------------------------------
CREATE TABLE personal_records (
  id TEXT PRIMARY KEY, user_id TEXT, exercise_id TEXT REFERENCES exercises(id),
  record_type TEXT NOT NULL CHECK (record_type IN
    ('est_1rm','max_weight','max_set_volume',           -- weight exercises
     'max_reps','max_weight_added','max_volume_added',  -- reps-only / weighted bodyweight
     'max_distance','max_duration',                     -- cardio / duration (INF)
     'rep_max')),                                       -- per-rep-count best (reps 1..12)
  reps INT,                                   -- only for rep_max
  value REAL NOT NULL,
  set_id TEXT REFERENCES sets(id), workout_id TEXT REFERENCES workouts(id),
  achieved_at DATETIME NOT NULL,
  superseded_by TEXT REFERENCES personal_records(id)    -- NULL = current record
);
-- Records History = SELECT * FROM personal_records WHERE exercise_id=? ORDER BY achieved_at.

-- Measurements -------------------------------------------------------------
CREATE TABLE measurements (
  id TEXT PRIMARY KEY, user_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('weight','body_fat','caloric_intake','neck','shoulders','chest',
    'left_bicep','right_bicep','left_forearm','right_forearm','upper_abs','waist','lower_abs','hips',
    'left_thigh','right_thigh','left_calf','right_calf')),
  value REAL NOT NULL, measured_at DATETIME NOT NULL, source TEXT   -- manual|apple_health
);
CREATE TABLE progress_photos (id TEXT PRIMARY KEY, user_id TEXT, workout_id TEXT, taken_at DATETIME, url TEXT);

-- Settings (per user) -----------------------------------------------------
-- weight_unit, distance_unit, measurement_weight_unit, size_unit, start_week_on,
-- rest_default_work_s=120, rest_default_warmup_s=NULL, rest_default_drop_s=NULL, timer_increment_s=10,
-- timer_sound, override_mute, timer_mode, previous_set_source('any'|'same_template'),
-- xrm_formula('hybrid'|'brzycki'|'epley'), factor_rpe, count_dumbbells_twice,
-- include_weighted_bw_volume, include_assisted_bw_volume, show_update_template_prompt,
-- show_example_templates, start_history_from, disable_sleep, sound_effects,
-- unfinished_workout_alert_min=15, warmup_formula, plate_rounding, theme, workouts_per_week_target.
```

---

## 12. Calculation rules

### 12.1 Estimated 1RM ("xRM")
- Official (help center, 2021): **Brzycki** — `1RM = w × 36 / (37 − r)`. [HC]
- Strong 6 setting (default **Hybrid**): Brzycki when `r < 10`, **Epley** `1RM = w × (1 + r/30)` when `r ≥ 10`; user may force either. [SS]
- "For reps above 12, 1RM estimations will break down significantly" — treat sets with `r > 12` as ineligible for 1RM/records. `r = 1` → `1RM = w`. [HC]
- Predicted xRM for the records table: invert the chosen formula on the best estimated 1RM: Brzycki `w_x = 1RM × (37 − x) / 36`; Epley `w_x = 1RM / (1 + x/30)`. Use the same hybrid split by `x`. [SS][INF for inversion]
- `Factor in RPE` (optional): adjust the estimate for reps in reserve: `effective_reps = r + RIR(rpe)` where RIR = 10 − RPE (table in §3.3) before applying the formula. [INF — Strong only says "Adjusts the xRM estimate based on RPE".]
- Recalculating formula changes re-derives all PRs and charts (hence the "allow a few minutes" banner). [SS]

### 12.2 Volume
- Set volume (weight exercises) = `weight × reps`. Dumbbell: `× 2` when `Count Dumbbells Twice` (iOS default off; Android always on). [HC][SS]
- Weighted bodyweight: `reps × (added_weight + bodyweight)` when `Include Weighted Bodyweight Exercises` is on (default on); bodyweight = latest Weight measurement. Assisted: `reps × (bodyweight − assistance)`. Reps-only, cardio, duration contribute 0 to total volume. [SS]
- Workout total volume (`▲ 0 kg` on cards) = sum of set volumes over **completed, non-warm-up** sets. [HC: "Warm-up sets will not be included in charts or metrics."]
- Per-exercise `Total Volume` chart point = sum of that workout's set volumes for the exercise.

### 12.3 Which sets are eligible for records
- `completed = 1`, `set_type ≠ 'warmup'`. Drop and failure sets count (only warm-ups are excluded by the docs; drop-set rows still carry weight×reps). [HC][INF for drop/failure]
- Weight exercises require `weight > 0` and `1 ≤ reps ≤ 12` for `est_1rm` and `rep_max`; `max_weight` and `max_set_volume` have no rep cap [INF — Strong states the 12-rep cap for "records", apply it to all three to be safe].
- Workouts before `Start History From` are ignored. Editing or deleting a past workout triggers recomputation for the affected exercises. [AS release notes mention PR recalculation respecting Start History From.]

### 12.4 Record types
| Category | Records shown | Definition |
|---|---|---|
| barbell / dumbbell / machine | `1RM`, `Weight`, `Max Volume` | max est_1rm; max weight in any eligible set; max single-set `weight×reps` |
| reps_only / weighted_bodyweight / assisted_bodyweight | `Max Reps`, `Max Weight Added`, `Max Volume Added` | max reps in a set; max added weight; max `added_weight×reps` |
| cardio | best distance, best time/pace [INF] | |
| duration | longest duration [INF] | |
| all weight categories | per-rep `rep_max` (1…12) | heaviest weight achieved at exactly that rep count (feeds the Records table "Best Performance") |

### 12.5 PR detection at finish (and on edit)
For each completed eligible set, compare against the current record of each type for that exercise (ties do not count; strictly greater). Each broken type creates a `personal_records` row (superseding the old one) and the set gets a 🏆 badge in the summary/history. The summary `N PRs` counter = number of records created in that workout. The first ever performance of an exercise sets records (the first-workout screenshot shows `2 PRs` for two brand-new reps-only exercises). [SS][INF for tie rule]

### 12.6 "Previous" lookup
For set index `i` of exercise `E` in the current workout, find the most recent finished workout (per `previous_set_source`) containing `E`; take its `i`-th set in the same ordering (warm-ups matched to warm-ups, numbered to numbered); if that workout has fewer sets, show `—`. Format per category (§3.3). [SS][INF for index-matching details]

### 12.7 Focus metric
`Total Volume` = sum of completed set volumes so far; `Volume Increase` = `(today − previous_workout_total) / previous_workout_total` shown as signed percent, `N/A` when no previous. `Total Reps`, `Reps/Set` analogous. [HC][SS]

### 12.8 Warm-up calculator
Given work-set weight `W` and bar weight `B`: for each formula step `p% × n` → `round_to_step(W × p)` with step from Plate Rounding (Normal = 5 kg / 10 lb); `Empty`/`Bar` steps use `B`; never below `B`; insert as `W`-tagged sets before existing sets. [SS][INF for clamping]

---

## 13. Screenshot / asset URLs

Official help-center screenshots (CloudFront, Strong 5 UI unless noted):
- Set tag menu (W/D/F, cardio + weight rows): https://d33v4339jhl8k0.cloudfront.net/docs/assets/57baea42c697917de37cf9d3/images/5caf84690428631d263c06e7/file-Hrsu5nMtsM.jpg
- Workout screen with running timer pill: …/600fd99d1c64ad47e4b72d4b/file-kfhfevtqmF.jpg
- Full-screen Rest Timer (−10s/+10s/Skip): …/600fda342e764327f87c244d/file-GR4VPGt066.png
- Per-exercise Auto Rest Timer sheet: …/600fdb99cfe30d219ccdb6ff/file-qmJig4hOwO.jpg
- Update Template dialog variants (4 figs): …/60add662dca0fd46b93592a5/file-96NxFB7Koy.png
- Save as Template? dialog: …/60adce47eb3af44cc120c880/file-8hBduacLIR.jpg
- Records table explainer: …/5fb7b4c0cff47e00160bbfe1/file-dkYTkm1p6x.png
- Focus metric (+161%): …/5fd90a4db624c71b79859c27/FocusMetric.jpg
- Exercise Detail (About tab): …/60211702ac2f834ec538656e/file-DiV5HDegHB.jpg
- Measurements list: …/602238156867724dfc6f105b/file-aibdVqd7IH.jpg
- Add Widget sheet: …/602215c01f25b9041bebcd44/file-S3YgvwwcMU.jpg
- Keypad with plate-calculator key (iOS/Android): …/5fdb90b77129911ba1b22118/file-SjAL8aZhpf.jpg, …/5fdb88937129911ba1b220ca/file-Zs7FyH5IUl.jpg
- Exercise … menu / Warm-up calculator settings: …/600e6fe7c64fe14d0e1fe150/file-O0oTQ91rQs.jpg, …/5caf87f62c7d3a392f9cef66/file-7OMOSkVNp5.jpg
- Workout screen (Example Routine, completed set): …/600e91acc64fe14d0e1fe20e/file-Maa4sQU37J.jpg
- Notes (workout/exercise/pinned): …/600e66cb2e764327f87c1d2f/file-JoC8f6VHAG.jpg, …/600e67f0cfe30d219ccdb00f/file-wTbJg607jo.jpg, …/5c9a617e0428633d2cf4117c/file-Yp9rRtGu41.jpg
- RPE keypad: …/600e8e6acfe30d219ccdb0c1/file-VU07uE05N8.jpg
- Bonus Options settings: …/5d1d430a2c7d3a5cd38e99a7/file-Qh1LCuF7T0.png
- Routine card … menu: …/5fd91d6a27288b7f895d5bfe/file-Vlw0qTB17p.jpg

App Store screenshots (6.5.1): 
- https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/69/73/e8/6973e875-869b-eab6-2774-1c2e229d259e/76b4c774-2662-4f1c-a5d0-b9bf569ae218_three-million-big-dis.png/600x1300bb.webp (workout screen)
- https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/37/0a/ac/370aac59-7732-b281-ad5c-fe5af3cf8a81/mzl.zszwveia.png/600x1300bb.webp (exercise detail)
- https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/bf/97/72/bf97720b-6be1-5903-6c0e-f5c52e247520/mzl.qrnkrqfo.png/600x1300bb.webp (warm-up sets sheet)
- https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/15/ee/6b/15ee6be2-3b32-f2cf-dc8d-f9d81c80fff5/mzl.wsjbwnrh.png/600x1300bb.webp (rest timer −30s/+30s)
- https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/06/4c/06/064c06e7-bf2d-fc69-c494-e6cb0c23092c/mzl.gujtgray.png/600x1300bb.webp (profile charts)

v6.0.2 UX teardown (154 screens, index + thumbnails): https://screensdesign.com/apps/strong-workout-tracker-gym-log/?vs=133312 — thumbnails at `https://media.screensdesign.com/avs-pr-640/<hash>.webp`; notable hashes: home `d15dc80d3cf44098852d86bf20f6abc6`, summary `8fdfc50aea1f4cabb758762c67396e3f`, unfinished-sets dialog `a809f0f428e34e74982f92206ab0e73c`, records `ac3633f2a5a344d4841d5927a409a139`, create exercise `d66b12bf2aea482c986cf9f864c1ec00`, category list `fce7811f07dd4d0ea6971c7c309ebbd8`, xRM settings `52d7c02d57594b94a0c912d890cb8083`, rest-timer settings `9164c1a69e9a48faadf75fb858105e7b`, advanced settings `cf0e577974384e1e96fd010659f4fc05`, history `051b79ff7f5349c0ab3e0c7dcb50494c`, calendar `e463001811014f04989fa0791015d0df`, superset sheet `8abb61e1da7149bca8b7533be527fe85`, template editor `589ab17bb0384fb185d73b04332897ef`.

---

## 14. Sources

Official
1. https://www.strong.app/ (features, links)
2. https://apps.apple.com/us/app/strong-workout-tracker-gym-log/id464254577 (description, release notes 6.0–6.5.1, IAP)
3. https://play.google.com/store/apps/details?id=io.strongapp.strong (feature list)
4. https://help.strongapp.io/ — articles used: 229 my-first-workout, 231 rest-timer, 134 about-notes, 230 about-rpe, 98 supersets-and-circuits, 166 set-tags, 169 plate-calculator, 171 warm-up-calculator, 226 focus-metric, 167 adjust-workout-date, 177 update-template, 105 about-templates, 107 organize-templates, 106 edit-template, 109 share-workout-or-template, 249 edit-past-workout, 250 reset-workout-history, 97 create-custom-exercises, 99 delete-hide-exercises, 209 merge-exercise-data, 101 dumbbell-counting, 237 exercise-detail, 216 exercise-records-screen, 133 1rm, 235 export-workout-data, 132 strong-pro, 238 add-measurements, 239 profile-widgets, 224 workout-on-apple-watch, 240 nutrition, 228 what-is-strong, 236 best-way-to-train (all at https://help.strongapp.io/article/<id>)

Third-party
5. https://screensdesign.com/apps/strong-workout-tracker-gym-log/?vs=133312 (v6.0.2 screen captures)
6. https://mwm.ai/apps/strong-workout-tracker-gym-log/464254577 (App Store screenshots + captions)
7. https://www.thenerdystudent.com/2021/08/strong-review/ (records = 1RM/weight/max volume, calendar, rest timer)
8. https://justuseapp.com/en/app/464254577/strong-workout-tracker-gym-log/reviews (user reports on previous column, update-template, PR display)
9. https://github.com/edvanbeinum/StrongCsvParser (CSV columns, W/D codes, date formats, weight-unit header)
10. https://forum.intervals.icu/t/import-strong-data-weightlifting-app/5531 (CSV column list)
11. https://github.com/bladeours/strong-to-excel and https://github.com/hexjelly/strong-csv-charts (CSV consumers)
12. https://arvo.guru/blog/hevy-to-arvo-csv-import (export steps)
13. https://repreturn.com/strong-app-review/ (logging flow, per-exercise timers)
14. https://griptapp.com/compare/strong-app-review (free/PRO matrix, Live Activity, CSV notes)
15. https://www.sensai.fit/blog/strong-app-review-2026 (Brzycki, finish summary contents, version dates)
16. https://prpath.app/blog/strong-app-review-2026.html (PR per rep range, notifications)
17. https://independent-app-reviews.org/reviews/strong-review/ (pre-fill behaviour)
18. https://setgraph.app/articles/strong-app-review-is-it-worth-it-honest-comparison-vs-setgraph (template limits)
19. https://www.producthunt.com/p/strong-workout-tracker-gym-log/strong-5 (Strong 5 launch notes)
20. https://realtimephysique.com/blog/day-811-my-400th-workout-on-the-strong-app/ (1RM history usage)
21. https://en.wikipedia.org/wiki/One-repetition_maximum (Brzycki/Epley formulas)

Not reachable from this environment: reddit.com (r/StrongApp), apkmirror.com changelogs, garagegymreviews.com review pages.
