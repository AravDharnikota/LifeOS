import { useNavigate } from "react-router";
import { useAppSettings, useDaySummary, type DaySummary } from "@/data/queries";
import { fmt1, fmtInt, toDisplayWeight } from "@/lib/format";
import type { WidgetOf, WidgetProps } from "../types";
import { Hero, Pressable, Sub, WidgetError, WidgetLabel, WidgetSkeleton } from "./shared";

type Metric = WidgetOf<"stat">["metric"];
export const STAT_LABELS: Record<Metric, string> = {
  calories_today: "Calories",
  protein_today: "Protein",
  water_today: "Water",
  tasks_done_today: "Tasks done",
  workouts_this_week: "Workouts",
  weight_latest: "Weight",
  open_tasks: "Open tasks",
  events_today: "Events",
};

function read(metric: Metric, s: DaySummary, units: "metric" | "imperial"): { value: string; unit?: string; sub?: string; to: string } {
  switch (metric) {
    case "calories_today": return { value: fmtInt(s.nutrition.totals.calories), unit: "kcal", sub: `${fmtInt(Math.max(0, s.nutrition.remaining.calories))} left`, to: "/health" };
    case "protein_today": return { value: fmtInt(s.nutrition.totals.proteinG), unit: "g", sub: `of ${fmtInt(s.nutrition.targets.proteinG)} g`, to: "/health" };
    case "water_today": return units === "imperial" ? { value: fmtInt(s.water.ml / 29.5735), unit: "oz", sub: `of ${fmtInt(s.water.target / 29.5735)} oz`, to: "/health" } : { value: fmtInt(s.water.ml), unit: "ml", sub: `of ${fmtInt(s.water.target)} ml`, to: "/health" };
    case "tasks_done_today": return { value: fmtInt(s.tasks.doneCount), sub: "today", to: "/tasks" };
    case "workouts_this_week": return { value: fmtInt(s.workouts.thisWeekCount), sub: `of ${fmtInt(s.workouts.weeklyTarget)} this week`, to: "/health/workouts" };
    case "weight_latest": return s.weight ? { value: fmt1(toDisplayWeight(s.weight.latestKg, units)), unit: units === "imperial" ? "lb" : "kg", sub: "latest", to: "/health" } : { value: "0", unit: units === "imperial" ? "lb" : "kg", sub: "No weight logged", to: "/health?weight=1" };
    case "open_tasks": return { value: fmtInt(s.tasks.openCount), sub: s.tasks.overdue.length ? `${fmtInt(s.tasks.overdue.length)} overdue` : "open", to: "/tasks" };
    case "events_today": return { value: fmtInt(s.events.filter((e) => e.status !== "cancelled").length), sub: "today", to: "/calendar" };
  }
}

/** One number with a label. Tapping opens the metric. */
export function StatWidget({ widget }: WidgetProps<WidgetOf<"stat">>) {
  const navigate = useNavigate();
  const summary = useDaySummary();
  const settings = useAppSettings();
  const r = summary.data ? read(widget.metric, summary.data, settings.units) : null;
  return (
    <Pressable label={`Open ${STAT_LABELS[widget.metric].toLowerCase()}`} onPress={() => navigate(r?.to ?? "/")}>
      <WidgetLabel>{widget.title ?? widget.label ?? STAT_LABELS[widget.metric]}</WidgetLabel>
      {summary.isPending ? (
        <WidgetSkeleton hero lines={1} />
      ) : summary.isError || !r ? (
        <WidgetError onRetry={() => void summary.refetch()} />
      ) : (
        <>
          <Hero value={r.value} unit={r.unit} />
          {r.sub && <Sub>{r.sub}</Sub>}
        </>
      )}
    </Pressable>
  );
}
