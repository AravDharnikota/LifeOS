import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { CalendarCreate, CalendarUpdate, EventCreate, EventUpdate } from "@aravos/shared";
import type { App } from "../app.ts";
import { schema } from "../db/client.ts";
import { parseBody, parseQuery } from "../lib/http.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { notFound } from "../lib/errors.ts";
import { createEvent, deleteEvent, getEvent, listEvents, overrideInstance, updateEvent } from "../services/calendar.ts";
import { requestReplan } from "../services/replan.ts";

const RangeQuery = z.object({ from: z.string(), to: z.string(), calendarIds: z.string().optional(), includeCancelled: z.enum(["true", "false"]).optional() });

export function calendarRoutes(app: App): void {
  app.get("/api/calendars", (c) => {
    const { db } = c.get("ctx");
    return c.json(db.select().from(schema.calendars).where(isNull(schema.calendars.deletedAt)).orderBy(asc(schema.calendars.name)).all());
  });
  app.post("/api/calendars", async (c) => {
    const body = await parseBody(c, CalendarCreate);
    const { db } = c.get("ctx");
    const id = newId();
    if (body.isDefault) db.update(schema.calendars).set({ isDefault: false }).run();
    db.insert(schema.calendars).values({ id, name: body.name, color: body.color ?? "blue", isDefault: body.isDefault ?? false, isVisible: body.isVisible ?? true }).run();
    return c.json(db.select().from(schema.calendars).where(eq(schema.calendars.id, id)).get(), 201);
  });
  app.patch("/api/calendars/:id", async (c) => {
    const body = await parseBody(c, CalendarUpdate);
    const { db } = c.get("ctx");
    const id = c.req.param("id");
    if (!db.select().from(schema.calendars).where(and(eq(schema.calendars.id, id), isNull(schema.calendars.deletedAt))).get()) throw notFound("Calendar");
    if (body.isDefault) db.update(schema.calendars).set({ isDefault: false }).run();
    db.update(schema.calendars).set({ ...body, updatedAt: nowIso() }).where(eq(schema.calendars.id, id)).run();
    return c.json(db.select().from(schema.calendars).where(eq(schema.calendars.id, id)).get());
  });
  app.delete("/api/calendars/:id", (c) => {
    const { db } = c.get("ctx");
    const id = c.req.param("id");
    const cal = db.select().from(schema.calendars).where(and(eq(schema.calendars.id, id), isNull(schema.calendars.deletedAt))).get();
    if (!cal) throw notFound("Calendar");
    if (cal.isDefault) return c.json({ error: "The default calendar cannot be deleted" }, 400);
    const now = nowIso();
    db.update(schema.events).set({ deletedAt: now, updatedAt: now }).where(eq(schema.events.calendarId, id)).run();
    db.update(schema.calendars).set({ deletedAt: now, updatedAt: now }).where(eq(schema.calendars.id, id)).run();
    return c.json({ ok: true });
  });

  app.get("/api/events", (c) => {
    const q = parseQuery(c, RangeQuery);
    const { db } = c.get("ctx");
    return c.json(listEvents(db, { from: new Date(q.from).toISOString(), to: new Date(q.to).toISOString(), calendarIds: q.calendarIds?.split(",").filter(Boolean), includeCancelled: q.includeCancelled === "true" }));
  });
  app.post("/api/events", async (c) => {
    const body = await parseBody(c, EventCreate);
    const ev = createEvent(c.get("ctx").db, body, c.get("actor"));
    if (ev.kind !== "timebox") requestReplan(c.get("ctx"));
    return c.json(ev, 201);
  });
  app.get("/api/events/:id", (c) => c.json(getEvent(c.get("ctx").db, c.req.param("id"))));
  app.patch("/api/events/:id", async (c) => {
    const body = await parseBody(c, EventUpdate.extend({ scope: z.enum(["this", "all"]).optional(), originalStart: z.string().optional() }));
    const { scope, originalStart, ...patch } = body;
    const { db } = c.get("ctx");
    const id = c.req.param("id");
    if (scope === "this" && originalStart) {
      const res = overrideInstance(db, id, originalStart, patch, c.get("actor"));
      return c.json(res ?? { ok: true });
    }
    const ev = updateEvent(db, id, patch, c.get("actor"));
    if (ev.kind !== "timebox" || ev.locked) requestReplan(c.get("ctx"));
    return c.json(ev);
  });
  app.delete("/api/events/:id", async (c) => {
    const { db } = c.get("ctx");
    const id = c.req.param("id");
    const originalStart = c.req.query("originalStart");
    if (c.req.query("scope") === "this" && originalStart) {
      overrideInstance(db, id, originalStart, { cancel: true }, c.get("actor"));
      return c.json({ ok: true });
    }
    deleteEvent(db, id, c.get("actor"));
    requestReplan(c.get("ctx"));
    return c.json({ ok: true });
  });
}
