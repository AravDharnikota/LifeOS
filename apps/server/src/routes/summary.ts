import { DATE_RE, todayString } from "@aravos/shared";
import type { App } from "../app.ts";
import { badRequest } from "../lib/errors.ts";
import { getDaySummary, getWeekSummary, weekBounds } from "../services/summary.ts";

function dateParam(value: string | undefined, name: string, fallback: string): string {
  if (value === undefined || value === "") return fallback;
  if (!DATE_RE.test(value)) throw badRequest(`${name} must be YYYY-MM-DD`);
  return value;
}

export function summaryRoutes(app: App): void {
  app.get("/api/summary/day", (c) => {
    const date = dateParam(c.req.query("date"), "date", todayString());
    return c.json(getDaySummary(c.get("ctx"), date));
  });
  app.get("/api/summary/week", (c) => {
    const ctx = c.get("ctx");
    const start = dateParam(c.req.query("start"), "start", weekBounds(ctx.db, todayString()).start);
    return c.json(getWeekSummary(ctx, start));
  });
}
