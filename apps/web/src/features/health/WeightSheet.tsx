import { useEffect, useState } from "react";
import { todayString } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Stepper } from "@/ui/Stepper";
import { FieldRow } from "@/ui/Field";

import { toast } from "@/ui/Toast";
import { fmt1, fmtWeight, fromDisplayWeight, toDisplayWeight } from "@/lib/format";
import { notify } from "@/lib/haptics";
import { useAppSettings } from "@/data/queries";
import { useLogWeight, useWeight } from "@/features/nutrition/api";
import { DateRow } from "./DateRow";
import { WellGroup } from "./parts";

/** Log a weigh-in: stepper in display units (0.1 steps), optional body fat, date defaults to today. */
export function WeightSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { units } = useAppSettings();
  const unit = units === "imperial" ? "lb" : "kg";
  const weight = useWeight(30);
  const log = useLogWeight();
  const latestKg = weight.data?.latest?.weightKg ?? null;
  const [value, setValue] = useState(0);
  const [bodyFat, setBodyFat] = useState("");
  const [date, setDate] = useState(todayString());
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBodyFat("");
    setDate(todayString());
    setError(null);
    setTouched(false);
  }, [open]);
  useEffect(() => {
    if (!open || touched) return;
    setValue(latestKg != null ? toDisplayWeight(latestKg, units) : units === "imperial" ? 160 : 72);
  }, [open, latestKg, units, touched]);

  const submit = async () => {
    const kg = fromDisplayWeight(value, units);
    if (kg <= 0 || kg > 500) {
      setError(units === "imperial" ? "Choose a weight under 1,100 lb" : "Choose a weight under 500 kg");
      return;
    }
    const bf = bodyFat.trim() === "" ? null : Number(bodyFat.replace(",", "."));
    if (bf != null && (Number.isNaN(bf) || bf < 1 || bf > 80)) {
      setError("Choose a body fat between 1% and 80%");
      return;
    }
    try {
      await log.mutateAsync({ date, weightKg: Math.round(kg * 100) / 100, bodyFatPct: bf });
      void notify("success");
      toast(`Logged ${fmtWeight(kg, units)}`);
      onClose();
    } catch (e) {
      void notify("error");
      setError(e instanceof Error ? e.message : "Unable to log the weight. Retry.");
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Log Weight"
      trailing={
        <button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={log.isPending} onClick={() => void submit()} data-testid="weight-done">
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-5 pt-3 -mx-[var(--gutter)]">
        <div className="px-[var(--gutter)]">
          <Stepper value={value} onChange={(v) => { setTouched(true); setValue(v); setError(null); }} step={0.1} min={1} max={units === "imperial" ? 1100 : 500} unit={unit} size="lg" label="Weight" format={(v) => fmt1(v)} />
          <p className="text-footnote text-secondary text-center mt-2 tabular">{latestKg != null ? `Last ${fmtWeight(latestKg, units)}` : "First weigh-in"}</p>
          {error && <p className="text-footnote text-danger-text text-center mt-2">{error}</p>}
        </div>
        <WellGroup>
          <FieldRow label="Body fat">
            <input inputMode="decimal" placeholder="Optional" aria-label="Body fat percent" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} className="w-24 text-right text-body outline-none bg-transparent tabular" />
            <span className="text-subhead text-secondary ml-1">%</span>
          </FieldRow>
          <DateRow value={date} max={todayString()} onChange={setDate} />
        </WellGroup>
      </div>
    </Sheet>
  );
}

