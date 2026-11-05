import { useNavigate } from "react-router";
import type { PersonalRecord } from "@aravos/shared";
import { useAppSettings } from "@/data/queries";
import { cn } from "@/lib/cn";
import { fmt1, fmtClock, fmtRelativeDate, toDisplayWeight } from "@/lib/format";
import type { WidgetOf, WidgetProps } from "../types";
import { Pressable, WidgetEmpty, WidgetError, WidgetLabel, WidgetSkeleton } from "./shared";
import { useWorkoutStats } from "./Workouts";

function describe(pr: PersonalRecord, units: "metric" | "imperial"): string {
  const unit = units === "imperial" ? "lb" : "kg";
  const w = pr.weight != null ? `${fmt1(toDisplayWeight(pr.weight, units))} ${unit}` : null;
  switch (pr.type) {
    case "weight": return w ? `${w}${pr.reps ? ` x ${pr.reps}` : ""}` : fmt1(pr.value);
    case "one_rm": return `${fmt1(toDisplayWeight(pr.value, units))} ${unit} 1RM`;
    case "volume": return `${fmt1(toDisplayWeight(pr.value, units))} ${unit} volume`;
    case "reps": return `${pr.reps ?? pr.value} reps${w ? ` at ${w}` : ""}`;
    case "distance": return `${fmt1(pr.value)} km`;
    case "duration": return fmtClock(pr.value);
  }
}

/** Latest personal records in the gym, as rows in a white well. */
export function RecentPrsWidget({ widget }: WidgetProps<WidgetOf<"recent_prs">>) {
  const navigate = useNavigate();
  const settings = useAppSettings();
  const stats = useWorkoutStats();
  const prs = (stats.data?.recentPrs ?? []).slice(0, widget.limit);
  return (
    <Pressable label="Open workouts" onPress={() => navigate("/health/workouts")}>
      <WidgetLabel icon="trophy" sub={stats.data ? `${stats.data.totalWorkouts} workouts logged` : undefined}>{widget.title ?? "Records"}</WidgetLabel>
      {stats.isPending ? (
        <WidgetSkeleton lines={3} />
      ) : stats.isError ? (
        <WidgetError onRetry={() => void stats.refetch()} />
      ) : prs.length === 0 ? (
        <WidgetEmpty action="Start Workout" onAction={() => navigate("/health/workouts")}>No records yet.</WidgetEmpty>
      ) : (
        <ul className="well rounded-md overflow-hidden flex flex-col">
          {prs.map((pr, i) => (
            <li key={pr.id} className={cn("px-3 py-2 flex items-center justify-between gap-3 min-h-[44px]", i > 0 && "hairline-t")}>
              <div className="min-w-0">
                <div className="text-[14px] leading-5 text-primary truncate">{pr.exerciseName ?? "Exercise"}</div>
                <div className="text-[12px] leading-4 text-tertiary">{fmtRelativeDate(pr.achievedAt.slice(0, 10))}</div>
              </div>
              <span className="text-[13px] tabular text-secondary shrink-0">{describe(pr, settings.units)}</span>
            </li>
          ))}
        </ul>
      )}
    </Pressable>
  );
}
