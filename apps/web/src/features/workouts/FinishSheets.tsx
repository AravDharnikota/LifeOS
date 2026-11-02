import { useEffect, useState } from "react";
import type { TemplateAction, Workout, WorkoutFinishResult } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row } from "@/ui/List";
import { TextField } from "@/ui/Field";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { fmtDate, fmtTime } from "@/lib/format";
import { useAppSettings } from "@/data/queries";
import { bestOf, fmtDuration, fmtPrValue, fmtSetValues, fmtVolume, plural, prLabel, setLabel, shareText, supersetColor, type TemplateDiff, type Units } from "./lib";

/** Strong's "Update Template" prompt: only the buttons that apply; destructive styling when the update removes things. */
export function UpdateTemplateSheet({ open, diff, onChoose, onClose }: { open: boolean; diff: TemplateDiff | null; onChoose: (action: TemplateAction) => void; onClose: () => void }) {
  const d = diff;
  const both = Boolean(d?.structural && d?.valueChanges);
  return (
    <Sheet open={open} onClose={onClose} title="Update Template?" leading={null} trailing={null}>
      <p className="text-subhead text-secondary pt-1 pb-4">This workout differs from the template it started from.</p>
      <Group inset={false}>
        {both && <Choice label="Update Template and Values" detail={`${d?.text ?? ""} ${d?.valueText ?? ""}`.trim()} destructive={d?.removes} onPress={() => onChoose("update_both")} />}
        {d?.structural && <Choice label="Update Template" detail={d.text} destructive={d.removes} onPress={() => onChoose("update_template")} />}
        {Boolean(d?.valueChanges) && <Choice label="Update Values Only" detail={d?.valueText ?? ""} onPress={() => onChoose("update_values")} />}
        <Choice label="Keep Original Template" onPress={() => onChoose("keep")} />
      </Group>
    </Sheet>
  );
}

function Choice({ label, detail, destructive, onPress }: { label: string; detail?: string; destructive?: boolean; onPress: () => void }) {
  return <Row title={<span className={cn("font-medium", destructive ? "text-danger-text" : "text-accent-text")}>{label}</span>} subtitle={detail || undefined} onPress={onPress} />;
}

/** Offered after an empty workout. */
export function SaveAsTemplateSheet({ open, defaultName, onSave, onSkip, onClose }: { open: boolean; defaultName: string; onSave: (name: string) => void; onSkip: () => void; onClose: () => void }) {
  const [name, setName] = useState(defaultName);
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);
  return (
    <Sheet open={open} onClose={onClose} title="Save as Template?" leading={null} trailing={null}>
      <p className="text-subhead text-secondary pt-1 pb-4">Save this workout as a template to perform it again.</p>
      <TextField label="Template name" value={name} onChange={(e) => setName(e.target.value)} enterKeyHint="done" onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSave(name.trim()); }} />
      <div className="flex flex-col gap-2 pt-5">
        <Button variant="primary" size="lg" full disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save as Template</Button>
        <Button variant="plain" size="lg" full onClick={onSkip}>Skip</Button>
      </div>
    </Sheet>
  );
}

/** Post-finish summary: name, date, duration, volume, PRs, per-exercise best set and the PR list. */
export function SummarySheet({ result, onDone }: { result: WorkoutFinishResult | null; onDone: () => void }) {
  const units = useAppSettings().units;
  const w = result?.workout;
  const s = result?.summary;
  const share = async () => {
    if (!w || !s) return;
    const text = shareText(w, units, s.prs);
    try {
      if (navigator.share) await navigator.share({ title: w.name, text });
      else await navigator.clipboard.writeText(text);
      toast("Summary copied.");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        toast("Summary copied.");
      } catch {
        toast("Unable to share.");
      }
    }
  };
  return (
    <Sheet open={Boolean(result)} onClose={onDone} title="Workout Complete" leading={null} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={onDone} data-testid="summary-done">Done</button>} detent="large">
      {w && s && (
        <div className="flex flex-col gap-5 pt-1 pb-4" data-testid="summary">
          <div>
            <h3 className="text-title-2 text-primary">{w.name}</h3>
            <p className="text-subhead text-secondary mt-0.5">{w.finishedAt ? `${fmtDate(w.finishedAt)}, ${fmtTime(w.finishedAt)}` : fmtDate(w.startedAt)}</p>
          </div>
          <div className="grid grid-cols-3">
            <Stat label="Duration" value={fmtDuration(s.durationSeconds)} testId="summary-duration" />
            <Stat label="Volume" value={fmtVolume(s.totalVolume, units)} testId="summary-volume" />
            <Stat label={s.prs.length === 1 ? "Record" : "Records"} value={<span className="inline-flex items-center gap-1">{s.prs.length > 0 && <Icon name="trophy" size={20} className="text-warning-text" />}{s.prs.length}</span>} />
          </div>
          <ExerciseSummaryList workout={w} units={units} />
          {s.prs.length > 0 && (
            <div>
              <div className="text-footnote text-secondary pb-2">{plural(s.prs.length, "personal record")}</div>
              <Group inset={false}>
                {s.prs.map((p, i) => (
                  <Row key={i} leading={<Icon name="trophy" size={20} className="text-warning-text" />} title={p.exerciseName} subtitle={prLabel(p.type)} trailing={<span className="text-primary">{fmtPrValue(p.type, p.value, units)}</span>} />
                ))}
              </Group>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="lg" full onClick={onDone}>Done</Button>
            <Button variant="plain" size="lg" full onClick={() => void share()}>Share</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Stat({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
  return (
    <div>
      <div className="text-title-2 num text-primary" data-testid={testId}>{value}</div>
      <div className="text-footnote text-secondary">{label}</div>
    </div>
  );
}

/** "5 × Squat (Barbell)" rows with the best set trailing; superset bars preserved. */
export function ExerciseSummaryList({ workout, units }: { workout: Workout; units: Units }) {
  return (
    <Group inset={false}>
      {(workout.exercises ?? []).map((e) => {
        const sets = e.sets ?? [];
        const best = bestOf(sets, e.exercise?.category ?? "barbell");
        const bestIdx = best ? sets.indexOf(best) : -1;
        return (
          <Row
            key={e.id}
            className={cn(e.supersetGroup != null && "wk-superset")}
            style={e.supersetGroup != null ? ({ "--wk-ss": supersetColor(e.supersetGroup) } as React.CSSProperties) : undefined}
            title={`${sets.length} × ${e.exercise?.name ?? "Exercise"}`}
            subtitle={best && bestIdx >= 0 ? `Best set ${setLabel(sets, bestIdx)}` : undefined}
            trailing={
              <span className="inline-flex items-center gap-1.5 text-primary">
                {best ? fmtSetValues(best, e.exercise?.category ?? "barbell", units) : ""}
                {sets.some((s) => s.prs.length) && <Icon name="trophy" size={16} className="text-warning-text" />}
              </span>
            }
          />
        );
      })}
    </Group>
  );
}
