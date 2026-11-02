export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email: string | null;
  scope: string;
  connectedAt: string;
}

export interface GoogleDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface ResolvedDeps {
  fetchImpl: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export interface SyncStats {
  calendars: number;
  eventsPulled: number;
  eventsPushed: number;
  tasksPulled: number;
  tasksPushed: number;
  errors: string[];
}

export interface SyncOptions {
  full?: boolean;
}

export interface GoogleSyncStatus {
  lastSyncedAt: string | null;
  lastError: string | null;
  lastStats: SyncStats | null;
  primaryCalendarId: string | null;
}

export interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
  timeZone?: string;
  deleted?: boolean;
}

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleExtendedProperties {
  private?: Record<string, string>;
  shared?: Record<string, string>;
}

export interface GoogleEvent {
  id: string;
  etag?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  updated?: string;
  colorId?: string;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleEventTime;
  transparency?: string;
  extendedProperties?: GoogleExtendedProperties;
}

export interface GoogleEventInput {
  summary?: string;
  description?: string | null;
  location?: string | null;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  status?: string;
  colorId?: string | null;
  recurrence?: string[] | null;
  transparency?: string;
  reminders?: { useDefault: boolean };
  extendedProperties?: GoogleExtendedProperties;
}

export interface GoogleEventsPage {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface EventListParams {
  syncToken?: string;
  pageToken?: string;
  timeMin?: string;
  timeMax?: string;
  singleEvents?: boolean;
  showDeleted?: boolean;
  maxResults?: number;
}

export interface GoogleTaskList {
  id: string;
  title: string;
  etag?: string;
  updated?: string;
}

export interface GoogleTask {
  id: string;
  etag?: string;
  title?: string;
  notes?: string;
  status?: "needsAction" | "completed";
  due?: string;
  completed?: string;
  updated?: string;
  deleted?: boolean;
  hidden?: boolean;
  parent?: string;
  position?: string;
}

export interface GoogleTaskInput {
  title?: string;
  notes?: string | null;
  status?: "needsAction" | "completed";
  due?: string | null;
  completed?: string | null;
}

export interface GoogleTasksPage {
  items?: GoogleTask[];
  nextPageToken?: string;
}

export interface TaskListParams {
  updatedMin?: string;
  showCompleted?: boolean;
  showHidden?: boolean;
  showDeleted?: boolean;
  pageToken?: string;
  maxResults?: number;
}

export interface GoogleStatusCalendar {
  id: string;
  name: string;
  syncEnabled: boolean;
}

export interface GoogleStatusTaskList {
  id: string;
  name: string;
  googleId: string | null;
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  calendars: GoogleStatusCalendar[];
  tasksLists: GoogleStatusTaskList[];
}
