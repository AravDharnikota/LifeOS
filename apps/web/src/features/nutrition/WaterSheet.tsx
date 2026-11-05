import { useEffect, useState } from "react";
import { todayString } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Stepper } from "@/ui/Stepper";
import { TapChip } from "./TapChip";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Row, SectionHeader } from "@/ui/List";
import { Skeleton, InlineError } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { fmtInt, fmtTime } from "@/lib/format";
import { impact, notify } from "@/lib/haptics";
import { useAppSettings } from "@/data/queries";
import { useAddWater, useDeleteWater, useWater } from "./api";
import { WATER_CHIPS, WATER_STEP, celebrateOnce, fromDisplayWater, toDisplayWater, waterUnit } from "./model";
import { GoalCheck, WellGroup } from "@/features/health/parts";
import { ArcRing } from "@/ui/viz";

/** Quick water entry: today's total as the hero, an amount stepper with chips, and the log with delete. */
export function WaterSheet({ open, onClose, date }: { open: boolean; onClose: () => void; date?: string }) {
  const day = date ?? todayString();
  const { units, hour12 } = useAppSettings();
  const unit = waterUnit(units);
  const water = useWater(day);
  const add = useAddWater();
  const del = useDeleteWater();
  const chips = WATER_CHIPS[units];
  const [amount, setAmount] = useState(chips[0] ?? 250);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(chips[0] ?? 250);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, units]);

  const total = water.data?.ml ?? 0;
  const target = water.data?.target ?? 0;
  const left = Math.max(0, target - total);

  const log = async () => {
    const ml = fromDisplayWater(amount, units);
    if (ml <= 0) return;
    setError(null);
    try {
      await add.mutateAsync({ ml, date: day });
      const reached = target > 0 && total < target && total + ml >= target && day === todayString() && celebrateOnce("water");
      void (reached ? notify("success") : impact("light"));
      toast(`Logged ${fmtInt(amount)} ${unit}`);
      onClose();
    } catch {
      void notify("error");
      setError("Unable to log water. Retry.");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Water" detent="large">
      <div className="flex flex-col gap-5 pt-3 -mx-[var(--gutter)]">
        <div className="px-[var(--gutter)] flex flex-col items-center text-center">
          <ArcRing progress={target > 0 ? total / target : 0} size={168} stroke={10} color={total > 0 ? "var(--water)" : "transparent"} color2={total > 0 ? "var(--accent-2)" : "transparent"} label={`Water, ${fmtInt(toDisplayWater(total, units))} of ${fmtInt(toDisplayWater(target, units))} ${unit}`}>
            {target > 0 && left === 0 ? <GoalCheck size={20} className="mb-1" /> : <Icon name="drop" size={18} strokeWidth={1.8} className="text-water mb-1" />}
            <span className="num text-[40px] leading-[42px] text-primary" data-testid="water-total">{fmtInt(toDisplayWater(total, units))}</span>
            <span className="text-[12px] text-tertiary">{unit}</span>
          </ArcRing>
          <p className="text-[13px] text-secondary tabular mt-2">{target > 0 ? (left > 0 ? `${fmtInt(toDisplayWater(left, units))} ${unit} left of ${fmtInt(toDisplayWater(target, units))}` : "Target reached") : "No target set"}</p>
        </div>
        <div className="px-[var(--gutter)]">
          <Stepper value={amount} onChange={setAmount} step={WATER_STEP[units]} min={WATER_STEP[units]} max={units === "imperial" ? 170 : 5000} unit={unit} size="lg" label="Amount" />
          <div className="flex gap-2 justify-center mt-4">
            {chips.map((c) => (
              <TapChip key={c} selected={amount === c} onSelect={() => setAmount(c)}>
                {c} {unit}
              </TapChip>
            ))}
          </div>
          {error && <p className="text-footnote text-danger-text text-center mt-3">{error}</p>}
          <Button variant="primary" size="lg" full className="mt-5" loading={add.isPending} onClick={() => void log()} data-testid="log-water">
            Log Water
          </Button>
        </div>
        <div>
          <SectionHeader title="Today" />
          {water.isPending ? (
            <Skeleton rows={2} />
          ) : water.isError ? (
            <InlineError onRetry={() => void water.refetch()}>Unable to load water logs.</InlineError>
          ) : water.data && water.data.logs.length ? (
            <WellGroup>
              {water.data.logs.map((l) => (
                <Row
                  key={l.id}
                  title={<span className="tabular">{`${fmtInt(toDisplayWater(l.ml, units))} ${unit}`}</span>}
                  trailing={
                    <>
                      <span>{fmtTime(l.loggedAt, hour12)}</span>
                      <IconButton label="Delete log" className="-mr-2 text-tertiary" onClick={() => del.mutate(l.id)}>
                        <Icon name="trash" size={18} />
                      </IconButton>
                    </>
                  }
                />
              ))}
            </WellGroup>
          ) : (
            <p className="text-[15px] text-secondary text-center px-[var(--gutter)] py-4">No water logged today.</p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
