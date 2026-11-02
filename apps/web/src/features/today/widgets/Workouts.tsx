import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { parseISO } from "date-fns";
import type { WorkoutStats } from "@aravos/shared";
import { useDaySummary } from "@/data/queries";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtRelativeDate } from "@/lib/format";
import { Button } from "@/ui/Button";
import type { WidgetOf, WidgetProps } from "../types";
import { Hero, Sub, WidgetError, WidgetLabel, WidgetSkeleton } from "./shared";

export const useWorkoutStats = (enabled = true) => useQuery({ queryKey: ["workouts", "stats"], queryFn: () => api.get<WorkoutStats>("/api/workouts/stats"), enabled, staleTime: 60_000 });

/** Workouts this week as a row of circles, the last session, and a Start button. */
export function WorkoutStreakWidget({ widget, editing }: WidgetProps<WidgetOf<"workout_streak">>) {
  const navigate = useNavigate();
  const summary = useDaySummary();
  const stats = useWorkoutStats();
  const count = summary.data?.workouts.thisWeekCount ?? stats.data?.thisWeek ?? 0;
  const target = summary.data?.workouts.weeklyTarget ?? stats.data?.weeklyTarget ?? 0;
  const dots = Math.max(target, count, 1);
  const last = stats.data?.last ?? null;

  return (
    <>
      <WidgetLabel>{widget.title ?? "Workouts"}</WidgetLabel>
      {summary.isPending ? (
        <WidgetSkeleton hero lines={1} />
      ) : summary.isError ? (
        <WidgetError onRetry={() => void summary.refetch()} />
      ) : (
        <>
          <Hero value={count} unit={target > 0 ? `of ${target} this week` : "this week"} />
          <div className="flex gap-1.5 mt-2" role="img" aria-label={`${count} of ${target} workouts this week`}>
            {Array.from({ length: Math.min(dots, 14) }).map((_, i) => (
              <span key={i} className={cn("w-2.5 h-2.5 rounded-full", i < count ? "bg-activity" : "bg-surface-2")} />
            ))}
          </div>
          <Sub className="truncate mt-2">{last ? `${last.name}, ${fmtRelativeDate(parseISO(last.finishedAt)).toLowerCase()}` : stats.isPending ? "" : "No workouts yet."}</Sub>
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
