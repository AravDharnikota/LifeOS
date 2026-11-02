import type { Widget } from "@aravos/shared";
import type { WidgetProps } from "../types";
import { AgendaWidget } from "./Agenda";
import { TasksWidget } from "./Tasks";
import { NutritionWidget } from "./Nutrition";
import { WaterWidget } from "./Water";
import { WorkoutStreakWidget } from "./Workouts";
import { WeightTrendWidget } from "./Weight";
import { GoalWidget, GoalsOverviewWidget, HabitGridWidget } from "./Goals";
import { TrackerWidget } from "./Tracker";
import { NoteWidget } from "./Note";
import { QuickActionsWidget } from "./QuickActions";
import { StatWidget } from "./Stat";
import { CountdownWidget } from "./Countdown";
import { RecentPrsWidget } from "./RecentPrs";

/** Every type in the shared Widget union renders here. Adding a type without a branch is a compile error. */
export function renderWidget(props: WidgetProps): React.ReactElement {
  const { widget } = props;
  switch (widget.type) {
    case "agenda": return <AgendaWidget {...props} widget={widget} />;
    case "tasks": return <TasksWidget {...props} widget={widget} />;
    case "nutrition_rings": return <NutritionWidget {...props} widget={widget} />;
    case "water": return <WaterWidget {...props} widget={widget} />;
    case "workout_streak": return <WorkoutStreakWidget {...props} widget={widget} />;
    case "weight_trend": return <WeightTrendWidget {...props} widget={widget} />;
    case "goal": return <GoalWidget {...props} widget={widget} />;
    case "goals_overview": return <GoalsOverviewWidget {...props} widget={widget} />;
    case "tracker": return <TrackerWidget {...props} widget={widget} />;
    case "habit_grid": return <HabitGridWidget {...props} widget={widget} />;
    case "note": return <NoteWidget {...props} widget={widget} />;
    case "quick_actions": return <QuickActionsWidget {...props} widget={widget} />;
    case "stat": return <StatWidget {...props} widget={widget} />;
    case "countdown": return <CountdownWidget {...props} widget={widget} />;
    case "recent_prs": return <RecentPrsWidget {...props} widget={widget} />;
    default: {
      const never: never = widget;
      return <>{String(never)}</>;
    }
  }
}

export type { Widget };
