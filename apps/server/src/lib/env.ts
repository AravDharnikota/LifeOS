import path from "node:path";

export interface Env {
  port: number;
  dataDir: string;
  dbFile: string;
  uploadsDir: string;
  token: string | null;
  anthropicApiKey: string | null;
  model: string;
  visionModel: string;
  publicUrl: string;
  googleClientId: string | null;
  googleClientSecret: string | null;
  timezone: string;
  nodeEnv: string;
}

export function loadEnv(overrides: Partial<Env> = {}): Env {
  const e = process.env;
  const dataDir = path.resolve(e.ARAVOS_DATA_DIR ?? "./data");
  const env: Env = {
    port: Number(e.PORT ?? 8787),
    dataDir,
    dbFile: path.join(dataDir, "aravos.db"),
    uploadsDir: path.join(dataDir, "uploads"),
    token: e.ARAVOS_TOKEN?.trim() || null,
    anthropicApiKey: e.ANTHROPIC_API_KEY?.trim() || null,
    model: e.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5",
    visionModel: e.ANTHROPIC_VISION_MODEL?.trim() || e.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5",
    publicUrl: (e.ARAVOS_PUBLIC_URL ?? `http://localhost:${e.PORT ?? 8787}`).replace(/\/$/, ""),
    googleClientId: e.GOOGLE_CLIENT_ID?.trim() || null,
    googleClientSecret: e.GOOGLE_CLIENT_SECRET?.trim() || null,
    timezone: e.ARAVOS_TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    nodeEnv: e.NODE_ENV ?? "development",
  };
  return { ...env, ...overrides };
}
