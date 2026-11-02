import type { FoodAnalysis, Food, MealItem, MealType, Nutrients } from "@aravos/shared";
import { mealHealthScore, scaleNutrients, sumNutrients, todayString, ML_PER_OZ } from "@aravos/shared";
import { fmt1, fmtInt } from "@/lib/format";

export type Units = "metric" | "imperial";

export const MEAL_TYPES: { value: MealType; label: string; group: string }[] = [
  { value: "breakfast", label: "Breakfast", group: "Breakfast" },
  { value: "lunch", label: "Lunch", group: "Lunch" },
  { value: "dinner", label: "Dinner", group: "Dinner" },
  { value: "snack", label: "Snack", group: "Snacks" },
];

export function mealTypeLabel(t: MealType): string {
  return MEAL_TYPES.find((m) => m.value === t)?.label ?? "Meal";
}

/** Breakfast before 10:30, lunch before 15:00, dinner before 21:00, otherwise snack. */
export function mealTypeForNow(d = new Date()): MealType {
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (minutes < 10 * 60 + 30) return "breakfast";
  if (minutes < 15 * 60) return "lunch";
  if (minutes < 21 * 60) return "dinner";
  return "snack";
}

export const MACROS = [
  { key: "proteinG", label: "Protein", short: "P", color: "var(--protein)", textClass: "text-protein-text" },
  { key: "carbsG", label: "Carbs", short: "C", color: "var(--carbs)", textClass: "text-carbs-text" },
  { key: "fatG", label: "Fat", short: "F", color: "var(--fat)", textClass: "text-fat-text" },
] as const;
export type MacroKey = (typeof MACROS)[number]["key"];

export const fmtKcal = (n: number): string => `${fmtInt(n)} kcal`;
/** A real minus sign for negative deltas, a plus for positive ones, nothing within rounding. */
export const signOf = (v: number): string => (v >= 0.05 ? "+" : v <= -0.05 ? "\u2212" : "");
export const fmtG = (n: number | null | undefined): string => (n == null ? "0 g" : `${n >= 10 ? fmtInt(n) : fmt1(n)} g`);
/** "P 31 · C 12 · F 8" in grams, for footnotes. */
export const fmtMacros = (n: Partial<Nutrients>): string => `P ${fmtInt(n.proteinG ?? 0)} · C ${fmtInt(n.carbsG ?? 0)} · F ${fmtInt(n.fatG ?? 0)}`;

/** Water display helpers: ml in metric, fluid ounces in imperial. */
export function waterUnit(units: Units): string {
  return units === "imperial" ? "oz" : "ml";
}
export function toDisplayWater(ml: number, units: Units): number {
  return units === "imperial" ? Math.round(ml / ML_PER_OZ) : Math.round(ml);
}
export function fromDisplayWater(v: number, units: Units): number {
  return units === "imperial" ? Math.round(v * ML_PER_OZ) : Math.round(v);
}
export const WATER_CHIPS: Record<Units, number[]> = { metric: [250, 500, 750], imperial: [8, 16, 24] };
export const WATER_STEP: Record<Units, number> = { metric: 50, imperial: 1 };
export const WATER_TAP_ML = 250;

/** Notification-success haptic fires once per day per metric. Keys match the Today widgets. */
export function celebrateOnce(metric: "water" | "calories" | "protein"): boolean {
  const key = `aravos.${metric}.celebrated`;
  try {
    if (localStorage.getItem(key) === todayString()) return false;
    localStorage.setItem(key, todayString());
    return true;
  } catch {
    return false;
  }
}

// ---------- draft meals (results view) ----------
export interface DraftItem {
  key: string;
  foodId: string | null;
  name: string;
  portion: string;
  quantity: number;
  unit: string;
  grams: number;
  nutrients: Nutrients;
  confidence: number | null;
  /** Present for database foods so gram edits recompute exactly. */
  per100: Nutrients | null;
}

export interface Draft {
  name: string;
  mealType: MealType;
  items: DraftItem[];
  /** Model score for AI results; null for search drafts (computed from totals). */
  healthScore: number | null;
  notes: string;
  imagePath: string | null;
  source: "photo" | "text" | "search" | "barcode";
}

let seq = 1;
export const draftKey = (): string => `d${seq++}`;

export function draftFromAnalysis(a: FoodAnalysis, imagePath: string | null, mealType?: MealType): Draft {
  return {
    name: a.mealName,
    mealType: mealType ?? a.mealType,
    items: a.items.map((it) => ({
      key: draftKey(),
      foodId: null,
      name: it.name,
      portion: it.portion,
      quantity: 1,
      unit: "serving",
      grams: it.grams,
      nutrients: { calories: it.calories, proteinG: it.proteinG, carbsG: it.carbsG, fatG: it.fatG, fiberG: it.fiberG, sugarG: it.sugarG, sodiumMg: it.sodiumMg, saturatedFatG: it.saturatedFatG, cholesterolMg: null, potassiumMg: null },
      confidence: it.confidence,
      per100: null,
    })),
    healthScore: a.healthScore,
    notes: a.notes,
    imagePath,
    source: imagePath ? "photo" : "text",
  };
}

/** Rebuild the analysis object from the edited draft, for /analyze/correct and /meals/from-analysis. */
export function analysisFromDraft(d: Draft): FoodAnalysis {
  const items = d.items.map((it) => ({
    name: it.name,
    portion: it.portion,
    grams: it.grams,
    calories: it.nutrients.calories,
    proteinG: it.nutrients.proteinG,
    carbsG: it.nutrients.carbsG,
    fatG: it.nutrients.fatG,
    fiberG: it.nutrients.fiberG ?? null,
    sugarG: it.nutrients.sugarG ?? null,
    sodiumMg: it.nutrients.sodiumMg ?? null,
    saturatedFatG: it.nutrients.saturatedFatG ?? null,
    confidence: it.confidence ?? 0.5,
  }));
  const t = sumNutrients(items);
  return { mealName: d.name.trim() || "Meal", items, totals: { calories: t.calories, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG }, healthScore: d.healthScore ?? mealHealthScore(t)?.score ?? 5, notes: d.notes, mealType: d.mealType };
}

export function draftItemFromFood(food: Food, grams: number, quantity: number, unit: string, portion: string): DraftItem {
  return { key: draftKey(), foodId: food.id, name: food.name, portion, quantity, unit, grams, nutrients: scaleNutrients(food.per100, grams), confidence: null, per100: food.per100 };
}

/** Scale an item to new grams: exact from per-100 g when known, otherwise linear. */
export function rescaleItem(item: DraftItem, grams: number): DraftItem {
  const g = Math.max(0, grams);
  if (item.per100) return { ...item, grams: g, nutrients: scaleNutrients(item.per100, g) };
  const f = item.grams > 0 ? g / item.grams : 0;
  const r = (v: number | null | undefined) => (v == null ? null : Math.round(v * f * 10) / 10);
  const n = item.nutrients;
  return { ...item, grams: g, nutrients: { calories: Math.round(n.calories * f), proteinG: r(n.proteinG) ?? 0, carbsG: r(n.carbsG) ?? 0, fatG: r(n.fatG) ?? 0, fiberG: r(n.fiberG), sugarG: r(n.sugarG), sodiumMg: r(n.sodiumMg), saturatedFatG: r(n.saturatedFatG), cholesterolMg: r(n.cholesterolMg), potassiumMg: r(n.potassiumMg) } };
}

/** Scale a stored meal item linearly to new grams (used when the item has no food reference). */
export function scaleMealItem(item: MealItem, grams: number): Partial<Nutrients> & { grams: number } {
  const f = item.grams && item.grams > 0 ? grams / item.grams : 1;
  const r = (v: number | null) => (v == null ? null : Math.round(v * f * 10) / 10);
  return { grams, calories: Math.round(item.calories * f), proteinG: r(item.proteinG) ?? 0, carbsG: r(item.carbsG) ?? 0, fatG: r(item.fatG) ?? 0, fiberG: r(item.fiberG), sugarG: r(item.sugarG), sodiumMg: r(item.sodiumMg), saturatedFatG: r(item.saturatedFatG), cholesterolMg: r(item.cholesterolMg), potassiumMg: r(item.potassiumMg) };
}

export function draftTotals(d: Draft): Nutrients {
  return sumNutrients(d.items.map((i) => i.nutrients));
}

/** Score and a one-line reason. The model's score wins when present; the reason always comes from the totals. */
export function scoreLine(totals: Partial<Nutrients>, modelScore: number | null): { score: number | null; reason: string } {
  const h = mealHealthScore(totals);
  const score = modelScore ?? h?.score ?? null;
  if (score == null) return { score: null, reason: "Too small to score" };
  const reason = h?.reasons[0] ?? (score >= 8 ? "Balanced" : "Based on the items above");
  return { score, reason };
}

/** First serving of a food, or 100 g. */
export function defaultServing(food: Food): { label: string; grams: number } {
  return food.servings[0] ?? { label: "100 g", grams: 100 };
}

export const SATURATED_FAT_SHARE = 0.1;
export function saturatedFatMaxG(calories: number): number {
  return Math.round((calories * SATURATED_FAT_SHARE) / 9);
}

/** Error text for AI endpoints that are switched off on the server. */
export function aiErrorText(e: unknown, what = "Photo analysis"): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 503) return `${what} needs an API key. Set ANTHROPIC_API_KEY on the server.`;
  if (status === 0) return "Unable to reach the server. Retry.";
  const msg = e instanceof Error ? e.message : "";
  return msg ? msg.replace(/!/g, ".") : `${what} failed. Retry.`;
}
