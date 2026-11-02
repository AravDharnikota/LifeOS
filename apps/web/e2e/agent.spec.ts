import { expect, test } from "@playwright/test";

test.use({ timezoneId: "America/Los_Angeles" });

test.describe("Assistant", () => {
  test("opens from the Today header and explains the missing API key", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Assistant" }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Assistant" })).toBeVisible();
    await expect(sheet.getByText("Assistant needs an API key. Add ANTHROPIC_API_KEY on the server.")).toBeVisible();
    await expect(sheet.getByRole("textbox", { name: "Message" })).toBeDisabled();
    await expect(sheet.getByRole("button", { name: "What is left today" })).toBeDisabled();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toHaveCount(0);
  });

  test("lists, creates, selects and deletes threads", async ({ page, request }) => {
    const seeded = (await (await request.post("/api/agent/threads", { data: { title: "Weekend plans" } })).json()) as { id: string };
    await page.goto("/");
    await page.getByRole("button", { name: "Assistant" }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Threads" }).click();
    await expect(sheet.getByRole("heading", { name: "Threads" })).toBeVisible();
    await expect(sheet.getByText("Weekend plans")).toBeVisible();

    // New thread: appears in the list and becomes the current one.
    await sheet.getByRole("button", { name: "New Thread" }).click();
    await expect(sheet.getByRole("heading", { name: "Assistant" })).toBeVisible();
    const threads = (await (await request.get("/api/agent/threads")).json()) as { id: string; title: string | null }[];
    expect(threads.length).toBeGreaterThanOrEqual(2);
    const current = await page.evaluate(() => localStorage.getItem("aravos.agent.thread"));
    expect(threads.some((t) => t.id === current)).toBeTruthy();

    // Select the seeded thread, then delete it from its menu.
    await sheet.getByRole("button", { name: "Threads" }).click();
    await sheet.getByRole("button", { name: /Weekend plans/ }).click();
    await expect(sheet.getByRole("heading", { name: "Assistant" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("aravos.agent.thread"))).toBe(seeded.id);
    await sheet.getByRole("button", { name: "Threads" }).click();
    const row = sheet.getByRole("button", { name: /Weekend plans/ });
    await row.getByRole("button", { name: "Thread options" }).click();
    await page.getByRole("menuitem", { name: "Delete Thread" }).click();
    await expect(sheet.getByText("Weekend plans")).toHaveCount(0);
    await expect.poll(async () => ((await (await request.get("/api/agent/threads")).json()) as { id: string }[]).some((t) => t.id === seeded.id)).toBe(false);
  });

  test("toggles with the keyboard shortcut on desktop", async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), "desktop only");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Assistant" })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
