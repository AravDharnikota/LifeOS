import { describe, it, expect, afterAll, afterEach } from "vitest";
import { count } from "drizzle-orm";
import type { Food } from "@aravos/shared";
import { makeTestApp } from "./helpers.ts";
import { schema } from "../src/db/client.ts";
import { seedFoods, loadBundledFoods } from "../src/services/seed-foods.ts";
import { mapOffProduct, setBarcodeFetch } from "../src/services/foods.ts";

const t = makeTestApp();
afterAll(() => t.cleanup());
afterEach(() => setBarcodeFetch(null));

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("bundled dataset", () => {
  it("seeds the bundled foods once", () => {
    const bundled = loadBundledFoods();
    expect(bundled.length).toBeGreaterThanOrEqual(2000);
    expect(bundled.length).toBeLessThanOrEqual(3000);
    const n = t.ctx.db.select({ n: count() }).from(schema.foods).get()?.n ?? 0;
    expect(n).toBe(bundled.length);
    expect(seedFoods(t.ctx.db)).toBe(0);
    expect(t.ctx.db.select({ n: count() }).from(schema.foods).get()?.n).toBe(bundled.length);
  });
  it("has complete per-100 g values, servings and unique ids", () => {
    const bundled = loadBundledFoods();
    const ids = new Set(bundled.map((f) => f.id));
    expect(ids.size).toBe(bundled.length);
    for (const f of bundled.slice(0, 200)) {
      expect(typeof f.per100.calories).toBe("number");
      expect(typeof f.per100.proteinG).toBe("number");
      expect(Array.isArray(f.servings)).toBe(true);
      for (const s of f.servings) expect(s.grams).toBeGreaterThan(0);
    }
  });
});

describe("food search", () => {
  it("ranks an exact start above a word start above a substring match", async () => {
    const r = await t.api<Food[]>("GET", "/api/foods?q=chicken%20breast");
    expect(r.data.length).toBeGreaterThan(3);
    expect(r.data.length).toBeLessThanOrEqual(25);
    expect(r.data[0]?.name.toLowerCase().startsWith("chicken breast")).toBe(true);
    for (const f of r.data) {
      expect(f.name.toLowerCase()).toContain("chicken");
      expect(f.name.toLowerCase()).toContain("breast");
      expect(typeof f.per100.calories).toBe("number");
      expect(Array.isArray(f.servings)).toBe(true);
    }
    const prefix = await t.api<Food[]>("GET", "/api/foods?q=gree%20yog");
    expect(prefix.data[0]?.name.toLowerCase()).toContain("greek yogurt");
    const egg = await t.api<Food[]>("GET", "/api/foods?q=egg");
    expect(egg.data[0]?.name.toLowerCase().startsWith("egg")).toBe(true);
    const contains = await t.api<Food[]>("GET", "/api/foods?q=erry");
    expect(contains.data.length).toBeGreaterThan(0);
    expect(contains.data.every((f) => f.name.toLowerCase().includes("erry"))).toBe(true);
  });
  it("respects the limit, returns popular foods for an empty query and nothing for nonsense", async () => {
    const five = await t.api<Food[]>("GET", "/api/foods?q=chicken&limit=5");
    expect(five.data).toHaveLength(5);
    const popular = await t.api<Food[]>("GET", "/api/foods");
    expect(popular.data).toHaveLength(25);
    expect(popular.data[0]?.source).toBe("bundled");
    const none = await t.api<Food[]>("GET", "/api/foods?q=zzqxv");
    expect(none.data).toEqual([]);
  });
});

describe("custom foods", () => {
  it("creates, fetches and ranks a custom food first", async () => {
    const created = await t.api<Food>("POST", "/api/foods", {
      name: "Protein pancakes",
      brand: "Home",
      per100: { calories: 210, proteinG: 18, carbsG: 22, fatG: 5, fiberG: 2, sugarG: 3, sodiumMg: 250, saturatedFatG: 1.5, cholesterolMg: 60, potassiumMg: 200 },
      servings: [{ label: "1 pancake", grams: 60 }],
    });
    expect(created.status).toBe(201);
    expect(created.data.source).toBe("custom");
    expect(created.data.servings).toEqual([{ label: "1 pancake", grams: 60 }]);
    const fetched = await t.api<Food>("GET", `/api/foods/${created.data.id}`);
    expect(fetched.data.per100.proteinG).toBe(18);
    const search = await t.api<Food[]>("GET", "/api/foods?q=protein%20pancakes");
    expect(search.data[0]?.id).toBe(created.data.id);
  });
  it("validates input and 404s unknown ids", async () => {
    const bad = await t.api("POST", "/api/foods", { name: "No nutrients" }, { allowError: true });
    expect(bad.status).toBe(400);
    const missing = await t.api("GET", "/api/foods/nope", undefined, { allowError: true });
    expect(missing.status).toBe(404);
  });
});

describe("barcodes", () => {
  const nutella = {
    status: 1,
    product: {
      product_name: "Nutella",
      brands: "Ferrero, Nutella",
      serving_size: "15 g",
      serving_quantity: 15,
      nutriments: { "energy-kcal_100g": 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, sugars_100g: 56.3, fat_100g: 30.9, "saturated-fat_100g": 10.6, salt_100g: 0.1075, sodium_100g: 0.043 },
    },
  };
  it("looks up Open Food Facts, maps the product and caches it", async () => {
    let calls = 0;
    setBarcodeFetch(async (url, init) => {
      calls++;
      expect(url).toContain("/api/v2/product/3017624010701");
      expect(new Headers(init?.headers).get("user-agent")).toContain("AravOS");
      return jsonResponse(nutella);
    });
    const r = await t.api<Food>("GET", "/api/foods/barcode/3017624010701");
    expect(r.data.name).toBe("Nutella");
    expect(r.data.brand).toBe("Ferrero");
    expect(r.data.source).toBe("off");
    expect(r.data.barcode).toBe("3017624010701");
    expect(r.data.per100.calories).toBe(539);
    expect(r.data.per100.sodiumMg).toBe(43);
    expect(r.data.per100.fiberG).toBeNull();
    expect(r.data.per100.saturatedFatG).toBe(10.6);
    expect(r.data.servings).toEqual([{ label: "15 g", grams: 15 }]);
    const again = await t.api<Food>("GET", "/api/foods/barcode/3017624010701");
    expect(again.data.id).toBe(r.data.id);
    expect(calls).toBe(1);
    const found = await t.api<Food[]>("GET", "/api/foods?q=nutella");
    expect(found.data[0]?.id).toBe(r.data.id);
  });
  it("returns 404 for unknown products and remembers the miss", async () => {
    let calls = 0;
    setBarcodeFetch(async () => {
      calls++;
      return jsonResponse({ status: 0, status_verbose: "product not found" });
    });
    const miss = await t.api("GET", "/api/foods/barcode/12345678", undefined, { allowError: true });
    expect(miss.status).toBe(404);
    const missAgain = await t.api("GET", "/api/foods/barcode/12345678", undefined, { allowError: true });
    expect(missAgain.status).toBe(404);
    expect(calls).toBe(1);
    setBarcodeFetch(async () => jsonResponse({}, 404));
    const http404 = await t.api("GET", "/api/foods/barcode/87654321", undefined, { allowError: true });
    expect(http404.status).toBe(404);
  });
  it("rejects bad codes and surfaces upstream failures", async () => {
    const bad = await t.api("GET", "/api/foods/barcode/abc", undefined, { allowError: true });
    expect(bad.status).toBe(400);
    setBarcodeFetch(async () => {
      throw new Error("offline");
    });
    const down = await t.api<{ error: string }>("GET", "/api/foods/barcode/5000159484695", undefined, { allowError: true });
    expect(down.status).toBe(502);
    setBarcodeFetch(async () => jsonResponse({}, 503));
    const busy = await t.api("GET", "/api/foods/barcode/5000159484695", undefined, { allowError: true });
    expect(busy.status).toBe(503);
  });
  it("maps kJ-only products, salt-only sodium and skips products without energy", () => {
    const mapped = mapOffProduct("1", { product_name_en: "Oat drink", nutriments: { energy_100g: 180, salt_100g: 0.25, potassium_100g: 0.12 } });
    expect(mapped?.name).toBe("Oat drink");
    expect(mapped?.per100.calories).toBe(43);
    expect(mapped?.per100.sodiumMg).toBe(100);
    expect(mapped?.per100.potassiumMg).toBe(120);
    expect(mapped?.servings).toEqual([]);
    expect(mapOffProduct("2", { product_name: "Mystery", nutriments: {} })).toBeNull();
  });
});
