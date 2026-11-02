import type { ToolDef } from "./types.ts";
import { tasksTools } from "./tasks.ts";
import { calendarTools } from "./calendar.ts";
import { goalsTools } from "./goals.ts";
import { trackersTools } from "./trackers.ts";
import { healthTools } from "./health.ts";
import { summaryTools } from "./summary.ts";
import { schedulerTools } from "./scheduler.ts";
import { layoutTools } from "./layout.ts";
import { memoryTools } from "./memory.ts";

export * from "./types.ts";

export const allTools: ToolDef[] = [...summaryTools, ...tasksTools, ...calendarTools, ...schedulerTools, ...goalsTools, ...trackersTools, ...healthTools, ...layoutTools, ...memoryTools];

export function toolsFor(surface: "agent" | "mcp"): ToolDef[] {
  const seen = new Set<string>();
  const out: ToolDef[] = [];
  for (const t of allTools) {
    if (t.surfaces && !t.surfaces.includes(surface)) continue;
    if (seen.has(t.name)) throw new Error(`Duplicate tool name: ${t.name}`);
    seen.add(t.name);
    out.push(t);
  }
  return out;
}
