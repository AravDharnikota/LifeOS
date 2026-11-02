import type { AppContext } from "../app.ts";

/**
 * Debounced automatic re-planning after task or calendar writes.
 * Runs the scheduler at most once per window; disabled under test.
 */
const WINDOW_MS = 30_000;
let timer: NodeJS.Timeout | null = null;
let pending = false;

export function requestReplan(ctx: AppContext): void {
  if (ctx.env.nodeEnv === "test") return;
  pending = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (!pending) return;
    pending = false;
    void import("./scheduler.ts")
      .then(({ runSchedulerIfEnabled }) => runSchedulerIfEnabled(ctx, "auto"))
      .catch((e: unknown) => console.error("[replan] failed:", e instanceof Error ? e.message : e));
  }, WINDOW_MS);
  timer.unref();
}
