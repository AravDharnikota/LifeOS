import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { hhmm, isoDate, todayString, type Task, type TaskUpdate } from "@aravos/shared";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { badRequest } from "../lib/errors.ts";
import { completeTask, createTask, deleteTask, getSubtasks, getTask, listTasks, quickAddTask, searchTasks, updateTask } from "../services/tasks.ts";
import { defineTool, type ToolDef } from "./types.ts";

const TASK_VIEWS = ["today", "upcoming", "inbox", "all", "done", "overdue", "anytime", "list"] as const;
const TASK_STATUS = ["open", "done", "cancelled"] as const;

const taskId = z.string().min(1).describe("Task id (from list_tasks or search_tasks)");
const priority = z.number().int().min(0).max(3).describe("0 none, 1 low, 2 medium, 3 high");
const tags = z.array(z.string().trim().min(1).max(40)).max(20);
const recurrence = z.string().max(500).describe("RRULE such as FREQ=WEEKLY;BYDAY=MO or FREQ=DAILY; the next occurrence is created when the task is completed");

/** Compact task row for lists: no notes, ids included for follow-up calls. */
export function compactTask(t: Task) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    listId: t.listId,
    dueDate: t.dueDate,
    dueTime: t.dueTime,
    startDate: t.startDate,
    priority: t.priority,
    estimateMinutes: t.estimateMinutes,
    actualMinutes: t.actualMinutes,
    tags: t.tags,
    goalId: t.goalId,
    parentId: t.parentId,
    recurrence: t.recurrence,
    completedAt: t.completedAt,
    scheduledBlocks: t.scheduledBlocks ?? [],
  };
}

function listsWithCounts(db: Db) {
  const rows = db.select().from(schema.taskLists).where(isNull(schema.taskLists.deletedAt)).orderBy(asc(schema.taskLists.sortOrder)).all();
  const counts = db
    .select({ listId: schema.tasks.listId, n: sql<number>`count(*)` })
    .from(schema.tasks)
    .where(and(isNull(schema.tasks.deletedAt), eq(schema.tasks.status, "open"), isNull(schema.tasks.parentId)))
    .groupBy(schema.tasks.listId)
    .all();
  const byList = new Map(counts.map((c) => [c.listId, c.n]));
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, isDefault: r.isDefault, openCount: byList.get(r.id) ?? 0 }));
}

function resolveListId(db: Db, input: { listId?: string; listName?: string }): string | undefined {
  if (input.listId) return input.listId;
  if (!input.listName) return undefined;
  const lists = listsWithCounts(db);
  const wanted = input.listName.trim().toLowerCase();
  const match = lists.find((l) => l.name.toLowerCase() === wanted);
  if (!match) throw badRequest(`Unknown list "${input.listName}". Available lists: ${lists.map((l) => l.name).join(", ")}`);
  return match.id;
}

const listTasksTool = defineTool({
  name: "list_tasks",
  description:
    "List tasks in a built-in view. Views: today (open tasks due or started on or before the date, plus tasks completed that day; the default), overdue, upcoming (next 30 days), inbox (every open task), anytime (open tasks with no dates), done, all, list (one list; pass listId). q searches titles instead of using a view. date is a YYYY-MM-DD local date and defaults to today. Rows are compact and omit notes; call get_task for the full record.",
  input: z.object({
    view: z.enum(TASK_VIEWS).optional().describe("Built-in view; default today"),
    listId: z.string().optional().describe("Restrict to one list (ids from list_task_lists)"),
    q: z.string().trim().min(1).max(200).optional().describe("Case-insensitive title search; overrides view"),
    date: isoDate.optional().describe("Reference date for the today, overdue and upcoming views, YYYY-MM-DD local; default today"),
    limit: z.number().int().min(1).max(100).optional().describe("Maximum rows, default 50"),
  }),
  readOnly: true,
  handler: (i, { ctx }) => {
    const limit = i.limit ?? 50;
    if (i.q) {
      const tasks = searchTasks(ctx.db, i.q, limit);
      return { q: i.q, count: tasks.length, tasks: tasks.map(compactTask) };
    }
    const view = i.view ?? (i.listId ? "list" : "today");
    const date = i.date ?? todayString();
    const tasks = listTasks(ctx.db, { view, listId: i.listId, date, limit });
    return { view, date, count: tasks.length, tasks: tasks.map(compactTask) };
  },
});

const getTaskTool = defineTool({
  name: "get_task",
  description: "Get one task with its notes, scheduled time boxes and subtasks.",
  input: z.object({ id: taskId }),
  readOnly: true,
  handler: ({ id }, { ctx }) => {
    const task = getTask(ctx.db, id);
    return { ...compactTask(task), notes: task.notes, source: task.source, createdAt: task.createdAt, updatedAt: task.updatedAt, subtasks: getSubtasks(ctx.db, id).map(compactTask) };
  },
});

const addTaskTool = defineTool({
  name: "add_task",
  description:
    "Create a task. dueDate and startDate are YYYY-MM-DD local dates, dueTime is HH:mm (24h local) and needs dueDate. startDate is when the task should start showing up (Things-style); use dueDate for hard deadlines. The task goes to the default list (Inbox) unless listName or listId is given. For loose natural language such as \"call mom tomorrow 5pm !high\" use quick_add_task instead.",
  input: z.object({
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(10000).optional(),
    dueDate: isoDate.optional().describe("YYYY-MM-DD local"),
    dueTime: hhmm.optional().describe("HH:mm local, requires dueDate"),
    startDate: isoDate.optional().describe("YYYY-MM-DD local"),
    priority: priority.optional(),
    estimateMinutes: z.number().int().min(1).max(1440).optional().describe("Estimated effort; the scheduler uses it to size time boxes"),
    listName: z.string().max(100).optional().describe("List name such as Inbox, Personal or Work (see list_task_lists)"),
    listId: z.string().optional(),
    tags: tags.optional(),
    recurrence: recurrence.optional(),
    goalId: z.string().optional().describe("Link the task to a goal"),
  }),
  handler: (i, { ctx, actor }) => {
    if (i.dueTime && !i.dueDate) throw badRequest("dueTime needs dueDate");
    const listId = resolveListId(ctx.db, i);
    const task = createTask(
      ctx.db,
      { title: i.title, notes: i.notes, dueDate: i.dueDate, dueTime: i.dueTime, startDate: i.startDate, priority: i.priority, estimateMinutes: i.estimateMinutes, tags: i.tags, recurrence: i.recurrence, goalId: i.goalId, listId },
      actor,
    );
    return compactTask(task);
  },
});

const quickAddTaskTool = defineTool({
  name: "quick_add_task",
  description:
    "Create a task from one line of natural language. Understands dates and times (tomorrow, next monday, nov 12, 4pm), priority (!high, !low), estimates (30m, 2h) and #tags, for example \"Call dentist tomorrow 4pm !high 30m #health\". Returns the parsed task.",
  input: z.object({ text: z.string().trim().min(1).max(500), listName: z.string().max(100).optional().describe("Target list name; default Inbox") }),
  handler: (i, { ctx, actor }) => {
    const listId = resolveListId(ctx.db, { listName: i.listName });
    return compactTask(quickAddTask(ctx.db, i.text, listId ? { listId } : {}, actor));
  },
});

const updateTaskTool = defineTool({
  name: "update_task",
  description:
    "Update fields of a task. Only the fields you pass change; pass null to clear dueDate, dueTime, startDate, estimateMinutes, recurrence, goalId or notes. tags replaces the whole tag list. Use complete_task and reopen_task to change completion state, or set status here.",
  input: z.object({
    id: taskId,
    title: z.string().trim().min(1).max(500).optional(),
    notes: z.string().max(10000).nullable().optional(),
    dueDate: isoDate.nullable().optional().describe("YYYY-MM-DD local; null clears"),
    dueTime: hhmm.nullable().optional().describe("HH:mm local; null clears"),
    startDate: isoDate.nullable().optional().describe("YYYY-MM-DD local; null clears"),
    priority: priority.optional(),
    estimateMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    actualMinutes: z.number().int().min(0).nullable().optional(),
    listName: z.string().max(100).optional(),
    listId: z.string().optional(),
    tags: tags.optional(),
    recurrence: recurrence.nullable().optional(),
    goalId: z.string().nullable().optional(),
    status: z.enum(TASK_STATUS).optional(),
  }),
  handler: (i, { ctx, actor }) => {
    const { id, listName, listId: rawListId, ...rest } = i;
    const patch: TaskUpdate = { ...rest };
    const listId = resolveListId(ctx.db, { listId: rawListId, listName });
    if (listId) patch.listId = listId;
    return compactTask(updateTask(ctx.db, id, patch, actor));
  },
});

const completeTaskTool = defineTool({
  name: "complete_task",
  description: "Mark a task done. Future time boxes for it are removed and, for recurring tasks, the next occurrence is created. actualMinutes records how long it really took.",
  input: z.object({ id: taskId, actualMinutes: z.number().int().min(0).max(1440).optional() }),
  handler: ({ id, actualMinutes }, { ctx, actor }) => {
    const task = completeTask(ctx.db, id, { actualMinutes }, actor);
    return { ...compactTask(task), nextOccurrenceCreated: Boolean(task.recurrence && task.dueDate) };
  },
});

const reopenTaskTool = defineTool({
  name: "reopen_task",
  description: "Reopen a completed or cancelled task.",
  input: z.object({ id: taskId }),
  handler: ({ id }, { ctx, actor }) => compactTask(updateTask(ctx.db, id, { status: "open" }, actor)),
});

const deleteTaskTool = defineTool({
  name: "delete_task",
  description: "Delete a task and its subtasks and time boxes. Prefer complete_task or update_task with status cancelled when the task still has meaning.",
  input: z.object({ id: taskId }),
  destructive: true,
  handler: ({ id }, { ctx, actor }) => {
    deleteTask(ctx.db, id, actor);
    return { ok: true, id };
  },
});

const listTaskListsTool = defineTool({
  name: "list_task_lists",
  description: "List task lists (Inbox, Personal, Work, ...) with their ids and open task counts.",
  input: z.object({}),
  readOnly: true,
  handler: (_i, { ctx }) => ({ lists: listsWithCounts(ctx.db) }),
});

const searchTasksTool = defineTool({
  name: "search_tasks",
  description: "Search tasks by title substring (case-insensitive), including completed ones. Most recently updated first.",
  input: z.object({ q: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(100).optional().describe("Default 20") }),
  readOnly: true,
  handler: ({ q, limit }, { ctx }) => {
    const tasks = searchTasks(ctx.db, q, limit ?? 20);
    return { q, count: tasks.length, tasks: tasks.map(compactTask) };
  },
});

export const tasksTools: ToolDef[] = [listTasksTool, getTaskTool, addTaskTool, quickAddTaskTool, updateTaskTool, completeTaskTool, reopenTaskTool, deleteTaskTool, listTaskListsTool, searchTasksTool];
