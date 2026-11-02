import { addDaysString } from "./dates.ts";
import type { HealthProfile, Nutrients } from "./schemas.ts";

export const ACTIVITY_MULTIPLIERS = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 } as const;
export type ActivityLevel = keyof typeof ACTIVITY_MULTIPLIERS;
export type Sex = "male" | "female";
export type WeightGoal = "lose" | "maintain" | "gain";

/** Energy density of body-weight change: about 7,700 kcal per kg (3,500 kcal per lb). */
export const KCAL_PER_KG = 7700;
/** App-convention calorie floors (MyFitnessPal style). 1,200 kcal applies when sex is unknown. */
export const CALORIE_FLOOR = { male: 1500, female: 1200 } as const;
export const DEFAULT_CALORIE_FLOOR = 1200;
/** Loss pace guardrail: at most 1 % of body weight per week. Gain pace guardrail: 0.5 kg per week. */
export const MAX_LOSS_PACE_FRACTION = 0.01;
export const MAX_GAIN_PACE_KG_PER_WEEK = 0.5;
/** Protein targets in g per kg by goal, derived from the ISSN position stand (1.4 to 2.0 g/kg for active adults, higher in a deficit). */
export const PROTEIN_G_PER_KG = { lose: 2.0, maintain: 1.6, gain: 1.8 } as const;
export const PROTEIN_RANGE_G_PER_KG = { lose: [1.8, 2.7], maintain: [1.4, 2.0], gain: [1.6, 2.2] } as const;
/** AMDR cap: protein at most 35 % of calories. */
export const PROTEIN_MAX_KCAL_SHARE = 0.35;
export const FAT_KCAL_SHARE = 0.27;
export const FAT_FLOOR_G_PER_KG = 0.6;
export const CARB_FLOOR_G = 100;
export const FIBER_G_PER_1000_KCAL = 14;
export const SUGAR_MAX_KCAL_SHARE = 0.1;
export const SUGAR_MIN_MAX_G = 50;
export const SATURATED_FAT_MAX_KCAL_SHARE = 0.1;
export const SODIUM_MAX_MG = 2300;
/** Daily water from beverages, ml: NASEM adequate intake (3.0 L men / 2.2 L women from beverages) blended with EFSA totals (2.5 L / 2.0 L). */
export const WATER_ML_BY_SEX = { male: 2500, female: 2000 } as const;
/** Clinical heuristic used only when sex is unknown. */
export const WATER_ML_PER_KG_FALLBACK = 35;
export const ML_PER_OZ = 29.5735;

export function ageFromBirthDate(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = today.getFullYear() - y!;
  const hadBirthday = today.getMonth() + 1 > m! || (today.getMonth() + 1 === m! && today.getDate() >= d!);
  if (!hadBirthday) age--;
  return age;
}

/** Mifflin-St Jeor basal metabolic rate (kcal/day). */
export function bmrMifflinStJeor(sex: Sex, weightKg: number, heightCm: number, ageYears: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "male" ? base + 5 : base - 161;
}

export function tdee(bmr: number, activity: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIERS[activity];
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** Daily calorie adjustment for a weekly pace (negative when losing). */
export function dailyAdjustmentForPace(goal: WeightGoal, paceKgPerWeek: number): number {
  if (goal === "maintain") return 0;
  const perDay = (paceKgPerWeek * KCAL_PER_KG) / 7;
  return goal === "lose" ? -perDay : perDay;
}

/** Clamp the requested pace to the guardrails. */
export function effectivePace(goal: WeightGoal, paceKgPerWeek: number, weightKg: number | null): number {
  if (goal === "maintain") return 0;
  if (goal === "gain") return Math.min(paceKgPerWeek, MAX_GAIN_PACE_KG_PER_WEEK);
  if (!weightKg) return paceKgPerWeek;
  return Math.min(paceKgPerWeek, Math.round(weightKg * MAX_LOSS_PACE_FRACTION * 100) / 100);
}

/** Sex-aware floor, never below the basal rate when it is known. */
export function calorieFloor(sex: Sex | null, bmr: number | null): number {
  const base = sex ? CALORIE_FLOOR[sex] : DEFAULT_CALORIE_FLOOR;
  return bmr ? Math.max(base, Math.round(bmr)) : base;
}

/** Weight used for protein math. Above BMI 30 it is pulled toward the goal (or BMI 25) weight so protein does not explode. */
export function proteinBasisWeight(weightKg: number, heightCm: number | null, targetWeightKg: number | null): number {
  if (!heightCm || bmi(weightKg, heightCm) < 30) return weightKg;
  const m = heightCm / 100;
  const ideal = 25 * m * m;
  const anchor = targetWeightKg && targetWeightKg < weightKg ? targetWeightKg : ideal;
  return Math.min(weightKg, anchor + 0.25 * (weightKg - anchor));
}

export type WaterBasis = "nasem" | "weight";
export function waterTarget(sex: Sex | null, weightKg: number | null): { ml: number; basis: WaterBasis } {
  if (sex) return { ml: WATER_ML_BY_SEX[sex], basis: "nasem" };
  return { ml: roundTo((weightKg ?? 75) * WATER_ML_PER_KG_FALLBACK, 250), basis: "weight" };
}

export interface TargetSuggestion {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  waterMl: number;
  sugarMaxG: number;
  sodiumMaxMg: number;
  saturatedFatMaxG: number;
  proteinRangeG: { min: number; max: number };
  bmr: number | null;
  tdee: number | null;
  calorieFloor: number;
  floorApplied: boolean;
  paceKgPerWeek: number;
  waterBasis: WaterBasis;
  weeksToGoal: number | null;
}

/** Suggest daily targets from the profile. Returns sensible defaults when the profile is incomplete. */
export function suggestTargets(profile: HealthProfile, weightKg: number | null, today = new Date()): TargetSuggestion {
  let bmr: number | null = null;
  let maintenance: number | null = null;
  if (profile.sex && profile.birthDate && profile.heightCm && weightKg) {
    bmr = bmrMifflinStJeor(profile.sex, weightKg, profile.heightCm, ageFromBirthDate(profile.birthDate, today));
    maintenance = tdee(bmr, profile.activityLevel);
  }
  const pace = effectivePace(profile.goal, profile.paceKgPerWeek, weightKg);
  const delta = dailyAdjustmentForPace(profile.goal, pace);
  const floor = calorieFloor(profile.sex, bmr);
  const rawCalories = (maintenance ?? 2400) + delta;
  const calories = roundTo(Math.max(floor, rawCalories), 10);

  const basisWeight = weightKg ? proteinBasisWeight(weightKg, profile.heightCm, profile.targetWeightKg) : 75;
  const proteinCap = Math.floor((calories * PROTEIN_MAX_KCAL_SHARE) / 4);
  const proteinG = Math.min(Math.round(basisWeight * PROTEIN_G_PER_KG[profile.goal]), proteinCap);
  const [lo, hi] = PROTEIN_RANGE_G_PER_KG[profile.goal];
  const proteinRangeG = { min: Math.min(Math.round(basisWeight * lo), proteinCap), max: Math.min(Math.round(basisWeight * hi), proteinCap) };

  const fatG = Math.max(Math.round((calories * FAT_KCAL_SHARE) / 9), Math.round((weightKg ?? 75) * FAT_FLOOR_G_PER_KG));
  const carbsG = Math.max(CARB_FLOOR_G, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
  const fiberG = Math.round((calories / 1000) * FIBER_G_PER_1000_KCAL);
  const sugarMaxG = Math.max(SUGAR_MIN_MAX_G, Math.round((calories * SUGAR_MAX_KCAL_SHARE) / 4));
  const saturatedFatMaxG = Math.round((calories * SATURATED_FAT_MAX_KCAL_SHARE) / 9);
  const water = waterTarget(profile.sex, weightKg);

  return {
    calories,
    proteinG,
    carbsG,
    fatG,
    fiberG,
    waterMl: water.ml,
    sugarMaxG,
    sodiumMaxMg: SODIUM_MAX_MG,
    saturatedFatMaxG,
    proteinRangeG,
    bmr: bmr ? Math.round(bmr) : null,
    tdee: maintenance ? Math.round(maintenance) : null,
    calorieFloor: floor,
    floorApplied: rawCalories < floor,
    paceKgPerWeek: pace,
    waterBasis: water.basis,
    weeksToGoal: weeksToGoal(profile.goal, weightKg, profile.targetWeightKg, delta),
  };
}

/** Static estimate: weeks until the target weight at the daily adjustment (slows down in practice as weight changes). */
export function weeksToGoal(goal: WeightGoal, weightKg: number | null, targetWeightKg: number | null, dailyDelta: number): number | null {
  if (!weightKg || !targetWeightKg || dailyDelta === 0) return null;
  const diff = targetWeightKg - weightKg;
  if ((goal === "lose" && diff >= 0) || (goal === "gain" && diff <= 0)) return null;
  return Math.round(((Math.abs(diff) * KCAL_PER_KG) / Math.abs(dailyDelta) / 7) * 10) / 10;
}

export const EMPTY_NUTRIENTS: Nutrients = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0, saturatedFatG: 0, cholesterolMg: 0, potassiumMg: 0 };

export function sumNutrients(items: Partial<Nutrients>[]): Nutrients {
  const t: Nutrients = { ...EMPTY_NUTRIENTS };
  for (const i of items) {
    t.calories += i.calories ?? 0;
    t.proteinG += i.proteinG ?? 0;
    t.carbsG += i.carbsG ?? 0;
    t.fatG += i.fatG ?? 0;
    t.fiberG = (t.fiberG ?? 0) + (i.fiberG ?? 0);
    t.sugarG = (t.sugarG ?? 0) + (i.sugarG ?? 0);
    t.sodiumMg = (t.sodiumMg ?? 0) + (i.sodiumMg ?? 0);
    t.saturatedFatG = (t.saturatedFatG ?? 0) + (i.saturatedFatG ?? 0);
    t.cholesterolMg = (t.cholesterolMg ?? 0) + (i.cholesterolMg ?? 0);
    t.potassiumMg = (t.potassiumMg ?? 0) + (i.potassiumMg ?? 0);
  }
  return roundNutrients(t);
}

/** Scale per-100g nutrients to a gram amount. */
export function scaleNutrients(per100: Nutrients, grams: number): Nutrients {
  const f = grams / 100;
  const r = (v: number | null | undefined) => (v == null ? null : Math.round(v * f * 10) / 10);
  return {
    calories: Math.round(per100.calories * f),
    proteinG: r(per100.proteinG) ?? 0,
    carbsG: r(per100.carbsG) ?? 0,
    fatG: r(per100.fatG) ?? 0,
    fiberG: r(per100.fiberG),
    sugarG: r(per100.sugarG),
    sodiumMg: r(per100.sodiumMg),
    saturatedFatG: r(per100.saturatedFatG),
    cholesterolMg: r(per100.cholesterolMg),
    potassiumMg: r(per100.potassiumMg),
  };
}

export function roundNutrients(n: Nutrients): Nutrients {
  const r = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    calories: Math.round(n.calories),
    proteinG: r(n.proteinG) ?? 0,
    carbsG: r(n.carbsG) ?? 0,
    fatG: r(n.fatG) ?? 0,
    fiberG: r(n.fiberG),
    sugarG: r(n.sugarG),
    sodiumMg: r(n.sodiumMg),
    saturatedFatG: r(n.saturatedFatG),
    cholesterolMg: r(n.cholesterolMg),
    potassiumMg: r(n.potassiumMg),
  };
}

// ---------- health score (explainable heuristic, Nutri-Score style per kcal) ----------
export interface HealthScore {
  score: number;
  reasons: string[];
}
export interface HealthScoreFlags {
  mostlyWholeFoods?: boolean | null;
  sugarIsIntrinsic?: boolean | null;
  vegFruitLegumeShare?: number | null;
}

/** Score a meal 1..10 from its totals. Returns null below 50 kcal (water, black coffee) where a score is meaningless. */
export function mealHealthScore(t: Partial<Nutrients>, flags: HealthScoreFlags = {}): HealthScore | null {
  const kcal = t.calories ?? 0;
  if (kcal < 50) return null;
  let score = 10;
  const reasons: string[] = [];
  const hit = (delta: number, reason: string) => {
    score += delta;
    reasons.push(reason);
  };
  if ((4 * (t.proteinG ?? 0)) / kcal < 0.1) hit(-1, "Low in protein");
  if (t.fiberG != null) {
    const perThousand = t.fiberG / (kcal / 1000);
    if (perThousand < 7) hit(-1, "Low in fiber");
    else if (perThousand >= 14) hit(1, "High in fiber");
  }
  if (t.saturatedFatG != null) {
    const share = (9 * t.saturatedFatG) / kcal;
    if (share > 0.15) hit(-2, "Very high in saturated fat");
    else if (share > 0.1) hit(-1, "High in saturated fat");
  }
  if (t.sugarG != null && !flags.sugarIsIntrinsic) {
    const share = (4 * t.sugarG) / kcal;
    if (share > 0.25) hit(-2, "Very high in sugar");
    else if (share > 0.15) hit(-1, "High in sugar");
  }
  if (t.sodiumMg != null) {
    const perKcal = t.sodiumMg / kcal;
    if (perKcal > 2) hit(-2, "Very high in sodium");
    else if (perKcal > 1) hit(-1, "High in sodium");
  }
  if (flags.mostlyWholeFoods === false) hit(-1, "Mostly processed foods");
  if ((flags.vegFruitLegumeShare ?? 0) >= 0.4) hit(1, "Plenty of vegetables, fruit or legumes");
  return { score: Math.max(1, Math.min(10, score)), reasons };
}

// ---------- weight trend ----------
export interface TrendPoint {
  date: string;
  weightKg: number;
  emaKg: number;
}

/** Exponential moving average seeded with the first value. alpha 0.1 is roughly a 10-day smoothing window. */
export function emaSeries(values: number[], alpha = 0.1): number[] {
  const out: number[] = [];
  let prev: number | null = null;
  for (const v of values) {
    prev = prev == null ? v : alpha * v + (1 - alpha) * prev;
    out.push(Math.round(prev * 100) / 100);
  }
  return out;
}

/** One point per date, oldest to newest, with the EMA trend. When a date repeats the last entry wins. */
export function weightTrend(logs: { date: string; weightKg: number }[], alpha = 0.1): TrendPoint[] {
  const byDate = new Map<string, number>();
  for (const l of logs) byDate.set(l.date, l.weightKg);
  const dates = [...byDate.keys()].sort();
  const ema = emaSeries(
    dates.map((d) => byDate.get(d)!),
    alpha,
  );
  return dates.map((date, i) => ({ date, weightKg: byDate.get(date)!, emaKg: ema[i]! }));
}

/** Change in the trend (EMA) over the last `days` days, or null when there is no point that far back. */
export function trendChange(trend: TrendPoint[], days: number): number | null {
  const last = trend[trend.length - 1];
  if (!last) return null;
  const cutoff = addDaysString(last.date, -days);
  let ref: TrendPoint | null = null;
  for (const p of trend) {
    if (p.date <= cutoff) ref = p;
    else break;
  }
  if (!ref) return null;
  return Math.round((last.emaKg - ref.emaKg) * 100) / 100;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
