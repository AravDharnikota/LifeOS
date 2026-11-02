import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { startScheduledJobs } from "./services/jobs.ts";

const { app, ctx } = createApp();
serve({ fetch: app.fetch, port: ctx.env.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`AravOS server listening on http://localhost:${info.port}`);
  console.log(`  data: ${ctx.env.dataDir}`);
  console.log(`  ai:   ${ctx.ai.enabled ? ctx.env.model : "disabled (set ANTHROPIC_API_KEY)"}`);
  console.log(`  auth: ${ctx.env.token ? "bearer token required" : "OPEN (set ARAVOS_TOKEN before exposing this server)"}`);
  console.log(`  mcp:  ${ctx.env.publicUrl}/mcp`);
});
startScheduledJobs(ctx);
