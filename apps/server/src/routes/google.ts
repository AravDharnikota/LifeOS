import { z } from "zod";
import type { App } from "../app.ts";
import { parseBody } from "../lib/http.ts";
import { consumeOAuthState, createAuthUrl, exchangeCode, saveTokens } from "../google/oauth.ts";
import { errorMessage, getGoogleDeps, resolveDeps } from "../google/state.ts";
import { disconnectGoogle, enableGoogleCalendars, googleStatus, runGoogleSync } from "../google/sync.ts";

const SyncBody = z.object({ full: z.boolean().optional() }).optional();

export function googleRoutes(app: App): void {
  app.get("/api/google/auth-url", (c) => c.json({ url: createAuthUrl(c.get("ctx")) }));

  app.get("/api/google/callback", async (c) => {
    const ctx = c.get("ctx");
    const settingsUrl = `${ctx.env.publicUrl}/settings`;
    const fail = (message: string) => c.redirect(`${settingsUrl}?google=error&message=${encodeURIComponent(message)}`);
    const { code, state, error } = c.req.query();
    if (error) return fail(`Google sign-in was cancelled (${error})`);
    if (!code || !state) return fail("Google did not return a sign-in code");
    if (!consumeOAuthState(ctx.db, state)) return fail("The sign-in link has expired. Try connecting again");
    const deps = resolveDeps(getGoogleDeps(ctx));
    try {
      saveTokens(ctx.db, await exchangeCode(ctx, code, deps));
      enableGoogleCalendars(ctx);
    } catch (e) {
      return fail(errorMessage(e));
    }
    try {
      await runGoogleSync(ctx, { full: true }, getGoogleDeps(ctx));
    } catch (e) {
      console.warn("[google] initial sync failed:", errorMessage(e));
    }
    return c.redirect(`${settingsUrl}?google=connected`);
  });

  app.post("/api/google/disconnect", (c) => {
    disconnectGoogle(c.get("ctx"));
    return c.json({ ok: true });
  });

  app.get("/api/google/status", (c) => c.json(googleStatus(c.get("ctx"))));

  app.post("/api/google/sync", async (c) => {
    const body = (await parseBody(c, SyncBody).catch(() => undefined)) ?? {};
    const ctx = c.get("ctx");
    return c.json(await runGoogleSync(ctx, { full: body.full ?? false }, getGoogleDeps(ctx)));
  });
}
