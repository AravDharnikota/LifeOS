import { useState } from "react";
import { useNavigate } from "react-router";
import type { Goal, GoalMilestone, Task } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Section, Group, Row, ValueRow } from "@/ui/List";
import { IconButton, Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Checkbox } from "@/ui/Checkbox";
import { Ring } from "@/ui/Ring";
import { Menu } from "@/ui/Menu";
import { ActionSheet } from "@/ui/Sheet";
import { Empty, Skeleton, InlineError } from "@/ui/Empty";
import { cn } from "@/lib/cn";
import { impact } from "@/lib/haptics";
import { useLongPress } from "@/lib/hooks";
import { fmtInt, fmtRelativeDate } from "@/lib/format";
import { useAppSettings } from "@/data/queries";
import { ApiError } from "@/lib/api";
import { GoalSheet } from "./GoalSheet";
import { LogSheet } from "./LogSheet";
import { HabitGrid } from "./HabitGrid";
import { goalMenuItems } from "./GoalsList";
import { useAddGoalTask, useAddMilestone, useDeleteGoal, useDeleteMilestone, useGoal, useGoalTasks, useLogGoal, useToggleTask, useUpdateGoal, useUpdateMilestone } from "./api";
import { COLOR_LABEL, KIND_LABEL, STATUS_LABEL, areaLabel, colorVar, deadlineLabel, fmtNum, habitDoneToday, milestoneCounts, periodLabel, remaining, streakLabel, withUnit } from "./model";

export function GoalDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: goal, isLoading, error, refetch } = useGoal(id);
  const log = useLogGoal();
  const update = useUpdateGoal();
  const del = useDeleteGoal();
  const [edit, setEdit] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState(false);

  if (isLoading) {
    return (
      <Screen title=" " back="/goals" compact>
        <div className="pt-4">
          <Skeleton rows={3} />
        </div>
      </Screen>
    );
  }
  if (error || !goal) {
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <Screen title="Goal" back="/goals">
        {gone ? (
          <Empty action={<Button variant="plain" onClick={() => navigate("/goals")}>Back to Goals</Button>}>Goal not found.</Empty>
        ) : (
          <InlineError onRetry={() => void refetch()}>Unable to load this goal</InlineError>
        )}
      </Screen>
    );
  }

  const dl = deadlineLabel(goal.deadline);
  const subtitle = (
    <span>
      {areaLabel(goal.area)}
      {goal.status !== "active" ? <span>, {STATUS_LABEL[goal.status].toLowerCase()}</span> : dl ? <span className={dl.overdue ? "text-danger-text" : undefined}>, {dl.text}</span> : null}
    </span>
  );

  return (
    <Screen
      title={goal.title}
      subtitle={subtitle}
      back="/goals"
      actions={
        <>
          <IconButton label="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }} data-testid="goal-more">
            <Icon name="more" size={22} />
          </IconButton>
          <button type="button" className="text-body text-accent-text px-2 h-11 active:opacity-60" onClick={() => setEdit(true)} data-testid="goal-edit">
            Edit
          </button>
        </>
      }
    >
      <div className="lg:max-w-[640px]">
        <Hero goal={goal} onToggle={() => log.mutate({ id: goal.id })} pending={log.isPending} />

        {goal.kind === "number" && (
          <Section title="Log">
            <Group>
              <Row title={<span className="text-accent-text">Log Progress</span>} onPress={() => setLogOpen(true)} data-testid="log-progress" />
            </Group>
          </Section>
        )}

        {goal.kind === "milestone" && <Milestones goal={goal} />}
        <LinkedTasks goal={goal} />
        <History goal={goal} />
        <Details goal={goal} onEdit={() => setEdit(true)} />
      </div>

      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu} items={goalMenuItems(goal, { update: (patch) => update.mutate({ id: goal.id, ...patch }), del: () => setConfirm(true) })} />
      <ActionSheet open={confirm} onClose={() => setConfirm(false)} title="Delete this goal?" message={goal.title} actions={[{ label: "Delete Goal", destructive: true, onPress: () => { del.mutate(goal.id); navigate("/goals", { replace: true }); } }]} />
      <GoalSheet open={edit} onClose={() => setEdit(false)} goal={goal} onSubmit={async (input) => { await update.mutateAsync({ id: goal.id, ...input }); setEdit(false); }} pending={update.isPending} />
      {goal.kind === "number" && <LogSheet goal={goal} open={logOpen} onClose={() => setLogOpen(false)} onLog={(input) => log.mutateAsync({ id: goal.id, ...input })} pending={log.isPending} />}
    </Screen>
  );
}

/** The one dominant element per kind: the current value, the streak, the milestone count, or the check. */
function Hero({ goal, onToggle, pending }: { goal: Goal; onToggle: () => void; pending: boolean }) {
  const color = colorVar(goal.color);
  const settings = useAppSettings();
  const progress = goal.progress ?? 0;
  const pct = Math.round(progress * 100);

  if (goal.kind === "number") {
    const cur = goal.currentValue ?? 0;
    const left = remaining(goal);
    return (
      <div className="px-[var(--gutter)] pt-4 pb-2 flex items-center gap-6" data-testid="goal-hero">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 tabular">
            <span className="num text-display-44 text-primary" data-testid="hero-value">{fmtNum(cur)}</span>
            {goal.unit && <span className="text-subhead text-secondary">{goal.unit}</span>}
          </div>
          <div className="text-footnote text-secondary tabular mt-1">
            {goal.targetValue != null ? `of ${withUnit(goal.targetValue, goal.unit)}` : "No target"}
            {goal.startValue != null && goal.targetValue != null && goal.startValue !== 0 ? `, from ${fmtNum(goal.startValue)}` : ""}
          </div>
          {left != null && <div className={cn("text-footnote tabular", left === 0 ? "text-success-text" : "text-secondary")}>{left === 0 ? "Target reached" : `${withUnit(left, goal.unit)} left`}</div>}
        </div>
        <Ring progress={progress} size={100} stroke={10} color={color} label={`${pct}% of target`}>
          <span className="num text-title-3 text-primary">{pct}%</span>
        </Ring>
      </div>
    );
  }
  if (goal.kind === "habit") {
    const s = streakLabel(goal);
    const done = habitDoneToday(goal);
    return (
      <>
        <div className="px-[var(--gutter)] pt-4 pb-2 flex items-center gap-6" data-testid="goal-hero">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 tabular">
              <span className="num text-display-44 text-primary" data-testid="hero-value">{fmtInt(s.n)}</span>
              <span className="text-subhead text-secondary">{s.unit}</span>
            </div>
            <div className="text-footnote text-secondary tabular mt-1">{periodLabel(goal)}</div>
          </div>
          <label className="flex flex-col items-center gap-1 text-footnote text-secondary">
            <Checkbox checked={done} onChange={onToggle} size={32} disabled={pending || goal.status === "paused"} tint={goal.color ? color : undefined} label="Check in today" />
            <span>Today</span>
          </label>
        </div>
        <Section title="12 weeks">
          <HabitGrid goal={goal} weekStartsOn={settings.weekStartsOn} onToggleToday={onToggle} pending={pending} />
        </Section>
      </>
    );
  }
  if (goal.kind === "milestone") {
    const { done, total } = milestoneCounts(goal);
    return (
      <div className="px-[var(--gutter)] pt-4 pb-2 flex items-center gap-6" data-testid="goal-hero">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 tabular">
            <span className="num text-display-44 text-primary" data-testid="hero-value">{fmtInt(done)}</span>
            <span className="text-subhead text-secondary">of {fmtInt(total)}</span>
          </div>
          <div className="text-footnote text-secondary mt-1">{total === 1 ? "milestone" : "milestones"} done</div>
        </div>
        <Ring progress={progress} size={100} stroke={10} color={color} label={`${pct}% of milestones`}>
          <span className="num text-title-3 text-primary">{pct}%</span>
        </Ring>
      </div>
    );
  }
  const isDone = goal.status === "done";
  return (
    <div className="px-[var(--gutter)] pt-4 pb-2 flex items-center gap-4" data-testid="goal-hero">
      <Checkbox checked={isDone} onChange={onToggle} size={32} disabled={pending || goal.status === "paused"} tint={goal.color ? color : undefined} label="Mark done" />
      <div className="flex-1 min-w-0">
        <div className={cn("text-title-2", isDone ? "text-success-text" : "text-primary")} data-testid="hero-value">{isDone ? "Done" : "Not yet"}</div>
        {goal.description && <div className="text-subhead text-secondary mt-0.5">{goal.description}</div>}
      </div>
    </div>
  );
}

function Milestones({ goal }: { goal: Goal }) {
  const add = useAddMilestone();
  const upd = useUpdateMilestone();
  const remove = useDeleteMilestone();
  const [title, setTitle] = useState("");
  const [menu, setMenu] = useState<{ m: GoalMilestone; anchor: { x: number; y: number } } | null>(null);
  const ms = goal.milestones ?? [];
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    add.mutate({ goalId: goal.id, title: t });
    setTitle("");
  };
  return (
    <Section title="Milestones" footer={ms.length ? "Hold a milestone for options." : undefined}>
      <Group>
        {ms.map((m) => (
          <MilestoneRow key={m.id} m={m} tint={goal.color ? colorVar(goal.color) : undefined} onToggle={() => upd.mutate({ id: m.id, goalId: goal.id, patch: { done: !m.done } })} onMenu={(anchor) => setMenu({ m, anchor })} />
        ))}
        <InlineAdd placeholder="Add a milestone" value={title} onChange={setTitle} onSubmit={submit} pending={add.isPending} testId="milestone-add" />
      </Group>
      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu?.anchor ?? null} items={[{ label: "Delete", icon: "trash", destructive: true, onPress: () => menu && remove.mutate({ id: menu.m.id, goalId: goal.id }) }]} />
    </Section>
  );
}

function MilestoneRow({ m, tint, onToggle, onMenu }: { m: GoalMilestone; tint?: string; onToggle: () => void; onMenu: (a: { x: number; y: number }) => void }) {
  const anchor = { current: { x: 0, y: 0 } };
  const lp = useLongPress(() => {
    void impact("medium");
    onMenu(anchor.current);
  });
  return (
    <div
      className="row-sep relative flex items-center gap-3 min-h-[44px] pl-[var(--gutter)] pr-[var(--gutter)] bg-surface select-none"
      data-testid="milestone-row"
      onContextMenu={(e) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY }); }}
      onPointerDown={(e) => { anchor.current = { x: e.clientX, y: e.clientY }; lp.onPointerDown(e); }}
      onPointerMove={lp.onPointerMove}
      onPointerUp={lp.onPointerUp}
      onPointerCancel={lp.onPointerCancel}
      onPointerLeave={lp.onPointerLeave}
    >
      <Checkbox checked={m.done} onChange={onToggle} tint={tint} label={m.title} />
      <div className="flex-1 min-w-0 py-[11px]">
        <div className={cn("text-body truncate", m.done ? "text-secondary" : "text-primary")}>{m.title}</div>
        {m.dueDate && !m.done && <div className="text-subhead text-secondary mt-0.5">{fmtRelativeDate(m.dueDate)}</div>}
      </div>
      {m.done && m.doneAt && <span className="text-subhead text-secondary tabular shrink-0">{fmtRelativeDate(m.doneAt)}</span>}
    </div>
  );
}

function LinkedTasks({ goal }: { goal: Goal }) {
  const { data, isLoading, error, refetch } = useGoalTasks(goal.id);
  const add = useAddGoalTask();
  const toggle = useToggleTask();
  const [title, setTitle] = useState("");
  const tasks = [...(data ?? [])].sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    add.mutate({ goalId: goal.id, title: t });
    setTitle("");
  };
  return (
    <Section title="Linked tasks">
      {isLoading ? (
        <Skeleton rows={1} />
      ) : error ? (
        <InlineError onRetry={() => void refetch()}>Unable to load tasks</InlineError>
      ) : (
        <Group>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={() => toggle.mutate(t)} />
          ))}
          <InlineAdd placeholder="Add Task" value={title} onChange={setTitle} onSubmit={submit} pending={add.isPending} testId="task-add" />
        </Group>
      )}
    </Section>
  );
}

function TaskRow({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const done = task.status === "done";
  return (
    <Row
      leading={<Checkbox checked={done} onChange={onToggle} label={task.title} />}
      title={<span className={done ? "text-secondary" : undefined}>{task.title}</span>}
      subtitle={task.dueDate && !done ? fmtRelativeDate(task.dueDate) : undefined}
      data-testid="task-row"
    />
  );
}

/** A row that is a text field: Enter or the trailing Add button submits. */
function InlineAdd({ placeholder, value, onChange, onSubmit, pending, testId }: { placeholder: string; value: string; onChange: (v: string) => void; onSubmit: () => void; pending?: boolean; testId: string }) {
  return (
    <div className="row-sep relative flex items-center gap-3 min-h-[44px] pl-[var(--gutter)] pr-2 bg-surface">
      <Icon name="plus" size={20} className="text-tertiary shrink-0" />
      <input
        className="flex-1 min-w-0 h-11 text-body bg-transparent outline-none placeholder:text-tertiary"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        enterKeyHint="done"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        data-testid={testId}
      />
      {value.trim() && (
        <button type="button" className="text-subhead font-semibold text-accent-text px-2 h-11 active:opacity-60 disabled:opacity-40" disabled={pending} onClick={onSubmit} data-testid={`${testId}-submit`}>
          Add
        </button>
      )}
    </div>
  );
}

function History({ goal }: { goal: Goal }) {
  const entries = goal.recentEntries ?? [];
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, 10);
  return (
    <Section title="History">
      <Group>
        {shown.length === 0 && <div className="min-h-[44px] flex items-center px-[var(--gutter)] text-callout text-secondary">No entries yet.</div>}
        {shown.map((e) => (
          <Row key={e.id} title={goal.kind === "habit" ? "Checked in" : withUnit(e.value, goal.unit)} subtitle={e.note ?? undefined} trailing={fmtRelativeDate(e.date)} data-testid="history-row" />
        ))}
        {entries.length > 10 && !all && <Row title={<span className="text-accent-text">Show All</span>} onPress={() => setAll(true)} />}
      </Group>
    </Section>
  );
}

function Details({ goal, onEdit }: { goal: Goal; onEdit: () => void }) {
  const dl = deadlineLabel(goal.deadline);
  return (
    <Section title="Details" footer="Tap a row to edit.">
      <Group>
        <ValueRow title="Title" value={<span className="text-right max-w-[50vw] truncate block">{goal.title}</span>} chevron onPress={onEdit} />
        <ValueRow title="Kind" value={KIND_LABEL[goal.kind]} />
        <ValueRow title="Area" value={areaLabel(goal.area)} chevron onPress={onEdit} />
        {goal.kind === "number" && (
          <>
            <ValueRow title="Unit" value={goal.unit ?? "None"} chevron onPress={onEdit} />
            <ValueRow title="Start" value={goal.startValue != null ? fmtNum(goal.startValue) : "None"} chevron onPress={onEdit} />
            <ValueRow title="Target" value={goal.targetValue != null ? fmtNum(goal.targetValue) : "None"} chevron onPress={onEdit} />
            <ValueRow title="Direction" value={goal.direction === "decrease" ? "Down" : "Up"} chevron onPress={onEdit} />
          </>
        )}
        {goal.kind === "habit" && (
          <>
            <ValueRow title="Cadence" value={goal.cadence === "weekly" ? "Weekly" : "Daily"} chevron onPress={onEdit} />
            {goal.cadence === "weekly" && <ValueRow title="Days per week" value={fmtInt(goal.timesPerPeriod ?? 1)} chevron onPress={onEdit} />}
          </>
        )}
        <ValueRow title="Deadline" value={goal.deadline ? `${fmtRelativeDate(goal.deadline)}${dl ? `, ${dl.text.toLowerCase()}` : ""}` : "None"} chevron onPress={onEdit} />
        <ValueRow
          title="Color"
          value={
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: colorVar(goal.color) }} />
              {goal.color ? COLOR_LABEL[goal.color] ?? goal.color : "Default"}
            </span>
          }
          chevron
          onPress={onEdit}
        />
        {goal.description && goal.kind !== "boolean" && <Row title="Notes" subtitle={goal.description} chevron onPress={onEdit} />}
        <ValueRow title="Created" value={fmtRelativeDate(goal.createdAt)} />
      </Group>
    </Section>
  );
}
