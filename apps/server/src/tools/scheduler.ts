import { z } from "zod";
import { getSchedulerStats, runScheduler, triggerForActor } from "../services/scheduler.ts";
import { defineTool, type ToolDef } from "./types.ts";

const planSchedule = defineTool({
  name: "plan_schedule",
  description:
    "Run the time-boxing scheduler: places open tasks with a due date, start date or existing time box into free work hours as calendar blocks. Locked blocks are never moved. Use dryRun to preview without changing the calendar.",
  input: z.object({
    dryRun: z.boolean().optional().describe("Preview only; nothing is written"),
    horizonDays: z.number().int().min(1).max(30).optional().describe("Days to plan ahead (defaults to the scheduler preference)"),
  }),
  async handler(input, { ctx, actor }) {
    const r = await runScheduler(ctx, { trigger: triggerForActor(actor), dryRun: input.dryRun, horizonDays: input.horizonDays });
    return {
      summary: r.summary,
      moved: r.moved,
      placed: r.placed.map((p) => ({ taskId: p.taskId, title: p.title, blocks: p.blocks.map((b) => ({ start: b.start, end: b.end })) })),
      unplaced: r.unplaced,
    };
  },
});

const getScheduleStats = defineTool({
  name: "get_schedule_stats",
  description: "How the scheduler is learning: duration history size, the calibration factor applied to estimates, mean estimate error, and the last run.",
  input: z.object({}),
  readOnly: true,
  handler(_input, { ctx }) {
    const s = getSchedulerStats(ctx.db);
    return {
      historyCount: s.historyCount,
      calibrationFactor: s.calibrationFactor,
      meanAbsErrorMinutes: s.meanAbsErrorMinutes,
      lastRun: s.lastRun ? { ranAt: s.lastRun.ranAt, trigger: s.lastRun.trigger, placed: s.lastRun.placed, moved: s.lastRun.moved, unplaced: s.lastRun.unplaced, summary: s.lastRun.summary } : null,
    };
  },
});

export const schedulerTools: ToolDef[] = [planSchedule, getScheduleStats] as ToolDef[];
