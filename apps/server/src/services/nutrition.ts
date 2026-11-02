import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import {
  EMPTY_NUTRIENTS,
  FoodAnalysis,
  HealthProfile,
  MealCreate,
  MealItemInput,
  MealType,
  WeightLogCreate,
  addDaysString,
  ageFromBirthDate,
  daysBetween,
  isoDate,
  mealHealthScore,
  scaleNutrients,
  suggestTargets,
  sumNutrients,
  todayString,
  trendChange,
  weightTrend,
  type Food,
  type Meal,
  type MealItem,
  type Nutrients,
  type TargetSuggestion,
  type TrendPoint,
  type WaterLog,
  type WeightLog,
} from "@aravos/shared";
import type { AppContext } from "../app.ts";
import { AiDisabledError, type FoodAnalysisRequest } from "../ai/provider.ts";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { HttpError, badRequest, notFound } from "../lib/errors.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { readUploadBase64, saveUpload } from "../lib/uploads.ts";
import { logActivity } from "./activity.ts";
import { findFood } from "./foods.ts";
import { getHealthProfile, setSetting } from "./settings.ts";

// ---------- input schemas ----------
export const MealSource = z.enum(["photo", "manual", "search", "barcode", "text"]);
export type MealSource = z.infer<typeof MealSource>;
/** Like MealItemInput, but calories (and name) may be omitted when a foodId plus grams or a serving is given. */
export const MealItemInputLoose = MealItemInput.extend({ name: z.string().trim().min(1).max(200).optional(), calories: z.number().min(0).optional() });
export type MealItemInputLoose = z.infer<typeof MealItemInputLoose>;
export const MealItemPatch = MealItemInputLoose.partial();
export type MealItemPatch = z.infer<typeof MealItemPatch>;
export const MealCreateInput = MealCreate.extend({ source: MealSource.optional(), photoPath: z.string().max(300).nullable().optional(), items: z.array(MealItemInputLoose).max(60).optional() });
export type MealCreateInput = z.infer<typeof MealCreateInput>;
export const MealUpdateInput = MealCreateInput.partial();
export type MealUpdateInput = z.infer<typeof MealUpdateInput>;
export const WaterCreate = z.object({ ml: z.number().int().min(1).max(5000), date: isoDate.optional() });
export type WaterCreate = z.infer<typeof WaterCreate>;
export const AnalysisCorrection = z.object({ analysis: FoodAnalysis, note: z.string().trim().min(1).max(2000), imagePath: z.string().max(300).optional() });
export type AnalysisCorrection = z.infer<typeof AnalysisCorrection>;
export const MealFromAnalysis = z.object({ analysis: FoodAnalysis, date: isoDate.optional(), mealType: MealType.optional(), imagePath: z.string().max(300).nullable().optional(), name: z.string().trim().min(1).max(200).optional() });
export type MealFromAnalysis = z.infer<typeof MealFromAnalysis>;

// ---------- AI guard ----------
export const AI_DISABLED_MESSAGE = "AI features are disabled. Set ANTHROPIC_API_KEY on the server to enable them.";

export function assertAiEnabled(ctx: AppContext): void {
  if (!ctx.ai.enabled) throw new HttpError(503, AI_DISABLED_MESSAGE);
}

/** Runs an AI call and maps a disabled provider to HTTP 503. */
export async function withAi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AiDisabledError) throw new HttpError(503, err.message);
    throw err;
  }
}

// ---------- meals ----------
type MealRow = typeof schema.meals.$inferSelect;
type ItemRow = typeof schema.mealItems.$inferSelect;

const GRAMS_PER_OZ = 28.35;
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Breakfast before 10:30, lunch before 15:00, dinner before 21:00, otherwise snack. */
export function mealTypeForTime(hhmm: string): MealType {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const minutes = h * 60 + m;
  if (minutes < 10 * 60 + 30) return "breakfast";
  if (minutes < 15 * 60) return "lunch";
  if (minutes < 21 * 60) return "dinner";
  return "snack";
}

function gramsFromServing(food: Food, quantity: number, unit: string): number | null {
  const u = unit.trim().toLowerCase();
  if (u === "g" || u === "gram" || u === "grams") return quantity;
  if (u === "oz") return round1(quantity * GRAMS_PER_OZ);
  const match = food.servings.find((s) => s.label.toLowerCase() === u);
  if (match) return round1(quantity * match.grams);
  if (u === "serving" && food.servings[0]) return round1(quantity * food.servings[0].grams);
  return null;
}

type ItemNutrients = Pick<ItemRow, "calories" | "proteinG" | "carbsG" | "fatG" | "fiberG" | "sugarG" | "sodiumMg" | "saturatedFatG" | "cholesterolMg" | "potassiumMg">;

function fillNutrients(n: Partial<Nutrients>, calories: number): ItemNutrients {
  return {
    calories,
    proteinG: n.proteinG ?? 0,
    carbsG: n.carbsG ?? 0,
    fatG: n.fatG ?? 0,
    fiberG: n.fiberG ?? null,
    sugarG: n.sugarG ?? null,
    sodiumMg: n.sodiumMg ?? null,
    saturatedFatG: n.saturatedFatG ?? null,
    cholesterolMg: n.cholesterolMg ?? null,
    potassiumMg: n.potassiumMg ?? null,
  };
}

/** Turn an item input into a row. Nutrients come from the food (per 100 g scaled to grams) when calories are not supplied. */
function resolveItem(db: Db, input: MealItemInputLoose, mealId: string, sortOrder: number, id = newId()): ItemRow {
  const food = input.foodId ? findFood(db, input.foodId) : null;
  if (input.foodId && !food) throw badRequest(`Food ${input.foodId} not found.`);
  const name = input.name ?? food?.name;
  if (!name) throw badRequest("Each item needs a name or a foodId.");
  const quantity = input.quantity ?? 1;
  const unit = input.unit ?? "serving";
  let grams = input.grams ?? null;
  if (grams == null && food) grams = gramsFromServing(food, quantity, unit);
  let nutrients: ItemNutrients;
  if (input.calories == null) {
    if (!food || grams == null) throw badRequest(`Item "${name}" needs calories, or a foodId with grams or a known serving.`);
    const scaled = scaleNutrients(food.per100, grams);
    nutrients = fillNutrients(scaled, scaled.calories);
  } else {
    nutrients = fillNutrients(input, input.calories);
  }
  return { id, mealId, foodId: input.foodId ?? null, name, quantity, unit, grams, ...nutrients, confidence: input.confidence ?? null, sortOrder };
}

function itemsByMeal(db: Db, mealIds: string[]): Map<string, MealItem[]> {
  const map = new Map<string, MealItem[]>();
  if (!mealIds.length) return map;
  const rows = db.select().from(schema.mealItems).where(inArray(schema.mealItems.mealId, mealIds)).orderBy(asc(schema.mealItems.sortOrder)).all();
  for (const r of rows) {
    const list = map.get(r.mealId) ?? [];
    list.push(r);
    map.set(r.mealId, list);
  }
  return map;
}

export function serializeMeal(row: MealRow, items: MealItem[]): Meal {
  return { ...row, mealType: row.mealType as MealType, items, totals: sumNutrients(items) };
}

function mealRow(db: Db, id: string): MealRow {
  const row = db.select().from(schema.meals).where(and(eq(schema.meals.id, id), isNull(schema.meals.deletedAt))).get();
  if (!row) throw notFound("Meal");
  return row;
}

export function getMeal(db: Db, id: string): Meal {
  const row = mealRow(db, id);
  return serializeMeal(row, itemsByMeal(db, [id]).get(id) ?? []);
}

export function listMeals(db: Db, date: string): Meal[] {
  const rows = db.select().from(schema.meals).where(and(eq(schema.meals.date, date), isNull(schema.meals.deletedAt))).orderBy(asc(schema.meals.loggedAt)).all();
  const items = itemsByMeal(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => serializeMeal(r, items.get(r.id) ?? []));
}

export function createMeal(db: Db, input: MealCreateInput, actor = "user"): Meal {
  const id = newId();
  const loggedAt = input.loggedAt ?? nowIso();
  const date = input.date ?? todayString();
  const items = (input.items ?? []).map((it, i) => resolveItem(db, it, id, i));
  const healthScore = input.healthScore !== undefined ? input.healthScore : (mealHealthScore(sumNutrients(items))?.score ?? null);
  const mealType = input.mealType ?? mealTypeForTime(format(new Date(loggedAt), "HH:mm"));
  db.transaction((tx) => {
    tx.insert(schema.meals)
      .values({ id, date, mealType, name: input.name ?? null, loggedAt, photoPath: input.photoPath ?? null, source: input.source ?? "manual", aiNotes: input.aiNotes ?? null, healthScore })
      .run();
    if (items.length) tx.insert(schema.mealItems).values(items).run();
  });
  const meal = getMeal(db, id);
  logActivity(db, { actor, action: "logged", entity: "meal", entityId: id, summary: `Logged ${meal.name ?? mealType}: ${meal.totals?.calories ?? 0} kcal` });
  return meal;
}

export function updateMeal(db: Db, id: string, input: MealUpdateInput, actor = "user"): Meal {
  const row = mealRow(db, id);
  const { items, ...fields } = input;
  const set: Partial<MealRow> = { updatedAt: nowIso() };
  if (fields.date !== undefined) set.date = fields.date;
  if (fields.mealType !== undefined) set.mealType = fields.mealType;
  if (fields.name !== undefined) set.name = fields.name;
  if (fields.loggedAt !== undefined) set.loggedAt = fields.loggedAt;
  if (fields.photoPath !== undefined) set.photoPath = fields.photoPath;
  if (fields.source !== undefined) set.source = fields.source;
  if (fields.aiNotes !== undefined) set.aiNotes = fields.aiNotes;
  if (fields.healthScore !== undefined) set.healthScore = fields.healthScore;
  const rows = items ? items.map((it, i) => resolveItem(db, it, id, i)) : null;
  if (rows && fields.healthScore === undefined && !["photo", "text"].includes(row.source)) set.healthScore = mealHealthScore(sumNutrients(rows))?.score ?? null;
  db.transaction((tx) => {
    tx.update(schema.meals).set(set).where(eq(schema.meals.id, id)).run();
    if (rows) {
      tx.delete(schema.mealItems).where(eq(schema.mealItems.mealId, id)).run();
      if (rows.length) tx.insert(schema.mealItems).values(rows).run();
    }
  });
  logActivity(db, { actor, action: "updated", entity: "meal", entityId: id, summary: `Updated meal ${row.name ?? row.mealType}` });
  return getMeal(db, id);
}

export function deleteMeal(db: Db, id: string, actor = "user"): void {
  const row = mealRow(db, id);
  db.update(schema.meals).set({ deletedAt: nowIso(), updatedAt: nowIso() }).where(eq(schema.meals.id, id)).run();
  logActivity(db, { actor, action: "deleted", entity: "meal", entityId: id, summary: `Deleted meal ${row.name ?? row.mealType}` });
}

export function addMealItem(db: Db, mealId: string, input: MealItemInputLoose, actor = "user"): Meal {
  mealRow(db, mealId);
  const next = (db.select({ n: sql<number>`coalesce(max(${schema.mealItems.sortOrder}), -1)` }).from(schema.mealItems).where(eq(schema.mealItems.mealId, mealId)).get()?.n ?? -1) + 1;
  const row = resolveItem(db, input, mealId, next);
  db.insert(schema.mealItems).values(row).run();
  touchMeal(db, mealId);
  logActivity(db, { actor, action: "updated", entity: "meal", entityId: mealId, summary: `Added ${row.name} to meal` });
  return getMeal(db, mealId);
}

function itemRow(db: Db, itemId: string): ItemRow {
  const row = db.select().from(schema.mealItems).where(eq(schema.mealItems.id, itemId)).get();
  if (!row) throw notFound("Meal item");
  mealRow(db, row.mealId);
  return row;
}

function touchMeal(db: Db, mealId: string): void {
  db.update(schema.meals).set({ updatedAt: nowIso() }).where(eq(schema.meals.id, mealId)).run();
}

export function updateMealItem(db: Db, itemId: string, patch: MealItemPatch, actor = "user"): Meal {
  const existing = itemRow(db, itemId);
  const servingChanged = patch.quantity !== undefined || patch.unit !== undefined;
  const portionChanged = patch.grams !== undefined || patch.foodId !== undefined || servingChanged;
  const foodId = patch.foodId === undefined ? existing.foodId : patch.foodId;
  const recompute = patch.calories === undefined && Boolean(foodId) && portionChanged;
  const merged: MealItemInputLoose = {
    foodId,
    name: patch.name ?? existing.name,
    quantity: patch.quantity ?? existing.quantity,
    unit: patch.unit ?? existing.unit,
    grams: patch.grams === undefined ? existing.grams : patch.grams,
    calories: recompute ? undefined : (patch.calories ?? existing.calories),
    proteinG: patch.proteinG ?? existing.proteinG,
    carbsG: patch.carbsG ?? existing.carbsG,
    fatG: patch.fatG ?? existing.fatG,
    fiberG: patch.fiberG === undefined ? existing.fiberG : patch.fiberG,
    sugarG: patch.sugarG === undefined ? existing.sugarG : patch.sugarG,
    sodiumMg: patch.sodiumMg === undefined ? existing.sodiumMg : patch.sodiumMg,
    saturatedFatG: patch.saturatedFatG === undefined ? existing.saturatedFatG : patch.saturatedFatG,
    cholesterolMg: patch.cholesterolMg === undefined ? existing.cholesterolMg : patch.cholesterolMg,
    potassiumMg: patch.potassiumMg === undefined ? existing.potassiumMg : patch.potassiumMg,
    confidence: patch.confidence === undefined ? existing.confidence : patch.confidence,
  };
  if (recompute && patch.grams === undefined && servingChanged) merged.grams = null;
  const row = resolveItem(db, merged, existing.mealId, existing.sortOrder, existing.id);
  const { id, ...values } = row;
  db.update(schema.mealItems).set(values).where(eq(schema.mealItems.id, id)).run();
  touchMeal(db, existing.mealId);
  logActivity(db, { actor, action: "updated", entity: "meal", entityId: existing.mealId, summary: `Updated ${row.name}` });
  return getMeal(db, existing.mealId);
}

export function deleteMealItem(db: Db, itemId: string, actor = "user"): Meal {
  const existing = itemRow(db, itemId);
  db.delete(schema.mealItems).where(eq(schema.mealItems.id, itemId)).run();
  touchMeal(db, existing.mealId);
  logActivity(db, { actor, action: "updated", entity: "meal", entityId: existing.mealId, summary: `Removed ${existing.name} from meal` });
  return getMeal(db, existing.mealId);
}

// ---------- water ----------
export function waterTotal(db: Db, date: string): number {
  return db.select({ ml: sql<number>`coalesce(sum(${schema.waterLogs.ml}), 0)` }).from(schema.waterLogs).where(eq(schema.waterLogs.date, date)).get()?.ml ?? 0;
}

export function waterDay(db: Db, date: string): { date: string; ml: number; target: number; logs: WaterLog[] } {
  const logs = db.select().from(schema.waterLogs).where(eq(schema.waterLogs.date, date)).orderBy(desc(schema.waterLogs.loggedAt)).all();
  return { date, ml: logs.reduce((s, l) => s + l.ml, 0), target: getHealthProfile(db).targets.waterMl, logs };
}

export function addWater(db: Db, input: WaterCreate, actor = "user"): WaterLog {
  const id = newId();
  const date = input.date ?? todayString();
  db.insert(schema.waterLogs).values({ id, date, ml: input.ml, loggedAt: nowIso() }).run();
  logActivity(db, { actor, action: "logged", entity: "water", entityId: id, summary: `Logged ${input.ml} ml of water (${waterTotal(db, date)} ml today)` });
  return db.select().from(schema.waterLogs).where(eq(schema.waterLogs.id, id)).get()!;
}

export function deleteWater(db: Db, id: string): void {
  const row = db.select().from(schema.waterLogs).where(eq(schema.waterLogs.id, id)).get();
  if (!row) throw notFound("Water log");
  db.delete(schema.waterLogs).where(eq(schema.waterLogs.id, id)).run();
}

// ---------- weight ----------
export interface WeightSummary {
  logs: WeightLog[];
  trend: TrendPoint[];
  latest: WeightLog | null;
  change7d: number | null;
  change30d: number | null;
}

export function latestWeight(db: Db, onOrBefore?: string): WeightLog | null {
  const where = onOrBefore ? lte(schema.weightLogs.date, onOrBefore) : undefined;
  return db.select().from(schema.weightLogs).where(where).orderBy(desc(schema.weightLogs.date), desc(schema.weightLogs.loggedAt)).limit(1).get() ?? null;
}

export function weightOn(db: Db, date: string): WeightLog | null {
  return db.select().from(schema.weightLogs).where(eq(schema.weightLogs.date, date)).orderBy(desc(schema.weightLogs.loggedAt)).limit(1).get() ?? null;
}

export function listWeight(db: Db, limit = 90): WeightSummary {
  const all = db.select().from(schema.weightLogs).orderBy(asc(schema.weightLogs.date), asc(schema.weightLogs.loggedAt)).all();
  const trendAll = weightTrend(all);
  const logs = [...all].reverse().slice(0, limit);
  return { logs, trend: trendAll.slice(-limit), latest: logs[0] ?? null, change7d: trendChange(trendAll, 7), change30d: trendChange(trendAll, 30) };
}

/** One log per date: logging again on the same date replaces it. */
export function upsertWeight(db: Db, input: z.infer<typeof WeightLogCreate>, actor = "user"): WeightLog {
  const date = input.date ?? todayString();
  const existing = weightOn(db, date);
  const loggedAt = nowIso();
  const values = { weightKg: input.weightKg, bodyFatPct: input.bodyFatPct ?? null, note: input.note ?? null, loggedAt };
  const id = existing?.id ?? newId();
  if (existing) db.update(schema.weightLogs).set(values).where(eq(schema.weightLogs.id, id)).run();
  else db.insert(schema.weightLogs).values({ id, date, ...values }).run();
  logActivity(db, { actor, action: existing ? "updated" : "logged", entity: "weight", entityId: id, summary: `Weight ${input.weightKg} kg on ${date}` });
  return db.select().from(schema.weightLogs).where(eq(schema.weightLogs.id, id)).get()!;
}

export function deleteWeight(db: Db, id: string): void {
  const row = db.select().from(schema.weightLogs).where(eq(schema.weightLogs.id, id)).get();
  if (!row) throw notFound("Weight log");
  db.delete(schema.weightLogs).where(eq(schema.weightLogs.id, id)).run();
}

// ---------- targets ----------
export interface SuggestedTargets {
  suggestion: TargetSuggestion;
  inputs: {
    weightKg: number | null;
    weightDate: string | null;
    sex: HealthProfile["sex"];
    birthDate: string | null;
    ageYears: number | null;
    heightCm: number | null;
    activityLevel: HealthProfile["activityLevel"];
    goal: HealthProfile["goal"];
    requestedPaceKgPerWeek: number;
    targetWeightKg: number | null;
  };
  current: HealthProfile["targets"];
}

export function suggestedTargets(db: Db, today = new Date()): SuggestedTargets {
  const profile = getHealthProfile(db);
  const latest = latestWeight(db);
  const weightKg = latest?.weightKg ?? null;
  const suggestion = suggestTargets(profile, weightKg, today);
  return {
    suggestion,
    inputs: {
      weightKg,
      weightDate: latest?.date ?? null,
      sex: profile.sex,
      birthDate: profile.birthDate,
      ageYears: profile.birthDate ? ageFromBirthDate(profile.birthDate, today) : null,
      heightCm: profile.heightCm,
      activityLevel: profile.activityLevel,
      goal: profile.goal,
      requestedPaceKgPerWeek: profile.paceKgPerWeek,
      targetWeightKg: profile.targetWeightKg,
    },
    current: profile.targets,
  };
}

export function applySuggestedTargets(db: Db, actor = "user"): HealthProfile {
  const { suggestion: s } = suggestedTargets(db);
  const profile = getHealthProfile(db);
  const merged = HealthProfile.parse({ ...profile, targets: { ...profile.targets, calories: s.calories, proteinG: s.proteinG, carbsG: s.carbsG, fatG: s.fatG, fiberG: s.fiberG, sugarMaxG: s.sugarMaxG, sodiumMaxMg: s.sodiumMaxMg, waterMl: s.waterMl } });
  setSetting(db, "health_profile", merged);
  logActivity(db, { actor, action: "updated", entity: "health_profile", entityId: null, summary: `Applied suggested targets: ${s.calories} kcal, ${s.proteinG} g protein` });
  return merged;
}

// ---------- day and range summaries ----------
export interface DayMealSummary {
  id: string;
  mealType: MealType;
  name: string | null;
  calories: number;
  items: number;
  photoPath: string | null;
  loggedAt: string;
  healthScore: number | null;
}
export interface DaySummary {
  date: string;
  totals: Nutrients;
  targets: HealthProfile["targets"];
  remaining: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number; sugarG: number; sodiumMg: number; waterMl: number };
  percent: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number; sugarG: number; sodiumMg: number; waterMl: number };
  meals: DayMealSummary[];
  byMealType: Record<MealType, Nutrients>;
  water: { ml: number; target: number };
  weight: WeightLog | null;
  healthScore: number | null;
}

const pct = (value: number, target: number) => (target > 0 ? Math.round((value / target) * 100) : 0);

/** Calorie-weighted mean of meal scores, minus one when over 115 % of the calorie goal, plus one when protein and fiber goals are both met. */
function dayHealthScore(meals: Meal[], totals: Nutrients, targets: HealthProfile["targets"]): number | null {
  const scored = meals.filter((m) => m.healthScore != null && (m.totals?.calories ?? 0) > 0);
  if (!scored.length) return null;
  const weight = scored.reduce((s, m) => s + (m.totals?.calories ?? 0), 0);
  let score = scored.reduce((s, m) => s + (m.healthScore ?? 0) * (m.totals?.calories ?? 0), 0) / weight;
  if (totals.calories > targets.calories * 1.15) score -= 1;
  if (totals.proteinG >= targets.proteinG && (totals.fiberG ?? 0) >= targets.fiberG) score += 1;
  return Math.max(1, Math.min(10, Math.round(score)));
}

export function daySummary(db: Db, date: string): DaySummary {
  const meals = listMeals(db, date);
  const totals = sumNutrients(meals.map((m) => m.totals ?? EMPTY_NUTRIENTS));
  const targets = getHealthProfile(db).targets;
  const waterMl = waterTotal(db, date);
  const byMealType: Record<MealType, Nutrients> = { breakfast: { ...EMPTY_NUTRIENTS }, lunch: { ...EMPTY_NUTRIENTS }, dinner: { ...EMPTY_NUTRIENTS }, snack: { ...EMPTY_NUTRIENTS } };
  for (const type of MealType.options) byMealType[type] = sumNutrients(meals.filter((m) => m.mealType === type).map((m) => m.totals ?? EMPTY_NUTRIENTS));
  const sugar = totals.sugarG ?? 0;
  const sodium = totals.sodiumMg ?? 0;
  const fiber = totals.fiberG ?? 0;
  return {
    date,
    totals,
    targets,
    remaining: {
      calories: targets.calories - totals.calories,
      proteinG: round1(targets.proteinG - totals.proteinG),
      carbsG: round1(targets.carbsG - totals.carbsG),
      fatG: round1(targets.fatG - totals.fatG),
      fiberG: round1(targets.fiberG - fiber),
      sugarG: round1(targets.sugarMaxG - sugar),
      sodiumMg: Math.round(targets.sodiumMaxMg - sodium),
      waterMl: targets.waterMl - waterMl,
    },
    percent: {
      calories: pct(totals.calories, targets.calories),
      proteinG: pct(totals.proteinG, targets.proteinG),
      carbsG: pct(totals.carbsG, targets.carbsG),
      fatG: pct(totals.fatG, targets.fatG),
      fiberG: pct(fiber, targets.fiberG),
      sugarG: pct(sugar, targets.sugarMaxG),
      sodiumMg: pct(sodium, targets.sodiumMaxMg),
      waterMl: pct(waterMl, targets.waterMl),
    },
    meals: meals.map((m) => ({ id: m.id, mealType: m.mealType, name: m.name, calories: m.totals?.calories ?? 0, items: m.items?.length ?? 0, photoPath: m.photoPath, loggedAt: m.loggedAt, healthScore: m.healthScore })),
    byMealType,
    water: { ml: waterMl, target: targets.waterMl },
    weight: latestWeight(db, date),
    healthScore: dayHealthScore(meals, totals, targets),
  };
}

export interface RangeRow {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterMl: number;
  meals: number;
}

export const MAX_RANGE_DAYS = 400;

export function rangeSummary(db: Db, from: string, to: string): RangeRow[] {
  if (from > to) throw badRequest("`from` must not be after `to`.");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw badRequest(`Range is too large. The limit is ${MAX_RANGE_DAYS} days.`);
  const meals = db
    .select({
      date: schema.meals.date,
      calories: sql<number>`coalesce(sum(${schema.mealItems.calories}), 0)`,
      proteinG: sql<number>`coalesce(sum(${schema.mealItems.proteinG}), 0)`,
      carbsG: sql<number>`coalesce(sum(${schema.mealItems.carbsG}), 0)`,
      fatG: sql<number>`coalesce(sum(${schema.mealItems.fatG}), 0)`,
      meals: sql<number>`count(distinct ${schema.meals.id})`,
    })
    .from(schema.meals)
    .leftJoin(schema.mealItems, eq(schema.mealItems.mealId, schema.meals.id))
    .where(and(isNull(schema.meals.deletedAt), gte(schema.meals.date, from), lte(schema.meals.date, to)))
    .groupBy(schema.meals.date)
    .all();
  const water = db
    .select({ date: schema.waterLogs.date, ml: sql<number>`coalesce(sum(${schema.waterLogs.ml}), 0)` })
    .from(schema.waterLogs)
    .where(and(gte(schema.waterLogs.date, from), lte(schema.waterLogs.date, to)))
    .groupBy(schema.waterLogs.date)
    .all();
  const byDate = new Map(meals.map((m) => [m.date, m]));
  const waterByDate = new Map(water.map((w) => [w.date, w.ml]));
  const out: RangeRow[] = [];
  for (let d = from; d <= to; d = addDaysString(d, 1)) {
    const m = byDate.get(d);
    out.push({ date: d, calories: Math.round(m?.calories ?? 0), proteinG: round1(m?.proteinG ?? 0), carbsG: round1(m?.carbsG ?? 0), fatG: round1(m?.fatG ?? 0), waterMl: waterByDate.get(d) ?? 0, meals: m?.meals ?? 0 });
  }
  return out;
}

// ---------- AI analysis ----------
export interface AnalyzeInput {
  image?: Blob | null;
  text?: string | null;
  mealType?: MealType;
}
export interface AnalysisResult {
  analysisId: string;
  imagePath: string | null;
  analysis: FoodAnalysis;
  localTime: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Drop empty items, clamp confidences, recompute totals and apply the user's meal type. */
export function normalizeAnalysis(raw: FoodAnalysis, mealType?: MealType): FoodAnalysis {
  const items = raw.items
    .filter((it) => it.grams > 0 && it.calories >= 0)
    .map((it) => ({ ...it, grams: round1(it.grams), calories: Math.round(it.calories), proteinG: round1(it.proteinG), carbsG: round1(it.carbsG), fatG: round1(it.fatG), confidence: clamp(it.confidence, 0, 1) }));
  const sum = sumNutrients(items);
  return FoodAnalysis.parse({
    ...raw,
    items,
    totals: { calories: sum.calories, proteinG: sum.proteinG, carbsG: sum.carbsG, fatG: sum.fatG },
    healthScore: clamp(Math.round(raw.healthScore), 0, 10),
    mealType: mealType ?? raw.mealType,
    notes: raw.notes.trim(),
  });
}

export async function analyzeMeal(ctx: AppContext, input: AnalyzeInput, actor = "user"): Promise<AnalysisResult> {
  const text = input.text?.trim() || null;
  if (!input.image && !text) throw badRequest("Provide a photo or a text description of the meal.");
  assertAiEnabled(ctx);
  const saved = input.image ? await saveUpload(ctx.env, "meals", input.image) : null;
  const localTime = format(new Date(), "HH:mm");
  const req: FoodAnalysisRequest = { localTime };
  if (saved) req.image = readUploadBase64(ctx.env, saved.path);
  if (text) req.text = text;
  const analysis = normalizeAnalysis(await withAi(() => ctx.ai.analyzeFood(req)), input.mealType);
  logActivity(ctx.db, { actor, action: "analyzed", entity: "meal", entityId: null, summary: `Analyzed ${analysis.mealName}: ${analysis.totals.calories} kcal` });
  return { analysisId: saved?.id ?? newId(), imagePath: saved?.path ?? null, analysis, localTime };
}

export async function correctAnalysis(ctx: AppContext, input: AnalysisCorrection): Promise<{ analysis: FoodAnalysis }> {
  assertAiEnabled(ctx);
  const req: FoodAnalysisRequest = { localTime: format(new Date(), "HH:mm"), correction: { previous: input.analysis, note: input.note } };
  if (input.imagePath) req.image = readUploadBase64(ctx.env, input.imagePath);
  return { analysis: normalizeAnalysis(await withAi(() => ctx.ai.analyzeFood(req))) };
}

export function mealFromAnalysis(db: Db, input: MealFromAnalysis, actor = "user"): Meal {
  const a = input.analysis;
  const items: MealItemInputLoose[] = a.items.map((it) => ({
    name: it.name,
    quantity: 1,
    unit: "serving",
    grams: it.grams,
    calories: it.calories,
    proteinG: it.proteinG,
    carbsG: it.carbsG,
    fatG: it.fatG,
    fiberG: it.fiberG,
    sugarG: it.sugarG,
    sodiumMg: it.sodiumMg,
    saturatedFatG: it.saturatedFatG,
    confidence: it.confidence,
  }));
  return createMeal(
    db,
    { date: input.date, mealType: input.mealType ?? a.mealType, name: input.name ?? a.mealName, photoPath: input.imagePath ?? null, source: input.imagePath ? "photo" : "text", aiNotes: a.notes || null, healthScore: a.healthScore, items },
    actor,
  );
}
