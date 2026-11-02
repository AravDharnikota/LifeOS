import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SchedulerResult, Task, TaskCreate, TaskUpdate } from "@aravos/shared";
import { api } from "@/lib/api";
import { invalidateAll } from "@/data/queries";
import { toast } from "@/ui/Toast";
import { notify } from "@/lib/haptics";
import { fmtRelativeDate, fmtTimeRange } from "@/lib/format";

const KINDS = ["tasks", "events", "summary", "lists"];

/** Task writes with optimistic updates across every cached task list. */
export function useTaskActions() {
  const qc = useQueryClient();
  const patch = (fn: (t: Task) => Task | null) => {
    qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) => (old ? old.map(fn).filter((t): t is Task => t !== null) : old));
  };
  const settle = () => invalidateAll(qc, KINDS);
  const fail = (e: unknown) => {
    void notify("error");
    toast(e instanceof Error ? e.message : "Unable to save");
    settle();
  };

  const complete = useMutation({
    mutationFn: async (task: Task) => {
      const now = new Date().toISOString();
      patch((t) => (t.id === task.id ? { ...t, status: "done", completedAt: now } : t));
      return api.post<Task>(`/api/tasks/${task.id}/complete`, {});
    },
    onError: fail,
    onSettled: settle,
  });

  const reopen = useMutation({
    mutationFn: async (task: Task) => {
      patch((t) => (t.id === task.id ? { ...t, status: "open", completedAt: null } : t));
      return api.post<Task>(`/api/tasks/${task.id}/reopen`, {});
    },
    onError: fail,
    onSettled: settle,
  });

  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: TaskUpdate }) => {
      patch((t) => (t.id === id ? ({ ...t, ...input } as Task) : t));
      return api.patch<Task>(`/api/tasks/${id}`, input);
    },
    onError: fail,
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: async (task: Task) => {
      patch((t) => (t.id === task.id ? null : t));
      await api.delete(`/api/tasks/${task.id}`);
      toast("Task deleted.");
    },
    onError: fail,
    onSettled: settle,
  });

  const create = useMutation({
    mutationFn: (input: TaskCreate) => api.post<Task>("/api/tasks", input),
    onError: fail,
    onSettled: settle,
  });

  const quick = useMutation({
    mutationFn: (input: { text: string; listId?: string | null }) => api.post<Task>("/api/tasks/quick", input),
    onError: fail,
    onSettled: settle,
  });

  const reorder = useMutation({
    mutationFn: async (ids: string[]) => {
      const pos = new Map(ids.map((id, i) => [id, i + 1]));
      patch((t) => (pos.has(t.id) ? { ...t, sortOrder: pos.get(t.id)! } : t));
      return api.post("/api/tasks/reorder", { ids });
    },
    onError: fail,
    onSettled: settle,
  });

  /** Ask the planner to place a time box for one task. */
  const schedule = useMutation({
    mutationFn: async (task: Task) => {
      const r = await api.post<SchedulerResult>("/api/scheduler/run", { taskIds: [task.id] });
      const block = r.placed.find((p) => p.taskId === task.id)?.blocks.at(-1);
      if (block) toast(`Planned for ${fmtRelativeDate(block.start)} ${fmtTimeRange(block.start, block.end)}.`);
      else toast(r.unplaced.find((u) => u.taskId === task.id)?.reason ?? "No free time in the horizon.");
      return r;
    },
    onError: fail,
    onSettled: settle,
  });

  const createList = useMutation({
    mutationFn: (input: { name: string; color?: string | null }) => api.post("/api/lists", input),
    onError: fail,
    onSettled: settle,
  });

  return { complete, reopen, update, remove, create, quick, reorder, schedule, createList };
}

export type TaskActions = ReturnType<typeof useTaskActions>;
