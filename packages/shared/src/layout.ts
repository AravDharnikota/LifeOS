import type { LayoutSpec } from "./schemas.ts";

export const DEFAULT_TODAY_LAYOUT: LayoutSpec = {
  sections: [
    {
      id: "top",
      widgets: [
        { id: "agenda", type: "agenda", size: "l", hours: 12 },
        { id: "tasks", type: "tasks", size: "l", filter: "today", limit: 8 },
      ],
    },
    {
      id: "health",
      title: "Health",
      widgets: [
        { id: "rings", type: "nutrition_rings", size: "m" },
        { id: "water", type: "water", size: "s" },
        { id: "streak", type: "workout_streak", size: "s" },
      ],
    },
    {
      id: "goals",
      title: "Goals",
      widgets: [{ id: "goals", type: "goals_overview", size: "l", limit: 5 }],
    },
  ],
};

export const WIDGET_CATALOG: Record<string, { label: string; description: string }> = {
  agenda: { label: "Agenda", description: "Upcoming events and time boxes for today." },
  tasks: { label: "Tasks", description: "A task list (today, overdue, upcoming, or a specific list)." },
  nutrition_rings: { label: "Nutrition", description: "Calories and macro progress toward daily targets." },
  water: { label: "Water", description: "Water logged today with a one-tap add." },
  workout_streak: { label: "Workouts", description: "Workouts this week versus target and last session." },
  weight_trend: { label: "Weight", description: "Latest weight and the change over the period." },
  goal: { label: "Goal", description: "A single goal with its progress." },
  goals_overview: { label: "Goals overview", description: "Several active goals with progress bars." },
  tracker: { label: "Tracker", description: "A number you tap to count, like cups of coffee." },
  habit_grid: { label: "Habit grid", description: "A week-by-week grid of habit completions." },
  note: { label: "Note", description: "Freeform text pinned to the dashboard." },
  quick_actions: { label: "Quick actions", description: "Buttons for logging a meal, starting a workout, etc." },
  stat: { label: "Stat", description: "One number: calories today, open tasks, latest weight, and so on." },
  countdown: { label: "Countdown", description: "Days until a date." },
  recent_prs: { label: "Recent PRs", description: "Latest personal records in the gym." },
};
