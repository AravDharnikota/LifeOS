import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Tracker } from "@aravos/shared";
import { useDaySummary, useTrackers } from "@/data/queries";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmt1, fmtInt } from "@/lib/format";
import { selection } from "@/lib/haptics";
import { Icon } from "@/ui/Icon";
import type { WidgetOf, WidgetProps } from "../types";
import { Hero, Sub, WidgetEmpty, WidgetError, WidgetLabel, WidgetSkeleton, WriteError } from "./shared";

const num = (v: number) => (Number.isInteger(v) ? fmtInt(v) : fmt1(v));

/** A counter with minus and plus. The number is the hero. */
export function TrackerWidget({ widget, editing }: WidgetProps<WidgetOf<"tracker">>) {
  const qc = useQueryClient();
  const summary = useDaySummary();
  const trackers = useTrackers();
  const tracker: Tracker | undefined = summary.data?.trackers.find((t) => t.id === widget.trackerId) ?? trackers.data?.find((t) => t.id === widget.trackerId);
  const serverValue = tracker?.todayValue ?? 0;
  const [delta, setDelta] = useState(0);
  const [error, setError] = useState<number | null>(null);
  useEffect(() => setDelta(0), [serverValue]);

  const value = serverValue + delta;
  const step = tracker?.step ?? 1;

  const log = async (d: number) => {
    if (!tracker || editing) return;
    void selection();
    setError(null);
    setDelta((p) => p + d);
    try {
      await api.post(`/api/trackers/${tracker.id}/log`, { delta: d });
      void qc.invalidateQueries({ queryKey: ["summary"] });
      void qc.invalidateQueries({ queryKey: ["trackers"] });
    } catch {
      setDelta((p) => p - d);
      setError(d);
    }
  };

  const pending = summary.isPending && trackers.isPending;
  const missing = !tracker && summary.isSuccess && trackers.isSuccess;
  const btn = "pointer-events-auto hit-44 w-11 h-11 rounded-md bg-surface-2 text-primary inline-flex items-center justify-center active:bg-pressed transition-colors duration-100 select-none disabled:opacity-40";

  return (
    <>
      <WidgetLabel>{widget.title ?? tracker?.name ?? "Tracker"}</WidgetLabel>
      {pending ? (
        <WidgetSkeleton hero lines={1} />
      ) : missing ? (
        <WidgetEmpty>This tracker is gone.</WidgetEmpty>
      ) : summary.isError && trackers.isError ? (
        <WidgetError onRetry={() => { void summary.refetch(); void trackers.refetch(); }} />
      ) : (
        <>
          <Hero value={num(value)} unit={tracker?.unit ?? undefined} pending={delta !== 0} />
          <Sub>{tracker?.target != null ? (value >= tracker.target ? "Target reached" : `${num(tracker.target - value)} to ${num(tracker.target)}`) : tracker?.reset === "daily" ? "today" : tracker?.reset === "weekly" ? "this week" : "all time"}</Sub>
          <div className="mt-auto pt-3 flex items-center gap-2">
            <button type="button" aria-label="Decrease" className={btn} disabled={editing || value - step < 0} onClick={() => void log(-step)}>
              <Icon name="minus" size={20} />
            </button>
            <button type="button" aria-label="Increase" className={cn(btn, "flex-1")} disabled={editing} onClick={() => void log(step)}>
              <Icon name="plus" size={20} />
            </button>
          </div>
          {error != null && <WriteError message="Unable to log." onRetry={() => void log(error)} />}
        </>
      )}
    </>
  );
}
