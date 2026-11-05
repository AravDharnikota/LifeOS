import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Task, TaskList } from "@aravos/shared";
import { todayString } from "@aravos/shared";
import { useLists, useTasks } from "@/data/queries";
import { cn } from "@/lib/cn";
import { fmtMinutes, fmtRelativeDate, plural } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { Sheet } from "@/ui/Sheet";
import { Icon } from "@/ui/Icon";
import { colorVar, taskHasBlockOn } from "./model";
import { useTaskDrag } from "./taskDrag";

/** Open tasks that have no time box on `date`: due that day, overdue, or undated. */
export function useRailTasks(date: string) {
  const todayQ = useTasks({ view: "today", date });
  const anyQ = useTasks({ view: "anytime" });
  const listsQ = useLists();
  const lists = useMemo(() => new Map((listsQ.data ?? []).map((l) => [l.id, l])), [listsQ.data]);
  const tasks = useMemo(() => {
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const t of [...(todayQ.data ?? []), ...(anyQ.data ?? [])]) {
      if (t.status !== "open" || seen.has(t.id) || taskHasBlockOn(t, date)) continue;
      seen.add(t.id);
      out.push(t);
    }
    const today = todayString();
    const rank = (t: Task) => (t.dueDate && t.dueDate < today ? 0 : t.dueDate === date ? 1 : t.startDate && t.startDate <= date ? 2 : 3);
    return out.sort((a, b) => rank(a) - rank(b) || b.priority - a.priority || a.sortOrder - b.sortOrder);
  }, [todayQ.data, anyQ.data, date]);
  const minutes = tasks.reduce((n, t) => n + (t.estimateMinutes ?? 30), 0);
  return { tasks, lists, minutes, loading: todayQ.isLoading || anyQ.isLoading, error: todayQ.error ?? anyQ.error ?? null, refetch: () => { void todayQ.refetch(); void anyQ.refetch(); } };
}

function subtitleFor(t: Task, date: string, lists: Map<string, TaskList & { openCount: number }>): string {
  const today = todayString();
  const parts: string[] = [];
  if (t.dueDate) parts.push(t.dueDate < today ? `Overdue ${fmtRelativeDate(t.dueDate, false)}` : `Due ${fmtRelativeDate(t.dueDate, false).toLowerCase()}${t.dueTime ? " " + t.dueTime : ""}`);
  else if (t.startDate && t.startDate <= date) parts.push(fmtRelativeDate(t.startDate, false));
  else {
    const list = t.listId ? lists.get(t.listId) : undefined;
    if (list && !list.isDefault) parts.push(list.name);
  }
  if (t.estimateMinutes) parts.push(fmtMinutes(t.estimateMinutes));
  return parts.join(" · ");
}

function RailRow({ task, date, lists, onSchedule, draggable }: { task: Task; date: string; lists: Map<string, TaskList & { openCount: number }>; onSchedule: (t: Task) => void; draggable: boolean }) {
  const drag = useTaskDrag();
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const active = useRef(false);
  const list = task.listId ? lists.get(task.listId) : undefined;
  const overdue = Boolean(task.dueDate && task.dueDate < todayString());
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable || e.pointerType !== "mouse" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    active.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    if (!active.current) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 4) return;
      active.current = true;
      drag.begin(task, e.clientX, e.clientY);
    }
    drag.move(e.clientX, e.clientY);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    start.current = null;
    if (active.current) drag.end();
    active.current = false;
  };
  return (
    <div
      data-rail-task={task.id}
      className={cn("relative flex items-center gap-3 min-h-[56px] pl-[var(--gutter)] pr-3 row-sep group", draggable && "row-hover transition-colors duration-150", draggable && "cursor-grab active:cursor-grabbing select-none")}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorVar(list?.color ?? "gray") }} aria-hidden="true" />
      <div className="flex-1 min-w-0 py-2">
        <div className="text-[15px] leading-5 text-primary truncate">{task.title}</div>
        <div className={cn("text-[12px] leading-4 tabular truncate mt-0.5", overdue ? "text-danger-text" : "text-tertiary")}>{subtitleFor(task, date, lists)}</div>
      </div>
      <Button variant="plain" size="sm" className={cn("shrink-0 -mr-1 text-[14px]", draggable && "absolute right-2 top-1/2 -translate-y-1/2 bg-elevated !px-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100")} onClick={() => onSchedule(task)}>
        Schedule
      </Button>
    </div>
  );
}

export function RailList({ date, onSchedule, draggable = false, className }: { date: string; onSchedule: (t: Task) => void; draggable?: boolean; className?: string }) {
  const { tasks, lists, loading, error, refetch } = useRailTasks(date);
  if (loading) return <Skeleton rows={3} className={cn("mx-0", className)} />;
  if (error) return <InlineError onRetry={refetch}>Unable to load tasks.</InlineError>;
  if (tasks.length === 0) return <Empty className="pt-8">Nothing left to schedule.</Empty>;
  return (
    <div className={cn("well rounded-lg overflow-hidden group-rows", className)}>
      {tasks.map((t) => (
        <RailRow key={t.id} task={t} date={date} lists={lists} onSchedule={onSchedule} draggable={draggable} />
      ))}
    </div>
  );
}

/**
 * Mobile: a floating glass pill above the tab bar with the open-task count and the planner.
 * Tapping the left half opens the task sheet.
 */
export function RailBar({ date, open, onOpen, onPlan, planning }: { date: string; open: boolean; onOpen: (v: boolean) => void; onPlan: () => void; planning: boolean }) {
  const { tasks, minutes } = useRailTasks(date);
  return (
    <div
      className="fixed z-20 left-1/2 -translate-x-1/2 h-11 max-w-[calc(100%-32px)] glass-strong rounded-full flex items-center p-1 gap-0.5"
      style={{ bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 8px)" }}
      data-rail-bar
    >
      <button type="button" onClick={() => onOpen(true)} className="flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-full text-[14px] text-primary min-w-0 active:bg-pressed transition-colors duration-150" aria-expanded={open}>
        <Icon name="checklist" size={17} strokeWidth={1.7} className="text-secondary shrink-0" />
        <span>Tasks</span>
        {tasks.length > 0 && <span className="text-[13px] text-tertiary tabular truncate">{tasks.length} · {fmtMinutes(minutes)}</span>}
        <Icon name="chevron-up" size={14} className="text-quaternary shrink-0" />
      </button>
      <span className="w-px h-5 bg-separator-strong shrink-0" aria-hidden="true" />
      <Button variant="plain" size="sm" loading={planning} onClick={onPlan} leading={<Icon name="sparkle" size={15} strokeWidth={1.8} />} className="!h-9 !px-3 text-[14px] shrink-0">
        Plan
      </Button>
    </div>
  );
}

export function RailSheet({ date, open, onClose, onSchedule }: { date: string; open: boolean; onClose: () => void; onSchedule: (t: Task) => void }) {
  const { tasks } = useRailTasks(date);
  return (
    <Sheet open={open} onClose={onClose} title="Tasks" detent="medium" leading={null} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={onClose}>Done</button>}>
      <p className="text-[13px] text-tertiary pt-1 pb-3 px-1">{tasks.length ? `${plural(tasks.length, "task")} without a time box. Tap Schedule to place one in the next free slot.` : "Everything for this day has a time box."}</p>
      <RailList date={date} onSchedule={onSchedule} />
    </Sheet>
  );
}

/** Desktop: 320px rail with draggable rows. */
export function DesktopRail({ date, onSchedule }: { date: string; onSchedule: (t: Task) => void }) {
  const { tasks, minutes } = useRailTasks(date);
  return (
    <aside className="glass rounded-xl w-[280px] min-[1440px]:w-[320px] shrink-0 h-full flex flex-col overflow-hidden" aria-label="Tasks">
      <div className="px-5 pt-5 pb-3">
        <h2 className="text-[20px] leading-6 font-[400] text-primary">Tasks</h2>
        <p className="text-[12px] text-tertiary tabular mt-1">{tasks.length ? `${plural(tasks.length, "task")} · ${fmtMinutes(minutes)}. Drag onto the grid.` : "Nothing left to schedule."}</p>
      </div>
      <div className="scroller flex-1 min-h-0 px-4 pb-6">
        <RailList date={date} onSchedule={onSchedule} draggable />
      </div>
      <TaskDragGhost />
    </aside>
  );
}

function TaskDragGhost() {
  const task = useTaskDrag((s) => s.task);
  const point = useTaskDrag((s) => s.point);
  const hover = useTaskDrag((s) => s.hover);
  if (!task || !point || hover) return null;
  return createPortal(
    <div className="fixed z-[80] pointer-events-none bg-elevated rounded-full shadow-drag px-4 py-2 text-[14px] text-primary max-w-[240px] truncate" style={{ left: point.x + 12, top: point.y - 20, transform: "scale(1.02)" }}>
      {task.title}
    </div>,
    document.body,
  );
}
