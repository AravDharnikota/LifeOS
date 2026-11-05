import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addDaysString, todayString } from "@aravos/shared";
import { useAppSettings, useDaySummary } from "@/data/queries";
import { useRange } from "@/features/nutrition/api";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtInt } from "@/lib/format";
import { notify, selection } from "@/lib/haptics";
import type { WidgetOf, WidgetProps } from "../types";
import { TickBars } from "@/ui/viz";
import { chipClass, Hero, Sub, WidgetError, WidgetLabel, WidgetSkeleton, WriteError } from "./shared";

const DAYS = 14;

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

/** Water today versus target, the last two weeks as tick bars, and two one-tap chips. */
export function WaterWidget({ widget, editing }: WidgetProps<WidgetOf<"water">>) {
  const qc = useQueryClient();
  const settings = useAppSettings();
  const summary = useDaySummary();
  const today = todayString();
  const range = useRange(addDaysString(today, -(DAYS - 1)), today);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<number | null>(null);

  const server = summary.data?.water.ml ?? 0;
  const target = summary.data?.water.target ?? 0;
  const ml = server + pending;

  // As the server catches up, retire only the part of the optimistic delta it now reflects.
  const lastServer = useRef(server);
  useEffect(() => {
    const change = server - lastServer.current;
    lastServer.current = server;
    if (change) setPending((p) => Math.max(0, p - change));
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

  // History from the range endpoint; today's bar follows the live (optimistic) total.
  const series = Array.from({ length: DAYS }, (_, i) => {
    const date = addDaysString(today, i - (DAYS - 1));
    if (date === today) return ml;
    return range.data?.find((r) => r.date === date)?.waterMl ?? 0;
  });
  const pct = target > 0 ? Math.min(999, Math.round((ml / target) * 100)) : null;

  return (
    <>
      <WidgetLabel trailing={pct != null && !summary.isPending ? `${pct}%` : undefined}>{widget.title ?? "Water"}</WidgetLabel>
      {summary.isPending ? (
        <WidgetSkeleton hero lines={1} />
      ) : summary.isError ? (
        <WidgetError onRetry={() => void summary.refetch()} />
      ) : (
        <>
          <Hero value={show(ml)} unit={unit} pending={pending !== 0} />
          <Sub>{target > 0 ? (left > 0 ? `${show(left)} ${unit} left` : "Target reached") : "No target set"}</Sub>
          <TickBars values={series} color="var(--water)" height={28} gap={3} className="mt-3 justify-between" />
          <div className="mt-auto pt-3 flex gap-2">
            {CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Add ${c} millilitres`}
                onClick={() => void add(c)}
                disabled={editing}
                className={cn(chipClass, "flex-1 px-1")}
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
