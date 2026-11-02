import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// The e2e server runs in America/Los_Angeles; the browser must agree on what "today" is.
test.use({ timezoneId: "America/Los_Angeles" });

async function serverToday(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/summary/day");
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { date: string }).date;
}

async function resetLayout(request: APIRequestContext): Promise<void> {
  const layout = (await (await request.get("/api/layout/today")).json()) as { spec: { sections: { widgets: { id: string }[] }[] } };
  const spec = {
    sections: [
      { id: "top", widgets: [{ id: "agenda", type: "agenda", size: "l", hours: 12 }, { id: "tasks", type: "tasks", size: "l", filter: "today", limit: 8 }] },
      { id: "health", title: "Health", widgets: [{ id: "rings", type: "nutrition_rings", size: "m" }, { id: "water", type: "water", size: "s" }, { id: "streak", type: "workout_streak", size: "s" }] },
      { id: "goals", title: "Goals", widgets: [{ id: "goals", type: "goals_overview", size: "l", limit: 5 }] },
    ],
  };
  if (JSON.stringify(layout.spec) !== JSON.stringify(spec)) await request.put("/api/layout/today", { data: { spec, reason: "e2e reset" } });
}

async function openToday(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
}

test.describe("Today dashboard", () => {
  test.beforeEach(async ({ request }) => {
    await resetLayout(request);
  });

  test("renders the default sections and widgets", async ({ page, request }) => {
    const today = await serverToday(request);
    await request.post("/api/tasks", { data: { title: "Pay rent", dueDate: today } });
    await request.post("/api/goals", { data: { title: "Read 12 books", kind: "number", unit: "books", targetValue: 12, currentValue: 3 } });
    await openToday(page);
    await expect(page.getByText("Health", { exact: true })).toBeVisible();
    await expect(page.getByText("Goals", { exact: true })).toBeVisible();
    await expect(page.locator("[data-widget-type=agenda]")).toBeVisible();
    await expect(page.locator("[data-widget-type=tasks]")).toContainText("Pay rent");
    await expect(page.locator("[data-widget-type=nutrition_rings]")).toContainText("left");
    await expect(page.locator("[data-widget-type=water]")).toContainText("Water");
    await expect(page.locator("[data-widget-type=workout_streak]")).toContainText("Start Workout");
    await expect(page.locator("[data-widget-type=goals_overview]")).toContainText("Read 12 books");
    await expect(page.locator("[data-widget-type=agenda]")).toContainText("No events today.");
  });

  test("adds water from the widget chip", async ({ page, request }) => {
    const before = ((await (await request.get("/api/summary/day")).json()) as { water: { ml: number } }).water.ml;
    await openToday(page);
    const water = page.locator("[data-widget-type=water]");
    await water.scrollIntoViewIfNeeded();
    await water.getByRole("button", { name: "Add 250 millilitres" }).click();
    await expect.poll(async () => ((await (await request.get("/api/summary/day")).json()) as { water: { ml: number } }).water.ml).toBe(before + 250);
    // Units default to imperial, so the hero shows ounces.
    const settings = (await (await request.get("/api/settings")).json()) as { app: { units: string } };
    const shown = settings.app.units === "imperial" ? Math.round((before + 250) / 29.5735) : before + 250;
    await expect(water.locator(".num")).toHaveText(String(shown.toLocaleString("en-US")));
  });

  test("quick adds a task from the tasks widget and completes it", async ({ page, request }) => {
    await openToday(page);
    const tasks = page.locator("[data-widget-type=tasks]");
    const title = `Buy milk ${Date.now()}`;
    await tasks.getByRole("textbox", { name: "Add task" }).fill(title);
    await tasks.getByRole("textbox", { name: "Add task" }).press("Enter");
    await expect(tasks).toContainText(title);
    await expect(tasks.getByRole("textbox", { name: "Add task" })).toHaveValue("");
    const list = (await (await request.get("/api/tasks?view=today")).json()) as { id: string; title: string; status: string; dueDate: string | null }[];
    const created = list.find((t) => t.title === title);
    expect(created?.dueDate).toBeTruthy();
    await tasks.getByRole("checkbox", { name: title }).click();
    await expect(tasks.getByRole("checkbox", { name: title })).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => ((await (await request.get(`/api/tasks/${created!.id}`)).json()) as { status: string }).status).toBe("done");
  });

  test("edit mode adds a countdown widget and removes it", async ({ page, request }) => {
    await openToday(page);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Edit Layout" }).click();
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await page.getByRole("button", { name: "Add Widget" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.locator("[data-add-widget=countdown]").click();
    await sheet.getByLabel("Label").fill("Lisbon trip");
    await sheet.getByLabel("Date").fill("2027-06-01");
    await sheet.getByRole("button", { name: "Add Widget" }).click();
    const widget = page.locator("[data-widget-type=countdown]");
    await expect(widget).toBeVisible();
    await expect(widget).toContainText("Lisbon trip");
    await expect(widget).toContainText("days");
    await expect.poll(async () => JSON.stringify(await (await request.get("/api/layout/today")).json())).toContain('"countdown"');
    await widget.getByRole("button", { name: "Remove widget" }).click();
    await expect(widget).toHaveCount(0);
    await expect.poll(async () => JSON.stringify(await (await request.get("/api/layout/today")).json())).not.toContain('"countdown"');
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: "Assistant" }).first()).toBeVisible();
  });
});
