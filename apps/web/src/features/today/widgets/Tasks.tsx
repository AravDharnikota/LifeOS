import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { todayString, type Task } from "@aravos/shared";
import { useLists, useTasks } from "@/data/queries";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtRelativeDate } from "@/lib/format";
import { notify } from "@/lib/haptics";
import { Checkbox } from "@/ui/Checkbox";
import { Icon } from "@/ui/Icon";
import { Spinner } from "@/ui/Spinner";
import { ThinBar } from "@/ui/viz";
import type { WidgetOf, WidgetProps } from "../types";
import { WidgetError, WidgetLabel, WidgetSkeleton, WriteError } from "./shared";

const FILTER_LABEL: Record<WidgetOf<"tasks">["filter"], string> = { today: "Tasks", overdue: "Overdue", upcoming: "Upcoming", list: "List" };

/** A task list like a "Getting Started" card: progress bar with %, rows in a white well with circle checks, and an inline quick add as the last row. */
export function TasksWidget({ widget, sectionTitle, editing }: WidgetProps<WidgetOf<"tasks">>) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lists = useLists();
  const today = todayString();
  const params = { view: widget.filter, listId: widget.filter === "list" ? widget.listId : undefined, limit: widget.limit + 20 };
  const query = useTasks(params);
  const [local, setLocal] = useState<Record<string, "done" | "open">>({});
  const [added, setAdded] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Server data wins once it arrives; local overrides are dropped when they match.
  useEffect(() => {
    if (!query.data) return;
    setAdded((prev) => prev.filter((t) => !query.data.some((s) => s.id === t.id)));
    setLocal((prev) => {
      const next = { ...prev };
      for (const t of query.data) if (next[t.id] === t.status) delete next[t.id];
      return next;
    });
  }, [query.data]);

  const server = query.data ?? [];
  const tasks = [...added.filter((a) => !server.some((s) => s.id === a.id)), ...server].filter((t) => t.status !== "cancelled" && !t.parentId);
  const statusOf = (t: Task) => local[t.id] ?? t.status;
  const open = tasks.filter((t) => statusOf(t) === "open");
  const done = tasks.filter((t) => statusOf(t) === "done");
  const shown = [...open, ...done].slice(0, widget.limit);
  const more = open.length + done.length - shown.length;

  const toggle = async (t: Task, next: boolean) => {
    setLocal((p) => ({ ...p, [t.id]: next ? "done" : "open" }));
    try {
      await api.post(`/api/tasks/${t.id}/${next ? "complete" : "reopen"}`);
      if (next) void notify("success");
    } catch {
      setLocal((p) => ({ ...p, [t.id]: next ? "open" : "done" }));
    } finally {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["summary"] });
    }
  };

  const add = async () => {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    setError(null);
    try {
      let task = await api.post<Task>("/api/tasks/quick", { text, listId: widget.filter === "list" ? (widget.listId ?? null) : undefined });
      if (widget.filter === "today" && !task.dueDate) task = await api.patch<Task>(`/api/tasks/${task.id}`, { dueDate: todayString() });
      setAdded((p) => [task, ...p]);
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      void qc.invalidateQueries({ queryKey: ["summary"] });
    } catch {
      setError("Unable to add task.");
    } finally {
      setAdding(false);
      inputRef.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void add();
    }
    if (e.key === "Escape") setDraft("");
  };

  const listName = widget.filter === "list" ? lists.data?.find((l) => l.id === widget.listId)?.name : undefined;
  const label = widget.title ?? listName ?? FILTER_LABEL[widget.filter];
  const total = open.length + done.length;
  const pct = total > 0 ? Math.round((done.length / total) * 100) : 0;
  const emptyText = widget.filter === "overdue" ? "Nothing overdue." : widget.filter === "upcoming" ? "Nothing coming up." : "No tasks today.";
  const sub = !query.data ? undefined : total === 0 ? emptyText : open.length === 0 ? "All done for now." : `${open.length} open, ${done.length} done`;

  return (
    <>
      {label !== sectionTitle ? (
        <WidgetLabel icon="checklist" sub={sub}>{label}</WidgetLabel>
      ) : (
        sub && <p className="text-[12px] leading-4 text-tertiary mb-3">{sub}</p>
      )}
      {query.isPending ? (
        <WidgetSkeleton lines={3} />
      ) : query.isError ? (
        <WidgetError onRetry={() => void query.refetch()} />
      ) : (
        <>
          {total > 0 && (
            <div className="flex items-center gap-3 mb-3">
              <ThinBar progress={done.length / total} color="var(--success)" height={6} className="flex-1" />
              <span className="text-[12px] leading-4 tabular text-success-text w-9 text-right">{pct}%</span>
            </div>
          )}
          <div className="well rounded-md overflow-hidden">
            {shown.length > 0 && (
              <ul className="flex flex-col">
                {shown.map((t) => {
                  const isDone = statusOf(t) === "done";
                  return (
                    <li key={t.id} className="relative hairline-b">
                      <div
                        role="button"
                        tabIndex={editing ? -1 : 0}
                        onClick={() => navigate("/tasks")}
                        onKeyDown={(e) => { if (e.key === "Enter") navigate("/tasks"); }}
                        className="flex items-center gap-3 min-h-[44px] px-3 cursor-pointer row-hover active:bg-pressed transition-colors duration-150"
                      >
                        <Checkbox checked={isDone} onChange={(v) => void toggle(t, v)} label={t.title} tint={t.priority >= 3 ? "var(--danger)" : undefined} />
                        <span className={cn("flex-1 min-w-0 text-[14px] leading-5 truncate transition-colors duration-200", isDone ? "text-tertiary line-through decoration-[1px] decoration-quaternary" : "text-primary")}>{t.title}</span>
                        {!isDone && t.dueDate && (widget.filter !== "today" || t.dueDate < today) && <span className={cn("text-[12px] tabular shrink-0", t.dueDate < today ? "text-danger-text" : "text-tertiary")}>{fmtRelativeDate(t.dueDate)}</span>}
                        {!isDone && t.dueTime && <span className="text-[12px] text-tertiary tabular shrink-0">{t.dueTime}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {more > 0 && (
              <button type="button" className="w-full text-left text-[13px] text-accent-text min-h-[40px] px-3 hairline-b active:bg-pressed" onClick={() => navigate("/tasks")}>
                {more} more
              </button>
            )}
            <div className="flex items-center gap-3 min-h-[44px] px-3">
              <span className="w-[22px] h-[22px] shrink-0 inline-flex items-center justify-center text-tertiary" aria-hidden="true">
                {adding ? <Spinner size={16} /> : <Icon name="plus" size={18} strokeWidth={1.8} />}
              </span>
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                placeholder="Add task"
                aria-label="Add task"
                enterKeyHint="done"
                autoCapitalize="sentences"
                disabled={editing}
                className="flex-1 min-w-0 bg-transparent text-[14px] leading-5 text-primary placeholder:text-tertiary outline-none py-2"
              />
            </div>
          </div>
        </>
      )}
      {error && <WriteError message={error} onRetry={() => void add()} />}
    </>
  );
}
