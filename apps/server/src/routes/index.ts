import type { App } from "../app.ts";
import { tasksRoutes } from "./tasks.ts";
import { calendarRoutes } from "./calendar.ts";
import { goalsRoutes } from "./goals.ts";
import { trackersRoutes } from "./trackers.ts";
import { settingsRoutes } from "./settings.ts";
import { layoutRoutes } from "./layout.ts";
import { activityRoutes } from "./activity.ts";
import { workoutsRoutes } from "./workouts.ts";
import { nutritionRoutes } from "./nutrition.ts";
import { bodyRoutes } from "./body.ts";
import { agentRoutes } from "./agent.ts";
import { schedulerRoutes } from "./scheduler.ts";
import { googleRoutes } from "./google.ts";
import { mcpRoutes } from "../mcp/routes.ts";
import { summaryRoutes } from "./summary.ts";

export function registerRoutes(app: App): void {
  tasksRoutes(app);
  calendarRoutes(app);
  goalsRoutes(app);
  trackersRoutes(app);
  settingsRoutes(app);
  layoutRoutes(app);
  activityRoutes(app);
  workoutsRoutes(app);
  nutritionRoutes(app);
  bodyRoutes(app);
  agentRoutes(app);
  schedulerRoutes(app);
  googleRoutes(app);
  summaryRoutes(app);
  mcpRoutes(app);
}
