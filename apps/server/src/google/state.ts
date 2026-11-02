import { eq } from "drizzle-orm";
import type { AppContext } from "../app.ts";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { getRawSetting, setSetting } from "../services/settings.ts";
import type { GoogleDeps, GoogleSyncStatus, ResolvedDeps, SyncStats } from "./types.ts";

export const CALENDAR_PROVIDER = "google_calendar";
export const TASKS_PROVIDER = "google_tasks";
export const SYNC_STATUS_KEY = "google_sync_status";

type SyncStateRow = typeof schema.syncState.$inferSelect;
type SyncStatePatch = Partial<Pick<SyncStateRow, "localId" | "syncToken" | "lastSyncedAt" | "lastError">>;

const depsByContext = new WeakMap<AppContext, GoogleDeps>();

export function setGoogleDeps(ctx: AppContext, deps: GoogleDeps | null): void {
  if (deps) depsByContext.set(ctx, deps);
  else depsByContext.delete(ctx);
}

export function getGoogleDeps(ctx: AppContext): GoogleDeps {
  return depsByContext.get(ctx) ?? {};
}

export function resolveDeps(deps: GoogleDeps = {}): ResolvedDeps {
  return {
    fetchImpl: deps.fetchImpl ?? ((input, init) => globalThis.fetch(input, init)),
    now: deps.now ?? (() => new Date()),
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

export function syncStateId(provider: string, remoteId: string): string {
  return `${provider}:${remoteId}`;
}

export function getSyncState(db: Db, provider: string, remoteId: string): SyncStateRow | null {
  return db.select().from(schema.syncState).where(eq(schema.syncState.id, syncStateId(provider, remoteId))).get() ?? null;
}

export function upsertSyncState(db: Db, provider: string, remoteId: string, patch: SyncStatePatch): void {
  const id = syncStateId(provider, remoteId);
  db.insert(schema.syncState)
    .values({ id, provider, remoteId, ...patch })
    .onConflictDoUpdate({ target: schema.syncState.id, set: patch })
    .run();
}

export function clearSyncState(db: Db): void {
  db.delete(schema.syncState).run();
}

export function emptyStats(): SyncStats {
  return { calendars: 0, eventsPulled: 0, eventsPushed: 0, tasksPulled: 0, tasksPushed: 0, errors: [] };
}

export function getSyncStatus(db: Db): GoogleSyncStatus {
  const raw = getRawSetting(db, SYNC_STATUS_KEY);
  const obj = raw && typeof raw === "object" ? (raw as Partial<GoogleSyncStatus>) : {};
  return {
    lastSyncedAt: typeof obj.lastSyncedAt === "string" ? obj.lastSyncedAt : null,
    lastError: typeof obj.lastError === "string" ? obj.lastError : null,
    lastStats: obj.lastStats && typeof obj.lastStats === "object" ? obj.lastStats : null,
    primaryCalendarId: typeof obj.primaryCalendarId === "string" ? obj.primaryCalendarId : null,
  };
}

export function setSyncStatus(db: Db, patch: Partial<GoogleSyncStatus>): void {
  setSetting(db, SYNC_STATUS_KEY, { ...getSyncStatus(db), ...patch });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function minIso(a: string, b: string): string {
  return a < b ? a : b;
}
