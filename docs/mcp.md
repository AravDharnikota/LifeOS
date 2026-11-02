# AravOS MCP server

AravOS exposes Arav's tasks, calendar, goals, trackers and health data to AI agents over the [Model Context Protocol](https://modelcontextprotocol.io). The server speaks Streamable HTTP at `POST /mcp` and runs stateless: every request is independent, so there is no session to keep alive and any number of agents can connect at once.

- Endpoint: `https://<host>/mcp` (locally `http://localhost:8787/mcp`)
- Auth: `Authorization: Bearer <ARAVOS_TOKEN>` when `ARAVOS_TOKEN` is set on the server (always set it before exposing the server)
- Transport: Streamable HTTP, JSON responses, no session ids. `GET /mcp` answers 405 because a stateless server has no server-to-client stream; `DELETE /mcp` answers 200.

## Connecting

### Claude Code

```bash
claude mcp add --transport http aravos https://<host>/mcp --header "Authorization: Bearer <ARAVOS_TOKEN>"
```

Then start Claude Code and ask it to `get_day_summary`. Add `--scope user` to make the server available in every project.

### Claude Desktop and other stdio-only clients

Use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a bridge. In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aravos": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<host>/mcp", "--header", "Authorization:Bearer <ARAVOS_TOKEN>"]
    }
  }
}
```

The header value has no space after the colon on purpose: some launchers split arguments on spaces.

### Any MCP SDK client

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL("https://<host>/mcp"), {
  requestInit: { headers: { Authorization: "Bearer <ARAVOS_TOKEN>" } },
});
const client = new Client({ name: "muse", version: "1.0.0" });
await client.connect(transport);
const summary = await client.callTool({ name: "get_day_summary", arguments: {} });
```

### Plain HTTP (curl)

The endpoint is ordinary JSON-RPC 2.0 over POST. Send `Accept: application/json, text/event-stream` (the MCP spec requires both) and you get a JSON body back.

```bash

# initialize (optional for a stateless server, but clients normally start here)
curl -s https://<host>/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <ARAVOS_TOKEN>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# list tools
curl -s https://<host>/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <ARAVOS_TOKEN>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# call a tool
curl -s https://<host>/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <ARAVOS_TOKEN>" -H "X-Actor: cron" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"add_task","arguments":{"title":"Buy milk","dueDate":"2026-11-03"}}}'
```

Tool results come back as `{"content":[{"type":"text","text":"<json>"}],"isError":false}`; parse the `text` field as JSON. The same REST data is also available under `/api/*` (for example `GET /api/summary/day?date=YYYY-MM-DD` and `GET /api/summary/week?start=YYYY-MM-DD`).

## Who changed what: the actor

Every write is recorded in the activity log with an actor, and tasks and events keep it as their `source`. For MCP calls the actor is `mcp:<client>` where `<client>` comes from, in order:

1. the `X-Actor` header on the request (`X-Actor: muse` gives `mcp:muse`), which is the reliable option for scripts and proxies;
2. `clientInfo.name` from the MCP `initialize` request (`Claude Code` becomes `mcp:claude-code`). Because the server is stateless, that name is remembered per `User-Agent` for later calls from the same client;
3. plain `mcp` when neither is known.

`recent_activity` shows the log, so one agent can see what another one, the scheduler or Arav himself did.

## Conventions

- Dates are `YYYY-MM-DD` in Arav's local timezone (the server runs with `TZ` set to it); `whoami` returns the current local date and time.
- Times of day are `HH:mm`, 24 hour, local.
- Event timestamps are ISO 8601. Results are UTC with a `Z` suffix. Inputs may carry an offset (`2026-11-02T14:00:00-08:00`), a `Z`, or no offset at all, in which case they are read as local time. All-day events use `YYYY-MM-DD`.
- Ids are UUIDs. Every list or get tool returns them so you can pass them to update, complete or delete tools. Expanded occurrences of recurring events have ids of the form `<parentId>_<instanceStart>` and can be passed straight to `update_event`, `move_event` and `delete_event` to change just that occurrence.
- Lists are capped (about 50 rows, configurable with `limit`) and omit long fields such as notes; use the `get_*` tool for the full record.

## Tools

Tasks

| Tool | What it does |
| --- | --- |
| `list_tasks` | Tasks in a view: today (default), overdue, upcoming, inbox, anytime, done, all or list; `q` searches titles |
| `get_task` | One task with notes, time boxes and subtasks |
| `add_task` | Create a task with due/start dates, time, priority, estimate, list, tags, RRULE recurrence, goal link |
| `quick_add_task` | Create a task from one natural-language line (`Call dentist tomorrow 4pm !high 30m #health`) |
| `update_task` | Change any fields; `null` clears dates, estimate, recurrence, goal or notes |
| `complete_task` | Mark done (records `actualMinutes`, spawns the next recurrence) |
| `reopen_task` | Reopen a done or cancelled task |
| `delete_task` | Delete a task, its subtasks and time boxes (destructive) |
| `list_task_lists` | Lists (Inbox, Personal, Work, ...) with ids and open counts |
| `search_tasks` | Title search including completed tasks |

Calendar

| Tool | What it does |
| --- | --- |
| `get_events` | Events and time boxes in a range (default next 7 days), recurring events expanded |
| `get_day_events` | Everything on one local day |
| `add_event` | Create an event, an all-day event, a recurring series, or a time box (`taskId`) |
| `update_event` | Change fields; `scope: "this"` with `originalStart` edits one occurrence |
| `delete_event` | Delete an event, or cancel one occurrence (destructive) |
| `find_free_time` | Free gaps of at least N minutes between timed events, on a 15 minute grid, optionally 08:00 to 22:00 only |
| `move_event` | New start/end for an event or time box; `lock: true` keeps the scheduler from moving it again |

Goals

| Tool | What it does |
| --- | --- |
| `list_goals` | Goals with progress (0 to 1), streaks and milestone counts; `status: "all"` includes paused and done |
| `get_goal` | One goal with description, milestones and recent entries |
| `add_goal` | Create a number, habit, milestone or boolean goal |
| `update_goal` | Change fields or status (active, paused, done, archived) |
| `log_goal_progress` | Number goals: `value` or `delta`; habits: toggle the day's check-in; boolean: toggle done |
| `add_milestone` | Add a checklist step to a goal |
| `complete_milestone` | Mark a milestone done (or not done with `done: false`) |

Trackers

| Tool | What it does |
| --- | --- |
| `list_trackers` | Counters and numbers with the current period's value and target |
| `add_tracker` | Create a tracker (counter, number or toggle; resets daily, weekly or never) |
| `log_tracker` | Add `delta` (default: the tracker's step) or set `value` for a date |

Health

| Tool | What it does |
| --- | --- |
| `get_nutrition_day` | Meals with items, macro totals, targets, remaining and water for a day |
| `log_water` | Log millilitres for a day; returns the day's total against target |
| `log_weight` | Log weight in kg (and body fat percent); returns the change since the last entry |
| `log_meal_text` | Describe a meal in words; the server's AI estimates items and macros and saves it (needs `ANTHROPIC_API_KEY`) |
| `list_recent_workouts` | Completed workouts with duration, volume, PR count and exercises |
| `get_personal_records` | Personal records (weight, one_rm, volume, reps) per exercise, filterable by name |
| `get_health_targets` | Daily targets, profile goal and pace, latest weight and suggested targets |

Summary and system

| Tool | What it does |
| --- | --- |
| `get_day_summary` | Everything about one day in one call: events, tasks, nutrition, water, weight, workouts, goals, habits, trackers |
| `get_week_summary` | Seven days of calories, protein, water, workouts and tasks done, with totals, targets and weight change |
| `recent_activity` | The activity log, newest first, filterable by entity |
| `whoami` | App name and version, user name, timezone, current local date and time, your actor name, surfaces and URLs |

Other modules register their own tools on the same server, notably the scheduler (`plan_schedule` and friends), the dashboard layout tools and memory tools. `tools/list` is always the source of truth.

## Resources and prompts

| Resource | Content |
| --- | --- |
| `aravos://today` | Today's day summary (same JSON as `get_day_summary`) |
| `aravos://tasks/today` | Open tasks due or started by today, plus tasks completed today |
| `aravos://goals` | Active goals with progress |
| `aravos://day/{date}` | Day summary for any `YYYY-MM-DD` (resource template) |

The `daily_plan` prompt (optional argument `focus`) asks the model to review today's summary, propose a plan and place it with the scheduler.

## Suggested routine for an assistant agent

1. `whoami`, then `get_day_summary` (or read `aravos://today`). Note overdue tasks, what is due, fixed events, habits not yet done, and how nutrition, water and workouts compare with targets.
2. Capture anything new with `add_task` or `quick_add_task`, log what happened with `log_water`, `log_meal_text`, `log_weight`, `log_tracker` and `log_goal_progress`, and tidy up with `complete_task` and `update_task`.
3. Run `plan_schedule` with `dryRun: true`, review the proposed time boxes, then run it for real. Use `find_free_time` and `add_event` for anything the scheduler should not decide, and `move_event` with `lock: true` for things that must stay put.
4. Report back briefly: what is scheduled, what changed (the activity log records it under your name) and what needs Arav's decision.
