# Google Calendar and Tasks sync

AravOS keeps its own copy of events and tasks in SQLite and syncs them two ways with one Google account. The server talks to the Calendar v3 and Tasks v1 REST APIs directly with `fetch` (no client library), refreshes tokens itself, and runs a sync every 10 minutes plus whenever you press "Sync now" in Settings.

## 1. Create OAuth credentials

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (for example "AravOS").
2. Enable two APIs under **APIs & Services → Library**: **Google Calendar API** and **Google Tasks API**.
3. Under **APIs & Services → OAuth consent screen** choose **External**, fill in the app name and your email, and add these scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/tasks`
   - `openid`, `email` (used only to show which account is connected)
4. On the **Test users** step add the Google account you will connect. While the consent screen is in **Testing** status only test users can sign in.
5. Under **APIs & Services → Credentials** create an **OAuth client ID** of type **Web application** and add the redirect URI:

   ```
   <ARAVOS_PUBLIC_URL>/api/google/callback
   ```

   For local development that is `http://localhost:8787/api/google/callback`. The URI must match `ARAVOS_PUBLIC_URL` exactly (scheme, host, port, no trailing slash).
6. Copy the client ID and secret into the server environment:

   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ARAVOS_PUBLIC_URL=https://aravos.example.com
   ```

7. Restart the server, open **Settings → Google** and press **Connect Google**. The consent screen asks for offline access; AravOS stores the refresh token in the `settings` table under `google_tokens` and runs a first sync before redirecting back to `/settings?google=connected`.

### The 7-day refresh token expiry

A consent screen in **Testing** status issues refresh tokens that expire after 7 days. After that every sync fails with `invalid_grant`, AravOS clears the stored tokens, and the status endpoint reports "Reconnect Google in settings". To avoid reconnecting weekly, go to the OAuth consent screen and press **Publish app**. Google shows an "unverified app" warning on the consent screen for apps that are published but not verified; that is fine for a personal app you only use with your own account, and the refresh token then lasts until you revoke it (or leave it unused for six months).

Other limits worth knowing: Google keeps at most 100 refresh tokens per client per account (older ones are silently revoked), and revoking access under [myaccount.google.com/permissions](https://myaccount.google.com/permissions) has the same effect as the expiry above.

## 2. Endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /api/google/auth-url` | Returns `{ url }` for the consent screen. Stores a random `state` under `google_oauth_state`. Returns 400 when the client id or secret is missing. |
| `GET /api/google/callback?code&state` | Exempt from bearer auth. Validates the state (10 minute lifetime), exchanges the code, stores tokens, re-enables sync on Google calendars, runs a full sync and redirects to `/settings?google=connected` or `/settings?google=error&message=...`. |
| `GET /api/google/status` | `{ configured, connected, email, lastSyncedAt, lastError, calendars: [{ id, name, syncEnabled }], tasksLists: [{ id, name, googleId }] }`. |
| `POST /api/google/sync` | Runs a sync now. Body `{ full?: boolean }` ignores stored sync tokens. Returns `{ calendars, eventsPulled, eventsPushed, tasksPulled, tasksPushed, errors[] }`. 400 when not connected, 409 when a sync is already running. |
| `POST /api/google/disconnect` | Clears tokens and sync state, sets `syncEnabled = false` on Google calendars, keeps all local events and tasks. |

Per-calendar sync can be toggled with the existing `PATCH /api/calendars/:id { syncEnabled }`.

## 3. What syncs, and in which direction

### Calendars

- The Google calendar list is mirrored into `calendars` rows with `kind = "google"`. Name and colour follow Google (the colour is mapped to the nearest palette name: blue, green, yellow, orange, red, pink, purple, gray). `isVisible` and `syncEnabled` are yours and are never overwritten.
- **Pull** (Google → AravOS), per calendar with `syncEnabled`: the first run lists events from 30 days ago to 180 days ahead with `singleEvents=true` and stores the `nextSyncToken` in `sync_state` (`google_calendar:<calendarId>`). Later runs use the token; a 410 drops the token and repeats the full window.
  - Mapped fields: summary → title, description → notes, location, start/end (`date` becomes an all-day event; Google's exclusive end date becomes an inclusive one), status (`cancelled` soft deletes the local row), colorId → palette colour. Rows get `source = "google"`, `googleId`, `googleEtag`, `googleCalendarId`.
  - Instances of Google recurring events arrive expanded and are stored as standalone events (`rrule = null`). Editing or deleting one locally changes only that instance in Google.
  - Instances of a series that was created in AravOS are matched against the local master; unchanged instances are ignored, changed or cancelled ones become local exceptions. When Google reports a newer master the local master is refreshed.
  - Conflicts use last writer wins on Google's `updated` versus the local `updatedAt`. Identical etags are skipped. Pulled rows never write activity log entries.
- **Push** (AravOS → Google), per Google calendar: events with `kind = "event"` whose calendar is a Google calendar and whose `updatedAt` is after the calendar's last push (`sync_state.lastSyncedAt`).
  - No `googleId` → `events.insert`; `googleId` and not deleted → `events.patch` with `If-Match`; soft deleted → `events.delete`.
  - A 412 (etag mismatch) refetches the remote event and applies last writer wins. A 404/410 on patch treats the remote deletion as authoritative.
  - After every write the returned `etag` and `updated` are stored without bumping `updatedAt` past them, so the next pull sees the same etag and skips (no echo).
  - Local recurring events push `recurrence: ["RRULE:..."]` with the server timezone. Local exceptions (single-occurrence edits) patch the instance `<masterId>_<timestamp>`.
- **Time boxes** (`kind = "timebox"`) are pushed only when the `app` setting has `mirrorTimeboxes: true`. They go to the primary calendar as transparent events with `extendedProperties.private.aravos = "timebox"` and the task id. Moving a mirrored block in Google moves and locks the local block. Turning the setting off removes the mirrors from Google.

### Tasks

- Google task lists map to `task_lists` rows by `googleId`. The first Google list (the account default) maps to the local **Inbox**; other lists match by name, otherwise a local list is created. Local lists without `googleId` (except Inbox) are created in Google.
- **Pull**, per linked list: `tasks.list` with `showCompleted`, `showHidden`, `showDeleted` and `updatedMin = last seen updated − 5 min` (stored in `sync_state.syncToken` for `google_tasks:<listId>`). Mapped fields: title, notes, due (date only) → `dueDate`, `completed` status → `status = "done"` + `completedAt`, `deleted` → soft delete, `parent` → `parentId`. Last writer wins by `updated`.
- **Push**, per linked list: tasks in the list (and their subtasks) changed since the last push. Insert with `parent` when the parent is already in Google, patch otherwise, delete when soft deleted. A parent change is applied with `tasks.move`; if Google refuses the move the change stays local. Moving a task to another list deletes it from the old Google list and inserts it in the new one.
- Local-only fields: due time, start date, priority, estimate, tags, recurrence, goal. A local `cancelled` task is pushed as completed.

## 4. Scheduling and status

- `syncAllGoogle` runs every 10 minutes from `services/jobs.ts`. It returns immediately when Google is not configured or connected, skips when a sync is already running, and never throws.
- Each run records `lastSyncedAt` and `lastError` per calendar and list in `sync_state`, and a summary under the `google_sync_status` setting (`lastSyncedAt`, `lastError`, `lastStats`, `primaryCalendarId`).
- Access tokens are refreshed when they expire within 60 seconds and once more after a 401. A refresh that fails with `invalid_grant` clears the tokens and sets `lastError`; the UI should offer "Reconnect Google". 429 and 5xx responses are retried three times with exponential backoff.

## 5. Limits and known gaps

- Only events 30 days back and 180 days ahead are pulled on a full sync; incremental sync afterwards delivers every change Google reports.
- Attendees, reminders, conference links and visibility are not synced.
- Removing recurrence from a local event does not clear it in Google (the recurrence field is only sent when set).
- Events of kind `habit` and events in local (non-Google) calendars stay local. To get an event into Google, create it in, or move it to, a Google calendar.
- Google Tasks has no push notifications and no etag preconditions; conflicts are resolved by comparing `updated`. Google keeps only the due date, so a local due time is kept locally.
- A Google task list deleted in Google is left alone locally (its tasks stop syncing).
- Deleting a calendar in Google does not delete the local copy; it simply stops syncing.
