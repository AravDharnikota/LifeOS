import { test, expect } from "@playwright/test";

// The e2e server runs in America/Los_Angeles; keep the browser on the same calendar day.
test.use({ timezoneId: "America/Los_Angeles" });

/** Both projects share one server, so names carry the project to stay unique. */
const named = (s: string) => `${s} ${test.info().project.name}`;

test.describe("Goals", () => {
  test("creates a number goal and logging progress moves the bar", async ({ page }) => {
    await page.goto("/goals");
    await page.getByTestId("add-goal").click();
    await expect(page).toHaveURL(/\/goals\/new$/);
    await page.getByTestId("goal-title").fill(named("Read 12 books"));
    await page.getByTestId("goal-target").fill("12");
    await page.getByTestId("goal-unit").fill("books");
    await page.getByTestId("goal-done").click();

    await expect(page).toHaveURL(/\/goals\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("hero-value")).toHaveText("0");
    await expect(page.getByRole("img", { name: "0% of target" })).toBeVisible();

    await page.getByTestId("log-progress").click();
    await page.getByRole("dialog").getByLabel("Increase").click();
    await page.getByTestId("log-done").click();
    await expect(page.getByTestId("hero-value")).toHaveText("2");
    await expect(page.getByRole("img", { name: "17% of target" })).toBeVisible();
    await expect(page.getByTestId("history-row").first()).toContainText("2 books");

    await page.goto("/goals");
    const row = page.getByTestId("goal-row").filter({ hasText: named("Read 12 books") });
    await expect(row.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "17");
  });

  test("habit check-in toggles the streak", async ({ page, request }) => {
    const res = await request.post("/api/goals", { data: { title: named("Meditate"), kind: "habit", cadence: "daily", area: "life" } });
    const goal = (await res.json()) as { id: string };

    await page.goto("/goals");
    const row = page.getByTestId("goal-row").filter({ hasText: named("Meditate") });
    await expect(row.getByTestId("streak-value")).toHaveText("0");
    await row.getByRole("checkbox").click();
    await expect(row.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    await expect(row.getByTestId("streak-value")).toHaveText("1");
    await expect.poll(async () => ((await (await request.get(`/api/goals/${goal.id}`)).json()) as { streak: number }).streak).toBe(1);

    await row.getByRole("checkbox").click();
    await expect(row.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    await expect(row.getByTestId("streak-value")).toHaveText("0");

    await page.goto(`/goals/${goal.id}`);
    await page.getByTestId("habit-today").click();
    await expect(page.getByTestId("hero-value")).toHaveText("1");
    await expect(page.getByTestId("habit-today")).toHaveAttribute("aria-pressed", "true");
  });

  test("completing milestones updates the count", async ({ page, request }) => {
    const goal = (await (await request.post("/api/goals", { data: { title: named("Launch site"), kind: "milestone", area: "work" } })).json()) as { id: string };
    await request.post(`/api/goals/${goal.id}/milestones`, { data: { title: "Design" } });
    await request.post(`/api/goals/${goal.id}/milestones`, { data: { title: "Build" } });

    await page.goto(`/goals/${goal.id}`);
    const rows = page.getByTestId("milestone-row");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("hero-value")).toHaveText("0");
    await rows.first().getByRole("checkbox").click();
    await expect(page.getByTestId("hero-value")).toHaveText("1");
    await expect(page.getByRole("img", { name: "50% of milestones" })).toBeVisible();

    await page.getByTestId("milestone-add").fill("Ship");
    await page.getByTestId("milestone-add").press("Enter");
    await expect(rows).toHaveCount(3);

    await page.goto("/goals");
    const row = page.getByTestId("goal-row").filter({ hasText: named("Launch site") });
    await expect(row).toContainText("of 3 milestones");
    await expect(row.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
  });

  test("shows the empty state and a tracker", async ({ page, request }) => {
    await page.goto("/goals");
    const tab = page.getByRole("tab", { name: "Done" });
    await tab.click();
    await expect(page.getByText("No goals done yet.")).toBeVisible();

    await request.post("/api/trackers", { data: { name: named("Water"), unit: "glasses", step: 1, target: 8 } });
    await page.goto("/goals");
    const tracker = page.getByTestId("tracker-row").filter({ hasText: named("Water") });
    await expect(tracker).toContainText("of 8 glasses today");
    await tracker.getByLabel("Increase").click();
    await expect.poll(async () => ((await (await request.get("/api/trackers")).json()) as { name: string; todayValue: number }[]).find((t) => t.name === named("Water"))?.todayValue).toBe(1);
  });

  test("edits a goal title and deletes it from the menu", async ({ page, request }) => {
    const goal = (await (await request.post("/api/goals", { data: { title: named("Old title"), kind: "boolean", area: "life" } })).json()) as { id: string };
    await page.goto(`/goals/${goal.id}`);
    await page.getByTestId("goal-edit").click();
    await page.getByTestId("goal-title").fill(named("New title"));
    await page.getByTestId("goal-done").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(named("New title"));
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByTestId("goal-more").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete Goal" }).click();
    await expect(page).toHaveURL(/\/goals$/);
    await expect.poll(async () => (await request.get(`/api/goals/${goal.id}`)).status()).toBe(404);
  });
});
