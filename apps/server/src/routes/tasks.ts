import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { TaskCreate, TaskUpdate, TaskListCreate, TaskListUpdate, isoDate } from "@aravos/shared";
import type { App } from "../app.ts";
import { schema } from "../db/client.ts";
import { parseBody, parseQuery } from "../lib/http.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { notFound } from "../lib/errors.ts";
import { completeTask, createTask, deleteTask, getSubtasks, getTask, listTasks, quickAddTask, reorderTasks, searchTasks, updateTask, type TaskView } from "../services/tasks.ts";

const ListQuery = z.object({
  view: z.enum(["today", "upcoming", "inbox", "all", "done", "overdue", "anytime", "list"]).optional(),
  listId: z.string().optional(),
  goalId: z.string().optional(),
  date: isoDate.optional(),
  includeDone: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  q: z.string().optional(),
});

export function tasksRoutes(app: App): void {
  app.get("/api/tasks", (c) => {
    const q = parseQuery(c, ListQuery);
    const { db } = c.get("ctx");
    if (q.q) return c.json(searchTasks(db, q.q, q.limit ?? 20));
    return c.json(listTasks(db, { view: q.view as TaskView, listId: q.listId, goalId: q.goalId, date: q.date, includeDone: q.includeDone === "true", limit: q.limit }));
  });

  app.post("/api/tasks", async (c) => {
    const body = await parseBody(c, TaskCreate);
    return c.json(createTask(c.get("ctx").db, body, c.get("actor")), 201);
  });

  app.post("/api/tasks/quick", async (c) => {
    const body = await parseBody(c, z.object({ text: z.string().trim().min(1).max(500), listId: z.string().nullable().optional() }));
    return c.json(quickAddTask(c.get("ctx").db, body.text, body.listId !== undefined ? { listId: body.listId } : {}, c.get("actor")), 201);
  });

  app.post("/api/tasks/reorder", async (c) => {
    const body = await parseBody(c, z.object({ ids: z.array(z.string()).max(2000) }));
    reorderTasks(c.get("ctx").db, body.ids);
    return c.json({ ok: true });
  });

  app.get("/api/tasks/:id", (c) => {
    const { db } = c.get("ctx");
    const task = getTask(db, c.req.param("id"));
    return c.json({ ...task, subtasks: getSubtasks(db, task.id) });
  });

  app.patch("/api/tasks/:id", async (c) => {
    const body = await parseBody(c, TaskUpdate);
    return c.json(updateTask(c.get("ctx").db, c.req.param("id"), body, c.get("actor")));
  });

  app.post("/api/tasks/:id/complete", async (c) => {
    const body = await parseBody(c, z.object({ actualMinutes: z.number().int().min(0).optional() }).optional()).catch(() => ({}) as { actualMinutes?: number });
    return c.json(completeTask(c.get("ctx").db, c.req.param("id"), { actualMinutes: body?.actualMinutes }, c.get("actor")));
  });

  app.post("/api/tasks/:id/reopen", (c) => c.json(updateTask(c.get("ctx").db, c.req.param("id"), { status: "open" }, c.get("actor"))));

  app.delete("/api/tasks/:id", (c) => {
    deleteTask(c.get("ctx").db, c.req.param("id"), c.get("actor"));
    return c.json({ ok: true });
  });

  // ---- lists ----
  app.get("/api/lists", (c) => {
    const { db } = c.get("ctx");
    const rows = db.select().from(schema.taskLists).where(isNull(schema.taskLists.deletedAt)).orderBy(asc(schema.taskLists.sortOrder)).all();
    const counts = db
      .select({ listId: schema.tasks.listId, n: schema.tasks.id })
      .from(schema.tasks)
      .where(and(isNull(schema.tasks.deletedAt), eq(schema.tasks.status, "open"), isNull(schema.tasks.parentId)))
      .all();
    const byList = new Map<string, number>();
    for (const r of counts) if (r.listId) byList.set(r.listId, (byList.get(r.listId) ?? 0) + 1);
    return c.json(rows.map((r) => ({ ...r, openCount: byList.get(r.id) ?? 0 })));
  });

  app.post("/api/lists", async (c) => {
    const body = await parseBody(c, TaskListCreate);
    const { db } = c.get("ctx");
    const id = newId();
    db.insert(schema.taskLists).values({ id, name: body.name, color: body.color ?? null, sortOrder: body.sortOrder ?? 99 }).run();
    return c.json(db.select().from(schema.taskLists).where(eq(schema.taskLists.id, id)).get(), 201);
  });

  app.patch("/api/lists/:id", async (c) => {
    const body = await parseBody(c, TaskListUpdate);
    const { db } = c.get("ctx");
    const id = c.req.param("id");
    const existing = db.select().from(schema.taskLists).where(and(eq(schema.taskLists.id, id), isNull(schema.taskLists.deletedAt))).get();
    if (!existing) throw notFound("List");
    db.update(schema.taskLists).set({ ...body, updatedAt: nowIso() }).where(eq(schema.taskLists.id, id)).run();
    return c.json(db.select().from(schema.taskLists).where(eq(schema.taskLists.id, id)).get());
  });

  app.delete("/api/lists/:id", (c) => {
    const { db } = c.get("ctx");
    const id = c.req.param("id");
    const existing = db.select().from(schema.taskLists).where(and(eq(schema.taskLists.id, id), isNull(schema.taskLists.deletedAt))).get();
    if (!existing) throw notFound("List");
    if (existing.isDefault) return c.json({ error: "The default list cannot be deleted" }, 400);
    const now = nowIso();
    const inbox = db.select({ id: schema.taskLists.id }).from(schema.taskLists).where(eq(schema.taskLists.isDefault, true)).get();
    db.update(schema.tasks).set({ listId: inbox?.id ?? null, updatedAt: now }).where(eq(schema.tasks.listId, id)).run();
    db.update(schema.taskLists).set({ deletedAt: now, updatedAt: now }).where(eq(schema.taskLists.id, id)).run();
    return c.json({ ok: true });
  });
}
