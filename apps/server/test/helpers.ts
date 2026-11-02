import { createApp, type AppContext } from "../src/app.ts";
import { openDb } from "../src/db/client.ts";
import { MockAiProvider } from "../src/ai/mock.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TestApp {
  ctx: AppContext;
  ai: MockAiProvider;
  /** JSON request helper. Throws on non-2xx unless `allowError`. */
  api: <T = unknown>(method: string, url: string, body?: unknown, opts?: { allowError?: boolean; headers?: Record<string, string> }) => Promise<{ status: number; data: T }>;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  cleanup: () => void;
}

export function makeTestApp(opts: { token?: string | null } = {}): TestApp {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aravos-test-"));
  const db = openDb(":memory:");
  const ai = new MockAiProvider();
  const { app, ctx } = createApp({
    env: { nodeEnv: "test", token: opts.token ?? null, dataDir, uploadsDir: path.join(dataDir, "uploads"), timezone: "UTC", publicUrl: "http://test.local" },
    db,
    ai,
    webDist: null,
  });
  const fetchFn = async (url: string, init?: RequestInit) => app.request(url, init);
  const api: TestApp["api"] = async (method, url, body, o = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...(o.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const res = await app.request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!o.allowError && (res.status < 200 || res.status >= 300)) throw new Error(`${method} ${url} -> ${res.status}: ${text}`);
    return { status: res.status, data: data as never };
  };
  return { ctx, ai, api, fetch: fetchFn, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}
