import { z } from "zod";
import { GoalCreate, GoalUpdate, GoalEntryCreate, GoalMilestoneCreate, GoalMilestoneUpdate } from "@aravos/shared";
import type { App } from "../app.ts";
import { parseBody } from "../lib/http.ts";
import { addMilestone, createGoal, deleteGoal, deleteMilestone, getGoal, listGoals, logGoalEntry, updateGoal, updateMilestone } from "../services/goals.ts";

export function goalsRoutes(app: App): void {
  app.get("/api/goals", (c) => c.json(listGoals(c.get("ctx").db, { status: c.req.query("status") ?? "active", area: c.req.query("area") })));
  app.post("/api/goals", async (c) => c.json(createGoal(c.get("ctx").db, await parseBody(c, GoalCreate), c.get("actor")), 201));
  app.get("/api/goals/:id", (c) => c.json(getGoal(c.get("ctx").db, c.req.param("id"))));
  app.patch("/api/goals/:id", async (c) => c.json(updateGoal(c.get("ctx").db, c.req.param("id"), await parseBody(c, GoalUpdate), c.get("actor"))));
  app.delete("/api/goals/:id", (c) => {
    deleteGoal(c.get("ctx").db, c.req.param("id"), c.get("actor"));
    return c.json({ ok: true });
  });
  app.post("/api/goals/:id/log", async (c) => {
    const body = await parseBody(c, GoalEntryCreate.extend({ delta: z.number().optional() }));
    return c.json(logGoalEntry(c.get("ctx").db, c.req.param("id"), body, c.get("actor")));
  });
  app.post("/api/goals/:id/milestones", async (c) => c.json(addMilestone(c.get("ctx").db, c.req.param("id"), await parseBody(c, GoalMilestoneCreate)), 201));
  app.patch("/api/milestones/:id", async (c) => c.json(updateMilestone(c.get("ctx").db, c.req.param("id"), await parseBody(c, GoalMilestoneUpdate))));
  app.delete("/api/milestones/:id", (c) => {
    deleteMilestone(c.get("ctx").db, c.req.param("id"));
    return c.json({ ok: true });
  });
}
