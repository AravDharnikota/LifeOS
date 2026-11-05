import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { parseISO } from "date-fns";
import type { WorkoutStats } from "@aravos/shared";
import { useDaySummary } from "@/data/queries";
import { api } from "@/lib/api";
import { fmtRelativeDate } from "@/lib/format";
import { Button } from "@/ui/Button";
import { CapsuleBars, Trend } from "@/ui/viz";
import type { WidgetOf, WidgetProps } from "../types";
import { Hero, Sub, WidgetError, WidgetLabel, WidgetSkeleton } from "./shared";

export const useWorkoutStats = (enabled = true) => useQuery({ queryKey: ["workouts", "stats"], queryFn: () => api.get<WorkoutStats>("/api/workouts/stats"), enabled, staleTime: 60_000 });

const WEEKS = 6;

/** Workouts this week against target with a trend versus last week, six weeks as capsule bars, and a Start button. */
export function WorkoutStreakWidget({ widget, editing }: WidgetProps<WidgetOf<"workout_streak">>) {
  const navigate = useNavigate();
  const summary = useDaySummary();
  const stats = useWorkoutStats();
  const count = summary.data?.workouts.thisWeekCount ?? stats.data?.thisWeek ?? 0;
  const target = summary.data?.workouts.weeklyTarget ?? stats.data?.weeklyTarget ?? 0;
  const last = stats.data?.last ?? null;
  const lastWeek = stats.data?.lastWeek;
  const diff = lastWeek != null ? count - lastWeek : 0;
  // Oldest first; this week's bar follows the live count from the summary.
  const weeks = (stats.data?.volumeByWeek ?? []).slice(-WEEKS).map((w) => w.count);
  while (weeks.length < WEEKS) weeks.unshift(0);
  weeks[WEEKS - 1] = count;
  const max = Math.max(target, ...weeks, 1);

  return (
    <>
      <WidgetLabel trailing="This week">{widget.title ?? "Workouts"}</WidgetLabel>
      {summary.isPending ? (
        <WidgetSkeleton hero lines={1} />
      ) : summary.isError ? (
        <WidgetError onRetry={() => void summary.refetch()} />
      ) : (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <Hero value={count} unit={target > 0 ? `of ${target}` : undefined} />
            {lastWeek != null && diff !== 0 && <Trend value={Math.abs(diff)} up={diff > 0} />}
          </div>
          <Sub className="truncate">{last ? `${last.name}, ${fmtRelativeDate(parseISO(last.finishedAt)).toLowerCase()}` : stats.isPending ? "\u00a0" : "No workouts yet."}</Sub>
          <div role="img" aria-label={`${count} of ${target} workouts this week`} className="mt-3">
            <CapsuleBars values={weeks} max={max} height={40} color="var(--activity)" activeIndex={WEEKS - 1} />
          </div>
          <div className="mt-auto pt-3">
            <Button variant="secondary" size="sm" full disabled={editing} onClick={() => navigate("/health/workouts")}>
              Start Workout
            </Button>
          </div>
        </>
      )}
    </>
  );
}
