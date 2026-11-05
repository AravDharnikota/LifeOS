import { useRef, useState, type CSSProperties } from "react";
import type { Task } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { impact } from "@/lib/haptics";
import { Icon } from "@/ui/Icon";
import { TaskRow } from "./TaskRow";
import type { ListMap, TaskGroupData } from "./model";
import type { TaskActions } from "./useTaskActions";

interface DragState {
  id: string;
  startY: number;
  dy: number;
  rects: Map<string, { top: number; height: number }>;
  origin: string[];
  order: string[];
}

export interface GroupSharedProps {
  lists: ListMap;
  actions: TaskActions;
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  onContext: (task: Task, at: { x: number; y: number }) => void;
  onSchedule: (task: Task) => void;
  onDelete: (task: Task) => void;
  date?: string;
  logbook?: boolean;
}

/** A glass card: quiet header (dot, title, count) and the rows. Long-press reorder lives here so rows can shift as one. */
export function TaskGroup({ group, index = 0, lists, actions, expandedId, onExpand, onContext, onSchedule, onDelete, date, logbook }: GroupSharedProps & { group: TaskGroupData; index?: number }) {
  const [collapsed, setCollapsed] = useState(Boolean(group.collapsed));
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const set = (d: DragState | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const lift = (id: string, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rects = new Map<string, { top: number; height: number }>();
    for (const row of el.querySelectorAll<HTMLElement>("[data-task-row]")) {
      const r = row.getBoundingClientRect();
      rects.set(row.dataset.taskRow!, { top: r.top, height: r.height });
    }
    const order = group.tasks.map((t) => t.id);
    set({ id, startY: clientY, dy: 0, rects, origin: order, order });
  };
  const move = (clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = clientY - d.startY;
    const centers = d.origin.map((id) => {
      const r = d.rects.get(id)!;
      return { id, c: r.top + r.height / 2 + (id === d.id ? dy : 0) };
    });
    const order = centers.sort((a, b) => a.c - b.c).map((x) => x.id);
    if (order.join() !== d.order.join()) void impact("light");
    set({ ...d, dy, order });
  };
  const drop = () => {
    const d = dragRef.current;
    set(null);
    if (!d) return;
    void impact("light");
    if (d.order.join() !== d.origin.join()) actions.reorder.mutate(d.order);
  };
  const cancel = () => set(null);

  const offsetFor = (id: string): number => {
    const d = drag;
    if (!d) return 0;
    if (id === d.id) return d.dy;
    const origTop = d.rects.get(id)?.top ?? 0;
    let top = d.rects.get(d.origin[0]!)?.top ?? 0;
    for (const other of d.order) {
      if (other === id) break;
      top += d.rects.get(other)?.height ?? 0;
    }
    return top - origTop;
  };

  const count = group.tasks.length;
  const collapsible = Boolean(group.collapsed);
  const showRows = !collapsed;
  const header = group.title ? (
    <>
      <span className="flex items-center gap-2 min-w-0">
        {(group.color || group.tone === "danger") && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: group.tone === "danger" ? "var(--danger)" : group.color }} />}
        <span className="text-[15px] text-primary truncate">{group.title}</span>
        {group.detail && <span className="text-[12px] text-tertiary truncate">{group.detail}</span>}
      </span>
      <span className="flex items-center gap-1 shrink-0 text-[12px] text-tertiary tabular">
        {count}
        {collapsible && <Icon name="chevron-down" size={14} className="text-quaternary transition-transform duration-300" style={{ transform: collapsed ? "rotate(-90deg)" : undefined, transitionTimingFunction: "var(--ease-out)" }} />}
      </span>
    </>
  ) : null;
  const headerCls = cn("w-full flex items-center justify-between gap-3 pl-4 pr-4 text-left", showRows ? "pt-3.5 pb-1" : "py-3.5");
  return (
    <section className="rise mt-3 first:mt-0 px-[var(--gutter)]" style={{ "--i": index } as CSSProperties} data-task-group={group.key}>
      <div className={cn("glass rounded-lg", !drag && "overflow-hidden")}>
        {header &&
          (collapsible ? (
            <button type="button" className={cn(headerCls, "row-hover transition-colors duration-150")} onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
              {header}
            </button>
          ) : (
            <div className={headerCls}>{header}</div>
          ))}
      {showRows && (
        <div ref={ref} className={cn("group-rows", header ? "pb-1" : "py-1")}>
          {group.tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              lists={lists}
              actions={actions}
              expanded={expandedId === t.id}
              onExpand={onExpand}
              hideDone={group.hideDone}
              date={date}
              logbook={logbook}
              showList={group.showList}
              groupDate={/^\d{4}-\d{2}-\d{2}$/.test(group.key) ? group.key : undefined}
              onContext={onContext}
              onSchedule={onSchedule}
              onDelete={onDelete}
              reorder={group.reorderable && group.tasks.length > 1 ? { onLift: lift, onMove: move, onDrop: drop, onCancel: cancel, offset: offsetFor(t.id), lifted: drag?.id === t.id } : undefined}
            />
          ))}
        </div>
      )}
      </div>
    </section>
  );
}
