import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Food, FoodAnalysis, HealthProfile, Meal, WaterLog, WeightLog } from "@aravos/shared";
import { suggestTargets, trendChange, weightTrend } from "@aravos/shared";
import { makeTestApp } from "./helpers.ts";
import { AiDisabledError, type FoodAnalysisRequest } from "../src/ai/provider.ts";
import { mealTypeForTime, type DaySummary, type RangeRow, type WeightSummary } from "../src/services/nutrition.ts";

const t = makeTestApp();
afterAll(() => t.cleanup());

/** 1x1 transparent PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
/** JPEG start of image + JFIF marker, enough for magic-byte detection. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), Buffer.alloc(64), Buffer.from([0xff, 0xd9])]);

function form(fields: Record<string, string>, image?: { bytes: Buffer; name: string; type?: string }): FormData {
  const fd = new FormData();
  if (image) fd.append("image", new Blob([new Uint8Array(image.bytes)], { type: image.type ?? "application/octet-stream" }), image.name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

async function postForm<T>(url: string, fd: FormData): Promise<{ status: number; data: T }> {
  const res = await t.fetch(url, { method: "POST", body: fd });
  return { status: res.status, data: (await res.json()) as T };
}

describe("meals", () => {
  let banana: Food;
  let mealId: string;
  it("creates a meal with explicit and food-derived items and computes totals", async () => {
    const foods = await t.api<Food[]>("GET", "/api/foods?q=banana%2C%20raw");
    banana = foods.data[0]!;
    expect(banana.name.toLowerCase()).toContain("banana");
    const created = await t.api<Meal>("POST", "/api/meals", {
      date: "2026-11-02",
      mealType: "breakfast",
      name: "Oats and banana",
      items: [
        { name: "Oats", calories: 150, proteinG: 5, carbsG: 27, fatG: 3, fiberG: 4 },
        { foodId: banana.id, grams: 120 },
      ],
    });
    expect(created.status).toBe(201);
    mealId = created.data.id;
    expect(created.data.source).toBe("manual");
    const items = created.data.items!;
    expect(items).toHaveLength(2);
    expect(items[1]?.name).toBe(banana.name);
    expect(items[1]?.calories).toBe(Math.round(banana.per100.calories * 1.2));
    expect(items[1]?.proteinG).toBeCloseTo(banana.per100.proteinG * 1.2, 0);
    expect(created.data.totals?.calories).toBe(150 + Math.round(banana.per100.calories * 1.2));
    expect(created.data.healthScore).toBeGreaterThanOrEqual(1);
    expect(created.data.healthScore).toBeLessThanOrEqual(10);
    const day = await t.api<{ meals: Meal[]; totals: { calories: number }; targets: { calories: number } }>("GET", "/api/meals?date=2026-11-02");
    expect(day.data.meals).toHaveLength(1);
    expect(day.data.totals.calories).toBe(created.data.totals?.calories);
    expect(day.data.targets.calories).toBeGreaterThan(0);
    const one = await t.api<Meal>("GET", `/api/meals/${mealId}`);
    expect(one.data.items).toHaveLength(2);
  });
  it("uses a known serving when grams are omitted", async () => {
    const serving = banana.servings[0]!;
    const meal = await t.api<Meal>("POST", "/api/meals", { date: "2026-11-02", mealType: "snack", items: [{ foodId: banana.id, quantity: 2, unit: serving.label }] });
    expect(meal.data.items?.[0]?.grams).toBeCloseTo(serving.grams * 2, 1);
    expect(meal.data.items?.[0]?.calories).toBe(Math.round((banana.per100.calories * serving.grams * 2) / 100));
    await t.api("DELETE", `/api/meals/${meal.data.id}`);
  });
  it("rejects an item without calories or a food", async () => {
    const r = await t.api("POST", "/api/meals", { items: [{ name: "Mystery" }] }, { allowError: true });
    expect(r.status).toBe(400);
    const unknownFood = await t.api("POST", "/api/meals", { items: [{ foodId: "nope", grams: 100 }] }, { allowError: true });
    expect(unknownFood.status).toBe(400);
  });
  it("adds, patches and removes items", async () => {
    const added = await t.api<Meal>("POST", `/api/meals/${mealId}/items`, { name: "Black coffee", calories: 5, unit: "cup" });
    expect(added.status).toBe(201);
    expect(added.data.items).toHaveLength(3);
    const coffee = added.data.items![2]!;
    expect(coffee.sortOrder).toBe(2);
    const patched = await t.api<Meal>("PATCH", `/api/meal-items/${coffee.id}`, { calories: 10, name: "Coffee with milk" });
    expect(patched.data.items![2]?.calories).toBe(10);
    expect(patched.data.items![2]?.name).toBe("Coffee with milk");
    const bananaItem = added.data.items![1]!;
    const regrams = await t.api<Meal>("PATCH", `/api/meal-items/${bananaItem.id}`, { grams: 60 });
    expect(regrams.data.items![1]?.calories).toBe(Math.round(banana.per100.calories * 0.6));
    const removed = await t.api<Meal>("DELETE", `/api/meal-items/${coffee.id}`);
    expect(removed.data.items).toHaveLength(2);
    const missing = await t.api("PATCH", "/api/meal-items/nope", { calories: 1 }, { allowError: true });
    expect(missing.status).toBe(404);
  });
  it("patches meal fields and replaces items", async () => {
    const r = await t.api<Meal>("PATCH", `/api/meals/${mealId}`, { name: "Brunch", mealType: "lunch", items: [{ name: "Toast", calories: 100, carbsG: 20 }] });
    expect(r.data.name).toBe("Brunch");
    expect(r.data.mealType).toBe("lunch");
    expect(r.data.items).toHaveLength(1);
    expect(r.data.totals?.calories).toBe(100);
  });
  it("soft deletes", async () => {
    await t.api("DELETE", `/api/meals/${mealId}`);
    const gone = await t.api("GET", `/api/meals/${mealId}`, undefined, { allowError: true });
    expect(gone.status).toBe(404);
    const day = await t.api<{ meals: Meal[] }>("GET", "/api/meals?date=2026-11-02");
    expect(day.data.meals).toHaveLength(0);
  });
  it("infers the meal type from the time of day", () => {
    expect(mealTypeForTime("08:00")).toBe("breakfast");
    expect(mealTypeForTime("12:30")).toBe("lunch");
    expect(mealTypeForTime("19:00")).toBe("dinner");
    expect(mealTypeForTime("23:00")).toBe("snack");
  });
});

describe("AI analysis", () => {
  let analysis: FoodAnalysis;
  let imagePath: string;
  it("analyzes an uploaded photo, stores it and serves it", async () => {
    let seen: FoodAnalysisRequest | null = null;
    const original = t.ai.foodHandler;
    t.ai.foodHandler = async (req) => {
      seen = req;
      return original(req);
    };
    const r = await postForm<{ analysisId: string; imagePath: string; analysis: FoodAnalysis; localTime: string; date: string }>("/api/nutrition/analyze", form({ text: "chicken and rice bowl", mealType: "dinner", date: "2026-11-02" }, { bytes: PNG, name: "meal.bin", type: "text/plain" }));
    t.ai.foodHandler = original;
    expect(r.status).toBe(200);
    expect(r.data.imagePath).toMatch(/^\/uploads\/meals\/[0-9a-f-]+\.png$/);
    expect(r.data.analysisId).toBeTruthy();
    expect(r.data.localTime).toMatch(/^\d{2}:\d{2}$/);
    expect(r.data.date).toBe("2026-11-02");
    expect(r.data.analysis.mealType).toBe("dinner");
    expect(r.data.analysis.items).toHaveLength(2);
    expect(r.data.analysis.totals.calories).toBe(455);
    expect(seen!.image?.mediaType).toBe("image/png");
    expect(seen!.image?.base64).toBe(PNG.toString("base64"));
    expect(seen!.text).toBe("chicken and rice bowl");
    expect(fs.existsSync(path.join(t.ctx.env.uploadsDir, "meals", path.basename(r.data.imagePath)))).toBe(true);
    const served = await t.fetch(r.data.imagePath);
    expect(served.status).toBe(200);
    analysis = r.data.analysis;
    imagePath = r.data.imagePath;
  });
  it("stores JPEG uploads with a jpg extension", async () => {
    const r = await postForm<{ imagePath: string }>("/api/nutrition/analyze", form({}, { bytes: JPEG, name: "photo.jpg" }));
    expect(r.status).toBe(200);
    expect(r.data.imagePath).toMatch(/\.jpg$/);
  });
  it("rejects unsupported files, oversize uploads and empty requests", async () => {
    const text = await postForm<{ error: string }>("/api/nutrition/analyze", form({}, { bytes: Buffer.from("hello"), name: "notes.txt", type: "image/jpeg" }));
    expect(text.status).toBe(415);
    const big = await postForm<{ error: string }>("/api/nutrition/analyze", form({}, { bytes: Buffer.concat([PNG, Buffer.alloc(12 * 1024 * 1024)]), name: "big.png" }));
    expect(big.status).toBe(413);
    const empty = await postForm<{ error: string }>("/api/nutrition/analyze", form({}));
    expect(empty.status).toBe(400);
    const notMultipart = await t.api("POST", "/api/nutrition/analyze", { text: "x" }, { allowError: true });
    expect(notMultipart.status).toBe(400);
  });
  it("analyzes text without a photo", async () => {
    const r = await postForm<{ analysisId: string; imagePath: string | null; analysis: FoodAnalysis }>("/api/nutrition/analyze", form({ text: "two eggs and toast" }));
    expect(r.status).toBe(200);
    expect(r.data.imagePath).toBeNull();
    expect(r.data.analysisId).toBeTruthy();
    expect(r.data.analysis.mealName).toBe("two eggs and toast");
  });
  it("re-runs the analysis with a correction and the original image", async () => {
    let seen: FoodAnalysisRequest | null = null;
    t.ai.foodHandler = async (req) => {
      seen = req;
      return { ...req.correction!.previous, items: req.correction!.previous.items.slice(0, 1), notes: "Removed the rice." };
    };
    const r = await t.api<{ analysis: FoodAnalysis }>("POST", "/api/nutrition/analyze/correct", { analysis, note: "there was no rice", imagePath });
    t.ai.foodHandler = new (await import("../src/ai/mock.ts")).MockAiProvider().foodHandler;
    expect(seen!.correction?.note).toBe("there was no rice");
    expect(seen!.correction?.previous.mealName).toBe(analysis.mealName);
    expect(seen!.image?.mediaType).toBe("image/png");
    expect(r.data.analysis.items).toHaveLength(1);
    expect(r.data.analysis.totals.calories).toBe(250);
    const badPath = await t.api("POST", "/api/nutrition/analyze/correct", { analysis, note: "x", imagePath: "/uploads/../secrets" }, { allowError: true });
    expect(badPath.status).toBe(400);
  });
  it("creates a meal from an analysis", async () => {
    const r = await t.api<Meal>("POST", "/api/meals/from-analysis", { analysis, imagePath, date: "2026-11-02" });
    expect(r.status).toBe(201);
    expect(r.data.source).toBe("photo");
    expect(r.data.photoPath).toBe(imagePath);
    expect(r.data.name).toBe(analysis.mealName);
    expect(r.data.mealType).toBe("dinner");
    expect(r.data.aiNotes).toBe(analysis.notes);
    expect(r.data.healthScore).toBe(analysis.healthScore);
    expect(r.data.items).toHaveLength(2);
    expect(r.data.items?.[0]).toMatchObject({ name: "Grilled chicken breast", unit: "serving", quantity: 1, grams: 150, calories: 250, confidence: 0.9 });
    expect(r.data.totals?.calories).toBe(455);
    const text = await t.api<Meal>("POST", "/api/meals/from-analysis", { analysis, name: "Leftovers", mealType: "snack" });
    expect(text.data.source).toBe("text");
    expect(text.data.name).toBe("Leftovers");
    expect(text.data.mealType).toBe("snack");
    await t.api("DELETE", `/api/meals/${r.data.id}`);
    await t.api("DELETE", `/api/meals/${text.data.id}`);
  });
  it("returns 503 with the fix when AI is disabled", async () => {
    const off = makeTestApp();
    off.ai.enabled = false;
    const r = await off.fetch("/api/nutrition/analyze", { method: "POST", body: form({ text: "eggs" }) });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toContain("ANTHROPIC_API_KEY");
    const correct = await off.api<{ error: string }>("POST", "/api/nutrition/analyze/correct", { analysis, note: "x" }, { allowError: true });
    expect(correct.status).toBe(503);
    off.cleanup();
    const original = t.ai.foodHandler;
    t.ai.foodHandler = async () => {
      throw new AiDisabledError();
    };
    const mapped = await postForm<{ error: string }>("/api/nutrition/analyze", form({ text: "eggs" }));
    t.ai.foodHandler = original;
    expect(mapped.status).toBe(503);
    expect(mapped.data.error).toContain("ANTHROPIC_API_KEY");
  });
});

describe("day and range summaries", () => {
  it("summarises a day with meals, water and weight", async () => {
    await t.api("POST", "/api/meals", { date: "2026-11-03", mealType: "breakfast", items: [{ name: "Eggs", calories: 300, proteinG: 20, fatG: 20 }] });
    await t.api("POST", "/api/meals", { date: "2026-11-03", mealType: "dinner", items: [{ name: "Pasta", calories: 500, carbsG: 80, proteinG: 15, fatG: 10 }] });
    await t.api("POST", "/api/water", { ml: 500, date: "2026-11-03" });
    await t.api("POST", "/api/water", { ml: 250, date: "2026-11-03" });
    await t.api("POST", "/api/weight", { date: "2026-11-03", weightKg: 80 });
    const r = await t.api<DaySummary>("GET", "/api/nutrition/day?date=2026-11-03");
    expect(r.data.date).toBe("2026-11-03");
    expect(r.data.totals.calories).toBe(800);
    expect(r.data.totals.proteinG).toBe(35);
    expect(r.data.byMealType.breakfast.calories).toBe(300);
    expect(r.data.byMealType.dinner.calories).toBe(500);
    expect(r.data.byMealType.lunch.calories).toBe(0);
    expect(r.data.remaining.calories).toBe(r.data.targets.calories - 800);
    expect(r.data.percent.calories).toBe(Math.round((800 / r.data.targets.calories) * 100));
    expect(r.data.water).toEqual({ ml: 750, target: r.data.targets.waterMl });
    expect(r.data.targets.waterMl).toBe(2500);
    expect(r.data.weight?.weightKg).toBe(80);
    expect(r.data.meals).toHaveLength(2);
    expect(r.data.meals[0]).toMatchObject({ mealType: "breakfast", calories: 300, items: 1, photoPath: null });
    expect(r.data.healthScore === null || (r.data.healthScore >= 1 && r.data.healthScore <= 10)).toBe(true);
    const today = await t.api<DaySummary>("GET", "/api/nutrition/day");
    expect(today.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("returns one row per day with zeros for empty days", async () => {
    const r = await t.api<RangeRow[]>("GET", "/api/nutrition/range?from=2026-11-01&to=2026-11-05");
    expect(r.data).toHaveLength(5);
    expect(r.data.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(r.data[2]).toMatchObject({ calories: 800, proteinG: 35, carbsG: 80, fatG: 30, waterMl: 750, meals: 2 });
    expect(r.data[3]).toMatchObject({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, waterMl: 0, meals: 0 });
    const bad = await t.api("GET", "/api/nutrition/range?from=2026-11-05&to=2026-11-01", undefined, { allowError: true });
    expect(bad.status).toBe(400);
    const missing = await t.api("GET", "/api/nutrition/range?from=2026-11-01", undefined, { allowError: true });
    expect(missing.status).toBe(400);
  });
});

describe("water", () => {
  it("logs, lists and deletes water with validation", async () => {
    const a = await t.api<WaterLog>("POST", "/api/water", { ml: 400, date: "2026-11-04" });
    expect(a.status).toBe(201);
    expect(a.data.ml).toBe(400);
    await t.api("POST", "/api/water", { ml: 300, date: "2026-11-04" });
    const day = await t.api<{ date: string; ml: number; target: number; logs: WaterLog[] }>("GET", "/api/water?date=2026-11-04");
    expect(day.data.ml).toBe(700);
    expect(day.data.target).toBe(2500);
    expect(day.data.logs).toHaveLength(2);
    await t.api("DELETE", `/api/water/${a.data.id}`);
    const after = await t.api<{ ml: number }>("GET", "/api/water?date=2026-11-04");
    expect(after.data.ml).toBe(300);
    expect((await t.api("POST", "/api/water", { ml: 0 }, { allowError: true })).status).toBe(400);
    expect((await t.api("POST", "/api/water", { ml: 6000 }, { allowError: true })).status).toBe(400);
    expect((await t.api("DELETE", `/api/water/${a.data.id}`, undefined, { allowError: true })).status).toBe(404);
  });
});

describe("weight", () => {
  it("upserts one log per date and reports the EMA trend", async () => {
    await t.api("POST", "/api/weight", { date: "2026-10-01", weightKg: 82 });
    await t.api("POST", "/api/weight", { date: "2026-10-05", weightKg: 81 });
    const first = await t.api<WeightLog>("POST", "/api/weight", { date: "2026-10-08", weightKg: 81.5 });
    const replaced = await t.api<WeightLog>("POST", "/api/weight", { date: "2026-10-08", weightKg: 80.5, note: "morning" });
    expect(replaced.data.id).toBe(first.data.id);
    expect(replaced.data.weightKg).toBe(80.5);
    expect(replaced.data.note).toBe("morning");
    const r = await t.api<WeightSummary>("GET", "/api/weight?limit=90");
    const dates = r.data.logs.map((l) => l.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(r.data.logs.filter((l) => l.date === "2026-10-08")).toHaveLength(1);
    expect(r.data.trend.map((p) => p.date)).toEqual([...r.data.trend.map((p) => p.date)].sort());
    expect(r.data.trend[0]).toMatchObject({ date: "2026-10-01", weightKg: 82, emaKg: 82 });
    expect(r.data.trend[1]?.emaKg).toBe(81.9);
    const expected = weightTrend(r.data.logs);
    expect(r.data.change7d).toBe(trendChange(expected, 7));
    expect(r.data.change30d).toBe(trendChange(expected, 30));
    expect(r.data.latest?.date).toBe(dates[0]);
    const limited = await t.api<WeightSummary>("GET", "/api/weight?limit=2");
    expect(limited.data.logs).toHaveLength(2);
    expect(limited.data.trend).toHaveLength(2);
    await t.api("DELETE", `/api/weight/${first.data.id}`);
    const after = await t.api<WeightSummary>("GET", "/api/weight");
    expect(after.data.logs.some((l) => l.id === first.data.id)).toBe(false);
    expect((await t.api("POST", "/api/weight", { weightKg: -1 }, { allowError: true })).status).toBe(400);
  });
});

describe("targets", () => {
  it("suggests targets from the profile and latest weight, then applies them", async () => {
    const profilePatch = { sex: "male", birthDate: "1996-06-15", heightCm: 178, activityLevel: "moderate", goal: "lose", paceKgPerWeek: 0.5, targetWeightKg: 70 };
    const profile = await t.api<HealthProfile>("PATCH", "/api/settings/health-profile", profilePatch);
    await t.api("POST", "/api/weight", { date: "2026-12-01", weightKg: 80 });
    const expected = suggestTargets(profile.data, 80);
    const r = await t.api<{ suggestion: typeof expected; inputs: { weightKg: number; weightDate: string; ageYears: number }; current: HealthProfile["targets"] }>("GET", "/api/health/suggest-targets");
    expect(r.data.suggestion).toEqual(expected);
    expect(r.data.suggestion.proteinG).toBe(160);
    expect(r.data.suggestion.waterMl).toBe(2500);
    expect(r.data.inputs.weightKg).toBe(80);
    expect(r.data.inputs.weightDate).toBe("2026-12-01");
    expect(r.data.inputs.ageYears).toBeGreaterThanOrEqual(30);
    expect(r.data.current.calories).toBe(2400);
    const applied = await t.api<HealthProfile>("POST", "/api/health/apply-suggested-targets");
    expect(applied.data.targets.calories).toBe(expected.calories);
    expect(applied.data.targets.proteinG).toBe(160);
    expect(applied.data.targets.workoutsPerWeek).toBe(4);
    const settings = await t.api<{ healthProfile: HealthProfile }>("GET", "/api/settings");
    expect(settings.data.healthProfile.targets.calories).toBe(expected.calories);
    const day = await t.api<DaySummary>("GET", "/api/nutrition/day?date=2026-11-03");
    expect(day.data.targets.calories).toBe(expected.calories);
  });
});
