# The AravOS agent

The agent is the assistant inside AravOS. It chats with Arav, reads and changes his data through the shared tool catalog, and can reshape the dashboard on request. It runs on the server (`apps/server/src/services/agent.ts`) and talks to the web and iOS apps over `/api/agent/*`.

## What it can do

- Answer questions about the day from a live snapshot: events, tasks due and overdue, goals, trackers, health targets, latest weight, the dashboard layout and stored memories are all in its system prompt, so "what's left today" needs no tool call.
- Change data through tools: tasks, calendar events, goals, trackers, health logs, the scheduler, memories and the dashboard layout. Every tool in `apps/server/src/tools/*.ts` whose `surfaces` includes `agent` is available.
- Edit the dashboard: add, update, move and remove widgets, add sections, and undo the last change. It can also create a tracker and its widget in one step, or add a widget for an existing goal.
- Remember durable facts and preferences about the user and use them in later conversations.
- Look at images attached to a message (photos of a whiteboard, a receipt, a plan).

Example requests:

- "Add a goal to read 12 books this year and put it on my dashboard" creates the goal, then calls `create_goal_widget`.
- "Add a coffee counter" calls `create_tracker_widget`, which creates a daily tracker and adds a tracker widget with a tap-to-count button.
- "Move my 3pm to 4" finds the event in the snapshot and updates its start and end.
- "What's left today" is answered from the snapshot.
- "I work out in the mornings" is stored with `remember` as a preference.
- "Undo that" calls `revert_layout` when the last change was to the dashboard.

## How it behaves

The system prompt (`apps/server/src/ai/agent-prompt.ts`) sets the rules: plain text, short replies, no exclamation marks or markdown headers, act first then confirm in one line, never fabricate data, prefer tools over asking, confirm once before deleting unless the user already said to delete, and say when a layout change can be reverted. The stable rules come first and the volatile snapshot last so the prefix stays cacheable across turns.

## Threads and history

Conversations are threads (`agent_threads`) with messages (`agent_messages`). A thread is titled from the first 40 characters of its first message unless a title was given.

Each user message is stored as Anthropic content blocks (text plus any images). Each assistant turn stores the whole tool loop (assistant tool_use blocks, user tool_result blocks, final text) so the next turn replays it exactly. History sent to the model is capped at the last 40 messages and trimmed so it begins on a plain user message, keeping tool_use and tool_result pairs intact.

## API

All routes need the bearer token when `ARAVOS_TOKEN` is set.

- `GET /api/agent/threads` lists threads, newest first.
- `POST /api/agent/threads {title?}` creates a thread.
- `GET /api/agent/threads/:id` returns the thread with its messages (`role`, `displayText`, `toolCalls`).
- `DELETE /api/agent/threads/:id` deletes the thread and its messages.
- `POST /api/agent/threads/:id/messages {text, images?: [{base64, mediaType}]}` sends a message. By default the response is a Server-Sent Events stream; add `?stream=false` for a single JSON response.
- `POST /api/agent/quick {text}` sends a one-shot message in a thread named "Quick" and returns JSON. Useful for shortcuts and widgets that do not need a chat window.
- `GET /api/agent/tools` lists the agent's tools with `name`, `description`, `readOnly` and `destructive`, for the help sheet.

### Stream events

Each SSE event carries a JSON `data` payload:

- `text` `{delta}` as the reply streams in.
- `tool_call` `{name, input}` when the model calls a tool.
- `tool_result` `{name, ok, summary}` when it returns; `summary` is the first 300 characters.
- `done` `{threadId, message, toolCalls, layoutChanged, changed}` once the turn is stored. `message` is the saved assistant message. `changed` lists the entity kinds that were written (`task`, `event`, `goal`, `tracker`, `layout`, `meal`, `water`, `weight`, `memory`, `workout`) so the client knows what to refetch; `layoutChanged` is true when the dashboard changed.
- `error` `{message}` if the turn failed after the stream opened.

When AI is disabled the request fails with HTTP 503 before the stream opens. An unknown thread fails with 404.

## Layout changes and versions

Every layout edit goes through `saveLayout`, which stores the previous spec in `layout_versions` with the reason for the change and increments the layout's version. `revert_layout` (or `POST /api/layout/today/revert`) restores the most recent stored version and removes it from the stack, so repeated reverts walk back through the history. `layout_history` lists the stored versions.

Layout tools (`apps/server/src/tools/layout.ts`): `get_layout`, `list_widget_types`, `add_widget`, `update_widget`, `remove_widget`, `move_widget`, `add_section`, `revert_layout`, `layout_history`, `create_tracker_widget`, `create_goal_widget`. Widgets are validated against the shared `Widget` schema; ids are generated from the type plus a short random suffix when omitted. Invalid input comes back to the model as a tool error naming the field, not as an exception.

## Memories

Memories (`memories` table) are short third-person sentences with a kind: `fact`, `preference` or `pattern`. The agent stores them with `remember` when the user states something durable, and all of them are included in every system prompt, so `recall` is only needed to find an id. `forget` deletes one; `list_memories` lists them. Saving the same sentence twice updates the existing memory instead of duplicating it.

## Model and configuration

- `ANTHROPIC_API_KEY` enables the agent. Without it every agent request returns 503 with a message saying so.
- `ANTHROPIC_MODEL` picks the model (default `claude-opus-5-5`). The agent streams text, runs up to 12 tool iterations per turn, and caches the system prompt.
- `ARAVOS_TIMEZONE` and the app settings timezone decide the local date and time shown to the model.
- `ARAVOS_TOKEN` protects the API.

In tests the `MockAiProvider` in `apps/server/src/ai/mock.ts` replaces the model; its `agentHandler` can call tools and return scripted text, which is how `apps/server/test/agent.test.ts` exercises the tool loop.
