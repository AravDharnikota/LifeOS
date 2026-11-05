import { useEffect, useState } from "react";
import type { Goal } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Segmented } from "@/ui/Segmented";
import { Stepper } from "@/ui/Stepper";
import { ThinBar } from "@/ui/viz";
import { WellGroup, WellInput } from "./form";
import { notify } from "@/lib/haptics";
import { stepFor, withUnit } from "./model";

type Mode = "total" | "change";

/** Direct entry for a number goal: set the new total, or add a change. */
export function LogSheet({ goal, open, onClose, onLog, pending }: { goal: Goal; open: boolean; onClose: () => void; onLog: (input: { value?: number; delta?: number; note?: string | null }) => Promise<unknown>; pending?: boolean }) {
  const [mode, setMode] = useState<Mode>("change");
  const [value, setValue] = useState(0);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const step = stepFor(goal);

  useEffect(() => {
    if (!open) return;
    setMode("change");
    setValue(step);
    setNote("");
    setError(null);
  }, [open, step]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setValue(m === "total" ? (goal.currentValue ?? 0) : step);
  };

  const submit = async () => {
    if (mode === "change" && value === 0) {
      setError("Choose a change other than 0");
      return;
    }
    try {
      await onLog({ ...(mode === "total" ? { value } : { delta: value }), note: note.trim() || null });
      onClose();
    } catch (e) {
      void notify("error");
      setError(e instanceof Error ? e.message : "Unable to log progress");
    }
  };

  const preview = mode === "change" ? (goal.currentValue ?? 0) + value : value;
  const reached = goal.targetValue != null && (goal.direction === "decrease" ? preview <= goal.targetValue : preview >= goal.targetValue);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Log Progress"
      trailing={
        <button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={pending} onClick={() => void submit()} data-testid="log-done">
          Done
        </button>
      }
    >
      <div className="pt-2 pb-2 flex flex-col gap-5">
        <Segmented options={[{ value: "change", label: "Change" }, { value: "total", label: "Total" }]} value={mode} onChange={switchMode} />
        <div className="well rounded-[14px] px-3 pt-4 pb-3.5">
          <Stepper value={value} onChange={(v) => { setValue(v); setError(null); }} step={step} min={mode === "change" ? -1e9 : 0} unit={goal.unit ?? undefined} size="lg" format={mode === "change" ? (v) => (v > 0 ? `+${fmtStep(v, step)}` : fmtStep(v, step)) : (v) => fmtStep(v, step)} label={mode === "change" ? "Change" : "New total"} />
          {goal.targetValue != null && <ThinBar progress={progressOf(goal, preview)} height={4} className="mt-4" color={reached ? "var(--success)" : "var(--accent)"} />}
          <p className="text-[13px] text-tertiary text-center mt-2.5 tabular">
            {mode === "change" ? `New total ${withUnit(preview, goal.unit)}` : `Now ${withUnit(goal.currentValue ?? 0, goal.unit)}`}
            {goal.targetValue != null ? `, target ${withUnit(goal.targetValue, goal.unit)}` : ""}
          </p>
          {error && <p className="text-[13px] text-danger-text text-center mt-2">{error}</p>}
        </div>
        <WellGroup>
          <WellInput aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} enterKeyHint="done" onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        </WellGroup>
      </div>
    </Sheet>
  );
}

function fmtStep(v: number, step: number): string {
  const prec = String(step).includes(".") ? String(step).split(".")[1]!.length : 0;
  return Number(v.toFixed(prec)).toLocaleString("en-US", { maximumFractionDigits: prec });
}

/** Progress toward the target for a hypothetical value, respecting start and direction. */
function progressOf(goal: Goal, value: number): number {
  if (goal.targetValue == null) return 0;
  const start = goal.startValue ?? 0;
  const span = goal.targetValue - start;
  return span === 0 ? 1 : Math.max(0, Math.min(1, (value - start) / span));
}
