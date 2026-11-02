import { useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router";
import type { WorkoutTemplateInput } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Section } from "@/ui/List";
import { ActionSheet } from "@/ui/Sheet";
import { Menu, type MenuItem } from "@/ui/Menu";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { fmtDate, fmtTime } from "@/lib/format";
import { useAppSettings } from "@/data/queries";
import { useCreateTemplate, useDeleteWorkout, useWorkout } from "./api";
import { columnsFor, fmtDuration, fmtSetValues, fmtVolume, gridTemplate, plural, setLabel, supersetColor, WORKOUTS } from "./lib";

export default function WorkoutDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const app = useAppSettings();
  const units = app.units;
  const q = useWorkout(id);
  const del = useDeleteWorkout();
  const saveTpl = useCreateTemplate();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const w = q.data;

  const saveAsTemplate = () => {
    if (!w) return;
    const input: WorkoutTemplateInput = {
      name: w.name,
      notes: w.notes,
      exercises: (w.exercises ?? []).map((e) => ({ exerciseId: e.exerciseId, supersetGroup: e.supersetGroup, restSeconds: e.restSeconds, notes: e.notes, sets: (e.sets ?? []).map((s) => ({ setType: s.setType, targetWeight: s.weight, targetReps: s.reps, targetSeconds: s.seconds, targetDistance: s.distance })) })),
    };
    saveTpl.mutate(input, { onSuccess: () => toast("Template saved."), onError: () => toast("Unable to save the template.") });
  };
  const items: MenuItem[] = [
    { label: "Edit Workout", icon: "pencil", onPress: () => navigate(`${WORKOUTS}/history/${id}/edit`) },
    { label: "Save as Template", icon: "copy", onPress: saveAsTemplate },
    { label: "Delete Workout", icon: "trash", destructive: true, onPress: () => setConfirm(true) },
  ];

  return (
    <Screen
      title={w?.name ?? "Workout"}
      subtitle={w ? `${fmtDate(w.finishedAt ?? w.startedAt)}, ${fmtTime(w.startedAt, app.hour12)}${w.templateName ? ` · ${w.templateName}` : ""}` : undefined}
      back={`${WORKOUTS}/history`}
      actions={
        <IconButton label="Workout menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }} disabled={!w}>
          <Icon name="more" />
        </IconButton>
      }
    >
      {q.isPending ? (
        <Skeleton rows={6} />
      ) : q.isError ? (
        <InlineError onRetry={() => void q.refetch()}>Unable to load the workout.</InlineError>
      ) : !w ? (
        <Empty>Workout not found.</Empty>
      ) : (
        <div className="lg:max-w-[640px]">
          <div className="px-[var(--gutter)] grid grid-cols-3 pb-2">
            <Stat value={fmtDuration(w.durationSeconds ?? 0)} label="Duration" />
            <Stat value={fmtVolume(w.totalVolume ?? 0, units)} label="Volume" />
            <Stat value={<span className="inline-flex items-center gap-1">{w.prCount > 0 && <Icon name="trophy" size={20} className="text-warning-text" />}{w.prCount}</span>} label={w.prCount === 1 ? "Record" : "Records"} />
          </div>
          {w.notes && <p className="px-[var(--gutter)] text-subhead text-secondary pb-2">{w.notes}</p>}
          <div className="flex flex-col gap-4 pt-2">
            {(w.exercises ?? []).map((e) => {
              const category = e.exercise?.category ?? "barbell";
              const columns = columnsFor(category, units);
              const sets = e.sets ?? [];
              return (
                <Group key={e.id} className={cn(e.supersetGroup != null && "wk-superset")} style={e.supersetGroup != null ? ({ "--wk-ss": supersetColor(e.supersetGroup) } as CSSProperties) : undefined} data-testid="detail-exercise">
                  <button type="button" className="w-full text-left min-h-[44px] px-[var(--gutter)] py-2 text-headline text-accent-text truncate active:opacity-60" onClick={() => navigate(`${WORKOUTS}/exercises/${e.exerciseId}`)}>
                    {sets.length} × {e.exercise?.name ?? "Exercise"}
                  </button>
                  {e.notes && <p className="px-[var(--gutter)] pb-2 -mt-1 text-footnote text-secondary">{e.notes}</p>}
                  <div className="wk-grid wk-grid-head px-[var(--gutter)] text-caption-1 font-medium text-secondary" style={{ gridTemplateColumns: gridTemplate(columns) }}>
                    <span className="pl-1">Set</span>
                    <span />
                    {columns.map((c) => <span key={c.kind} className="text-center">{c.label}</span>)}
                    <span />
                  </div>
                  <div className="hairline-t">
                    {sets.map((s, i) => (
                      <div key={s.id} className="wk-grid px-[var(--gutter)] text-subhead tabular" style={{ gridTemplateColumns: gridTemplate(columns) }}>
                        <span className={cn("wk-tag text-footnote pl-2", `wk-tag-${s.setType}`)}>{setLabel(sets, i)}</span>
                        <span className="text-secondary truncate">{fmtSetValues(s, category, units)}</span>
                        {columns.map((c) => (
                          <span key={c.kind} className="text-center text-primary num">{cellText(s, c.kind, category, units)}</span>
                        ))}
                        <span className="flex justify-center">{s.prs.length > 0 && <Icon name="trophy" size={16} className="text-warning-text" data-testid="pr-badge" />}</span>
                      </div>
                    ))}
                  </div>
                </Group>
              );
            })}
            {(w.exercises ?? []).length === 0 && <Empty>No sets were logged.</Empty>}
          </div>
          <Section title="Totals" className="mt-6">
            <p className="px-[var(--gutter)] text-footnote text-secondary">{plural(w.totalSets ?? 0, "set")} across {plural((w.exercises ?? []).length, "exercise")}.</p>
          </Section>
        </div>
      )}
      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu} items={items} />
      <ActionSheet open={confirm} onClose={() => setConfirm(false)} title="Delete this workout?" message="Records from this workout are recalculated." actions={[{ label: "Delete Workout", destructive: true, onPress: () => { if (id) del.mutate(id, { onSuccess: () => { toast("Workout deleted."); navigate(`${WORKOUTS}/history`); }, onError: () => toast("Unable to delete the workout.") }); } }]} />
    </Screen>
  );
}

function cellText(s: { weight: number | null; reps: number | null; seconds: number | null; distance: number | null }, kind: "weight" | "reps" | "distance" | "seconds", category: Parameters<typeof columnsFor>[0], units: Parameters<typeof columnsFor>[1]): string {
  const one = fmtSetValues({ weight: kind === "weight" ? s.weight : null, reps: kind === "reps" ? s.reps : null, seconds: kind === "seconds" ? s.seconds : null, distance: kind === "distance" ? s.distance : null }, category, units);
  // fmtSetValues formats pairs; for a single column show the raw field instead.
  if (kind === "reps") return s.reps == null ? "" : String(s.reps);
  if (kind === "weight") return s.weight == null ? "" : fmtSetValues({ weight: s.weight, reps: 0, seconds: null, distance: null }, "barbell", units).replace(/ × 0$/, "");
  if (kind === "seconds") return s.seconds == null ? "" : fmtSetValues({ weight: null, reps: null, seconds: s.seconds, distance: null }, "duration", units);
  if (kind === "distance") return s.distance == null ? "" : fmtSetValues({ weight: null, reps: null, seconds: null, distance: s.distance }, "cardio", units);
  return one;
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <div className="text-title-2 num text-primary">{value}</div>
      <div className="text-footnote text-secondary">{label}</div>
    </div>
  );
}
