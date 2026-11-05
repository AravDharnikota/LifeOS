import { useEffect, useState, type CSSProperties } from "react";
import type { TemplateAction, Workout, WorkoutFinishResult } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { StatusPill } from "@/ui/viz";
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

/** Splits "1h 5m" / "1,240 lb" into thin numbers with small units. Text content stays "1h 5m" / "1,240 lb". */
function NumberWithUnits({ text, testId }: { text: string; testId?: string }) {
  const parts = text.match(/[\d.,]+|[^\d.,]+/g) ?? [text];
  return (
    <span className="inline-flex items-baseline" data-testid={testId}>
      {parts.map((p, i) => (/\d/.test(p) ? <span key={i} className="num text-primary text-[30px] leading-[34px]">{p}</span> : <span key={i} className="text-[13px] text-tertiary whitespace-pre">{p}</span>))}
    </span>
  );
}

/** Post-finish summary: calm, glassy. Thin big numbers for duration / volume / sets, records as rows with a "PR" pill, then per-exercise best sets. */
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
    <Sheet open={Boolean(result)} onClose={onDone} title="Workout Complete" leading={null} trailing={<button type="button" className="text-headline text-accent-text px-3 h-11" onClick={onDone} data-testid="summary-done">Done</button>} detent="large">
      {w && s && (
        <div className="flex flex-col gap-5 pt-2 pb-4" data-testid="summary">
          <div className="rise flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[26px] leading-8 tracking-[-0.02em] text-primary truncate-2">{w.name}</h3>
              <p className="text-[13px] text-tertiary mt-1">{w.finishedAt ? `${fmtDate(w.finishedAt)}, ${fmtTime(w.finishedAt)}` : fmtDate(w.startedAt)}</p>
            </div>
            <StatusPill tone="success" dot className="mt-1.5 shrink-0">Complete</StatusPill>
          </div>

          <div className="rise grid grid-cols-3 gap-2" style={{ "--i": 1 } as CSSProperties}>
            <Stat label="Duration"><NumberWithUnits text={fmtDuration(s.durationSeconds)} testId="summary-duration" /></Stat>
            <Stat label="Volume"><NumberWithUnits text={fmtVolume(s.totalVolume, units)} testId="summary-volume" /></Stat>
            <Stat label={s.totalSets === 1 ? "Set" : "Sets"}><span className="num text-primary text-[30px] leading-[34px]">{s.totalSets}</span></Stat>
          </div>

          {s.prs.length > 0 && (
            <div className="rise" style={{ "--i": 2 } as CSSProperties}>
              <div className="flex items-baseline justify-between px-1 pb-2">
                <span className="text-[15px] text-primary">Personal records</span>
                <span className="text-[12px] text-tertiary tabular">{plural(s.prs.length, "record")}</span>
              </div>
              <div className="well rounded-[16px] overflow-hidden">
                {s.prs.map((p, i) => (
                  <div key={i} className={cn("flex items-center gap-3 px-4 min-h-[56px]", i > 0 && "hairline-t")}>
                    <div className="flex-1 min-w-0 py-2.5">
                      <div className="text-[15px] text-primary truncate">{p.exerciseName}</div>
                      <div className="text-[12px] text-tertiary truncate mt-0.5">{prLabel(p.type)}</div>
                    </div>
                    <span className="num text-[18px] text-primary tabular shrink-0">{fmtPrValue(p.type, p.value, units)}</span>
                    <StatusPill tone="success" className="shrink-0">PR</StatusPill>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rise" style={{ "--i": 3 } as CSSProperties}>
            <div className="px-1 pb-2 text-[15px] text-primary">Exercises</div>
            <ExerciseSummaryList workout={w} units={units} />
          </div>

          <div className="flex flex-col gap-1 pt-1">
            <Button variant="primary" size="lg" full onClick={onDone}>Done</Button>
            <Button variant="plain" size="lg" full onClick={() => void share()}>Share</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="well rounded-[16px] px-3 pt-3 pb-2.5 min-w-0">
      <div className="text-[12px] text-tertiary">{label}</div>
      <div className="mt-1 truncate">{children}</div>
    </div>
  );
}

/** "5 × Squat (Barbell)" rows with the best set trailing; superset bars preserved. Drawn as a whiter well (it sits inside a sheet). */
export function ExerciseSummaryList({ workout, units }: { workout: Workout; units: Units }) {
  return (
    <div className="well rounded-[16px] overflow-hidden">
      {(workout.exercises ?? []).map((e, i) => {
        const sets = e.sets ?? [];
        const best = bestOf(sets, e.exercise?.category ?? "barbell");
        const bestIdx = best ? sets.indexOf(best) : -1;
        const pr = sets.some((s) => s.prs.length);
        return (
          <div
            key={e.id}
            className={cn("flex items-center gap-3 pl-4 pr-4 min-h-[56px]", i > 0 && "hairline-t", e.supersetGroup != null && "wk-superset")}
            style={e.supersetGroup != null ? ({ "--wk-ss": supersetColor(e.supersetGroup) } as CSSProperties) : undefined}
          >
            <div className="flex-1 min-w-0 py-2.5">
              <div className="text-[15px] text-primary truncate">{`${sets.length} × ${e.exercise?.name ?? "Exercise"}`}</div>
              {best && bestIdx >= 0 && <div className="text-[12px] text-tertiary truncate mt-0.5">{`Best set ${setLabel(sets, bestIdx)}`}</div>}
            </div>
            <span className="text-[14px] text-secondary tabular shrink-0">{best ? fmtSetValues(best, e.exercise?.category ?? "barbell", units) : ""}</span>
            {pr && <StatusPill tone="success" className="shrink-0">PR</StatusPill>}
          </div>
        );
      })}
    </div>
  );
}
