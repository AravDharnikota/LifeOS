import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router";
import type { Exercise, SetType, WorkoutSet, WorkoutTemplate, WorkoutTemplateInput } from "@aravos/shared";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group } from "@/ui/List";
import { ActionSheet } from "@/ui/Sheet";
import { Menu, type MenuItem } from "@/ui/Menu";
import { TextField } from "@/ui/Field";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { hasFinePointer } from "@/lib/platform";
import { useAppSettings } from "@/data/queries";
import { useCreateTemplate, useReplaceTemplate, useTemplate } from "./api";
import { columnsFor, fmtSeconds, gridTemplate, SET_TYPES, supersetColor, weightStep, WORKOUTS, type ColumnKind } from "./lib";
import { SetRow } from "./SetRow";
import { KeypadAccessory } from "./KeypadAccessory";
import { ExercisePicker } from "./ExercisePicker";
import { RestSheet, ScreenFrame, SupersetSheet } from "./common";

interface TSet {
  key: string;
  setType: SetType;
  targetWeight: number | null;
  targetReps: number | null;
  targetSeconds: number | null;
  targetDistance: number | null;
}
interface TEx {
  key: string;
  exercise: Exercise;
  supersetGroup: number | null;
  restSeconds: number | null;
  notes: string | null;
  sets: TSet[];
}

let seq = 1;
const newKey = () => `k${seq++}`;
const emptySet = (): TSet => ({ key: newKey(), setType: "normal", targetWeight: null, targetReps: null, targetSeconds: null, targetDistance: null });

function fromTemplate(t: WorkoutTemplate): TEx[] {
  return (t.exercises ?? []).filter((e) => e.exercise).map((e) => ({
    key: newKey(),
    exercise: e.exercise!,
    supersetGroup: e.supersetGroup,
    restSeconds: e.restSeconds,
    notes: e.notes,
    sets: (e.sets ?? []).map((s) => ({ key: newKey(), setType: s.setType, targetWeight: s.targetWeight, targetReps: s.targetReps, targetSeconds: s.targetSeconds, targetDistance: s.targetDistance })),
  }));
}

/** Template editor: title, notes, folder, exercise blocks with target sets. Saves the whole nested template. */
export default function TemplateEditorScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const app = useAppSettings();
  const units = app.units;
  const q = useTemplate(id);
  const create = useCreateTemplate();
  const replace = useReplaceTemplate();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [folder, setFolder] = useState("");
  const [exercises, setExercises] = useState<TEx[]>([]);
  const [loaded, setLoaded] = useState(!id);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState<null | { mode: "add" } | { mode: "replace"; key: string }>(null);
  const [discard, setDiscard] = useState(false);

  useEffect(() => {
    if (!id || !q.data || loaded) return;
    setName(q.data.name);
    setNotes(q.data.notes ?? "");
    setFolder(q.data.folder ?? "");
    setExercises(fromTemplate(q.data));
    setLoaded(true);
  }, [id, q.data, loaded]);

  const touch = (fn: (cur: TEx[]) => TEx[]) => {
    setExercises(fn);
    setDirty(true);
  };
  const updateEx = (key: string, patch: Partial<TEx>) => touch((cur) => cur.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  const updateSet = (exKey: string, setKey: string, patch: Partial<TSet>) => touch((cur) => cur.map((e) => (e.key === exKey ? { ...e, sets: e.sets.map((s) => (s.key === setKey ? { ...s, ...patch } : s)) } : e)));

  const save = () => {
    if (!name.trim()) {
      toast("Enter a template name.");
      return;
    }
    const input: WorkoutTemplateInput = {
      name: name.trim(),
      notes: notes.trim() || null,
      folder: folder.trim() || null,
      exercises: exercises.map((e) => ({ exerciseId: e.exercise.id, supersetGroup: e.supersetGroup, restSeconds: e.restSeconds, notes: e.notes, sets: e.sets.map((s) => ({ setType: s.setType, targetWeight: s.targetWeight, targetReps: s.targetReps, targetSeconds: s.targetSeconds, targetDistance: s.targetDistance })) })),
    };
    const done = () => {
      toast("Template saved.");
      setDirty(false);
      navigate(WORKOUTS);
    };
    const fail = () => toast("Unable to save the template.");
    if (id) replace.mutate({ id, ...input }, { onSuccess: done, onError: fail });
    else create.mutate(input, { onSuccess: done, onError: fail });
  };
  const cancel = () => {
    if (dirty) setDiscard(true);
    else navigate(-1);
  };
  const stepField = (setId: string, kind: ColumnKind, dir: 1 | -1) => {
    for (const e of exercises) {
      const s = e.sets.find((x) => x.key === setId);
      if (!s) continue;
      const field = kind === "weight" ? "targetWeight" : kind === "reps" ? "targetReps" : kind === "seconds" ? "targetSeconds" : "targetDistance";
      const base = s[field] ?? 0;
      const step = kind === "weight" ? (units === "imperial" ? weightStep(units) * 0.45359237 : weightStep(units)) : kind === "reps" ? 1 : kind === "seconds" ? 15 : 0.1;
      updateSet(e.key, setId, { [field]: Math.max(0, Math.round((base + dir * step) * 1000) / 1000) } as Partial<TSet>);
      return;
    }
  };

  if (id && (q.isPending || !loaded)) return <ScreenFrame title="Edit Template" onBack={() => navigate(-1)}><div className="pt-6"><Skeleton rows={6} /></div></ScreenFrame>;
  if (id && q.isError) return <ScreenFrame title="Edit Template" onBack={() => navigate(-1)}><InlineError onRetry={() => void q.refetch()}>Unable to load the template.</InlineError></ScreenFrame>;

  const saving = create.isPending || replace.isPending;
  return (
    <>
      <ScreenFrame onBack={cancel} title={id ? "Edit Template" : "New Template"} right={<Button variant="primary" size="sm" loading={saving} onClick={save} data-testid="template-save">Save</Button>}>
        <div className="px-[var(--gutter)] pt-3 pb-2 flex flex-col gap-3">
          <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} placeholder="Template name" className="w-full bg-transparent outline-none text-title-2 text-primary font-bold placeholder:text-tertiary placeholder:font-bold" aria-label="Template name" data-testid="template-name" />
          <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }} placeholder="Notes" rows={1} className="w-full bg-transparent outline-none text-subhead text-primary resize-none placeholder:text-tertiary" aria-label="Template notes" />
          <TextField label="Folder" placeholder="My Templates" value={folder} onChange={(e) => { setFolder(e.target.value); setDirty(true); }} />
        </div>
        <div className="flex flex-col gap-4 pt-2">
          {exercises.map((e, i) => (
            <TemplateBlock
              key={e.key}
              ex={e}
              index={i}
              count={exercises.length}
              all={exercises}
              units={units}
              onUpdate={(patch) => updateEx(e.key, patch)}
              onUpdateSet={(setKey, patch) => updateSet(e.key, setKey, patch)}
              onAddSet={() => updateEx(e.key, { sets: [...e.sets, { ...(e.sets[e.sets.length - 1] ?? emptySet()), key: newKey() }] })}
              onDeleteSet={(setKey) => updateEx(e.key, { sets: e.sets.filter((s) => s.key !== setKey) })}
              onRemove={() => touch((cur) => cur.filter((x) => x.key !== e.key))}
              onReplace={() => setPicker({ mode: "replace", key: e.key })}
              onMove={(dir) => touch((cur) => { const list = [...cur]; const j = i + dir; if (j < 0 || j >= list.length) return cur; [list[i], list[j]] = [list[j]!, list[i]!]; return list; })}
              onSuperset={(ids, group) => touch((cur) => cur.map((x) => (ids.includes(x.key) ? { ...x, supersetGroup: group } : x.supersetGroup === group ? { ...x, supersetGroup: null } : x)))}
            />
          ))}
          {exercises.length === 0 && <Empty className="pt-4 pb-0">No exercises yet.</Empty>}
        </div>
        <div className="px-[var(--gutter)] pt-6">
          <Button variant="secondary" size="lg" full onClick={() => setPicker({ mode: "add" })} data-testid="add-exercises">Add Exercises</Button>
        </div>
      </ScreenFrame>
      <KeypadAccessory onPrevious={() => undefined} onStep={stepField} stepLabel={(f) => (f === "weight" ? String(weightStep(units)) : f === "reps" ? "1" : f === "seconds" ? "15s" : "0.1")} />
      <ExercisePicker
        open={Boolean(picker)}
        onClose={() => setPicker(null)}
        mode={picker?.mode === "replace" ? "single" : "multi"}
        onPick={(list) => {
          if (picker?.mode === "replace") updateEx(picker.key, { exercise: list[0]! });
          else touch((cur) => [...cur, ...list.map((ex) => ({ key: newKey(), exercise: ex, supersetGroup: null, restSeconds: app.defaultRestSeconds, notes: null, sets: [emptySet()] }))]);
        }}
      />
      <ActionSheet open={discard} onClose={() => setDiscard(false)} title="Discard changes?" actions={[{ label: "Discard Changes", destructive: true, onPress: () => navigate(-1) }]} />
    </>
  );
}

function TemplateBlock({ ex: e, index, count, all, units, onUpdate, onUpdateSet, onAddSet, onDeleteSet, onRemove, onReplace, onMove, onSuperset }: { ex: TEx; index: number; count: number; all: TEx[]; units: ReturnType<typeof useAppSettings>["units"]; onUpdate: (p: Partial<TEx>) => void; onUpdateSet: (setKey: string, p: Partial<TSet>) => void; onAddSet: () => void; onDeleteSet: (setKey: string) => void; onRemove: () => void; onReplace: () => void; onMove: (dir: -1 | 1) => void; onSuperset: (ids: string[], group: number) => void }) {
  const category = e.exercise.category;
  const columns = useMemo(() => columnsFor(category, units), [category, units]);
  const grid = useMemo(() => gridTemplate(columns) + (hasFinePointer ? " 24px" : ""), [columns]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [typeMenu, setTypeMenu] = useState<{ setKey: string; anchor: { x: number; y: number } } | null>(null);
  const [noteOpen, setNoteOpen] = useState(Boolean(e.notes));
  const [restOpen, setRestOpen] = useState(false);
  const [ssOpen, setSsOpen] = useState(false);
  const asSets: WorkoutSet[] = e.sets.map((s, i) => ({ id: s.key, workoutExerciseId: e.key, sortOrder: i, setType: s.setType, weight: s.targetWeight, reps: s.targetReps, seconds: s.targetSeconds, distance: s.targetDistance, rpe: null, completed: false, completedAt: null, prs: [] }));
  const items: MenuItem[] = [
    { label: noteOpen ? "Edit Note" : "Add Note", icon: "note", onPress: () => setNoteOpen(true) },
    { label: `Rest Timer (${e.restSeconds ? fmtSeconds(e.restSeconds) : "Off"})`, icon: "timer", onPress: () => setRestOpen(true) },
    { label: "Replace Exercise", icon: "swap", onPress: onReplace },
    { label: e.supersetGroup != null ? "Edit Superset" : "Superset With", icon: "link", onPress: () => setSsOpen(true), disabled: all.length < 2 },
    { label: "Move Up", icon: "arrow-up", onPress: () => onMove(-1), disabled: index === 0 },
    { label: "Move Down", icon: "arrow-down", onPress: () => onMove(1), disabled: index === count - 1 },
    { label: "Remove Exercise", icon: "trash", destructive: true, onPress: onRemove },
  ];
  const fieldFor = (kind: ColumnKind): keyof TSet => (kind === "weight" ? "targetWeight" : kind === "reps" ? "targetReps" : kind === "seconds" ? "targetSeconds" : "targetDistance");
  return (
    <Group className={cn("overflow-visible", e.supersetGroup != null && "wk-superset")} style={e.supersetGroup != null ? ({ "--wk-ss": supersetColor(e.supersetGroup) } as CSSProperties) : undefined} data-testid="exercise-block">
      <div className="flex items-center min-h-[44px] pl-[var(--gutter)] pr-1">
        <span className="flex-1 min-w-0 text-headline text-primary truncate py-2" data-testid="exercise-name">{e.exercise.name}</span>
        <IconButton label="Exercise menu" onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }}>
          <Icon name="more" size={20} />
        </IconButton>
      </div>
      {noteOpen && (
        <div className="px-[var(--gutter)] pb-2 -mt-1">
          <textarea value={e.notes ?? ""} rows={1} placeholder="Exercise note" autoFocus={!e.notes} onChange={(ev) => onUpdate({ notes: ev.target.value || null })} onBlur={() => { if (!e.notes) setNoteOpen(false); }} className="w-full bg-surface-2 rounded-sm px-3 py-2 text-subhead text-primary outline-none resize-none placeholder:text-tertiary" aria-label="Exercise note" />
        </div>
      )}
      <div className="wk-grid wk-grid-head px-[var(--gutter)] text-caption-1 font-medium text-secondary" style={{ gridTemplateColumns: grid }}>
        <span className="pl-1">Set</span>
        <span>Previous</span>
        {columns.map((c) => <span key={c.kind} className="text-center">{c.label}</span>)}
        <span className="text-center"><Icon name="lock" size={14} className="inline-block text-tertiary" /></span>
        {hasFinePointer && <span />}
      </div>
      <div className="hairline-t">
        {asSets.map((s, i) => (
          <SetRow key={s.id} set={s} index={i} sets={asSets} columns={columns} grid={grid} previous={null} category={category} units={units} checkable={false} onChangeValue={(kind, v) => onUpdateSet(s.id, { [fieldFor(kind)]: v } as Partial<TSet>)} onCommit={() => undefined} onDelete={() => onDeleteSet(s.id)} onSetType={(anchor) => setTypeMenu({ setKey: s.id, anchor })} />
        ))}
      </div>
      <button type="button" className="w-full h-11 text-subhead font-semibold text-accent-text hairline-t active:bg-pressed" onClick={onAddSet} data-testid="add-set">
        {`Add Set${e.restSeconds ? ` (${fmtSeconds(e.restSeconds)})` : ""}`}
      </button>
      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu} items={items} />
      <Menu open={Boolean(typeMenu)} onClose={() => setTypeMenu(null)} anchor={typeMenu?.anchor ?? null} items={SET_TYPES.map((t) => ({ label: t.letter ? `${t.letter}  ${t.label}` : t.label, onPress: () => { if (typeMenu) onUpdateSet(typeMenu.setKey, { setType: t.value }); } }))} />
      <RestSheet open={restOpen} onClose={() => setRestOpen(false)} value={e.restSeconds} onPick={(v) => { onUpdate({ restSeconds: v }); setRestOpen(false); }} />
      <SupersetSheet open={ssOpen} onClose={() => setSsOpen(false)} current={{ id: e.key, name: e.exercise.name, supersetGroup: e.supersetGroup }} all={all.map((x) => ({ id: x.key, name: x.exercise.name, supersetGroup: x.supersetGroup }))} onSave={onSuperset} />
    </Group>
  );
}
