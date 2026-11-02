# Nutrition, Body Progress & Water — Feature Spec and Technical Plan

Status: research deliverable, 2026-11-02. Scope: photo/barcode/text food logging (Cal AI-style), a MyFitnessPal-style daily nutrition dashboard, body-progress photos, and water logging inside AravOS (`apps/server` Hono + Drizzle/SQLite, `apps/web` Vite + Capacitor, `packages/shared` zod). AI analysis uses the Claude API (vision + structured outputs); no custom ML model.

Everything below is written as deltas against what already exists in the repo: `apps/server/src/db/schema.ts` (tables `foods`, `meals`, `meal_items`, `water_logs`, `weight_logs`, `body_photos`, `photo_analyses`), `packages/shared/src/nutrition.ts` (`bmrMifflinStJeor`, `tdee`, `dailyAdjustmentForPace`, `suggestTargets`) and `packages/shared/src/schemas.ts` (`Nutrients`, `Meal*`, `FoodAnalysis`, `HealthProfile`, `BodyPhoto`, `PhotoAnalysis`).

---

## 0. Decisions in one screen

| Topic | Decision |
|---|---|
| Food recognition | Claude vision, one request per photo, `output_config.format` JSON schema (structured outputs). Model from `ANTHROPIC_VISION_MODEL` (default `claude-opus-5-5`; Haiku 5.5 / Sonnet 5.5 are the cheaper options, user's call). |
| Nutrient numbers | AI returns its own estimate **and** `search_terms`; server re-prices every item it can match against the bundled USDA table (per-100 g × grams). AI numbers are the fallback, not the source of truth. |
| Bundled food DB | USDA **FNDDS 2021-2023** (foods as eaten, 65 nutrients, portion weights) + **SR Legacy** raw ingredients, pruned to ~2.5–3k foods. Measured: 4,923 non-generic FNDDS foods = 2.2 MB JSON / 236 KB gzip, so a 3k curated subset lands at ~1.3 MB / ~140 KB gzip. Build script in §4.6. |
| Barcode | Open Food Facts v2 (no key) first, USDA Branded (`/foods/search?query=<UPC>&dataType=Branded`) second, then "scan label" fallback. |
| Daily targets | Mifflin-St Jeor × activity multiplier ± pace deficit/surplus (7,700 kcal/kg); protein by g/kg (ISSN); fat 25–30 % kcal; carbs = remainder; fiber 14 g/1,000 kcal; sodium ≤ 2,300 mg; added sugar ≤ 10 % kcal; sat fat ≤ 10 % kcal; water default from NASEM/EFSA. Re-estimate TDEE weekly from the weight trend. |
| Net calories | MFP semantics: `remaining = goal + exercise_addback − eaten`; add-back and rollover are user toggles (Cal AI exposes both at onboarding). |
| Body photos | Local-only by default, EXIF stripped, never sent to the API unless the user taps **Compare with AI**; the model only describes visible, caveated changes — no body-fat %, no numeric "progress score". Replace `photo_analyses.progressScore` with structured observations. |

---

## 1. What the reference apps do

### 1.1 Cal AI (calai.app, acquired by MyFitnessPal)

Sources: [calai.app](https://www.calai.app/), [App Store listing](https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616), [FeastGood hands-on review](https://feastgood.com/cal-ai-review/), [Calorie Tracker Lab](https://calorietrackerlab.com/reviews/cal-ai/), [The App Reviewer teardown](https://the-app-reviewer.com/teardowns/cal-ai/), [Calsy review](https://calzy-app.com/blog/cal-ai-review), [Cal AI privacy policy](https://www.calai.app/privacy).

**Onboarding (in order):** gender → workouts/week → height & weight → age → "do you work with a nutritionist?" → main goal (lose / maintain / gain) → desired weight → pace (slider; the "recommended" option for the FeastGood author was 1 lb/week gain, which he found aggressive) → biggest obstacles → diet type → **two toggles: add exercise calories back; roll over unused calories to tomorrow** → "Your custom plan is ready" (calories + P/C/F) → paywall (3-day trial) → dashboard. Cal AI does not publish its formula. The one documented plan (male, gain 1 lb/wk) was 2,964 kcal, P 226 g / C 329 g / F 82 g = 30.6 % / 44.5 % / 24.9 % of kcal, i.e. protein ≈ 1 g/lb bodyweight, fat ≈ 25 %, carbs = remainder. Targets are editable under Settings → Edit Nutrition Goals, and users complain that editing one macro does not re-balance the others.

**Home ("Today"):** calories left + protein/carbs/fat left (ring + three bars) at the top; swipe 1 → extra metrics and a **daily 10-point health score**; swipe 2 → steps vs goal, calories burned, water logged; below → "Recently logged" meals (photo thumbnail, name, kcal, macros) and exercise synced from Apple Health. Users report the health score is opaque ("4/10 despite protein over target").

**Logging (+ button):** Scan Food (camera, "depth sensor calculates food volume"), Barcode, Food Label (camera on a Nutrition Facts panel; user then adjusts serving), Describe (free text → "related foods and meals from its library"), Saved foods, Database search (MyFitnessPal DB incl. 380+ restaurant chains), Custom food / recipe. Camera opens in < 1 s, result in ~2–4 s.

**Results card:** dish name, calories, protein/carbs/fat, ingredient list with per-ingredient calories, portion slider / ± servings ("most users don't adjust"), **Fix Results** = free-text correction box ("it's brown rice not couscous, and there's no sauce") that re-runs the estimate; also a nutrition-label fallback. The App Reviewer notes corrections drop you into "a thin catalogue" and deep bowls fail because depth is not recoverable from a single overhead photo. Fiber/sugar and ~6 micronutrients (sodium, potassium, calcium, iron, vitamins) are Premium.

**Accuracy (DAI study cited by Calorie Tracker Lab, 624 weighed meals):** overall MAPE ±14.6 %; whole foods ±9.8 %; packaged (barcode) ±11.4 %; home-cooked composites ±15.1 %; restaurant chains ±18.7 %; mixed bowls/salads ±19.2 %; dish recognised correctly 84 %. Plan for the same error profile: recognition is good, portions are the weak point.

**Progress tab:** streak + badges (Rookie 3-day, No Days Off 365-day, Bullseye 30 days on calorie goal, Mission: Nutrition 50 meals, Clean Sweep 3 meals/day, Heavy Exit −50 lb); weight goal card (start, current, goal, graph, estimated goal date); weight trend over 3/7/14/30/90 days/all; daily-average calories bars split by macro; weekly energy balance (burned vs eaten); log weight (slider); **progress photos** uploaded with a weight, date defaults to today and is editable, compared side-by-side; no body measurements; streak restore is a $0.99 IAP.

**Privacy posture to beat:** Cal AI's policy classifies food and progress photos as "Food and Activity Data", gives no photo-specific retention period, does not say whether photos train models, and only names "service providers" as processors.

### 1.2 MyFitnessPal

Sources: [App Store listing](https://apps.apple.com/us/app/myfitnesspal-calorie-counter/id341232718), [Lindenwood University MFP guide (PDF)](https://www.lindenwood.edu/files/resources/my-fitness-pal.pdf), [JMIR 2020 validation study](https://www.jmir.org/2020/10/e18237/), [Nutrola on MFP micronutrients (competitor, use with care)](https://nutrola.app/en/blog/why-does-myfitnesspal-not-track-micronutrients). MFP's help centre blocks fetches (HTTP 403), so goal-formula details below are reconstructed from secondary sources and flagged.

- **Diary:** Breakfast / Lunch / Dinner / Snacks by default; up to six user-named meals; each row shows kcal, carbs, fat, protein, sodium, sugar; totals per meal and per day; bottom strip "Totals / Your Daily Goal / Remaining" (green under, red over); **Quick Tools** copy yesterday / copy to date; water (cups or ml) and a free-text note live under the diary; diary privacy default private.
- **Nutrients tracked:** calories, carbs, fat, protein, **sodium, sugar, fiber, saturated fat, polyunsaturated, monounsaturated, trans fat, cholesterol, potassium, vitamin A, vitamin C, calcium, iron** (user picks which columns show). Validation study: energy, macros, sugar and fiber track a reference DB well; cholesterol and sodium do not (ρ≈0.5); vitamins/minerals are blank on most user-submitted entries. Lesson: show the six core nutrients prominently; treat micronutrients as "when known".
- **Nutrition screen:** Calories / Nutrients / Macros tabs; daily and weekly views; pie chart of macro %; calories per meal breakdown; Reports with 7/30/90-day graphs of any nutrient against its goal line.
- **Goals:** profile (sex, DOB, height, weight, goal weight) + activity level (sedentary → very active) + weekly goal (lose 0.5 / 1 / 1.5 / 2 lb per week, maintain, gain 0.5 / 1 lb). Daily goal = maintenance − 500 kcal per lb/week (i.e. the 3,500 kcal/lb rule), floored at 1,200 kcal (women) / 1,500 kcal (men) by app convention. Default macro split reported as 50 % carbs / 20 % protein / 30 % fat; Premium lets you set grams. Sodium default 2,300 mg, sugar/fiber goals are per-user (secondary sources; MFP does not publish exact numbers).
- **Net calories:** `net = food − exercise`. Logged or synced exercise raises "remaining" for the day; negative adjustments from a tracker are optional. "Activity level" is meant to exclude workouts, which is why exercise is added separately (double-counting risk if the user picks "very active" *and* adds workouts — warn in UI).
- **Weight & measurements:** check-in with weight, neck/waist/hips, optional body fat %; progress graphs over 30/90/180 days/1 year; 20.5 M-food database, barcode scan, Meal Scan (photo) and voice logging are Premium.

### 1.3 Takeaways for AravOS

1. Keep Cal AI's five entry points (photo, barcode, label, describe, search) and its Fix Results loop, but make the per-ingredient list editable in place and show grams, not just servings.
2. Keep MFP's diary structure (4 meal slots, Remaining strip, copy-yesterday, weekly view, per-nutrient goal lines).
3. Make the health score explainable (list the ± reasons) — it is the single most-complained-about feature in both apps.
4. Store the AI's raw JSON per meal so Fix Results can re-prompt with full context and so we can measure error later.

---

## 2. Feature list by screen

Tags: **MVP** = first shippable slice; **v1.1** = next; **later**.

### 2.1 Health onboarding / Goals (`settings.healthProfile`, already in `HealthProfile`)
- MVP: sex, birth date, height, current weight (creates a `weight_logs` row), activity level (5 levels, with the MFP-style note "do not count workouts you will log"), goal (lose/maintain/gain), goal weight, pace slider (lose: 0.25 / 0.5 / 0.75 / 1.0 kg·wk⁻¹; gain: 0.125 / 0.25 / 0.5), computed plan card (BMR, TDEE, target kcal, P/C/F g and %, fiber, water, estimated goal date) with "edit" that re-balances carbs when protein/fat change.
- MVP: toggles `exerciseAddBack` (default on), `rolloverCalories` (default off, cap +250 kcal), units.
- v1.1: diet preset (balanced / high-protein / low-carb / keto) that only changes the macro split; macro lock (lock protein grams, let kcal edits flow into carbs/fat).
- later: adaptive TDEE suggestion banner ("your last 3 weeks imply TDEE ≈ 2,620; update target?").

### 2.2 Today (nutrition dashboard; widgets `nutrition_rings`, `water`, `weight_trend`, `stat` already exist in `LayoutSpec`)
- MVP: calories-left ring (goal + add-back − eaten), three macro bars (left/target), fiber / sugar / sodium mini-bars, water ring with +250 ml / +500 ml / custom, streak chip (days with ≥ 1 meal logged), "Recently logged" list (thumbnail, name, kcal, P/C/F, time) with swipe-to-delete and tap-to-edit, + button (Scan / Barcode / Label / Describe / Search / Saved).
- v1.1: daily health score with reasons, calories-burned (from `workouts` and HealthKit), weight card (latest, 7-day trend, Δ to goal), copy-yesterday.
- later: rollover indicator, weekly energy balance.

### 2.3 Scan flow (camera)
- MVP: full-screen camera with "fit the whole plate; include a fork/hand/card for scale" overlay hint; capture or pick from gallery; client resizes to ≤ 1,280 px long edge JPEG q≈85, strips EXIF; upload to `POST /api/nutrition/analyze` (multipart); 2–6 s skeleton; optional one-line hint ("home-made, big bowl") sent with the photo.
- MVP: barcode mode (Capacitor ML Kit barcode scanner on iOS; `BarcodeDetector` on web) → `GET /api/foods/barcode/:code` → serving picker.
- v1.1: label mode (photo of Nutrition Facts panel → `analyze?mode=label` → per-serving values + serving size → serving picker).
- v1.1: describe mode (text → `analyze?mode=text`, same schema).

### 2.4 Results card (one per analysis)
- MVP: photo thumbnail, meal name (editable), meal slot chip (auto from time: <10:30 breakfast, <15:00 lunch, <21:00 dinner, else snack), totals (kcal, P/C/F, fiber, sugar, sodium), per-item rows: name · grams (stepper ×0.5/×1/×1.5/×2 and free grams) · kcal · confidence dot (green ≥ 0.75, amber ≥ 0.5, red < 0.5); tap row → swap to a DB food (search prefilled with `search_terms`) or edit grams/nutrients; delete row; add row.
- MVP: **Fix results** text box → `POST /api/nutrition/analyze/:analysisId/fix` with the correction → card re-renders; previous version kept in `food_analyses`.
- MVP: health score (1–10) with "why" sheet listing the ± reasons; Save → creates `meals` + `meal_items`; "Save as food" for the whole plate (creates a `foods` row with `source='custom'`).
- v1.1: "needs a clarification" chips generated by the model (e.g. "Was the dressing added?") that pre-fill Fix results.

### 2.5 Diary / History
- MVP: date strip; per-day meal groups (breakfast/lunch/dinner/snack) with per-meal totals; day totals vs goal strip; empty-slot "+ Add"; long-press → copy to today / move slot.
- v1.1: weekly view (7 bars of kcal with goal line, average P/C/F %), per-nutrient 7/30/90-day charts.
- later: export CSV.

### 2.6 Nutrition summary (MFP "Nutrition" tab)
- v1.1: Calories (per-meal stacked bar), Macros (pie + grams), Nutrients (list: fiber, sugar, sodium, sat fat, cholesterol, potassium vs goal; show "—" when any item lacks the value and a "coverage" % so users know when sodium is incomplete).

### 2.7 Water
- MVP: ring with goal, quick-add buttons (250 / 500 / 750 ml or 8 / 16 oz by unit setting), undo last, history list; HealthKit `dietaryWater` write (iOS, later).

### 2.8 Weight
- MVP: log weight (number pad, date default today), 7-day exponential moving average trend line, Δ 7/30/90 days, BMI chip, goal line and projected goal date; v1.1: HealthKit read/write; body-fat % optional.

### 2.9 Body progress photos
- MVP: Photos tab with front/side/back lanes; capture with ghost overlay of the previous photo in the same pose (opacity slider) + grid + "same spot, same light, same time of day" checklist; pairs with today's weight automatically; gallery by date; side-by-side compare of any two photos of the same pose with a date/weight caption; share sheet exports a composed before/after image (never raw files).
- MVP privacy: stored under `ARAVOS_DATA_DIR/photos/body/` with EXIF stripped and GPS removed; excluded from the OS photo library; optional app lock (Face ID) for the tab; delete = file + row.
- v1.1: **Compare with AI** (explicit per-use consent sheet; both photos sent once; only the text result is stored); slider compare; timelapse export.
- Never: numeric body-fat estimate, "progress score", appearance ratings.

### 2.10 Settings
- MVP: edit targets and toggles; nutrient columns shown in diary; units; delete all nutrition data; "AI usage this month" (tokens/cost from `food_analyses`).

---

## 3. Formulas (exact numbers)

### 3.1 BMR — Mifflin-St Jeor (already in `bmrMifflinStJeor`)
`BMR_male = 10·W(kg) + 6.25·H(cm) − 5·A(years) + 5`; `BMR_female = 10·W + 6.25·H − 5·A − 161`. Accurate to ~10 % for most adults. Alternatives if body-fat % is known: Katch-McArdle `BMR = 370 + 21.6·(1−BF)·W`. Source: [calculator.net BMR](https://www.calculator.net/bmr-calculator.html).

### 3.2 TDEE — activity multipliers (already in `ACTIVITY_MULTIPLIERS`)
| Level | Multiplier | Definition shown to user |
|---|---|---|
| sedentary | 1.2 | desk job, little or no exercise |
| light | 1.375 | light exercise 1–3 days/week |
| moderate | 1.55 | moderate exercise 3–5 days/week |
| active | 1.725 | hard exercise 6–7 days/week |
| very_active | 1.9 | very hard exercise daily or physical job |

The multiplier is the largest error source; show the resulting TDEE and let the user override. Source: [TDEE calculator formula page](https://tdeecalculator.it.com/mifflin-st-jeor/), [calculator.net](https://www.calculator.net/bmr-calculator.html).

### 3.3 Daily calorie target from pace
- Energy density of body-weight change: **7,700 kcal/kg** (≈ 3,500 kcal/lb). `daily_delta = pace_kg_per_week × 7,700 / 7` → 0.25 kg/wk = −275, 0.5 = −550, 0.75 = −825, 1.0 = −1,100 kcal/day. Already in `dailyAdjustmentForPace`.
- `target = round10(TDEE + daily_delta)`.
- Guardrails: pace ≤ 1 % of body weight per week (CDC: gradual 1–2 lb/week is what people keep off, [CDC archived page](https://webarchive.library.unt.edu/eot2008/20090116002322mp_/http:/www.cdc.gov/nccdphp/dnpa/healthyweight/losing_weight/index.htm)); floors **1,200 kcal (female) / 1,500 kcal (male)** (MFP/app convention) and never below BMR × 1.0; surplus pace ≤ 0.5 kg/wk (+550). Current code floors at 1,200 for everyone — change to sex-aware.
- The static 7,700 rule overestimates loss over time because expenditure falls as weight falls; the NIH Body Weight Planner (Hall dynamic model) is the reference and warns below 1,000 kcal/day ([NIDDK BWP](https://www.niddk.nih.gov/bwp); [Hall & Chow 2013 on why the 3,500 rule fails](https://pmc.ncbi.nlm.nih.gov/articles/PMC3859816/)). Mitigation: **adaptive TDEE** every 7 days once ≥ 10 logged days and ≥ 2 weigh-ins exist: `TDEE_obs = mean(kcal_in over window) − (ΔEMA_weight_kg × 7,700) / days`; blend `TDEE_new = 0.7·TDEE_old + 0.3·TDEE_obs`, clamp ±300 kcal per update, and offer (not force) a target update.
- Estimated goal date (static): `days = |goal_kg − current_kg| × 7,700 / |daily_delta|`; display as "~N weeks (estimates slow down as you lose)".

### 3.4 Protein (grams, by goal) — ISSN position stand
- General exercising adults: **1.4–2.0 g/kg/day**; hypocaloric (fat-loss) phases in trained people: **2.3–3.1 g/kg/day** (ISSN wording; the underlying Helms 2014 review expressed this per kg fat-free mass); per meal **0.25 g/kg or 20–40 g**, spread every 3–4 h; RDA for sedentary adults is 0.8 g/kg. Source: [ISSN 2017 (PMC5477153)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/).
- Defaults (already in `suggestTargets`, keep): lose **2.0 g/kg**, gain **1.8 g/kg**, maintain **1.6 g/kg**. Add: for BMI ≥ 30 compute on goal weight (or `min(current, goal + 0.25·(current−goal))`) so protein does not explode; cap protein at 35 % of kcal (AMDR).

### 3.5 Macro split defaults
- AMDR (NASEM 2005): carbohydrate **45–65 %**, fat **20–35 %**, protein **10–35 %** of kcal ([NASEM DRI macronutrients report](https://www.nationalacademies.org/read/10490/chapter/1); [summary](https://www.weightwatchers.com/us/blog/acceptable-macronutrient-distribution-range)).
- Default: protein from §3.4; **fat = 27 % of kcal** (code already uses 0.27; floor 0.6 g/kg so very low-kcal plans keep ≥ ~40 g); **carbs = (kcal − 4·P − 9·F)/4**, floor 100 g unless the user picks keto (then fat takes the remainder, carbs 25–50 g).
- Presets: balanced 30/40/30 (P/C/F), high-protein 35/40/25, low-carb 35/25/40.
- Fiber **14 g per 1,000 kcal** (AI from the same NASEM report: 38 g men / 25 g women aged 19–50) — already in code.
- Added sugars **< 10 % of kcal**, saturated fat **< 10 % of kcal**, sodium **< 2,300 mg/day** (Dietary Guidelines for Americans 2020–2025; [CSPI summary PDF](https://www.cspi.org/sites/default/files/attachment/CSPI_Key_Takeaways_2020-2025_DGA.pdf), [Colorado State summary](https://foodsmartcolorado.colostate.edu/nutrition-and-health/healthy-eating/tools-for-healthy-eating/the-2020-2025-dietary-guidelines-for-americans)). We only know *total* sugar from most sources, so show the sugar bar as total sugar with goal `max(50 g, 0.10·kcal/4)` and label it "total sugar"; current `sugarMaxG` default 50 g is fine.
- Potassium AI 3,400 mg (men) / 2,600 mg (women) (NASEM 2019 sodium/potassium DRI); cholesterol: no numeric goal, show value only.

### 3.6 Water
- NASEM AI total water **3.7 L/day men, 2.7 L/day women** (ages 19–30), of which beverages ≈ **3.0 L / 2.2 L**; "1 mL per kcal expended" is quoted as a liberal standard; the AI "should not be interpreted as a specific requirement" ([NASEM DRI water, ch. 4](https://www.nationalacademies.org/read/10925/chapter/6)). EFSA: **2.5 L men / 2.0 L women** total ([EFSA 2010 press release](https://www.efsa.europa.eu/en/press/news/nda100326)).
- Default goal: beverages only, **2,500 ml men / 2,000 ml women**, rounded to 250 ml; add +500 ml per logged workout hour (heuristic, unsourced — label it). The current `weightKg × 35 ml` is a common clinical heuristic without a DRI source; keep it only as the fallback when sex is unknown. Current `HealthProfile.targets.waterMl` default 3,000 → change to 2,500.

### 3.7 Net calories / remaining
```
eaten        = Σ meal_items.calories for date
burned       = Σ workouts.caloriesBurned (+ HealthKit active energy, de-duplicated by source)  [0 if exerciseAddBack=false]
rollover     = exerciseAddBack-independent; min(250, max(0, goal_prev − eaten_prev)) if rolloverCalories
remaining    = goal + burned + rollover − eaten
net          = eaten − burned            (MFP "net calories")
```
Warn once if activity level ≥ active and add-back is on (double counting).

### 3.8 Health score (explainable, v1 heuristic)
Per meal, computed from totals (not by the model; the model only supplies two flags `mostly_whole_foods`, `veg_fruit_legume_share`):
```
score = 10
protein_pct  = 4·P / kcal          ; < 0.10 → −1
fiber_per_kcal = fiber_g / (kcal/1000) ; < 7 → −1 ; ≥ 14 → +1
satfat_pct   = 9·satfat / kcal     ; > 0.10 → −1 ; > 0.15 → −2
sugar_pct    = 4·sugar / kcal      ; > 0.15 → −1 ; > 0.25 → −2 (skip if model says sugar is intrinsic: fruit/plain dairy)
sodium_per_kcal = sodium_mg / kcal ; > 1.0 → −1 ; > 2.0 → −2     (2,300 mg / 2,300 kcal = 1.0)
mostly_whole_foods = false         → −1
veg_fruit_legume_share ≥ 0.4       → +1
clamp 1..10; store reasons[] alongside
```
Thresholds mirror Nutri-Score's component logic (energy, sugars, sat fat, salt negative; fiber, protein, fruit/veg positive) re-expressed per kcal so a meal and a snack are comparable ([Nutri-Score algorithm](https://en.wikipedia.org/wiki/Nutri-Score)). Daily score = kcal-weighted mean of meal scores, −1 if kcal > 115 % of goal, +1 if protein and fiber goals both met. Show the reasons list; never show a score for < 50 kcal (water, coffee) — this is the Cal AI bug reviewers cite.

### 3.9 Weight trend & BMI
`EMA_t = 0.1·w_t + 0.9·EMA_{t−1}` (10-day smoothing; seed with first weight); BMI = kg / m²; show Δ vs 7/30/90 days from the EMA, not raw weigh-ins.

### 3.10 Worked example
Male, 30 y, 80 kg, 178 cm, moderate, lose 0.5 kg/wk: BMR = 800 + 1,112.5 − 150 + 5 = **1,767**; TDEE = 1,767 × 1.55 = **2,740**; target = 2,740 − 550 = **2,190**; protein 2.0 × 80 = **160 g** (29 %); fat 27 % = 591 kcal = **66 g**; carbs = (2,190 − 640 − 591)/4 = **240 g**; fiber 14 × 2.19 = **31 g**; sugar ≤ 55 g; sodium ≤ 2,300 mg; water 2,500 ml; 10 kg to goal ≈ 20 weeks (static).
Female, 28 y, 65 kg, 165 cm, light, lose 0.25 kg/wk: BMR = 650 + 1,031 − 140 − 161 = **1,380**; TDEE = 1,898; target = **1,620** (above the 1,200 floor); protein 130 g; fat 49 g; carbs 165 g; fiber 23 g; water 2,000 ml.

---

## 4. Datasets

### 4.1 USDA FoodData Central API
- Key: free at <https://fdc.nal.usda.gov/api-key-signup>; `DEMO_KEY` allows 30 req/h and 50/day per IP; real keys **1,000 req/h per IP**, HTTP 429 + 1-hour block when exceeded; headers `X-RateLimit-Limit` / `X-RateLimit-Remaining`. Keys committed to public repos are deactivated. Source: [API guide](https://fdc.nal.usda.gov/api-guide/).
- Base: `https://api.nal.usda.gov/fdc/v1` (query param `api_key=`).

| Endpoint | Params (from the [OpenAPI spec](https://app.swaggerhub.com/apis/fdcnal/food-data_central_api/1.0.1)) |
|---|---|
| `GET /food/{fdcId}` | `format=abridged\|full`, `nutrients=` up to 25 nutrient **numbers** (e.g. `208,203,204,205,291,269,307,606`) |
| `GET /foods?fdcIds=1,2,3` | same `format`, `nutrients` |
| `GET/POST /foods/search` | `query` (supports operators), `dataType[]` ∈ `Branded`, `Foundation`, `Survey (FNDDS)`, `SR Legacy`; `pageSize` 1–200 (default 50); `pageNumber`; `sortBy` ∈ `dataType.keyword`, `lowercaseDescription.keyword`, `fdcId`, `publishedDate`; `sortOrder`; `brandOwner`; `tradeChannel`, `startDate`, `endDate` (POST body) |
| `GET/POST /foods/list` | paged abridged list, same paging/sort params |

Response fields used: `fdcId`, `description`, `dataType`, `brandOwner`, `gtinUpc`, `ingredients`, `servingSize`, `servingSizeUnit`, `householdServingFullText`, `foodNutrients[{nutrientId|nutrientNumber, nutrientName, unitName, value}]`, `foodPortions[{amount, measureUnit{name}, modifier, portionDescription, gramWeight}]`, `labelNutrients` (Branded).

```bash
# search generic foods
curl "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=$FDC_KEY&query=greek%20yogurt&dataType=Survey%20(FNDDS),SR%20Legacy&pageSize=10"
# barcode via USDA Branded (US products)
curl -XPOST -H 'Content-Type: application/json' \
  -d '{"query":"0041570054161","dataType":["Branded"],"pageSize":5}' \
  "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=$FDC_KEY"
# one food, only the nutrients we store
curl "https://api.nal.usda.gov/fdc/v1/food/2705929?api_key=$FDC_KEY&format=abridged&nutrients=208,203,204,205,291,269,307,606,601,306"
```

**Nutrient IDs** (verified from `nutrient.csv` in the October 2026 Foundation download; `id` is what JSON uses, `nutrient_nbr` is what the `nutrients=` filter takes):

| id | nbr | name | unit |
|---|---|---|---|
| 1008 | 208 | Energy | kcal |
| 1003 | 203 | Protein | g |
| 1004 | 204 | Total lipid (fat) | g |
| 1005 | 205 | Carbohydrate, by difference | g |
| 1079 | 291 | Fiber, total dietary | g |
| 2000 | 269 | Total Sugars (FNDDS: "Sugars, total including NLEA") | g |
| 1063 | 269.3 | Sugars, Total (older SR entries) | g |
| 1235 | 539 | Sugars, added | g |
| 1093 | 307 | Sodium, Na | mg |
| 1258 | 606 | Fatty acids, total saturated | g |
| 1257 | 605 | Fatty acids, total trans | g |
| 1253 | 601 | Cholesterol | mg |
| 1092 | 306 | Potassium, K | mg |
| 1087 | 301 | Calcium, Ca | mg |
| 1089 | 303 | Iron, Fe | mg |
| 1106 | 320 | Vitamin A, RAE | µg |
| 1162 | 401 | Vitamin C | mg |
| 1114 | 328 | Vitamin D (D2+D3) | µg |
| 1018 | 221 | Alcohol, ethyl | g |
| 1057 | 262 | Caffeine | mg |

### 4.2 USDA bulk downloads ([download page](https://fdc.nal.usda.gov/download-datasets/), prefix `https://fdc.nal.usda.gov/fdc-datasets/`)

| Dataset | File | zip / unzipped | Content (measured 2026-11-02) |
|---|---|---|---|
| Foundation Foods (10/2026) | `FoodData_Central_foundation_food_json_2026-10-29.zip` | 681 KB / 9 MB | ~400 lab-analysed foods; JSON is the usable form (the CSV zip of this release downloaded at 1.1 MB and contained no `food.csv`/`food_nutrient.csv`, only supporting tables) |
| SR Legacy (04/2018, final) | `FoodData_Central_sr_legacy_food_csv_2018-04.zip` | 6.7 MB / 54 MB | **7,793 foods, 644,125 nutrient rows, 14,449 portions**; raw/cooked ingredients with household measures |
| FNDDS 2021-2023 (10/2024) | `FoodData_Central_survey_food_json_2024-10-31.zip` | 3.7 MB / 64 MB | **5,432 foods/beverages (4,827 foods / 605 beverages), 65 nutrients each, 22,194 portion weights, 172 WWEIA categories**, "foods as eaten" incl. mixed dishes and restaurant-style items ([factsheet](https://ars.usda.gov/ARSUserFiles/80400530/pdf/fndds/FNDDS_2021_2023_factsheet.pdf)) |
| Branded (10/2026) | `FoodData_Central_branded_food_json_2026-10-29.zip` | 187 MB / 3 GB | ~2 M label-derived products with GTIN/UPC; do not bundle, query via API |
| Full download (10/2026) | `FoodData_Central_csv_2026-10-29.zip` | 463 MB / 3.1 GB | everything |

CSV layout (SR Legacy, same for the others): `food.csv (fdc_id, data_type, description, food_category_id, publication_date)`, `food_nutrient.csv (id, fdc_id, nutrient_id, amount, …)`, `food_portion.csv (id, fdc_id, seq_num, amount, measure_unit_id, portion_description, modifier, gram_weight, …)`, `nutrient.csv (id, name, unit_name, nutrient_nbr, rank)`, `measure_unit.csv (id, name)`, `food_category.csv (id, code, description)`. FNDDS JSON: `{ "SurveyFoods": [ { fdcId, foodCode, description, wweiaFoodCategory{wweiaFoodCategoryDescription}, foodNutrients[{nutrient{id,number,name,unitName}, amount}], foodPortions[{portionDescription, gramWeight}], inputFoods[] } ] }`.

### 4.3 Open Food Facts (barcodes, no key)
- `GET https://world.openfoodfacts.org/api/v2/product/{barcode}?fields=code,product_name,brands,quantity,serving_size,serving_quantity,nutriscore_grade,nova_group,nutriments` ([tutorial](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorial-off-api/)).
- Policy ([API intro](https://openfoodfacts.github.io/openfoodfacts-server/api/)): send `User-Agent: AravOS/1.0 (you@example.com)`; **15 product reads/min/IP, 10 searches/min/IP** (per user when called from a mobile app — so call OFF from the device, not the server, or cache aggressively); global overload → HTTP 503; do not use search for type-ahead.
- Not found is **HTTP 200** with `{"status":0,"status_verbose":"product not found"|"no code or invalid code"}`; found is `status:1`.
- Nutriment keys (live sample, Nutella 3017624010701): `energy-kcal_100g` 539, `proteins_100g` 6.3, `carbohydrates_100g` 57.5, `sugars_100g` 56.3, `fat_100g` 30.9, `saturated-fat_100g` 10.6, `fiber_100g` (absent when unknown), `salt_100g` 0.1075, `sodium_100g` 0.043 — **sodium is in grams** (×1,000 → mg); `salt = sodium × 2.5`; `*_serving` variants exist only when `serving_quantity` is set; `energy_100g` is kJ. Map missing keys to `null`, never 0.
- Text search when needed: `GET https://world.openfoodfacts.org/cgi/search.pl?search_terms=oat%20milk&search_simple=1&json=1&page_size=20&fields=code,product_name,brands,nutriments` (v2 `/api/v2/search` is tag-filter only, no full text).

### 4.4 Lightweight community dataset (evaluated, not recommended as primary)
[Open-Food-Calories](https://github.com/chpalitom09-bot/Open-food-calories) — `data/Open-food-calories.json`, 5,037 entries, MIT, EN/FR names, `kcal_per_100g/protein_g/fat_g/carbs_g`. Measured: `fiber_g`, `sugars_g`, `salt_g` are null for every entry, 3,906 entries have no `source`, and only 1,285 carry `weight_per_unit`. Useful only for "1 piece ≈ N g" fallbacks and French names.

### 4.5 Recommendation: what to bundle
Ship `packages/shared/data/foods.v1.json` (gzipped at build, loaded into the `foods` table on first run with `source='bundled'`):
1. **FNDDS** entries whose description does not contain `NS as to` / `NFS` (4,923 of 5,432) → prune to ~2,000 by taking the top N per WWEIA category weighted by category size, dropping near-duplicate variants (same leading noun, differing only in "with/without …"), keeping all beverages.
2. **SR Legacy** raw ingredients (~500): categories Vegetables, Fruits, Legumes, Nut/Seed, Dairy/Egg, Poultry, Beef, Pork, Finfish, Cereal Grains, Fats/Oils, Spices — raw and plain cooked forms.
3. Fields per food: `id (fndds:<foodCode>|sr:<fdcId>)`, `fdcId`, `name`, `category`, `per100 {kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, sat_fat_g, cholesterol_mg, potassium_mg}`, `portions [{label, g}]` (≤ 6), `generic` flag.
Measured sizes with the prototype script: all 13,224 (FNDDS + SR) = 5.7 MB / 698 KB gzip; FNDDS non-generic 4,923 = 2.2 MB / 236 KB gzip; so the ~2.5k target ≈ 1.1 MB / ~120 KB gzip — acceptable to ship inside the web bundle and SQLite.
Live lookups: USDA API for anything not bundled (server-side, cached in `foods` with `source='usda'`), OFF for barcodes (device-side), USDA Branded as barcode fallback.

### 4.6 Build script (prototype validated on the real files)
```bash
mkdir -p data/usda && cd data/usda
curl -LO https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip
curl -LO https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
unzip -q FoodData_Central_survey_food_json_2024-10-31.zip -d fndds
unzip -q FoodData_Central_sr_legacy_food_csv_2018-04.zip -d sr
python3 -I scripts/build_foods.py fndds/surveyDownload.json sr/FoodData_Central_sr_legacy_food_csv_2018-04 packages/shared/data/foods.v1.json
```
`scripts/build_foods.py` (core of the prototype; add the pruning step from §4.5):
```python
import json, csv, os, re, sys, collections
fndds, sr_dir, out = sys.argv[1:4]
NUTR = {1008:"kcal",1003:"protein_g",1005:"carbs_g",1004:"fat_g",1079:"fiber_g",2000:"sugar_g",1063:"sugar_g",
        1093:"sodium_mg",1258:"sat_fat_g",1253:"cholesterol_mg",1092:"potassium_mg"}
generic = re.compile(r"\bNS as to\b|\bNFS\b")
foods = []
for f in json.load(open(fndds))["SurveyFoods"]:
    nut = {NUTR[n["nutrient"]["id"]]: n["amount"] for n in f.get("foodNutrients", []) if n["nutrient"]["id"] in NUTR}
    if "kcal" not in nut: continue
    ports = [{"label": p["portionDescription"], "g": p["gramWeight"]} for p in f.get("foodPortions", [])
             if p.get("portionDescription") and not p["portionDescription"].startswith("Quantity not specified")]
    foods.append({"id": f"fndds:{f['foodCode']}", "fdcId": f["fdcId"], "name": f["description"],
                  "category": f["wweiaFoodCategory"]["wweiaFoodCategoryDescription"], "src": "FNDDS 2021-2023",
                  "per100": nut, "portions": ports[:6], "generic": bool(generic.search(f["description"]))})
rd = lambda n: list(csv.DictReader(open(os.path.join(sr_dir, n), newline="")))
cats = {r["id"]: r["description"] for r in rd("food_category.csv")}
units = {r["id"]: r["name"] for r in rd("measure_unit.csv")}
nut = collections.defaultdict(dict)
for r in rd("food_nutrient.csv"):
    k = NUTR.get(int(r["nutrient_id"]))
    if k and k not in nut[r["fdc_id"]]: nut[r["fdc_id"]][k] = float(r["amount"])
ports = collections.defaultdict(list)
for r in rd("food_portion.csv"):
    u = units.get(r["measure_unit_id"], ""); u = "" if u == "undetermined" else u
    ports[r["fdc_id"]].append({"label": " ".join(x for x in (r["amount"], u, r["modifier"]) if x) or r["portion_description"], "g": float(r["gram_weight"])})
for r in rd("food.csv"):
    if "kcal" in nut.get(r["fdc_id"], {}):
        foods.append({"id": f"sr:{r['fdc_id']}", "fdcId": int(r["fdc_id"]), "name": r["description"], "category": cats.get(r["food_category_id"], ""),
                      "src": "SR Legacy 2018", "per100": nut[r["fdc_id"]], "portions": ports[r["fdc_id"]][:6], "generic": False})
json.dump(foods, open(out, "w"), separators=(",", ":"))
print(len(foods), "foods ->", out)
```
Attribution: USDA FoodData Central data is public domain (CC0); cite "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, fdc.nal.usda.gov". Open Food Facts data is ODbL — if we persist OFF rows beyond a cache, attribute and link back in the product sheet.

---

## 5. Vision pipeline (Claude API)

### 5.1 Image handling
- Client: resize to **≤ 1,280 px long edge**, JPEG q 85, strip EXIF (keep orientation applied), ~150–300 KB. Claude limits: JPEG/PNG/GIF/WebP, ≤ 10 MB per image (base64), 8,000×8,000 px max, 100 images/request on 200k-context models; images are tokenised in 28×28 patches: `⌈w/28⌉ × ⌈h/28⌉` tokens; standard-tier models cap at 1,568 px long edge / 1,568 tokens, Claude 4.7+ models (incl. Opus 5.5, Sonnet 5.5, Haiku 5.5) at 2,576 px / 4,784 tokens — so a 1,280×960 photo costs ~1,540 tokens and a 1,920×1,080 one 2,691 on high-res models; pre-resizing is the cost lever. Label multiple images "Image 1:", "Image 2:" in text blocks. Source: [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).
- Server stores the resized JPEG at `ARAVOS_DATA_DIR/photos/meals/<id>.jpg`; `meals.photoPath` already exists.

### 5.2 Model and cost (prices: first-party API, cached 2026-10)
| Model | $/MTok in / out | ≈ cost per scan (1.6k image + 1.5k cached system + 0.4k user; 700 out) |
|---|---|---|
| `claude-opus-5-5` (default in `.env.example`) | 4 / 20 | ≈ $0.022 |
| `claude-sonnet-5-5` | 2 / 10 | ≈ $0.011 |
| `claude-haiku-5-5` | 0.10 / 0.50 | ≈ $0.0006 |

Keep `ANTHROPIC_VISION_MODEL` as the switch; Opus 5.5 is the default per project convention, Haiku 5.5 is the obvious choice for Fix-Results re-runs and text-describe if the user opts for cost. Put the system prompt + schema first with `cache_control: {type: "ephemeral"}` (stable prefix), the photo and hint last. On Opus 5.5 thinking is always on; use `output_config: {effort: "low"}` for scans (latency), `"medium"` for Fix Results. Use `max_tokens: 4000`; handle `stop_reason === "refusal"` (show "couldn't analyse this photo") and `"max_tokens"` (retry once at 8,000). Enable `betas: ["server-side-fallback-2026-07-01"], fallbacks: "default"` on Opus/Sonnet 5.5 so a safety-classifier decline is retried on another model inside the same call.

### 5.3 Request shape (TypeScript, `@anthropic-ai/sdk` 1.3.0 already in `apps/server`)
```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { FoodAnalysisV2 } from "@aravos/shared"; // zod schema from §5.5

const client = new Anthropic();
const res = await client.messages.parse({
  model: process.env.ANTHROPIC_VISION_MODEL ?? "claude-opus-5-5",
  max_tokens: 4000,
  output_config: { effort: "low", format: zodOutputFormat(FoodAnalysisV2) },
  system: [{ type: "text", text: FOOD_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "Image 1: the meal photo." },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
      { type: "text", text: `Local time ${localTime}. User hint: ${hint || "(none)"}. Units: metric.` },
    ],
  }],
});
if (res.stop_reason === "refusal") throw new AnalysisRefused(res.stop_details?.explanation);
const analysis = res.parsed_output; // null → log raw text, retry once
```
Structured-output constraints to respect in the schema: every object `additionalProperties:false`; `minimum/maximum/minLength/maxLength` are **not** supported (put ranges in `description`, validate client-side with zod); `enum`, `const`, `$defs`, `anyOf` are supported; `minItems` only 0 or 1; the `zodOutputFormat` helper moves zod `.min()/.max()` into descriptions for you. Source: [structured outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

### 5.4 Prompting rules that matter (from the literature)
- Recognition is strong zero-shot; **portion (gram) estimation is the weak link** across GPT/Gemini/Claude; geometry cues (bounding box + plate size) cut per-food portion error 33–41 % in [Geometry-Enhanced Portion Estimation (arXiv 2607.16514)](https://arxiv.org/abs/2607.16514). We cannot add a depth head, so we ask the model to (a) name the reference object it scaled from, (b) give a low/high gram range, (c) default to USDA standard portions when nothing is visible.
- Grounding the model with a menu or a national food-composition DB reduced error and sauces/dressings were the hardest items ([Turku 2026 thesis](https://www.utupub.fi/handle/11111/61987)) → we always ask for hidden calories (oil, butter, dressing, sugar in drinks) as separate items, and we re-price against USDA after the call.
- Food names are inconsistent → ask for `search_terms` (2–4 USDA-style terms) per item for DB matching.
- Segment-then-prompt pipelines (SAM + GPT-4o) exist but add latency; a single well-labelled photo with "list every distinct item" is enough for v1 ([dev.to GPT-4o + SAM write-up](https://dev.to/beck_moulton/ai-powered-calorie-counting-mastering-gpt-4o-vision-and-sam-for-automated-nutrition-tracking-4bj1)); use low temperature equivalent (we use structured outputs; sampling params are not settable on current models anyway) and validate the schema ([n8n workflow](https://n8n.io/workflows/9619-food-image-analysis-for-calorie-estimation-with-vision-ai-and-telegram/)).
- Packaged foods: if a barcode or Nutrition Facts panel is legible, read it verbatim (`label` object) and skip estimation; if only the front of pack is visible, estimate per stated net weight.

### 5.5 Draft system prompt — food photo (also used for text-describe and Fix Results)
```
You are a registered-dietitian-grade food logging assistant inside a personal health app. You receive one photo of food (or a text description) and return ONE JSON object matching the provided schema. No prose.

Goal: identify every distinct food or drink item, estimate the EATEN portion in grams, and estimate nutrients. Precision matters less than being honest about uncertainty.

Rules
1. Items: list each visually distinct component separately (e.g. "grilled chicken breast", "white rice", "olive oil (cooking)", "ranch dressing"). Include hidden calories you can reasonably infer from the dish type: cooking oil/butter, dressings, sauces, sugar/milk in drinks. Mark those with inferred=true. Merge garnishes under 5 kcal into notes, not items.
2. Portions (grams, as served in the photo): scale from a reference you can see — plate (dinner plate ≈ 26–27 cm, side plate ≈ 20 cm), bowl, fork (≈ 19 cm), hand, standard can 330 ml, credit card 8.6 cm, chopsticks ≈ 23 cm. Name the reference in portion_basis. If no reference is visible, use the USDA/FNDDS typical serving for that food and say so. Give grams_low and grams_high (an honest ~80 % interval). Deep bowls and stacked items hide volume: widen the range and lower confidence.
3. Nutrients per item are for the stated grams, using USDA FoodData Central values for the closest generic food, cooked state as shown. Keep kcal consistent with macros (4/4/9, alcohol 7). Leave fiber_g/sugar_g/sodium_mg null when you cannot estimate them rather than guessing 0.
4. search_terms: 2–4 short USDA-style names for this item, most specific first (e.g. ["chicken breast grilled", "chicken breast roasted skinless"]). The app re-prices items from its database using these.
5. Packaged food: if a barcode or nutrition-facts panel is legible, set is_packaged=true, fill label{} verbatim (serving size and per-serving values as printed, barcode digits if readable) and base the item on the label and the number of servings visible. If only branding is visible, estimate from the printed net weight.
6. Multiple plates/people: log only the plate nearest the camera unless the hint says otherwise; mention others in notes.
7. Not food (or unreadable): set is_food=false, items=[], explain in notes. Never invent items.
8. confidence (0–1) per item combines identification and portion certainty: 0.9+ barcode/label read; 0.7–0.9 clear single foods with a scale reference; 0.4–0.7 mixed dishes or no reference; <0.4 guesses.
9. clarifications: up to 3 short yes/no or pick-one questions whose answers would most change the estimate (e.g. "Was the rice brown or white?"). Empty if none.
10. For health flags: mostly_whole_foods=true when ≥ 70 % of kcal come from minimally processed foods; sugar_is_intrinsic=true when nearly all sugar is from whole fruit or plain dairy; veg_fruit_legume_share = share of total grams that are vegetables, fruit or legumes.
11. meal_name: short, natural ("Chicken burrito bowl"), ≤ 40 chars. meal_type from the local time given unless the food clearly says otherwise.
12. Respect the user hint over your own reading when they conflict; if it is a correction to a previous result (Fix Results), keep unchanged items identical and change only what the correction implies.
```
Fix Results turn: append the prior assistant JSON as an assistant message, then a user message `"Correction: <text>. Return the full corrected JSON."` (same image is already in the conversation, no need to resend). Text-describe: same prompt, user content is text only, instruct "no photo: use typical servings unless quantities are stated".

### 5.6 JSON schema (supersedes `FoodAnalysis` in `packages/shared/src/schemas.ts`)
```json
{
  "type": "object", "additionalProperties": false,
  "required": ["is_food", "meal_name", "meal_type", "items", "totals", "flags", "clarifications", "notes"],
  "properties": {
    "is_food": { "type": "boolean" },
    "meal_name": { "type": "string" },
    "meal_type": { "type": "string", "enum": ["breakfast", "lunch", "dinner", "snack"] },
    "items": { "type": "array", "items": { "$ref": "#/$defs/item" } },
    "totals": { "$ref": "#/$defs/nutrients" },
    "flags": {
      "type": "object", "additionalProperties": false,
      "required": ["mostly_whole_foods", "sugar_is_intrinsic", "veg_fruit_legume_share"],
      "properties": {
        "mostly_whole_foods": { "type": "boolean" },
        "sugar_is_intrinsic": { "type": "boolean" },
        "veg_fruit_legume_share": { "type": "number", "description": "0 to 1, share of total grams" }
      }
    },
    "clarifications": { "type": "array", "items": { "type": "string" } },
    "notes": { "type": "string", "description": "Short caveats shown to the user, e.g. 'deep bowl; portion uncertain'" }
  },
  "$defs": {
    "nutrients": {
      "type": "object", "additionalProperties": false,
      "required": ["kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg", "sat_fat_g"],
      "properties": {
        "kcal": { "type": "number" }, "protein_g": { "type": "number" }, "carbs_g": { "type": "number" }, "fat_g": { "type": "number" },
        "fiber_g": { "type": ["number", "null"] }, "sugar_g": { "type": ["number", "null"] },
        "sodium_mg": { "type": ["number", "null"] }, "sat_fat_g": { "type": ["number", "null"] }
      }
    },
    "item": {
      "type": "object", "additionalProperties": false,
      "required": ["name", "search_terms", "grams", "grams_low", "grams_high", "portion_basis", "inferred", "is_packaged", "label", "confidence",
                   "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg", "sat_fat_g"],
      "properties": {
        "name": { "type": "string", "description": "Plain name as a user would say it" },
        "search_terms": { "type": "array", "items": { "type": "string" } },
        "grams": { "type": "number", "description": "best estimate of eaten portion, grams" },
        "grams_low": { "type": "number" }, "grams_high": { "type": "number" },
        "portion_basis": { "type": "string", "description": "reference used, e.g. 'fills ~1/3 of a 26 cm plate' or 'USDA typical serving, no reference visible'" },
        "inferred": { "type": "boolean", "description": "true for hidden items like cooking oil or dressing" },
        "is_packaged": { "type": "boolean" },
        "label": {
          "anyOf": [ { "type": "null" }, {
            "type": "object", "additionalProperties": false,
            "required": ["barcode", "serving_size_text", "serving_grams", "servings_eaten", "per_serving"],
            "properties": {
              "barcode": { "type": ["string", "null"] },
              "serving_size_text": { "type": "string" },
              "serving_grams": { "type": ["number", "null"] },
              "servings_eaten": { "type": "number" },
              "per_serving": { "$ref": "#/$defs/nutrients" }
            } } ]
        },
        "confidence": { "type": "number", "description": "0 to 1" },
        "kcal": { "type": "number" }, "protein_g": { "type": "number" }, "carbs_g": { "type": "number" }, "fat_g": { "type": "number" },
        "fiber_g": { "type": ["number", "null"] }, "sugar_g": { "type": ["number", "null"] },
        "sodium_mg": { "type": ["number", "null"] }, "sat_fat_g": { "type": ["number", "null"] }
      }
    }
  }
}
```
`health_score` is intentionally **not** in the schema — the server computes it from totals + flags (§3.8) so it is deterministic and explainable. The existing `FoodAnalysisItem.portion` (string) maps to `portion_basis`.

### 5.7 Server post-processing (`apps/server/src/services/nutrition.ts`)
1. Validate with zod; drop items with `grams ≤ 0`; clamp `confidence` to [0,1].
2. For each item: FTS5 search `foods` with `search_terms[0..2]` (bundled first, then cached USDA); if the top hit scores above threshold, **re-price** = `scaleNutrients(per100, grams)` and set `foodId`; keep AI values when no match; always keep the AI JSON in `food_analyses.response`.
3. Totals = `sumNutrients(items)`; `healthScore` + reasons; `mealType` from time unless the user chose one.
4. Return `{ analysisId, meal draft }`; nothing is written to `meals` until the user taps Save (draft lives in `food_analyses`).
5. Fix Results: load `food_analyses.request/response`, append correction, re-run, store as a new row with `parentAnalysisId`.

### 5.8 Label-scan prompt (mode=label)
"Image 1 is a Nutrition Facts panel. Transcribe serving size (text and grams/ml), servings per container, and per-serving calories, total fat, saturated fat, trans fat, cholesterol, sodium, total carbohydrate, dietary fiber, total sugars, added sugars, protein. Return one item with `is_packaged=true`, `label` filled, `grams = serving_grams × servings_eaten` (default servings_eaten = 1), nutrients for that amount, `confidence` 0.9 if every number was legible else lower, and `notes` listing any field you could not read." Same schema.

### 5.9 Accuracy expectations and evaluation
Expect Cal AI-like error (±10 % whole foods, ±15–20 % mixed dishes). Before launch, build a 60-photo weighed test set (kitchen scale) and track MAPE on kcal per meal and per item in `food_analyses` (`groundTruthJson` column); treat the Fix-Results rate per 100 scans as the UX metric.

---

## 6. Body progress photos

### 6.1 How other apps do it
- **Hevy** ([feature page](https://www.hevyapp.com/features/progress-photos/)): Profile → Measures → "+" → one photo per day, optional weight/body-fat/circumferences on the same entry, gallery by date, tap-to-compare side-by-side, share composes an image, photos are private even on public profiles; photo tips: same pose/angle/lighting, torso-level camera, not a selfie.
- **MacroFactor** ([progress photos post](https://macrofactor.com/?p=4697)): front/side/back selector per Body Metrics entry, gallery lets you flip between the three poses of the same day, Before/After view auto-generates a shareable image, up to 21 metrics charted.
- **Cal AI** (FeastGood): upload with weight, date editable, side-by-side compare only.
- **ProgressCam / PicProgress / Lilip / Progress by Lasmit** ([roundup](https://gainframe.app/blog/best-progress-photo-apps/), [search results](https://apps.apple.com/us/app/-/id6745906297)): ghost overlay of the previous photo in the viewfinder with opacity control, pose categories (upper/full body), slider and side-by-side compare, timelapse video export, Apple Health weight pairing.
- **GainFrame** (AI physique scores): library stays on device, "selected photos are processed by an AI service when you request analysis", explicit caveat that lighting, posture and clothing affect the result. The disclaimers are the model to copy; the body-fat/physique scoring is not.
- **Strong** ([listing](https://apps.apple.com/app/id464254577)): weight + vitals under Measurements with Apple Health; photos attach to workouts only. **Gentler Streak** ([listing](https://apps.apple.com/us/app/gentler-streak-workout-tracker/id1576857102)): no body photos; markets on-device HealthKit processing.

### 6.2 Privacy design (ours)
1. Files live only in `ARAVOS_DATA_DIR/photos/body/`, EXIF/GPS stripped on import, SHA-256 stored, never copied to the OS photo library; backups follow the app's SQLite backup policy (document it).
2. Optional biometric lock for the Photos tab (Capacitor biometric plugin) — pattern from Progress Pics / Bod Pic listings.
3. AI comparison is opt-in **per comparison** with a consent sheet ("Both photos will be sent once to Anthropic's API and not stored by us after the reply; only the text result is kept"); `body_photos.aiConsentAt` records it; no training use (API data is not used for training by default — state this in the sheet).
4. Deleting a photo deletes the file, the row and its analyses; "Delete all body photos" in Settings.
5. Share exports a composed JPEG with date/weight captions; the raw originals never leave the device except for an AI comparison.

### 6.3 Responsible AI scope
Generative AI and body-image risk is documented ([expert-guided risk taxonomy, arXiv 2512.04843](https://arxiv.org/html/2512.04843v1); [Alliance for Eating Disorders on AI](https://www.allianceforeatingdisorders.com/ai-algorithms-and-eating-disorders/)). Constraints:
- Only visible, relative changes between the two photos (muscle definition, waist/shoulder silhouette, posture, water retention cues), each with a confidence and an explicit "may be lighting/pose" caveat; **no body-fat %, weight guess, BMI, or attractiveness language; no numeric score** — drop `photoAnalyses.progressScore (-2..2)`.
- Always report comparability first (lighting, distance, pose, clothing, time of day) and refuse to compare when the pair is not comparable.
- Neutral, descriptive tone; never prescribe diets or deficits; if the user's weight trend is > 1.5 % per week loss or they mention restriction, the app (not the model) shows a gentle note with help resources and skips AI comparison.
- Decline if the photo appears to be a minor or contains nudity beyond typical gym/underwear progress photos; decline medical questions (skin, swelling) with "see a clinician".
- Show the result next to the two photos with a "This is an AI description of pixels, not a measurement" footer.

### 6.4 Draft comparison prompt
```
You compare two dated progress photos of the same adult for a personal fitness app. Image 1 = BEFORE (date, weight if given). Image 2 = AFTER (date, weight if given). Return ONE JSON object matching the schema. No prose outside it.

Do
- First judge comparability: pose, camera distance/height, lighting direction, clothing, time of day, image quality. If the photos are not comparable enough to say anything reliable, set comparable=false, explain in consistency_issues, and leave observations empty.
- Describe only what is visibly different, region by region (shoulders/arms, chest/upper back, waist/abdomen, hips/glutes, legs, posture). For each: a neutral change description, your confidence 0–1, and the main alternative explanation (lighting, pump, bloating, pose).
- Keep summary to 2–3 sentences, neutral and descriptive ("the waistline appears slightly narrower relative to shoulder width; lighting is similar in both").
- Give 2–4 concrete tips for the next photo (same spot, window light from the front, phone at chest height 2 m away, relaxed pose).

Do not
- Estimate body-fat %, weight, BMI, muscle mass, or give any score or grade.
- Comment on attractiveness, "problem areas", or compare to ideals or other people.
- Give diet, calorie or training prescriptions, or medical opinions about skin, swelling or injuries.
- Speculate about identity, age, health conditions, or anything not visible.
If either image appears to show a minor, is sexual, or is not a progress photo, set comparable=false with reason "unsupported_image" and return nothing else.
```
Schema:
```json
{
  "type": "object", "additionalProperties": false,
  "required": ["comparable", "consistency_issues", "observations", "summary", "tips_for_next_photo"],
  "properties": {
    "comparable": { "type": "boolean" },
    "consistency_issues": { "type": "array", "items": { "type": "string", "enum": ["pose", "distance", "camera_height", "lighting", "clothing", "image_quality", "time_of_day", "unsupported_image"] } },
    "observations": { "type": "array", "items": {
      "type": "object", "additionalProperties": false,
      "required": ["region", "change", "direction", "confidence", "alternative_explanation"],
      "properties": {
        "region": { "type": "string", "enum": ["shoulders_arms", "chest_upper_back", "waist_abdomen", "hips_glutes", "legs", "posture", "overall"] },
        "change": { "type": "string" },
        "direction": { "type": "string", "enum": ["leaner_looking", "fuller_looking", "more_defined", "less_defined", "posture_change", "no_clear_change"] },
        "confidence": { "type": "number", "description": "0 to 1" },
        "alternative_explanation": { "type": "string" }
      } } },
    "summary": { "type": "string" },
    "tips_for_next_photo": { "type": "array", "items": { "type": "string" } }
  }
}
```
Request: two labelled image blocks ("Image 1: BEFORE, 2026-09-01, 84.2 kg", "Image 2: AFTER, 2026-11-01, 81.0 kg"), same model/effort settings as §5.2, `max_tokens: 2000`.

---

## 7. Data model (deltas to `apps/server/src/db/schema.ts`)

Existing tables kept; `+` = add column, `~` = change, `−` = remove. All timestamps ISO strings, dates `YYYY-MM-DD` local (matches current conventions).

**`foods`** (exists) — `+ externalId text` (`fndds:24100000`, `sr:171287`, `usda:<fdcId>`, `off:<barcode>`), `+ category text`, `+ isGeneric boolean default false`, `+ lastSyncedAt`, `+ attribution text` (`usda|off|user`), index on `(source, externalId)` unique; add an FTS5 virtual table `foods_fts(name, brand, category)` maintained by triggers for search.

**`nutrition_goals`** (new, replaces reading targets live from `settings.healthProfile` for history) — `id`, `effectiveFrom date`, `sex`, `birthDate`, `heightCm`, `weightKgAtSet`, `goalWeightKg`, `goal lose|maintain|gain`, `paceKgPerWeek`, `activityLevel`, `bmrKcal`, `tdeeKcal`, `calories`, `proteinG`, `carbsG`, `fatG`, `fiberG`, `sugarMaxG`, `sodiumMaxMg`, `satFatMaxG`, `waterMl`, `exerciseAddBack boolean`, `rolloverCalories boolean`, `isManual boolean`, `formulaVersion text`, `createdAt`. One row per change; the day view uses the row with the greatest `effectiveFrom ≤ date`. `HealthProfile` in settings stays the editable source; saving it inserts a row here.

**`meals`** (exists) — `~ source` add values `label | saved | ai_text`; `+ analysisId text` → `food_analyses.id`; `+ healthScoreReasons text` (JSON string[]); `+ hint text` (user hint sent with the photo); keep `photoPath`, `healthScore`.

**`meal_items`** (exists) — `+ gramsLow real`, `+ gramsHigh real`, `+ portionBasis text`, `+ inferred boolean default false`, `+ priced text` (`ai|db|label|user`), `+ userEdited boolean default false`, `+ aiJson text` (the item as returned, for Fix Results), `+ transFatG real`, `+ addedSugarG real`; keep macro columns and `foodId`.

**`meal_item_nutrients`** (new, optional micronutrients beyond the wide columns) — `mealItemId`, `key` (`calcium_mg|iron_mg|vitamin_a_ug|vitamin_c_mg|vitamin_d_ug|caffeine_mg|alcohol_g`), `amount real`; PK `(mealItemId, key)`. `nutrient_defs` (new) — `key`, `name`, `unit`, `dailyGoalDefault`, `direction min|max`, `usdaNutrientId` so the Nutrients screen is data-driven.

**`food_analyses`** (new; `photo_analyses` stays for body photos) — `id`, `parentAnalysisId` (Fix Results chain), `mode photo|text|label|fix`, `photoPath`, `hint`, `model`, `promptVersion`, `request text` (messages without image bytes), `response text` (raw JSON), `parsedOk boolean`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `latencyMs`, `stopReason`, `status draft|saved|discarded`, `mealId` nullable, `groundTruthJson text` nullable (for the eval set), `createdAt`.

**`water_logs`** (exists) — `+ container text` (`glass|bottle|cup|custom`), `+ source manual|healthkit`. Keep `date, ml, loggedAt`.

**`weight_logs`** (exists) — `+ source manual|healthkit`, `+ emaKg real` (materialised trend), `+ waistCm`, `+ hipsCm`, `+ neckCm` (MFP check-in parity). Keep `date, weightKg, bodyFatPct, note`.

**`activity_energy`** (new, for net calories) — `id`, `date`, `kcal integer`, `source workout|healthkit_active|manual`, `workoutId` nullable, `externalId` (HealthKit UUID for de-dup), `loggedAt`; unique `(source, externalId)`.

**`body_photos`** (exists) — `+ weightLogId text` (instead of duplicating `weightKg`; keep `weightKg` as denormalised cache), `+ sha256 text`, `+ exifStripped boolean default true`, `+ widthPx`, `+ heightPx`, `+ aiConsentAt text` nullable. Keep `pose front|side|back`, `date`, `takenAt`, `path`, `note`, `deletedAt`.

**`photo_analyses`** (exists) — `~ photoId` = AFTER photo, `~ comparedToPhotoId` = BEFORE (make not-null), `− progressScore`, `+ comparable boolean`, `+ consistencyIssues text` (JSON), `~ observations text` (JSON of §6.4 objects, not string[]), `+ tips text` (JSON string[]), `+ model`, `+ promptVersion`, `+ inputTokens`, `+ outputTokens`, `+ latencyMs`.

**`daily_summaries`** (new, materialised nightly and on write) — `date` PK, `goalId`, `kcalIn`, `kcalBurned`, `rolloverKcal`, `proteinG`, `carbsG`, `fatG`, `fiberG`, `sugarG`, `sodiumMg`, `satFatG`, `waterMl`, `mealsLogged`, `healthScore`, `goalMet boolean` (within ±10 % kcal), `streakDay integer`. Drives the Today widgets, weekly charts and streak without scanning `meal_items`.

**Routes** (`apps/server/src/routes/nutrition.ts`, all behind `ARAVOS_TOKEN`): `POST /api/nutrition/analyze` (multipart photo + `mode`, `hint`, `localTime`) → `{analysisId, draft}`; `POST /api/nutrition/analyze/:id/fix` `{correction}`; `POST /api/nutrition/analyze/:id/save` `{mealType, date, items[]}` → meal; `GET /api/foods/search?q=&limit=`; `GET /api/foods/barcode/:code` (OFF via device preferred; server fallback → USDA Branded); `GET/POST/PATCH/DELETE /api/meals`, `POST /api/meals/:id/copy`; `GET /api/nutrition/day/:date`, `GET /api/nutrition/week/:date`; `POST/DELETE /api/water`; `POST/GET /api/weight`; `POST /api/body-photos` (multipart), `GET /api/body-photos`, `DELETE /api/body-photos/:id`, `POST /api/body-photos/compare` `{beforeId, afterId, consent:true}`; `GET/PUT /api/nutrition/goals` (computes and stores a `nutrition_goals` row).

Shared zod: add `FoodAnalysisV2` (§5.6), `BodyComparison` (§6.4), `NutritionGoal`, `DailySummary`; extend `MealItem`/`MealItemInput` with the new columns; `HealthProfile.targets` gains `satFatMaxG`, `exerciseAddBack`, `rolloverCalories`.

---

## 8. Open questions / risks
1. OFF's 15 req/min/IP limit means barcode lookups must run on the device (per-user limit) — confirm the Capacitor barcode plugin + direct fetch from iOS; the server only caches results.
2. The 2026-10-29 Foundation Foods CSV archive downloaded without `food.csv`; re-check the link or use the JSON — Foundation is optional for us anyway.
3. Portion error on bowls/stews will dominate complaints; the grams range + clarifications UI is the mitigation, not model choice.
4. Micronutrients: FNDDS has 65 nutrients, so bundling calcium/iron/vit A/C/D/potassium is free (adds ~25 % to JSON size); decide whether to ship them in v1.
5. HealthKit active-energy double counting with the activity multiplier — default add-back to on but show the warning when activity ≥ `active`.
6. Legal copy for the body-photo consent sheet and the Washington/EEA health-data notices (Cal AI maintains a separate Washington policy).

---

## 9. Sources
- Cal AI: https://www.calai.app/ · https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616 · https://feastgood.com/cal-ai-review/ · https://calorietrackerlab.com/reviews/cal-ai/ · https://the-app-reviewer.com/teardowns/cal-ai/ · https://calzy-app.com/blog/cal-ai-review · https://www.calai.app/privacy
- MyFitnessPal: https://apps.apple.com/us/app/myfitnesspal-calorie-counter/id341232718 · https://www.lindenwood.edu/files/resources/my-fitness-pal.pdf · https://www.jmir.org/2020/10/e18237/ · https://nutrola.app/en/blog/why-does-myfitnesspal-not-track-micronutrients · https://www.thedonutwhole.com/what-does-net-calories-mean-on-myfitnesspal/
- USDA FoodData Central: https://fdc.nal.usda.gov/api-guide/ · https://fdc.nal.usda.gov/api-key-signup · https://fdc.nal.usda.gov/download-datasets/ · https://app.swaggerhub.com/apis/fdcnal/food-data_central_api/1.0.1 · https://ars.usda.gov/ARSUserFiles/80400530/pdf/fndds/FNDDS_2021_2023_factsheet.pdf
- Open Food Facts: https://openfoodfacts.github.io/openfoodfacts-server/api/ · https://openfoodfacts.github.io/openfoodfacts-server/api/tutorial-off-api/ · https://world.openfoodfacts.org/api/v2/product/3017624010701
- Open-Food-Calories: https://github.com/chpalitom09-bot/Open-food-calories · https://pypi.org/project/open-food-calories/
- Formulas: https://www.calculator.net/bmr-calculator.html · https://tdeecalculator.it.com/mifflin-st-jeor/ · https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/ (ISSN protein) · https://www.nationalacademies.org/read/10925/chapter/6 (NASEM water) · https://www.efsa.europa.eu/en/press/news/nda100326 · https://www.nationalacademies.org/read/10490/chapter/1 (NASEM macronutrients/fiber) · https://www.weightwatchers.com/us/blog/acceptable-macronutrient-distribution-range · https://www.cspi.org/sites/default/files/attachment/CSPI_Key_Takeaways_2020-2025_DGA.pdf · https://foodsmartcolorado.colostate.edu/nutrition-and-health/healthy-eating/tools-for-healthy-eating/the-2020-2025-dietary-guidelines-for-americans · https://webarchive.library.unt.edu/eot2008/20090116002322mp_/http:/www.cdc.gov/nccdphp/dnpa/healthyweight/losing_weight/index.htm · https://www.niddk.nih.gov/bwp · https://pmc.ncbi.nlm.nih.gov/articles/PMC3859816/ · https://macrofactor.com/cutting-calculator/ · https://en.wikipedia.org/wiki/Nutri-Score
- Claude API: https://platform.claude.com/docs/en/build-with-claude/vision · https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Vision prompting: https://arxiv.org/abs/2607.16514 · https://www.utupub.fi/handle/11111/61987 · https://dev.to/beck_moulton/ai-powered-calorie-counting-mastering-gpt-4o-vision-and-sam-for-automated-nutrition-tracking-4bj1 · https://n8n.io/workflows/9619-food-image-analysis-for-calorie-estimation-with-vision-ai-and-telegram/ · https://openaccess.thecvf.com/content/CVPR2025W/MTF/supplemental/Khlaisamniang_Decomposing_Food_Images_CVPRW_2025_supplemental.pdf
- Body photos: https://www.hevyapp.com/features/progress-photos/ · https://macrofactor.com/?p=4697 · https://gainframe.app/blog/best-progress-photo-apps/ · https://apps.apple.com/us/app/-/id6745906297 · https://apps.apple.com/app/id464254577 (Strong) · https://apps.apple.com/us/app/gentler-streak-workout-tracker/id1576857102 · https://arxiv.org/html/2512.04843v1 · https://www.allianceforeatingdisorders.com/ai-algorithms-and-eating-disorders/
