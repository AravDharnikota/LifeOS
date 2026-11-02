import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppContext } from "../app.ts";
import type { Db } from "../db/client.ts";
import { schema } from "../db/client.ts";
import type { Env } from "../lib/env.ts";
import { badRequest } from "../lib/errors.ts";
import { getRawSetting, setSetting } from "../services/settings.ts";
import { errorMessage, setSyncStatus } from "./state.ts";
import type { GoogleTokens, ResolvedDeps } from "./types.ts";

export const TOKENS_KEY = "google_tokens";
export const OAUTH_STATE_KEY = "google_oauth_state";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/tasks",
  "openid",
  "email",
];

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000;

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    public code: "not_configured" | "not_connected" | "invalid_grant" | "refresh_failed" | "exchange_failed",
  ) {
    super(message);
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export function isGoogleConfigured(env: Env): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

export function redirectUri(env: Env): string {
  return `${env.publicUrl}/api/google/callback`;
}

function requireConfig(env: Env): { clientId: string; clientSecret: string } {
  if (!env.googleClientId || !env.googleClientSecret) {
    throw badRequest("Google sync is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server");
  }
  return { clientId: env.googleClientId, clientSecret: env.googleClientSecret };
}

export function getTokens(db: Db): GoogleTokens | null {
  const raw = getRawSetting(db, TOKENS_KEY);
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<GoogleTokens>;
  if (typeof t.accessToken !== "string" || typeof t.refreshToken !== "string" || typeof t.expiresAt !== "string") return null;
  return {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    expiresAt: t.expiresAt,
    email: typeof t.email === "string" ? t.email : null,
    scope: typeof t.scope === "string" ? t.scope : "",
    connectedAt: typeof t.connectedAt === "string" ? t.connectedAt : t.expiresAt,
  };
}

export function saveTokens(db: Db, tokens: GoogleTokens): void {
  setSetting(db, TOKENS_KEY, tokens);
}

export function clearTokens(db: Db): void {
  db.delete(schema.settings).where(eq(schema.settings.key, TOKENS_KEY)).run();
}

export function createAuthUrl(ctx: AppContext): string {
  const { clientId } = requireConfig(ctx.env);
  const state = randomBytes(24).toString("hex");
  setSetting(ctx.db, OAUTH_STATE_KEY, { state, createdAt: new Date().toISOString() });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(ctx.env),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Validates and consumes the stored OAuth state. Returns false when it does not match or has expired. */
export function consumeOAuthState(db: Db, state: string): boolean {
  const raw = getRawSetting(db, OAUTH_STATE_KEY) as { state?: string; createdAt?: string } | null;
  db.delete(schema.settings).where(eq(schema.settings.key, OAUTH_STATE_KEY)).run();
  if (!raw || typeof raw.state !== "string" || raw.state !== state) return false;
  const created = Date.parse(raw.createdAt ?? "");
  return Number.isFinite(created) && Date.now() - created <= STATE_TTL_MS;
}

async function postToken(deps: ResolvedDeps, form: Record<string, string>): Promise<TokenResponse> {
  const res = await deps.fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let json: TokenResponse = {};
  try {
    json = text ? (JSON.parse(text) as TokenResponse) : {};
  } catch {
    json = { error: "invalid_response", error_description: text.slice(0, 200) };
  }
  if (!res.ok && !json.error) json.error = `http_${res.status}`;
  return json;
}

async function fetchEmail(deps: ResolvedDeps, accessToken: string): Promise<string | null> {
  try {
    const res = await deps.fetchImpl(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string };
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

function expiresAtFrom(deps: ResolvedDeps, expiresIn: number | undefined): string {
  return new Date(deps.now().getTime() + (expiresIn ?? 3600) * 1000).toISOString();
}

export async function exchangeCode(ctx: AppContext, code: string, deps: ResolvedDeps): Promise<GoogleTokens> {
  const { clientId, clientSecret } = requireConfig(ctx.env);
  const json = await postToken(deps, { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(ctx.env), grant_type: "authorization_code" });
  if (json.error || !json.access_token) throw new GoogleAuthError(`Google sign-in failed: ${json.error_description ?? json.error ?? "no access token"}`, "exchange_failed");
  if (!json.refresh_token) throw new GoogleAuthError("Google did not return a refresh token. Remove AravOS from your Google account permissions and connect again", "exchange_failed");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: expiresAtFrom(deps, json.expires_in),
    email: await fetchEmail(deps, json.access_token),
    scope: json.scope ?? GOOGLE_SCOPES.join(" "),
    connectedAt: deps.now().toISOString(),
  };
}

export async function refreshTokens(ctx: AppContext, tokens: GoogleTokens, deps: ResolvedDeps): Promise<GoogleTokens> {
  const { clientId, clientSecret } = requireConfig(ctx.env);
  const json = await postToken(deps, { refresh_token: tokens.refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
  if (json.error === "invalid_grant") {
    clearTokens(ctx.db);
    const message = "Google access expired or was revoked. Reconnect Google in settings";
    setSyncStatus(ctx.db, { lastError: message });
    throw new GoogleAuthError(message, "invalid_grant");
  }
  if (json.error || !json.access_token) throw new GoogleAuthError(`Could not refresh the Google token: ${json.error_description ?? json.error ?? "no access token"}`, "refresh_failed");
  const next: GoogleTokens = { ...tokens, accessToken: json.access_token, expiresAt: expiresAtFrom(deps, json.expires_in), scope: json.scope ?? tokens.scope };
  saveTokens(ctx.db, next);
  return next;
}

/** Returns a usable access token, refreshing it when it expires within 60 seconds (or when `force` is set). */
export async function getAccessToken(ctx: AppContext, deps: ResolvedDeps, opts: { force?: boolean } = {}): Promise<string> {
  const tokens = getTokens(ctx.db);
  if (!tokens) throw new GoogleAuthError("Google is not connected", "not_connected");
  const expiresSoon = Date.parse(tokens.expiresAt) - deps.now().getTime() < REFRESH_MARGIN_MS;
  if (!opts.force && !expiresSoon) return tokens.accessToken;
  try {
    return (await refreshTokens(ctx, tokens, deps)).accessToken;
  } catch (e) {
    if (e instanceof GoogleAuthError) throw e;
    throw new GoogleAuthError(`Could not refresh the Google token: ${errorMessage(e)}`, "refresh_failed");
  }
}
