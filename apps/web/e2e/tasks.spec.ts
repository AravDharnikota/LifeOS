import { test, expect, type Page } from "@playwright/test";

test.use({ timezoneId: "America/Los_Angeles" });

const uid = () => Math.random().toString(36).slice(2, 8);

async function localToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

async function seedTask(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post("/api/tasks", { data: body });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; title: string };
}

async function swipeLeft(page: Page, x: number, y: number, distance: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - (distance * i) / steps, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("quick add parses the date, time and priority and shows the task in Upcoming", async ({ page }) => {
  const title = `Buy milk ${uid()}`;
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const input = page.getByLabel("New task");
  await expect(input).toBeVisible();
  await input.fill(`${title} tomorrow 5pm !high`);
  await expect(page.locator('[data-chip="time"]')).toHaveText("17:00");
  await expect(page.locator('[data-chip="date"]')).toHaveText("Tomorrow");
  await expect(page.locator('[data-chip="pri"]')).toHaveText("High");
  await input.press("Enter");
  await expect(page.getByText("Added.")).toBeVisible();
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("tab", { name: "Upcoming" }).click();
  const row = page.locator("[data-task-row]", { hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText("17:00");
  const list = (await (await page.request.get("/api/tasks?view=upcoming")).json()) as { title: string; dueTime: string | null; priority: number }[];
  const created = list.find((t) => t.title === title);
  expect(created?.dueTime).toBe("17:00");
  expect(created?.priority).toBe(3);
});

test("completing a task from Today moves it to Done today", async ({ page }) => {
  const today = await localToday(page);
  const task = await seedTask(page, { title: `Call plumber ${uid()}`, dueDate: today });
  await page.goto("/tasks");
  const row = page.locator("[data-task-row]", { hasText: task.title });
  await expect(row).toBeVisible();
  await row.getByRole("checkbox").click();
  await expect(page.locator('[data-task-group="due"] [data-task-row]', { hasText: task.title })).toHaveCount(0);
  const done = page.locator('[data-task-group="done"]');
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: /Done today/ }).click();
  await expect(done.locator("[data-task-row]", { hasText: task.title })).toBeVisible();
  await expect.poll(async () => ((await (await page.request.get(`/api/tasks/${task.id}`)).json()) as { status: string }).status).toBe("done");
});

test("a task can be deleted from the row actions", async ({ page }, testInfo) => {
  const today = await localToday(page);
  const task = await seedTask(page, { title: `Old receipt ${uid()}`, dueDate: today });
  await page.goto("/tasks");
  const row = page.locator("[data-task-row]", { hasText: task.title });
  await expect(row).toBeVisible();
  if (testInfo.project.name === "iphone") {
    const box = (await row.boundingBox())!;
    await swipeLeft(page, box.x + box.width - 40, box.y + box.height / 2, 190);
    await row.getByRole("button", { name: "Delete", exact: true }).click();
  } else {
    await row.hover();
    await row.getByRole("button", { name: "Delete", exact: true }).click();
  }
  await expect(page.getByText("Task deleted.")).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect.poll(async () => (await page.request.get(`/api/tasks/${task.id}`)).status()).toBe(404);
});

test("tapping a row expands it and the title can be edited inline", async ({ page }) => {
  const today = await localToday(page);
  const task = await seedTask(page, { title: `Draft note ${uid()}`, dueDate: today });
  const next = `Draft memo ${uid()}`;
  await page.goto("/tasks");
  const row = page.locator("[data-task-row]", { hasText: task.title });
  await row.getByText(task.title).click();
  const title = page.getByLabel("Title");
  await expect(title).toBeVisible();
  await expect(page.getByLabel("Notes")).toBeVisible();
  await title.fill(next);
  await title.press("Enter");
  await expect(page.locator("[data-task-row]", { hasText: next })).toBeVisible();
  await expect.poll(async () => ((await (await page.request.get(`/api/tasks/${task.id}`)).json()) as { title: string }).title).toBe(next);
});
