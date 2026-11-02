import { test, expect } from "@playwright/test";

test.describe("shell", () => {
  test("renders the Today screen and navigates between tabs", async ({ page, isMobile }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: isMobile ? "Primary" : undefined }).first();
    await nav.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
    await nav.getByRole("link", { name: "Tasks" }).click();
    await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
    await nav.getByRole("link", { name: "Health" }).click();
    await expect(page.getByRole("heading", { name: "Health", level: 1 })).toBeVisible();
    await nav.getByRole("link", { name: "Goals" }).click();
    await expect(page.getByRole("heading", { name: "Goals", level: 1 })).toBeVisible();
  });

  test("API health is reachable from the app origin", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.name).toBe("AravOS");
  });

  test("respects the dark color scheme", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto("/");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(17, 17, 16)");
    await ctx.close();
  });
});
