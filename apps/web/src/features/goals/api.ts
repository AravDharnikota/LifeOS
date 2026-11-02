import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Goal, GoalCreate, GoalMilestone, Task, Tracker } from "@aravos/shared";
import { todayString, weekStartString } from "@aravos/shared";
import { api } from "@/lib/api";
import { invalidateAll, keys, useTasks } from "@/data/queries";
import { notify } from "@/lib/haptics";
import { toast } from "@/ui/Toast";

const GOAL_KINDS = ["goals", "goal", "summary", "layout"];
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export const useGoal = (id: string | undefined) =>
  useQuery({ queryKey: keys.goal(id ?? ""), queryFn: () => api.get<Goal>(`/api/goals/${id}`), enabled: Boolean(id) });

/** Weekly habits need the entry list to know whether today is checked; fetch the detail for those only. */
export function useGoalWithEntries(g: Goal): Goal {
  const need = g.kind === "habit" && g.cadence === "weekly" && !g.recentEntries;
  const q = useQuery({ queryKey: keys.goal(g.id), queryFn: () => api.get<Goal>(`/api/goals/${g.id}`), enabled: need, staleTime: 30_000 });
  return need && q.data ? { ...g, recentEntries: q.data.recentEntries } : g;
}

type Snapshot = [readonly unknown[], unknown][];

function snapshotGoals(qc: QueryClient, id: string): Snapshot {
  return [...qc.getQueriesData<Goal[]>({ queryKey: ["goals"] }), ...qc.getQueriesData<Goal>({ queryKey: keys.goal(id) })];
}
function restore(qc: QueryClient, snap: Snapshot | undefined): void {
  for (const [key, data] of snap ?? []) qc.setQueryData(key, data);
}
function patchGoalCaches(qc: QueryClient, id: string, fn: (g: Goal) => Goal): void {
  for (const [key, data] of qc.getQueriesData<Goal[]>({ queryKey: ["goals"] })) if (data) qc.setQueryData(key, data.map((g) => (g.id === id ? fn(g) : g)));
  const detail = qc.getQueryData<Goal>(keys.goal(id));
  if (detail) qc.setQueryData(keys.goal(id), fn(detail));
}
function setGoalCaches(qc: QueryClient, goal: Goal): void {
  patchGoalCaches(qc, goal.id, (g) => ({ ...goal, recentEntries: goal.recentEntries ?? g.recentEntries }));
}
function removeFromLists(qc: QueryClient, id: string): void {
  for (const [key, data] of qc.getQueriesData<Goal[]>({ queryKey: ["goals"] })) if (data) qc.setQueryData(key, data.filter((g) => g.id !== id));
}

export interface LogInput {
  id: string;
  value?: number;
  delta?: number;
  date?: string;
  note?: string | null;
}

function optimisticLog(g: Goal, input: LogInput, entriesHint?: Goal["recentEntries"]): Goal {
  const today = todayString();
  if (g.kind === "habit") {
    const date = input.date ?? today;
    const entries = g.recentEntries ?? entriesHint ?? [];
    const has = entries.some((e) => e.date === date);
    const inPeriod = g.cadence === "weekly" ? date >= weekStartString(today) : date === today;
    const periodCount = Math.max(0, (g.periodCount ?? 0) + (inPeriod ? (has ? -1 : 1) : 0));
    const recentEntries = g.recentEntries ? (has ? entries.filter((e) => e.date !== date) : [{ id: `tmp-${date}`, goalId: g.id, date, value: 1, note: null, createdAt: new Date().toISOString() }, ...entries]) : undefined;
    let streak = g.streak ?? 0;
    if (date === today && g.cadence !== "weekly") streak = has ? Math.max(0, streak - 1) : streak + 1;
    return { ...g, periodCount, recentEntries, streak, progress: clamp01(periodCount / (g.timesPerPeriod ?? 1)) };
  }
  if (g.kind === "boolean") {
    const done = g.status !== "done";
    return { ...g, status: done ? "done" : "active", progress: done ? 1 : 0 };
  }
  if (g.kind === "number") {
    const value = input.value ?? (g.currentValue ?? 0) + (input.delta ?? 0);
    const start = g.startValue ?? 0;
    const span = (g.targetValue ?? 0) - start;
    const progress = g.targetValue == null ? 0 : span === 0 ? 1 : clamp01((value - start) / span);
    const reached = g.targetValue != null && (g.direction === "decrease" ? value <= g.targetValue : value >= g.targetValue);
    return { ...g, currentValue: value, progress, status: reached ? "done" : g.status };
  }
  return g;
}

/** POST /api/goals/:id/log. Optimistic for every kind; a success haptic when the goal reaches done. */
export function useLogGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: LogInput) => api.post<Goal>(`/api/goals/${id}/log`, body),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["goals"] });
      await qc.cancelQueries({ queryKey: keys.goal(input.id) });
      const snap = snapshotGoals(qc, input.id);
      const entriesHint = qc.getQueryData<Goal>(keys.goal(input.id))?.recentEntries;
      let prevStatus: Goal["status"] | undefined;
      patchGoalCaches(qc, input.id, (g) => {
        prevStatus = g.status;
        return optimisticLog(g, input, entriesHint);
      });
      return { snap, prevStatus };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSuccess: (goal, _v, ctx) => {
      setGoalCaches(qc, goal);
      if (ctx?.prevStatus !== "done" && goal.status === "done") {
        void notify("success");
        toast("Goal done.");
      }
    },
    onSettled: () => invalidateAll(qc, GOAL_KINDS),
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GoalCreate) => api.post<Goal>("/api/goals", input),
    onSuccess: (goal) => qc.setQueryData(keys.goal(goal.id), goal),
    onSettled: () => invalidateAll(qc, GOAL_KINDS),
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<GoalCreate> & { id: string }) => api.patch<Goal>(`/api/goals/${id}`, patch),
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: ["goals"] });
      const snap = snapshotGoals(qc, id);
      patchGoalCaches(qc, id, (g) => ({ ...g, ...(patch as Partial<Goal>) }));
      return { snap };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSuccess: (goal) => setGoalCaches(qc, goal),
    onSettled: () => invalidateAll(qc, GOAL_KINDS),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/api/goals/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["goals"] });
      const snap = snapshotGoals(qc, id);
      removeFromLists(qc, id);
      return { snap };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSettled: () => invalidateAll(qc, GOAL_KINDS),
  });
}

export function useAddMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, title }: { goalId: string; title: string }) => api.post<GoalMilestone>(`/api/goals/${goalId}/milestones`, { title }),
    onSuccess: (m) => patchGoalCaches(qc, m.goalId, (g) => ({ ...g, milestones: [...(g.milestones ?? []), m] })),
    onSettled: () => invalidateAll(qc, GOAL_KINDS),
  });
}

export function useUpdateMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; goalId: string; patch: { done?: boolean; title?: string } }) => api.patch<GoalMilestone>(`/api/milestones/${id}`, patch),
    onMutate: async ({ id, goalId, patch }) => {
      await qc.cancelQueries({ queryKey: keys.goal(goalId) });
      const snap = snapshotGoals(qc, goalId);
      let prevStatus: Goal["status"] | undefined;
      patchGoalCaches(qc, goalId, (g) => {
        prevStatus = g.status;
        const milestones = (g.milestones ?? []).map((m) => (m.id === id ? { ...m, ...patch, doneAt: patch.done === undefined ? m.doneAt : patch.done ? new Date().toISOString() : null } : m));
        const done = milestones.filter((m) => m.done).length;
        return { ...g, milestones, progress: milestones.length ? done / milestones.length : 0 };
      });
      return { snap, prevStatus };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSettled: () => invalidateAll(qc, GOAL_KINDS),
  });
}

export function useDeleteMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; goalId: string }) => api.delete<{ ok: boolean }>(`/api/milestones/${id}`),
    onMutate: async ({ id, goalId }) => {
      const snap = snapshotGoals(qc, goalId);
      patchGoalCaches(qc, goalId, (g) => {
        const milestones = (g.milestones ?? []).filter((m) => m.id !== id);
        return { ...g, milestones, progress: milestones.length ? milestones.filter((m) => m.done).length / milestones.length : 0 };
      });
      return { snap };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSettled: () => invalidateAll(qc, GOAL_KINDS),
  });
}

// ---------- linked tasks ----------
export const useGoalTasks = (goalId: string | undefined) => useTasks({ goalId, includeDone: true });

export function useAddGoalTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, title }: { goalId: string; title: string }) => api.post<Task>("/api/tasks", { title, goalId }),
    onSettled: () => invalidateAll(qc, ["tasks", "summary"]),
  });
}

export function useToggleTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (task: Task) => api.post<Task>(`/api/tasks/${task.id}/${task.status === "done" ? "reopen" : "complete"}`),
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const snap = qc.getQueriesData<Task[]>({ queryKey: ["tasks"] });
      const next: Task["status"] = task.status === "done" ? "open" : "done";
      for (const [key, data] of snap) if (data) qc.setQueryData(key, data.map((t) => (t.id === task.id ? { ...t, status: next, completedAt: next === "done" ? new Date().toISOString() : null } : t)));
      return { snap };
    },
    onError: (_e, _v, ctx) => restore(qc, ctx?.snap),
    onSettled: () => invalidateAll(qc, ["tasks", "summary"]),
  });
}

// ---------- trackers ----------
const TRACKER_KINDS = ["trackers", "summary", "layout"];

export function useCreateTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; unit?: string | null; step?: number; target?: number | null; reset?: Tracker["reset"] }) => api.post<Tracker>("/api/trackers", input),
    onSettled: () => invalidateAll(qc, TRACKER_KINDS),
  });
}

export function useDeleteTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/api/trackers/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.trackers });
      const prev = qc.getQueryData<Tracker[]>(keys.trackers);
      if (prev) qc.setQueryData(keys.trackers, prev.filter((t) => t.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(keys.trackers, ctx.prev),
    onSettled: () => invalidateAll(qc, TRACKER_KINDS),
  });
}

export function useLogTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, delta }: { id: string; delta: number }) => api.post<Tracker>(`/api/trackers/${id}/log`, { delta }),
    onMutate: async ({ id, delta }) => {
      await qc.cancelQueries({ queryKey: keys.trackers });
      const prev = qc.getQueryData<Tracker[]>(keys.trackers);
      if (prev) qc.setQueryData(keys.trackers, prev.map((t) => (t.id === id ? { ...t, todayValue: (t.todayValue ?? 0) + delta } : t)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(keys.trackers, ctx.prev),
    onSettled: () => invalidateAll(qc, TRACKER_KINDS),
  });
}
