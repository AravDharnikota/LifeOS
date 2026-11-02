import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { count, sql } from "drizzle-orm";
import type { Nutrients } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";

export interface BundledFood {
  id: string;
  name: string;
  brand: string | null;
  per100: Nutrients;
  servings: { label: string; grams: number }[];
}

let cache: BundledFood[] | null = null;

export function findFoodsFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../data/foods.json"), path.resolve(process.cwd(), "src/data/foods.json"), path.resolve(process.cwd(), "apps/server/src/data/foods.json")];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("Could not locate foods.json. Looked in: " + candidates.join(", "));
}

/** The bundled USDA-derived food list (see docs/nutrition.md for provenance). */
export function loadBundledFoods(): BundledFood[] {
  if (cache) return cache;
  cache = JSON.parse(fs.readFileSync(findFoodsFile(), "utf8")) as BundledFood[];
  return cache;
}

/** Idempotent: loads the bundled foods once, in a single transaction with a prepared insert. Returns the number of rows inserted. */
export function seedFoods(db: Db): number {
  const existing = db.select({ n: count() }).from(schema.foods).get()?.n ?? 0;
  if (existing > 0) return 0;
  const foods = loadBundledFoods();
  const createdAt = new Date().toISOString();
  const insert = db
    .insert(schema.foods)
    .values({ id: sql.placeholder("id"), name: sql.placeholder("name"), brand: sql.placeholder("brand"), source: "bundled", barcode: null, per100: sql.placeholder("per100"), servings: sql.placeholder("servings"), createdAt })
    .prepare();
  db.transaction(() => {
    for (const f of foods) insert.run({ id: f.id, name: f.name, brand: f.brand, per100: JSON.stringify(f.per100), servings: JSON.stringify(f.servings) });
  });
  return foods.length;
}
