import { desc } from "drizzle-orm";
import type { App } from "../app.ts";
import { schema } from "../db/client.ts";
import { parseJson } from "../lib/json.ts";

export function activityRoutes(app: App): void {
  app.get("/api/activity", (c) => {
    const { db } = c.get("ctx");
    const raw = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, Math.floor(raw))) : 50;
    const rows = db.select().from(schema.activityLog).orderBy(desc(schema.activityLog.at)).limit(limit).all();
    return c.json(rows.map((r) => ({ ...r, data: parseJson(r.data, null) })));
  });
}
