import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { format, isSameDay } from "date-fns";
import { addDaysString, parseDateString, scheduleTasks, todayString, type ScheduleCandidate, type ScheduleExistingBlock, type ScheduleOutput, type SchedulerPrefs, type SchedulerResult, type Task } from "@aravos/shared";
import type { AppContext } from "../app.ts";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId } from "../lib/ids.ts";
import { parseJson } from "../lib/json.ts";
import { logActivity } from "./activity.ts";
import { createEvent, deleteEvent, listEvents, timeboxCalendarId, updateEvent } from "./calendar.ts";
import { getSchedulerPrefs } from "./settings.ts";
import { withBlocks } from "./tasks.ts";

export type SchedulerTrigger = "manual" | "mcp" | "auto" | "agent";

export interface RunSchedulerOptions {
  trigger: SchedulerTrigger;
  dryRun?: boolean;
  horizonDays?: number;
  /** restrict to these tasks (optional) */
  taskIds?: string[];
}

export type EstimateSource = "task" | "history" | "ai" | "default";

export interface TaskEstimate {
  taskId: string;
  minutes: number;
  source: EstimateSource;
}

export interface SchedulerRunRow {
  id: string;
  ranAt: string;
  trigger: string;
  placed: number;
  moved: number;
  unplaced: number;
  summary: string;
  details: RunDetails;
}

export interface SchedulerStats {
  historyCount: number;
  calibrationFactor: number;
  meanAbsErrorMinutes: number | null;
  lastRun: SchedulerRunRow | null;
}

interface RunDetails {
  text: string;
  horizonDays: number;
  dryRun: boolean;
  blocks: number;
  created: number;
  removed: number;
  atRisk: string[];
  unplaced: { taskId: string; reason: string }[];
  durationMs: number;
}

type HistoryRow = typeof schema.durationHistory.$inferSelect;

const ACTOR = "scheduler";
const SOURCE = "scheduler";
const CALIBRATION_SAMPLES = 20;
const CALIBRATION_SHRINK = 5;
const MIN_LIST_SAMPLES = 3;
const TITLE_OVERLAP = 0.5;
const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "about", "task", "todo"]);

export function triggerForActor(actor: string): SchedulerTrigger {
  if (actor === "agent") return "agent";
  if (actor.startsWith("mcp")) return "mcp";
  return "manual";
}

// ---------- learning ----------

function loadHistory(db: Db, limit = 500): HistoryRow[] {
  return db.select().from(schema.durationHistory).orderBy(desc(schema.durationHistory.completedAt)).limit(limit).all();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

function overlap(words: Set<string>, other: Set<string>): number {
  if (words.size === 0) return 0;
  let common = 0;
  for (const w of words) if (other.has(w)) common += 1;
  return common / words.size;
}

/** Median actual minutes of similar past tasks: matching titles first, then the same list. */
export function learnedEstimate(task: Pick<Task, "title" | "listId">, history: HistoryRow[]): number | null {
  const words = titleWords(task.title);
  const byTitle = history.filter((h) => overlap(words, titleWords(h.title)) >= TITLE_OVERLAP);
  if (byTitle.length > 0) return Math.round(median(byTitle.map((h) => h.actualMinutes)));
  if (task.listId) {
    const byList = history.filter((h) => h.listId === task.listId);
    if (byList.length >= MIN_LIST_SAMPLES) return Math.round(median(byList.map((h) => h.actualMinutes)));
  }
  return null;
}

/** Median of actual/estimate over recent history, shrunk toward 1 for small samples and clamped to [0.75, 2]. */
export function calibrationFactor(history: HistoryRow[]): number {
  const ratios = history
    .filter((h) => typeof h.estimateMinutes === "number" && h.estimateMinutes > 0 && h.actualMinutes > 0)
    .slice(0, CALIBRATION_SAMPLES)
    .map((h) => h.actualMinutes / (h.estimateMinutes as number));
  if (ratios.length === 0) return 1;
  const n = ratios.length;
  const shrunk = (n * median(ratios) + CALIBRATION_SHRINK) / (n + CALIBRATION_SHRINK);
  return Math.min(2, Math.max(0.75, Math.round(shrunk * 100) / 100));
}

async function aiEstimates(ctx: AppContext, tasks: Task[], history: HistoryRow[]): Promise<Record<string, number>> {
  if (!ctx.ai.enabled || tasks.length === 0) return {};
  try {
    return await ctx.ai.estimateDurations({
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, notes: t.notes, tags: t.tags })),
      history: history.slice(0, 50).map((h) => ({ title: h.title, estimateMinutes: h.estimateMinutes, actualMinutes: h.actualMinutes })),
    });
  } catch (e) {
    console.warn("[scheduler] AI estimates failed:", e instanceof Error ? e.message : e);
    return {};
  }
}

async function estimateFor(ctx: AppContext, tasks: Task[], history: HistoryRow[], prefs: SchedulerPrefs): Promise<Map<string, TaskEstimate>> {
  const out = new Map<string, TaskEstimate>();
  const needAi: Task[] = [];
  for (const t of tasks) {
    if (t.estimateMinutes && t.estimateMinutes > 0) {
      out.set(t.id, { taskId: t.id, minutes: t.estimateMinutes, source: "task" });
      continue;
    }
    const learned = learnedEstimate(t, history);
    if (learned && learned > 0) out.set(t.id, { taskId: t.id, minutes: learned, source: "history" });
    else needAi.push(t);
  }
  const ai = await aiEstimates(ctx, needAi, history);
  for (const t of needAi) {
    const n = ai[t.id];
    if (typeof n === "number" && Number.isFinite(n) && n > 0) out.set(t.id, { taskId: t.id, minutes: Math.round(n), source: "ai" });
    else out.set(t.id, { taskId: t.id, minutes: prefs.defaultEstimateMinutes, source: "default" });
  }
  return out;
}

/** Estimate minutes for tasks: own estimate, then history, then AI, then the default. */
export async function estimateTasks(ctx: AppContext, taskIds: string[]): Promise<TaskEstimate[]> {
  if (taskIds.length === 0) return [];
  const rows = ctx.db
    .select()
    .from(schema.tasks)
    .where(and(inArray(schema.tasks.id, taskIds), isNull(schema.tasks.deletedAt)))
    .all();
  const tasks = withBlocks(ctx.db, rows);
  const estimates = await estimateFor(ctx, tasks, loadHistory(ctx.db), getSchedulerPrefs(ctx.db));
  return taskIds.map((id) => estimates.get(id)).filter((e): e is TaskEstimate => e !== undefined);
}

// ---------- candidates ----------

function loadCandidates(db: Db, lastDay: string, taskIds?: string[]): Task[] {
  if (taskIds && taskIds.length === 0) return [];
  const t = schema.tasks;
  const hasTimebox = sql`exists (select 1 from events e where e.task_id = ${t.id} and e.deleted_at is null and e.status = 'confirmed' and e.kind = 'timebox')`;
  const conds = [isNull(t.deletedAt), isNull(t.parentId), eq(t.status, "open"), or(lte(t.dueDate, lastDay), lte(t.startDate, lastDay), hasTimebox)!];
  if (taskIds) conds.push(inArray(t.id, taskIds));
  const rows = db
    .select()
    .from(t)
    .where(and(...conds))
    .orderBy(asc(t.createdAt), asc(t.id))
    .all();
  return withBlocks(db, rows);
}

function loadExistingBlocks(db: Db, taskIds: string[], horizonEnd?: Date): Map<string, ScheduleExistingBlock[]> {
  const map = new Map<string, ScheduleExistingBlock[]>();
  if (taskIds.length === 0) return map;
  const e = schema.events;
  const rows = db
    .select({ id: e.id, taskId: e.taskId, start: e.start, end: e.end, locked: e.locked })
    .from(e)
    .where(and(inArray(e.taskId, taskIds), isNull(e.deletedAt), eq(e.status, "confirmed"), eq(e.kind, "timebox"), eq(e.allDay, false)))
    .orderBy(asc(e.start))
    .all();
  for (const r of rows) {
    if (!r.taskId) continue;
    // Blocks beyond the planning horizon are kept as they are (treated as locked) rather than pulled forward.
    const locked = r.locked || (horizonEnd !== undefined && r.start >= horizonEnd.toISOString());
    map.set(r.taskId, [...(map.get(r.taskId) ?? []), { id: r.id, start: r.start, end: r.end, locked }]);
  }
  return map;
}

function busyIntervals(db: Db, now: Date, horizonEnd: Date, candidateIds: Set<string>): { start: string; end: string }[] {
  return listEvents(db, { from: now.toISOString(), to: horizonEnd.toISOString() })
    .filter((e) => !e.allDay && e.status !== "cancelled")
    .filter((e) => !(e.kind === "timebox" && e.taskId && candidateIds.has(e.taskId)))
    .map((e) => ({ start: e.start, end: e.end }));
}

const snapUpTo = (minutes: number, snap: number): number => Math.max(snap, Math.ceil(minutes / snap) * snap);

function toCandidate(task: Task, estimate: TaskEstimate, factor: number, prefs: SchedulerPrefs, blocks: ScheduleExistingBlock[]): ScheduleCandidate {
  const raw = estimate.source === "task" ? estimate.minutes * factor : estimate.minutes;
  return {
    id: task.id,
    title: task.title,
    estimateMinutes: snapUpTo(raw, prefs.snapMinutes),
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    startDate: task.startDate,
    priority: task.priority,
    createdAt: task.createdAt,
    existingBlocks: blocks,
  };
}

// ---------- applying the plan ----------

interface Applied {
  eventIds: Map<string, string>;
  moved: number;
  created: number;
  removed: number;
}

function applyPlan(db: Db, plan: ScheduleOutput, titles: Map<string, string>, existing: Map<string, ScheduleExistingBlock[]>): Applied {
  const byId = new Map<string, ScheduleExistingBlock>();
  for (const blocks of existing.values()) for (const b of blocks) byId.set(b.id, b);
  const calendarId = timeboxCalendarId(db);
  const applied: Applied = { eventIds: new Map(), moved: 0, created: 0, removed: 0 };
  for (const p of plan.placements) {
    const title = titles.get(p.taskId) ?? "Task";
    for (const b of p.blocks) {
      if (b.existingBlockId === null) {
        const ev = createEvent(db, { title, taskId: p.taskId, kind: "timebox", calendarId, start: b.start, end: b.end, source: SOURCE }, ACTOR);
        applied.eventIds.set(`${p.taskId}|${b.start}`, ev.id);
        applied.created += 1;
        continue;
      }
      applied.eventIds.set(`${p.taskId}|${b.start}`, b.existingBlockId);
      const prev = byId.get(b.existingBlockId);
      if (prev && Date.parse(prev.start) === Date.parse(b.start) && Date.parse(prev.end) === Date.parse(b.end)) continue;
      updateEvent(db, b.existingBlockId, { start: b.start, end: b.end, title }, ACTOR);
      applied.moved += 1;
    }
  }
  for (const id of plan.removedBlockIds) {
    deleteEvent(db, id, ACTOR);
    applied.removed += 1;
  }
  return applied;
}

// ---------- summary ----------

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function dayLabel(d: Date, now: Date): string {
  if (isSameDay(d, now)) return "today";
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameDay(d, tomorrow)) return "tomorrow";
  const days = (d.getTime() - now.getTime()) / 86400000;
  return days < 6 ? format(d, "EEEE") : format(d, "EEEE d MMM");
}

function buildSummary(args: { placedTasks: number; blocks: number; lastEnd: Date | null; atRisk: number; unplaced: number; moved: number; removed: number; dryRun: boolean; now: Date }): string {
  const parts: string[] = [];
  if (args.placedTasks === 0 && args.unplaced === 0) parts.push("Nothing to schedule.");
  else if (args.placedTasks === 0) parts.push("No tasks could be placed.");
  else parts.push(`Placed ${plural(args.placedTasks, "task")} in ${plural(args.blocks, "block")}${args.lastEnd ? ` through ${dayLabel(args.lastEnd, args.now)}` : ""}.`);
  if (args.atRisk > 0) parts.push(`${plural(args.atRisk, "task")} ${args.atRisk === 1 ? "does" : "do"} not fit before ${args.atRisk === 1 ? "its" : "their"} deadline.`);
  if (args.unplaced > 0) parts.push(`${plural(args.unplaced, "task")} could not be placed.`);
  if (args.moved > 0) parts.push(`Moved ${plural(args.moved, "block")}.`);
  if (args.removed > 0) parts.push(`Removed ${plural(args.removed, "block")} no longer needed.`);
  const text = parts.join(" ");
  return args.dryRun ? `Preview: ${text}` : text;
}

// ---------- runs ----------

function serializeRun(row: typeof schema.schedulerRuns.$inferSelect): SchedulerRunRow {
  const details = parseJson<Partial<RunDetails>>(row.summary, {});
  const full: RunDetails = { text: details.text ?? row.summary, horizonDays: details.horizonDays ?? 0, dryRun: details.dryRun ?? false, blocks: details.blocks ?? 0, created: details.created ?? 0, removed: details.removed ?? 0, atRisk: details.atRisk ?? [], unplaced: details.unplaced ?? [], durationMs: details.durationMs ?? 0 };
  return { id: row.id, ranAt: row.ranAt, trigger: row.trigger, placed: row.placed, moved: row.moved, unplaced: row.unplaced, summary: full.text, details: full };
}

export function listSchedulerRuns(db: Db, limit = 20): SchedulerRunRow[] {
  return db.select().from(schema.schedulerRuns).orderBy(desc(schema.schedulerRuns.ranAt), desc(schema.schedulerRuns.id)).limit(limit).all().map(serializeRun);
}

export function getSchedulerStats(db: Db): SchedulerStats {
  const history = loadHistory(db);
  const withEstimate = history.filter((h) => typeof h.estimateMinutes === "number" && h.estimateMinutes > 0);
  const meanAbsErrorMinutes = withEstimate.length ? Math.round(withEstimate.reduce((sum, h) => sum + Math.abs(h.actualMinutes - (h.estimateMinutes as number)), 0) / withEstimate.length) : null;
  return { historyCount: history.length, calibrationFactor: calibrationFactor(history), meanAbsErrorMinutes, lastRun: listSchedulerRuns(db, 1)[0] ?? null };
}

export async function runScheduler(ctx: AppContext, opts: RunSchedulerOptions): Promise<SchedulerResult> {
  const startedAt = Date.now();
  const { db } = ctx;
  const prefs = getSchedulerPrefs(db);
  const horizonDays = Math.min(30, Math.max(1, opts.horizonDays ?? prefs.horizonDays));
  const dryRun = opts.dryRun ?? false;
  const now = new Date();
  const today = todayString();
  const horizonEnd = parseDateString(addDaysString(today, horizonDays));

  const tasks = loadCandidates(db, addDaysString(today, horizonDays - 1), opts.taskIds);
  const ids = tasks.map((t) => t.id);
  const history = loadHistory(db);
  const estimates = await estimateFor(ctx, tasks, history, prefs);
  const factor = calibrationFactor(history);
  const existing = loadExistingBlocks(db, ids, horizonEnd);
  const candidates = tasks.map((t) => toCandidate(t, estimates.get(t.id) ?? { taskId: t.id, minutes: prefs.defaultEstimateMinutes, source: "default" }, factor, prefs, existing.get(t.id) ?? []));
  const plan = scheduleTasks({ candidates, busy: busyIntervals(db, now, horizonEnd, new Set(ids)), prefs, now, horizonDays });

  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const applied = dryRun ? { eventIds: new Map<string, string>(), moved: 0, created: 0, removed: 0 } : applyPlan(db, plan, titles, existing);

  const placed: SchedulerResult["placed"] = plan.placements.map((p) => ({
    taskId: p.taskId,
    title: titles.get(p.taskId) ?? "Task",
    blocks: p.blocks.map((b) => ({ eventId: applied.eventIds.get(`${p.taskId}|${b.start}`) ?? b.existingBlockId ?? "preview", start: b.start, end: b.end })),
  }));
  const unplaced: SchedulerResult["unplaced"] = plan.unplaced.map((u) => ({ taskId: u.taskId, title: titles.get(u.taskId) ?? "Task", reason: u.reason }));
  const blocks = placed.reduce((n, p) => n + p.blocks.length, 0);
  const lastEndMs = placed.flatMap((p) => p.blocks).reduce<number | null>((max, b) => Math.max(max ?? 0, Date.parse(b.end)), null);
  const summary = buildSummary({ placedTasks: placed.length, blocks, lastEnd: lastEndMs ? new Date(lastEndMs) : null, atRisk: plan.atRisk.length, unplaced: unplaced.length, moved: applied.moved, removed: applied.removed, dryRun, now });
  const result: SchedulerResult = { placed, unplaced, moved: applied.moved, summary };

  if (!dryRun) {
    const details: RunDetails = { text: summary, horizonDays, dryRun, blocks, created: applied.created, removed: applied.removed, atRisk: plan.atRisk.map((a) => a.taskId), unplaced: plan.unplaced, durationMs: Date.now() - startedAt };
    const runId = newId();
    db.insert(schema.schedulerRuns).values({ id: runId, trigger: opts.trigger, placed: placed.length, moved: applied.moved, unplaced: unplaced.length, summary: JSON.stringify(details) }).run();
    logActivity(db, { actor: ACTOR, action: "scheduled", entity: "scheduler", entityId: runId, summary, data: { trigger: opts.trigger, placed: placed.length, blocks, moved: applied.moved, removed: applied.removed, unplaced: unplaced.length, atRisk: details.atRisk } });
  }
  return result;
}

export async function runSchedulerIfEnabled(ctx: AppContext, trigger: SchedulerTrigger): Promise<SchedulerResult | null> {
  if (!getSchedulerPrefs(ctx.db).autoRun) return null;
  return runScheduler(ctx, { trigger });
}
