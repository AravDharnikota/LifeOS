import { useNavigate } from "react-router";
import type { PersonalRecord } from "@aravos/shared";
import { useAppSettings } from "@/data/queries";
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

/** Latest personal records in the gym. */
export function RecentPrsWidget({ widget }: WidgetProps<WidgetOf<"recent_prs">>) {
  const navigate = useNavigate();
  const settings = useAppSettings();
  const stats = useWorkoutStats();
  const prs = (stats.data?.recentPrs ?? []).slice(0, widget.limit);
  return (
    <Pressable label="Open workouts" onPress={() => navigate("/health/workouts")}>
      <WidgetLabel>{widget.title ?? "Records"}</WidgetLabel>
      {stats.isPending ? (
        <WidgetSkeleton lines={3} />
      ) : stats.isError ? (
        <WidgetError onRetry={() => void stats.refetch()} />
      ) : prs.length === 0 ? (
        <WidgetEmpty action="Start Workout" onAction={() => navigate("/health/workouts")}>No records yet.</WidgetEmpty>
      ) : (
        <ul className="flex flex-col divide-y divide-separator -my-1">
          {prs.map((pr) => (
            <li key={pr.id} className="py-2 first:pt-0 last:pb-0 flex items-baseline justify-between gap-3 min-h-[36px]">
              <span className="text-subhead text-primary truncate">{pr.exerciseName ?? "Exercise"}</span>
              <span className="text-footnote tabular text-secondary shrink-0">
                {describe(pr, settings.units)}
                <span className="text-tertiary"> {fmtRelativeDate(pr.achievedAt.slice(0, 10))}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Pressable>
  );
}
