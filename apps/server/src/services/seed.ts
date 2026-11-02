import { count } from "drizzle-orm";
import { DEFAULT_TODAY_LAYOUT } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import type { Env } from "../lib/env.ts";
import { newId } from "../lib/ids.ts";
import { seedExercises } from "./exercise-library.ts";
import { setSetting, getRawSetting } from "./settings.ts";

/** Idempotent: creates defaults the app assumes exist. */
export function seedDatabase(db: Db, env: Env): void {
  const lists = db.select({ n: count() }).from(schema.taskLists).get()?.n ?? 0;
  if (lists === 0) {
    db.insert(schema.taskLists).values([
      { id: newId(), name: "Inbox", isDefault: true, sortOrder: 0 },
      { id: newId(), name: "Personal", sortOrder: 1, color: "green" },
      { id: newId(), name: "Work", sortOrder: 2, color: "blue" },
    ]).run();
  }
  const cals = db.select({ n: count() }).from(schema.calendars).get()?.n ?? 0;
  if (cals === 0) {
    db.insert(schema.calendars).values([
      { id: newId(), name: "Personal", color: "blue", isDefault: true },
      { id: newId(), name: "Time boxes", color: "graphite" },
    ]).run();
  }
  const layouts = db.select({ n: count() }).from(schema.layouts).get()?.n ?? 0;
  if (layouts === 0) {
    db.insert(schema.layouts).values({ id: "today", spec: JSON.stringify(DEFAULT_TODAY_LAYOUT), version: 1 }).run();
  }
  if (!getRawSetting(db, "app")) setSetting(db, "app", { timezone: env.timezone });
  seedExercises(db);
}
