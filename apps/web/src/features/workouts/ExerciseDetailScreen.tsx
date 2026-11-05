import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router";
import { subMonths } from "date-fns";
import type { Exercise, ExerciseDetail } from "@aravos/shared";

type ChartPoint = ExerciseDetail["charts"]["oneRm"][number];
import { Screen } from "@/ui/Screen";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Section, ValueRow } from "@/ui/List";
import { GlassCard, StatusPill } from "@/ui/viz";
import { Segmented } from "@/ui/Segmented";
import { Sheet, ActionSheet } from "@/ui/Sheet";
import { TextField, Chip, TextArea } from "@/ui/Field";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { fmtRelativeDate } from "@/lib/format";
import { useIsDesktop } from "@/lib/hooks";
import { useAppSettings } from "@/data/queries";
import { useDeleteExercise, useExerciseDetail, useUpdateExercise } from "./api";
import { BODY_PARTS, CATEGORIES, bodyPartLabel, categoryHint, categoryLabel } from "./ExercisePicker";
import { BarChart, LineChart } from "./charts";
import { NumUnit } from "./common";
import { displayWeight, fmtDate, fmtDistanceValue, fmtPrValue, fmtSeconds, fmtSetValues, fmtVolume, fmtWeightValue, isWeighted, plural, prLabel, setLabel, WORKOUTS, type Units } from "./lib";

type Tab = "about" | "history" | "records" | "charts";
type Period = "1M" | "3M" | "1Y" | "All";

export default function ExerciseDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const units = useAppSettings().units;
  const q = useExerciseDetail(id);
  const [tab, setTab] = useState<Tab>("about");
  const [editing, setEditing] = useState(false);
  const d = q.data;
  const tabs = isDesktop
    ? [{ value: "about", label: "About" }, { value: "history", label: "History" }, { value: "records", label: "Records" }]
    : [{ value: "about", label: "About" }, { value: "history", label: "History" }, { value: "records", label: "Records" }, { value: "charts", label: "Charts" }];
  useEffect(() => {
    if (isDesktop && tab === "charts") setTab("records");
  }, [isDesktop, tab]);
  return (
    <Screen
      title={d?.exercise.name ?? "Exercise"}
      subtitle={d ? `${bodyPartLabel(d.exercise.bodyPart)} · ${categoryLabel(d.exercise.category)} · ${plural(d.workoutCount, "workout")}` : undefined}
      back
      actions={d ? <button type="button" className="glass pressable-spring h-10 px-4 rounded-full text-[15px] text-primary" onClick={() => setEditing(true)}>Edit</button> : undefined}
      header={
        <div className="flex flex-col gap-3">
          {d && <Hero d={d} units={units} />}
          <Segmented options={tabs as { value: Tab; label: string }[]} value={tab} onChange={setTab} className="lg:max-w-[480px]" />
        </div>
      }
    >
      {q.isPending ? (
        <Skeleton rows={6} />
      ) : q.isError ? (
        <InlineError onRetry={() => void q.refetch()}>Unable to load the exercise.</InlineError>
      ) : !d ? (
        <Empty>Exercise not found.</Empty>
      ) : (
        <>
          {tab === "about" && <About d={d} onDeleted={() => navigate(`${WORKOUTS}/exercises`)} />}
          {tab === "history" && <History d={d} units={units} />}
          {tab === "records" && (
            <div className={cn(isDesktop && "grid grid-cols-2 gap-6 px-[var(--gutter)] [&>*>*]:mx-0")}>
              <Records d={d} units={units} />
              {isDesktop && <Charts d={d} units={units} />}
            </div>
          )}
          {tab === "charts" && <Charts d={d} units={units} />}
        </>
      )}
      {d && <EditExerciseSheet open={editing} onClose={() => setEditing(false)} exercise={d.exercise} />}
    </Screen>
  );
}

/** Hero stats: best estimated 1RM (or the top record), workouts, last done. Thin big numbers on strong glass. */
function Hero({ d, units }: { d: ExerciseDetail; units: Units }) {
  const top = d.records.find((r) => r.type === "one_rm") ?? d.records[0];
  return (
    <GlassCard tone="strong" className="rise lg:max-w-[640px]">
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
        <div className="min-w-0">
          <div className="text-[12px] text-tertiary truncate">{top ? `Best ${prLabel(top.type)}` : "Best"}</div>
          <div className="mt-1 truncate">{top ? <NumUnit text={fmtPrValue(top.type, top.value, units)} size={28} /> : <span className="num text-[28px] leading-8 text-quaternary">–</span>}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[12px] text-tertiary">Workouts</div>
          <div className="mt-1"><NumUnit text={String(d.workoutCount)} size={28} /></div>
        </div>
        <div className="min-w-0">
          <div className="text-[12px] text-tertiary">Last done</div>
          <div className="mt-1.5 text-[15px] text-primary truncate">{d.exercise.lastPerformedAt ? fmtRelativeDate(d.exercise.lastPerformedAt, false) : "Never"}</div>
        </div>
      </div>
    </GlassCard>
  );
}

function About({ d, onDeleted }: { d: ExerciseDetail; onDeleted: () => void }) {
  const del = useDeleteExercise();
  const [confirm, setConfirm] = useState(false);
  const e = d.exercise;
  return (
    <>
      <Section>
        <Group>
          <ValueRow title="Category" value={categoryLabel(e.category)} />
          <ValueRow title="Body part" value={bodyPartLabel(e.bodyPart)} />
          <ValueRow title="Workouts" value={String(d.workoutCount)} />
          {e.lastPerformedAt && <ValueRow title="Last performed" value={fmtRelativeDate(e.lastPerformedAt)} />}
        </Group>
      </Section>
      <Section title="Instructions">
        <GlassCard className="mx-[var(--gutter)]">
          {e.instructions ? (
            <ol className="flex flex-col gap-3">
              {e.instructions.split(/\n+/).filter(Boolean).map((line, i) => (
                <li key={i} className="flex gap-3 text-[15px] text-primary">
                  <span className="w-6 h-6 rounded-full well inline-flex items-center justify-center text-[12px] text-secondary tabular shrink-0">{i + 1}</span>
                  <span className="pt-0.5">{line.replace(/^\d+[.)]\s*/, "")}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[15px] text-secondary">No instructions.</p>
          )}
        </GlassCard>
      </Section>
      {e.isCustom && (
        <Section>
          <div className="px-[var(--gutter)]">
            <Button variant="destructive" full onClick={() => setConfirm(true)}>Delete Exercise</Button>
          </div>
          <ActionSheet open={confirm} onClose={() => setConfirm(false)} title={`Delete "${e.name}"?`} message="Past workouts keep their sets." actions={[{ label: "Delete Exercise", destructive: true, onPress: () => del.mutate(e.id, { onSuccess: () => { toast("Exercise deleted."); onDeleted(); } }) }]} />
        </Section>
      )}
    </>
  );
}

function History({ d, units }: { d: ExerciseDetail; units: Units }) {
  const navigate = useNavigate();
  if (!d.history.length) return <Empty>No sessions yet.</Empty>;
  return (
    <div className="flex flex-col gap-3 lg:max-w-[640px]" data-testid="exercise-history">
      {d.history.map((h, hi) => (
        <div key={h.workoutExerciseId} className="glass rounded-lg mx-[var(--gutter)] rise" style={{ "--i": Math.min(hi, 8) } as CSSProperties}>
          <button type="button" className="w-full flex items-center gap-3 text-left pl-4 pr-3 pt-3 pb-2.5 active:opacity-60" onClick={() => navigate(`${WORKOUTS}/history/${h.workoutId}`)}>
            <span className="flex-1 min-w-0">
              <span className="block text-[16px] leading-5 text-primary truncate">{h.name}</span>
              <span className="block text-[12px] leading-4 text-tertiary mt-0.5">{fmtDate(h.finishedAt ?? h.startedAt)}</span>
            </span>
            <Icon name="chevron-right" size={16} className="text-quaternary shrink-0" />
          </button>
          <div className="well rounded-[16px] mx-2 mb-2 overflow-hidden">
            {h.sets.map((s, i) => (
              <div key={s.id} className={cn("flex items-center h-10 gap-3 px-3 tabular", i > 0 && "hairline-t")}>
                <span className={cn("wk-tag text-[13px] w-6 text-center", `wk-tag-${s.setType}`)}>{setLabel(h.sets, i)}</span>
                <span className="text-primary num text-[16px] flex-1 min-w-0 truncate">{fmtSetValues(s, d.exercise.category, units)}</span>
                {s.prs.length > 0 && <StatusPill tone="success">PR</StatusPill>}
              </div>
            ))}
          </div>
          {h.notes && <p className="text-[13px] text-secondary px-4 pb-3">{h.notes}</p>}
        </div>
      ))}
    </div>
  );
}

function Records({ d, units }: { d: ExerciseDetail; units: Units }) {
  const weighted = isWeighted(d.exercise.category) || d.exercise.category === "weighted_bodyweight";
  const hasTable = d.bestByReps.some((r) => r.best != null || r.predicted != null);
  return (
    <div className="lg:max-w-[640px]">
      <Section title="Personal records">
        {d.records.length === 0 ? (
          <Empty className="pt-2 pb-2">No records yet. Complete a set to start.</Empty>
        ) : (
          <div className="px-[var(--gutter)] lg:px-0 grid grid-cols-2 gap-3" data-testid="records">
            {d.records.map((r, i) => (
              <GlassCard key={r.id} className="rise !p-3.5 min-w-0" style={{ "--i": Math.min(i, 8) } as CSSProperties}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-secondary truncate">{prLabel(r.type)}</span>
                  <StatusPill tone="success">PR</StatusPill>
                </div>
                <div className="mt-2.5 truncate"><NumUnit text={fmtPrValue(r.type, r.value, units)} size={26} /></div>
                <div className="text-[12px] text-tertiary truncate mt-1">{fmtRelativeDate(r.achievedAt, false)}</div>
                {r.weight != null && r.reps != null && r.type !== "weight" && <div className="text-[12px] text-tertiary truncate tabular">{`${fmtWeightValue(r.weight, units)} × ${r.reps}`}</div>}
              </GlassCard>
            ))}
          </div>
        )}
      </Section>
      {weighted && hasTable && (
        <Section title="Best performance by reps" footer="Predicted values come from the best estimated 1RM. Records cover sets of 12 reps or fewer.">
          <Group>
            <div className="grid grid-cols-[48px_1fr_1fr] px-[var(--gutter)] h-9 items-center text-[11px] text-tertiary">
              <span>Reps</span>
              <span className="text-right">Best</span>
              <span className="text-right">Predicted</span>
            </div>
            {d.bestByReps.map((r) => (
              <div key={r.reps} className="grid grid-cols-[48px_1fr_1fr] px-[var(--gutter)] h-10 items-center text-[15px] tabular hairline-t">
                <span className="text-secondary">{r.reps}</span>
                <span className="text-right text-primary num">{r.best != null ? fmtWeightValue(r.best, units) : "–"}</span>
                <span className="text-right text-secondary num">{r.predicted != null ? fmtWeightValue(r.predicted, units) : "–"}</span>
              </div>
            ))}
          </Group>
        </Section>
      )}
    </div>
  );
}

interface ChartDef {
  key: keyof ExerciseDetail["charts"];
  title: string;
  kind: "line" | "bar";
  fmt: (v: number) => string;
  axis: (v: number) => string;
  toDisplay: (v: number) => number;
  fromZero: boolean;
}

function chartDefs(category: Exercise["category"], units: Units): ChartDef[] {
  const w = (v: number) => fmtWeightValue(v, units);
  const wAxis = (v: number) => String(Math.round(v));
  const wDisp = (v: number) => displayWeight(v, units);
  if (isWeighted(category)) {
    return [
      { key: "oneRm", title: "Estimated 1RM", kind: "line", fmt: w, axis: wAxis, toDisplay: wDisp, fromZero: false },
      { key: "maxWeight", title: "Max weight", kind: "line", fmt: w, axis: wAxis, toDisplay: wDisp, fromZero: false },
      { key: "volume", title: "Total volume", kind: "bar", fmt: (v) => fmtVolume(v, units), axis: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))), toDisplay: wDisp, fromZero: true },
    ];
  }
  if (category === "weighted_bodyweight" || category === "assisted_bodyweight") {
    return [
      { key: "maxWeight", title: "Max weight added", kind: "line", fmt: w, axis: wAxis, toDisplay: wDisp, fromZero: false },
      { key: "maxReps", title: "Max reps", kind: "line", fmt: (v) => `${Math.round(v)} reps`, axis: (v) => String(Math.round(v)), toDisplay: (v) => v, fromZero: false },
      { key: "totalReps", title: "Total reps", kind: "bar", fmt: (v) => `${Math.round(v)} reps`, axis: (v) => String(Math.round(v)), toDisplay: (v) => v, fromZero: true },
    ];
  }
  if (category === "cardio") {
    return [
      { key: "distance", title: "Distance", kind: "bar", fmt: (v) => fmtDistanceValue(v, units), axis: (v) => String(Math.round(v * 10) / 10), toDisplay: (v) => (units === "imperial" ? v / 1.609344 : v), fromZero: true },
      { key: "duration", title: "Duration", kind: "bar", fmt: fmtSeconds, axis: (v) => `${Math.round(v / 60)}m`, toDisplay: (v) => v, fromZero: true },
    ];
  }
  if (category === "duration") return [{ key: "duration", title: "Duration", kind: "bar", fmt: fmtSeconds, axis: (v) => `${Math.round(v / 60)}m`, toDisplay: (v) => v, fromZero: true }];
  return [
    { key: "maxReps", title: "Max reps", kind: "line", fmt: (v) => `${Math.round(v)} reps`, axis: (v) => String(Math.round(v)), toDisplay: (v) => v, fromZero: false },
    { key: "totalReps", title: "Total reps", kind: "bar", fmt: (v) => `${Math.round(v)} reps`, axis: (v) => String(Math.round(v)), toDisplay: (v) => v, fromZero: true },
  ];
}

function Charts({ d, units }: { d: ExerciseDetail; units: Units }) {
  const [period, setPeriod] = useState<Period>("3M");
  const defs = useMemo(() => chartDefs(d.exercise.category, units), [d.exercise.category, units]);
  const cutoff = period === "All" ? null : subMonths(new Date(), period === "1M" ? 1 : period === "3M" ? 3 : 12);
  const filter = (pts: ChartPoint[]) => (cutoff ? pts.filter((p) => new Date(p.date) >= cutoff) : pts);
  const any = defs.some((def) => filter(d.charts[def.key]).length > 0);
  return (
    <div className="lg:max-w-[640px]">
      <div className="px-[var(--gutter)] pb-3">
        <Segmented options={[{ value: "1M", label: "1M" }, { value: "3M", label: "3M" }, { value: "1Y", label: "1Y" }, { value: "All", label: "All" }]} value={period} onChange={setPeriod} size="sm" />
      </div>
      {!any ? (
        <Empty className="pt-4">No data in this period.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {defs.map((def) => (
            <ChartBlock key={def.key} def={def} points={filter(d.charts[def.key])} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Summary row above the plot carries the message; scrubbing swaps it (brief 4.12). */
function ChartBlock({ def, points }: { def: ChartDef; points: ChartPoint[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const data = points.map((p) => ({ label: fmtDate(p.date, true), value: def.toDisplay(p.value), title: fmtDate(p.date) }));
  const idx = sel ?? points.length - 1;
  const shown = points[idx];
  if (!points.length) return null;
  const best = Math.max(...points.map((p) => p.value));
  return (
    <section className="glass rounded-lg mx-[var(--gutter)] lg:mx-0 p-4 rise" data-testid="chart">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-secondary truncate">{sel != null && shown ? fmtDate(shown.date) : def.title}</div>
          <div className="mt-1">{shown ? <NumUnit text={def.fmt(shown.value)} size={28} /> : null}</div>
        </div>
        {sel == null && <span className="shrink-0 h-[22px] px-2 rounded-[7px] well inline-flex items-center text-[11px] text-secondary tabular">Best {def.fmt(best)}</span>}
      </div>
      {def.kind === "line" ? <LineChart points={data} format={def.axis} selected={sel} onSelect={setSel} fromZero={def.fromZero} className="mt-2" /> : <BarChart points={data} format={def.axis} selected={sel} onSelect={setSel} fromZero={def.fromZero} className="mt-2" />}
    </section>
  );
}

/** Built-ins keep their name; the tracking type (category) can be changed on any exercise. */
function EditExerciseSheet({ open, onClose, exercise }: { open: boolean; onClose: () => void; exercise: Exercise }) {
  const update = useUpdateExercise();
  const [name, setName] = useState(exercise.name);
  const [bodyPart, setBodyPart] = useState(exercise.bodyPart);
  const [category, setCategory] = useState(exercise.category);
  const [instructions, setInstructions] = useState(exercise.instructions ?? "");
  useEffect(() => {
    if (!open) return;
    setName(exercise.name);
    setBodyPart(exercise.bodyPart);
    setCategory(exercise.category);
    setInstructions(exercise.instructions ?? "");
  }, [open, exercise]);
  const save = () => {
    const patch = exercise.isCustom ? { name: name.trim(), bodyPart, category, instructions: instructions.trim() || null } : { bodyPart, category, instructions: instructions.trim() || null };
    update.mutate({ id: exercise.id, ...patch }, { onSuccess: () => { toast("Exercise saved."); onClose(); }, onError: (e) => toast(e instanceof Error ? e.message : "Unable to save the exercise.") });
  };
  return (
    <Sheet open={open} onClose={onClose} title="Edit Exercise" detent="large" trailing={<button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={!name.trim() || update.isPending} onClick={save}>Save</button>}>
      <div className="flex flex-col gap-5 pt-2 pb-6">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} disabled={!exercise.isCustom} hint={exercise.isCustom ? undefined : "Built-in exercises keep their name."} />
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
        <TextArea label="Instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="One step per line" />
      </div>
    </Sheet>
  );
}
