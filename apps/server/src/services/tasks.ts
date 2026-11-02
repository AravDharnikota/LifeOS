import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { RRule } from "rrule";
import { addDaysString, parseDateString, parseTaskInput, toDateString, todayString, type Task, type TaskCreate, type TaskUpdate } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId, nowIso } from "../lib/ids.ts";
import { notFound, badRequest } from "../lib/errors.ts";
import { parseJson } from "../lib/json.ts";
import { logActivity } from "./activity.ts";

type Row = typeof schema.tasks.$inferSelect;

export function serializeTask(row: Row, blocks: { id: string; start: string; end: string }[] = []): Task {
  return {
    id: row.id,
    listId: row.listId,
    parentId: row.parentId,
    goalId: row.goalId,
    title: row.title,
    notes: row.notes,
    status: row.status as Task["status"],
    completedAt: row.completedAt,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    startDate: row.startDate,
    priority: row.priority,
    estimateMinutes: row.estimateMinutes,
    actualMinutes: row.actualMinutes,
    tags: parseJson<string[]>(row.tags, []),
    recurrence: row.recurrence,
    sortOrder: row.sortOrder,
    source: row.source,
    googleId: row.googleId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    scheduledBlocks: blocks,
  };
}

function blocksFor(db: Db, taskIds: string[]): Map<string, { id: string; start: string; end: string }[]> {
  const map = new Map<string, { id: string; start: string; end: string }[]>();
  if (taskIds.length === 0) return map;
  const rows = db
    .select({ id: schema.events.id, taskId: schema.events.taskId, start: schema.events.start, end: schema.events.end })
    .from(schema.events)
    .where(and(inArray(schema.events.taskId, taskIds), isNull(schema.events.deletedAt), eq(schema.events.status, "confirmed")))
    .orderBy(asc(schema.events.start))
    .all();
  for (const r of rows) {
    if (!r.taskId) continue;
    const arr = map.get(r.taskId) ?? [];
    arr.push({ id: r.id, start: r.start, end: r.end });
    map.set(r.taskId, arr);
  }
  return map;
}

export function withBlocks(db: Db, rows: Row[]): Task[] {
  const map = blocksFor(db, rows.map((r) => r.id));
  return rows.map((r) => serializeTask(r, map.get(r.id) ?? []));
}

export type TaskView = "today" | "upcoming" | "inbox" | "all" | "done" | "overdue" | "anytime" | "list";

export function listTasks(db: Db, opts: { view?: TaskView; listId?: string; date?: string; goalId?: string; limit?: number; includeDone?: boolean } = {}): Task[] {
  const today = opts.date ?? todayString();
  const t = schema.tasks;
  const conds = [isNull(t.deletedAt), isNull(t.parentId)];
  const view = opts.view ?? "all";
  if (opts.goalId) conds.push(eq(t.goalId, opts.goalId));
  if (opts.listId) conds.push(eq(t.listId, opts.listId));
  switch (view) {
    case "today":
      conds.push(or(and(eq(t.status, "open"), or(lte(t.dueDate, today), lte(t.startDate, today))), and(eq(t.status, "done"), sql`substr(${t.completedAt}, 1, 10) = ${today}`))!);
      break;
    case "overdue":
      conds.push(eq(t.status, "open"), sql`${t.dueDate} < ${today}`);
      break;
    case "upcoming":
      conds.push(eq(t.status, "open"), or(sql`${t.dueDate} > ${today}`, sql`${t.startDate} > ${today}`)!, sql`${t.dueDate} <= ${addDaysString(today, 30)} OR ${t.startDate} <= ${addDaysString(today, 30)}`);
      break;
    case "anytime":
      conds.push(eq(t.status, "open"), isNull(t.dueDate), isNull(t.startDate));
      break;
    case "inbox":
      conds.push(eq(t.status, "open"));
      break;
    case "done":
      conds.push(eq(t.status, "done"));
      break;
    case "list":
      if (!opts.includeDone) conds.push(eq(t.status, "open"));
      break;
    case "all":
      if (!opts.includeDone) conds.push(eq(t.status, "open"));
      break;
  }
  const q = db
    .select()
    .from(t)
    .where(and(...conds))
    .orderBy(view === "done" ? desc(t.completedAt) : asc(t.sortOrder), asc(t.dueDate), asc(t.dueTime), asc(t.createdAt))
    .limit(opts.limit ?? 500);
  return withBlocks(db, q.all());
}

export function getTask(db: Db, id: string): Task {
  const row = db.select().from(schema.tasks).where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt))).get();
  if (!row) throw notFound("Task");
  const [task] = withBlocks(db, [row]);
  return task!;
}

export function getSubtasks(db: Db, parentId: string): Task[] {
  const rows = db.select().from(schema.tasks).where(and(eq(schema.tasks.parentId, parentId), isNull(schema.tasks.deletedAt))).orderBy(asc(schema.tasks.sortOrder), asc(schema.tasks.createdAt)).all();
  return withBlocks(db, rows);
}

export function defaultListId(db: Db): string | null {
  const row = db.select({ id: schema.taskLists.id }).from(schema.taskLists).where(and(eq(schema.taskLists.isDefault, true), isNull(schema.taskLists.deletedAt))).get();
  return row?.id ?? db.select({ id: schema.taskLists.id }).from(schema.taskLists).where(isNull(schema.taskLists.deletedAt)).orderBy(asc(schema.taskLists.sortOrder)).get()?.id ?? null;
}

export function createTask(db: Db, input: TaskCreate, actor = "user"): Task {
  const id = newId();
  if (input.listId) {
    const list = db.select({ id: schema.taskLists.id }).from(schema.taskLists).where(eq(schema.taskLists.id, input.listId)).get();
    if (!list) throw badRequest("Unknown listId");
  }
  const maxSort = db.select({ m: sql<number>`coalesce(max(${schema.tasks.sortOrder}), 0)` }).from(schema.tasks).get()?.m ?? 0;
  db.insert(schema.tasks)
    .values({
      id,
      title: input.title,
      notes: input.notes ?? null,
      listId: input.listId === undefined ? (input.parentId ? null : defaultListId(db)) : input.listId,
      parentId: input.parentId ?? null,
      goalId: input.goalId ?? null,
      status: input.status ?? "open",
      completedAt: input.status === "done" ? nowIso() : null,
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      startDate: input.startDate ?? null,
      priority: input.priority ?? 0,
      estimateMinutes: input.estimateMinutes ?? null,
      tags: JSON.stringify(input.tags ?? []),
      recurrence: input.recurrence ?? null,
      sortOrder: input.sortOrder ?? maxSort + 1,
      source: input.source ?? (actor === "user" ? "app" : actor),
    })
    .run();
  logActivity(db, { actor, action: "created", entity: "task", entityId: id, summary: `Added task "${input.title}"` });
  return getTask(db, id);
}

export function quickAddTask(db: Db, text: string, extra: Partial<TaskCreate> = {}, actor = "user"): Task {
  const parsed = parseTaskInput(text);
  if (!parsed.title) throw badRequest("Task needs a title");
  return createTask(
    db,
    {
      title: parsed.title,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      priority: parsed.priority,
      estimateMinutes: parsed.estimateMinutes,
      tags: parsed.tags,
      ...extra,
    },
    actor,
  );
}

export function updateTask(db: Db, id: string, input: TaskUpdate, actor = "user"): Task {
  const existing = db.select().from(schema.tasks).where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt))).get();
  if (!existing) throw notFound("Task");
  const set: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: nowIso() };
  for (const k of ["title", "notes", "listId", "parentId", "goalId", "dueDate", "dueTime", "startDate", "priority", "estimateMinutes", "actualMinutes", "recurrence", "sortOrder", "source"] as const) {
    if (input[k] !== undefined) (set as Record<string, unknown>)[k] = input[k];
  }
  if (input.tags !== undefined) set.tags = JSON.stringify(input.tags);
  if (input.status !== undefined && input.status !== existing.status) {
    if (input.status === "done") return completeTask(db, id, { actualMinutes: input.actualMinutes ?? undefined }, actor);
    if (existing.status === "done" && input.status === "open") {
      set.status = "open";
      set.completedAt = null;
    } else {
      set.status = input.status;
      if (input.status === "cancelled") set.completedAt = nowIso();
    }
  }
  if (input.completedAt !== undefined) set.completedAt = input.completedAt;
  db.update(schema.tasks).set(set).where(eq(schema.tasks.id, id)).run();
  logActivity(db, { actor, action: "updated", entity: "task", entityId: id, summary: `Updated task "${set.title ?? existing.title}"`, data: input });
  return getTask(db, id);
}

/** Minutes of time boxes for a task that are in the past (what was actually spent, approximately). */
export function timeboxedMinutes(db: Db, taskId: string, until = new Date()): number {
  const rows = db.select({ start: schema.events.start, end: schema.events.end }).from(schema.events).where(and(eq(schema.events.taskId, taskId), isNull(schema.events.deletedAt), eq(schema.events.status, "confirmed"))).all();
  let total = 0;
  for (const r of rows) {
    const s = new Date(r.start).getTime();
    const e = Math.min(new Date(r.end).getTime(), until.getTime());
    if (e > s) total += (e - s) / 60000;
  }
  return Math.round(total);
}

export function completeTask(db: Db, id: string, opts: { actualMinutes?: number } = {}, actor = "user"): Task {
  const existing = db.select().from(schema.tasks).where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt))).get();
  if (!existing) throw notFound("Task");
  const now = nowIso();
  const actual = opts.actualMinutes ?? existing.actualMinutes ?? (timeboxedMinutes(db, id) || null);
  db.update(schema.tasks).set({ status: "done", completedAt: now, updatedAt: now, actualMinutes: actual }).where(eq(schema.tasks.id, id)).run();
  // Remove future time boxes for this task
  db.update(schema.events)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(schema.events.taskId, id), eq(schema.events.kind, "timebox"), isNull(schema.events.deletedAt), sql`${schema.events.start} > ${now}`))
    .run();
  if (actual && actual > 0) {
    db.insert(schema.durationHistory)
      .values({ id: newId(), taskId: id, title: existing.title, tags: existing.tags, listId: existing.listId, estimateMinutes: existing.estimateMinutes, actualMinutes: actual, completedAt: now })
      .run();
  }
  logActivity(db, { actor, action: "completed", entity: "task", entityId: id, summary: `Completed "${existing.title}"` });
  // Recurrence: spawn the next occurrence
  if (existing.recurrence && existing.dueDate) {
    try {
      const rule = RRule.fromString(existing.recurrence.startsWith("DTSTART") || existing.recurrence.startsWith("RRULE") ? existing.recurrence : `RRULE:${existing.recurrence}`);
      const base = parseDateString(existing.dueDate);
      const next = new RRule({ ...rule.origOptions, dtstart: base }).after(base, false);
      if (next) {
        createTask(
          db,
          {
            title: existing.title,
            notes: existing.notes,
            listId: existing.listId,
            goalId: existing.goalId,
            dueDate: toDateString(next),
            dueTime: existing.dueTime,
            priority: existing.priority,
            estimateMinutes: existing.estimateMinutes,
            tags: parseJson<string[]>(existing.tags, []),
            recurrence: existing.recurrence,
            source: existing.source,
          },
          "system",
        );
      }
    } catch (e) {
      console.warn("Could not compute next recurrence for task", id, e instanceof Error ? e.message : e);
    }
  }
  return getTask(db, id);
}

export function deleteTask(db: Db, id: string, actor = "user"): void {
  const existing = db.select().from(schema.tasks).where(and(eq(schema.tasks.id, id), isNull(schema.tasks.deletedAt))).get();
  if (!existing) throw notFound("Task");
  const now = nowIso();
  db.update(schema.tasks).set({ deletedAt: now, updatedAt: now }).where(or(eq(schema.tasks.id, id), eq(schema.tasks.parentId, id))).run();
  db.update(schema.events).set({ deletedAt: now, updatedAt: now }).where(and(eq(schema.events.taskId, id), isNull(schema.events.deletedAt))).run();
  logActivity(db, { actor, action: "deleted", entity: "task", entityId: id, summary: `Deleted task "${existing.title}"` });
}

export function reorderTasks(db: Db, ids: string[]): void {
  const now = nowIso();
  db.transaction((tx) => {
    ids.forEach((id, i) => {
      tx.update(schema.tasks).set({ sortOrder: i + 1, updatedAt: now }).where(eq(schema.tasks.id, id)).run();
    });
  });
}

export function countOpenTasks(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(schema.tasks).where(and(isNull(schema.tasks.deletedAt), eq(schema.tasks.status, "open"), isNull(schema.tasks.parentId))).get()?.n ?? 0;
}

export function tasksDoneOn(db: Db, date: string): number {
  return db.select({ n: sql<number>`count(*)` }).from(schema.tasks).where(and(isNull(schema.tasks.deletedAt), eq(schema.tasks.status, "done"), sql`substr(${schema.tasks.completedAt},1,10) = ${date}`)).get()?.n ?? 0;
}

export function searchTasks(db: Db, q: string, limit = 20): Task[] {
  const rows = db
    .select()
    .from(schema.tasks)
    .where(and(isNull(schema.tasks.deletedAt), sql`lower(${schema.tasks.title}) like ${"%" + q.toLowerCase() + "%"}`))
    .orderBy(desc(schema.tasks.updatedAt))
    .limit(limit)
    .all();
  return withBlocks(db, rows);
}

export { gte };
