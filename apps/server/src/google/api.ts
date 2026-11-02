import type { AppContext } from "../app.ts";
import { getAccessToken } from "./oauth.ts";
import type {
  EventListParams,
  GoogleCalendarListEntry,
  GoogleEvent,
  GoogleEventInput,
  GoogleEventsPage,
  GoogleTask,
  GoogleTaskInput,
  GoogleTaskList,
  GoogleTasksPage,
  ResolvedDeps,
  TaskListParams,
} from "./types.ts";

export const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
export const TASKS_BASE = "https://tasks.googleapis.com/tasks/v1";

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  etag?: string | null;
}

interface GoogleErrorBody {
  error?: { code?: number; message?: string; status?: string; errors?: { reason?: string; message?: string }[] } | string;
  error_description?: string;
}

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason: string | null = null,
  ) {
    super(message);
  }
  get isGone(): boolean {
    return this.status === 410;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isPreconditionFailed(): boolean {
    return this.status === 412;
  }
}

function withQuery(url: string, query: Query | undefined): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function toApiError(res: Response): Promise<GoogleApiError> {
  let body: GoogleErrorBody = {};
  try {
    body = (await res.json()) as GoogleErrorBody;
  } catch {
    body = {};
  }
  const err = body.error;
  if (typeof err === "string") return new GoogleApiError(res.status, `Google API error ${res.status}: ${body.error_description ?? err}`, err);
  const reason = err?.errors?.[0]?.reason ?? err?.status ?? null;
  return new GoogleApiError(res.status, `Google API error ${res.status}: ${err?.message ?? res.statusText ?? "request failed"}`, reason);
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

const enc = (s: string): string => encodeURIComponent(s);

/** Thin typed wrapper over fetch for the Calendar and Tasks APIs. */
export class GoogleClient {
  constructor(
    private readonly ctx: AppContext,
    private readonly deps: ResolvedDeps,
  ) {}

  private async request<T>(method: string, url: string, opts: RequestOptions = {}): Promise<T> {
    const target = withQuery(url, opts.query);
    let authRetried = false;
    let attempt = 0;
    for (;;) {
      const token = await getAccessToken(this.ctx, this.deps);
      const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json" };
      if (opts.body !== undefined) headers["content-type"] = "application/json";
      if (opts.etag) headers["if-match"] = opts.etag;
      const res = await this.deps.fetchImpl(target, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
      if (res.status === 401 && !authRetried) {
        authRetried = true;
        attempt = 0;
        await getAccessToken(this.ctx, this.deps, { force: true });
        continue;
      }
      if (shouldRetry(res.status) && attempt < MAX_ATTEMPTS - 1) {
        attempt += 1;
        await this.deps.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      if (!res.ok) throw await toApiError(res);
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  // ---- Calendar ----

  async calendarList(): Promise<GoogleCalendarListEntry[]> {
    const items: GoogleCalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.request<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>("GET", `${CALENDAR_BASE}/users/me/calendarList`, {
        query: { maxResults: 250, pageToken, showDeleted: false },
      });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  listEvents(calendarId: string, params: EventListParams): Promise<GoogleEventsPage> {
    return this.request<GoogleEventsPage>("GET", `${CALENDAR_BASE}/calendars/${enc(calendarId)}/events`, {
      query: {
        maxResults: params.maxResults ?? 2500,
        syncToken: params.syncToken,
        pageToken: params.pageToken,
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        singleEvents: params.singleEvents,
        showDeleted: params.showDeleted,
      },
    });
  }

  getEvent(calendarId: string, eventId: string): Promise<GoogleEvent> {
    return this.request<GoogleEvent>("GET", `${CALENDAR_BASE}/calendars/${enc(calendarId)}/events/${enc(eventId)}`);
  }

  insertEvent(calendarId: string, body: GoogleEventInput): Promise<GoogleEvent> {
    return this.request<GoogleEvent>("POST", `${CALENDAR_BASE}/calendars/${enc(calendarId)}/events`, { body });
  }

  patchEvent(calendarId: string, eventId: string, body: GoogleEventInput, etag?: string | null): Promise<GoogleEvent> {
    return this.request<GoogleEvent>("PATCH", `${CALENDAR_BASE}/calendars/${enc(calendarId)}/events/${enc(eventId)}`, { body, etag });
  }

  /** Deletes an event; an event that is already gone counts as deleted. */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.request<void>("DELETE", `${CALENDAR_BASE}/calendars/${enc(calendarId)}/events/${enc(eventId)}`);
    } catch (e) {
      if (e instanceof GoogleApiError && (e.isNotFound || e.isGone)) return;
      throw e;
    }
  }

  // ---- Tasks ----

  async taskLists(): Promise<GoogleTaskList[]> {
    const items: GoogleTaskList[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.request<{ items?: GoogleTaskList[]; nextPageToken?: string }>("GET", `${TASKS_BASE}/users/@me/lists`, { query: { maxResults: 100, pageToken } });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  insertTaskList(title: string): Promise<GoogleTaskList> {
    return this.request<GoogleTaskList>("POST", `${TASKS_BASE}/users/@me/lists`, { body: { title } });
  }

  listTasks(listId: string, params: TaskListParams): Promise<GoogleTasksPage> {
    return this.request<GoogleTasksPage>("GET", `${TASKS_BASE}/lists/${enc(listId)}/tasks`, {
      query: {
        maxResults: params.maxResults ?? 100,
        updatedMin: params.updatedMin,
        showCompleted: params.showCompleted,
        showHidden: params.showHidden,
        showDeleted: params.showDeleted,
        pageToken: params.pageToken,
      },
    });
  }

  getTask(listId: string, taskId: string): Promise<GoogleTask> {
    return this.request<GoogleTask>("GET", `${TASKS_BASE}/lists/${enc(listId)}/tasks/${enc(taskId)}`);
  }

  insertTask(listId: string, body: GoogleTaskInput, parent?: string): Promise<GoogleTask> {
    return this.request<GoogleTask>("POST", `${TASKS_BASE}/lists/${enc(listId)}/tasks`, { body, query: { parent } });
  }

  patchTask(listId: string, taskId: string, body: GoogleTaskInput): Promise<GoogleTask> {
    return this.request<GoogleTask>("PATCH", `${TASKS_BASE}/lists/${enc(listId)}/tasks/${enc(taskId)}`, { body });
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    try {
      await this.request<void>("DELETE", `${TASKS_BASE}/lists/${enc(listId)}/tasks/${enc(taskId)}`);
    } catch (e) {
      if (e instanceof GoogleApiError && (e.isNotFound || e.isGone)) return;
      throw e;
    }
  }

  moveTask(listId: string, taskId: string, parent?: string): Promise<GoogleTask> {
    return this.request<GoogleTask>("POST", `${TASKS_BASE}/lists/${enc(listId)}/tasks/${enc(taskId)}/move`, { query: { parent } });
  }
}
