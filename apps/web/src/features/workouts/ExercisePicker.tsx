import { useEffect, useMemo, useState } from "react";
import type { Exercise, ExerciseCategory } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row, SectionHeader } from "@/ui/List";
import { TextField, Chip, TextArea } from "@/ui/Field";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks";
import { selection } from "@/lib/haptics";
import { useCreateExercise, useExercises } from "./api";

export const BODY_PARTS: { value: Exercise["bodyPart"]; label: string }[] = [
  { value: "chest", label: "Chest" },
  { value: "back", label: "Back" },
  { value: "legs", label: "Legs" },
  { value: "shoulders", label: "Shoulders" },
  { value: "arms", label: "Arms" },
  { value: "core", label: "Core" },
  { value: "full_body", label: "Full body" },
  { value: "cardio", label: "Cardio" },
  { value: "other", label: "Other" },
];
export const CATEGORIES: { value: ExerciseCategory; label: string; hint: string }[] = [
  { value: "barbell", label: "Barbell", hint: "Weight and reps" },
  { value: "dumbbell", label: "Dumbbell", hint: "Weight per hand and reps" },
  { value: "machine", label: "Machine or other", hint: "Weight and reps" },
  { value: "cable", label: "Cable", hint: "Weight and reps" },
  { value: "bodyweight", label: "Bodyweight", hint: "Reps only, no weight" },
  { value: "weighted_bodyweight", label: "Weighted bodyweight", hint: "Added weight and reps" },
  { value: "assisted_bodyweight", label: "Assisted bodyweight", hint: "Assistance weight and reps" },
  { value: "reps_only", label: "Reps only", hint: "Just a rep count" },
  { value: "cardio", label: "Cardio", hint: "Distance and time" },
  { value: "duration", label: "Timed", hint: "Time only, like a plank" },
];
export const categoryHint = (v: ExerciseCategory): string => CATEGORIES.find((c) => c.value === v)?.hint ?? "";
export const bodyPartLabel = (v: Exercise["bodyPart"]): string => BODY_PARTS.find((b) => b.value === v)?.label ?? v;
export const categoryLabel = (v: ExerciseCategory): string => CATEGORIES.find((c) => c.value === v)?.label ?? v;

export interface ExercisePickerProps {
  open: boolean;
  onClose: () => void;
  /** Multi-select adds several; single picks one (replace). */
  mode?: "multi" | "single";
  onPick: (exercises: Exercise[]) => void;
  title?: string;
}

/** Search field, body part and category chips, recent, multi-select with checkmarks, "Add N Exercises", plus New Exercise. */
export function ExercisePicker({ open, onClose, mode = "multi", onPick, title }: ExercisePickerProps) {
  const [q, setQ] = useState("");
  const [bodyPart, setBodyPart] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [selected, setSelected] = useState<Exercise[]>([]);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q, 200);
  const list = useExercises({ q: dq || undefined, bodyPart, category });

  useEffect(() => {
    if (open) {
      setSelected([]);
      setQ("");
    }
  }, [open]);

  const recent = useMemo(() => (!dq && !bodyPart && !category ? (list.data ?? []).filter((e) => e.lastPerformedAt).sort((a, b) => (b.lastPerformedAt ?? "").localeCompare(a.lastPerformedAt ?? "")).slice(0, 5) : []), [list.data, dq, bodyPart, category]);
  const isSelected = (e: Exercise) => selected.some((s) => s.id === e.id);
  const toggle = (e: Exercise) => {
    if (mode === "single") {
      onPick([e]);
      onClose();
      return;
    }
    void selection();
    setSelected((cur) => (cur.some((s) => s.id === e.id) ? cur.filter((s) => s.id !== e.id) : [...cur, e]));
  };
  const submit = () => {
    if (!selected.length) return;
    onPick(selected);
    onClose();
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={title ?? (mode === "single" ? "Replace Exercise" : "Add Exercises")} detent="large" trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={() => setCreating(true)}>New</button>} className="wk-picker">
        <div className="sticky top-0 z-10 bg-elevated pt-1 pb-2 -mx-[var(--gutter)] px-[var(--gutter)]">
          <TextField placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} leading={<Icon name="search" size={18} className="text-tertiary" />} type="search" autoCorrect="off" autoCapitalize="none" enterKeyHint="search" data-testid="exercise-search" />
          <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2 -mx-[var(--gutter)] px-[var(--gutter)]">
            <Chip selected={!bodyPart} onClick={() => setBodyPart(undefined)}>Any body part</Chip>
            {BODY_PARTS.map((b) => (
              <Chip key={b.value} selected={bodyPart === b.value} onClick={() => setBodyPart(bodyPart === b.value ? undefined : b.value)}>{b.label}</Chip>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2 -mx-[var(--gutter)] px-[var(--gutter)]">
            <Chip selected={!category} onClick={() => setCategory(undefined)}>Any category</Chip>
            {CATEGORIES.map((c) => (
              <Chip key={c.value} selected={category === c.value} onClick={() => setCategory(category === c.value ? undefined : c.value)}>{c.label}</Chip>
            ))}
          </div>
        </div>
        <div className="pb-24">
          {list.isPending ? (
            <Skeleton rows={6} className="mx-0" />
          ) : list.isError ? (
            <InlineError onRetry={() => void list.refetch()}>Unable to load exercises.</InlineError>
          ) : list.data.length === 0 ? (
            <Empty action={<Button variant="plain" onClick={() => setCreating(true)}>New Exercise</Button>}>No exercises match.</Empty>
          ) : (
            <>
              {recent.length > 0 && (
                <>
                  <SectionHeader title="Recent" className="px-0 pt-2" />
                  <Group inset={false} className="mb-4">
                    {recent.map((e) => (
                      <PickRow key={e.id} exercise={e} selected={isSelected(e)} onPress={() => toggle(e)} />
                    ))}
                  </Group>
                </>
              )}
              {recent.length > 0 && <SectionHeader title="All exercises" className="px-0" />}
              <Group inset={false} data-testid="exercise-list">
                {list.data.map((e) => (
                  <PickRow key={e.id} exercise={e} selected={isSelected(e)} onPress={() => toggle(e)} />
                ))}
              </Group>
            </>
          )}
        </div>
        {mode === "multi" && (
          <div className="absolute left-0 right-0 bottom-0 px-[var(--gutter)] pt-2 pb-[max(12px,var(--safe-bottom))] bg-elevated hairline-t">
            <Button variant="primary" size="lg" full disabled={!selected.length} onClick={submit} data-testid="picker-add">
              {selected.length ? `Add ${selected.length} ${selected.length === 1 ? "Exercise" : "Exercises"}` : "Add Exercises"}
            </Button>
          </div>
        )}
      </Sheet>
      <NewExerciseSheet open={creating} onClose={() => setCreating(false)} onCreated={(e) => { setCreating(false); if (mode === "single") { onPick([e]); onClose(); } else setSelected((cur) => [...cur, e]); }} />
    </>
  );
}

function PickRow({ exercise, selected, onPress }: { exercise: Exercise; selected: boolean; onPress: () => void }) {
  return (
    <Row
      title={exercise.name}
      subtitle={`${bodyPartLabel(exercise.bodyPart)} · ${categoryLabel(exercise.category)}`}
      onPress={onPress}
      className={cn(selected && "bg-accent-soft")}
      trailing={selected ? <Icon name="check" size={20} className="text-accent-text" /> : undefined}
      aria-selected={selected}
      data-testid="exercise-row"
    />
  );
}

/** Create a custom exercise: name, body part chips, category chips, optional instructions. */
export function NewExerciseSheet({ open, onClose, onCreated, initial }: { open: boolean; onClose: () => void; onCreated: (e: Exercise) => void; initial?: Partial<Pick<Exercise, "name" | "bodyPart" | "category" | "instructions">> }) {
  const create = useCreateExercise();
  const [name, setName] = useState("");
  const [bodyPart, setBodyPart] = useState<Exercise["bodyPart"]>("chest");
  const [category, setCategory] = useState<ExerciseCategory>("barbell");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setBodyPart(initial?.bodyPart ?? "chest");
    setCategory(initial?.category ?? "barbell");
    setInstructions(initial?.instructions ?? "");
    setError(null);
  }, [open, initial]);
  const valid = name.trim().length > 0;
  const save = () => {
    if (!valid) return;
    create.mutate(
      { name: name.trim(), bodyPart, category, instructions: instructions.trim() || null },
      {
        onSuccess: (e) => {
          toast("Exercise created.");
          onCreated(e);
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Unable to create the exercise"),
      },
    );
  };
  return (
    <Sheet open={open} onClose={onClose} title="New Exercise" detent="large" dirty={valid} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={!valid || create.isPending} onClick={save} data-testid="new-exercise-save">Save</button>}>
      <div className="flex flex-col gap-5 pt-2 pb-6">
        <TextField label="Name" placeholder="Incline Press (Dumbbell)" value={name} onChange={(e) => setName(e.target.value)} error={error} autoFocus enterKeyHint="done" onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        <div>
          <div className="text-footnote text-secondary mb-2">Body part</div>
          <div className="flex flex-wrap gap-2">
            {BODY_PARTS.map((b) => (
              <Chip key={b.value} selected={bodyPart === b.value} onClick={() => setBodyPart(b.value)}>{b.label}</Chip>
            ))}
          </div>
        </div>
        <div>
          <div className="text-footnote text-secondary mb-2">Tracks</div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <Chip key={c.value} selected={category === c.value} onClick={() => setCategory(c.value)}>{c.label}</Chip>
            ))}
          </div>
          <p className="text-footnote text-tertiary mt-2">{categoryHint(category)}</p>
        </div>
        <TextArea label="Instructions" placeholder="Optional" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </div>
    </Sheet>
  );
}
