import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import type { Db } from "./db/client.ts";
import { openDb } from "./db/client.ts";
import { loadEnv, type Env } from "./lib/env.ts";
import { HttpError } from "./lib/errors.ts";
import { seedDatabase } from "./services/seed.ts";
import { createAiProvider, type AiProvider } from "./ai/provider.ts";
import { registerRoutes } from "./routes/index.ts";

export interface AppContext {
  db: Db;
  env: Env;
  ai: AiProvider;
}

export type AppVariables = { ctx: AppContext; actor: string };
export type App = Hono<{ Variables: AppVariables }>;

export interface CreateAppOptions {
  env?: Partial<Env>;
  db?: Db;
  ai?: AiProvider;
  /** Serve the built web app from this directory (production). */
  webDist?: string | null;
}

export function createApp(opts: CreateAppOptions = {}): { app: App; ctx: AppContext } {
  const env = loadEnv(opts.env);
  // All Date math on the server happens in the user's timezone (dates are YYYY-MM-DD local strings).
  if (process.env.TZ !== env.timezone) process.env.TZ = env.timezone;
  const db = opts.db ?? openDb(env.dbFile);
  seedDatabase(db, env);
  const ai = opts.ai ?? createAiProvider(env);
  const ctx: AppContext = { db, env, ai };
  const app: App = new Hono();

  if (env.nodeEnv !== "test") app.use("*", logger((s) => process.stdout.write(s + "\n")));
  app.use("/api/*", cors({ origin: (o) => o, credentials: true, allowHeaders: ["Authorization", "Content-Type", "X-Actor"], exposeHeaders: ["Content-Type"] }));
  app.use("/mcp", cors({ origin: (o) => o, allowHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version"], exposeHeaders: ["Mcp-Session-Id"] }));

  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    c.set("actor", c.req.header("x-actor")?.slice(0, 60) || "user");
    await next();
  });

  // auth: bearer token on /api/* (except /api/health and the Google OAuth callback) and /mcp
  app.use("*", async (c, next) => {
    const p = c.req.path;
    const protectedPath = (p.startsWith("/api/") || p === "/mcp" || p.startsWith("/mcp/") || p.startsWith("/uploads/"));
    const open = p === "/api/health" || p === "/api/google/callback" || p === "/api/auth/check";
    if (!protectedPath || open || !env.token) return next();
    const header = c.req.header("authorization") ?? "";
    const q = c.req.query("token");
    const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : q ?? "";
    if (presented !== env.token) {
      if (p.startsWith("/mcp")) return c.json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }, 401);
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, details: err.details ?? null }, err.status as 400);
    if (err instanceof ZodError) return c.json({ error: "Validation failed", details: err.issues }, 400);
    console.error(err);
    return c.json({ error: err.message || "Internal error" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true, name: "AravOS", version: "0.1.0", ai: ai.enabled, authRequired: Boolean(env.token), time: new Date().toISOString() }));
  app.get("/api/auth/check", (c) => {
    const header = c.req.header("authorization") ?? "";
    const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    const ok = !env.token || presented === env.token;
    return c.json({ ok, authRequired: Boolean(env.token) }, ok ? 200 : 401);
  });

  registerRoutes(app);

  // uploads (photos)
  fs.mkdirSync(env.uploadsDir, { recursive: true });
  app.use("/uploads/*", serveStatic({ root: env.dataDir }));

  // web app (production)
  const dist = opts.webDist === undefined ? findWebDist() : opts.webDist;
  if (dist) {
    app.use("/*", serveStatic({ root: dist }));
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/mcp")) return c.json({ error: "Not found" }, 404);
      return c.html(fs.readFileSync(path.join(dist, "index.html"), "utf8"));
    });
  }
  return { app, ctx };
}

function findWebDist(): string | null {
  const candidates = [path.resolve(process.cwd(), "apps/web/dist"), path.resolve(process.cwd(), "../web/dist"), path.resolve(process.cwd(), "web")];
  for (const c of candidates) if (fs.existsSync(path.join(c, "index.html"))) return c;
  return null;
}
