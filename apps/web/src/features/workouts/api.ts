import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Exercise, ExerciseDetail, ExerciseHistoryEntry, SetType, TemplatePatch, Workout, WorkoutCalendarDay, WorkoutExercise, WorkoutExerciseUpdate, WorkoutFinish, WorkoutFinishResult, WorkoutListItem, WorkoutSet, WorkoutSetInput, WorkoutSettings, WorkoutStats, WorkoutTemplate, WorkoutTemplateInput, WorkoutUpdate } from "@aravos/shared";
import { api, qs } from "@/lib/api";
import { invalidateAll } from "@/data/queries";

/** Every key starts with "workouts" so `invalidateAll(qc, ["workouts"])` refreshes the whole feature. */
export const wk = {
  all: ["workouts"] as const,
  templates: ["workouts", "templates"] as const,
  template: (id: string) => ["workouts", "template", id] as const,
  active: ["workouts", "active"] as const,
  list: (limit: number) => ["workouts", "list", limit] as const,
  workout: (id: string) => ["workouts", "workout", id] as const,
  stats: ["workouts", "stats"] as const,
  calendar: (from: string, to: string) => ["workouts", "calendar", from, to] as const,
  exercises: (params: Record<string, string | undefined>) => ["workouts", "exercises", params] as const,
  exercise: (id: string) => ["workouts", "exercise", id] as const,
  settings: ["workouts", "settings"] as const,
};

const KINDS = ["workouts", "summary", "layout"];

export const useTemplates = () => useQuery({ queryKey: wk.templates, queryFn: () => api.get<WorkoutTemplate[]>("/api/templates") });
export const useTemplate = (id: string | undefined) => useQuery({ queryKey: wk.template(id ?? ""), queryFn: () => api.get<WorkoutTemplate>(`/api/templates/${id}`), enabled: Boolean(id) });
export const useActiveWorkout = () => useQuery({ queryKey: wk.active, queryFn: () => api.get<Workout | null>("/api/workouts/active"), staleTime: 5_000 });
export const useWorkouts = (limit = 50) => useQuery({ queryKey: wk.list(limit), queryFn: () => api.get<WorkoutListItem[]>(`/api/workouts${qs({ limit })}`) });
export const useWorkout = (id: string | undefined) => useQuery({ queryKey: wk.workout(id ?? ""), queryFn: () => api.get<Workout>(`/api/workouts/${id}`), enabled: Boolean(id) });
export const useWorkoutStats = () => useQuery({ queryKey: wk.stats, queryFn: () => api.get<WorkoutStats>("/api/workouts/stats") });
export const useWorkoutCalendar = (from: string, to: string) => useQuery({ queryKey: wk.calendar(from, to), queryFn: () => api.get<WorkoutCalendarDay[]>(`/api/workouts/calendar${qs({ from, to })}`) });
export const useExercises = (params: { q?: string; bodyPart?: string; category?: string } = {}) =>
  useQuery({ queryKey: wk.exercises({ q: params.q, bodyPart: params.bodyPart, category: params.category }), queryFn: () => api.get<Exercise[]>(`/api/exercises${qs(params)}`), staleTime: 30_000, placeholderData: (prev) => prev });
export const useExerciseDetail = (id: string | undefined) => useQuery({ queryKey: wk.exercise(id ?? ""), queryFn: () => api.get<ExerciseDetail>(`/api/exercises/${id}`), enabled: Boolean(id) });
export const useExerciseHistory = (id: string | undefined, limit = 50) => useQuery({ queryKey: [...wk.exercise(id ?? ""), "history", limit], queryFn: () => api.get<ExerciseHistoryEntry[]>(`/api/exercises/${id}/history${qs({ limit })}`), enabled: Boolean(id) });
export const useWorkoutSettings = () => useQuery({ queryKey: wk.settings, queryFn: () => api.get<WorkoutSettings>("/api/workouts/settings"), staleTime: 60_000 });

function useWrite<TIn, TOut>(fn: (input: TIn) => Promise<TOut>, opts: { onSuccess?: (out: TOut, input: TIn) => void; invalidate?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: opts.onSuccess,
    onSettled: () => {
      if (opts.invalidate !== false) invalidateAll(qc, KINDS);
    },
  });
}

// ---------- templates ----------
export const useCreateTemplate = () => useWrite((input: WorkoutTemplateInput) => api.post<WorkoutTemplate>("/api/templates", input));
export const useReplaceTemplate = () => useWrite(({ id, ...input }: WorkoutTemplateInput & { id: string }) => api.put<WorkoutTemplate>(`/api/templates/${id}`, input));
export const usePatchTemplate = () => useWrite(({ id, ...patch }: TemplatePatch & { id: string }) => api.patch<WorkoutTemplate>(`/api/templates/${id}`, patch));
export const useDeleteTemplate = () => useWrite((id: string) => api.delete<{ ok: boolean }>(`/api/templates/${id}`));
export const useDuplicateTemplate = () => useWrite((id: string) => api.post<WorkoutTemplate>(`/api/templates/${id}/duplicate`));

// ---------- exercises ----------
export const useCreateExercise = () => useWrite((input: { name: string; category: Exercise["category"]; bodyPart: Exercise["bodyPart"]; instructions?: string | null }) => api.post<Exercise>("/api/exercises", input));
export const useUpdateExercise = () => useWrite(({ id, ...patch }: { id: string; name?: string; category?: Exercise["category"]; bodyPart?: Exercise["bodyPart"]; instructions?: string | null }) => api.patch<Exercise>(`/api/exercises/${id}`, patch));
export const useDeleteExercise = () => useWrite((id: string) => api.delete<{ ok: boolean }>(`/api/exercises/${id}`));

// ---------- workouts ----------
export function useStartWorkout() {
  const qc = useQueryClient();
  return useWrite((input: { templateId?: string | null; name?: string }) => api.post<Workout>("/api/workouts/start", input), { onSuccess: (w) => qc.setQueryData(wk.active, w) });
}
export const useDiscardWorkout = () => useWrite((id: string) => api.post<Workout>(`/api/workouts/${id}/discard`));
export const useFinishWorkout = () => useWrite(({ id, ...body }: WorkoutFinish & { id: string }) => api.post<WorkoutFinishResult>(`/api/workouts/${id}/finish`, body));
export const useUpdateWorkout = () => useWrite(({ id, ...patch }: WorkoutUpdate & { id: string }) => api.patch<Workout>(`/api/workouts/${id}`, patch), { invalidate: false });
export const useDeleteWorkout = () => useWrite((id: string) => api.delete<{ ok: boolean }>(`/api/workouts/${id}`));
export const useAddWorkoutExercise = () => useWrite(({ workoutId, ...body }: { workoutId: string; exerciseId: string; supersetGroup?: number | null; restSeconds?: number | null }) => api.post<WorkoutExercise>(`/api/workouts/${workoutId}/exercises`, body), { invalidate: false });
export const useReorderWorkoutExercises = () => useWrite(({ workoutId, ids }: { workoutId: string; ids: string[] }) => api.post<Workout>(`/api/workouts/${workoutId}/exercises/reorder`, { ids }), { invalidate: false });
export const useUpdateWorkoutExercise = () => useWrite(({ id, ...patch }: WorkoutExerciseUpdate & { id: string }) => api.patch<WorkoutExercise>(`/api/workout-exercises/${id}`, patch), { invalidate: false });
export const useRemoveWorkoutExercise = () => useWrite((id: string) => api.delete<{ ok: boolean }>(`/api/workout-exercises/${id}`), { invalidate: false });
export const useReplaceWorkoutExercise = () => useWrite(({ id, exerciseId }: { id: string; exerciseId: string }) => api.post<WorkoutExercise>(`/api/workout-exercises/${id}/replace`, { exerciseId }), { invalidate: false });
export const useAddWorkoutSet = () => useWrite((workoutExerciseId: string) => api.post<WorkoutSet>(`/api/workout-exercises/${workoutExerciseId}/sets`), { invalidate: false });
export const useUpdateWorkoutSet = () => useWrite(({ id, ...input }: WorkoutSetInput & { id: string }) => api.patch<WorkoutSet>(`/api/workout-sets/${id}`, input), { invalidate: false });
export const useDeleteWorkoutSet = () => useWrite((id: string) => api.delete<{ ok: boolean }>(`/api/workout-sets/${id}`), { invalidate: false });
export const useSetWorkoutSetType = () => useWrite(({ id, setType }: { id: string; setType: SetType }) => api.post<WorkoutSet>(`/api/workout-sets/${id}/type`, { setType }), { invalidate: false });
export const useUpdateWorkoutSettings = () => useWrite((patch: Partial<WorkoutSettings>) => api.patch<WorkoutSettings>("/api/workouts/settings", patch));

/** Direct calls for flows that chain several writes (finish, complete unfinished sets). */
export const workoutApi = {
  patchSet: (id: string, input: WorkoutSetInput) => api.patch<WorkoutSet>(`/api/workout-sets/${id}`, input),
  finish: (id: string, body: WorkoutFinish) => api.post<WorkoutFinishResult>(`/api/workouts/${id}/finish`, body),
  getWorkout: (id: string) => api.get<Workout>(`/api/workouts/${id}`),
};
