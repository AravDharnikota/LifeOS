import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { todayString } from "@aravos/shared";
import { useAppSettings, useDaySummary } from "@/data/queries";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtInt } from "@/lib/format";
import { notify, selection } from "@/lib/haptics";
import type { WidgetOf, WidgetProps } from "../types";
import { Hero, Sub, WidgetError, WidgetLabel, WidgetSkeleton, WriteError } from "./shared";

const CHIPS = [250, 500];
const CELEBRATED = "aravos.water.celebrated";

function celebratedToday(): boolean {
  try {
    return localStorage.getItem(CELEBRATED) === todayString();
  } catch {
    return false;
  }
}
function markCelebrated(): void {
  try {
    localStorage.setItem(CELEBRATED, todayString());
  } catch {
    /* ignore */
  }
}

/** Water today versus target, plus two one-tap chips. */
export function WaterWidget({ widget, editing }: WidgetProps<WidgetOf<"water">>) {
  const qc = useQueryClient();
  const settings = useAppSettings();
  const summary = useDaySummary();
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<number | null>(null);

  const server = summary.data?.water.ml ?? 0;
  const target = summary.data?.water.target ?? 0;
  const ml = server + pending;

  useEffect(() => {
    // Once the server catches up, drop the optimistic delta.
    setPending(0);
  }, [server]);

  const add = async (amount: number) => {
    if (editing) return;
    void selection();
    setError(null);
    const before = ml;
    setPending((p) => p + amount);
    try {
      await api.post("/api/water", { ml: amount });
      if (target > 0 && before < target && before + amount >= target && !celebratedToday()) {
        markCelebrated();
        void notify("success");
      }
      void qc.invalidateQueries({ queryKey: ["summary"] });
      void qc.invalidateQueries({ queryKey: ["water"] });
    } catch {
      setPending((p) => p - amount);
      setError(amount);
    }
  };

  const imperial = settings.units === "imperial";
  const show = (v: number) => (imperial ? fmtInt(v / 29.5735) : fmtInt(v));
  const unit = imperial ? "oz" : "ml";
  const left = Math.max(0, target - ml);

  return (
    <>
      <WidgetLabel>{widget.title ?? "Water"}</WidgetLabel>
      {summary.isPending ? (
        <WidgetSkeleton hero lines={1} />
      ) : summary.isError ? (
        <WidgetError onRetry={() => void summary.refetch()} />
      ) : (
        <>
          <Hero value={show(ml)} unit={unit} pending={pending !== 0} />
          <Sub>{target > 0 ? (left > 0 ? `${show(left)} ${unit} left` : "Target reached") : `No target set`}</Sub>
          <div className="mt-auto pt-3 flex gap-2">
            {CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Add ${c} millilitres`}
                onClick={() => void add(c)}
                disabled={editing}
                className={cn("h-9 flex-1 rounded-sm bg-surface-2 text-footnote font-medium text-primary tabular active:bg-pressed pressable", editing && "opacity-40")}
              >
                +{imperial ? `${show(c)} ${unit}` : `${c} ${unit}`}
              </button>
            ))}
          </div>
          {error != null && <WriteError message="Unable to log water." onRetry={() => void add(error)} />}
        </>
      )}
    </>
  );
}
