import { z } from "zod";
import { AppSettings, HealthProfile, SchedulerPrefs } from "@aravos/shared";
import type { App } from "../app.ts";
import { parseBody } from "../lib/http.ts";
import { getAppSettings, getHealthProfile, getRawSetting, getSchedulerPrefs, setSetting } from "../services/settings.ts";

export function settingsRoutes(app: App): void {
  app.get("/api/settings", (c) => {
    const { db, env, ai } = c.get("ctx");
    const google = getRawSetting(db, "google_tokens") as { email?: string; connectedAt?: string } | null;
    return c.json({
      app: getAppSettings(db),
      healthProfile: getHealthProfile(db),
      scheduler: getSchedulerPrefs(db),
      integrations: {
        anthropic: { configured: ai.enabled, model: env.model, visionModel: env.visionModel },
        google: { configured: Boolean(env.googleClientId && env.googleClientSecret), connected: Boolean(google?.connectedAt), email: google?.email ?? null, connectedAt: google?.connectedAt ?? null },
        mcp: { url: `${env.publicUrl}/mcp`, authRequired: Boolean(env.token) },
      },
      server: { publicUrl: env.publicUrl, timezone: env.timezone, dataDir: env.dataDir, version: "0.1.0" },
    });
  });
  app.patch("/api/settings/app", async (c) => {
    const { db } = c.get("ctx");
    const body = await parseBody(c, AppSettings.partial());
    const merged = AppSettings.parse({ ...getAppSettings(db), ...body });
    setSetting(db, "app", merged);
    return c.json(merged);
  });
  app.patch("/api/settings/health-profile", async (c) => {
    const { db } = c.get("ctx");
    const body = await parseBody(c, HealthProfile.partial().extend({ targets: HealthProfile.shape.targets.unwrap().partial().optional() }));
    const current = getHealthProfile(db);
    const merged = HealthProfile.parse({ ...current, ...body, targets: { ...current.targets, ...(body.targets ?? {}) } });
    setSetting(db, "health_profile", merged);
    return c.json(merged);
  });
  app.patch("/api/settings/scheduler", async (c) => {
    const { db } = c.get("ctx");
    const body = await parseBody(c, SchedulerPrefs.partial());
    const current = getSchedulerPrefs(db);
    const merged = SchedulerPrefs.parse({ ...current, ...body, workHours: { ...current.workHours, ...(body.workHours ?? {}) } });
    setSetting(db, "scheduler", merged);
    return c.json(merged);
  });
  app.post("/api/settings/reset", async (c) => {
    const body = await parseBody(c, z.object({ key: z.enum(["app", "health_profile", "scheduler"]) }));
    const { db } = c.get("ctx");
    setSetting(db, body.key, {});
    return c.json({ ok: true });
  });
}
