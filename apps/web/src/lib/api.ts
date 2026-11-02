import { Preferences } from "@capacitor/preferences";
import { isNative } from "./platform";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const KEY_TOKEN = "aravos.token";
const KEY_SERVER = "aravos.server";

let token: string | null = null;
let serverUrl = "";
let loaded = false;

async function loadConfig(): Promise<void> {
  if (loaded) return;
  loaded = true;
  if (isNative) {
    token = (await Preferences.get({ key: KEY_TOKEN })).value;
    serverUrl = (await Preferences.get({ key: KEY_SERVER })).value ?? "";
  } else {
    token = localStorage.getItem(KEY_TOKEN);
    serverUrl = localStorage.getItem(KEY_SERVER) ?? "";
  }
}

export async function getConfig(): Promise<{ token: string | null; serverUrl: string }> {
  await loadConfig();
  return { token, serverUrl };
}

export async function setConfig(next: { token?: string | null; serverUrl?: string }): Promise<void> {
  await loadConfig();
  if (next.token !== undefined) {
    token = next.token;
    if (isNative) await (token ? Preferences.set({ key: KEY_TOKEN, value: token }) : Preferences.remove({ key: KEY_TOKEN }));
    else token ? localStorage.setItem(KEY_TOKEN, token) : localStorage.removeItem(KEY_TOKEN);
  }
  if (next.serverUrl !== undefined) {
    serverUrl = next.serverUrl.replace(/\/$/, "");
    if (isNative) await Preferences.set({ key: KEY_SERVER, value: serverUrl });
    else localStorage.setItem(KEY_SERVER, serverUrl);
  }
}

export function resolveUrl(path: string): string {
  if (/^https?:/.test(path)) return path;
  return `${serverUrl}${path}`;
}

export function authHeaders(): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  await loadConfig();
  const headers: Record<string, string> = { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(resolveUrl(path), { ...init, method, headers, body: payload });
  } catch (e) {
    throw new ApiError(0, "Unable to reach the server", e);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, (data as { details?: unknown } | null)?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>("GET", path, undefined, init),
  post: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>("POST", path, body, init),
  put: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>("PUT", path, body, init),
  patch: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>("PATCH", path, body, init),
  delete: <T>(path: string, init?: RequestInit) => request<T>("DELETE", path, undefined, init),
};

/** Query-string helper that drops undefined values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Open an SSE POST stream and dispatch named events. Returns an abort function. */
export async function streamEvents(path: string, body: unknown, onEvent: (event: string, data: unknown) => void, signal?: AbortSignal): Promise<void> {
  await loadConfig();
  const res = await fetch(resolveUrl(path), { method: "POST", headers: { ...authHeaders(), "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status})`;
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? msg;
    } catch {
      /* keep */
    }
    throw new ApiError(res.status, msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;
      const raw = dataLines.join("\n");
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        /* plain text */
      }
      onEvent(event, data);
    }
  }
}
