import type { HealthProfile, Nutrients } from "./schemas.ts";

export const ACTIVITY_MULTIPLIERS = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 } as const;

export function ageFromBirthDate(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = today.getFullYear() - y!;
  const hadBirthday = today.getMonth() + 1 > m! || (today.getMonth() + 1 === m! && today.getDate() >= d!);
  if (!hadBirthday) age--;
  return age;
}

/** Mifflin-St Jeor basal metabolic rate (kcal/day). */
export function bmrMifflinStJeor(sex: "male" | "female", weightKg: number, heightCm: number, ageYears: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "male" ? base + 5 : base - 161;
}

export function tdee(bmr: number, activity: keyof typeof ACTIVITY_MULTIPLIERS): number {
  return bmr * ACTIVITY_MULTIPLIERS[activity];
}

/** 1 kg of body fat ~ 7700 kcal. Daily adjustment for a weekly pace. */
export function dailyAdjustmentForPace(goal: "lose" | "maintain" | "gain", paceKgPerWeek: number): number {
  if (goal === "maintain") return 0;
  const perDay = (paceKgPerWeek * 7700) / 7;
  return goal === "lose" ? -perDay : perDay;
}

export interface TargetSuggestion {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  waterMl: number;
  bmr: number | null;
  tdee: number | null;
}

/** Suggest daily targets from the profile. Returns sensible defaults when the profile is incomplete. */
export function suggestTargets(profile: HealthProfile, weightKg: number | null, today = new Date()): TargetSuggestion {
  let bmr: number | null = null;
  let maintenance: number | null = null;
  if (profile.sex && profile.birthDate && profile.heightCm && weightKg) {
    bmr = bmrMifflinStJeor(profile.sex, weightKg, profile.heightCm, ageFromBirthDate(profile.birthDate, today));
    maintenance = tdee(bmr, profile.activityLevel);
  }
  const calories = Math.round(Math.max(1200, (maintenance ?? 2400) + dailyAdjustmentForPace(profile.goal, profile.paceKgPerWeek)) / 10) * 10;
  // Protein: 1.6 g/kg maintain, 2.0 g/kg lose (muscle retention), 1.8 g/kg gain
  const gPerKg = profile.goal === "lose" ? 2.0 : profile.goal === "gain" ? 1.8 : 1.6;
  const proteinG = Math.round((weightKg ?? 75) * gPerKg);
  const fatG = Math.round((calories * 0.27) / 9);
  const carbsG = Math.max(50, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
  const fiberG = Math.round((calories / 1000) * 14);
  const waterMl = Math.round(((weightKg ?? 75) * 35) / 250) * 250;
  return { calories, proteinG, carbsG, fatG, fiberG, waterMl, bmr: bmr ? Math.round(bmr) : null, tdee: maintenance ? Math.round(maintenance) : null };
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
  return t;
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

export const ML_PER_OZ = 29.5735;
