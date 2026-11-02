import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import type { CalEvent, Calendar, Task, TaskList } from "@aravos/shared";
import { makeTestApp, type TestApp } from "./helpers.ts";
import { schema } from "../src/db/client.ts";
import { getTokens, saveTokens } from "../src/google/oauth.ts";
import { getGoogleDeps, getSyncState, setGoogleDeps, CALENDAR_PROVIDER } from "../src/google/state.ts";
import { runGoogleSync, syncAllGoogle } from "../src/google/sync.ts";
import { getRawSetting, setSetting } from "../src/services/settings.ts";
import type { GoogleCalendarListEntry, GoogleEvent, GoogleStatus, GoogleTask, GoogleTaskList, SyncStats } from "../src/google/types.ts";

// ---------- fake Google ----------

type FakeEvent = GoogleEvent & { version: number };
interface FakeCalendar {
  entry: GoogleCalendarListEntry;
  events: Map<string, FakeEvent>;
  version: number;
}
interface FakeList {
  list: GoogleTaskList;
  tasks: Map<string, GoogleTask>;
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apiError = (status: number, reason: string, message = reason) => json(status, { error: { code: status, message, errors: [{ reason, message }] } });

class FakeGoogle {
  accessToken = "access-1";
  refreshToken = "refresh-1";
  refreshCount = 0;
  invalidGrant = false;
  expireSyncTokens = false;
  failNext: { status: number; times: number } | null = null;
  calendars = new Map<string, FakeCalendar>();
  lists = new Map<string, FakeList>();
  log: { method: string; path: string; query: URLSearchParams }[] = [];
  private counter = 0;

  constructor() {
    this.addCalendar("primary@example.com", "Arav", "#9fe1e7", true);
    this.addList("list-default", "My Tasks");
  }

  readonly fetch: typeof fetch = async (input, init) => this.handle(input, init);

  requests(method: string, pathIncludes: string): { method: string; path: string; query: URLSearchParams }[] {
    return this.log.filter((r) => r.method === method && r.path.includes(pathIncludes));
  }

  addCalendar(id: string, summary: string, backgroundColor: string, primary = false): void {
    this.calendars.set(id, { entry: { id, summary, backgroundColor, primary, selected: true, accessRole: "owner" }, events: new Map(), version: 0 });
  }

  private cal(id: string): FakeCalendar {
    const c = this.calendars.get(id);
    if (!c) throw new Error(`fake calendar ${id} missing`);
    return c;
  }

  private stampEvent(cal: FakeCalendar, event: FakeEvent): FakeEvent {
    cal.version += 1;
    event.version = cal.version;
    event.etag = `"etag-${cal.version}"`;
    event.updated = new Date().toISOString();
    return event;
  }

  addEvent(calendarId: string, partial: Partial<GoogleEvent>): FakeEvent {
    const cal = this.cal(calendarId);
    const id = partial.id ?? `evt-${++this.counter}`;
    const event: FakeEvent = { status: "confirmed", ...partial, id, version: 0 };
    cal.events.set(id, this.stampEvent(cal, event));
    return event;
  }

  updateEvent(calendarId: string, id: string, patch: Partial<GoogleEvent>): FakeEvent {
    const cal = this.cal(calendarId);
    const event = cal.events.get(id);
    if (!event) throw new Error(`fake event ${id} missing`);
    Object.assign(event, patch);
    return this.stampEvent(cal, event);
  }

  cancelEvent(calendarId: string, id: string): void {
    this.updateEvent(calendarId, id, { status: "cancelled" });
  }

  event(calendarId: string, id: string): FakeEvent | undefined {
    return this.cal(calendarId).events.get(id);
  }

  eventsOf(calendarId: string): FakeEvent[] {
    return [...this.cal(calendarId).events.values()];
  }

  addList(id: string, title: string): void {
    this.lists.set(id, { list: { id, title, updated: new Date().toISOString() }, tasks: new Map() });
  }

  private list(id: string): FakeList {
    const l = this.lists.get(id);
    if (!l) throw new Error(`fake list ${id} missing`);
    return l;
  }

  private stampTask(task: GoogleTask): GoogleTask {
    this.counter += 1;
    task.etag = `"tetag-${this.counter}"`;
    task.updated = new Date().toISOString();
    return task;
  }

  addTask(listId: string, partial: Partial<GoogleTask>): GoogleTask {
    const id = partial.id ?? `task-${++this.counter}`;
    const task: GoogleTask = { status: "needsAction", ...partial, id };
    this.list(listId).tasks.set(id, this.stampTask(task));
    return task;
  }

  updateTask(listId: string, id: string, patch: Partial<GoogleTask>): GoogleTask {
    const task = this.list(listId).tasks.get(id);
    if (!task) throw new Error(`fake task ${id} missing`);
    Object.assign(task, patch);
    return this.stampTask(task);
  }

  task(listId: string, id: string): GoogleTask | undefined {
    return this.list(listId).tasks.get(id);
  }

  tasksOf(listId: string): GoogleTask[] {
    return [...this.list(listId).tasks.values()];
  }

  listByTitle(title: string): FakeList | undefined {
    return [...this.lists.values()].find((l) => l.list.title === title);
  }

  private async handle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    this.log.push({ method, path: url.pathname, query: url.searchParams });

    if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") return this.token(new URLSearchParams(bodyText));
    if (url.pathname === "/oauth2/v3/userinfo") return json(200, { email: "arav@example.com" });
    if (headers.get("authorization") !== `Bearer ${this.accessToken}`) return apiError(401, "authError", "Invalid Credentials");
    if (this.failNext && this.failNext.times > 0) {
      this.failNext.times -= 1;
      return apiError(this.failNext.status, "backendError");
    }
    const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "calendar") return this.calendarApi(method, parts.slice(2), url.searchParams, body, headers);
    if (parts[0] === "tasks") return this.tasksApi(method, parts.slice(2), url.searchParams, body);
    return json(404, { error: { code: 404, message: `unhandled ${method} ${url.pathname}` } });
  }

  private token(form: URLSearchParams): Response {
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      if (form.get("code") !== "good-code") return json(400, { error: "invalid_grant", error_description: "Bad code" });
      return json(200, { access_token: this.accessToken, refresh_token: this.refreshToken, expires_in: 3600, scope: "calendar tasks", token_type: "Bearer" });
    }
    this.refreshCount += 1;
    if (this.invalidGrant || form.get("refresh_token") !== this.refreshToken) return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    return json(200, { access_token: this.accessToken, expires_in: 3600, scope: "calendar tasks", token_type: "Bearer" });
  }

  private calendarApi(method: string, parts: string[], q: URLSearchParams, body: Record<string, unknown>, headers: Headers): Response {
    if (parts[0] === "users" && parts[2] === "calendarList") return json(200, { items: [...this.calendars.values()].map((c) => c.entry) });
    const cal = parts[0] === "calendars" && parts[1] ? this.calendars.get(parts[1]) : undefined;
    if (!cal || parts[2] !== "events") return apiError(404, "notFound");
    const eventId = parts[3];
    const strip = ({ version: _v, ...rest }: FakeEvent): GoogleEvent => rest;
    if (!eventId) {
      if (method === "POST") {
        const created = this.addEvent(cal.entry.id, body as Partial<GoogleEvent>);
        return json(200, strip(created));
      }
      return this.listEventsResponse(cal, q, strip);
    }
    const event = cal.events.get(eventId);
    if (!event) return apiError(404, "notFound");
    if (method === "GET") return json(200, strip(event));
    if (method === "PATCH") {
      const ifMatch = headers.get("if-match");
      if (ifMatch && ifMatch !== event.etag) return apiError(412, "conditionNotMet");
      return json(200, strip(this.updateEvent(cal.entry.id, eventId, body as Partial<GoogleEvent>)));
    }
    if (method === "DELETE") {
      if (event.status === "cancelled") return apiError(410, "deleted");
      this.cancelEvent(cal.entry.id, eventId);
      return new Response(null, { status: 204 });
    }
    return apiError(405, "methodNotAllowed");
  }

  private listEventsResponse(cal: FakeCalendar, q: URLSearchParams, strip: (e: FakeEvent) => GoogleEvent): Response {
    const syncToken = q.get("syncToken");
    let items = [...cal.events.values()];
    if (syncToken) {
      if (this.expireSyncTokens) return apiError(410, "fullSyncRequired", "Sync token is no longer valid");
      const n = Number(syncToken.replace("st:", ""));
      items = items.filter((e) => e.version > n);
    } else {
      if (q.get("showDeleted") !== "true") items = items.filter((e) => e.status !== "cancelled");
      const timeMin = q.get("timeMin");
      const timeMax = q.get("timeMax");
      items = items.filter((e) => {
        if (e.status === "cancelled" || !e.start) return true;
        const start = e.start.date ? `${e.start.date}T00:00:00.000Z` : new Date(e.start.dateTime ?? "").toISOString();
        return (!timeMin || start >= timeMin) && (!timeMax || start <= timeMax);
      });
    }
    return json(200, { items: items.map(strip), nextSyncToken: `st:${cal.version}` });
  }

  private tasksApi(method: string, parts: string[], q: URLSearchParams, body: Record<string, unknown>): Response {
    if (parts[0] === "users" && parts[2] === "lists") {
      if (method === "POST") {
        const id = `list-${++this.counter}`;
        this.addList(id, String(body.title ?? "Untitled"));
        return json(200, this.list(id).list);
      }
      return json(200, { items: [...this.lists.values()].map((l) => l.list) });
    }
    const list = parts[0] === "lists" && parts[1] ? this.lists.get(parts[1]) : undefined;
    if (!list || parts[2] !== "tasks") return apiError(404, "notFound");
    const taskId = parts[3];
    if (!taskId) {
      if (method === "POST") {
        const parent = q.get("parent") ?? undefined;
        return json(200, this.addTask(list.list.id, { ...(body as Partial<GoogleTask>), parent }));
      }
      const updatedMin = q.get("updatedMin");
      const items = [...list.tasks.values()].filter((t) => !updatedMin || (t.updated ?? "") >= updatedMin);
      return json(200, { items });
    }
    const task = list.tasks.get(taskId);
    if (!task || task.deleted) return apiError(404, "notFound");
    if (parts[4] === "move") {
      const parent = q.get("parent");
      return json(200, this.updateTask(list.list.id, taskId, { parent: parent ?? undefined }));
    }
    if (method === "GET") return json(200, task);
    if (method === "PATCH") {
      const patch = body as Partial<GoogleTask>;
      const next = this.updateTask(list.list.id, taskId, patch);
      if (patch.status === "needsAction") delete next.completed;
      if (patch.status === "completed" && !next.completed) next.completed = new Date().toISOString();
      return json(200, next);
    }
    if (method === "DELETE") {
      this.updateTask(list.list.id, taskId, { deleted: true });
      return new Response(null, { status: 204 });
    }
    return apiError(405, "methodNotAllowed");
  }
}

// ---------- helpers ----------

const PRIMARY = "primary@example.com";
const DEFAULT_LIST = "list-default";
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));
const dayFromNow = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const atHour = (days: number, hour: number): string => `${dayFromNow(days)}T${String(hour).padStart(2, "0")}:00:00.000Z`;

interface World {
  t: TestApp;
  fake: FakeGoogle;
}
const worlds: World[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.t.cleanup();
});

function setup(opts: { configured?: boolean } = {}): World {
  const t = makeTestApp();
  const fake = new FakeGoogle();
  if (opts.configured !== false) {
    t.ctx.env.googleClientId = "client-id";
    t.ctx.env.googleClientSecret = "client-secret";
  }
  setGoogleDeps(t.ctx, { fetchImpl: fake.fetch, sleep: async () => undefined });
  const w = { t, fake };
  worlds.push(w);
  return w;
}

async function connect(w: World): Promise<Response> {
  const { data } = await w.t.api<{ url: string }>("GET", "/api/google/auth-url");
  const state = new URL(data.url).searchParams.get("state") ?? "";
  return w.t.fetch(`/api/google/callback?code=good-code&state=${state}`);
}

async function connected(opts: { configured?: boolean } = {}): Promise<World> {
  const w = setup(opts);
  await connect(w);
  return w;
}

const sync = async (w: World, full = false): Promise<SyncStats> => (await w.t.api<SyncStats>("POST", "/api/google/sync", { full })).data;
const localCalendars = async (w: World): Promise<Calendar[]> => (await w.t.api<Calendar[]>("GET", "/api/calendars")).data;
const googleCalendar = async (w: World, name = "Arav"): Promise<Calendar> => {
  const cal = (await localCalendars(w)).find((c) => c.kind === "google" && c.name === name);
  if (!cal) throw new Error(`local google calendar ${name} missing`);
  return cal;
};
const eventsInRange = async (w: World): Promise<CalEvent[]> => (await w.t.api<CalEvent[]>("GET", `/api/events?from=${atHour(-2, 0)}&to=${atHour(20, 0)}`)).data;
const eventRow = (w: World, id: string) => w.t.ctx.db.select().from(schema.events).where(eq(schema.events.id, id)).get();
const taskRow = (w: World, id: string) => w.t.ctx.db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
const localTasks = async (w: World): Promise<Task[]> => (await w.t.api<Task[]>("GET", "/api/tasks?view=all&includeDone=true")).data;

// ---------- tests ----------

describe("google oauth", () => {
  it("auth-url requires configuration", async () => {
    const w = setup({ configured: false });
    const r = await w.t.api<{ error: string }>("GET", "/api/google/auth-url", undefined, { allowError: true });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain("not configured");
    const status = await w.t.api<GoogleStatus>("GET", "/api/google/status");
    expect(status.data.configured).toBe(false);
    expect(status.data.connected).toBe(false);
  });

  it("auth-url builds the consent URL and stores a state", async () => {
    const w = setup();
    const { data } = await w.t.api<{ url: string }>("GET", "/api/google/auth-url");
    const url = new URL(data.url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://test.local/api/google/callback");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/tasks");
    const stored = getRawSetting(w.t.ctx.db, "google_oauth_state") as { state: string; createdAt: string };
    expect(stored.state).toBe(url.searchParams.get("state"));
    expect(stored.createdAt).toBeTruthy();
  });

  it("callback rejects an unknown state", async () => {
    const w = setup();
    await w.t.api("GET", "/api/google/auth-url");
    const res = await w.t.fetch("/api/google/callback?code=good-code&state=wrong");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("google=error");
    expect(getTokens(w.t.ctx.db)).toBeNull();
  });

  it("callback stores tokens and runs an initial sync", async () => {
    const w = setup();
    w.fake.addEvent(PRIMARY, { summary: "Dentist", start: { dateTime: atHour(2, 15) }, end: { dateTime: atHour(2, 16) } });
    const res = await connect(w);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://test.local/settings?google=connected");
    const tokens = getTokens(w.t.ctx.db);
    expect(tokens?.accessToken).toBe("access-1");
    expect(tokens?.refreshToken).toBe("refresh-1");
    expect(tokens?.email).toBe("arav@example.com");
    expect(tokens?.connectedAt).toBeTruthy();
    expect(Date.parse(tokens?.expiresAt ?? "")).toBeGreaterThan(Date.now());
    const cal = await googleCalendar(w);
    expect(cal.googleId).toBe(PRIMARY);
    const events = await eventsInRange(w);
    expect(events.map((e) => e.title)).toContain("Dentist");
    const status = await w.t.api<GoogleStatus>("GET", "/api/google/status");
    expect(status.data.connected).toBe(true);
    expect(status.data.lastSyncedAt).toBeTruthy();
    expect(status.data.lastError).toBeNull();
  });

  it("callback reports a failed code exchange", async () => {
    const w = setup();
    const { data } = await w.t.api<{ url: string }>("GET", "/api/google/auth-url");
    const state = new URL(data.url).searchParams.get("state") ?? "";
    const res = await w.t.fetch(`/api/google/callback?code=bad-code&state=${state}`);
    expect(res.headers.get("location")).toContain("google=error");
    expect(getTokens(w.t.ctx.db)).toBeNull();
  });
});

describe("google calendar sync", () => {
  it("pulls calendars and events with field mapping", async () => {
    const w = setup();
    w.fake.addCalendar("work@example.com", "Work", "#d50000");
    w.fake.addEvent(PRIMARY, { summary: "Dentist", description: "Bring card", location: "Main St", colorId: "11", start: { dateTime: atHour(2, 15), timeZone: "UTC" }, end: { dateTime: atHour(2, 16), timeZone: "UTC" } });
    w.fake.addEvent(PRIMARY, { summary: "Holiday", start: { date: dayFromNow(3) }, end: { date: dayFromNow(4) } });
    w.fake.addEvent(PRIMARY, { summary: "Gone", status: "cancelled", start: { dateTime: atHour(2, 10) }, end: { dateTime: atHour(2, 11) } });
    w.fake.addEvent("work@example.com", { summary: "Standup", start: { dateTime: atHour(1, 9) }, end: { dateTime: atHour(1, 9) } });
    await connect(w);
    const cals = await localCalendars(w);
    const work = cals.find((c) => c.name === "Work");
    expect(work?.kind).toBe("google");
    expect(work?.color).toBe("red");
    expect(work?.syncEnabled).toBe(true);
    expect(cals.filter((c) => c.kind === "google")).toHaveLength(2);
    const events = await eventsInRange(w);
    const dentist = events.find((e) => e.title === "Dentist");
    expect(dentist?.notes).toBe("Bring card");
    expect(dentist?.location).toBe("Main St");
    expect(dentist?.color).toBe("red");
    expect(dentist?.source).toBe("google");
    expect(dentist?.allDay).toBe(false);
    expect(dentist?.start).toBe(atHour(2, 15));
    const holiday = events.find((e) => e.title === "Holiday");
    expect(holiday?.allDay).toBe(true);
    expect(holiday?.start).toBe(dayFromNow(3));
    expect(holiday?.end).toBe(dayFromNow(3));
    expect(events.find((e) => e.title === "Gone")).toBeUndefined();
    expect(events.find((e) => e.title === "Standup")?.calendarId).toBe(work?.id);
    const row = eventRow(w, dentist!.id);
    expect(row?.googleEtag).toBeTruthy();
    expect(row?.googleCalendarId).toBe(PRIMARY);
    const activity = await w.t.api<{ entity: string }[]>("GET", "/api/activity");
    expect(activity.data.filter((a) => a.entity === "event")).toHaveLength(0);
    expect(getSyncState(w.t.ctx.db, CALENDAR_PROVIDER, PRIMARY)?.syncToken).toMatch(/^st:/);
  });

  it("pushes a local event and does not echo it back", async () => {
    const w = await connected();
    const cal = await googleCalendar(w);
    const created = await w.t.api<CalEvent>("POST", "/api/events", { title: "Gym", calendarId: cal.id, start: atHour(1, 7), end: atHour(1, 8), color: "green" });
    const stats = await sync(w);
    expect(stats.eventsPushed).toBe(1);
    const remote = w.fake.eventsOf(PRIMARY).find((e) => e.summary === "Gym");
    expect(remote?.colorId).toBe("10");
    expect(remote?.start?.dateTime).toBe(atHour(1, 7));
    const row = eventRow(w, created.data.id);
    expect(row?.googleId).toBe(remote?.id);
    expect(row?.googleEtag).toBe(remote?.etag);
    expect(row?.googleCalendarId).toBe(PRIMARY);
    const updatedAt = row?.updatedAt;
    const patchesBefore = w.fake.requests("PATCH", "/events/").length;
    const again = await sync(w);
    expect(again.eventsPushed).toBe(0);
    expect(again.eventsPulled).toBe(0);
    expect(w.fake.requests("PATCH", "/events/")).toHaveLength(patchesBefore);
    expect(eventRow(w, created.data.id)?.updatedAt).toBe(updatedAt);
    expect(w.fake.eventsOf(PRIMARY).filter((e) => e.summary === "Gym")).toHaveLength(1);
  });

  it("applies a remote update that is newer than the local row", async () => {
    const w = await connected();
    const cal = await googleCalendar(w);
    const created = await w.t.api<CalEvent>("POST", "/api/events", { title: "Gym", calendarId: cal.id, start: atHour(1, 7), end: atHour(1, 8) });
    await sync(w);
    const googleId = eventRow(w, created.data.id)?.googleId ?? "";
    await tick();
    w.fake.updateEvent(PRIMARY, googleId, { summary: "Gym (moved)", start: { dateTime: atHour(1, 9) }, end: { dateTime: atHour(1, 10) } });
    const stats = await sync(w);
    expect(stats.eventsPulled).toBe(1);
    const row = eventRow(w, created.data.id);
    expect(row?.title).toBe("Gym (moved)");
    expect(row?.start).toBe(atHour(1, 9));
    expect(row?.googleEtag).toBe(w.fake.event(PRIMARY, googleId)?.etag);
  });

  it("keeps a local update that is newer than the remote one", async () => {
    const w = await connected();
    const cal = await googleCalendar(w);
    const created = await w.t.api<CalEvent>("POST", "/api/events", { title: "Gym", calendarId: cal.id, start: atHour(1, 7), end: atHour(1, 8) });
    await sync(w);
    const googleId = eventRow(w, created.data.id)?.googleId ?? "";
    w.fake.updateEvent(PRIMARY, googleId, { summary: "Remote title" });
    await tick();
    await w.t.api("PATCH", `/api/events/${created.data.id}`, { title: "Local title" });
    const stats = await sync(w);
    expect(stats.errors).toEqual([]);
    expect(w.fake.event(PRIMARY, googleId)?.summary).toBe("Local title");
    expect(eventRow(w, created.data.id)?.title).toBe("Local title");
    expect(eventRow(w, created.data.id)?.googleEtag).toBe(w.fake.event(PRIMARY, googleId)?.etag);
  });

  it("soft-deletes locally when the remote event is cancelled", async () => {
    const w = setup();
    const remote = w.fake.addEvent(PRIMARY, { summary: "Dentist", start: { dateTime: atHour(2, 15) }, end: { dateTime: atHour(2, 16) } });
    await connect(w);
    const before = (await eventsInRange(w)).find((e) => e.title === "Dentist");
    expect(before).toBeTruthy();
    w.fake.cancelEvent(PRIMARY, remote.id);
    const stats = await sync(w);
    expect(stats.eventsPulled).toBe(1);
    expect(eventRow(w, before!.id)?.deletedAt).toBeTruthy();
    expect((await eventsInRange(w)).find((e) => e.title === "Dentist")).toBeUndefined();
  });

  it("deletes the remote event when it is deleted locally", async () => {
    const w = await connected();
    const cal = await googleCalendar(w);
    const created = await w.t.api<CalEvent>("POST", "/api/events", { title: "Gym", calendarId: cal.id, start: atHour(1, 7), end: atHour(1, 8) });
    await sync(w);
    const googleId = eventRow(w, created.data.id)?.googleId ?? "";
    await w.t.api("DELETE", `/api/events/${created.data.id}`);
    const stats = await sync(w);
    expect(stats.eventsPushed).toBe(1);
    expect(w.fake.event(PRIMARY, googleId)?.status).toBe("cancelled");
    const again = await sync(w);
    expect(again.eventsPushed).toBe(0);
    expect(again.errors).toEqual([]);
  });

  it("falls back to a full pull when the sync token is rejected with 410", async () => {
    const w = await connected();
    const tokenBefore = getSyncState(w.t.ctx.db, CALENDAR_PROVIDER, PRIMARY)?.syncToken;
    expect(tokenBefore).toBeTruthy();
    w.fake.addEvent(PRIMARY, { summary: "Late addition", start: { dateTime: atHour(4, 12) }, end: { dateTime: atHour(4, 13) } });
    w.fake.expireSyncTokens = true;
    w.fake.log.length = 0;
    const stats = await sync(w);
    expect(stats.errors).toEqual([]);
    const lists = w.fake.requests("GET", `/calendars/${encodeURIComponent(PRIMARY)}/events`).filter((r) => !r.path.includes("/events/"));
    expect(lists[0]?.query.get("syncToken")).toBe(tokenBefore);
    expect(lists[1]?.query.has("syncToken")).toBe(false);
    expect(lists[1]?.query.get("timeMin")).toBeTruthy();
    expect((await eventsInRange(w)).map((e) => e.title)).toContain("Late addition");
  });

  it("pushes local recurring events as RRULE lines", async () => {
    const w = await connected();
    const cal = await googleCalendar(w);
    const created = await w.t.api<CalEvent>("POST", "/api/events", { title: "Standup", calendarId: cal.id, start: atHour(1, 9), end: atHour(1, 9).replace("09:00", "09:15"), rrule: "FREQ=WEEKLY;BYDAY=MO" });
    await sync(w);
    const googleId = eventRow(w, created.data.id)?.googleId ?? "";
    const remote = w.fake.event(PRIMARY, googleId);
    expect(remote?.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
    expect(remote?.start?.timeZone).toBe("UTC");
  });

  it("mirrors time boxes to the primary calendar only when enabled", async () => {
    const w = await connected();
    const task = await w.t.api<Task>("POST", "/api/tasks", { title: "Write report" });
    const box = await w.t.api<CalEvent>("POST", "/api/events", { title: "Write report", start: atHour(1, 10), end: atHour(1, 11), taskId: task.data.id });
    expect(box.data.kind).toBe("timebox");
    await sync(w);
    expect(w.fake.eventsOf(PRIMARY).find((e) => e.summary === "Write report")).toBeUndefined();
    setSetting(w.t.ctx.db, "app", { ...(getRawSetting(w.t.ctx.db, "app") as object), mirrorTimeboxes: true });
    await w.t.api("PATCH", `/api/events/${box.data.id}`, { title: "Write report (draft)" });
    await sync(w);
    const mirrored = w.fake.eventsOf(PRIMARY).find((e) => e.summary === "Write report (draft)");
    expect(mirrored?.extendedProperties?.private?.aravos).toBe("timebox");
    expect(mirrored?.extendedProperties?.private?.taskId).toBe(task.data.id);
    expect(mirrored?.transparency).toBe("transparent");
    expect(eventRow(w, box.data.id)?.googleId).toBe(mirrored?.id);
    setSetting(w.t.ctx.db, "app", { ...(getRawSetting(w.t.ctx.db, "app") as object), mirrorTimeboxes: false });
    await sync(w);
    expect(w.fake.event(PRIMARY, mirrored!.id)?.status).toBe("cancelled");
    expect(eventRow(w, box.data.id)?.googleId).toBeNull();
  });

  it("skips calendars with sync disabled", async () => {
    const w = setup();
    w.fake.addCalendar("work@example.com", "Work", "#4285f4");
    await connect(w);
    const work = await googleCalendar(w, "Work");
    await w.t.api("PATCH", `/api/calendars/${work.id}`, { syncEnabled: false });
    w.fake.addEvent("work@example.com", { summary: "Hidden", start: { dateTime: atHour(1, 9) }, end: { dateTime: atHour(1, 10) } });
    const stats = await sync(w);
    expect(stats.calendars).toBe(1);
    expect((await eventsInRange(w)).find((e) => e.title === "Hidden")).toBeUndefined();
    expect((await googleCalendar(w, "Work")).syncEnabled).toBe(false);
  });
});

describe("google tasks sync", () => {
  it("links lists, pulls tasks and creates remote lists for local ones", async () => {
    const w = setup();
    w.fake.addList("list-errands", "Errands");
    const parent = w.fake.addTask(DEFAULT_LIST, { title: "Plan trip", notes: "Spain", due: `${dayFromNow(5)}T00:00:00.000Z` });
    w.fake.addTask(DEFAULT_LIST, { title: "Book flights", parent: parent.id });
    w.fake.addTask(DEFAULT_LIST, { title: "Done thing", status: "completed", completed: new Date().toISOString(), hidden: true });
    w.fake.addTask(DEFAULT_LIST, { title: "Removed", deleted: true });
    w.fake.addTask("list-errands", { title: "Buy milk" });
    await connect(w);
    const lists = (await w.t.api<TaskList[]>("GET", "/api/lists")).data;
    expect(lists.find((l) => l.name === "Inbox")?.googleId).toBe(DEFAULT_LIST);
    expect(lists.find((l) => l.name === "Errands")?.googleId).toBe("list-errands");
    expect(lists.find((l) => l.name === "Personal")?.googleId).toBeTruthy();
    expect(w.fake.listByTitle("Personal")).toBeTruthy();
    expect(w.fake.listByTitle("Work")).toBeTruthy();
    expect(w.fake.listByTitle("Inbox")).toBeUndefined();
    const tasks = await localTasks(w);
    const plan = tasks.find((t) => t.title === "Plan trip");
    expect(plan?.notes).toBe("Spain");
    expect(plan?.dueDate).toBe(dayFromNow(5));
    expect(plan?.source).toBe("google");
    expect(plan?.listId).toBe(lists.find((l) => l.name === "Inbox")?.id);
    const detail = await w.t.api<Task & { subtasks: Task[] }>("GET", `/api/tasks/${plan!.id}`);
    expect(detail.data.subtasks.map((s) => s.title)).toEqual(["Book flights"]);
    const done = tasks.find((t) => t.title === "Done thing");
    expect(done?.status).toBe("done");
    expect(done?.completedAt).toBeTruthy();
    expect(tasks.find((t) => t.title === "Removed")).toBeUndefined();
    expect(tasks.find((t) => t.title === "Buy milk")?.listId).toBe(lists.find((l) => l.name === "Errands")?.id);
  });

  it("pushes local tasks, subtasks, completion and deletion", async () => {
    const w = await connected();
    const parent = await w.t.api<Task>("POST", "/api/tasks", { title: "Parent", dueDate: dayFromNow(2), notes: "n" });
    const child = await w.t.api<Task>("POST", "/api/tasks", { title: "Child", parentId: parent.data.id });
    const stats = await sync(w);
    expect(stats.tasksPushed).toBe(2);
    const remoteParent = w.fake.tasksOf(DEFAULT_LIST).find((t) => t.title === "Parent");
    const remoteChild = w.fake.tasksOf(DEFAULT_LIST).find((t) => t.title === "Child");
    expect(remoteParent?.due).toBe(`${dayFromNow(2)}T00:00:00.000Z`);
    expect(remoteParent?.notes).toBe("n");
    expect(remoteChild?.parent).toBe(remoteParent?.id);
    expect(taskRow(w, parent.data.id)?.googleId).toBe(remoteParent?.id);
    expect(taskRow(w, parent.data.id)?.googleListId).toBe(DEFAULT_LIST);
    const quiet = await sync(w);
    expect(quiet.tasksPushed).toBe(0);
    expect(quiet.tasksPulled).toBe(0);
    await w.t.api("POST", `/api/tasks/${child.data.id}/complete`, {});
    await sync(w);
    expect(w.fake.task(DEFAULT_LIST, remoteChild!.id)?.status).toBe("completed");
    await w.t.api("DELETE", `/api/tasks/${parent.data.id}`);
    await sync(w);
    expect(w.fake.task(DEFAULT_LIST, remoteParent!.id)?.deleted).toBe(true);
  });

  it("applies remote completion and deletion with last writer wins", async () => {
    const w = setup();
    const remote = w.fake.addTask(DEFAULT_LIST, { title: "Call mum" });
    const other = w.fake.addTask(DEFAULT_LIST, { title: "Old title" });
    await connect(w);
    const local = (await localTasks(w)).find((t) => t.title === "Call mum");
    await tick();
    w.fake.updateTask(DEFAULT_LIST, remote.id, { status: "completed", completed: new Date().toISOString() });
    await sync(w);
    expect(taskRow(w, local!.id)?.status).toBe("done");
    expect(taskRow(w, local!.id)?.completedAt).toBeTruthy();
    w.fake.updateTask(DEFAULT_LIST, remote.id, { deleted: true });
    await sync(w);
    expect(taskRow(w, local!.id)?.deletedAt).toBeTruthy();
    const otherLocal = (await localTasks(w)).find((t) => t.title === "Old title");
    w.fake.updateTask(DEFAULT_LIST, other.id, { title: "Remote rename" });
    await tick();
    await w.t.api("PATCH", `/api/tasks/${otherLocal!.id}`, { title: "Local rename" });
    await sync(w);
    expect(taskRow(w, otherLocal!.id)?.title).toBe("Local rename");
    expect(w.fake.task(DEFAULT_LIST, other.id)?.title).toBe("Local rename");
  });
});

describe("google tokens and status", () => {
  it("refreshes the access token after a 401 and retries", async () => {
    const w = await connected();
    w.fake.accessToken = "access-rotated";
    w.fake.addEvent(PRIMARY, { summary: "After rotate", start: { dateTime: atHour(1, 9) }, end: { dateTime: atHour(1, 10) } });
    const stats = await sync(w);
    expect(stats.errors).toEqual([]);
    expect(w.fake.refreshCount).toBe(1);
    expect(getTokens(w.t.ctx.db)?.accessToken).toBe("access-rotated");
    expect((await eventsInRange(w)).map((e) => e.title)).toContain("After rotate");
  });

  it("refreshes a token that is about to expire", async () => {
    const w = await connected();
    const tokens = getTokens(w.t.ctx.db)!;
    saveTokens(w.t.ctx.db, { ...tokens, expiresAt: new Date(Date.now() + 30_000).toISOString() });
    await sync(w);
    expect(w.fake.refreshCount).toBe(1);
    expect(Date.parse(getTokens(w.t.ctx.db)?.expiresAt ?? "")).toBeGreaterThan(Date.now() + 60_000);
  });

  it("clears tokens and records the error when the refresh token is revoked", async () => {
    const w = await connected();
    w.fake.accessToken = "access-rotated";
    w.fake.invalidGrant = true;
    const stats = await sync(w);
    expect(stats.errors[0]).toContain("Reconnect Google");
    expect(getTokens(w.t.ctx.db)).toBeNull();
    const status = await w.t.api<GoogleStatus>("GET", "/api/google/status");
    expect(status.data.connected).toBe(false);
    expect(status.data.lastError).toContain("Reconnect Google");
    const r = await w.t.api("POST", "/api/google/sync", {}, { allowError: true });
    expect(r.status).toBe(400);
  });

  it("retries transient failures with backoff", async () => {
    const w = await connected();
    w.fake.failNext = { status: 503, times: 2 };
    const stats = await sync(w);
    expect(stats.errors).toEqual([]);
    w.fake.failNext = { status: 500, times: 3 };
    const failed = await sync(w);
    expect(failed.errors.length).toBeGreaterThan(0);
    expect(failed.errors[0]).toContain("500");
  });

  it("disconnect clears tokens and sync state but keeps local data", async () => {
    const w = setup();
    w.fake.addEvent(PRIMARY, { summary: "Keep me", start: { dateTime: atHour(2, 15) }, end: { dateTime: atHour(2, 16) } });
    await connect(w);
    await w.t.api("POST", "/api/google/disconnect");
    expect(getTokens(w.t.ctx.db)).toBeNull();
    expect(w.t.ctx.db.select().from(schema.syncState).all()).toHaveLength(0);
    const status = await w.t.api<GoogleStatus>("GET", "/api/google/status");
    expect(status.data.connected).toBe(false);
    expect(status.data.calendars.every((c) => c.syncEnabled === false)).toBe(true);
    expect((await eventsInRange(w)).map((e) => e.title)).toContain("Keep me");
    const r = await w.t.api("POST", "/api/google/sync", {}, { allowError: true });
    expect(r.status).toBe(400);
    await syncAllGoogle(w.t.ctx);
    await connect(w);
    expect((await googleCalendar(w)).syncEnabled).toBe(true);
  });

  it("status endpoint shape", async () => {
    const w = await connected();
    const { data } = await w.t.api<GoogleStatus>("GET", "/api/google/status");
    expect(Object.keys(data).sort()).toEqual(["calendars", "configured", "connected", "email", "lastError", "lastSyncedAt", "tasksLists"]);
    expect(data).toMatchObject({ configured: true, connected: true, email: "arav@example.com", lastError: null });
    expect(data.calendars).toEqual([{ id: expect.any(String), name: "Arav", syncEnabled: true }]);
    expect(data.tasksLists.find((l) => l.name === "Inbox")).toEqual({ id: expect.any(String), name: "Inbox", googleId: DEFAULT_LIST });
  });

  it("syncAllGoogle is a no-op when not connected and guards against concurrent runs", async () => {
    const w = setup();
    await syncAllGoogle(w.t.ctx);
    expect(w.fake.log).toHaveLength(0);
    await connect(w);
    const [a, b] = await Promise.allSettled([runGoogleSync(w.t.ctx, {}, getGoogleDeps(w.t.ctx)), runGoogleSync(w.t.ctx, {}, getGoogleDeps(w.t.ctx))]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
  });
});
