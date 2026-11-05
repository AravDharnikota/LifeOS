import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Task } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { impact } from "@/lib/haptics";
import { Checkbox } from "@/ui/Checkbox";
import { Icon } from "@/ui/Icon";
import { IconButton } from "@/ui/Button";
import { TaskEditor, TaskTitleInput } from "./TaskEditor";
import { StatusPill } from "@/ui/viz";
import { rowInfo, type ListMap } from "./model";
import { swallowNextClick } from "@/features/calendar/model";
import type { TaskActions } from "./useTaskActions";

export interface ReorderProps {
  onLift: (id: string, clientY: number) => void;
  onMove: (clientY: number) => void;
  onDrop: () => void;
  onCancel: () => void;
  /** Vertical offset for this row while another row is being dragged, or the drag offset when lifted. */
  offset: number;
  lifted: boolean;
}

export interface TaskRowProps {
  task: Task;
  lists: ListMap;
  actions: TaskActions;
  expanded: boolean;
  onExpand: (id: string | null) => void;
  /** Completed rows fade and collapse out (lists of open tasks). */
  hideDone?: boolean;
  date?: string;
  reorder?: ReorderProps;
  onContext: (task: Task, at: { x: number; y: number }) => void;
  onSchedule: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** Logbook style: filled quaternary circle, no checkbox choreography. */
  logbook?: boolean;
  /** Hide the list name in the meta line (the group already says it). */
  showList?: boolean;
  /** The day the enclosing group stands for (Upcoming), so the row does not repeat it. */
  groupDate?: string;
}

const HOLD_MS = 400;
const ACTION_W = 72;
const TRAILING_W = ACTION_W * 2;
const LEAVE_MS = 340;

/**
 * 44px row: Things checkbox, title, one meta line. Touch: leading full swipe completes, trailing
 * reveals Schedule and Delete (full swipe deletes); long press lifts for reorder or, released in
 * place, opens the context menu. Pointer: hover shows the same actions as glyphs. Tap expands.
 */
export function TaskRow({ task, lists, actions, expanded, onExpand, hideDone, date, reorder, onContext, onSchedule, onDelete, logbook, showList, groupDate }: TaskRowProps) {
  const done = task.status === "done";
  const [checked, setChecked] = useState(done);
  const [leaving, setLeaving] = useState(false);
  const [dx, setDxState] = useState(0);
  const dxRef = useRef(0);
  const setDx = (v: number) => {
    dxRef.current = v;
    setDxState(v);
  };
  const [animated, setAnimated] = useState(true);
  const [committing, setCommitting] = useState<"complete" | "delete" | null>(null);
  const open = useRef(false);
  const gesture = useRef<{ id: number; x: number; y: number; swiping: boolean; lifted: boolean; moved: boolean; timer: number | null } | null>(null);
  const suppressClick = useRef(false);
  const liftedRef = useRef(false);
  const timers = useRef<number[]>([]);

  useEffect(() => setChecked(done), [done]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const finishComplete = () => {
    if (hideDone) {
      // Let the check finish filling, then fade and fold the row away before the data moves it.
      timers.current.push(window.setTimeout(() => setLeaving(true), 450));
      timers.current.push(window.setTimeout(() => actions.complete.mutate(task), 450 + LEAVE_MS));
    } else {
      timers.current.push(window.setTimeout(() => actions.complete.mutate(task), 500));
    }
  };
  const onCheck = (next: boolean) => {
    setChecked(next);
    if (next) finishComplete();
    else {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setLeaving(false);
      if (done) actions.reopen.mutate(task);
    }
  };

  // ----- touch gestures -----
  const preventTouch = (e: TouchEvent) => {
    if (liftedRef.current) e.preventDefault();
  };
  const clearGesture = () => {
    const g = gesture.current;
    if (g?.timer) window.clearTimeout(g.timer);
    gesture.current = null;
    liftedRef.current = false;
    document.removeEventListener("touchmove", preventTouch);
  };
  const settle = (to: number) => {
    setAnimated(true);
    setDx(to);
    open.current = to !== 0;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    if ((e.target as HTMLElement).closest("input,textarea,select,[data-task-editor],[data-swipe-action]")) return;
    const el = e.currentTarget;
    const g = { id: e.pointerId, x: e.clientX, y: e.clientY, swiping: false, lifted: false, moved: false, timer: null as number | null };
    gesture.current = g;
    document.addEventListener("touchmove", preventTouch, { passive: false });
    if (!expanded) {
      g.timer = window.setTimeout(() => {
        const cur = gesture.current;
        if (!cur || cur.id !== e.pointerId || cur.swiping) return;
        cur.lifted = true;
        liftedRef.current = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        void impact("medium");
        reorder?.onLift(task.id, e.clientY);
      }, HOLD_MS);
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const mx = e.clientX - g.x;
    const my = e.clientY - g.y;
    if (g.lifted) {
      if (reorder && Math.abs(my) > 2) g.moved = true;
      reorder?.onMove(e.clientY);
      return;
    }
    if (!g.swiping) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) {
        g.swiping = true;
        if (g.timer) window.clearTimeout(g.timer);
        e.currentTarget.setPointerCapture(e.pointerId);
        setAnimated(false);
      } else if (Math.abs(my) > 10) {
        if (g.timer) window.clearTimeout(g.timer);
        g.timer = null;
      }
      if (!g.swiping) return;
    }
    const base = open.current ? -TRAILING_W : 0;
    let next = base + mx;
    if (expanded) next = 0;
    const w = e.currentTarget.clientWidth;
    const commit = next > w * 0.6 ? "complete" : next < -w * 0.6 ? "delete" : null;
    if (commit !== committing) {
      if (commit) void impact("medium");
      setCommitting(commit);
    }
    setDx(next);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (g.lifted) {
      if (g.moved && reorder) {
        void impact("light"); // a task snaps into its new slot
        reorder.onDrop();
      } else {
        reorder?.onCancel();
        swallowNextClick();
        onContext(task, { x: e.clientX, y: e.clientY });
      }
      suppressClick.current = true;
      clearGesture();
      return;
    }
    if (g.swiping) {
      suppressClick.current = true;
      const w = e.currentTarget.clientWidth;
      const x = dxRef.current;
      if (x > w * 0.6) {
        settle(0);
        onCheck(true);
      } else if (x < -w * 0.6) {
        settle(-w);
        timers.current.push(window.setTimeout(() => onDelete(task), 150));
      } else if (x < -ACTION_W) settle(-TRAILING_W);
      else settle(0);
      setCommitting(null);
    }
    clearGesture();
  };
  const onPointerCancel = () => {
    const g = gesture.current;
    if (g?.lifted) reorder?.onCancel();
    if (g?.swiping) settle(open.current ? -TRAILING_W : 0);
    setCommitting(null);
    clearGesture();
  };

  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (open.current) {
      settle(0);
      return;
    }
    onExpand(expanded ? null : task.id);
  };

  const { meta, pill } = rowInfo(task, lists, { date, showList, groupDate });
  const lifted = Boolean(reorder?.lifted);
  const offset = reorder?.offset ?? 0;
  // Rows are see-through on the glass card; they only turn solid while they slide over swipe actions or float.
  const solid = dx !== 0 || lifted;

  return (
    <div
      data-task-row={task.id}
      className={cn("relative row-sep grid", lifted && "z-20")}
      style={{ gridTemplateRows: leaving ? "0fr" : "1fr", transform: offset ? `translateY(${offset}px)` : undefined, transition: lifted ? undefined : `grid-template-rows ${LEAVE_MS}ms var(--ease-out)${offset ? ", transform 150ms var(--ease-out)" : ""}` }}
    >
      <div className="min-h-0 overflow-hidden relative" style={{ opacity: leaving ? 0 : 1, transform: leaving ? "translateY(-2px)" : undefined, transition: `opacity ${LEAVE_MS - 60}ms var(--ease-out), transform ${LEAVE_MS}ms var(--ease-out)` }}>
        {dx !== 0 && (
          <div className="absolute inset-0 flex" aria-hidden={dx === 0}>
            {dx > 0 ? (
              <div className={cn("bg-success text-white flex items-center pl-6", committing === "complete" && "transition-[width] duration-150")} style={{ width: committing === "complete" ? "100%" : Math.max(0, dx) }}>
                <Icon name="check" size={22} strokeWidth={2} />
              </div>
            ) : (
              <div className="ml-auto flex h-full" style={{ width: Math.max(0, -dx) }}>
                <button type="button" data-swipe-action className={cn("bg-pressed text-primary flex flex-col items-center justify-center gap-1 text-[12px] font-medium overflow-hidden transition-[width] duration-150", committing === "delete" ? "w-0" : "flex-1")} onClick={(e) => { e.stopPropagation(); settle(0); onSchedule(task); }}>
                  <Icon name="calendar" size={19} strokeWidth={1.7} />
                  Schedule
                </button>
                <button type="button" data-swipe-action className={cn("bg-danger text-white flex flex-col items-center justify-center gap-1 text-[12px] font-medium overflow-hidden transition-[width] duration-150", committing === "delete" ? "w-full" : "flex-1")} onClick={(e) => { e.stopPropagation(); onDelete(task); }}>
                  <Icon name="trash" size={19} strokeWidth={1.7} />
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
        <div
          className={cn("relative group", solid && "bg-elevated", lifted && "shadow-drag rounded-md scale-[1.02]")}
          style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: animated ? "transform 300ms var(--spring-snappy)" : "none", touchAction: "pan-y", WebkitTouchCallout: "none", userSelect: "none", WebkitUserSelect: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onContextMenu={(e) => {
            e.preventDefault();
            if (gesture.current || liftedRef.current) return; // touch hold: handled on pointerup
            onContext(task, { x: e.clientX, y: e.clientY });
          }}
        >
          <div className={cn("flex items-center gap-3 min-h-[52px] pl-[var(--gutter)] pr-3 cursor-pointer", !expanded && "row-hover active:bg-pressed transition-colors duration-100")} onClick={onClick} role="button" tabIndex={0} aria-expanded={expanded} aria-label={task.title} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !expanded) { e.preventDefault(); onExpand(task.id); } }}>
            {logbook ? (
              <span className="w-[22px] h-[22px] rounded-full bg-success-soft text-success-text inline-flex items-center justify-center shrink-0">
                <Icon name="check" size={12} strokeWidth={2.2} />
              </span>
            ) : (
              <Checkbox checked={checked} onChange={onCheck} label={checked ? `Reopen ${task.title}` : `Complete ${task.title}`} />
            )}
            {expanded ? (
              <div className="flex-1 min-w-0">
                <TaskTitleInput task={task} actions={actions} onClose={() => onExpand(null)} />
              </div>
            ) : (
              <div className="flex-1 min-w-0 py-3">
                <div className={cn("text-[16px] leading-[21px] truncate transition-colors duration-200", done || logbook || checked ? "text-tertiary" : "text-primary")}>{task.title}</div>
                {meta.length > 0 && (
                  <div className="text-[12px] leading-4 text-tertiary truncate mt-1 flex items-center gap-2">
                    {meta.map((p, i) => (
                      <span key={i} className="inline-flex items-center gap-1 shrink-0 tabular">
                        {p.dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.dot }} />}
                        {p.text}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!expanded && pill && (
              <StatusPill tone={pill.tone} className={cn("shrink-0 tabular transition-opacity duration-200", checked && "opacity-40", !logbook && "lg:group-hover:hidden lg:group-focus-within:hidden")}>
                {pill.text}
              </StatusPill>
            )}
            {!expanded && !logbook && (
              <div className="hidden lg:flex items-center w-0 overflow-hidden opacity-0 group-hover:w-auto group-hover:overflow-visible group-hover:opacity-100 focus-within:w-auto focus-within:overflow-visible focus-within:opacity-100 transition-opacity duration-150">
                {task.status === "open" && (
                  <IconButton label="Schedule" onClick={(e) => { e.stopPropagation(); onSchedule(task); }} className="!min-w-0 !min-h-0 w-9 h-9 !text-tertiary hover:!text-primary">
                    <Icon name="calendar" size={18} />
                  </IconButton>
                )}
                <IconButton label="Delete" onClick={(e) => { e.stopPropagation(); onDelete(task); }} className="!min-w-0 !min-h-0 w-9 h-9 !text-tertiary hover:!text-primary">
                  <Icon name="trash" size={18} />
                </IconButton>
                {reorder && (
                  <span
                    role="button"
                    aria-label="Reorder"
                    className="w-9 h-9 inline-flex items-center justify-center text-quaternary cursor-grab active:cursor-grabbing touch-none"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      reorder.onLift(task.id, e.clientY);
                      liftedRef.current = true;
                    }}
                    onPointerMove={(e) => liftedRef.current && reorder.onMove(e.clientY)}
                    onPointerUp={() => {
                      if (!liftedRef.current) return;
                      liftedRef.current = false;
                      void impact("light"); // a task snaps into its new slot
                      reorder.onDrop();
                    }}
                    onPointerCancel={() => {
                      liftedRef.current = false;
                      reorder.onCancel();
                    }}
                  >
                    <Icon name="drag-handle" size={18} />
                  </span>
                )}
              </div>
            )}
          </div>
          {expanded && <TaskEditor task={task} lists={lists} actions={actions} onClose={() => onExpand(null)} onDelete={() => onDelete(task)} />}
        </div>
      </div>
    </div>
  );
}
