import type { AppContext } from "../app.ts";

/**
 * Lightweight in-process jobs: nightly duration learning + auto scheduling, and periodic Google sync.
 * Everything here is best-effort and never throws.
 */
export function startScheduledJobs(ctx: AppContext): () => void {
  const timers: NodeJS.Timeout[] = [];
  const safe = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[jobs] ${name} failed:`, e instanceof Error ? e.message : e);
    }
  };
  // Google sync every 10 minutes if connected
  timers.push(
    setInterval(() => {
      void safe("google-sync", async () => {
        const { syncAllGoogle } = await import("../google/sync.ts");
        await syncAllGoogle(ctx);
      });
    }, 10 * 60 * 1000),
  );
  // Auto scheduler every 30 minutes
  timers.push(
    setInterval(() => {
      void safe("auto-schedule", async () => {
        const { runSchedulerIfEnabled } = await import("../services/scheduler.ts");
        await runSchedulerIfEnabled(ctx, "auto");
      });
    }, 30 * 60 * 1000),
  );
  for (const t of timers) t.unref();
  return () => timers.forEach(clearInterval);
}
