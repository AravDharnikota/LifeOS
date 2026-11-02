import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { EMPTY_NUTRIENTS, Nutrients, type Food } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { HttpError, badRequest, notFound } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { parseJson } from "../lib/json.ts";
import { logActivity } from "./activity.ts";

export const FoodServing = z.object({ label: z.string().trim().min(1).max(80), grams: z.number().positive().max(5000) });
export const FoodCreate = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).nullable().optional(),
  per100: Nutrients,
  servings: z.array(FoodServing).max(12).optional(),
  barcode: z.string().regex(/^\d{8,14}$/, "Barcode must be 8 to 14 digits").nullable().optional(),
});
export type FoodCreate = z.infer<typeof FoodCreate>;

type Row = typeof schema.foods.$inferSelect;

export function serializeFood(row: Row): Food {
  return { ...row, per100: parseJson<Nutrients>(row.per100, EMPTY_NUTRIENTS), servings: parseJson<Food["servings"]>(row.servings, []) };
}

export function findFood(db: Db, id: string): Food | null {
  const row = db.select().from(schema.foods).where(eq(schema.foods.id, id)).get();
  return row ? serializeFood(row) : null;
}

export function getFood(db: Db, id: string): Food {
  const food = findFood(db, id);
  if (!food) throw notFound("Food");
  return food;
}

export function createFood(db: Db, input: FoodCreate, actor = "user", source = "custom"): Food {
  const id = newId();
  db.insert(schema.foods)
    .values({ id, name: input.name, brand: input.brand ?? null, source, barcode: input.barcode ?? null, per100: JSON.stringify(input.per100), servings: JSON.stringify(input.servings ?? []) })
    .run();
  logActivity(db, { actor, action: "created", entity: "food", entityId: id, summary: `Added food "${input.name}"` });
  return getFood(db, id);
}

// ---------- search ----------
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
const tokenize = (s: string) => normalize(s).split(" ").filter(Boolean);

interface SearchRow {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  rowid: number;
}

/** Rank: exact name > name starts with the query > every token starts a word > every token appears somewhere. */
function scoreRow(row: SearchRow, query: string, tokens: string[]): number {
  const name = normalize(row.name);
  const text = row.brand ? `${name} ${normalize(row.brand)}` : name;
  const words = text.split(" ");
  let wordStarts = 0;
  for (const t of tokens) {
    if (words.some((w) => w.startsWith(t))) wordStarts++;
    else if (!text.includes(t)) return 0;
  }
  let score = 1;
  if (name === query) score = 400;
  else if (name.startsWith(query)) score = 300;
  else if (wordStarts === tokens.length) score = 200;
  else if (wordStarts > 0) score = 100;
  if (row.source === "custom") score += 10;
  return score - Math.min(40, name.length / 4);
}

export function searchFoods(db: Db, q: string, limit = 25): Food[] {
  const query = normalize(q);
  const tokens = tokenize(q);
  if (!tokens.length) return [];
  const rows: SearchRow[] = db.select({ id: schema.foods.id, name: schema.foods.name, brand: schema.foods.brand, source: schema.foods.source, rowid: sql<number>`rowid` }).from(schema.foods).all();
  const ranked = rows
    .map((row) => ({ row, score: scoreRow(row, query, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.row.rowid - b.row.rowid)
    .slice(0, limit);
  if (!ranked.length) return [];
  const full = db
    .select()
    .from(schema.foods)
    .where(
      inArray(
        schema.foods.id,
        ranked.map((r) => r.row.id),
      ),
    )
    .all();
  const byId = new Map(full.map((r) => [r.id, serializeFood(r)]));
  return ranked.map((r) => byId.get(r.row.id)).filter((f): f is Food => Boolean(f));
}

// ---------- barcodes (Open Food Facts v2) ----------
export type BarcodeFetch = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: BarcodeFetch = (url, init) => fetch(url, init);
let barcodeFetch: BarcodeFetch = defaultFetch;
/** Tests inject a fake fetch; pass null to restore the real one. */
export function setBarcodeFetch(fn: BarcodeFetch | null): void {
  barcodeFetch = fn ?? defaultFetch;
}

const OFF_USER_AGENT = "AravOS/0.1 (personal life OS; github.com/aravos)";
const OFF_FIELDS = "code,product_name,product_name_en,brands,quantity,serving_size,serving_quantity,nutriments";
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
/** OFF allows 15 product reads per minute per IP; stay under it. */
const OFF_MAX_PER_MINUTE = 14;
const negativeCache = new Map<string, number>();
const recentCalls: number[] = [];

interface OffNutriments {
  [key: string]: unknown;
}
interface OffProduct {
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  quantity?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: OffNutriments;
}
interface OffResponse {
  status?: number;
  status_verbose?: string;
  product?: OffProduct;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
const toMg = (grams: number | null) => (grams == null ? null : Math.round(grams * 1000));

/** Map an OFF product to our Food shape. Returns null when it has no usable energy value. */
export function mapOffProduct(code: string, p: OffProduct): FoodCreate | null {
  const n = p.nutriments ?? {};
  const kj = num(n["energy_100g"]);
  const kcal = num(n["energy-kcal_100g"]) ?? (kj == null ? null : kj / 4.184);
  if (kcal == null) return null;
  const sodiumG = num(n["sodium_100g"]);
  const saltG = num(n["salt_100g"]);
  const per100: Nutrients = {
    calories: Math.round(kcal),
    proteinG: round1(num(n["proteins_100g"])) ?? 0,
    carbsG: round1(num(n["carbohydrates_100g"])) ?? 0,
    fatG: round1(num(n["fat_100g"])) ?? 0,
    fiberG: round1(num(n["fiber_100g"])),
    sugarG: round1(num(n["sugars_100g"])),
    sodiumMg: sodiumG != null ? toMg(sodiumG) : saltG != null ? toMg(saltG / 2.5) : null,
    saturatedFatG: round1(num(n["saturated-fat_100g"])),
    cholesterolMg: toMg(num(n["cholesterol_100g"])),
    potassiumMg: toMg(num(n["potassium_100g"])),
  };
  const servingGrams = num(p.serving_quantity);
  const servings = servingGrams && servingGrams > 0 ? [{ label: p.serving_size?.trim() || "1 serving", grams: Math.round(servingGrams * 10) / 10 }] : [];
  const name = (p.product_name_en || p.product_name || "").trim() || `Product ${code}`;
  const brand = p.brands?.split(",")[0]?.trim() || null;
  return { name: name.slice(0, 200), brand: brand ? brand.slice(0, 120) : null, per100, servings, barcode: code };
}

function noteNotFound(code: string): never {
  negativeCache.set(code, Date.now() + NEGATIVE_TTL_MS);
  throw new HttpError(404, "Product not found in Open Food Facts. Add it as a custom food instead.");
}

function takeRateLimitSlot(): void {
  const now = Date.now();
  while (recentCalls.length && recentCalls[0]! < now - 60_000) recentCalls.shift();
  if (recentCalls.length >= OFF_MAX_PER_MINUTE) throw new HttpError(429, "Too many barcode lookups this minute. Try again shortly.");
  recentCalls.push(now);
}

/** Look a barcode up: cached foods first, then Open Food Facts (result cached into foods with source "off"). */
export async function lookupBarcode(db: Db, code: string, actor = "user"): Promise<Food> {
  if (!/^\d{8,14}$/.test(code)) throw badRequest("Barcode must be 8 to 14 digits.");
  const cached = db.select().from(schema.foods).where(eq(schema.foods.barcode, code)).get();
  if (cached) return serializeFood(cached);
  const negative = negativeCache.get(code);
  if (negative && negative > Date.now()) throw new HttpError(404, "Product not found in Open Food Facts. Add it as a custom food instead.");
  takeRateLimitSlot();
  let res: Response;
  try {
    res = await barcodeFetch(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=${OFF_FIELDS}`, { headers: { "User-Agent": OFF_USER_AGENT, Accept: "application/json" } });
  } catch {
    throw new HttpError(502, "Open Food Facts is unreachable. Check the server's network access.");
  }
  if (res.status === 404) noteNotFound(code);
  if (res.status === 429 || res.status === 503) throw new HttpError(503, "Open Food Facts is busy or rate limiting. Try again in a minute.");
  if (!res.ok) throw new HttpError(502, `Open Food Facts returned HTTP ${res.status}.`);
  const body = (await res.json()) as OffResponse;
  if (body.status !== 1 || !body.product) noteNotFound(code);
  const mapped = mapOffProduct(code, body.product);
  if (!mapped) throw new HttpError(404, "Open Food Facts has this product but no nutrition values for it.");
  return createFood(db, mapped, actor, "off");
}
