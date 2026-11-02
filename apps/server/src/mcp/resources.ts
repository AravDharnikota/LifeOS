import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { DATE_RE, todayString } from "@aravos/shared";
import type { AppContext } from "../app.ts";
import { listGoals } from "../services/goals.ts";
import { getDaySummary } from "../services/summary.ts";
import { listTasks } from "../services/tasks.ts";
import { compactGoal } from "../tools/goals.ts";
import { compactDaySummary } from "../tools/summary.ts";
import { compactTask } from "../tools/tasks.ts";

const JSON_MIME = "application/json";

function json(uri: URL, value: unknown): ReadResourceResult {
  return { contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(value) }] };
}

export function registerResources(server: McpServer, ctx: AppContext): void {
  server.registerResource("today", "aravos://today", { title: "Today", description: "Day summary for today: events, tasks, nutrition, water, weight, workouts, goals, habits and trackers.", mimeType: JSON_MIME }, (uri) =>
    json(uri, compactDaySummary(getDaySummary(ctx, todayString()))),
  );

  server.registerResource("tasks-today", "aravos://tasks/today", { title: "Tasks for today", description: "Open tasks due or started by today, plus tasks completed today.", mimeType: JSON_MIME }, (uri) => {
    const date = todayString();
    const tasks = listTasks(ctx.db, { view: "today", date, limit: 100 });
    return json(uri, { date, count: tasks.length, tasks: tasks.map(compactTask) });
  });

  server.registerResource("goals", "aravos://goals", { title: "Active goals", description: "Active goals with progress, streaks and milestone counts.", mimeType: JSON_MIME }, (uri) => {
    const goals = listGoals(ctx.db, { status: "active" });
    return json(uri, { count: goals.length, goals: goals.map(compactGoal) });
  });

  server.registerResource(
    "day",
    new ResourceTemplate("aravos://day/{date}", { list: undefined }),
    { title: "Day summary", description: "Day summary for a YYYY-MM-DD local date, same shape as aravos://today.", mimeType: JSON_MIME },
    (uri, variables) => {
      const date = String(variables.date ?? "");
      if (!DATE_RE.test(date)) throw new Error(`Invalid date "${date}": expected YYYY-MM-DD`);
      return json(uri, compactDaySummary(getDaySummary(ctx, date)));
    },
  );
}
