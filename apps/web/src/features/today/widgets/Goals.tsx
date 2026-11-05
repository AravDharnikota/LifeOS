import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useIsDesktop } from "@/lib/hooks";
import type { Goal } from "@aravos/shared";
import { keys, useDaySummary, useGoals } from "@/data/queries";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmt1, fmtInt, fmtRelativeDate } from "@/lib/format";
import { BigNumber, Gauge, StatusPill, ThinBar } from "@/ui/viz";
import { colorVar, type WidgetOf, type WidgetProps } from "../types";
import { chipClass, Pressable, Sub, WidgetEmpty, WidgetError, WidgetLabel, WidgetSkeleton } from "./shared";

export const useGoal = (id: string, enabled = true) => useQuery({ queryKey: keys.goal(id), queryFn: () => api.get<Goal>(`/api/goals/${id}`), enabled, staleTime: 30_000 });

const num = (v: number) => (Number.isInteger(v) ? fmtInt(v) : fmt1(v));

function goalValue(g: Goal): { current: string; target: string | null; unit: string | null } {
  if (g.kind === "habit") {
    const per = g.timesPerPeriod ?? 1;
    return { current: num(g.periodCount ?? 0), target: num(per), unit: g.cadence === "weekly" ? "this week" : "today" };
  }
  if (g.kind === "milestone") {
    const done = g.milestones?.filter((m) => m.done).length ?? Math.round((g.progress ?? 0) * (g.milestones?.length ?? 0));
    return { current: num(done), target: g.milestones ? num(g.milestones.length) : null, unit: "milestones" };
  }
  if (g.kind === "boolean") return { current: g.status === "done" ? "Done" : "Open", target: null, unit: null };
  return { current: num(g.currentValue ?? g.startValue ?? 0), target: g.targetValue != null ? num(g.targetValue) : null, unit: g.unit };
}

/** A single goal: title, progress bar in the goal's color, current against target. */
export function GoalWidget({ widget }: WidgetProps<WidgetOf<"goal">>) {
  const navigate = useNavigate();
  const summary = useDaySummary();
  const fromSummary = summary.data?.goals.find((g) => g.id === widget.goalId);
  const detail = useGoal(widget.goalId, !fromSummary && summary.isSuccess);
  const goal = fromSummary ?? detail.data;
  const pending = summary.isPending || (!fromSummary && detail.isPending && summary.isSuccess);
  const missing = summary.isSuccess && !fromSummary && detail.isError;

  return (
    <Pressable label="Open goal" onPress={() => navigate(goal ? `/goals/${goal.id}` : "/goals")}>
      <WidgetLabel>{widget.title ?? goal?.title ?? "Goal"}</WidgetLabel>
      {pending ? (
        <WidgetSkeleton hero lines={1} />
      ) : missing ? (
        <WidgetEmpty action="Open Goals" onAction={() => navigate("/goals")}>This goal is gone.</WidgetEmpty>
      ) : summary.isError && !goal ? (
        <WidgetError onRetry={() => void summary.refetch()} />
      ) : goal ? (
        <GoalBody goal={goal} />
      ) : null}
    </Pressable>
  );
}

function GoalBody({ goal }: { goal: Goal }) {
  const v = goalValue(goal);
  const color = goal.color ? colorVar(goal.color) : "var(--accent)";
  const p = goal.progress ?? 0;
  return (
    <>
      <div className="flex justify-center">
        <Gauge value={p} size={124} stroke={10} colors={[color]} label={`${Math.round(p * 100)}% complete`}>
          <BigNumber value={Math.round(p * 100)} unit="%" size={26} />
        </Gauge>
      </div>
      <Sub className="mt-auto pt-1 flex justify-between gap-2">
        <span className="truncate">{v.target ? `${v.current} of ${v.target}${v.unit ? ` ${v.unit}` : ""}` : `${v.current}${v.unit ? ` ${v.unit}` : ""}`}</span>
        {goal.deadline && <span className="tabular shrink-0">{fmtRelativeDate(goal.deadline)}</span>}
        {!goal.deadline && goal.kind === "habit" && goal.streak != null && goal.streak > 0 && <span className="tabular shrink-0">{goal.streak} day streak</span>}
      </Sub>
    </>
  );
}

/** Active goals as rows in a white well: title, value, a thin bar in the goal's color, a Complete pill when done. */
export function GoalsOverviewWidget({ widget, sectionTitle }: WidgetProps<WidgetOf<"goals_overview">>) {
  const navigate = useNavigate();
  const goals = useGoals("active");
  const list = (goals.data ?? []).filter((g) => !widget.area || g.area === widget.area).slice(0, widget.limit);
  const label = widget.title ?? "Goals";

  return (
    <Pressable label="Open goals" onPress={() => navigate("/goals")}>
      {label !== sectionTitle && <WidgetLabel icon="target" sub={goals.data ? `${list.length} active` : undefined}>{label}</WidgetLabel>}
      {goals.isPending ? (
        <WidgetSkeleton lines={3} />
      ) : goals.isError ? (
        <WidgetError onRetry={() => void goals.refetch()} />
      ) : list.length === 0 ? (
        <WidgetEmpty action="Add Goal" onAction={() => navigate("/goals?new=1")}>No active goals.</WidgetEmpty>
      ) : (
        <ul className="well rounded-md overflow-hidden flex flex-col">
          {list.map((g, i) => {
            const v = goalValue(g);
            const color = g.color ? colorVar(g.color) : "var(--accent)";
            const complete = (g.progress ?? 0) >= 1 || g.status === "done";
            return (
              <li key={g.id} className={cn("px-3 py-3 flex flex-col gap-2", i > 0 && "hairline-t")}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px] leading-5 text-primary truncate">{g.title}</span>
                  {complete ? (
                    <StatusPill tone="success">Complete</StatusPill>
                  ) : (
                    <span className="text-[12px] tabular text-secondary shrink-0">
                      {v.current}
                      {v.target && <span className="text-tertiary"> / {v.target}</span>}
                      {v.unit && g.kind === "number" && <span className="text-tertiary"> {v.unit}</span>}
                    </span>
                  )}
                </div>
                <ThinBar progress={g.progress ?? 0} color={color} height={4} />
              </li>
            );
          })}
        </ul>
      )}
    </Pressable>
  );
}

/** Weeks by seven dots. Today's cell toggles a habit check-in. */
export function HabitGridWidget({ widget, editing }: WidgetProps<WidgetOf<"habit_grid">>) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const goal = useGoal(widget.goalId);
  const g = goal.data;
  const weeks = widget.weeks;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = localDate(today);
  const done = new Set((g?.recentEntries ?? []).map((e) => e.date));
  // Columns are weeks (oldest first), rows are weekdays starting on the first day of the latest week.
  const dow = (today.getDay() + 6) % 7; // Monday = 0
  const start = new Date(today);
  start.setDate(today.getDate() - dow - (weeks - 1) * 7);
  const cells: { date: string; future: boolean }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({ date: localDate(d), future: d > today });
  }
  const doneToday = done.has(todayStr);

  const toggle = async () => {
    if (!g || editing) return;
    const prev = qc.getQueryData<Goal>(keys.goal(widget.goalId));
    if (prev) {
      const entries = doneToday ? (prev.recentEntries ?? []).filter((e) => e.date !== todayStr) : [{ id: "tmp", goalId: prev.id, date: todayStr, value: 1, note: null, createdAt: new Date().toISOString() }, ...(prev.recentEntries ?? [])];
      qc.setQueryData<Goal>(keys.goal(widget.goalId), { ...prev, recentEntries: entries });
    }
    try {
      await api.post(`/api/goals/${widget.goalId}/log`, { date: todayStr });
    } catch {
      if (prev) qc.setQueryData(keys.goal(widget.goalId), prev);
    } finally {
      void qc.invalidateQueries({ queryKey: ["goal"] });
      void qc.invalidateQueries({ queryKey: ["goals"] });
      void qc.invalidateQueries({ queryKey: ["summary"] });
    }
  };

  const count = cells.filter((c) => done.has(c.date)).length;
  return (
    <Pressable label="Open goal" onPress={() => navigate(`/goals/${widget.goalId}`)}>
      <WidgetLabel trailing={g && isDesktop ? `${count} in ${weeks} weeks` : undefined}>{widget.title ?? g?.title ?? "Habit"}</WidgetLabel>
      {goal.isPending ? (
        <WidgetSkeleton lines={3} />
      ) : goal.isError ? (
        <WidgetError onRetry={() => void goal.refetch()}>{"This habit is gone."}</WidgetError>
      ) : (
        <>
          {/* Phone: seven columns (one row per week). Desktop: one column per week, cells capped at 16px. */}
          <div
            className="grid gap-1 content-start"
            style={isDesktop ? { gridTemplateColumns: `repeat(${weeks}, 16px)`, gridTemplateRows: "repeat(7, 16px)", gridAutoFlow: "column" } : { gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gridAutoFlow: "row" }}
            role="img"
            aria-label={`${count} check-ins in the last ${weeks} weeks`}
          >
            {cells.map((c) => {
              const isToday = c.date === todayStr;
              const on = done.has(c.date);
              if (isToday) {
                return (
                  <button
                    key={c.date}
                    type="button"
                    aria-label={on ? "Undo today" : "Check in today"}
                    aria-pressed={on}
                    disabled={editing}
                    onClick={() => void toggle()}
                    className={cn("pointer-events-auto relative aspect-square rounded-[4px] transition-colors duration-150", on ? "bg-success" : "bg-pressed")}
                  >
                    <span className="absolute -inset-2" />
                    {!on && <span className="absolute inset-0 rounded-[4px] border border-dashed border-border-focus" />}
                  </button>
                );
              }
              return <span key={c.date} className={cn("aspect-square rounded-[4px]", on ? "bg-success" : c.future ? "bg-transparent" : "bg-pressed")} />;
            })}
          </div>
          <div className="mt-auto pt-3 flex items-center justify-between gap-2">
            <Sub className="mt-0">{g?.streak ? `${g.streak} day streak` : "No streak yet"}</Sub>
            <button type="button" disabled={editing} onClick={() => void toggle()} className={cn(chipClass, "shrink-0", doneToday && "text-secondary")}>
              {doneToday ? "Done Today" : "Check In"}
            </button>
          </div>
        </>
      )}
    </Pressable>
  );
}

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
