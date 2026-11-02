import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AppContext } from "../app.ts";
import { runTool, stringifyResult, toolsFor } from "../tools/index.ts";
import { registerResources } from "./resources.ts";

export const MCP_SERVER_INFO = { name: "aravos", version: "0.1.0" } as const;

export const MCP_INSTRUCTIONS = [
  "AravOS is the personal life operating system of one person, Arav, who owns this server. It holds his tasks and lists, calendar events and scheduler-made time boxes, goals and habits, trackers, nutrition, water, weight and workouts.",
  "Conventions: dates are YYYY-MM-DD in Arav's local timezone, times are HH:mm (24h local), and event timestamps are ISO 8601 (results are UTC with a Z suffix; inputs may carry an offset, and a value without one is local time). Ids are UUIDs; list and get tools return them for follow-up calls.",
  "Start with whoami (current local date and time) and get_day_summary before changing anything, then use the list_* and get_* tools to find ids. Prefer update_* and complete_* over delete_*. Every change is recorded in the activity log under your client name, so say what you changed when you report back.",
].join(" ");

function toCallToolResult(r: { ok: boolean; result: unknown }): CallToolResult {
  return { content: [{ type: "text", text: stringifyResult(r.result) }], isError: !r.ok };
}

function registerTools(server: McpServer, ctx: AppContext, actor: string): void {
  for (const def of toolsFor("mcp")) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.input,
        annotations: { title: def.name, readOnlyHint: def.readOnly ?? false, destructiveHint: def.destructive ?? false, openWorldHint: false },
      },
      async (args: unknown) => toCallToolResult(await runTool(def, args, { ctx, actor })),
    );
  }
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "daily_plan",
    {
      title: "Plan today",
      description: "Review today's summary and propose a realistic plan for the day, then place it on the calendar with the scheduler.",
      argsSchema: { focus: z.string().optional().describe("Optional theme or priority for the day, for example deep work or recovery") },
    },
    ({ focus }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Plan my day in AravOS.",
              "1. Call whoami, then get_day_summary for today. Note overdue tasks, tasks due today, fixed events, habits not yet done and how nutrition and workouts compare with targets.",
              "2. Propose a short plan: the 3 most important tasks, when to do them around the fixed events, and anything to drop or defer (use update_task to move due dates, complete_task for things already done).",
              "3. Place the work with the scheduler: run plan_schedule with dryRun true first, review the proposed time boxes, then run it for real. Use move_event with lock true for anything that must stay put.",
              "4. Report back in a few lines: what is scheduled, what changed and what needs my decision.",
              focus ? `Focus for today: ${focus}.` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );
}

/** One McpServer per request: the HTTP transport is stateless, so registration is cheap and actor-specific. */
export function createMcpServer(ctx: AppContext, actor: string): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { instructions: MCP_INSTRUCTIONS });
  registerTools(server, ctx, actor);
  registerResources(server, ctx);
  registerPrompts(server);
  return server;
}
