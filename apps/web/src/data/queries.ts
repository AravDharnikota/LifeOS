import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AppSettings, CalEvent, Goal, HealthProfile, Layout, SchedulerPrefs, Task, TaskList, Tracker } from "@aravos/shared";
import { api, qs } from "@/lib/api";
import { todayString } from "@aravos/shared";

export interface SettingsResponse {
  app: AppSettings;
  healthProfile: HealthProfile;
  scheduler: SchedulerPrefs;
  integrations: {
    anthropic: { configured: boolean; model: string; visionModel: string };
    google: { configured: boolean; connected: boolean; email: string | null; connectedAt: string | null };
    mcp: { url: string; authRequired: boolean };
  };
  server: { publicUrl: string; timezone: string; dataDir: string; version: string };
}

export const keys = {
  settings: ["settings"] as const,
  summary: (date: string) => ["summary", date] as const,
  tasks: (params: Record<string, string | undefined>) => ["tasks", params] as const,
  task: (id: string) => ["task", id] as const,
  lists: ["lists"] as const,
  events: (from: string, to: string) => ["events", from, to] as const,
  calendars: ["calendars"] as const,
  goals: (status?: string) => ["goals", status ?? "active"] as const,
  goal: (id: string) => ["goal", id] as const,
  trackers: ["trackers"] as const,
  layout: (id: string) => ["layout", id] as const,
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api.get<SettingsResponse>("/api/settings"), staleTime: 60_000 });

export function useAppSettings(): AppSettings {
  const { data } = useSettings();
  return data?.app ?? { name: "Arav", timezone: "UTC", weekStartsOn: 1, units: "imperial", defaultRestSeconds: 90, haptics: true, theme: "system", accent: "ink", mirrorTimeboxes: false, hour12: false };
}

export const useTasks = (params: { view?: string; listId?: string; date?: string; goalId?: string; includeDone?: boolean; limit?: number } = {}) =>
  useQuery({
    queryKey: keys.tasks({ view: params.view, listId: params.listId, date: params.date, goalId: params.goalId, includeDone: params.includeDone ? "true" : undefined, limit: params.limit?.toString() }),
    queryFn: () => api.get<Task[]>(`/api/tasks${qs({ view: params.view, listId: params.listId, date: params.date, goalId: params.goalId, includeDone: params.includeDone ? "true" : undefined, limit: params.limit })}`),
  });

export const useLists = () => useQuery({ queryKey: keys.lists, queryFn: () => api.get<(TaskList & { openCount: number })[]>("/api/lists") });

export const useEvents = (from: string, to: string, enabled = true) => useQuery({ queryKey: keys.events(from, to), queryFn: () => api.get<CalEvent[]>(`/api/events${qs({ from, to })}`), enabled });

export const useCalendars = () => useQuery({ queryKey: keys.calendars, queryFn: () => api.get<{ id: string; name: string; color: string; kind: string; isDefault: boolean; isVisible: boolean }[]>("/api/calendars") });

export const useGoals = (status = "active") => useQuery({ queryKey: keys.goals(status), queryFn: () => api.get<Goal[]>(`/api/goals${qs({ status })}`) });

export const useTrackers = () => useQuery({ queryKey: keys.trackers, queryFn: () => api.get<Tracker[]>("/api/trackers") });

export const useLayout = (id = "today") => useQuery({ queryKey: keys.layout(id), queryFn: () => api.get<Layout>(`/api/layout/${id}`) });

export const useDaySummary = (date = todayString()) => useQuery({ queryKey: keys.summary(date), queryFn: () => api.get<DaySummary>(`/api/summary/day${qs({ date })}`), refetchInterval: 60_000 });

/** Shape produced by the server summary service. Kept loose on purpose; widgets read what they need. */
export interface DaySummary {
  date: string;
  events: CalEvent[];
  tasks: { due: Task[]; overdue: Task[]; doneCount: number; openCount: number };
  nutrition: { totals: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG?: number | null; sugarG?: number | null; sodiumMg?: number | null }; targets: { calories: number; proteinG: number; carbsG: number; fatG: number; waterMl: number; fiberG?: number; sugarMaxG?: number; sodiumMaxMg?: number }; remaining: { calories: number; proteinG: number; carbsG: number; fatG: number }; meals: { id: string; mealType: string; name: string | null; calories: number }[] };
  water: { ml: number; target: number };
  weight: { latestKg: number; date: string } | null;
  workouts: { today: { id: string; name: string; durationSeconds: number | null; prCount: number }[]; thisWeekCount: number; weeklyTarget: number };
  goals: Goal[];
  habitsDueToday: { id: string; title: string; done: boolean }[];
  trackers: Tracker[];
}

/** Invalidate everything that could have changed after a write. Cheap for a single-user app. */
export function invalidateAll(qc: QueryClient, kinds: string[] = ["tasks", "events", "goals", "trackers", "layout", "summary", "meals", "water", "weight", "workouts"]): void {
  for (const k of kinds) void qc.invalidateQueries({ queryKey: [k] });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (kinds?: string[]) => invalidateAll(qc, kinds);
}

export function useApiMutation<TInput, TOut>(fn: (input: TInput) => Promise<TOut>, kinds?: string[]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => invalidateAll(qc, kinds) });
}
