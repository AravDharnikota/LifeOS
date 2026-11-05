import { useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router";
import type { WorkoutTemplateInput } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { GlassCard, StatusPill } from "@/ui/viz";
import { ActionSheet } from "@/ui/Sheet";
import { Menu, type MenuItem } from "@/ui/Menu";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { fmtDate, fmtTime } from "@/lib/format";
import { useAppSettings } from "@/data/queries";
import { useCreateTemplate, useDeleteWorkout, useWorkout } from "./api";
import { NumUnit } from "./common";
import { fmtDuration, fmtSetValues, fmtVolume, plural, prLabel, setLabel, supersetColor, WORKOUTS } from "./lib";

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
      compact
      back={`${WORKOUTS}/history`}
      actions={
        <IconButton label="Workout menu" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }} disabled={!w}>
          <Icon name="more" size={20} />
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
        <div className="lg:max-w-[680px]">
          <div className="px-[var(--gutter)] pt-3 pb-4 rise">
            <h1 className="text-[28px] leading-[34px] tracking-[-0.02em] text-primary">{w.name}</h1>
            <p className="text-[13px] text-tertiary mt-1 tabular">{fmtDate(w.finishedAt ?? w.startedAt)}, {fmtTime(w.startedAt, app.hour12)}{w.templateName ? ` · ${w.templateName}` : ""}</p>
          </div>
          <GlassCard tone="strong" className="mx-[var(--gutter)] rise" style={{ "--i": 1 } as CSSProperties}>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Duration"><NumUnit text={fmtDuration(w.durationSeconds ?? 0)} size={28} /></Stat>
              <Stat label="Volume"><NumUnit text={fmtVolume(w.totalVolume ?? 0, units)} size={28} /></Stat>
              <Stat label={w.prCount === 1 ? "Record" : "Records"}><NumUnit text={String(w.prCount)} size={28} /></Stat>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 hairline-t text-[12px] text-tertiary tabular">
              <span>{plural(w.totalSets ?? 0, "set")} across {plural((w.exercises ?? []).length, "exercise")}</span>
              {w.prCount > 0 && <StatusPill tone="success">{w.prCount === 1 ? "1 PR" : `${w.prCount} PRs`}</StatusPill>}
            </div>
          </GlassCard>
          {w.notes && <p className="px-[calc(var(--gutter)+4px)] text-[15px] text-secondary pt-4">{w.notes}</p>}
          <div className="flex flex-col gap-3 pt-5">
            {(w.exercises ?? []).map((e, ei) => {
              const category = e.exercise?.category ?? "barbell";
              const sets = e.sets ?? [];
              const prs = sets.filter((s) => s.prs.length).length;
              return (
                <div key={e.id} className={cn("glass rounded-lg mx-[var(--gutter)] relative rise", e.supersetGroup != null && "wk-superset")} style={{ "--i": Math.min(ei + 2, 10), ...(e.supersetGroup != null ? { "--wk-ss": supersetColor(e.supersetGroup) } : {}) } as CSSProperties} data-testid="detail-exercise">
                  <button type="button" className="w-full flex items-center gap-3 text-left pl-4 pr-3 pt-3 pb-2.5 active:opacity-60" onClick={() => navigate(`${WORKOUTS}/exercises/${e.exerciseId}`)}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[16px] leading-5 text-primary truncate">{e.exercise?.name ?? "Exercise"}</span>
                      <span className="block text-[12px] leading-4 text-tertiary mt-0.5 tabular">{plural(sets.length, "set")}{prs ? ` · ${plural(prs, "record")}` : ""}</span>
                    </span>
                    <Icon name="chevron-right" size={16} className="text-quaternary shrink-0" />
                  </button>
                  {e.notes && <p className="px-4 pb-2 -mt-1 text-[13px] text-secondary">{e.notes}</p>}
                  <div className="well rounded-[16px] mx-2 mb-2 overflow-hidden">
                    {sets.map((s, i) => (
                      <div key={s.id} className={cn("flex items-center h-11 gap-3 px-3 tabular", i > 0 && "hairline-t", s.prs.length > 0 && "wk-set-done")}>
                        <span className={cn("wk-tag text-[13px] inline-flex items-center justify-center min-w-[24px]", `wk-tag-${s.setType}`)}>{setLabel(sets, i)}</span>
                        <span className="text-primary num text-[16px] flex-1 min-w-0 truncate">{fmtSetValues(s, category, units)}</span>
                        {s.prs.length > 0 && <span data-testid="pr-badge"><StatusPill tone="success">{s.prs.map((t) => prLabel(t)).join(", ")}</StatusPill></span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {(w.exercises ?? []).length === 0 && <Empty>No sets were logged.</Empty>}
          </div>
        </div>
      )}
      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu} items={items} />
      <ActionSheet open={confirm} onClose={() => setConfirm(false)} title="Delete this workout?" message="Records from this workout are recalculated." actions={[{ label: "Delete Workout", destructive: true, onPress: () => { if (id) del.mutate(id, { onSuccess: () => { toast("Workout deleted."); navigate(`${WORKOUTS}/history`); }, onError: () => toast("Unable to delete the workout.") }); } }]} />
    </Screen>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-tertiary">{label}</div>
      <div className="mt-1 truncate">{children}</div>
    </div>
  );
}
