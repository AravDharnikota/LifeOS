import type { Context } from "hono";
import { z } from "zod";
import { MealType, WeightLogCreate, isoDate, todayString } from "@aravos/shared";
import type { App } from "../app.ts";
import { badRequest } from "../lib/errors.ts";
import { parseBody, parseQuery } from "../lib/http.ts";
import { FoodCreate, createFood, getFood, lookupBarcode, searchFoods } from "../services/foods.ts";
import {
  AnalysisCorrection,
  MealCreateInput,
  MealFromAnalysis,
  MealItemInputLoose,
  MealItemPatch,
  MealUpdateInput,
  WaterCreate,
  addMealItem,
  addWater,
  analyzeMeal,
  applySuggestedTargets,
  correctAnalysis,
  createMeal,
  daySummary,
  deleteMeal,
  deleteMealItem,
  deleteWater,
  deleteWeight,
  getMeal,
  listMeals,
  listWeight,
  mealFromAnalysis,
  rangeSummary,
  suggestedTargets,
  updateMeal,
  updateMealItem,
  upsertWeight,
  waterDay,
} from "../services/nutrition.ts";

const DateQuery = z.object({ date: isoDate.optional() });
const RangeQuery = z.object({ from: isoDate, to: isoDate });
const FoodsQuery = z.object({ q: z.string().max(120).optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
const WeightQuery = z.object({ limit: z.coerce.number().int().min(1).max(1000).optional() });
const AnalyzeFields = z.object({ text: z.string().trim().max(2000).optional(), mealType: MealType.optional(), date: isoDate.optional() });

export interface Multipart {
  fields: Record<string, string>;
  files: Record<string, File>;
}

/** Split a multipart body into string fields (blank strings dropped) and files. */
export async function readMultipart(c: Context): Promise<Multipart> {
  const type = (c.req.header("content-type") ?? "").toLowerCase();
  if (!type.startsWith("multipart/form-data")) throw badRequest("Expected a multipart/form-data body.");
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    throw badRequest("Could not parse the multipart body.");
  }
  const fields: Record<string, string> = {};
  const files: Record<string, File> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value instanceof File) files[key] = value;
    else if (typeof value === "string" && value.trim() !== "") fields[key] = value;
  }
  return { fields, files };
}

export function nutritionRoutes(app: App): void {
  // ----- foods -----
  app.get("/api/foods", (c) => {
    const { db } = c.get("ctx");
    const q = parseQuery(c, FoodsQuery);
    return c.json(searchFoods(db, q.q ?? "", q.limit ?? 25));
  });
  app.post("/api/foods", async (c) => c.json(createFood(c.get("ctx").db, await parseBody(c, FoodCreate), c.get("actor")), 201));
  app.get("/api/foods/barcode/:code", async (c) => c.json(await lookupBarcode(c.get("ctx").db, c.req.param("code"), c.get("actor"))));
  app.get("/api/foods/:id", (c) => c.json(getFood(c.get("ctx").db, c.req.param("id"))));

  // ----- meals -----
  app.get("/api/meals", (c) => {
    const { db } = c.get("ctx");
    const date = parseQuery(c, DateQuery).date ?? todayString();
    const summary = daySummary(db, date);
    return c.json({ date, meals: listMeals(db, date), totals: summary.totals, targets: summary.targets, remaining: summary.remaining });
  });
  app.post("/api/meals", async (c) => c.json(createMeal(c.get("ctx").db, await parseBody(c, MealCreateInput), c.get("actor")), 201));
  app.post("/api/meals/from-analysis", async (c) => c.json(mealFromAnalysis(c.get("ctx").db, await parseBody(c, MealFromAnalysis), c.get("actor")), 201));
  app.get("/api/meals/:id", (c) => c.json(getMeal(c.get("ctx").db, c.req.param("id"))));
  app.patch("/api/meals/:id", async (c) => c.json(updateMeal(c.get("ctx").db, c.req.param("id"), await parseBody(c, MealUpdateInput), c.get("actor"))));
  app.delete("/api/meals/:id", (c) => {
    deleteMeal(c.get("ctx").db, c.req.param("id"), c.get("actor"));
    return c.json({ ok: true });
  });
  app.post("/api/meals/:id/items", async (c) => c.json(addMealItem(c.get("ctx").db, c.req.param("id"), await parseBody(c, MealItemInputLoose), c.get("actor")), 201));
  app.patch("/api/meal-items/:id", async (c) => c.json(updateMealItem(c.get("ctx").db, c.req.param("id"), await parseBody(c, MealItemPatch), c.get("actor"))));
  app.delete("/api/meal-items/:id", (c) => c.json(deleteMealItem(c.get("ctx").db, c.req.param("id"), c.get("actor"))));

  // ----- AI analysis -----
  app.post("/api/nutrition/analyze", async (c) => {
    const ctx = c.get("ctx");
    const { fields, files } = await readMultipart(c);
    const parsed = AnalyzeFields.safeParse(fields);
    if (!parsed.success) throw badRequest("Validation failed", parsed.error.issues);
    const result = await analyzeMeal(ctx, { image: files.image ?? null, text: parsed.data.text ?? null, mealType: parsed.data.mealType }, c.get("actor"));
    return c.json({ ...result, date: parsed.data.date ?? todayString() });
  });
  app.post("/api/nutrition/analyze/correct", async (c) => c.json(await correctAnalysis(c.get("ctx"), await parseBody(c, AnalysisCorrection))));

  // ----- summaries -----
  app.get("/api/nutrition/day", (c) => c.json(daySummary(c.get("ctx").db, parseQuery(c, DateQuery).date ?? todayString())));
  app.get("/api/nutrition/range", (c) => {
    const q = parseQuery(c, RangeQuery);
    return c.json(rangeSummary(c.get("ctx").db, q.from, q.to));
  });

  // ----- targets -----
  app.get("/api/health/suggest-targets", (c) => c.json(suggestedTargets(c.get("ctx").db)));
  app.post("/api/health/apply-suggested-targets", (c) => c.json(applySuggestedTargets(c.get("ctx").db, c.get("actor"))));

  // ----- water -----
  app.get("/api/water", (c) => c.json(waterDay(c.get("ctx").db, parseQuery(c, DateQuery).date ?? todayString())));
  app.post("/api/water", async (c) => c.json(addWater(c.get("ctx").db, await parseBody(c, WaterCreate), c.get("actor")), 201));
  app.delete("/api/water/:id", (c) => {
    deleteWater(c.get("ctx").db, c.req.param("id"));
    return c.json({ ok: true });
  });

  // ----- weight -----
  app.get("/api/weight", (c) => c.json(listWeight(c.get("ctx").db, parseQuery(c, WeightQuery).limit ?? 90)));
  app.post("/api/weight", async (c) => c.json(upsertWeight(c.get("ctx").db, await parseBody(c, WeightLogCreate), c.get("actor")), 201));
  app.delete("/api/weight/:id", (c) => {
    deleteWeight(c.get("ctx").db, c.req.param("id"));
    return c.json({ ok: true });
  });
}
