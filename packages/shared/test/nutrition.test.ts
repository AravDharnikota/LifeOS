import { describe, expect, it } from "vitest";
import { HealthProfile } from "../src/schemas.ts";
import { bmrMifflinStJeor, calorieFloor, effectivePace, emaSeries, mealHealthScore, proteinBasisWeight, scaleNutrients, suggestTargets, sumNutrients, trendChange, waterTarget, weeksToGoal, weightTrend } from "../src/nutrition.ts";

const today = new Date(2026, 10, 2);
const profile = (over: Partial<HealthProfile>) => HealthProfile.parse(over);

describe("suggestTargets", () => {
  it("matches the worked example for a man losing 0.5 kg per week", () => {
    const p = profile({ sex: "male", birthDate: "1996-06-15", heightCm: 178, activityLevel: "moderate", goal: "lose", paceKgPerWeek: 0.5, targetWeightKg: 70 });
    const t = suggestTargets(p, 80, today);
    expect(t.bmr).toBe(1768);
    expect(t.tdee).toBe(2740);
    expect(t.calories).toBe(2190);
    expect(t.proteinG).toBe(160);
    expect(t.fatG).toBe(66);
    expect(t.carbsG).toBe(239);
    expect(t.fiberG).toBe(31);
    expect(t.sugarMaxG).toBe(55);
    expect(t.sodiumMaxMg).toBe(2300);
    expect(t.waterMl).toBe(2500);
    expect(t.waterBasis).toBe("nasem");
    expect(t.weeksToGoal).toBe(20);
    expect(t.floorApplied).toBe(false);
    expect(t.proteinRangeG).toEqual({ min: 144, max: 191 });
  });
  it("matches the worked example for a woman losing 0.25 kg per week", () => {
    const p = profile({ sex: "female", birthDate: "1998-06-15", heightCm: 165, activityLevel: "light", goal: "lose", paceKgPerWeek: 0.25 });
    const t = suggestTargets(p, 65, today);
    expect(t.calories).toBe(1620);
    expect(t.proteinG).toBe(130);
    expect(t.fatG).toBe(49);
    expect(t.carbsG).toBe(165);
    expect(t.fiberG).toBe(23);
    expect(t.waterMl).toBe(2000);
    expect(t.weeksToGoal).toBeNull();
  });
  it("applies sex-aware calorie floors", () => {
    const woman = profile({ sex: "female", birthDate: "1998-06-15", heightCm: 150, activityLevel: "sedentary", goal: "lose", paceKgPerWeek: 1 });
    const w = suggestTargets(woman, 45, today);
    expect(w.calories).toBe(1200);
    expect(w.floorApplied).toBe(true);
    const man = profile({ sex: "male", birthDate: "1998-06-15", heightCm: 160, activityLevel: "sedentary", goal: "lose", paceKgPerWeek: 1 });
    const m = suggestTargets(man, 55, today);
    expect(m.calories).toBe(1500);
    expect(m.calorieFloor).toBe(1500);
    expect(m.floorApplied).toBe(true);
  });
  it("clamps the pace to 1 percent of body weight per week", () => {
    const p = profile({ sex: "male", birthDate: "1996-06-15", heightCm: 178, activityLevel: "moderate", goal: "lose", paceKgPerWeek: 1.5 });
    const t = suggestTargets(p, 60, today);
    expect(t.paceKgPerWeek).toBe(0.6);
    expect(effectivePace("gain", 1.5, 80)).toBe(0.5);
    expect(effectivePace("maintain", 1.5, 80)).toBe(0);
  });
  it("falls back to defaults when the profile is incomplete", () => {
    const t = suggestTargets(profile({}), null, today);
    expect(t.bmr).toBeNull();
    expect(t.calories).toBe(2400);
    expect(t.proteinG).toBe(120);
    expect(t.waterMl).toBe(2750);
    expect(t.waterBasis).toBe("weight");
  });
  it("caps protein at 35 percent of calories", () => {
    const p = profile({ sex: "female", birthDate: "1998-06-15", heightCm: 160, activityLevel: "sedentary", goal: "lose", paceKgPerWeek: 0.5 });
    const t = suggestTargets(p, 60, today);
    expect(t.proteinG * 4).toBeLessThanOrEqual(t.calories * 0.35);
  });
});

describe("helpers", () => {
  it("computes Mifflin-St Jeor", () => {
    expect(bmrMifflinStJeor("male", 80, 178, 30)).toBe(1767.5);
    expect(bmrMifflinStJeor("female", 65, 165, 28)).toBe(1380.25);
  });
  it("floors never go below the basal rate", () => {
    expect(calorieFloor("female", 1400)).toBe(1400);
    expect(calorieFloor("male", 1300)).toBe(1500);
    expect(calorieFloor(null, null)).toBe(1200);
  });
  it("pulls the protein basis weight toward the goal above BMI 30", () => {
    expect(proteinBasisWeight(80, 178, null)).toBe(80);
    const basis = proteinBasisWeight(120, 175, 85);
    expect(basis).toBeCloseTo(93.75, 2);
    expect(proteinBasisWeight(120, 175, null)).toBeLessThan(120);
  });
  it("defaults water by sex and falls back to 35 ml per kg", () => {
    expect(waterTarget("male", 80)).toEqual({ ml: 2500, basis: "nasem" });
    expect(waterTarget("female", null)).toEqual({ ml: 2000, basis: "nasem" });
    expect(waterTarget(null, 80)).toEqual({ ml: 2750, basis: "weight" });
  });
  it("estimates weeks to goal only in the goal direction", () => {
    expect(weeksToGoal("lose", 80, 70, -550)).toBe(20);
    expect(weeksToGoal("lose", 80, 90, -550)).toBeNull();
    expect(weeksToGoal("gain", 70, 75, 275)).toBe(20);
    expect(weeksToGoal("maintain", 70, 75, 0)).toBeNull();
  });
  it("scales and sums nutrients", () => {
    const per100 = { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6, fiberG: 0, sugarG: null, sodiumMg: 74, saturatedFatG: 1, cholesterolMg: 85, potassiumMg: 256 };
    const scaled = scaleNutrients(per100, 150);
    expect(scaled.calories).toBe(248);
    expect(scaled.proteinG).toBe(46.5);
    expect(scaled.sugarG).toBeNull();
    const total = sumNutrients([scaled, { calories: 100, proteinG: 2.25, carbsG: 20 }]);
    expect(total.calories).toBe(348);
    expect(total.proteinG).toBe(48.8);
    expect(total.carbsG).toBe(20);
  });
});

describe("mealHealthScore", () => {
  it("returns null under 50 kcal", () => {
    expect(mealHealthScore({ calories: 5, proteinG: 0, carbsG: 1, fatG: 0 })).toBeNull();
  });
  it("rewards fiber and protein, penalises sugar, saturated fat and sodium", () => {
    const good = mealHealthScore({ calories: 500, proteinG: 40, carbsG: 50, fatG: 12, fiberG: 12, sugarG: 6, sodiumMg: 300, saturatedFatG: 3 }, { vegFruitLegumeShare: 0.5 });
    expect(good?.score).toBe(10);
    expect(good?.reasons).toEqual(["High in fiber", "Plenty of vegetables, fruit or legumes"]);
    const bad = mealHealthScore({ calories: 600, proteinG: 8, carbsG: 80, fatG: 28, fiberG: 1, sugarG: 45, sodiumMg: 1500, saturatedFatG: 12 }, { mostlyWholeFoods: false });
    expect(bad?.score).toBe(1);
    expect(bad?.reasons).toContain("Very high in sugar");
    expect(bad?.reasons).toContain("Very high in sodium");
  });
  it("skips the sugar penalty when sugar is intrinsic", () => {
    const fruit = mealHealthScore({ calories: 100, proteinG: 1, carbsG: 25, fatG: 0, sugarG: 20, fiberG: 3 }, { sugarIsIntrinsic: true });
    expect(fruit?.reasons).not.toContain("High in sugar");
  });
});

describe("weight trend", () => {
  it("computes an EMA seeded with the first value", () => {
    expect(emaSeries([80, 80, 80])).toEqual([80, 80, 80]);
    expect(emaSeries([80, 70])).toEqual([80, 79]);
  });
  it("orders by date, dedupes dates and reports changes over a window", () => {
    const logs = [
      { date: "2026-01-10", weightKg: 80 },
      { date: "2026-01-01", weightKg: 82 },
      { date: "2026-01-01", weightKg: 81 },
      { date: "2026-01-05", weightKg: 80.5 },
    ];
    const trend = weightTrend(logs);
    expect(trend.map((p) => p.date)).toEqual(["2026-01-01", "2026-01-05", "2026-01-10"]);
    expect(trend[0]?.weightKg).toBe(81);
    expect(trend[0]?.emaKg).toBe(81);
    expect(trend[1]?.emaKg).toBe(80.95);
    expect(trendChange(trend, 7)).toBe(Math.round((trend[2]!.emaKg - trend[0]!.emaKg) * 100) / 100);
    expect(trendChange(trend, 30)).toBeNull();
    expect(trendChange([], 7)).toBeNull();
  });
});
