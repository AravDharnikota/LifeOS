import { z } from "zod";
import type { App } from "../app.ts";
import { parseBody } from "../lib/http.ts";
import { estimateTasks, getSchedulerStats, listSchedulerRuns, runScheduler, triggerForActor } from "../services/scheduler.ts";

const RunBody = z.object({
  dryRun: z.boolean().optional(),
  horizonDays: z.number().int().min(1).max(30).optional(),
  taskIds: z.array(z.string().min(1)).max(500).optional(),
});

const EstimateBody = z.object({ taskIds: z.array(z.string().min(1)).min(1).max(500) });

export function schedulerRoutes(app: App): void {
  app.post("/api/scheduler/run", async (c) => {
    const body = await parseBody(c, RunBody);
    const result = await runScheduler(c.get("ctx"), { trigger: triggerForActor(c.get("actor")), dryRun: body.dryRun, horizonDays: body.horizonDays, taskIds: body.taskIds });
    return c.json(result);
  });

  app.get("/api/scheduler/runs", (c) => c.json(listSchedulerRuns(c.get("ctx").db, 20)));

  app.get("/api/scheduler/stats", (c) => c.json(getSchedulerStats(c.get("ctx").db)));

  app.post("/api/scheduler/estimate", async (c) => {
    const body = await parseBody(c, EstimateBody);
    return c.json(await estimateTasks(c.get("ctx"), body.taskIds));
  });
}
