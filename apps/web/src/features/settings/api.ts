import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Activity, AppSettings, HealthProfile, SchedulerPrefs } from "@aravos/shared";
import { api } from "@/lib/api";
import { invalidateAll, keys, type SettingsResponse } from "@/data/queries";
import { notify } from "@/lib/haptics";
import { toast } from "@/ui/Toast";

export type HealthPatch = Partial<Omit<HealthProfile, "targets">> & { targets?: Partial<HealthProfile["targets"]> };

/** Optimistic PATCH of one settings document; the settings query is the single source of truth. */
function useSettingsPatch<TPatch>(path: string, merge: (s: SettingsResponse, p: TPatch) => SettingsResponse) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: TPatch) => api.patch<unknown>(path, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: keys.settings });
      const prev = qc.getQueryData<SettingsResponse>(keys.settings);
      if (prev) qc.setQueryData(keys.settings, merge(prev, patch));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.settings, ctx.prev);
      void notify("error");
      toast("Setting not saved. Try again.");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.settings }),
  });
}

export const useUpdateApp = () => useSettingsPatch<Partial<AppSettings>>("/api/settings/app", (s, p) => ({ ...s, app: { ...s.app, ...p } }));
export const useUpdateHealth = () => useSettingsPatch<HealthPatch>("/api/settings/health-profile", (s, p) => ({ ...s, healthProfile: { ...s.healthProfile, ...p, targets: { ...s.healthProfile.targets, ...(p.targets ?? {}) } } }));
export const useUpdateScheduler = () => useSettingsPatch<Partial<SchedulerPrefs>>("/api/settings/scheduler", (s, p) => ({ ...s, scheduler: { ...s.scheduler, ...p, workHours: { ...s.scheduler.workHours, ...(p.workHours ?? {}) } } }));

export interface SchedulerStats {
  historyCount: number;
  calibrationFactor: number;
  meanAbsErrorMinutes: number | null;
  lastRun: { id: string; ranAt: string; trigger: string; placed: number; moved: number; unplaced: number; summary: string } | null;
}
export const useSchedulerStats = () => useQuery({ queryKey: ["scheduler", "stats"], queryFn: () => api.get<SchedulerStats>("/api/scheduler/stats"), staleTime: 60_000 });

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  calendars: { id: string; name: string; syncEnabled: boolean }[];
  tasksLists: { id: string; name: string; googleId: string | null }[];
}
export const useGoogleStatus = (enabled: boolean) => useQuery({ queryKey: ["google", "status"], queryFn: () => api.get<GoogleStatus>("/api/google/status"), enabled, staleTime: 30_000 });

export interface SyncStats {
  calendars: number;
  eventsPulled: number;
  eventsPushed: number;
  tasksPulled: number;
  tasksPushed: number;
  errors: string[];
}
export function useGoogleSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SyncStats>("/api/google/sync", {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["google"] });
      invalidateAll(qc, ["events", "tasks", "calendars", "lists", "summary"]);
    },
  });
}
export function useGoogleDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/google/disconnect"),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["google"] });
      void qc.invalidateQueries({ queryKey: keys.settings });
    },
  });
}
export const fetchGoogleAuthUrl = () => api.get<{ url: string }>("/api/google/auth-url");

export const useActivity = () => useQuery({ queryKey: ["activity"], queryFn: () => api.get<Activity[]>("/api/activity?limit=200") });

export interface SuggestedTargets {
  suggestion: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number; waterMl: number; sugarMaxG: number; sodiumMaxMg: number; proteinRangeG: { min: number; max: number }; bmr: number | null; tdee: number | null; calorieFloor: number; floorApplied: boolean; paceKgPerWeek: number };
  inputs: { weightKg: number | null; weightDate: string | null; sex: HealthProfile["sex"]; birthDate: string | null; ageYears: number | null; heightCm: number | null; activityLevel: HealthProfile["activityLevel"]; goal: HealthProfile["goal"]; requestedPaceKgPerWeek: number; targetWeightKg: number | null };
  current: HealthProfile["targets"];
}
export const fetchSuggestedTargets = () => api.get<SuggestedTargets>("/api/health/suggest-targets");
export function useApplySuggestedTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<HealthProfile>("/api/health/apply-suggested-targets"),
    onSuccess: (profile) => {
      const prev = qc.getQueryData<SettingsResponse>(keys.settings);
      if (prev) qc.setQueryData(keys.settings, { ...prev, healthProfile: profile });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.settings });
      invalidateAll(qc, ["summary"]);
    },
  });
}

/** Clipboard with a fallback for non-secure contexts (the LAN address of the server). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
