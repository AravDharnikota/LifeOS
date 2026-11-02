import { test, expect, type Page } from "@playwright/test";

test.use({ timezoneId: "America/Los_Angeles" });

const uid = () => Math.random().toString(36).slice(2, 8);

/** ISO string for a local wall-clock time today (the browser runs in Los Angeles). */
async function localIso(page: Page, hour: number, minute = 0): Promise<string> {
  return page.evaluate(({ h, m }) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }, { h: hour, m: minute });
}
async function localToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}
async function localHm(page: Page, iso: string): Promise<string> {
  return page.evaluate((s) => {
    const d = new Date(s);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }, iso);
}

async function seedEvent(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post("/api/events", { data: body });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; title: string; start: string; end: string };
}

async function getEvent(page: Page, id: string) {
  return (await (await page.request.get(`/api/events/${id}`)).json()) as { id: string; start: string; end: string };
}

async function mouseDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/** Touch drag with a long press first, the way a finger moves a block on the phone. */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = 500) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  await page.waitForTimeout(hold);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }] });
    await page.waitForTimeout(30);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

function todayColumn(page: Page, today: string) {
  return page.locator(`[data-day-column][data-date="${today}"]`);
}

test("seeded events render at the right vertical position in the day timeline", async ({ page }) => {
  const title = `Position check ${uid()}`;
  await seedEvent(page, { title, start: await localIso(page, 9), end: await localIso(page, 10) });
  const today = await localToday(page);
  await page.goto("/calendar");
  const block = todayColumn(page, today).locator("[data-event-block]", { hasText: title });
  await expect(block).toBeVisible();
  await block.scrollIntoViewIfNeeded();
  const line = todayColumn(page, today).locator('[data-hour="9"]');
  const b = (await block.boundingBox())!;
  const l = (await line.boundingBox())!;
  expect(Math.abs(b.y - l.y - 1)).toBeLessThanOrEqual(3);
  expect(b.height).toBeGreaterThanOrEqual(55);
  expect(b.height).toBeLessThanOrEqual(60);
  await expect(block).toContainText("09:00 to 10:00");
});

test("tapping an empty slot creates a one-hour draft that saves on Enter", async ({ page }) => {
  const title = `Draft ${uid()}`;
  const today = await localToday(page);
  await page.goto("/calendar");
  const col = todayColumn(page, today);
  const h14 = col.locator('[data-hour="14"]');
  await h14.scrollIntoViewIfNeeded();
  const box = (await h14.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + 8);
  const input = page.getByLabel("Event title");
  await expect(input).toBeVisible();
  await input.fill(title);
  await input.press("Enter");
  await expect(col.locator("[data-event-block]", { hasText: title })).toBeVisible();
  await expect
    .poll(async () => {
      const from = await localIso(page, 0);
      const to = await localIso(page, 23, 59);
      const list = (await (await page.request.get(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).json()) as { title: string; start: string; end: string }[];
      const ev = list.find((e) => e.title === title);
      return ev ? `${await localHm(page, ev.start)}-${await localHm(page, ev.end)}` : null;
    })
    .toBe("14:00-15:00");
});

test("dragging a block by 60px moves it one hour later", async ({ page }, testInfo) => {
  const title = `Move me ${uid()}`;
  const ev = await seedEvent(page, { title, start: await localIso(page, 11), end: await localIso(page, 12) });
  const today = await localToday(page);
  await page.goto("/calendar");
  const block = todayColumn(page, today).locator("[data-event-block]", { hasText: title });
  await block.scrollIntoViewIfNeeded();
  const b = (await block.boundingBox())!;
  const from = { x: b.x + b.width / 2, y: b.y + 20 };
  const to = { x: from.x, y: from.y + 60 };
  if (testInfo.project.name === "iphone") await touchDrag(page, from, to);
  else await mouseDrag(page, from, to);
  await expect.poll(async () => localHm(page, (await getEvent(page, ev.id)).start)).toBe("12:00");
  await expect.poll(async () => localHm(page, (await getEvent(page, ev.id)).end)).toBe("13:00");
});

test("dragging the bottom handle resizes the event", async ({ page }, testInfo) => {
  const title = `Resize me ${uid()}`;
  const ev = await seedEvent(page, { title, start: await localIso(page, 15), end: await localIso(page, 15, 30) });
  const today = await localToday(page);
  await page.goto("/calendar");
  const block = todayColumn(page, today).locator("[data-event-block]", { hasText: title });
  await block.scrollIntoViewIfNeeded();
  const handle = block.locator("[data-resize-handle]");
  const h = (await handle.boundingBox())!;
  const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  const to = { x: from.x, y: from.y + 30 };
  if (testInfo.project.name === "iphone") await touchDrag(page, from, to, 0);
  else await mouseDrag(page, from, to);
  await expect.poll(async () => localHm(page, (await getEvent(page, ev.id)).end)).toBe("16:00");
  await expect.poll(async () => localHm(page, (await getEvent(page, ev.id)).start)).toBe("15:00");
});

test("the checkbox on a time box completes its task", async ({ page }) => {
  const taskRes = await page.request.post("/api/tasks", { data: { title: `Boxed task ${uid()}`, estimateMinutes: 30 } });
  const task = (await taskRes.json()) as { id: string; title: string };
  await seedEvent(page, { title: task.title, taskId: task.id, kind: "timebox", start: await localIso(page, 16, 30), end: await localIso(page, 17) });
  const today = await localToday(page);
  await page.goto("/calendar");
  const block = todayColumn(page, today).locator('[data-event-block][data-kind="timebox"]', { hasText: task.title });
  await block.scrollIntoViewIfNeeded();
  await block.getByRole("checkbox").click();
  await expect(block).toHaveClass(/opacity-45/);
  await expect.poll(async () => ((await (await page.request.get(`/api/tasks/${task.id}`)).json()) as { status: string }).status).toBe("done");
});

test("week view shows seven day columns on desktop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "week grid is a desktop layout");
  await page.goto("/calendar");
  await page.getByRole("tab", { name: "Week" }).click();
  await expect(page.locator("[data-day-column]")).toHaveCount(7);
  await expect(page.locator("[data-day-column]").first()).toHaveAttribute("data-date", /\d{4}-\d{2}-\d{2}/);
  await page.getByRole("tab", { name: "Day" }).click();
  await expect(page.locator("[data-day-column]")).toHaveCount(1);
});
