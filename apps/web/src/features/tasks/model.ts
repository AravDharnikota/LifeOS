import { format } from "date-fns";
import type { Task, TaskList } from "@aravos/shared";
import { parseDateString, toDateString, todayString } from "@aravos/shared";
import { fmtMinutes, fmtRelativeDate, fmtTime } from "@/lib/format";
import { colorVar } from "@/features/calendar/model";

export type ListWithCount = TaskList & { openCount: number };
export type ListMap = Map<string, ListWithCount>;

export interface TaskGroupData {
  key: string;
  title: string;
  /** Secondary text next to the title, e.g. the full date under "Tomorrow". */
  detail?: string;
  tasks: Task[];
  tone?: "danger";
  /** Start collapsed (Done today). */
  collapsed?: boolean;
  /** Rows disappear after completion (lists of open tasks). */
  hideDone?: boolean;
  /** Color dot before the title (Anytime groups by list). */
  color?: string;
  reorderable?: boolean;
  /** Show the list name in each row (off when the group is the list). */
  showList?: boolean;
}

export const ESTIMATES = [15, 30, 60, 120] as const;
export const PRIORITIES: { value: string; label: string }[] = [
  { value: "0", label: "None" },
  { value: "1", label: "Low" },
  { value: "2", label: "Medium" },
  { value: "3", label: "High" },
];

export function isOverdue(t: Task, today = todayString()): boolean {
  return t.status === "open" && Boolean(t.dueDate) && t.dueDate! < today;
}

export function blockOn(t: Task, date: string): { start: string; end: string } | undefined {
  return (t.scheduledBlocks ?? []).find((b) => toDateString(new Date(b.start)) === date);
}

const byOrder = (a: Task, b: Task) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
const byDue = (a: Task, b: Task) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || (a.dueTime ?? "").localeCompare(b.dueTime ?? "") || byOrder(a, b);

export function groupToday(tasks: Task[], today = todayString()): TaskGroupData[] {
  const open = tasks.filter((t) => t.status === "open");
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today).sort(byDue);
  const dueToday = open.filter((t) => t.dueDate === today).sort(byOrder);
  const scheduled = open
    .filter((t) => !overdue.includes(t) && !dueToday.includes(t))
    .sort((a, b) => {
      const ba = blockOn(a, today)?.start ?? "~";
      const bb = blockOn(b, today)?.start ?? "~";
      return ba.localeCompare(bb) || byOrder(a, b);
    });
  const done = tasks.filter((t) => t.status === "done" && t.completedAt && toDateString(new Date(t.completedAt)) === today).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const groups: TaskGroupData[] = [];
  if (overdue.length) groups.push({ key: "overdue", title: "Overdue", tasks: overdue, tone: "danger", hideDone: true });
  if (dueToday.length) groups.push({ key: "due", title: "Due today", tasks: dueToday, hideDone: true, reorderable: true });
  if (scheduled.length) groups.push({ key: "scheduled", title: "Scheduled", tasks: scheduled, hideDone: true, reorderable: true });
  if (done.length) groups.push({ key: "done", title: "Done today", tasks: done, collapsed: true });
  return groups;
}

export function upcomingDate(t: Task, today = todayString()): string | null {
  const c = [t.startDate, t.dueDate].filter((d): d is string => Boolean(d) && d! > today).sort();
  return c[0] ?? null;
}

export function groupUpcoming(tasks: Task[], today = todayString()): TaskGroupData[] {
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.status !== "open") continue;
    const d = upcomingDate(t, today);
    if (!d) continue;
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, list]) => {
      const rel = fmtRelativeDate(d);
      const full = format(parseDateString(d), "EEE d MMM");
      return { key: d, title: rel, detail: rel !== full ? full : undefined, tasks: list.sort(byDue), hideDone: true, reorderable: true };
    });
}

export function groupByList(tasks: Task[], lists: ListWithCount[]): TaskGroupData[] {
  const order = new Map(lists.map((l, i) => [l.id, i]));
  const byList = new Map<string | null, Task[]>();
  for (const t of tasks) {
    if (t.status !== "open") continue;
    byList.set(t.listId, [...(byList.get(t.listId) ?? []), t]);
  }
  return [...byList.entries()]
    .sort(([a], [b]) => (order.get(a ?? "") ?? 99) - (order.get(b ?? "") ?? 99))
    .map(([id, list]) => {
      const l = lists.find((x) => x.id === id);
      return { key: id ?? "none", title: l?.name ?? "No list", color: colorVar(l?.color ?? "gray"), tasks: list.sort(byOrder), hideDone: true, reorderable: true, showList: false };
    });
}

export function groupLogbook(tasks: Task[]): TaskGroupData[] {
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.status !== "done") continue;
    const d = toDateString(new Date(t.completedAt ?? t.updatedAt));
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([d, list]) => ({ key: d, title: fmtRelativeDate(d), tasks: list.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")) }));
}

export interface MetaPart {
  text: string;
  tone?: "danger" | "accent";
  dot?: string;
  chip?: boolean;
}

/** The one-line subtitle under a task title. Numbers lead, words add context. */
export function taskMeta(t: Task, lists: ListMap, opts: { showList?: boolean; date?: string } = {}): MetaPart[] {
  const today = todayString();
  const date = opts.date ?? today;
  const parts: MetaPart[] = [];
  const block = blockOn(t, date);
  if (block) parts.push({ text: `${fmtTime(block.start)} to ${fmtTime(block.end)}`, tone: "accent" });
  if (t.dueDate) {
    const over = t.status === "open" && t.dueDate < today;
    const when = t.dueDate === date ? (t.dueTime ? `Due ${t.dueTime}` : "Due today") : `Due ${fmtRelativeDate(t.dueDate)}${t.dueTime ? " " + t.dueTime : ""}`;
    parts.push({ text: when, tone: over ? "danger" : undefined });
  } else if (t.startDate && t.startDate !== date && !block) {
    parts.push({ text: fmtRelativeDate(t.startDate) });
  }
  if (t.estimateMinutes) parts.push({ text: fmtMinutes(t.estimateMinutes), chip: true });
  const list = t.listId ? lists.get(t.listId) : undefined;
  if (opts.showList !== false && list && !list.isDefault) parts.push({ text: list.name, dot: colorVar(list.color ?? "gray") });
  for (const tag of t.tags) parts.push({ text: `#${tag}` });
  return parts;
}

export function priorityLabel(p: number): string {
  return PRIORITIES.find((x) => Number(x.value) === p)?.label ?? "None";
}
