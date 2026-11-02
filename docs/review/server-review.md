# AravOS server review (apps/server)

Scope: `apps/server/src` (Hono 4, better-sqlite3 via drizzle, single user, bearer token). Reviewed by reading every source file and confirming the important hypotheses against a local server (`PORT=8830`, `ARAVOS_TOKEN=t`) and small probe scripts. Test suite: 149/149 pass.

Deployment context matters for severity: `fly.toml` publishes the server on the internet (`https://aravos.fly.dev`), so "authenticated client" means anyone holding the bearer token, and "MCP/agent" means any MCP client the owner connects or any instruction the in-app agent follows.

## Critical

None found. The two things I most wanted to rule out are clean:

- No auth bypass: `//api/tasks`, `/api/./tasks`, `/%61pi/tasks`, `/API/tasks`, `/uploads/..`, HEAD and OPTIONS all either get 401 or fall through to the SPA `index.html` (200, `text/html`, 1185 bytes), never to data. Hono decodes the path before both the auth middleware and routing, so they agree.
- `aravos.db` is not servable: `/uploads/*` is the only route rooted at `env.dataDir`, and `@hono/node-server` `serveStatic` rejects `..`, `%2e%2e` (decoded first) and `//` segments before `join(root, path)`.

## High

### H1. Recurring-event expansion is unbounded: one bad `rrule` freezes the whole server
`src/services/calendar.ts:220-231` (`listEvents`), reached from `GET /api/events`, `eventsOnDate` (agent system prompt, day summary, MCP `aravos://today`), the scheduler (`busyIntervals`), `find_free_time`, and the periodic jobs.

`rrule` is accepted as any string up to 500 chars (`EventCreate.rrule`, `add_event`/`update_event` tools), and `rule.between(windowStart, to, true)` materialises every occurrence from `dtstart` to `to` before `.slice(0, 400)`. rrule-js iterates from `dtstart`, not from `from`.

Measured: an event with `start: 2020-01-01`, `rrule: FREQ=MINUTELY` makes a one-week `listEvents` take **17.4 s** of synchronous CPU (better-sqlite3 + rrule are sync, so the event loop and every other request, including `/api/health`, stall for that long). `FREQ=SECONDLY` is ~60x worse. The row persists, so every calendar load, every agent turn (the snapshot calls `eventsOnDate`) and the 30-minute auto-scheduler job hit it again. The in-app agent and any MCP client can create such an event with one tool call.

Fix (all three are cheap):
```ts
// 1. validate on write (createEvent/updateEvent/overrideInstance)
const ALLOWED_FREQ = new Set([RRule.YEARLY, RRule.MONTHLY, RRule.WEEKLY, RRule.DAILY]);
export function parseRrule(s: string): RRuleType {
  if (/[\r\n]/.test(s)) throw badRequest("rrule must be a single RRULE line");
  const r = rrulestr(s.startsWith("RRULE:") ? s : `RRULE:${s}`);
  if (!(r instanceof RRule) || !ALLOWED_FREQ.has(r.options.freq)) throw badRequest("rrule must be DAILY, WEEKLY, MONTHLY or YEARLY");
  return r;
}
// 2. stop iterating at the cap instead of slicing afterwards
const occurrences: Date[] = [];
rule.between(windowStart, to, true, (d, i) => { occurrences.push(d); return i < 399; });
// 3. bound the query window in GET /api/events (e.g. to - from <= 366 days) and 400 on invalid dates
```

### H2. Agent system prompt embeds untrusted text verbatim; destructive tools need no confirmation
`src/ai/agent-prompt.ts:94-123` (`buildAgentSnapshot`), `src/tools/*.ts` (`delete_task`, `delete_event`, `forget`, `remove_widget`, `update_task`, `remember`).

Event titles, task titles, goal titles, tracker names and memories are concatenated into the system prompt with no delimiting or escaping. Events and tasks arrive from Google sync (`calendar-sync.ts`, `tasks-sync.ts`), i.e. from anyone who can put an invite on the owner's calendar or share a task list. Whatever text they contain is read by the model as part of its instructions, and the only guard on destructive tools is a sentence in `rules()` asking the model to "confirm once". The `remember` tool lets such text persist into every future prompt.

Fix: wrap each snapshot section in a clearly labelled data block and state in `rules()` that nothing inside those blocks is an instruction; truncate titles (e.g. 120 chars) and strip control characters; gate `destructive: true` tools (and `remember`) behind an explicit client-side confirmation step rather than relying on the model; consider excluding destructive tools from the agent surface entirely (`surfaces: ["mcp"]`) until a confirmation flow exists.

## Medium

### M1. `upcoming` task view ignores deleted/done/subtask filters (SQL precedence)
`src/services/tasks.ts:82`
```ts
conds.push(eq(t.status, "open"), or(...)!, sql`${t.dueDate} <= ${x} OR ${t.startDate} <= ${x}`);
```
drizzle's `and()` wraps the whole list in parentheses but not individual raw fragments, so the generated WHERE is `(... and dueDate <= ? OR startDate <= ?)`; the trailing `OR` short-circuits every other condition. Confirmed: a soft-deleted task, a done task and a subtask with a `startDate` in the next 30 days all come back from `listTasks({ view: "upcoming" })` (used by `GET /api/tasks?view=upcoming` and the `list_tasks` tool). Deleted data reappears in the UI and in agent/MCP results.

Fix: `or(lte(t.dueDate, limit), lte(t.startDate, limit))` instead of the raw fragment.

### M2. `overrideInstance` skips range validation and normalisation
`src/services/calendar.ts:133-166`. `patch.start`/`patch.end` are written as received: no `validateRange`, no `normalize`. Confirmed: a `scope: "this"` PATCH with `end` before `start` and `+05:00` offsets is stored as-is. Non-UTC strings break the string comparisons in `listEvents` (`start < to`, `end > from`), the sort, and Google push (`googleTimes` sends the raw string). `originalStart` is also unvalidated, so an exception whose `originalStart` matches no occurrence is silently never shown.

Fix: run `validateRange`/`normalize` on the merged `start`/`end` (and require `originalStart` to parse) before the insert/update; reject `rrule` and `recurrenceParentId` keys in the patch.

### M3. CORS reflects any origin, including when the server runs without a token
`src/app.ts:44-45`. `origin: (o) => o` plus `credentials: true`. With `ARAVOS_TOKEN` set this is mostly harmless (the token is a header a foreign page cannot add), but with no token (the default for `pnpm dev`, and the server logs "OPEN") any website the owner visits can read and modify everything on `localhost:8787` from the browser, because the reflected origin satisfies CORS. Confirmed headers: `access-control-allow-origin: http://evil.example`.

Fix: when `env.token` is null, allow only `env.publicUrl` (and the Vite dev origin); drop `credentials: true` since auth is header-based.

### M4. Bearer token written to stdout on every image load
`src/app.ts:43,60-61` and `apps/web/src/lib/api.ts:62`. The web app appends `?token=` to `/uploads/...` image URLs (the only way to auth an `<img>`), and the Hono `logger()` prints the full path+query, so the token lands in Fly's log pipeline on every meal/body photo view (12 log lines contained it after a handful of requests). Tokens in query strings also end up in proxy/browser history.

Fix: redact in the logger (`logger((s) => process.stdout.write(s.replace(/([?&]token=)[^&\s]+/g, "$1[redacted]") + "\n"))`), and prefer a short-lived signed upload URL or an `HttpOnly` cookie scoped to `/uploads/` over the raw bearer token in query strings.

### M5. Multi-line `rrule` strings expand with the wrong start time
`src/services/calendar.ts:224-225`. `rrulestr` turns a string containing newlines (e.g. `FREQ=DAILY\nRDATE:...`) into an `RRuleSet`; `RRuleSet extends RRule`, so the `instanceof` branch keeps it, but rrulestr builds the inner rule with the DTSTART parsed from the text, which is absent, so rrule-js defaults `dtstart` to *now*. Confirmed: a 10:00Z daily event produced instances at 03:52:52Z (the time the request ran). Same fix as H1 (reject newlines, validate on write).

## Low

- **L1. `GET /api/events` returns 500 on bad dates** (`src/routes/calendar.ts:313`): `new Date(q.from).toISOString()` throws `RangeError: Invalid time value` (confirmed). Use `isoDateTime` in `RangeQuery` and bound the window.
- **L2. `GET /api/activity?limit=`** (`src/routes/activity.ts:323`): `Number("abc")` is `NaN` (returns `[]`), `-1` means "no limit" in SQLite (returns everything). Use `z.coerce.number().int().min(1).max(200)`.
- **L3. Error bodies echo internal messages** (`src/app.ts:73`): 500 responses return `err.message` (SQLite constraint text, file paths, `Invalid time value`). Return a generic message in production and keep the detail in the log.
- **L4. `GET /api/settings` exposes `dataDir`** (`src/routes/settings.ts:266`): server filesystem path returned to the client. Drop it or keep it behind a debug flag.
- **L5. FK violations surface as 500s**: `updateEvent` (`calendarId`), `updateTask` (`listId`) and `createEvent` (`calendarId`) do not check existence; with `foreign_keys = ON` a bad id raises `SqliteError` (500) instead of 400. `createTask` already checks `listId`; mirror that.
- **L6. `photoPath` accepted verbatim** (`src/services/nutrition.ts:59,604`, `MealCreate.photoPath`): `POST /api/meals/from-analysis` with `imagePath: "/etc/passwd"` stores that string (confirmed, 201). Nothing on the server reads it (reads go through `resolveUploadPath`, which is safe), but it is rendered by the web as an `<img src>`. Validate with `/^\/uploads\/[a-z0-9-]+\/[0-9a-f-]+\.(jpg|png|webp)$/`.
- **L7. Google OAuth state can be consumed by an unauthenticated request** (`src/google/oauth.ts:184`): `consumeOAuthState` deletes the stored state even when it does not match, so any hit on the open `/api/google/callback` with a junk `state` cancels an in-flight connect. Only delete on match. (State validation itself is correct: 24 random bytes, server-side, 10-minute TTL, single use.)
- **L8. No constant-time compare / no throttling on token checks** (`src/app.ts:62,80`): use `crypto.timingSafeEqual` on equal-length buffers and reject tokens shorter than ~16 chars at startup. `/api/auth/check` is an intentional oracle; fine as long as the token is strong.
- **L9. Unbounded request bodies**: `MessageBody.images[].base64` has no length cap and node-server has no body limit, so one authenticated request can allocate hundreds of MB. Cap base64 length (e.g. 8 MB per image) and the agent `text`.
- **L10. App `timezone` setting is decorative** (`src/ai/agent-prompt.ts:97`, `AppSettings.timezone`): the prompt's "Now/Today" line uses the settings value while every date helper uses `process.env.TZ` (`env.timezone`). If they differ, the agent is told one date and tools compute another. Either drop the setting or make it the single source for `TZ`.
- **L11. `deleteBodyPhoto` deletes the file after the row is marked deleted** (`src/services/body.ts:73-78`): if `fs.rmSync` throws (it does for a directory), the request 500s with the row already soft-deleted. Swallow/log the fs error.
- **L12. Non-idempotent Google inserts are retried on 5xx** (`src/google/api.ts:200-204`): a `POST .../events` that succeeded server-side but returned 500 is retried and can create duplicates. Only retry idempotent methods, or use the Calendar API's `id` field with a client-generated id.
- **L13. `searchTasks`/`get_personal_records` LIKE patterns are unescaped** (`src/services/tasks.ts:291`): `%`/`_` in the query act as wildcards. Parameterised (no injection), just imprecise.
- **L14. `X-Actor` is trusted** (`src/app.ts:49`, `src/mcp/routes.ts:402`): any authenticated caller can label its writes as `user`, `scheduler` or `sync` in the activity log. Acceptable for a single-user app; worth a comment.
- **L15. SSE route**: errors inside `sendMessage` are emitted as an `error` event, but the turn keeps running tool calls after the client disconnects (`stream.writeSSE` rejections are swallowed). Consider checking `stream.aborted` in `onToolCall` and stopping the loop.

## Verified OK

- **Auth middleware** (`src/app.ts:54-67`): path checks use Hono's decoded path, the same one the router uses; `/api/health`, `/api/google/callback`, `/api/auth/check` are the only open paths and `/api/health/*` sub-paths are protected; `/mcp` returns a JSON-RPC 401; HEAD is dispatched as GET under the same middleware; OPTIONS is answered by CORS before auth with no data.
- **Uploads** (`src/lib/uploads.ts`): `resolveUploadPath` resolves against `uploadsDir` and requires the `uploadsDir + sep` prefix; `../`, `./../`, `//../` and absolute paths are rejected; `%2e%2e` and `..\` are treated as literal (non-existent) names. `saveUpload` sniffs magic bytes, caps at 12 MB, generates the file name, and whitelists `subdir`. A NUL in the path yields 404. (A symlink placed inside `uploads/` by someone with filesystem access would be followed; nothing in the API can create one.)
- **Static serving**: `/uploads/*` is rooted at `dataDir` but only `/uploads/...` paths reach it; `aravos.db`, `-wal`, `-shm` are unreachable. The SPA fallback never serves `/api/*` or `/mcp*`.
- **Google OAuth**: `createAuthUrl` is behind auth, state is random, stored server-side, TTL-checked and single-use; the callback redirect target is fixed to `publicUrl`; `exchangeCode` requires a refresh token; `refreshTokens` clears tokens only on `invalid_grant`; tokens are stored in `settings` and only `email`/`connectedAt` are exposed by `/api/settings`; no tool or MCP resource reads raw settings.
- **Google sync**: `running` WeakSet prevents overlapping runs (job + manual + callback); echo loops are prevented by etag equality and `updatedAt = min(remoteUpdated, now)`; `justPulled` skips pushing what was just pulled; local deletes only happen for rows that have a `googleId` and are reported deleted/404 by Google; `disconnectGoogle` keeps local copies; sync-token 410 is handled with one full re-pull; the periodic job (`services/jobs.ts`) wraps everything in `safe()` and `syncAllGoogle` never throws.
- **Scheduler** (`services/scheduler.ts`, `packages/shared/src/scheduler.ts`): `removedBlockIds` can only contain unlocked, future, non-frozen blocks of the candidate tasks (they come from `reusable`, built from `loadExistingBlocks(ids)` and filtered on `locked`); locked blocks and other tasks' blocks are only ever treated as busy. `placeTask` always makes progress (every accepted chunk is > 0 minutes). Horizon is clamped to 1-30 days. Timezone math relies on `process.env.TZ`, which `createApp` sets from `env.timezone` (Node honours runtime `TZ` changes).
- **SQL**: every `sql\`\`` fragment interpolates values as bound parameters (drizzle turns JS values into `?`), including the array in `sql\`${tasks.id} in ${[...taskIds]}\`` (`calendar.ts:204`), which renders `in (?, ?, ...)` and is guarded by `taskIds.size`. Every `inArray` call site is guarded against empty arrays. No string concatenation into SQL anywhere; `/api/goals?status=' OR 1=1` returns `[]`.
- **Transactions**: all `db.transaction` callbacks are synchronous (grep: zero `async` callbacks); `reorderTasks`, meals, templates and workouts are correct.
- **Jobs / replan**: `requestReplan` is debounced, unref'd, and catches rejections; interval timers are unref'd and wrapped.
- **MCP** (`src/mcp/*`): stateless transport, a fresh `McpServer` per request, closed in `finally`; tool inputs are zod-validated in `runTool` and handler errors become `isError` results rather than crashes; resources validate `{date}`; the client-name cache is bounded.
- **Barcode lookup**: `code` is validated as 8-14 digits before the URL is built; rate-limited and negative-cached.
- **Migrations**: `findMigrationsDir` resolves `apps/server/drizzle` both under `tsx` from source (`src/db` -> `../../drizzle`) and in the Docker image (`/app/apps/server/src/db` -> `/app/apps/server/drizzle`); the server starts cleanly and `migrate` is idempotent; `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout` are set.
- **Seeding**: `seedDatabase`, `seedFoods`, `seedExercises` are count-guarded and idempotent.
- **Settings merges**: `PATCH /api/settings/*` re-parse the merged object through the full schema, so partial updates cannot persist invalid shapes; `reset` only accepts the three known keys.
- **Layout**: `saveLayout` validates the spec and rejects duplicate widget ids; `update_widget` strips `id`/`type` from patches and validates the result.
