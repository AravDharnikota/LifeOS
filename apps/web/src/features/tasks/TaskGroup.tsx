import { useRef, useState } from "react";
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

/** Section header plus an inset group of rows. Long-press reorder lives here so rows can shift as one. */
export function TaskGroup({ group, lists, actions, expandedId, onExpand, onContext, onSchedule, onDelete, date, logbook }: GroupSharedProps & { group: TaskGroupData }) {
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
  return (
    <section className="mt-6 first:mt-0" data-task-group={group.key}>
      {group.title && (
      <div className="flex items-end justify-between px-[var(--gutter)] pb-2">
        <button type="button" className={cn("flex items-center gap-2 text-footnote", group.tone === "danger" ? "text-danger-text font-medium" : "text-secondary", group.collapsed ? "pressable" : "cursor-default")} onClick={group.collapsed ? () => setCollapsed((c) => !c) : undefined} aria-expanded={group.collapsed ? !collapsed : undefined}>
          {group.color && <span className="w-2 h-2 rounded-full" style={{ background: group.color }} />}
          <span>{group.title}</span>
          {group.detail && <span className="text-tertiary">{group.detail}</span>}
          {group.collapsed && (
            <>
              <span className="text-tertiary tabular">{count}</span>
              <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={14} className="text-quaternary" />
            </>
          )}
        </button>
      </div>
      )}
      {!collapsed && (
        <div ref={ref} className={cn("bg-surface rounded-md mx-[var(--gutter)] group-rows", !drag && "overflow-hidden")}>
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
              onContext={onContext}
              onSchedule={onSchedule}
              onDelete={onDelete}
              reorder={group.reorderable && group.tasks.length > 1 ? { onLift: lift, onMove: move, onDrop: drop, onCancel: cancel, offset: offsetFor(t.id), lifted: drag?.id === t.id } : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}
