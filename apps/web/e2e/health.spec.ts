import { test, expect } from "@playwright/test";

test.use({ timezoneId: "America/Los_Angeles" });

/** 1x1 transparent PNG, enough for the upload validators (magic bytes) and the canvas downscale. */
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test.describe("health hub", () => {
  test("shows the calorie ring against targets and the four areas", async ({ page }) => {
    await page.goto("/health");
    await expect(page.getByRole("heading", { name: "Health", level: 1 })).toBeVisible();
    const hero = page.getByTestId("calories-hero");
    await expect(hero).toBeVisible();
    await expect(hero.locator("div[role=img]")).toHaveAttribute("aria-label", /^Calories, [\d,]+ of 2,400$/);
    await expect(hero.getByText(/^(left|over)$/)).toBeVisible();
    await expect(hero.getByText("Protein")).toBeVisible();
    await expect(hero.getByText(/^\d+ \/ 160 g$/)).toBeVisible();
    await expect(hero.getByText(/^\d+ \/ 260 g$/)).toBeVisible();
    await expect(hero.getByText(/^\d+ \/ 75 g$/)).toBeVisible();
    await expect(page.getByTestId("water-tile")).toBeVisible();
    await expect(page.getByTestId("weight-tile")).toBeVisible();
    for (const name of [/^Nutrition/, /^Workouts/, /^Progress Photos/, /^Health Goals/]) await expect(page.getByRole("button", { name })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Health Goals/ })).toContainText("2,400 kcal");
  });

  test("tapping the water tile adds 250 ml", async ({ page, request }) => {
    await page.goto("/health");
    const value = page.getByTestId("water-value");
    await expect(value).toBeVisible();
    const before = Number((await value.textContent())?.replace(/,/g, "") ?? "0");
    const beforeApi = (await (await request.get("/api/water")).json()) as { ml: number };
    await page.getByTestId("water-tile").click();
    await expect(value).not.toHaveText(String(before));
    await expect.poll(async () => ((await (await request.get("/api/water")).json()) as { ml: number }).ml).toBe(beforeApi.ml + 250);
  });

  test("the weight sheet logs a value and the weight screen shows it", async ({ page }) => {
    await page.goto("/health?weight=1");
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Log Weight")).toBeVisible();
    await sheet.getByRole("button", { name: "Increase" }).click();
    await page.getByTestId("weight-done").click();
    await expect(page.getByText(/^Logged [\d.,]+ (lb|kg)$/)).toBeVisible();
    await expect(page.getByTestId("weight-tile-value")).toHaveText(/^\d+(\.\d)?$/);
    await page.goto("/health/weight");
    await expect(page.getByRole("heading", { name: "Weight", level: 1 })).toBeVisible();
    await expect(page.getByTestId("weight-hero")).toHaveText(/^\d+(\.\d)?$/);
    await expect(page.getByText("History")).toBeVisible();
  });
});

test.describe("food logger", () => {
  test("photo and text analysis explain that the server needs an API key", async ({ page }) => {
    await page.goto("/health");
    await page.getByTestId("log-food").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Log Food")).toBeVisible();
    await sheet.getByRole("tab", { name: "Describe" }).click();
    await sheet.locator("textarea").fill("2 eggs, toast with butter, black coffee");
    await sheet.getByRole("button", { name: "Analyze" }).click();
    await expect(sheet.getByText(/needs an API key/)).toBeVisible();

    await sheet.getByRole("tab", { name: "Photo" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("take-photo").click();
    await (await chooser).setFiles({ name: "meal.png", mimeType: "image/png", buffer: TINY_PNG });
    await expect(sheet.locator("img[alt='Meal photo']")).toBeVisible();
    await expect(sheet.getByText(/needs an API key/)).toBeVisible();
  });

  test("logs a meal from search and the diary shows it with calories", async ({ page }) => {
    await page.goto("/health/nutrition");
    await expect(page.getByRole("heading", { name: "Nutrition", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Log Food" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("tab", { name: "Search" }).click();
    await page.getByTestId("food-search").fill("chicken");
    const first = page.getByTestId("food-result").first();
    await expect(first).toContainText(/kcal/);
    await first.click();
    await expect(sheet.getByText("Add to Meal")).toBeVisible();
    await page.getByTestId("add-to-meal").click();
    await expect(sheet.getByText("Health score")).toBeVisible();
    await page.getByTestId("log-meal").click();
    await expect(page.getByText(/^Logged \d[\d,]* kcal$/)).toBeVisible();
    await expect(sheet).toBeHidden();
    const row = page.getByTestId("meal-row").first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/\d+ kcal/);
    await expect(row).toContainText("1 item");
    await expect(page.getByTestId("day-summary")).toContainText(/\/ 2,400 kcal/);
  });
});

test.describe("body progress", () => {
  test("an uploaded photo appears in the grid", async ({ page, request }) => {
    const res = await request.post("/api/body/photos", { multipart: { image: { name: "front.png", mimeType: "image/png", buffer: TINY_PNG }, pose: "front", note: "e2e" } });
    expect(res.status()).toBe(201);
    await page.goto("/health/body");
    await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
    const grid = page.getByTestId("photo-grid");
    await expect(grid.locator("img").first()).toBeVisible();
    await expect(page.getByText("Photos stay on this server.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Photo" })).toBeVisible();
  });
});
