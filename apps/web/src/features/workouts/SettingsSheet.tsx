import { useEffect, useState } from "react";
import type { WorkoutSettings } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Group, Section } from "@/ui/List";
import { FieldRow, Switch } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { Skeleton } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { useUpdateWorkoutSettings, useWorkoutSettings } from "./api";

const REST_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "Off" },
  { value: "30", label: "0:30" },
  { value: "60", label: "1:00" },
  { value: "90", label: "1:30" },
  { value: "120", label: "2:00" },
  { value: "180", label: "3:00" },
];

/** Edits /api/workouts/settings in place; each change saves immediately. */
export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useWorkoutSettings();
  const update = useUpdateWorkoutSettings();
  const [draft, setDraft] = useState<WorkoutSettings | null>(null);
  useEffect(() => {
    if (q.data) setDraft(q.data);
  }, [q.data]);

  const save = (patch: Partial<WorkoutSettings>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    update.mutate(patch, { onError: () => toast("Unable to save settings") });
  };
  const restValue = (v: number | null) => (v == null ? "none" : String(v));
  const restFromValue = (v: string) => (v === "none" ? null : Number(v));

  return (
    <Sheet open={open} onClose={onClose} title="Workout Settings" leading={null} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={onClose}>Done</button>} detent="large">
      {!draft ? (
        <Skeleton rows={4} className="mx-0 mt-2" />
      ) : (
        <div className="pb-4 wk-flush">
          <Section title="Estimated 1RM" footer="Hybrid uses Brzycki below 10 reps and Epley from 10 reps.">
            <div className="px-0">
              <Segmented options={[{ value: "hybrid", label: "Hybrid" }, { value: "brzycki", label: "Brzycki" }, { value: "epley", label: "Epley" }]} value={draft.oneRmFormula} onChange={(v) => save({ oneRmFormula: v })} />
            </div>
          </Section>
          <Section title="Volume" footer="Counting dumbbells twice doubles the volume of dumbbell exercises.">
            <Group inset={false}>
              <FieldRow label="Count dumbbells twice">
                <Switch checked={draft.countDumbbellsTwice} onChange={(v) => save({ countDumbbellsTwice: v })} label="Count dumbbells twice" />
              </FieldRow>
              <FieldRow label="Weighted bodyweight volume">
                <Switch checked={draft.includeWeightedBodyweightVolume} onChange={(v) => save({ includeWeightedBodyweightVolume: v })} label="Weighted bodyweight volume" />
              </FieldRow>
              <FieldRow label="Assisted bodyweight volume">
                <Switch checked={draft.includeAssistedBodyweightVolume} onChange={(v) => save({ includeAssistedBodyweightVolume: v })} label="Assisted bodyweight volume" />
              </FieldRow>
            </Group>
          </Section>
          <Section title="Rest timer" footer="Working sets use the rest set on each exercise.">
            <Group inset={false}>
              <RestRow label="Warm-up sets" value={restValue(draft.warmupRestSeconds)} onChange={(v) => save({ warmupRestSeconds: restFromValue(v) })} />
              <RestRow label="Drop sets" value={restValue(draft.dropSetRestSeconds)} onChange={(v) => save({ dropSetRestSeconds: restFromValue(v) })} />
            </Group>
            <div className="mt-3">
              <div className="text-footnote text-secondary mb-2">Timer increment</div>
              <Segmented options={[{ value: "5", label: "5s" }, { value: "10", label: "10s" }, { value: "15", label: "15s" }, { value: "30", label: "30s" }]} value={String(draft.timerIncrementSeconds)} onChange={(v) => save({ timerIncrementSeconds: Number(v) })} />
            </div>
          </Section>
          <Section title="Previous set" footer="Where the Previous column takes its values from.">
            <Segmented options={[{ value: "any", label: "Any Workout" }, { value: "same_template", label: "Same Template" }]} value={draft.previousSetSource} onChange={(v) => save({ previousSetSource: v })} />
          </Section>
        </div>
      )}
    </Sheet>
  );
}

function RestRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <FieldRow label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="text-subhead text-secondary tabular bg-transparent text-right pr-1 h-11 appearance-none" aria-label={label}>
        {REST_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </FieldRow>
  );
}
