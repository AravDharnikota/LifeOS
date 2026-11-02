import { z } from "zod";
import { isoDate, type Tracker } from "@aravos/shared";
import { createTracker, listTrackers, logTracker } from "../routes/trackers.ts";
import { defineTool, type ToolDef } from "./types.ts";

export function compactTracker(t: Tracker) {
  return { id: t.id, name: t.name, kind: t.kind, unit: t.unit, step: t.step, target: t.target, reset: t.reset, value: t.todayValue ?? 0 };
}

const listTrackersTool = defineTool({
  name: "list_trackers",
  description: "List trackers (simple counters and numbers shown as dashboard widgets, such as coffee cups or pages read) with the current period's value and target. reset says when the value starts over: daily, weekly or never.",
  input: z.object({}),
  readOnly: true,
  handler: (_i, { ctx }) => ({ trackers: listTrackers(ctx.db).map(compactTracker) }),
});

const addTrackerTool = defineTool({
  name: "add_tracker",
  description: "Create a tracker. kind counter adds step per log (default), number holds an amount, toggle is on or off. reset daily (default), weekly or never controls when the value resets. target is optional.",
  input: z.object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["counter", "number", "toggle"]).optional(),
    unit: z.string().max(30).optional(),
    step: z.number().positive().optional().describe("Amount added per log for counters; default 1"),
    target: z.number().optional(),
    reset: z.enum(["daily", "weekly", "never"]).optional(),
  }),
  handler: (i, { ctx, actor }) => compactTracker(createTracker(ctx.db, i, actor)),
});

const logTrackerTool = defineTool({
  name: "log_tracker",
  description: "Log to a tracker for a date (YYYY-MM-DD local, default today). delta adds to the period's value (default: the tracker's step); value sets the period's value absolutely. Returns the updated tracker.",
  input: z.object({
    id: z.string().min(1).describe("Tracker id (from list_trackers)"),
    delta: z.number().optional().describe("Amount to add; negative subtracts"),
    value: z.number().optional().describe("Set the period's value to this instead of adding"),
    date: isoDate.optional(),
  }),
  handler: ({ id, delta, value, date }, { ctx, actor }) => compactTracker(logTracker(ctx.db, id, { delta, value, date }, actor)),
});

export const trackersTools: ToolDef[] = [listTrackersTool, addTrackerTool, logTrackerTool];
