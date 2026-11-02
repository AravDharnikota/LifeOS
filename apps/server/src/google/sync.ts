import { and, eq, isNull } from "drizzle-orm";
import type { AppContext } from "../app.ts";
import { schema } from "../db/client.ts";
import { HttpError, badRequest } from "../lib/errors.ts";
import { GoogleClient } from "./api.ts";
import { syncCalendars } from "./calendar-sync.ts";
import { GoogleAuthError, clearTokens, getTokens, isGoogleConfigured } from "./oauth.ts";
import { clearSyncState, emptyStats, errorMessage, getGoogleDeps, getSyncStatus, resolveDeps, setSyncStatus } from "./state.ts";
import { syncTasks } from "./tasks-sync.ts";
import type { GoogleDeps, GoogleStatus, SyncOptions, SyncStats } from "./types.ts";

const running = new WeakSet<AppContext>();

/** Runs a calendar + tasks sync and returns stats. Throws only when Google is not connected or a sync is already running. */
export async function runGoogleSync(ctx: AppContext, opts: SyncOptions = {}, deps?: GoogleDeps): Promise<SyncStats> {
  if (!getTokens(ctx.db)) throw badRequest("Google is not connected");
  if (running.has(ctx)) throw new HttpError(409, "A Google sync is already running");
  running.add(ctx);
  const resolved = resolveDeps(deps);
  const stats = emptyStats();
  let aborted = false;
  try {
    const client = new GoogleClient(ctx, resolved);
    const sections: [string, () => Promise<void>][] = [
      ["Calendar", () => syncCalendars(ctx, client, resolved, opts, stats)],
      ["Tasks", () => syncTasks(ctx, client, resolved, opts, stats)],
    ];
    for (const [label, run] of sections) {
      if (aborted) break;
      try {
        await run();
      } catch (e) {
        if (e instanceof GoogleAuthError) {
          aborted = true;
          stats.errors.push(e.message);
        } else {
          stats.errors.push(`${label} sync failed: ${errorMessage(e)}`);
        }
      }
    }
  } finally {
    running.delete(ctx);
  }
  const patch: Parameters<typeof setSyncStatus>[1] = { lastError: stats.errors[0] ?? null, lastStats: stats };
  if (!aborted) patch.lastSyncedAt = resolved.now().toISOString();
  setSyncStatus(ctx.db, patch);
  return stats;
}

/** Periodic entry point: no-ops when Google is not connected and never throws. */
export async function syncAllGoogle(ctx: AppContext): Promise<void> {
  try {
    if (!isGoogleConfigured(ctx.env) || !getTokens(ctx.db) || running.has(ctx)) return;
    await runGoogleSync(ctx, {}, getGoogleDeps(ctx));
  } catch (e) {
    console.warn("[google] sync failed:", errorMessage(e));
  }
}

/** Forgets the Google account but keeps local copies of synced events and tasks. */
export function disconnectGoogle(ctx: AppContext): void {
  clearTokens(ctx.db);
  clearSyncState(ctx.db);
  ctx.db.update(schema.calendars).set({ syncEnabled: false, updatedAt: new Date().toISOString() }).where(eq(schema.calendars.kind, "google")).run();
  setSyncStatus(ctx.db, { lastSyncedAt: null, lastError: null, lastStats: null, primaryCalendarId: null });
}

/** Re-enables sync on Google calendars after a fresh connect (disconnect switched them off). */
export function enableGoogleCalendars(ctx: AppContext): void {
  ctx.db.update(schema.calendars).set({ syncEnabled: true, updatedAt: new Date().toISOString() }).where(and(eq(schema.calendars.kind, "google"), isNull(schema.calendars.deletedAt))).run();
}

export function googleStatus(ctx: AppContext): GoogleStatus {
  const tokens = getTokens(ctx.db);
  const status = getSyncStatus(ctx.db);
  const calendars = ctx.db
    .select({ id: schema.calendars.id, name: schema.calendars.name, syncEnabled: schema.calendars.syncEnabled })
    .from(schema.calendars)
    .where(and(eq(schema.calendars.kind, "google"), isNull(schema.calendars.deletedAt)))
    .all();
  const tasksLists = ctx.db
    .select({ id: schema.taskLists.id, name: schema.taskLists.name, googleId: schema.taskLists.googleId })
    .from(schema.taskLists)
    .where(isNull(schema.taskLists.deletedAt))
    .all();
  return {
    configured: isGoogleConfigured(ctx.env),
    connected: Boolean(tokens),
    email: tokens?.email ?? null,
    lastSyncedAt: status.lastSyncedAt,
    lastError: status.lastError,
    calendars,
    tasksLists,
  };
}
