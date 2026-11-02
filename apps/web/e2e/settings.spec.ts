import { test, expect } from "@playwright/test";

// The e2e server runs in America/Los_Angeles; keep the browser on the same calendar day.
test.use({ timezoneId: "America/Los_Angeles" });

test.describe("Settings", () => {
  test("theme switch sets data-theme on html and persists", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("tab", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("tab", { name: "System" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  });

  test("units switch changes displayed targets and saves", async ({ page, request }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("target-waterMl")).toContainText("85 oz");
    await page.getByRole("tab", { name: "Metric" }).click();
    await expect(page.getByRole("tab", { name: "Metric" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("target-waterMl")).toContainText("2.5 L");
    await expect.poll(async () => ((await (await request.get("/api/settings")).json()) as { app: { units: string } }).app.units).toBe("metric");
    await page.getByRole("tab", { name: "Imperial" }).click();
    await expect(page.getByTestId("target-waterMl")).toContainText("85 oz");
  });

  test("MCP shows the server URL with a copy button and a guide", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("mcp-url")).toContainText("/mcp");
    await expect(page.getByTestId("mcp-copy")).toBeVisible();
    await page.getByTestId("mcp-guide").click();
    await expect(page).toHaveURL(/\/settings\/mcp$/);
    await expect(page.getByText("claude mcp add --transport http aravos")).toBeVisible();
    await expect(page.getByText("npx mcp-remote")).toBeVisible();
  });

  test("google shows the not configured state", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("google-status")).toContainText("Not configured");
    await expect(page.getByTestId("anthropic-status")).toContainText("Not configured");
  });

  test("rest timer sheet saves seconds", async ({ page, request }) => {
    await page.goto("/settings");
    await page.getByTestId("rest-timer").click();
    await page.getByRole("dialog").getByLabel("Increase").click();
    await page.getByTestId("number-done").click();
    await expect(page.getByTestId("rest-timer")).toContainText("1:35");
    await expect.poll(async () => ((await (await request.get("/api/settings")).json()) as { app: { defaultRestSeconds: number } }).app.defaultRestSeconds).toBe(95);
  });
});
