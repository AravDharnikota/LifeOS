import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { AppContext } from "../app.ts";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import { newId } from "../lib/ids.ts";
import { getRawSetting } from "../services/settings.ts";
import { GoogleApiError, type GoogleClient } from "./api.ts";
import { GoogleAuthError } from "./oauth.ts";
import { CALENDAR_PROVIDER, errorMessage, getSyncState, minIso, setSyncStatus, upsertSyncState } from "./state.ts";
import type { EventListParams, GoogleCalendarListEntry, GoogleEvent, GoogleEventInput, GoogleEventTime, ResolvedDeps, SyncOptions, SyncStats } from "./types.ts";

type CalendarRow = typeof schema.calendars.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;
type EventInsert = typeof schema.events.$inferInsert;
type ApplyResult = "created" | "updated" | "deleted" | "skipped";

const PULL_PAST_DAYS = 30;
const PULL_FUTURE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEBOX_MARKER = "timebox";

const PALETTE: Record<string, string> = {
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
  pink: "#ec4899",
  purple: "#a855f7",
  gray: "#6b7280",
};
const COLOR_ID_TO_PALETTE: Record<string, string> = { "1": "blue", "2": "green", "3": "purple", "4": "pink", "5": "yellow", "6": "orange", "7": "blue", "8": "gray", "9": "blue", "10": "green", "11": "red" };
const PALETTE_TO_COLOR_ID: Record<string, string> = { blue: "9", green: "10", yellow: "5", orange: "6", red: "11", pink: "4", purple: "3", gray: "8" };

function parseHex(hex: string | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function nearestPaletteColor(hex: string | undefined): string {
  const rgb = parseHex(hex);
  if (!rgb) return "blue";
  let best = "blue";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [name, value] of Object.entries(PALETTE)) {
    const p = parseHex(value)!;
    const d = (p[0] - rgb[0]) ** 2 + (p[1] - rgb[1]) ** 2 + (p[2] - rgb[2]) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = name;
    }
  }
  return best;
}

export function colorIdToPalette(colorId: string | undefined): string | null {
  return colorId ? (COLOR_ID_TO_PALETTE[colorId] ?? null) : null;
}

export function paletteToColorId(color: string | null): string | undefined {
  return color ? PALETTE_TO_COLOR_ID[color] : undefined;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

interface LocalTimes {
  start: string;
  end: string;
  allDay: boolean;
  timezone: string | null;
}

/** Google all-day end dates are exclusive; local ones are inclusive. */
export function remoteTimes(item: GoogleEvent): LocalTimes | null {
  const s = item.start;
  const e = item.end;
  if (!s) return null;
  if (s.date) {
    const start = s.date;
    const end = addDays(e?.date ?? addDays(start, 1), -1);
    return { start, end: end < start ? start : end, allDay: true, timezone: null };
  }
  if (s.dateTime) {
    const start = toIso(s.dateTime);
    const end = toIso(e?.dateTime ?? s.dateTime);
    if (!start || !end) return null;
    return { start, end: end <= start ? new Date(Date.parse(start) + 60_000).toISOString() : end, allDay: false, timezone: s.timeZone ?? null };
  }
  return null;
}

export function googleTimes(row: Pick<EventRow, "start" | "end" | "allDay" | "timezone">, fallbackTimeZone: string): { start: GoogleEventTime; end: GoogleEventTime } {
  if (row.allDay) return { start: { date: row.start.slice(0, 10) }, end: { date: addDays(row.end.slice(0, 10), 1) } };
  const timeZone = row.timezone ?? fallbackTimeZone;
  return { start: { dateTime: row.start, timeZone }, end: { dateTime: row.end, timeZone } };
}

export function recurrenceLines(rrule: string): string[] {
  return rrule
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("DTSTART"))
    .map((l) => (/^(RRULE|EXDATE|RDATE|EXRULE)[:;]/.test(l) ? l : `RRULE:${l}`));
}

export function rruleFromRecurrence(lines: string[] | undefined): string | null {
  const line = lines?.find((l) => l.startsWith("RRULE:"));
  return line ? line.slice("RRULE:".length) : null;
}

function originalStartIso(item: GoogleEvent): string | null {
  const o = item.originalStartTime;
  if (!o) return null;
  if (o.date) return o.date;
  return toIso(o.dateTime);
}

/** Google names recurring instances `<masterId>_<basic UTC stamp>`. */
export function instanceIdFor(masterGoogleId: string, originalStart: string, allDay: boolean): string {
  const stamp = allDay ? originalStart.slice(0, 10).replace(/-/g, "") : originalStart.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${masterGoogleId}_${stamp}`;
}

function isTimeboxMirror(item: GoogleEvent): boolean {
  return item.extendedProperties?.private?.aravos === TIMEBOX_MARKER;
}

function mirrorTimeboxesEnabled(db: Db): boolean {
  const app = getRawSetting(db, "app");
  return Boolean(app && typeof app === "object" && (app as { mirrorTimeboxes?: unknown }).mirrorTimeboxes === true);
}

interface RemoteEventFields {
  title: string;
  notes: string | null;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
  timezone: string | null;
  color: string | null;
  status: string;
  rrule: string | null;
}

function mapRemoteFields(item: GoogleEvent, times: LocalTimes): RemoteEventFields {
  return {
    title: item.summary?.trim() || "(No title)",
    notes: item.description ?? null,
    location: item.location ?? null,
    start: times.start,
    end: times.end,
    allDay: times.allDay,
    timezone: times.timezone,
    color: colorIdToPalette(item.colorId),
    status: item.status === "tentative" ? "tentative" : "confirmed",
    rrule: rruleFromRecurrence(item.recurrence),
  };
}

export function toGoogleEvent(row: EventRow, fallbackTimeZone: string): GoogleEventInput {
  const times = googleTimes(row, fallbackTimeZone);
  const body: GoogleEventInput = {
    summary: row.title,
    description: row.notes ?? "",
    location: row.location ?? "",
    start: times.start,
    end: times.end,
    status: row.status === "cancelled" ? "cancelled" : row.status === "tentative" ? "tentative" : "confirmed",
  };
  const colorId = paletteToColorId(row.color);
  if (colorId) body.colorId = colorId;
  if (row.rrule && !row.recurrenceParentId) body.recurrence = recurrenceLines(row.rrule);
  if (row.kind === "timebox") {
    body.transparency = "transparent";
    body.reminders = { useDefault: false };
    body.extendedProperties = { private: { aravos: TIMEBOX_MARKER, taskId: row.taskId ?? "" } };
  }
  return body;
}

function findByGoogleId(db: Db, googleId: string, googleCalendarId: string): EventRow | null {
  return db.select().from(schema.events).where(and(eq(schema.events.googleId, googleId), eq(schema.events.googleCalendarId, googleCalendarId))).get() ?? null;
}

function findLocalMaster(db: Db, masterGoogleId: string, googleCalendarId: string): EventRow | null {
  const row = findByGoogleId(db, masterGoogleId, googleCalendarId);
  return row && row.rrule && !row.deletedAt ? row : null;
}

function writePulled(db: Db, id: string, set: Partial<EventInsert>, item: GoogleEvent, googleCalendarId: string, remoteUpdated: string, nowIso: string): void {
  db.update(schema.events)
    .set({ ...set, googleEtag: item.etag ?? null, googleCalendarId, updatedAt: minIso(remoteUpdated, nowIso) })
    .where(eq(schema.events.id, id))
    .run();
}

function softDeleteLocal(db: Db, local: EventRow, item: GoogleEvent, googleCalendarId: string, remoteUpdated: string, nowIso: string): ApplyResult {
  if (local.recurrenceParentId) {
    if (local.status === "cancelled") return "skipped";
    writePulled(db, local.id, { status: "cancelled" }, item, googleCalendarId, remoteUpdated, nowIso);
    return "deleted";
  }
  if (local.deletedAt) return "skipped";
  writePulled(db, local.id, { deletedAt: nowIso }, item, googleCalendarId, remoteUpdated, nowIso);
  return "deleted";
}

/** Applies a remote event to a known local row using last-writer-wins on `updated`. */
export function applyRemoteToRow(db: Db, local: EventRow, item: GoogleEvent, googleCalendarId: string, nowIso: string): ApplyResult {
  const remoteUpdated = toIso(item.updated) ?? nowIso;
  if (item.status === "cancelled") return softDeleteLocal(db, local, item, googleCalendarId, remoteUpdated, nowIso);
  if (local.googleEtag && local.googleEtag === item.etag) return "skipped";
  if (remoteUpdated <= local.updatedAt) return "skipped";
  const times = remoteTimes(item);
  if (!times) return "skipped";
  if (isTimeboxMirror(item) || local.kind === "timebox") {
    const moved = times.start !== local.start || times.end !== local.end;
    writePulled(db, local.id, { start: times.start, end: times.end, allDay: times.allDay, locked: moved ? true : local.locked, deletedAt: null }, item, googleCalendarId, remoteUpdated, nowIso);
    return "updated";
  }
  writePulled(db, local.id, { ...mapRemoteFields(item, times), deletedAt: null }, item, googleCalendarId, remoteUpdated, nowIso);
  return "updated";
}

function insertRemote(db: Db, cal: CalendarRow, googleCalendarId: string, item: GoogleEvent, times: LocalTimes, nowIso: string, extra: Partial<EventInsert> = {}): void {
  const remoteUpdated = toIso(item.updated) ?? nowIso;
  db.insert(schema.events)
    .values({
      id: newId(),
      calendarId: cal.id,
      ...mapRemoteFields(item, times),
      kind: "event",
      source: "google",
      googleId: item.id,
      googleEtag: item.etag ?? null,
      googleCalendarId,
      originalStart: originalStartIso(item),
      updatedAt: minIso(remoteUpdated, nowIso),
      ...extra,
    })
    .run();
}

/** Pulls the master of a locally owned series when Google reports a newer version of it. */
async function refreshLocalMaster(client: GoogleClient, db: Db, master: EventRow, googleCalendarId: string, nowIso: string): Promise<EventRow> {
  if (!master.googleId) return master;
  try {
    const remote = await client.getEvent(googleCalendarId, master.googleId);
    if (applyRemoteToRow(db, master, remote, googleCalendarId, nowIso) === "skipped") return master;
    return db.select().from(schema.events).where(eq(schema.events.id, master.id)).get() ?? master;
  } catch {
    return master;
  }
}

function sameAsMaster(master: EventRow, item: GoogleEvent, times: LocalTimes, originalStart: string): boolean {
  const masterDuration = master.allDay ? 0 : Date.parse(master.end) - Date.parse(master.start);
  const itemDuration = times.allDay ? 0 : Date.parse(times.end) - Date.parse(times.start);
  return (
    times.start === originalStart &&
    masterDuration === itemDuration &&
    (item.summary?.trim() || "(No title)") === master.title &&
    (item.description ?? null) === master.notes &&
    (item.location ?? null) === master.location &&
    (item.status === "tentative" ? "tentative" : "confirmed") === master.status
  );
}

/** An instance of a series we own: unchanged instances are ignored, changed ones become local exceptions. */
async function applyInstanceOfLocalMaster(client: GoogleClient, db: Db, cal: CalendarRow, googleCalendarId: string, master: EventRow, item: GoogleEvent, nowIso: string, refreshed: Set<string>): Promise<ApplyResult> {
  const originalStart = originalStartIso(item);
  if (!originalStart) return "skipped";
  const existing = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.recurrenceParentId, master.id), eq(schema.events.originalStart, originalStart)))
    .get();
  if (existing) return applyRemoteToRow(db, existing, item, googleCalendarId, nowIso);
  if (item.status === "cancelled") {
    const times = remoteTimes(item) ?? { start: originalStart, end: originalStart, allDay: master.allDay, timezone: master.timezone };
    insertRemote(db, cal, googleCalendarId, item, times, nowIso, { status: "cancelled", recurrenceParentId: master.id, originalStart, rrule: null, kind: master.kind, taskId: master.taskId });
    return "deleted";
  }
  const times = remoteTimes(item);
  if (!times) return "skipped";
  let current = master;
  if (!refreshed.has(master.id)) {
    refreshed.add(master.id);
    current = await refreshLocalMaster(client, db, master, googleCalendarId, nowIso);
  }
  if (sameAsMaster(current, item, times, originalStart)) return "skipped";
  insertRemote(db, cal, googleCalendarId, item, times, nowIso, { recurrenceParentId: current.id, originalStart, rrule: null, kind: current.kind, taskId: current.taskId });
  return "updated";
}

async function applyRemoteEvent(client: GoogleClient, db: Db, cal: CalendarRow, googleCalendarId: string, item: GoogleEvent, nowIso: string, refreshed: Set<string>): Promise<ApplyResult> {
  const local = findByGoogleId(db, item.id, googleCalendarId);
  if (local) return applyRemoteToRow(db, local, item, googleCalendarId, nowIso);
  if (item.recurringEventId) {
    const master = findLocalMaster(db, item.recurringEventId, googleCalendarId);
    if (master) return applyInstanceOfLocalMaster(client, db, cal, googleCalendarId, master, item, nowIso, refreshed);
  }
  if (item.status === "cancelled" || isTimeboxMirror(item)) return "skipped";
  const times = remoteTimes(item);
  if (!times) return "skipped";
  insertRemote(db, cal, googleCalendarId, item, times, nowIso);
  return "created";
}

function upsertCalendars(db: Db, entries: GoogleCalendarListEntry[], nowIso: string): { calendars: CalendarRow[]; primaryGoogleId: string | null } {
  for (const entry of entries) {
    if (entry.deleted) continue;
    const name = entry.summaryOverride?.trim() || entry.summary?.trim() || entry.id;
    const color = nearestPaletteColor(entry.backgroundColor);
    const existing = db.select().from(schema.calendars).where(eq(schema.calendars.googleId, entry.id)).get();
    if (existing) {
      if (existing.deletedAt) continue;
      if (existing.name !== name || existing.color !== color || existing.kind !== "google") {
        db.update(schema.calendars).set({ name, color, kind: "google", updatedAt: nowIso }).where(eq(schema.calendars.id, existing.id)).run();
      }
      continue;
    }
    db.insert(schema.calendars).values({ id: newId(), name, color, kind: "google", isDefault: false, isVisible: entry.selected ?? true, googleId: entry.id, syncEnabled: true }).run();
  }
  const ids = new Set(entries.filter((e) => !e.deleted).map((e) => e.id));
  const calendars = db
    .select()
    .from(schema.calendars)
    .where(and(eq(schema.calendars.kind, "google"), isNull(schema.calendars.deletedAt)))
    .all()
    .filter((c) => c.googleId && ids.has(c.googleId));
  return { calendars, primaryGoogleId: entries.find((e) => e.primary)?.id ?? null };
}

async function pullPages(client: GoogleClient, db: Db, cal: CalendarRow, googleCalendarId: string, syncToken: string | null, deps: ResolvedDeps, pulled: Set<string>, stats: SyncStats): Promise<string | null> {
  const now = deps.now().getTime();
  const base: EventListParams = syncToken
    ? { syncToken, singleEvents: true }
    : { singleEvents: true, showDeleted: true, timeMin: new Date(now - PULL_PAST_DAYS * DAY_MS).toISOString(), timeMax: new Date(now + PULL_FUTURE_DAYS * DAY_MS).toISOString() };
  const refreshed = new Set<string>();
  let pageToken: string | undefined;
  let next: string | null = null;
  do {
    const page = await client.listEvents(googleCalendarId, { ...base, pageToken });
    for (const item of page.items ?? []) {
      if (!item.id) continue;
      const result = await applyRemoteEvent(client, db, cal, googleCalendarId, item, deps.now().toISOString(), refreshed);
      if (result === "skipped") continue;
      stats.eventsPulled += 1;
      pulled.add(item.id);
    }
    pageToken = page.nextPageToken;
    if (page.nextSyncToken) next = page.nextSyncToken;
  } while (pageToken);
  return next;
}

async function pullCalendar(ctx: AppContext, client: GoogleClient, deps: ResolvedDeps, cal: CalendarRow, googleCalendarId: string, full: boolean, stats: SyncStats): Promise<Set<string>> {
  const db = ctx.db;
  const state = getSyncState(db, CALENDAR_PROVIDER, googleCalendarId);
  let syncToken = full ? null : (state?.syncToken ?? null);
  const pulled = new Set<string>();
  for (let round = 0; round < 2; round += 1) {
    try {
      const next = await pullPages(client, db, cal, googleCalendarId, syncToken, deps, pulled, stats);
      upsertSyncState(db, CALENDAR_PROVIDER, googleCalendarId, { localId: cal.id, syncToken: next ?? syncToken, lastError: null });
      return pulled;
    } catch (e) {
      if (!(e instanceof GoogleApiError && e.isGone && syncToken)) throw e;
      syncToken = null;
      upsertSyncState(db, CALENDAR_PROVIDER, googleCalendarId, { localId: cal.id, syncToken: null });
    }
  }
  return pulled;
}

function writePushed(db: Db, id: string, res: GoogleEvent, googleCalendarId: string, nowIso: string): void {
  db.update(schema.events)
    .set({ googleId: res.id, googleEtag: res.etag ?? null, googleCalendarId, updatedAt: minIso(toIso(res.updated) ?? nowIso, nowIso) })
    .where(eq(schema.events.id, id))
    .run();
}

function candidateRows(db: Db, cal: CalendarRow, since: string | null, includeTimeboxes: boolean): EventRow[] {
  const e = schema.events;
  const own = and(eq(e.calendarId, cal.id), eq(e.kind, "event"));
  const scope = includeTimeboxes ? or(own, eq(e.kind, "timebox")) : own;
  const rows = db
    .select()
    .from(e)
    .where(since ? and(scope, gt(e.updatedAt, since)) : scope)
    .all();
  return [...rows.filter((r) => !r.recurrenceParentId), ...rows.filter((r) => r.recurrenceParentId)];
}

interface PushContext {
  ctx: AppContext;
  client: GoogleClient;
  deps: ResolvedDeps;
  cal: CalendarRow;
  googleCalendarId: string;
  stats: SyncStats;
}

async function resolveConflict(p: PushContext, row: EventRow, target: string, body: GoogleEventInput): Promise<void> {
  const db = p.ctx.db;
  const nowIso = p.deps.now().toISOString();
  const remote = await p.client.getEvent(target, row.googleId!);
  const remoteUpdated = toIso(remote.updated) ?? nowIso;
  if (remote.status === "cancelled" || remoteUpdated > row.updatedAt) {
    if (applyRemoteToRow(db, row, remote, target, nowIso) !== "skipped") p.stats.eventsPulled += 1;
    return;
  }
  const res = await p.client.patchEvent(target, row.googleId!, body, remote.etag ?? null);
  writePushed(db, row.id, res, target, nowIso);
  p.stats.eventsPushed += 1;
}

async function pushException(p: PushContext, row: EventRow): Promise<void> {
  const db = p.ctx.db;
  const parent = db.select().from(schema.events).where(eq(schema.events.id, row.recurrenceParentId!)).get();
  if (!parent?.googleId || !row.originalStart) return;
  const target = parent.googleCalendarId ?? p.googleCalendarId;
  if (row.deletedAt) {
    if (row.googleId) {
      await p.client.deleteEvent(target, row.googleId);
      p.stats.eventsPushed += 1;
    }
    return;
  }
  const instanceId = row.googleId ?? instanceIdFor(parent.googleId, row.originalStart, parent.allDay);
  const body = toGoogleEvent(row, p.ctx.env.timezone);
  try {
    const res = await p.client.patchEvent(target, instanceId, body, row.googleId ? row.googleEtag : null);
    writePushed(db, row.id, res, target, p.deps.now().toISOString());
    p.stats.eventsPushed += 1;
  } catch (e) {
    if (e instanceof GoogleApiError && e.isPreconditionFailed && row.googleId) return resolveConflict(p, row, target, body);
    if (e instanceof GoogleApiError && (e.isNotFound || e.isGone)) return;
    throw e;
  }
}

async function pushEvent(p: PushContext, row: EventRow): Promise<void> {
  if (row.recurrenceParentId) return pushException(p, row);
  const db = p.ctx.db;
  const nowIso = p.deps.now().toISOString();
  const target = row.kind === "timebox" ? p.googleCalendarId : (row.googleCalendarId ?? p.googleCalendarId);
  if (row.deletedAt) {
    if (!row.googleId) return;
    await p.client.deleteEvent(target, row.googleId);
    db.update(schema.events).set({ googleEtag: null }).where(eq(schema.events.id, row.id)).run();
    p.stats.eventsPushed += 1;
    return;
  }
  const body = toGoogleEvent(row, p.ctx.env.timezone);
  if (!row.googleId) {
    const res = await p.client.insertEvent(target, body);
    writePushed(db, row.id, res, target, nowIso);
    p.stats.eventsPushed += 1;
    return;
  }
  try {
    const res = await p.client.patchEvent(target, row.googleId, body, row.googleEtag);
    writePushed(db, row.id, res, target, nowIso);
    p.stats.eventsPushed += 1;
  } catch (e) {
    if (e instanceof GoogleApiError && e.isPreconditionFailed) return resolveConflict(p, row, target, body);
    if (e instanceof GoogleApiError && (e.isNotFound || e.isGone)) {
      db.update(schema.events).set({ deletedAt: nowIso, googleEtag: null }).where(eq(schema.events.id, row.id)).run();
      return;
    }
    throw e;
  }
}

/** Removes mirrored time boxes from Google when mirroring is switched off. */
async function unmirrorTimeboxes(p: PushContext): Promise<void> {
  const db = p.ctx.db;
  const rows = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.kind, "timebox"), eq(schema.events.googleCalendarId, p.googleCalendarId)))
    .all();
  for (const row of rows) {
    if (!row.googleId) continue;
    await p.client.deleteEvent(p.googleCalendarId, row.googleId);
    db.update(schema.events).set({ googleId: null, googleEtag: null, googleCalendarId: null }).where(eq(schema.events.id, row.id)).run();
  }
}

async function pushCalendar(p: PushContext, opts: { isPrimary: boolean; mirrorTimeboxes: boolean; justPulled: Set<string> }): Promise<void> {
  const db = p.ctx.db;
  const state = getSyncState(db, CALENDAR_PROVIDER, p.googleCalendarId);
  const since = state?.lastSyncedAt ?? null;
  if (opts.isPrimary && !opts.mirrorTimeboxes) await unmirrorTimeboxes(p);
  const rows = candidateRows(db, p.cal, since, opts.isPrimary && opts.mirrorTimeboxes);
  for (const row of rows) {
    if (row.googleId && opts.justPulled.has(row.googleId)) continue;
    try {
      await pushEvent(p, row);
    } catch (e) {
      if (e instanceof GoogleAuthError) throw e;
      p.stats.errors.push(`Event "${row.title}": ${errorMessage(e)}`);
    }
  }
  upsertSyncState(db, CALENDAR_PROVIDER, p.googleCalendarId, { localId: p.cal.id, lastSyncedAt: p.deps.now().toISOString() });
}

export async function syncCalendars(ctx: AppContext, client: GoogleClient, deps: ResolvedDeps, opts: SyncOptions, stats: SyncStats): Promise<void> {
  const db = ctx.db;
  const entries = await client.calendarList();
  const { calendars, primaryGoogleId } = upsertCalendars(db, entries, deps.now().toISOString());
  setSyncStatus(db, { primaryCalendarId: primaryGoogleId });
  const mirrorTimeboxes = mirrorTimeboxesEnabled(db);
  for (const cal of calendars) {
    if (!cal.syncEnabled || !cal.googleId) continue;
    stats.calendars += 1;
    const p: PushContext = { ctx, client, deps, cal, googleCalendarId: cal.googleId, stats };
    try {
      const justPulled = await pullCalendar(ctx, client, deps, cal, cal.googleId, Boolean(opts.full), stats);
      await pushCalendar(p, { isPrimary: cal.googleId === primaryGoogleId, mirrorTimeboxes, justPulled });
    } catch (e) {
      if (e instanceof GoogleAuthError) throw e;
      const message = errorMessage(e);
      stats.errors.push(`Calendar "${cal.name}": ${message}`);
      upsertSyncState(db, CALENDAR_PROVIDER, cal.googleId, { localId: cal.id, lastError: message });
    }
  }
}
