import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { TrackerCreate, TrackerUpdate, TrackerLog, todayString, weekStartString, type Tracker } from "@aravos/shared";
import type { App } from "../app.ts";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { parseBody } from "../lib/http.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { notFound } from "../lib/errors.ts";
import { logActivity } from "../services/activity.ts";

type Row = typeof schema.trackers.$inferSelect;

export function trackerValue(db: Db, t: Row, date = todayString()): number {
  if (t.reset === "never") {
    return db.select({ v: sql<number>`coalesce(sum(${schema.trackerEntries.value}), 0)` }).from(schema.trackerEntries).where(eq(schema.trackerEntries.trackerId, t.id)).get()?.v ?? 0;
  }
  const from = t.reset === "weekly" ? weekStartString(date) : date;
  return db.select({ v: sql<number>`coalesce(sum(${schema.trackerEntries.value}), 0)` }).from(schema.trackerEntries).where(and(eq(schema.trackerEntries.trackerId, t.id), gte(schema.trackerEntries.date, from), sql`${schema.trackerEntries.date} <= ${date}`)).get()?.v ?? 0;
}

export function serializeTracker(db: Db, t: Row): Tracker {
  return { ...t, kind: t.kind as Tracker["kind"], reset: t.reset as Tracker["reset"], todayValue: trackerValue(db, t) };
}

export function listTrackers(db: Db): Tracker[] {
  return db.select().from(schema.trackers).where(isNull(schema.trackers.deletedAt)).orderBy(asc(schema.trackers.createdAt)).all().map((t) => serializeTracker(db, t));
}

export function getTracker(db: Db, id: string): Tracker {
  const t = db.select().from(schema.trackers).where(and(eq(schema.trackers.id, id), isNull(schema.trackers.deletedAt))).get();
  if (!t) throw notFound("Tracker");
  return serializeTracker(db, t);
}

export function createTracker(db: Db, input: typeof TrackerCreate._output, actor = "user"): Tracker {
  const id = newId();
  db.insert(schema.trackers).values({ id, name: input.name, kind: input.kind ?? "counter", unit: input.unit ?? null, step: input.step ?? 1, target: input.target ?? null, reset: input.reset ?? "daily", color: input.color ?? null }).run();
  logActivity(db, { actor, action: "created", entity: "tracker", entityId: id, summary: `Added tracker "${input.name}"` });
  return getTracker(db, id);
}

export function logTracker(db: Db, id: string, input: typeof TrackerLog._output, actor = "user"): Tracker {
  const t = db.select().from(schema.trackers).where(and(eq(schema.trackers.id, id), isNull(schema.trackers.deletedAt))).get();
  if (!t) throw notFound("Tracker");
  const date = input.date ?? todayString();
  if (input.value !== undefined) {
    // set absolute value for the period
    const current = trackerValue(db, t, date);
    db.insert(schema.trackerEntries).values({ id: newId(), trackerId: id, date, value: input.value - current }).run();
  } else {
    db.insert(schema.trackerEntries).values({ id: newId(), trackerId: id, date, value: input.delta ?? t.step }).run();
  }
  logActivity(db, { actor, action: "logged", entity: "tracker", entityId: id, summary: `${t.name}: ${trackerValue(db, t, date)}${t.unit ? " " + t.unit : ""}` });
  return getTracker(db, id);
}

export function trackersRoutes(app: App): void {
  app.get("/api/trackers", (c) => c.json(listTrackers(c.get("ctx").db)));
  app.post("/api/trackers", async (c) => c.json(createTracker(c.get("ctx").db, await parseBody(c, TrackerCreate), c.get("actor")), 201));
  app.get("/api/trackers/:id", (c) => {
    const { db } = c.get("ctx");
    const t = getTracker(db, c.req.param("id"));
    const history = db.select({ date: schema.trackerEntries.date, value: sql<number>`sum(${schema.trackerEntries.value})` }).from(schema.trackerEntries).where(eq(schema.trackerEntries.trackerId, t.id)).groupBy(schema.trackerEntries.date).orderBy(desc(schema.trackerEntries.date)).limit(90).all();
    return c.json({ ...t, history });
  });
  app.patch("/api/trackers/:id", async (c) => {
    const body = await parseBody(c, TrackerUpdate);
    const { db } = c.get("ctx");
    getTracker(db, c.req.param("id"));
    db.update(schema.trackers).set({ ...body, updatedAt: nowIso() }).where(eq(schema.trackers.id, c.req.param("id"))).run();
    return c.json(getTracker(db, c.req.param("id")));
  });
  app.post("/api/trackers/:id/log", async (c) => c.json(logTracker(c.get("ctx").db, c.req.param("id"), await parseBody(c, TrackerLog), c.get("actor"))));
  app.delete("/api/trackers/:id", (c) => {
    const { db } = c.get("ctx");
    getTracker(db, c.req.param("id"));
    db.update(schema.trackers).set({ deletedAt: nowIso() }).where(eq(schema.trackers.id, c.req.param("id"))).run();
    return c.json({ ok: true });
  });
}
