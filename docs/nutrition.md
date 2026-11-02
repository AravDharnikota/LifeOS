# Nutrition, water, weight and body progress

Server-side reference for the Cal AI / MyFitnessPal style features in `apps/server`. The research behind the choices is in `docs/research/nutrition-spec.md`; this document describes what is actually implemented.

Files:

| Area | Files |
|---|---|
| Food dataset | `apps/server/scripts/build-foods.py`, `apps/server/src/data/foods.json`, `apps/server/src/services/seed-foods.ts` |
| Foods, search, barcodes | `apps/server/src/services/foods.ts` |
| Meals, water, weight, targets, AI food analysis | `apps/server/src/services/nutrition.ts`, `apps/server/src/routes/nutrition.ts` |
| Body photos | `apps/server/src/services/body.ts`, `apps/server/src/routes/body.ts` |
| Upload handling | `apps/server/src/lib/uploads.ts` |
| Formulas (shared with the web app) | `packages/shared/src/nutrition.ts` |
| Tests | `apps/server/test/{foods,nutrition,body}.test.ts`, `packages/shared/test/nutrition.test.ts` |

## 1. Bundled food dataset

### Provenance

`apps/server/src/data/foods.json` is built from two public-domain (CC0) USDA FoodData Central downloads:

- **FNDDS 2021-2023** (survey foods, "foods as eaten", published 2024-10-31): `FoodData_Central_survey_food_json_2024-10-31.zip`.
- **SR Legacy** (April 2018, final release): `FoodData_Central_sr_legacy_food_csv_2018-04.zip`, used for raw ingredients (fruit, vegetables, legumes, nuts, dairy and eggs, poultry, beef, pork, fish, grains, fats and oils, spices).

Attribution: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, https://fdc.nal.usda.gov.

The current file holds 2,500 foods (2,000 FNDDS + 500 SR Legacy) at about 0.84 MB. Each entry is

```json
{ "id": "fndds-24123301", "name": "Chicken breast, grilled, without skin", "brand": null,
  "per100": { "calories": 176, "proteinG": 29.6, "carbsG": 0, "fatG": 5.5, "fiberG": 0, "sugarG": 0, "sodiumMg": 353, "saturatedFatG": 1.0, "cholesterolMg": 96, "potassiumMg": 352 },
  "servings": [ { "label": "1 medium breast", "grams": 120 }, { "label": "1 large or thick slice", "grams": 85 }, { "label": "1 small breast", "grams": 105 }, { "label": "1 cup, cooked, diced", "grams": 135 } ] }
```

Ids are stable: `fndds-<FNDDS food code>` and `sr-<FDC id>`. Missing nutrients are `null`, never 0. The array is sorted by a popularity heuristic so the first entries are the everyday foods.

### How the list is chosen

`build-foods.py` reads both downloads and:

1. Drops FNDDS entries whose description contains `NFS` or `NS as to` (unspecified variants), baby foods, formula and uncategorised items; drops SR Legacy entries that are branded (all-caps brand tokens), commodity, game meat, organ meats, exotic produce and prepared recipes.
2. Rewrites descriptions into readable labels: removes "no added fat", "from restaurant", "fresh" and similar qualifiers; merges parts ("Chicken, breast" to "Chicken breast", "Beef, ground" to "Ground beef"); flips adjective-first names ("Rice, white, cooked" to "White rice, cooked", "Cheese, Cheddar" to "Cheddar cheese"); drops the "Fish," prefix for species; renames "skin not eaten" to "without skin" and so on. Duplicated labels keep the higher-ranked entry.
3. Scores each food: category weight (a hand-tuned table of WWEIA categories, staples such as eggs, chicken, rice and fruit score highest), minus a penalty per qualifier and per character, plus a bonus for a list of common head terms ("chicken breast", "greek yogurt", "oatmeal"), with small adjustments for preparation words (grilled, boiled up; candied, pickled down).
4. Takes the top 2,000 FNDDS and 500 SR Legacy foods with a per-category cap so no single category dominates, keeps up to four household portions per food (preferring "1 cup", "1 tbsp", "1 slice", "1 medium" style labels) and writes compact JSON.

### Rebuilding

```bash
mkdir -p /tmp/usda && cd /tmp/usda
curl -LO https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip
curl -LO https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
unzip -q FoodData_Central_survey_food_json_2024-10-31.zip -d fndds
unzip -q FoodData_Central_sr_legacy_food_csv_2018-04.zip -d sr
cd /path/to/LifeOS/apps/server
python3 -I scripts/build-foods.py /tmp/usda/fndds/surveyDownload.json /tmp/usda/sr/FoodData_Central_sr_legacy_food_csv_2018-04 src/data/foods.json --fndds 2000 --sr 500
```

Run Python with `-I` and keep the downloads outside the repository; the script treats them as untrusted input. It exits non-zero if the output exceeds 1.5 MB. Python 3.10+ with no third-party packages is enough; the build takes a few seconds.

Note: the repository `.gitignore` has a `data/` rule that also matches `apps/server/src/data/`. Add `!apps/server/src/data/` (or move the file) before committing the dataset.

### Seeding

`seedFoods(db)` (called at the end of `seedDatabase`) inserts the bundled list into the `foods` table with `source = "bundled"` in a single transaction using one prepared statement. It is idempotent: it does nothing when `foods` already has rows, so a rebuilt dataset is only picked up by a fresh database. Insert order matches the popularity ranking and is used as the tie-breaker in search (`rowid`).

## 2. Foods API

| Method and path | Purpose |
|---|---|
| `GET /api/foods?q=&limit=` | Search bundled and custom foods. Empty `q` returns the most popular bundled foods. Default limit 25, max 100. |
| `GET /api/foods/:id` | One food with `per100` and `servings`. |
| `POST /api/foods` | Custom food: `{ name, brand?, per100, servings?, barcode? }`, stored with `source = "custom"`. |
| `GET /api/foods/barcode/:code` | Barcode lookup, see below. |

Search tokenises the query (lower case, punctuation removed) and keeps foods where every token is a word prefix or a substring of the name plus brand. Ranking tiers: exact name (500), name starts with the whole query (400), every token starts a word (300), some tokens start words (200), substring only (100); plus 20 per token that matches a whole word, plus 10 for custom foods, minus up to 40 for long names. Ties fall back to insertion order, which is the popularity order of the bundled list.

### Barcodes (Open Food Facts)

`GET /api/foods/barcode/:code` (8 to 14 digits) checks the `foods` table first, then calls Open Food Facts v2 `GET /api/v2/product/{code}?fields=...` with a `User-Agent: AravOS/...` header. Found products are mapped and cached as a `foods` row with `source = "off"` and `barcode` set, so a product is fetched at most once. Not-found products (HTTP 404 or `status: 0`) are remembered in memory for ten minutes and answered with 404 without another call. A token bucket keeps outbound calls under 14 per minute (OFF allows 15 product reads per minute per IP); beyond that the route answers 429. Upstream 429 or 503 map to 503, network failures to 502.

Mapping details: `energy-kcal_100g`, falling back to `energy_100g` (kJ) / 4.184; `sodium_100g` is in grams and becomes mg; when only `salt_100g` is present, sodium = salt / 2.5; `cholesterol_100g` and `potassium_100g` are also converted from grams to mg; missing nutriments stay `null`; `serving_quantity` becomes one serving labelled with `serving_size`. The first comma-separated brand is kept. Open Food Facts data is ODbL; cached rows keep the barcode so the product sheet can link back.

`setBarcodeFetch(fn)` in `services/foods.ts` injects a fake `fetch` for tests; pass `null` to restore the real one.

## 3. Meals API

| Method and path | Purpose |
|---|---|
| `GET /api/meals?date=YYYY-MM-DD` | Meals for the day (default today) with items and totals, plus day totals, targets and remaining. |
| `POST /api/meals` | Create a meal (`MealCreate` plus `photoPath?` and `items[]`). |
| `POST /api/meals/from-analysis` | Create a meal from a `FoodAnalysis` (see section 4). |
| `GET /api/meals/:id` | One meal with items and totals. |
| `PATCH /api/meals/:id` | Update meal fields; when `items` is present the item list is replaced in full. |
| `DELETE /api/meals/:id` | Soft delete (`deleted_at`). |
| `POST /api/meals/:id/items` | Append an item. Returns the meal. |
| `PATCH /api/meal-items/:id` | Update an item. Returns the meal. |
| `DELETE /api/meal-items/:id` | Remove an item. Returns the meal. |

Meal `source` is one of `photo`, `manual`, `search`, `barcode`, `text`. `mealType` defaults from the logged time: before 10:30 breakfast, before 15:00 lunch, before 21:00 dinner, otherwise snack.

Items accept the shared `MealItemInput`, with two relaxations:

- `calories` may be omitted when `foodId` is given together with `grams` or a resolvable serving. Nutrients are then `scaleNutrients(food.per100, grams)`.
- `name` may be omitted when `foodId` is given; the food's name is used.

Grams are resolved from `quantity` and `unit` when not supplied: `g` means grams, `oz` is 28.35 g, a unit equal to one of the food's serving labels uses that serving's weight, and `serving` uses the food's first serving. Patching `quantity`, `unit`, `grams` or `foodId` without `calories` recomputes nutrients from the food.

Manual meals without an explicit `healthScore` get the explainable heuristic score from `mealHealthScore` (1 to 10, null below 50 kcal): minus one for low protein (under 10 % of kcal), low fibre (under 7 g per 1,000 kcal) or high saturated fat, sugar or sodium per kcal, minus two for very high values, plus one for fibre at or above 14 g per 1,000 kcal. Meals created from an analysis keep the model's score.

## 4. AI food analysis

| Method and path | Purpose |
|---|---|
| `POST /api/nutrition/analyze` | `multipart/form-data` with optional `image` file, optional `text`, optional `mealType`, optional `date`. Returns `{ analysisId, imagePath, analysis, localTime, date }`. |
| `POST /api/nutrition/analyze/correct` | JSON `{ analysis, note, imagePath? }`. Re-runs the model with the previous analysis and the user's correction (the image is reloaded from `imagePath` when given). Returns `{ analysis }`. |
| `POST /api/meals/from-analysis` | JSON `{ analysis, date?, mealType?, imagePath?, name? }`. Creates the meal and returns it. |

Behaviour:

- Images are validated by magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`), never by the client's content type, and limited to 12 MB (413 when larger, 415 for other types). They are stored unchanged under `<dataDir>/uploads/meals/<analysisId>.<ext>` and served at `/uploads/meals/<analysisId>.<ext>` (behind the bearer token like the API). The client should downscale to 1,280 px on the long edge, JPEG quality about 85, and strip EXIF before uploading; the server does no image processing.
- `localTime` (HH:mm in the server's configured timezone) is sent so the model can infer the meal slot. A `mealType` field overrides the model's guess.
- The result is normalised: items with zero grams are dropped, confidences clamped to 0..1, totals recomputed from the items, the health score clamped to 0..10, and the whole object re-validated against `FoodAnalysis`.
- Analyses are not persisted (there is no `food_analyses` table in the current schema); the client holds the returned analysis and sends it back to `correct` or `from-analysis`. The uploaded image stays on disk and becomes `meals.photoPath` when the meal is saved.
- `from-analysis` maps each `FoodAnalysisItem` to a meal item with `unit = "serving"`, `quantity = 1`, the estimated `grams`, its nutrients and `confidence`; `source` is `photo` when an `imagePath` is given, otherwise `text`; `aiNotes` and `healthScore` come from the analysis; `name` defaults to `mealName`.
- When the server has no `ANTHROPIC_API_KEY`, every AI route answers 503 with "AI features are disabled. Set ANTHROPIC_API_KEY on the server to enable them." (`AiDisabledError` thrown by the provider is mapped the same way).

The prompts live in `apps/server/src/ai/prompts.ts`. In short: identify every distinct item, estimate the eaten portion in grams from visible references (plate, fork, hand, packaging), use USDA-style values for the cooked state shown, state assumptions about oil, sauces and dressings in `notes`, read packaging labels when legible, give a per-item confidence, infer `mealType` from the local time, and return JSON only. For a correction the previous JSON and the user's note are appended and the model is told to keep unmentioned items unchanged.

## 5. Day and range summaries

- `GET /api/nutrition/day?date=` returns `{ date, totals, targets, remaining, percent, meals: [{ id, mealType, name, calories, items, photoPath, loggedAt, healthScore }], byMealType, water: { ml, target }, weight, healthScore }`. `targets` are the health profile targets; `remaining` and `percent` cover calories, protein, carbs, fat, fibre, sugar (against `sugarMaxG`), sodium (against `sodiumMaxMg`) and water. `weight` is the latest log on or before the date. The day health score is the calorie-weighted mean of meal scores, minus one when calories exceed 115 % of the goal and plus one when both the protein and fibre goals are met.
- `GET /api/nutrition/range?from=&to=` returns one row per calendar day (zeros for days without logs, at most 400 days): `{ date, calories, proteinG, carbsG, fatG, waterMl, meals }`.

## 6. Water and weight

| Method and path | Purpose |
|---|---|
| `GET /api/water?date=` | `{ date, ml, target, logs }` (logs newest first). |
| `POST /api/water` | `{ ml (1..5000), date? }`. |
| `DELETE /api/water/:id` | Remove a log. |
| `GET /api/weight?limit=90` | `{ logs, trend, latest, change7d, change30d }`. |
| `POST /api/weight` | `WeightLogCreate`; one log per date, logging the same date again replaces it. |
| `DELETE /api/weight/:id` | Remove a log. |

The weight trend is an exponential moving average over daily values from oldest to newest, `EMA_t = 0.1 * w_t + 0.9 * EMA_(t-1)`, seeded with the first value (roughly ten-day smoothing). `change7d` and `change30d` compare the latest EMA with the EMA at the last point at least that many days earlier, and are `null` when the history is shorter. `trend` is limited to the same window as `logs` but the EMA is always computed over the full history.

## 7. Targets

`GET /api/health/suggest-targets` returns `{ suggestion, inputs, current }` where `suggestion` is `suggestTargets(profile, latestWeightKg)` from `packages/shared/src/nutrition.ts` and `inputs` lists the values used (weight and its date, sex, birth date, age, height, activity level, goal, requested pace, target weight). `POST /api/health/apply-suggested-targets` writes calories, protein, carbs, fat, fibre, sugar max, sodium max and water into the health profile (settings key `health_profile`) and returns the profile.

Formulas:

- BMR: Mifflin-St Jeor, `10 W + 6.25 H - 5 A + 5` (men) or `- 161` (women). TDEE = BMR times the activity multiplier (1.2, 1.375, 1.55, 1.725, 1.9).
- Pace: the requested pace is clamped to 1 % of body weight per week for losing and 0.5 kg per week for gaining. Daily adjustment = pace times 7,700 kcal / 7.
- Calories: `round10(max(floor, TDEE + adjustment))`. The floor is 1,500 kcal for men, 1,200 for women, 1,200 when sex is unknown, and never below the BMR. `floorApplied` says whether the floor won. Without a complete profile the base is 2,400 kcal.
- Protein: 2.0 g/kg when losing, 1.8 gaining, 1.6 maintaining, capped at 35 % of calories; `proteinRangeG` gives the ISSN-derived band (1.8 to 2.7, 1.6 to 2.2, 1.4 to 2.0 g/kg). Above BMI 30 the weight used is pulled toward the goal weight (or BMI 25) so protein does not explode.
- Fat 27 % of calories with a floor of 0.6 g/kg; carbs are the remainder with a floor of 100 g; fibre 14 g per 1,000 kcal; sugar max is the larger of 50 g and 10 % of calories; saturated fat max 10 % of calories; sodium max 2,300 mg.
- Water: 2,500 ml for men and 2,000 ml for women (NASEM beverage share and EFSA totals, `waterBasis = "nasem"`); when sex is unknown, 35 ml/kg rounded to 250 ml (`waterBasis = "weight"`). The health profile default for `targets.waterMl` is 2,500.
- `weeksToGoal`: static estimate `|goal - current| * 7,700 / |daily adjustment| / 7`, only when the target lies in the goal's direction.

Worked example (male, 30, 80 kg, 178 cm, moderate, lose 0.5 kg/week, target 70 kg): BMR 1,768, TDEE 2,740, 2,190 kcal, protein 160 g (range 144 to 191), fat 66 g, carbs 239 g, fibre 31 g, sugar max 55 g, water 2,500 ml, about 20 weeks to goal.

## 8. Body progress photos

| Method and path | Purpose |
|---|---|
| `POST /api/body/photos` | `multipart/form-data`: `image` (required), `pose` (`front`, `side`, `back`; default front), `date?`, `note?`, `weightKg?`. When `weightKg` is missing the weight log of that date is used. |
| `GET /api/body/photos?pose=` | Newest first, each with its latest analysis. |
| `GET /api/body/photos/:id` | One photo. |
| `DELETE /api/body/photos/:id` | Soft delete and remove the file. |
| `POST /api/body/photos/:id/analyze` | Optional JSON `{ compareToId? }`. Compares with the previous photo of the same pose (or the given one) and stores a `photo_analyses` row. Returns the analysis. |
| `GET /api/body/progress` | `{ timeline: { front, side, back }, pairs: { front, side, back } }`, each timeline oldest first with `{ photoId, date, pose, path, weightKg, analysis }`, and `pairs` holding the first and last photo per pose for a before/after view (null with fewer than two photos). |

Photos are stored unchanged under `<dataDir>/uploads/body/<id>.<ext>` with the same validation as meal photos. They are only sent to the model when the user asks for an analysis; the goal text comes from the health profile ("lose weight at about 0.5 kg per week, target 75 kg"). The stored `progressScore` is clamped to -2..2 and is null when there is no comparison photo. The prompt asks for neutral, visible, caveated observations only: no body-fat estimates, no medical claims, no comments on attractiveness.

## 9. Tests

```bash
cd apps/server && pnpm exec vitest run test/foods.test.ts test/nutrition.test.ts test/body.test.ts
cd packages/shared && pnpm exec vitest run
```

The server tests use the mock AI provider (`t.ai.foodHandler` / `t.ai.bodyHandler` are overridable), inject a fake `fetch` for barcodes, and upload a real 1x1 PNG and a JPEG header through `FormData`.
