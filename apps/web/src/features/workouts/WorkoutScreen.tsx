import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { Exercise, TemplateAction, Workout, WorkoutExercise, WorkoutFinishResult, WorkoutSet, WorkoutTemplate } from "@aravos/shared";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row } from "@/ui/List";
import { Sheet, ActionSheet } from "@/ui/Sheet";
import { Menu, type MenuItem } from "@/ui/Menu";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { api, ApiError } from "@/lib/api";
import { fmtDate, fmtTime } from "@/lib/format";
import { impact, notify } from "@/lib/haptics";
import { useNow } from "@/lib/hooks";
import { hasFinePointer } from "@/lib/platform";
import { invalidateAll, useAppSettings } from "@/data/queries";
import { useAddWorkoutExercise, useAddWorkoutSet, useDeleteWorkoutSet, useDiscardWorkout, useRemoveWorkoutExercise, useReorderWorkoutExercises, useReplaceWorkoutExercise, useSetWorkoutSetType, useTemplate, useUpdateWorkout, useUpdateWorkoutExercise, useUpdateWorkoutSet, useWorkout, useActiveWorkout, useWorkoutSettings, wk, workoutApi } from "./api";
import { columnsFor, fmtSeconds, gridTemplate, hasValues, restFor, SET_TYPES, setLabel, supersetColor, templateDiff, weightStep, WORKOUTS, type ColumnKind, type SetValues, type TemplateDiff } from "./lib";
import { SetRow } from "./SetRow";
import { KeypadAccessory } from "./KeypadAccessory";
import { ExercisePicker } from "./ExercisePicker";
import { SaveAsTemplateSheet, SummarySheet, UpdateTemplateSheet } from "./FinishSheets";
import { useRestRemaining, useRestTimer } from "./store";
import { primeAudio } from "./sound";
import { RestSheet, ScreenFrame, SupersetSheet, useStartFlow } from "./common";

type Mode = "live" | "edit";

export default function WorkoutScreen({ mode }: { mode: Mode }) {
  const { id } = useParams();
  const activeQ = useActiveWorkout();
  const editQ = useWorkout(mode === "edit" ? id : undefined);
  const q = mode === "live" ? activeQ : editQ;
  const navigate = useNavigate();
  const { start, pending } = useStartFlow();
  if (q.isPending) return <ScreenFrame title={mode === "live" ? "Workout" : "Edit Workout"} onBack={() => navigate(WORKOUTS)}><div className="pt-6"><Skeleton rows={6} /></div></ScreenFrame>;
  if (q.isError) return <ScreenFrame title="Workout" onBack={() => navigate(WORKOUTS)}><InlineError onRetry={() => void q.refetch()}>Unable to load the workout.</InlineError></ScreenFrame>;
  if (!q.data) {
    return (
      <ScreenFrame title="Workout" onBack={() => navigate(WORKOUTS)}>
        <Empty action={<Button variant="plain" loading={pending} onClick={() => start(null)}>Start Empty Workout</Button>}>No workout in progress.</Empty>
      </ScreenFrame>
    );
  }
  return <WorkoutEditor key={q.data.id} workout={q.data} mode={mode} queryKey={mode === "live" ? wk.active : wk.workout(q.data.id)} />;
}

function TimerPill() {
  const remaining = useRestRemaining();
  const total = useRestTimer((s) => s.total);
  const setOpen = useRestTimer((s) => s.setSheetOpen);
  if (!remaining) {
    return (
      <IconButton label="Rest timer" onClick={() => setOpen(true)}>
        <Icon name="timer" />
      </IconButton>
    );
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className="pressable h-9 pl-2 pr-3 rounded-md bg-accent-soft text-accent-text inline-flex items-center gap-1.5 text-subhead font-semibold tabular" aria-label={`Rest, ${fmtSeconds(remaining)} left`} data-testid="rest-pill">
      <Icon name="timer" size={18} />
      <span className="num">{fmtSeconds(remaining)}</span>
      <span className="text-caption-1 opacity-70 num">/ {fmtSeconds(total)}</span>
    </button>
  );
}

interface FinishState {
  step: null | "unfinished" | "template" | "saveAs";
  discard: boolean;
  diff: TemplateDiff | null;
}

function WorkoutEditor({ workout: w, mode, queryKey }: { workout: Workout; mode: Mode; queryKey: QueryKey }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const app = useAppSettings();
  const units = app.units;
  const settings = useWorkoutSettings();
  const template = useTemplate(mode === "live" ? w.templateId ?? undefined : undefined);
  const now = useNow(1000);
  const elapsed = Math.max(0, Math.floor((now.getTime() - Date.parse(w.startedAt)) / 1000));
  const timerStart = useRestTimer((s) => s.start);

  const patchSet = useUpdateWorkoutSet();
  const addSetM = useAddWorkoutSet();
  const delSetM = useDeleteWorkoutSet();
  const setTypeM = useSetWorkoutSetType();
  const patchWorkout = useUpdateWorkout();
  const addExM = useAddWorkoutExercise();
  const removeExM = useRemoveWorkoutExercise();
  const replaceExM = useReplaceWorkoutExercise();
  const reorderM = useReorderWorkoutExercises();
  const patchExM = useUpdateWorkoutExercise();
  const discardM = useDiscardWorkout();

  const dirty = useRef(new Set<string>());
  const apply = useCallback((fn: (cur: Workout) => Workout) => qc.setQueryData<Workout | null>(queryKey, (cur) => (cur ? fn(cur) : cur)), [qc, queryKey]);
  const current = () => qc.getQueryData<Workout | null>(queryKey) ?? w;
  const applySet = useCallback((setId: string, patch: Partial<WorkoutSet>) => apply((cur) => ({ ...cur, exercises: (cur.exercises ?? []).map((e) => ({ ...e, sets: (e.sets ?? []).map((s) => (s.id === setId ? { ...s, ...patch } : s)) })) })), [apply]);
  const applyExercise = useCallback((weId: string, patch: Partial<WorkoutExercise>) => apply((cur) => ({ ...cur, exercises: (cur.exercises ?? []).map((e) => (e.id === weId ? { ...e, ...patch } : e)) })), [apply]);

  const findSet = (setId: string): { exercise: WorkoutExercise; set: WorkoutSet; index: number } | null => {
    for (const e of current().exercises ?? []) {
      const i = (e.sets ?? []).findIndex((s) => s.id === setId);
      if (i >= 0) return { exercise: e, set: e.sets![i]!, index: i };
    }
    return null;
  };

  const flush = useCallback(
    async (setId: string) => {
      if (!dirty.current.has(setId)) return;
      dirty.current.delete(setId);
      const found = findSet(setId);
      if (!found) return;
      const { set } = found;
      try {
        const srv = await patchSet.mutateAsync({ id: setId, weight: set.weight, reps: set.reps, seconds: set.seconds, distance: set.distance });
        if (!dirty.current.has(setId)) applySet(setId, srv);
      } catch {
        toast("Unable to save the set.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applySet],
  );
  const flushAll = async () => {
    await Promise.all(Array.from(dirty.current).map((id) => flush(id)));
  };
  useEffect(() => () => { void flushAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeValue = (setId: string, kind: ColumnKind, value: number | null) => {
    applySet(setId, { [kind]: value } as Partial<WorkoutSet>);
    dirty.current.add(setId);
  };

  const toggleComplete = (setId: string) => {
    const found = findSet(setId);
    if (!found) return;
    const { exercise, set, index } = found;
    const category = exercise.exercise?.category ?? "barbell";
    if (set.completed) {
      applySet(setId, { completed: false, completedAt: null, prs: [] });
      dirty.current.delete(setId);
      patchSet.mutate({ id: setId, completed: false, weight: set.weight, reps: set.reps, seconds: set.seconds, distance: set.distance }, { onSuccess: (srv) => applySet(setId, srv), onError: () => toast("Unable to update the set.") });
      return;
    }
    const prev = exercise.previous?.[index] ?? null;
    const values: SetValues = {
      weight: set.weight ?? prev?.weight ?? null,
      reps: set.reps ?? prev?.reps ?? null,
      seconds: set.seconds ?? prev?.seconds ?? null,
      distance: set.distance ?? prev?.distance ?? null,
    };
    const cols = columnsFor(category, units);
    const needsWeight = cols.some((c) => c.kind === "weight");
    if (needsWeight && values.weight == null) values.weight = 0;
    if (!hasValues(values, category)) {
      const first = document.querySelector<HTMLInputElement>(`input.wk-input[data-set="${setId}"]`);
      first?.focus();
      return;
    }
    dirty.current.delete(setId);
    applySet(setId, { ...values, completed: true, completedAt: new Date().toISOString() });
    if (mode === "live") {
      void impact("light");
      primeAudio();
      const rest = restFor(exercise, set.setType, settings.data, app);
      if (rest > 0) timerStart(rest, nextSetHint(current(), exercise.id, index));
    }
    patchSet.mutate({ id: setId, completed: true, ...values }, { onSuccess: (srv) => { if (!dirty.current.has(setId)) applySet(setId, srv); }, onError: () => { applySet(setId, { completed: false, completedAt: null }); toast("Unable to save the set."); } });
  };

  const deleteSet = (setId: string) => {
    dirty.current.delete(setId);
    apply((cur) => ({ ...cur, exercises: (cur.exercises ?? []).map((e) => ({ ...e, sets: (e.sets ?? []).filter((s) => s.id !== setId) })) }));
    delSetM.mutate(setId, { onError: () => { toast("Unable to delete the set."); void qc.invalidateQueries({ queryKey }); } });
  };
  const changeType = (setId: string, setType: WorkoutSet["setType"]) => {
    applySet(setId, { setType });
    setTypeM.mutate({ id: setId, setType }, { onSuccess: (srv) => { if (!dirty.current.has(setId)) applySet(setId, srv); } });
  };
  const addSet = (weId: string) => {
    void flushAll();
    addSetM.mutate(weId, { onSuccess: (s) => apply((cur) => ({ ...cur, exercises: (cur.exercises ?? []).map((e) => (e.id === weId ? { ...e, sets: [...(e.sets ?? []), s] } : e)) })), onError: () => toast("Unable to add a set.") });
  };
  const copyPrevious = (setId: string) => {
    const found = findSet(setId);
    if (!found) return;
    const prev = found.exercise.previous?.[found.index];
    if (!prev) return;
    applySet(setId, { weight: prev.weight, reps: prev.reps, seconds: prev.seconds, distance: prev.distance });
    dirty.current.add(setId);
    void flush(setId);
  };
  const stepField = (setId: string, kind: ColumnKind, dir: 1 | -1) => {
    const found = findSet(setId);
    if (!found) return;
    const prev = found.exercise.previous?.[found.index];
    const base = found.set[kind] ?? prev?.[kind] ?? 0;
    const step = kind === "weight" ? (units === "imperial" ? weightStep(units) * 0.45359237 : weightStep(units)) : kind === "reps" ? 1 : kind === "seconds" ? 15 : units === "imperial" ? 0.160934 : 0.1;
    const next = Math.max(0, Math.round((base + dir * step) * 1000) / 1000);
    changeValue(setId, kind, kind === "reps" ? Math.round(next) : next);
  };

  // ----- exercises -----
  const [picker, setPicker] = useState<null | { mode: "add" } | { mode: "replace"; weId: string }>(null);
  const addExercises = async (list: Exercise[]) => {
    for (const ex of list) {
      try {
        const we = await addExM.mutateAsync({ workoutId: w.id, exerciseId: ex.id, restSeconds: settings.data ? undefined : app.defaultRestSeconds });
        apply((cur) => ({ ...cur, exercises: [...(cur.exercises ?? []), we] }));
      } catch {
        toast(`Unable to add ${ex.name}.`);
      }
    }
  };
  const [replaceConfirm, setReplaceConfirm] = useState<{ weId: string; exercise: Exercise } | null>(null);
  const replaceExercise = (weId: string, exercise: Exercise) => {
    replaceExM.mutate({ id: weId, exerciseId: exercise.id }, { onSuccess: (we) => apply((cur) => ({ ...cur, exercises: (cur.exercises ?? []).map((e) => (e.id === weId ? we : e)) })), onError: () => toast("Unable to replace the exercise.") });
  };
  const removeExercise = (weId: string) => {
    apply((cur) => ({ ...cur, exercises: (cur.exercises ?? []).filter((e) => e.id !== weId) }));
    removeExM.mutate(weId, { onError: () => { toast("Unable to remove the exercise."); void qc.invalidateQueries({ queryKey }); } });
  };
  const move = (weId: string, dir: -1 | 1) => {
    const list = [...(current().exercises ?? [])];
    const i = list.findIndex((e) => e.id === weId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    apply((cur) => ({ ...cur, exercises: list.map((e, idx) => ({ ...e, sortOrder: idx })) }));
    reorderM.mutate({ workoutId: w.id, ids: list.map((e) => e.id) }, { onError: () => void qc.invalidateQueries({ queryKey }) });
  };
  const patchExercise = (weId: string, patch: { restSeconds?: number | null; notes?: string | null; supersetGroup?: number | null }) => {
    applyExercise(weId, patch);
    patchExM.mutate({ id: weId, ...patch }, { onError: () => toast("Unable to update the exercise.") });
  };

  // ----- workout fields -----
  const [name, setName] = useState(w.name);
  const [notes, setNotes] = useState(w.notes ?? "");
  const saveName = () => {
    const v = name.trim() || w.name;
    setName(v);
    if (v !== w.name) {
      apply((cur) => ({ ...cur, name: v }));
      patchWorkout.mutate({ id: w.id, name: v });
    }
  };
  const saveNotes = () => {
    const v = notes.trim() || null;
    if (v !== (w.notes ?? null)) {
      apply((cur) => ({ ...cur, notes: v }));
      patchWorkout.mutate({ id: w.id, notes: v });
    }
  };

  // ----- finish flow -----
  const [finish, setFinish] = useState<FinishState>({ step: null, discard: true, diff: null });
  const [result, setResult] = useState<WorkoutFinishResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const valuedIncomplete = (cur: Workout) => (cur.exercises ?? []).flatMap((e) => (e.sets ?? []).filter((s) => !s.completed && hasValues(s, e.exercise?.category ?? "barbell")));

  const beginFinish = async () => {
    await flushAll();
    const cur = current();
    if (valuedIncomplete(cur).length) setFinish({ step: "unfinished", discard: true, diff: null });
    else void chooseTemplateStep(true);
  };
  const completeUnfinished = async () => {
    setBusy(true);
    try {
      for (const s of valuedIncomplete(current())) {
        const srv = await workoutApi.patchSet(s.id, { completed: true });
        applySet(s.id, srv);
      }
    } catch {
      toast("Unable to complete the sets.");
    }
    setBusy(false);
    void chooseTemplateStep(false);
  };
  const chooseTemplateStep = async (discard: boolean) => {
    const cur = current();
    const keep = (s: WorkoutSet) => (discard ? s.completed : true) && hasValues(s, cur.exercises?.find((e) => e.id === s.workoutExerciseId)?.exercise?.category ?? "barbell");
    const kept = (cur.exercises ?? []).some((e) => (e.sets ?? []).some(keep));
    if (cur.templateId) {
      let tpl: WorkoutTemplate | undefined = template.data;
      if (!tpl) {
        try {
          tpl = await api.get<WorkoutTemplate>(`/api/templates/${cur.templateId}`);
        } catch {
          tpl = undefined;
        }
      }
      const diff = tpl ? templateDiff(tpl, cur, keep) : null;
      if (diff && (diff.structural || diff.valueChanges)) {
        setFinish({ step: "template", discard, diff });
        return;
      }
      void doFinish(discard, "keep");
      return;
    }
    if (kept) {
      setFinish({ step: "saveAs", discard, diff: null });
      return;
    }
    void doFinish(discard, "keep");
  };
  const doFinish = async (discard: boolean, action: TemplateAction, newTemplateName?: string) => {
    setFinish({ step: null, discard, diff: null });
    setBusy(true);
    try {
      const res = await workoutApi.finish(w.id, { discardIncomplete: discard, templateAction: action, ...(newTemplateName ? { newTemplateName } : {}) });
      useRestTimer.getState().skip();
      void notify("success");
      qc.setQueryData(wk.active, null);
      invalidateAll(qc, ["workouts", "summary", "layout"]);
      setResult(res);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Unable to finish the workout.");
    }
    setBusy(false);
  };
  const discardWorkout = () => {
    discardM.mutate(w.id, {
      onSuccess: () => {
        useRestTimer.getState().skip();
        qc.setQueryData(wk.active, null);
        toast("Workout discarded.");
        navigate(WORKOUTS);
      },
      onError: () => toast("Unable to discard the workout."),
    });
  };
  const saveEdits = async () => {
    await flushAll();
    invalidateAll(qc, ["workouts", "summary", "layout"]);
    toast("Workout saved.");
    navigate(`${WORKOUTS}/history/${w.id}`);
  };

  const exercises = w.exercises ?? [];
  const unfinishedCount = useMemo(() => valuedIncomplete(w).length, [w]);

  return (
    <>
      <ScreenFrame
        onBack={() => navigate(mode === "live" ? WORKOUTS : `${WORKOUTS}/history/${w.id}`)}
        left={mode === "live" ? <TimerPill /> : undefined}
        center={mode === "live" ? <span className="num tabular text-headline" data-testid="elapsed" aria-label="Elapsed">{fmtSeconds(elapsed)}</span> : "Edit Workout"}
        right={
          mode === "live" ? (
            <Button variant="primary" size="sm" loading={busy} onClick={() => void beginFinish()} data-testid="finish">Finish</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => void saveEdits()} data-testid="save-edits">Save</Button>
          )
        }
      >
        <div className="px-[var(--gutter)] pt-3 pb-2">
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} className="w-full bg-transparent outline-none text-title-2 text-primary font-bold" aria-label="Workout name" data-testid="workout-name" />
          <div className="text-footnote text-secondary mt-0.5 tabular">
            {fmtDate(w.startedAt)}, {fmtTime(w.startedAt, app.hour12)}
            {w.templateName ? ` · ${w.templateName}` : ""}
          </div>
          <textarea value={notes} onChange={(e) => { setNotes(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }} onBlur={saveNotes} placeholder="Notes" rows={1} className="w-full bg-transparent outline-none text-subhead text-primary resize-none mt-2 placeholder:text-tertiary" aria-label="Workout notes" />
        </div>

        <div className="flex flex-col gap-4 pt-1">
          {exercises.map((e, i) => (
            <ExerciseBlock
              key={e.id}
              exercise={e}
              index={i}
              count={exercises.length}
              units={units}
              mode={mode}
              onChangeValue={changeValue}
              onCommit={flush}
              onToggleComplete={toggleComplete}
              onDelete={deleteSet}
              onSetType={changeType}
              onCopyPrevious={copyPrevious}
              onAddSet={() => addSet(e.id)}
              onReplace={() => setPicker({ mode: "replace", weId: e.id })}
              onRemove={() => removeExercise(e.id)}
              onMove={(dir) => move(e.id, dir)}
              onPatch={(patch) => patchExercise(e.id, patch)}
              onSuperset={(ids, group) => {
                for (const x of exercises) {
                  const inGroup = ids.includes(x.id);
                  if (inGroup && x.supersetGroup !== group) patchExercise(x.id, { supersetGroup: group });
                  else if (!inGroup && x.supersetGroup === group) patchExercise(x.id, { supersetGroup: null });
                }
              }}
              all={exercises}
            />
          ))}
          {exercises.length === 0 && <Empty className="pt-6 pb-0">No exercises yet.</Empty>}
        </div>

        <div className="px-[var(--gutter)] pt-6 flex flex-col gap-2">
          <Button variant="secondary" size="lg" full onClick={() => setPicker({ mode: "add" })} data-testid="add-exercises">Add Exercises</Button>
          {mode === "live" && (
            <Button variant="destructive" size="lg" full onClick={() => setCancelOpen(true)} data-testid="cancel-workout">Cancel Workout</Button>
          )}
        </div>
      </ScreenFrame>

      <KeypadAccessory onPrevious={copyPrevious} onStep={stepField} stepLabel={(f) => (f === "weight" ? String(weightStep(units)) : f === "reps" ? "1" : f === "seconds" ? "15s" : "0.1")} />

      <ExercisePicker
        open={Boolean(picker)}
        onClose={() => setPicker(null)}
        mode={picker?.mode === "replace" ? "single" : "multi"}
        onPick={(list) => {
          if (picker?.mode === "replace") setReplaceConfirm({ weId: picker.weId, exercise: list[0]! });
          else void addExercises(list);
        }}
      />
      <ActionSheet open={Boolean(replaceConfirm)} onClose={() => setReplaceConfirm(null)} title="Replace exercise?" message="Sets are kept and their records cleared." actions={[{ label: "Replace", destructive: true, onPress: () => { if (replaceConfirm) replaceExercise(replaceConfirm.weId, replaceConfirm.exercise); } }]} />
      <ActionSheet open={cancelOpen} onClose={() => setCancelOpen(false)} title="Discard Workout?" message="The workout and its sets are removed." actions={[{ label: "Discard Workout", destructive: true, onPress: discardWorkout }]} />
      <ActionSheet
        open={finish.step === "unfinished"}
        onClose={() => setFinish({ step: null, discard: true, diff: null })}
        title="Finish Workout?"
        message={`${unfinishedCount} ${unfinishedCount === 1 ? "set has" : "sets have"} values but ${unfinishedCount === 1 ? "is" : "are"} not marked complete. Empty sets are removed.`}
        actions={[
          { label: "Complete Unfinished Sets", onPress: () => void completeUnfinished() },
          { label: "Discard Unfinished Sets", destructive: true, onPress: () => void chooseTemplateStep(true) },
        ]}
      />
      <UpdateTemplateSheet open={finish.step === "template"} diff={finish.diff} onClose={() => setFinish({ step: null, discard: true, diff: null })} onChoose={(action) => void doFinish(finish.discard, action)} />
      <SaveAsTemplateSheet open={finish.step === "saveAs"} defaultName={w.name} onClose={() => setFinish({ step: null, discard: true, diff: null })} onSave={(n) => void doFinish(finish.discard, "save_as_template", n)} onSkip={() => void doFinish(finish.discard, "keep")} />
      <SummarySheet result={result} onDone={() => { setResult(null); navigate(WORKOUTS); }} />
    </>
  );
}

function nextSetHint(w: Workout, exerciseId: string, index: number): string | null {
  const list = w.exercises ?? [];
  const i = list.findIndex((e) => e.id === exerciseId);
  if (i < 0) return null;
  const sets = list[i]!.sets ?? [];
  const nextIdx = sets.findIndex((s, j) => j > index && !s.completed);
  if (nextIdx >= 0) return `Next: ${list[i]!.exercise?.name ?? "set"} set ${setLabel(sets, nextIdx)}`;
  for (let k = i + 1; k < list.length; k++) {
    const s2 = list[k]!.sets ?? [];
    const j = s2.findIndex((s) => !s.completed);
    if (j >= 0) return `Next: ${list[k]!.exercise?.name ?? "set"} set ${setLabel(s2, j)}`;
  }
  return "Last set done";
}

interface BlockProps {
  exercise: WorkoutExercise;
  index: number;
  count: number;
  units: ReturnType<typeof useAppSettings>["units"];
  mode: Mode;
  all: WorkoutExercise[];
  onChangeValue: (setId: string, kind: ColumnKind, v: number | null) => void;
  onCommit: (setId: string) => void;
  onToggleComplete: (setId: string) => void;
  onDelete: (setId: string) => void;
  onSetType: (setId: string, t: WorkoutSet["setType"]) => void;
  onCopyPrevious: (setId: string) => void;
  onAddSet: () => void;
  onReplace: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onPatch: (patch: { restSeconds?: number | null; notes?: string | null }) => void;
  onSuperset: (ids: string[], group: number) => void;
}

/** One exercise: header with name and menu, note, set table, Add Set. Rendered as an inset group; the superset bar sits on its left edge. */
function ExerciseBlock({ exercise: e, index, count, units, mode, all, onChangeValue, onCommit, onToggleComplete, onDelete, onSetType, onCopyPrevious, onAddSet, onReplace, onRemove, onMove, onPatch, onSuperset }: BlockProps) {
  const navigate = useNavigate();
  const category = e.exercise?.category ?? "barbell";
  const columns = useMemo(() => columnsFor(category, units), [category, units]);
  const grid = useMemo(() => gridTemplate(columns) + (hasFinePointer ? " 24px" : ""), [columns]);
  const sets = e.sets ?? [];
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [typeMenu, setTypeMenu] = useState<{ setId: string; anchor: { x: number; y: number } } | null>(null);
  const [noteOpen, setNoteOpen] = useState(Boolean(e.notes));
  const [note, setNote] = useState(e.notes ?? "");
  const [restOpen, setRestOpen] = useState(false);
  const [ssOpen, setSsOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const items: MenuItem[] = [
    { label: noteOpen ? "Edit Note" : "Add Note", icon: "note", onPress: () => { setNoteOpen(true); window.setTimeout(() => noteRef.current?.focus(), 50); } },
    { label: `Rest Timer (${e.restSeconds ? fmtSeconds(e.restSeconds) : "Off"})`, icon: "timer", onPress: () => setRestOpen(true) },
    { label: "Replace Exercise", icon: "swap", onPress: onReplace },
    { label: e.supersetGroup != null ? "Edit Superset" : "Superset With", icon: "link", onPress: () => setSsOpen(true), disabled: all.length < 2 },
    { label: "Move Up", icon: "arrow-up", onPress: () => onMove(-1), disabled: index === 0 },
    { label: "Move Down", icon: "arrow-down", onPress: () => onMove(1), disabled: index === count - 1 },
    { label: "Remove Exercise", icon: "trash", destructive: true, onPress: () => setRemoveOpen(true) },
  ];

  return (
    <Group className={cn("overflow-visible", e.supersetGroup != null && "wk-superset")} style={e.supersetGroup != null ? ({ "--wk-ss": supersetColor(e.supersetGroup) } as CSSProperties) : undefined} data-testid="exercise-block">
      <div className="flex items-center min-h-[44px] pl-[var(--gutter)] pr-1">
        <button type="button" className="flex-1 min-w-0 text-left text-headline text-accent-text truncate py-2 active:opacity-60" onClick={() => navigate(`${WORKOUTS}/exercises/${e.exerciseId}`)} data-testid="exercise-name">
          {e.exercise?.name ?? "Exercise"}
        </button>
        <IconButton label="Exercise menu" onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }}>
          <Icon name="more" size={20} />
        </IconButton>
      </div>
      {noteOpen && (
        <div className="px-[var(--gutter)] pb-2 -mt-1">
          <textarea ref={noteRef} value={note} rows={1} placeholder="Exercise note" onChange={(ev) => { setNote(ev.target.value); ev.target.style.height = "auto"; ev.target.style.height = `${ev.target.scrollHeight}px`; }} onBlur={() => { const v = note.trim() || null; if (v !== (e.notes ?? null)) onPatch({ notes: v }); if (!v) setNoteOpen(false); }} className="w-full bg-surface-2 rounded-sm px-3 py-2 text-subhead text-primary outline-none resize-none placeholder:text-tertiary" aria-label="Exercise note" />
        </div>
      )}
      <div className="wk-grid wk-grid-head px-[var(--gutter)] text-caption-1 font-medium text-secondary" style={{ gridTemplateColumns: grid }}>
        <span className="pl-1">Set</span>
        <span>Previous</span>
        {columns.map((c) => (
          <span key={c.kind} className="text-center">{c.label}</span>
        ))}
        <span className="text-center"><Icon name={mode === "live" ? "check" : "check"} size={14} className="inline-block text-tertiary" /></span>
        {hasFinePointer && <span />}
      </div>
      <div className="hairline-t">
        {sets.map((s, i) => (
          <SetRow
            key={s.id}
            set={s}
            index={i}
            sets={sets}
            columns={columns}
            grid={grid}
            previous={e.previous?.[i] ?? null}
            category={category}
            units={units}
            onChangeValue={(kind, v) => onChangeValue(s.id, kind, v)}
            onCommit={() => onCommit(s.id)}
            onToggleComplete={() => onToggleComplete(s.id)}
            onDelete={() => onDelete(s.id)}
            onSetType={(anchor) => setTypeMenu({ setId: s.id, anchor })}
            onCopyPrevious={() => onCopyPrevious(s.id)}
          />
        ))}
      </div>
      <button type="button" className="w-full h-11 text-subhead font-semibold text-accent-text hairline-t active:bg-pressed" onClick={onAddSet} data-testid="add-set">
        {`Add Set${e.restSeconds ? ` (${fmtSeconds(e.restSeconds)})` : ""}`}
      </button>

      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu} items={items} />
      <Menu
        open={Boolean(typeMenu)}
        onClose={() => setTypeMenu(null)}
        anchor={typeMenu?.anchor ?? null}
        items={SET_TYPES.map((t) => ({ label: t.letter ? `${t.letter}  ${t.label}` : t.label, onPress: () => { if (typeMenu) onSetType(typeMenu.setId, t.value); } }))}
      />
      <RestSheet open={restOpen} onClose={() => setRestOpen(false)} value={e.restSeconds} onPick={(v) => { onPatch({ restSeconds: v }); setRestOpen(false); }} />
      <SupersetSheet open={ssOpen} onClose={() => setSsOpen(false)} current={{ id: e.id, name: e.exercise?.name ?? "Exercise", supersetGroup: e.supersetGroup }} all={all.map((x) => ({ id: x.id, name: x.exercise?.name ?? "Exercise", supersetGroup: x.supersetGroup }))} onSave={onSuperset} />
      <ActionSheet open={removeOpen} onClose={() => setRemoveOpen(false)} title="Remove exercise?" message={`This removes ${e.exercise?.name ?? "the exercise"} and all of its sets from the workout.`} actions={[{ label: "Remove Exercise", destructive: true, onPress: onRemove }]} />
    </Group>
  );
}

