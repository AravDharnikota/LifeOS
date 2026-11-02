import { eq } from "drizzle-orm";
import type { z } from "zod";
import { AppSettings, HealthProfile, SchedulerPrefs } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { parseJson } from "../lib/json.ts";

export function getSetting<T extends z.ZodTypeAny>(db: Db, key: string, sch: T): z.infer<T> {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  const parsed = sch.safeParse(parseJson(row?.value, {}));
  if (parsed.success) return parsed.data;
  return sch.parse({});
}

export function setSetting(db: Db, key: string, value: unknown): void {
  const v = JSON.stringify(value);
  db.insert(schema.settings)
    .values({ key, value: v, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: v, updatedAt: new Date().toISOString() } })
    .run();
}

export function getRawSetting(db: Db, key: string): unknown {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row ? parseJson(row.value, null) : null;
}

export const getAppSettings = (db: Db) => getSetting(db, "app", AppSettings);
export const getHealthProfile = (db: Db) => getSetting(db, "health_profile", HealthProfile);
export const getSchedulerPrefs = (db: Db) => getSetting(db, "scheduler", SchedulerPrefs);
