import { create } from "zustand";
import { api, getConfig, setConfig } from "@/lib/api";
import { isNative } from "@/lib/platform";

export interface HealthInfo {
  ok: boolean;
  name: string;
  version: string;
  ai: boolean;
  authRequired: boolean;
}

interface AuthState {
  status: "booting" | "ready" | "needs-setup" | "offline";
  health: HealthInfo | null;
  error: string | null;
  serverUrl: string;
  boot: () => Promise<void>;
  connect: (serverUrl: string, token: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: "booting",
  health: null,
  error: null,
  serverUrl: "",
  boot: async () => {
    const cfg = await getConfig();
    set({ serverUrl: cfg.serverUrl });
    if (isNative && !cfg.serverUrl) {
      set({ status: "needs-setup" });
      return;
    }
    try {
      const health = await api.get<HealthInfo>("/api/health");
      if (health.authRequired) {
        const check = await fetch(`${cfg.serverUrl}/api/auth/check`, { headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {} });
        if (!check.ok) {
          set({ status: "needs-setup", health, error: cfg.token ? "That token was not accepted." : null });
          return;
        }
      }
      set({ status: "ready", health, error: null });
    } catch (e) {
      set({ status: isNative ? "needs-setup" : "offline", error: e instanceof Error ? e.message : "Unable to reach the server" });
    }
  },
  connect: async (serverUrl, token) => {
    await setConfig({ serverUrl: isNative ? serverUrl : "", token: token || null });
    await get().boot();
    return get().status === "ready";
  },
  disconnect: async () => {
    await setConfig({ token: null });
    await get().boot();
  },
}));
