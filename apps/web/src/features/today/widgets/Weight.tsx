import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { WeightLog } from "@aravos/shared";
import { useAppSettings, useDaySummary, useSettings } from "@/data/queries";
import { api, ApiError } from "@/lib/api";
import { fmt1, fmtRelativeDate, toDisplayWeight } from "@/lib/format";
import { Sparkline, StatusPill, Trend } from "@/ui/viz";
import type { WidgetOf, WidgetProps } from "../types";
import { Hero, Pressable, Sub, WidgetEmpty, WidgetError, WidgetLabel, WidgetSkeleton } from "./shared";

interface WeightSummary {
  logs: WeightLog[];
  latest: WeightLog | null;
  change7d: number | null;
  change30d: number | null;
}

const useWeight = (limit: number) =>
  useQuery({
    queryKey: ["weight", limit],
    queryFn: () => api.get<WeightSummary>(`/api/weight?limit=${limit}`).catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }),
    staleTime: 60_000,
  });

/** Latest weight, the 7-day change as a trend badge, and the recent logs as a sparkline. */
export function WeightTrendWidget({ widget }: WidgetProps<WidgetOf<"weight_trend">>) {
  const navigate = useNavigate();
  const settings = useAppSettings();
  const profile = useSettings().data?.healthProfile;
  const summary = useDaySummary();
  const weight = useWeight(Math.min(365, Math.max(30, widget.days)));

  const latestKg = weight.data?.latest?.weightKg ?? summary.data?.weight?.latestKg ?? null;
  const latestDate = weight.data?.latest?.date ?? summary.data?.weight?.date ?? null;
  const logs = weight.data?.logs ?? [];
  const delta7 = (() => {
    if (weight.data?.change7d != null) return weight.data.change7d;
    if (logs.length < 2 || !latestDate) return null;
    const cutoff = new Date(latestDate + "T00:00:00").getTime() - 7 * 86_400_000;
    const earlier = logs.find((l) => new Date(l.date + "T00:00:00").getTime() <= cutoff);
    return earlier && latestKg != null ? latestKg - earlier.weightKg : null;
  })();

  const units = settings.units;
  const unit = units === "imperial" ? "lb" : "kg";
  const goal = profile?.goal ?? "maintain";
  const good = delta7 == null || Math.abs(delta7) < 0.05 ? null : goal === "lose" ? delta7 < 0 : goal === "gain" ? delta7 > 0 : null;
  const loading = summary.isPending && weight.isPending;

  // Logs arrive newest first; the line reads left to right, oldest to newest.
  const cutoff = latestDate ? new Date(latestDate + "T00:00:00").getTime() - widget.days * 86_400_000 : 0;
  const line = logs.filter((l) => new Date(l.date + "T00:00:00").getTime() >= cutoff).map((l) => toDisplayWeight(l.weightKg, units)).reverse();
  const deltaText = delta7 == null ? "" : `${delta7 > 0 ? "+" : delta7 < 0 ? "-" : ""}${fmt1(toDisplayWeight(Math.abs(delta7), units))}`;

  return (
    <Pressable label="Open weight" onPress={() => navigate("/health")}>
      <WidgetLabel trailing={latestDate ? fmtRelativeDate(latestDate) : undefined}>{widget.title ?? "Weight"}</WidgetLabel>
      {loading ? (
        <WidgetSkeleton hero lines={1} />
      ) : summary.isError && weight.isError ? (
        <WidgetError onRetry={() => { void summary.refetch(); void weight.refetch(); }} />
      ) : latestKg == null ? (
        <WidgetEmpty action="Log Weight" onAction={() => navigate("/health?weight=1")}>No weight logged.</WidgetEmpty>
      ) : (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <Hero value={fmt1(toDisplayWeight(latestKg, units))} unit={unit} />
            {delta7 != null && (good == null ? <StatusPill>{deltaText}</StatusPill> : <Trend value={deltaText} up={delta7 > 0} good={good} />)}
          </div>
          <Sub>{delta7 != null ? `${unit} change over 7 days` : "Not enough logs for a trend"}</Sub>
          {line.length > 1 && (
            <div className="mt-auto pt-3">
              <Sparkline values={line} height={40} />
            </div>
          )}
        </>
      )}
    </Pressable>
  );
}
