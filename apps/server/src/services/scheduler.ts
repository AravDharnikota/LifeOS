import type { SchedulerResult } from "@aravos/shared";
import type { AppContext } from "../app.ts";

export interface RunSchedulerOptions {
  trigger: "manual" | "mcp" | "auto" | "agent";
  dryRun?: boolean;
  horizonDays?: number;
  /** restrict to these tasks (optional) */
  taskIds?: string[];
}

// TODO: implemented in the scheduler step
export async function runScheduler(_ctx: AppContext, _opts: RunSchedulerOptions): Promise<SchedulerResult> {
  return { placed: [], unplaced: [], moved: 0, summary: "Scheduler not implemented yet." };
}

export async function runSchedulerIfEnabled(_ctx: AppContext, _trigger: RunSchedulerOptions["trigger"]): Promise<SchedulerResult | null> {
  return null;
}
