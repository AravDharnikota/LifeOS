import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";
import type { Goal, GoalMilestone, Task } from "@aravos/shared";
import { addDaysString, todayString, weekStartString } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Section, Group, Row, ValueRow } from "@/ui/List";
import { IconButton, Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Checkbox } from "@/ui/Checkbox";
import { ArcRing, BigNumber, Sparkline, StatusPill, Trend } from "@/ui/viz";
import { Menu } from "@/ui/Menu";
import { ActionSheet } from "@/ui/Sheet";
import { Empty, Skeleton, InlineError } from "@/ui/Empty";
import { cn } from "@/lib/cn";
import { impact, notify } from "@/lib/haptics";
import { useLongPress } from "@/lib/hooks";
import { fmtInt, fmtRelativeDate } from "@/lib/format";
import { useAppSettings } from "@/data/queries";
import { ApiError } from "@/lib/api";
import { GoalSheet } from "./GoalSheet";
import { LogSheet } from "./LogSheet";
import { HabitGrid } from "./HabitGrid";
import { goalMenuItems } from "./GoalsList";
import { useAddGoalTask, useAddMilestone, useDeleteGoal, useDeleteMilestone, useGoal, useGoalTasks, useLogGoal, useToggleTask, useUpdateGoal, useUpdateMilestone } from "./api";
import { COLOR_LABEL, KIND_LABEL, STANDING_LABEL, STANDING_TONE, STATUS_LABEL, standing, areaLabel, colorVar, deadlineLabel, fmtNum, habitDoneToday, milestoneCounts, periodLabel, remaining, streakLabel, withUnit } from "./model";

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
          <IconButton label="More" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2, y: r.bottom }); }} data-testid="goal-more">
            <Icon name="more" size={20} />
          </IconButton>
          <button type="button" className="glass h-10 px-4 rounded-full text-[15px] text-primary pressable-spring" onClick={() => setEdit(true)} data-testid="goal-edit">
            Edit
          </button>
        </>
      }
    >
      <div className="lg:max-w-[640px]">
        <Hero goal={goal} onToggle={() => log.mutate({ id: goal.id })} pending={log.isPending} onLog={() => setLogOpen(true)} />
        {goal.kind === "milestone" && <Milestones goal={goal} />}
        <LinkedTasks goal={goal} />
        {(goal.kind === "number" || goal.kind === "habit") && <History goal={goal} />}
        <Details goal={goal} onEdit={() => setEdit(true)} />
      </div>

      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu} items={goalMenuItems(goal, { update: (patch) => update.mutate({ id: goal.id, ...patch }), del: () => setConfirm(true) })} />
      <ActionSheet open={confirm} onClose={() => setConfirm(false)} title="Delete this goal?" message={goal.title} actions={[{ label: "Delete Goal", destructive: true, onPress: () => { del.mutate(goal.id); navigate("/goals", { replace: true }); } }]} />
      <GoalSheet open={edit} onClose={() => setEdit(false)} goal={goal} onSubmit={async (input) => { await update.mutateAsync({ id: goal.id, ...input }); setEdit(false); }} pending={update.isPending} />
      {goal.kind === "number" && <LogSheet goal={goal} open={logOpen} onClose={() => setLogOpen(false)} onLog={(input) => log.mutateAsync({ id: goal.id, ...input })} pending={log.isPending} />}
    </Screen>
  );
}

/** The one dominant element per kind: a frosted hero card with the thin big number and a ring. */
function Hero({ goal, onToggle, pending, onLog }: { goal: Goal; onToggle: () => void; pending: boolean; onLog: () => void }) {
  const color = colorVar(goal.color);
  const settings = useAppSettings();
  const progress = goal.progress ?? 0;
  const pct = Math.round(progress * 100);
  const st = standing(goal);
  const pill = <StatusPill tone={STANDING_TONE[st]}>{STANDING_LABEL[st]}</StatusPill>;
  const card = "mx-[var(--gutter)] glass-strong rounded-lg p-4 rise";

  if (goal.kind === "number") {
    const cur = goal.currentValue ?? 0;
    const left = remaining(goal);
    const entries = [...(goal.recentEntries ?? [])].reverse();
    const series = [goal.startValue ?? entries[0]?.value ?? 0, ...entries.map((e) => e.value)];
    const change = cur - (goal.startValue ?? 0);
    return (
      <div className={card} data-testid="goal-hero">
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-tertiary">Current</span>
              {pill}
            </div>
            <BigNumber value={<span data-testid="hero-value">{fmtNum(cur)}</span>} unit={goal.unit ?? undefined} size={52} className="mt-1.5" />
            <div className="text-[13px] text-tertiary tabular mt-1">
              {goal.targetValue != null ? `of ${withUnit(goal.targetValue, goal.unit)}` : "No target"}
              {goal.startValue != null && goal.targetValue != null && goal.startValue !== 0 ? `, from ${fmtNum(goal.startValue)}` : ""}
            </div>
            {left != null && <div className={cn("text-[13px] tabular", left === 0 ? "text-success-text" : "text-tertiary")}>{left === 0 ? "Target reached" : `${withUnit(left, goal.unit)} left`}</div>}
          </div>
          <ArcRing progress={progress} size={108} stroke={8} color={color} color2={goal.color ? undefined : "var(--accent-2)"} label={`${pct}% of target`}>
            <span className="num text-[24px] leading-7 text-primary">{pct}%</span>
            <span className="text-[11px] text-tertiary">of target</span>
          </ArcRing>
        </div>
        {entries.length > 0 && (
          <div className="well rounded-[14px] px-3.5 pt-3 pb-2 mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-tertiary">
                {fmtInt(entries.length)} {entries.length === 1 ? "log" : "logs"}
              </span>
              {change !== 0 && <Trend up={change > 0} good={goal.direction === "decrease" ? change < 0 : change > 0} value={withUnit(Math.abs(change), goal.unit)} />}
            </div>
            <Sparkline values={series} color={color} height={52} className="mt-2" />
          </div>
        )}
        <button type="button" className="mt-4 w-full h-12 rounded-full bg-highlight text-on-highlight text-[15px] font-medium pressable-spring inline-flex items-center justify-center gap-2" onClick={onLog} data-testid="log-progress">
          <Icon name="plus" size={18} strokeWidth={1.8} />
          Log Progress
        </button>
      </div>
    );
  }
  if (goal.kind === "habit") {
    const s = streakLabel(goal);
    const done = habitDoneToday(goal);
    const rate = consistency(goal);
    const ratePct = Math.round(rate * 100);
    return (
      <>
        <div className={card} data-testid="goal-hero">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-tertiary">Current streak</span>
                {pill}
              </div>
              <BigNumber value={<span data-testid="hero-value">{fmtInt(s.n)}</span>} unit={s.unit} size={52} className="mt-1.5" />
              <div className="text-[13px] text-tertiary tabular mt-1">{periodLabel(goal)}</div>
            </div>
            <ArcRing progress={rate} size={108} stroke={8} color={color} color2={goal.color ? undefined : "var(--accent-2)"} label={`${ratePct}% consistency`}>
              <span className="num text-[24px] leading-7 text-primary">{ratePct}%</span>
              <span className="text-[11px] text-tertiary">{goal.cadence === "weekly" ? "4 weeks" : "30 days"}</span>
            </ArcRing>
          </div>
          <div className="well rounded-[14px] mt-4 flex items-center gap-3 pl-4 pr-3 min-h-[52px]">
            <Checkbox checked={done} onChange={() => { if (!done) void notify("success"); onToggle(); }} size={26} disabled={pending || goal.status === "paused"} tint={goal.color ? color : undefined} label="Check in today" />
            <span className={cn("flex-1 text-[15px]", done ? "text-secondary" : "text-primary")}>{done ? "Checked in today" : "Check in today"}</span>
          </div>
        </div>
        <div className="mt-4 rise" style={{ "--i": 1 } as CSSProperties}>
          <HabitGrid goal={goal} weekStartsOn={settings.weekStartsOn} onToggleToday={onToggle} pending={pending} />
        </div>
      </>
    );
  }
  if (goal.kind === "milestone") {
    const { done, total } = milestoneCounts(goal);
    return (
      <div className={card} data-testid="goal-hero">
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-tertiary">Milestones</span>
              {pill}
            </div>
            <BigNumber value={<span data-testid="hero-value">{fmtInt(done)}</span>} unit={`of ${fmtInt(total)}`} size={52} className="mt-1.5" />
            <div className="text-[13px] text-tertiary mt-1">{total === 1 ? "milestone" : "milestones"} done</div>
          </div>
          <ArcRing progress={progress} size={108} stroke={8} color={color} color2={goal.color ? undefined : "var(--accent-2)"} label={`${pct}% of milestones`}>
            <span className="num text-[24px] leading-7 text-primary">{pct}%</span>
            <span className="text-[11px] text-tertiary">complete</span>
          </ArcRing>
        </div>
      </div>
    );
  }
  const isDone = goal.status === "done";
  return (
    <div className={cn(card, "flex items-center gap-4")} data-testid="goal-hero">
      <div className="w-11 h-11 flex items-center justify-center shrink-0">
        <Checkbox checked={isDone} onChange={onToggle} size={34} disabled={pending || goal.status === "paused"} tint={goal.color ? color : undefined} label="Mark done" />
      </div>
      <div className="flex-1 min-w-0">
        <div className={cn("text-[24px] leading-[30px] font-light", isDone ? "text-success-text" : "text-primary")} data-testid="hero-value">{isDone ? "Done" : "Not yet"}</div>
        {goal.description && <div className="text-[13px] text-tertiary mt-0.5">{goal.description}</div>}
      </div>
      {pill}
    </div>
  );
}

/** Share of recent periods with a check-in: last 30 days for daily habits, last 4 weeks for weekly ones. */
function consistency(goal: Goal): number {
  const today = todayString();
  const entries = goal.recentEntries ?? [];
  if (goal.cadence === "weekly") {
    const from = addDaysString(weekStartString(today), -21);
    const n = entries.filter((e) => e.date >= from && e.date <= today).length;
    return Math.min(1, n / (4 * (goal.timesPerPeriod ?? 1)));
  }
  const from = addDaysString(today, -29);
  return Math.min(1, entries.filter((e) => e.date >= from && e.date <= today).length / 30);
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
    <Section title={<Quiet>Milestones</Quiet>} footer={ms.length ? "Hold a milestone for options." : undefined}>
      <Group>
        {ms.map((m) => (
          <MilestoneRow key={m.id} m={m} tint={goal.color ? colorVar(goal.color) : undefined} onToggle={() => { if (!m.done) void notify("success"); upd.mutate({ id: m.id, goalId: goal.id, patch: { done: !m.done } }); }} onMenu={(anchor) => setMenu({ m, anchor })} />
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
      className="row-sep relative flex items-center gap-3 min-h-[52px] pl-[var(--gutter)] pr-[var(--gutter)] select-none"
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
        <div className={cn("text-[16px] truncate transition-colors duration-200", m.done ? "text-tertiary" : "text-primary")}>{m.title}</div>
        {m.dueDate && !m.done && <div className="text-[13px] text-tertiary mt-0.5">{fmtRelativeDate(m.dueDate)}</div>}
      </div>
      {m.done && m.doneAt && <span className="text-[13px] text-tertiary tabular shrink-0">{fmtRelativeDate(m.doneAt)}</span>}
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
    <Section title={<Quiet>Linked tasks</Quiet>}>
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
    <div className="row-sep relative flex items-center gap-3 min-h-[52px] pl-[var(--gutter)] pr-2">
      <span className="w-[22px] h-[22px] rounded-full well inline-flex items-center justify-center text-tertiary shrink-0">
        <Icon name="plus" size={14} strokeWidth={1.8} />
      </span>
      <input
        className="flex-1 min-w-0 h-[52px] text-[16px] bg-transparent outline-none placeholder:text-tertiary"
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
        <button type="button" className="text-[15px] font-medium text-accent-text px-2 h-11 active:opacity-60 disabled:opacity-40" disabled={pending} onClick={onSubmit} data-testid={`${testId}-submit`}>
          Add
        </button>
      )}
    </div>
  );
}

/** Logged values as a timeline: a thin rail with a dot per entry, the value, its change, and the date. */
function History({ goal }: { goal: Goal }) {
  const entries = goal.recentEntries ?? [];
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, 10);
  const color = colorVar(goal.color);
  return (
    <Section title={<Quiet>History</Quiet>}>
      <div className="mx-[var(--gutter)] glass rounded-lg overflow-hidden">
        {shown.length === 0 && <div className="min-h-[52px] flex items-center px-[var(--gutter)] text-[15px] text-secondary">No entries yet.</div>}
        {shown.map((e, i) => {
          const older = entries[i + 1];
          const delta = goal.kind === "number" ? e.value - (older ? older.value : goal.startValue ?? 0) : 0;
          const first = i === 0;
          const last = i === shown.length - 1 && !(entries.length > 10 && !all);
          return (
            <div key={e.id} className="flex items-stretch gap-3 pl-[var(--gutter)] pr-[var(--gutter)] min-h-[56px]" data-testid="history-row">
              <div className="relative w-[9px] shrink-0" aria-hidden="true">
                <span className="absolute left-1/2 -translate-x-1/2 w-px bg-separator-strong" style={{ top: first ? "50%" : 0, bottom: last ? "50%" : 0 }} />
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full" style={first ? { background: color, boxShadow: `0 0 0 3px color-mix(in oklab, ${color} 18%, transparent)` } : { background: "var(--bg-surface-2)", boxShadow: "inset 0 0 0 1.5px var(--text-quaternary)" }} />
              </div>
              <div className="flex-1 min-w-0 py-2.5 self-center">
                <div className="text-[16px] leading-[21px] text-primary tabular truncate">{goal.kind === "habit" ? "Checked in" : withUnit(e.value, goal.unit)}</div>
                {e.note && <div className="text-[13px] text-tertiary truncate mt-0.5">{e.note}</div>}
              </div>
              <div className="shrink-0 self-center text-right">
                {delta !== 0 && <div className={cn("text-[13px] tabular", (goal.direction === "decrease" ? delta < 0 : delta > 0) ? "text-success-text" : "text-secondary")}>{delta > 0 ? "+" : "−"}{fmtNum(Math.abs(delta))}</div>}
                <div className="text-[12px] text-tertiary tabular">{fmtRelativeDate(e.date)}</div>
              </div>
            </div>
          );
        })}
        {entries.length > 10 && !all && (
          <button type="button" className="w-full min-h-[48px] hairline-t text-[15px] text-accent-text active:bg-pressed" onClick={() => setAll(true)}>
            Show All
          </button>
        )}
      </div>
    </Section>
  );
}

/** Quiet section header text. */
function Quiet({ children }: { children: string }) {
  return <span className="text-[13px] text-secondary">{children}</span>;
}

function Details({ goal, onEdit }: { goal: Goal; onEdit: () => void }) {
  const dl = deadlineLabel(goal.deadline);
  return (
    <Section title={<Quiet>Details</Quiet>} footer="Tap a row to edit.">
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
