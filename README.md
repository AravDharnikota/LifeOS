# AravOS

A personal life operating system for one person. Tasks, calendar, goals, and health (workouts,
nutrition, water, weight, progress photos) in one calm app, with an AI assistant that can change the
app itself, an automatic time-boxing scheduler, and an MCP server so other agents can read and write
the same data.

Web app and iPhone app share one codebase. One small server (Node + SQLite) runs everything.

## What is inside
| Area | Highlights |
|---|---|
| Today | Agent-editable dashboard of widgets: agenda, tasks, nutrition rings, water, workouts, goals, trackers, habit grids, countdowns, notes, stats |
| Calendar | Day and week timelines with 15-minute snapping, drag to create, move and resize, recurring events with per-instance edits, time boxes for tasks, two-way Google Calendar sync |
| Tasks | Quick capture with natural language ("Call dentist tomorrow 4pm !high 30m #health"), Today / Upcoming / Anytime / Lists / Logbook, subtasks, recurrence, swipe actions, two-way Google Tasks sync |
| Scheduler | Time-boxes open tasks into free calendar slots around work hours, lunch, buffers and deadlines; learns how long tasks really take from history |
| Health: Workouts | Strong-style templates, live workouts with set rows, previous values, warm-up/drop/failure sets, supersets, rest timer, PR detection (weight, 1RM, volume, reps), history, exercise records and charts |
| Health: Nutrition | Photo logging through Claude vision (items, grams, macros, micros, health score), text logging, food search over a bundled USDA dataset, barcode lookup, MyFitnessPal-style diary with targets, water, weight trend, body progress photos with AI comparisons |
| Goals | Number, habit, milestone and yes/no goals with progress, streaks, linked tasks and trackers |
| Assistant | In-app chat with tools over every domain; can add widgets, trackers and goals to the dashboard, remembers facts about you |
| MCP | Streamable HTTP MCP server exposing all of the above to Claude Code and other agents |

## Quick start (local)
```bash
corepack enable && pnpm install
cp .env.example .env            # add ANTHROPIC_API_KEY for AI features
pnpm dev                        # server on :8787, web on :5173
```
Open http://localhost:5173. Production: `pnpm build && pnpm start` serves the web app from the server.

## Connect your agents
AravOS exposes everything through an MCP server at `https://<your-server>/mcp` (bearer token = `ARAVOS_TOKEN`).

```bash
# Claude Code
claude mcp add --transport http aravos https://<your-server>/mcp --header "Authorization: Bearer <ARAVOS_TOKEN>"

# Claude Desktop, Cursor, and other stdio-only clients
npx mcp-remote https://<your-server>/mcp --header "Authorization:Bearer <ARAVOS_TOKEN>"
```
Any agent that connects can read the day summary, add and complete tasks, move events, log water, weight and meals, update goals, run the scheduler, and change the dashboard. Pass an `X-Actor: mcp:<agent name>` header so the activity log shows who changed what. Full tool list and a suggested assistant routine: [docs/mcp.md](docs/mcp.md).

## Docs
- [Setup and environment](docs/deploy.md)
- [iPhone app](docs/ios.md)
- [Connecting agents through MCP](docs/mcp.md)
- [The assistant](docs/agent.md)
- [Scheduler](docs/scheduler.md)
- [Google Calendar and Tasks sync](docs/google-sync.md)
- [Workouts](docs/workouts.md), [Nutrition](docs/nutrition.md)
- Research that shaped the design: [design brief](docs/research/design-brief.md), [calendar and tasks](docs/research/calendar-tasks-spec.md), [Strong](docs/research/strong-app-spec.md), [nutrition](docs/research/nutrition-spec.md)

## Repository layout
```
apps/server     Hono API + MCP server + SQLite (Drizzle), AI services, Google sync
apps/web        Vite + React web app; Capacitor iOS project in apps/web/ios
packages/shared zod schemas and pure domain logic shared by server and web
docs            setup, feature docs, research
```

## Tests
```bash
pnpm test                         # unit + API tests (vitest)
pnpm --filter @aravos/web test:e2e  # Playwright, iPhone and desktop projects
```
