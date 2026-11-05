import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const HUB = "/health/workouts";
const TEMPLATE_A = "Strong 5x5 - Workout A";

async function discardActive(request: APIRequestContext): Promise<void> {
  const res = await request.get("/api/workouts/active");
  const active = (await res.json()) as { id: string } | null;
  if (active) await request.post(`/api/workouts/${active.id}/discard`);
}

async function startTemplateA(page: Page): Promise<void> {
  await page.goto(HUB);
  await page.getByRole("button", { name: /Example Templates/ }).click();
  await page.locator("section", { hasText: "Example Templates" }).getByTestId("template-card").filter({ hasText: TEMPLATE_A }).click();
  await page.getByTestId("preview-start").click();
  await expect(page).toHaveURL(/\/health\/workouts\/active$/);
  await expect(page.getByTestId("exercise-block")).toHaveCount(3);
}

test.describe("workouts", () => {
  test.beforeEach(async ({ request }) => {
    await discardActive(request);
  });

  test("hub shows the five example templates", async ({ page }) => {
    await page.goto(HUB);
    await expect(page.getByRole("heading", { name: "Workouts", level: 1 })).toBeVisible();
    await expect(page.getByTestId("start-empty")).toBeVisible();
    await page.getByRole("button", { name: /Example Templates/ }).click();
    const examples = page.locator("section", { hasText: "Example Templates" }).getByTestId("template-card");
    await expect(examples).toHaveCount(5);
    await expect(examples.filter({ hasText: TEMPLATE_A })).toBeVisible();
    await expect(examples.filter({ hasText: "Chest and Triceps" })).toBeVisible();
  });

  test("logs a workout from a template, finishes it and lists it in history", async ({ page }) => {
    await startTemplateA(page);
    await expect(page.getByTestId("set-row")).toHaveCount(15);
    await expect(page.getByTestId("elapsed")).toContainText(/\d:\d\d/);

    const firstBlock = page.getByTestId("exercise-block").first();
    await expect(firstBlock.getByTestId("exercise-name")).toHaveText("Squat (Barbell)");
    const firstRow = firstBlock.getByTestId("set-row").first();
    await firstRow.locator("input[data-field=weight]").fill("100");
    await firstRow.locator("input[data-field=reps]").fill("5");
    await firstRow.getByTestId("set-check").click();
    await expect(firstRow).toHaveAttribute("data-completed", "true");
    await expect(firstRow.locator("input[data-field=weight]")).toHaveValue("100");
    await expect(page.getByTestId("rest-pill")).toBeVisible();
    await expect(page.getByTestId("rest-pill")).toContainText(/\d:\d\d/);

    await firstBlock.getByTestId("add-set").click();
    await expect(firstBlock.getByTestId("set-row")).toHaveCount(6);
    await expect(firstBlock.getByTestId("set-row").nth(5).locator("input[data-field=reps]")).toHaveValue("5");

    await page.getByTestId("finish").click();
    await expect(page.getByRole("alertdialog")).toContainText("Finish Workout?");
    await page.getByRole("button", { name: "Discard Unfinished Sets" }).click();
    const keep = page.getByText("Keep Original Template");
    await expect(keep).toBeVisible();
    await keep.click();

    const summary = page.getByTestId("summary");
    await expect(summary).toBeVisible();
    await expect(page.getByTestId("summary-duration")).toContainText(/\d+(s|m|h)/);
    await expect(page.getByTestId("summary-volume")).toContainText(/\d+ (lb|kg)/);
    await expect(summary).toContainText("Squat (Barbell)");
    await page.getByTestId("summary-done").click();
    await expect(page).toHaveURL(/\/health\/workouts$/);
    await expect(page.getByTestId("recent-history").getByTestId("workout-row").first()).toContainText(TEMPLATE_A);

    await page.goto(`${HUB}/history`);
    await expect(page.getByTestId("history-group").first().getByTestId("workout-row").first()).toContainText(TEMPLATE_A);
    await page.getByTestId("history-group").first().getByTestId("workout-row").first().click();
    await expect(page).toHaveURL(/\/health\/workouts\/history\/[^/]+$/);
    await expect(page.getByTestId("detail-exercise")).toHaveCount(1);
    await expect(page.getByTestId("detail-exercise").first()).toContainText("100 lb × 5");
  });

  test("a second workout shows previous values and completes from them", async ({ page, request }) => {
    await startTemplateA(page);
    const firstBlock = page.getByTestId("exercise-block").first();
    const firstRow = firstBlock.getByTestId("set-row").first();
    await expect(firstRow).toContainText("100 × 5");
    await expect(firstRow.locator("input[data-field=weight]")).toHaveAttribute("placeholder", "100");
    await firstRow.getByTestId("set-check").click();
    await expect(firstRow).toHaveAttribute("data-completed", "true");
    await expect(firstRow.locator("input[data-field=weight]")).toHaveValue("100");
    await page.getByTestId("cancel-workout").click();
    await page.getByRole("button", { name: "Discard Workout" }).click();
    await expect(page).toHaveURL(/\/health\/workouts$/);
    const active = await (await request.get("/api/workouts/active")).json();
    expect(active).toBeNull();
  });

  test("keyboard accessory steps values and swiping a row deletes it", async ({ page, isMobile }) => {
    test.skip(!isMobile, "The accessory row and swipe actions are touch-only.");
    await startTemplateA(page);
    const firstBlock = page.getByTestId("exercise-block").first();
    const row = firstBlock.getByTestId("set-row").first();
    const weight = row.locator("input[data-field=weight]");
    await expect(weight).toHaveAttribute("placeholder", "100");
    await weight.click();
    const accessory = page.getByTestId("keypad-accessory");
    await expect(accessory).toBeVisible();
    await accessory.getByRole("button", { name: "+5" }).click();
    await expect(weight).toHaveValue("105");
    await accessory.getByRole("button", { name: "+5" }).click();
    await expect(weight).toHaveValue("110");
    await accessory.getByRole("button", { name: "Next" }).click();
    await expect(row.locator("input[data-field=reps]")).toBeFocused();
    await accessory.getByRole("button", { name: "Previous" }).click();
    await expect(weight).toHaveValue("100");
    await page.getByTestId("finish").focus();

    const last = firstBlock.getByTestId("set-row").nth(4);
    await last.scrollIntoViewIfNeeded();
    // Start the swipe on the check button: drags never start from a text input, and the value chips fill most of the row.
    const box = await last.getByTestId("set-check").boundingBox();
    if (!box) throw new Error("row not visible");
    const sx = box.x + box.width / 2;
    await page.mouse.move(sx, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(sx - i * 25, box.y + box.height / 2);
    await page.mouse.up();
    await expect(firstBlock.getByTestId("set-row")).toHaveCount(4);
    await page.getByTestId("cancel-workout").click();
    await page.getByRole("button", { name: "Discard Workout" }).click();
    await expect(page).toHaveURL(/\/health\/workouts$/);
  });

  test("template editor adds an exercise through the picker and saves", async ({ page }) => {
    const name = `E2E Template ${Date.now()}`;
    await page.goto(`${HUB}/templates/new`);
    await page.getByTestId("template-name").fill(name);
    await page.getByTestId("add-exercises").click();
    await page.getByTestId("exercise-search").fill("Bench Press (Barbell)");
    const row = page.getByTestId("exercise-row").filter({ hasText: "Bench Press (Barbell)" }).first();
    await expect(row).toBeVisible();
    await row.click();
    await page.getByTestId("picker-add").click();
    await expect(page.getByTestId("exercise-block")).toHaveCount(1);
    await expect(page.getByTestId("exercise-name").first()).toHaveText("Bench Press (Barbell)");
    await page.getByTestId("exercise-block").first().getByTestId("add-set").click();
    await expect(page.getByTestId("set-row")).toHaveCount(2);
    await page.getByTestId("template-save").click();
    await expect(page).toHaveURL(/\/health\/workouts$/);
    await expect(page.getByTestId("template-card").filter({ hasText: name })).toBeVisible();
  });

  test("exercise detail shows records after a workout", async ({ page }) => {
    await page.goto(`${HUB}/exercises`);
    await page.getByPlaceholder("Search exercises").fill("Squat (Barbell)");
    await page.getByTestId("exercises-list").getByText("Squat (Barbell)", { exact: true }).click();
    await expect(page).toHaveURL(/\/health\/workouts\/exercises\/[^/]+$/);
    await page.getByRole("tab", { name: "Records" }).click();
    await expect(page.getByTestId("records")).toBeVisible();
    await expect(page.getByTestId("records")).toContainText("1RM");
    await expect(page.getByTestId("records")).toContainText(/\d+(\.\d)? lb/);
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByTestId("exercise-history")).toContainText("100 lb × 5");
  });
});
