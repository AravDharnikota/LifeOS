import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { AppContext } from "../app.ts";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId } from "../lib/ids.ts";
import { GoogleApiError, type GoogleClient } from "./api.ts";
import { toIso } from "./calendar-sync.ts";
import { GoogleAuthError } from "./oauth.ts";
import { TASKS_PROVIDER, errorMessage, getSyncState, minIso, upsertSyncState } from "./state.ts";
import type { GoogleTask, GoogleTaskInput, GoogleTaskList, ResolvedDeps, SyncOptions, SyncStats } from "./types.ts";

type ListRow = typeof schema.taskLists.$inferSelect;
type TaskRow = typeof schema.tasks.$inferSelect;
type ApplyResult = "created" | "updated" | "deleted" | "skipped";

const PULL_OVERLAP_MS = 5 * 60 * 1000;
const INBOX_NAME = "inbox";

function activeLists(db: Db): ListRow[] {
  return db.select().from(schema.taskLists).where(isNull(schema.taskLists.deletedAt)).orderBy(asc(schema.taskLists.sortOrder)).all();
}

/** Links Google task lists to local ones: the default list maps to Inbox, others match by id, then by name, else are created. */
function linkTaskLists(db: Db, remote: GoogleTaskList[], nowIso: string): ListRow[] {
  const first = remote[0];
  const local = activeLists(db);
  const inbox = local.find((l) => l.isDefault && !l.googleId) ?? local.find((l) => l.name.trim().toLowerCase() === INBOX_NAME && !l.googleId);
  if (first && inbox && !local.some((l) => l.googleId === first.id)) {
    db.update(schema.taskLists).set({ googleId: first.id, updatedAt: nowIso }).where(eq(schema.taskLists.id, inbox.id)).run();
  }
  for (const entry of remote) {
    const current = activeLists(db);
    const title = entry.title?.trim() || "Untitled list";
    const byId = current.find((l) => l.googleId === entry.id);
    if (byId) {
      if (byId.name !== title && !byId.isDefault) db.update(schema.taskLists).set({ name: title, updatedAt: nowIso }).where(eq(schema.taskLists.id, byId.id)).run();
      continue;
    }
    const byName = current.find((l) => !l.googleId && l.name.trim().toLowerCase() === title.toLowerCase());
    if (byName) {
      db.update(schema.taskLists).set({ googleId: entry.id, updatedAt: nowIso }).where(eq(schema.taskLists.id, byName.id)).run();
      continue;
    }
    const maxSort = current.reduce((m, l) => Math.max(m, l.sortOrder), 0);
    db.insert(schema.taskLists).values({ id: newId(), name: title, googleId: entry.id, sortOrder: maxSort + 1 }).run();
  }
  return activeLists(db);
}

async function createRemoteLists(db: Db, client: GoogleClient, lists: ListRow[], nowIso: string): Promise<Set<string>> {
  const created = new Set<string>();
  for (const list of lists) {
    if (list.googleId || list.isDefault || list.name.trim().toLowerCase() === INBOX_NAME) continue;
    const remote = await client.insertTaskList(list.name);
    db.update(schema.taskLists).set({ googleId: remote.id, updatedAt: nowIso }).where(eq(schema.taskLists.id, list.id)).run();
    created.add(remote.id);
  }
  return created;
}

interface RemoteTaskFields {
  title: string;
  notes: string | null;
  status: string;
  completedAt: string | null;
  dueDate: string | null;
}

function mapRemoteTask(item: GoogleTask, nowIso: string): RemoteTaskFields {
  const done = item.status === "completed";
  return {
    title: item.title?.trim() || "(No title)",
    notes: item.notes ?? null,
    status: done ? "done" : "open",
    completedAt: done ? (toIso(item.completed) ?? nowIso) : null,
    dueDate: item.due ? item.due.slice(0, 10) : null,
  };
}

function nextSortOrder(db: Db): number {
  return (db.select({ m: sql<number>`coalesce(max(${schema.tasks.sortOrder}), 0)` }).from(schema.tasks).get()?.m ?? 0) + 1;
}

function findTaskByGoogleId(db: Db, googleId: string): TaskRow | null {
  return db.select().from(schema.tasks).where(eq(schema.tasks.googleId, googleId)).get() ?? null;
}

function applyRemoteTask(db: Db, list: ListRow, googleListId: string, item: GoogleTask, nowIso: string): ApplyResult {
  const remoteUpdated = toIso(item.updated) ?? nowIso;
  const local = findTaskByGoogleId(db, item.id);
  const stamp = { googleEtag: item.etag ?? null, googleListId, updatedAt: minIso(remoteUpdated, nowIso) };
  if (item.deleted) {
    if (!local || local.deletedAt) return "skipped";
    db.update(schema.tasks).set({ ...stamp, deletedAt: nowIso }).where(eq(schema.tasks.id, local.id)).run();
    return "deleted";
  }
  if (!local) {
    db.insert(schema.tasks)
      .values({ id: newId(), listId: list.id, ...mapRemoteTask(item, nowIso), sortOrder: nextSortOrder(db), source: "google", googleId: item.id, ...stamp })
      .run();
    return "created";
  }
  if (local.googleEtag && local.googleEtag === item.etag) return "skipped";
  if (remoteUpdated <= local.updatedAt) return "skipped";
  db.update(schema.tasks)
    .set({ ...mapRemoteTask(item, nowIso), listId: list.id, deletedAt: null, ...stamp })
    .where(eq(schema.tasks.id, local.id))
    .run();
  return "updated";
}

function resolveParents(db: Db, parents: Map<string, string | undefined>): void {
  for (const [googleId, parentGoogleId] of parents) {
    const local = findTaskByGoogleId(db, googleId);
    if (!local) continue;
    const parent = parentGoogleId ? findTaskByGoogleId(db, parentGoogleId) : null;
    const parentId = parent && !parent.deletedAt ? parent.id : null;
    if (local.parentId !== parentId) db.update(schema.tasks).set({ parentId }).where(eq(schema.tasks.id, local.id)).run();
  }
}

async function pullTasks(ctx: AppContext, client: GoogleClient, deps: ResolvedDeps, list: ListRow, googleListId: string, full: boolean, stats: SyncStats): Promise<Set<string>> {
  const db = ctx.db;
  const state = getSyncState(db, TASKS_PROVIDER, googleListId);
  const since = full ? null : (state?.syncToken ?? null);
  const updatedMin = since ? new Date(Date.parse(since) - PULL_OVERLAP_MS).toISOString() : undefined;
  const items: GoogleTask[] = [];
  let pageToken: string | undefined;
  do {
    const page = await client.listTasks(googleListId, { updatedMin, showCompleted: true, showHidden: true, showDeleted: true, pageToken });
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  const nowIso = deps.now().toISOString();
  const pulled = new Set<string>();
  const parents = new Map<string, string | undefined>();
  let maxUpdated = since;
  for (const item of items) {
    if (!item.id) continue;
    const updated = toIso(item.updated);
    if (updated && (!maxUpdated || updated > maxUpdated)) maxUpdated = updated;
    const result = applyRemoteTask(db, list, googleListId, item, nowIso);
    if (result === "skipped") continue;
    stats.tasksPulled += 1;
    pulled.add(item.id);
    if (!item.deleted) parents.set(item.id, item.parent);
  }
  resolveParents(db, parents);
  upsertSyncState(db, TASKS_PROVIDER, googleListId, { localId: list.id, syncToken: maxUpdated, lastError: null });
  return pulled;
}

function toGoogleTask(row: TaskRow, nowIso: string): GoogleTaskInput {
  const done = row.status !== "open";
  return {
    title: row.title,
    notes: row.notes ?? "",
    status: done ? "completed" : "needsAction",
    due: row.dueDate ? `${row.dueDate}T00:00:00.000Z` : null,
    completed: done ? (row.completedAt ?? nowIso) : null,
  };
}

function withoutNulls(body: GoogleTaskInput): GoogleTaskInput {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)) as GoogleTaskInput;
}

function candidateTasks(db: Db, list: ListRow, since: string | null): TaskRow[] {
  const t = schema.tasks;
  const inList = db.select({ id: t.id }).from(t).where(eq(t.listId, list.id));
  const scope = or(eq(t.listId, list.id), inArray(t.parentId, inList));
  const rows = db
    .select()
    .from(t)
    .where(since ? and(scope, gt(t.updatedAt, since)) : scope)
    .orderBy(asc(t.sortOrder), asc(t.createdAt))
    .all();
  return [...rows.filter((r) => !r.parentId), ...rows.filter((r) => r.parentId)];
}

function writePushedTask(db: Db, id: string, res: GoogleTask, googleListId: string, nowIso: string): void {
  db.update(schema.tasks)
    .set({ googleId: res.id, googleEtag: res.etag ?? null, googleListId, updatedAt: minIso(toIso(res.updated) ?? nowIso, nowIso) })
    .where(eq(schema.tasks.id, id))
    .run();
}

interface PushContext {
  ctx: AppContext;
  client: GoogleClient;
  deps: ResolvedDeps;
  list: ListRow;
  googleListId: string;
  stats: SyncStats;
}

function remoteParentFor(db: Db, row: TaskRow): string | undefined {
  if (!row.parentId) return undefined;
  const parent = db.select().from(schema.tasks).where(eq(schema.tasks.id, row.parentId)).get();
  return parent && !parent.deletedAt && parent.googleId ? parent.googleId : undefined;
}

async function pushTask(p: PushContext, row: TaskRow): Promise<void> {
  const db = p.ctx.db;
  const nowIso = p.deps.now().toISOString();
  if (row.deletedAt) {
    if (!row.googleId) return;
    await p.client.deleteTask(row.googleListId ?? p.googleListId, row.googleId);
    db.update(schema.tasks).set({ googleEtag: null }).where(eq(schema.tasks.id, row.id)).run();
    p.stats.tasksPushed += 1;
    return;
  }
  const parent = remoteParentFor(db, row);
  const body = toGoogleTask(row, nowIso);
  const movedLists = Boolean(row.googleId && row.googleListId && row.googleListId !== p.googleListId);
  if (!row.googleId || movedLists) {
    if (movedLists) await p.client.deleteTask(row.googleListId!, row.googleId!);
    const res = await p.client.insertTask(p.googleListId, withoutNulls(body), parent);
    writePushedTask(db, row.id, res, p.googleListId, nowIso);
    p.stats.tasksPushed += 1;
    return;
  }
  let res: GoogleTask;
  try {
    res = await p.client.patchTask(p.googleListId, row.googleId, body);
  } catch (e) {
    if (e instanceof GoogleApiError && (e.isNotFound || e.isGone)) {
      db.update(schema.tasks).set({ deletedAt: nowIso, googleEtag: null }).where(eq(schema.tasks.id, row.id)).run();
      return;
    }
    throw e;
  }
  if ((res.parent ?? undefined) !== parent) {
    try {
      res = await p.client.moveTask(p.googleListId, row.googleId, parent);
    } catch {
      // Google refuses some moves (recurring or nested tasks); the parent change stays local.
    }
  }
  writePushedTask(db, row.id, res, p.googleListId, nowIso);
  p.stats.tasksPushed += 1;
}

async function pushTasks(p: PushContext, justPulled: Set<string>): Promise<void> {
  const db = p.ctx.db;
  const state = getSyncState(db, TASKS_PROVIDER, p.googleListId);
  const rows = candidateTasks(db, p.list, state?.lastSyncedAt ?? null);
  for (const row of rows) {
    if (row.googleId && justPulled.has(row.googleId)) continue;
    try {
      await pushTask(p, row);
    } catch (e) {
      if (e instanceof GoogleAuthError) throw e;
      p.stats.errors.push(`Task "${row.title}": ${errorMessage(e)}`);
    }
  }
  upsertSyncState(db, TASKS_PROVIDER, p.googleListId, { localId: p.list.id, lastSyncedAt: p.deps.now().toISOString() });
}

export async function syncTasks(ctx: AppContext, client: GoogleClient, deps: ResolvedDeps, opts: SyncOptions, stats: SyncStats): Promise<void> {
  const db = ctx.db;
  const remote = await client.taskLists();
  const nowIso = deps.now().toISOString();
  const created = await createRemoteLists(db, client, linkTaskLists(db, remote, nowIso), nowIso);
  const known = new Set([...remote.map((l) => l.id), ...created]);
  for (const list of activeLists(db)) {
    if (!list.googleId || !known.has(list.googleId)) continue;
    const p: PushContext = { ctx, client, deps, list, googleListId: list.googleId, stats };
    try {
      const justPulled = await pullTasks(ctx, client, deps, list, list.googleId, Boolean(opts.full), stats);
      await pushTasks(p, justPulled);
    } catch (e) {
      if (e instanceof GoogleAuthError) throw e;
      const message = errorMessage(e);
      stats.errors.push(`Task list "${list.name}": ${message}`);
      upsertSyncState(db, TASKS_PROVIDER, list.googleId, { localId: list.id, lastError: message });
    }
  }
}
