import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { format } from "date-fns";
import { isoDate, todayString } from "@aravos/shared";
import { schema } from "../db/client.ts";
import { getAppSettings } from "../services/settings.ts";
import { getDaySummary, getWeekSummary, weekBounds, type DaySummary } from "../services/summary.ts";
import { compactEvent } from "./calendar.ts";
import { compactGoal } from "./goals.ts";
import { compactTask } from "./tasks.ts";
import { compactTracker } from "./trackers.ts";
import { defineTool, type ToolDef } from "./types.ts";

/** Day summary with list rows compacted (no notes) and capped, for tool results and MCP resources. */
export function compactDaySummary(s: DaySummary) {
  return {
    date: s.date,
    events: s.events.slice(0, 100).map(compactEvent),
    tasks: { due: s.tasks.due.slice(0, 50).map(compactTask), overdue: s.tasks.overdue.slice(0, 50).map(compactTask), doneCount: s.tasks.doneCount, openCount: s.tasks.openCount },
    nutrition: s.nutrition,
    water: s.water,
    weight: s.weight,
    workouts: s.workouts,
    goals: s.goals.map(compactGoal),
    habitsDueToday: s.habitsDueToday,
    trackers: s.trackers.map(compactTracker),
  };
}

const getDaySummaryTool = defineTool({
  name: "get_day_summary",
  description:
    "One call overview of a local day (YYYY-MM-DD, default today): events and time boxes, tasks due and overdue with done/open counts, nutrition totals against targets, water, latest weight, workouts today and this week, active goals with progress, habits due today and trackers. Call this first in a session.",
  input: z.object({ date: isoDate.optional() }),
  readOnly: true,
  handler: ({ date }, { ctx }) => compactDaySummary(getDaySummary(ctx, date ?? todayString())),
});

const getWeekSummaryTool = defineTool({
  name: "get_week_summary",
  description: "Seven days starting at start (YYYY-MM-DD local; default the current week's first day per settings): per-day calories, protein, water, workouts and tasks done, with totals, targets and weight change.",
  input: z.object({ start: isoDate.optional().describe("First day of the week, YYYY-MM-DD; default this week") }),
  readOnly: true,
  handler: ({ start }, { ctx }) => getWeekSummary(ctx, start ?? weekBounds(ctx.db, todayString()).start),
});

const recentActivityTool = defineTool({
  name: "recent_activity",
  description: "Recent changes from the activity log, newest first: who (user, agent, mcp:<client>, scheduler, sync) did what to which entity. Useful to see what other agents or the user changed recently.",
  input: z.object({ limit: z.number().int().min(1).max(100).optional().describe("Default 30"), entity: z.string().max(40).optional().describe("Filter by entity type: task, event, goal, meal, workout, tracker, ...") }),
  readOnly: true,
  handler: ({ limit, entity }, { ctx }) => {
    const rows = ctx.db
      .select({ id: schema.activityLog.id, at: schema.activityLog.at, actor: schema.activityLog.actor, action: schema.activityLog.action, entity: schema.activityLog.entity, entityId: schema.activityLog.entityId, summary: schema.activityLog.summary })
      .from(schema.activityLog)
      .where(entity ? eq(schema.activityLog.entity, entity) : undefined)
      .orderBy(desc(schema.activityLog.at))
      .limit(limit ?? 30)
      .all();
    return { count: rows.length, activity: rows };
  },
});

const whoamiTool = defineTool({
  name: "whoami",
  description: "Describe this AravOS server: app name and version, the user's name, timezone, the current local date and time (use it to resolve words like today or tonight), units, the actor name your changes are logged under, and the available surfaces and URLs.",
  input: z.object({}),
  readOnly: true,
  handler: (_i, { ctx, actor }) => {
    const app = getAppSettings(ctx.db);
    const now = new Date();
    return {
      app: "AravOS",
      version: "0.1.0",
      user: app.name,
      timezone: ctx.env.timezone,
      now: format(now, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      today: todayString(),
      weekday: format(now, "EEEE"),
      weekStartsOn: app.weekStartsOn === 1 ? "monday" : "sunday",
      units: app.units,
      actor,
      ai: ctx.ai.enabled,
      surfaces: ["agent", "mcp"],
      urls: { web: ctx.env.publicUrl, api: `${ctx.env.publicUrl}/api`, mcp: `${ctx.env.publicUrl}/mcp` },
    };
  },
});

export const summaryTools: ToolDef[] = [getDaySummaryTool, getWeekSummaryTool, recentActivityTool, whoamiTool];
