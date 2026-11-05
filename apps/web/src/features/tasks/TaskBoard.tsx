import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { notify } from "@/lib/haptics";
import type { Task } from "@aravos/shared";
import { useLists } from "@/data/queries";
import { useUi } from "@/state/ui";
import { Button } from "@/ui/Button";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { Menu, type MenuItem } from "@/ui/Menu";
import { ActionSheet } from "@/ui/Sheet";
import { TaskGroup } from "./TaskGroup";
import { ScheduleSheet } from "./ScheduleSheet";
import { useTaskActions } from "./useTaskActions";
import type { ListMap, TaskGroupData } from "./model";

export interface TaskBoardProps {
  groups: TaskGroupData[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: ReactNode;
  emptyAction?: ReactNode;
  date?: string;
  logbook?: boolean;
}

/**
 * One success haptic when a completion empties a day or list: a group that had open tasks a moment
 * ago is gone (or has none left) right after a Complete. Deletes and view switches stay silent.
 */
function useClearedHaptic(groups: TaskGroupData[], completedAt: number) {
  const prev = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const now = new Map(groups.map((g) => [g.key, g.tasks.filter((t) => t.status === "open").length]));
    const before = prev.current;
    prev.current = now;
    if (!before || !completedAt || Date.now() - completedAt > 4000) return;
    for (const [key, n] of before) if (n > 0 && !now.get(key)) return void notify("success");
  }, [groups, completedAt]);
}

/** Renders groups of rows and owns the shared context menu, When sheet, Move sheet and Delete confirmation. */
export function TaskBoard({ groups, loading, error, onRetry, empty, emptyAction, date, logbook }: TaskBoardProps) {
  const actions = useTaskActions();
  const listsQ = useLists();
  const lists: ListMap = useMemo(() => new Map((listsQ.data ?? []).map((l) => [l.id, l])), [listsQ.data]);
  const setQuickAdd = useUi((s) => s.setQuickAdd);
  const [expandedId, setExpanded] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ task: Task; at: { x: number; y: number } } | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Task | null>(null);
  const [moveFor, setMoveFor] = useState<Task | null>(null);
  const [confirm, setConfirm] = useState<Task | null>(null);
  useClearedHaptic(groups, actions.complete.submittedAt);

  const items: MenuItem[] = menu
    ? [
        ...(menu.task.status === "open" ? [{ label: "Complete", icon: "check" as const, onPress: () => actions.complete.mutate(menu.task) }] : [{ label: "Reopen", icon: "undo" as const, onPress: () => actions.reopen.mutate(menu.task) }]),
        { label: "Schedule", icon: "calendar", onPress: () => setScheduleFor(menu.task) },
        { label: "Move to list", icon: "inbox", onPress: () => setMoveFor(menu.task) },
        { label: "Delete", icon: "trash", destructive: true, onPress: () => setConfirm(menu.task) },
      ]
    : [];

  if (loading) {
    return (
      <div className="pt-2">
        <Skeleton rows={4} />
      </div>
    );
  }
  if (error) return <InlineError onRetry={onRetry}>Unable to load tasks.</InlineError>;
  if (groups.length === 0)
    return (
      <div className="rise mx-[var(--gutter)] glass rounded-lg">
        <Empty className="!pt-8 !pb-6" action={emptyAction ?? <Button variant="plain" onClick={() => setQuickAdd(true)}>Add Task</Button>}>{empty}</Empty>
      </div>
    );

  return (
    <>
      {groups.map((g, i) => (
        <TaskGroup key={g.key} group={g} index={i} lists={lists} actions={actions} expandedId={expandedId} onExpand={setExpanded} date={date} logbook={logbook} onContext={(task, at) => setMenu({ task, at })} onSchedule={setScheduleFor} onDelete={(t) => (expandedId === t.id || menu ? setConfirm(t) : actions.remove.mutate(t))} />
      ))}
      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu?.at ?? null} items={items} />
      <ScheduleSheet open={Boolean(scheduleFor)} onClose={() => setScheduleFor(null)} current={scheduleFor?.startDate ?? null} onPick={(d) => scheduleFor && actions.update.mutate({ id: scheduleFor.id, input: { startDate: d } })} />
      <ActionSheet open={Boolean(moveFor)} onClose={() => setMoveFor(null)} title="Move to list" actions={(listsQ.data ?? []).filter((l) => l.id !== moveFor?.listId).map((l) => ({ label: l.name, onPress: () => moveFor && actions.update.mutate({ id: moveFor.id, input: { listId: l.id } }) }))} />
      <ActionSheet open={Boolean(confirm)} onClose={() => setConfirm(null)} title="Delete this task?" actions={[{ label: "Delete Task", destructive: true, onPress: () => { if (confirm) { setExpanded((id) => (id === confirm.id ? null : id)); actions.remove.mutate(confirm); } } }]} />
    </>
  );
}
