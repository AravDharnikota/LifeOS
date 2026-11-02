import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Task } from "@aravos/shared";
import { api } from "@/lib/api";
import { keys } from "@/data/queries";
import { cn } from "@/lib/cn";
import { fmtMinutes } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Chip } from "@/ui/Field";
import { Icon } from "@/ui/Icon";
import { RRULE_PRESETS, colorVar } from "@/features/calendar/model";
import { ESTIMATES, PRIORITIES, type ListMap } from "./model";
import type { TaskActions } from "./useTaskActions";

function Prop({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center min-h-[36px] gap-3", className)}>
      <span className="w-[72px] shrink-0 text-footnote text-secondary">{label}</span>
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  );
}

const inputCls = "text-subhead tabular text-primary bg-surface-2 rounded-xs h-7 px-2 outline-none focus:bg-surface focus:ring-1 focus:ring-accent";

function NativeSelect({ value, onChange, options, label, display }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; display?: ReactNode }) {
  return (
    <span className="relative inline-flex items-center gap-1.5 h-7 px-2 rounded-xs bg-surface-2 text-subhead text-primary">
      {display ?? options.find((o) => o.value === value)?.label ?? label}
      <Icon name="chevron-down" size={14} className="text-tertiary" />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** The title, edited in place of the row title. Enter or blur saves; Escape restores. */
export function TaskTitleInput({ task, actions, onClose, autoFocus = true }: { task: Task; actions: TaskActions; onClose: () => void; autoFocus?: boolean }) {
  const [title, setTitle] = useState(task.title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 30);
    return () => window.clearTimeout(id);
  }, [autoFocus]);
  const commit = () => {
    const t = title.trim();
    if (!t) {
      setTitle(task.title);
      return;
    }
    if (t !== task.title) actions.update.mutate({ id: task.id, input: { title: t } });
  };
  return (
    <input
      ref={ref}
      aria-label="Title"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          onClose();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setTitle(task.title);
          onClose();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="w-full bg-transparent outline-none text-body font-medium text-primary py-[11px]"
      style={{ fontSize: 17 }}
      enterKeyHint="done"
    />
  );
}

/** Things-style inline editor body: notes, properties, subtasks, actions. Every change saves at once. */
export function TaskEditor({ task, lists, actions, onClose, onDelete }: { task: Task; lists: ListMap; actions: TaskActions; onClose: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(task.notes ?? "");
  const [tags, setTags] = useState(task.tags.join(", "));
  const [sub, setSub] = useState("");
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const detail = useQuery({ queryKey: keys.task(task.id), queryFn: () => api.get<Task & { subtasks: Task[] }>(`/api/tasks/${task.id}`) });
  const subtasks = detail.data?.subtasks ?? [];

  useEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(22, el.scrollHeight)}px`;
  }, [notes]);

  const save = (input: Parameters<TaskActions["update"]["mutate"]>[0]["input"]) => actions.update.mutate({ id: task.id, input });
  const commitNotes = () => {
    const n = notes.trim();
    if (n !== (task.notes ?? "")) save({ notes: n || null });
  };
  const commitTags = () => {
    const list = tags.split(/[,\s]+/).map((s) => s.replace(/^#/, "").trim().toLowerCase()).filter(Boolean);
    if (list.join(",") !== task.tags.join(",")) save({ tags: [...new Set(list)] });
  };
  const addSubtask = () => {
    const t = sub.trim();
    if (!t) return;
    setSub("");
    void actions.create.mutateAsync({ title: t, parentId: task.id }).then(() => qc.invalidateQueries({ queryKey: keys.task(task.id) }));
  };
  const toggleSub = (s: Task, done: boolean) => {
    qc.setQueryData<Task & { subtasks: Task[] }>(keys.task(task.id), (old) => (old ? { ...old, subtasks: old.subtasks.map((x) => (x.id === s.id ? { ...x, status: done ? "done" : "open" } : x)) } : old));
    void api.post(`/api/tasks/${s.id}/${done ? "complete" : "reopen"}`, {}).then(() => qc.invalidateQueries({ queryKey: keys.task(task.id) }));
  };
  const list = task.listId ? lists.get(task.listId) : undefined;
  const listOptions = [...lists.values()].map((l) => ({ value: l.id, label: l.name }));
  const rrule = (task.recurrence ?? "").replace(/^RRULE:/, "");

  return (
    <div className="pl-[calc(var(--gutter)+34px)] pr-[var(--gutter)] pb-3" data-task-editor onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <textarea ref={notesRef} aria-label="Notes" value={notes} placeholder="Notes" rows={1} onChange={(e) => setNotes(e.target.value)} onBlur={commitNotes} className="w-full bg-transparent outline-none text-subhead text-primary placeholder:text-tertiary resize-none leading-[22px] overflow-hidden -mt-1" style={{ fontSize: 16 }} />

      <div className="mt-2 flex flex-col gap-0.5">
        <Prop label="When">
          <input type="date" aria-label="When" value={task.startDate ?? ""} onChange={(e) => save({ startDate: e.target.value || null })} className={inputCls} />
          {task.startDate && (
            <button type="button" className="text-footnote text-secondary h-7 px-1" onClick={() => save({ startDate: null })}>
              Clear
            </button>
          )}
        </Prop>
        <Prop label="Deadline">
          <input type="date" aria-label="Deadline" value={task.dueDate ?? ""} onChange={(e) => save({ dueDate: e.target.value || null, ...(e.target.value ? {} : { dueTime: null }) })} className={inputCls} />
          {task.dueDate && <input type="time" aria-label="Deadline time" value={task.dueTime ?? ""} step={300} onChange={(e) => save({ dueTime: e.target.value || null })} className={inputCls} />}
        </Prop>
        <Prop label="Estimate">
          {ESTIMATES.map((m) => (
            <Chip key={m} selected={task.estimateMinutes === m} onClick={() => save({ estimateMinutes: task.estimateMinutes === m ? null : m })}>
              {fmtMinutes(m)}
            </Chip>
          ))}
        </Prop>
        <Prop label="Priority">
          {PRIORITIES.filter((p) => p.value !== "0").map((p) => (
            <Chip key={p.value} selected={String(task.priority) === p.value} onClick={() => save({ priority: String(task.priority) === p.value ? 0 : Number(p.value) })}>
              {p.label}
            </Chip>
          ))}
        </Prop>
        <Prop label="List">
          <NativeSelect
            label="List"
            value={task.listId ?? ""}
            onChange={(v) => save({ listId: v || null })}
            options={listOptions}
            display={
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: colorVar(list?.color ?? "gray") }} />
                {list?.name ?? "List"}
              </span>
            }
          />
        </Prop>
        <Prop label="Tags">
          <input aria-label="Tags" value={tags} placeholder="errand, home" onChange={(e) => setTags(e.target.value)} onBlur={commitTags} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} className={cn(inputCls, "w-full max-w-[260px] placeholder:text-tertiary")} style={{ fontSize: 16 }} />
        </Prop>
        <Prop label="Repeat">
          <NativeSelect label="Repeat" value={rrule} onChange={(v) => save({ recurrence: v || null })} options={RRULE_PRESETS} />
        </Prop>
      </div>

      <div className="mt-2">
        {subtasks.map((s) => (
          <div key={s.id} className="flex items-center gap-3 min-h-[36px]">
            <Checkbox checked={s.status === "done"} onChange={(v) => toggleSub(s, v)} size={18} label={s.title} />
            <span className={cn("text-subhead flex-1 min-w-0 truncate", s.status === "done" ? "text-secondary" : "text-primary")}>{s.title}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 min-h-[36px]">
          <span className="w-[18px] h-[18px] rounded-full border border-dashed border-border shrink-0 inline-flex items-center justify-center">
            <Icon name="plus" size={10} className="text-tertiary" />
          </span>
          <input aria-label="Add subtask" value={sub} placeholder="Add subtask" onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSubtask()} onBlur={addSubtask} className="flex-1 min-w-0 bg-transparent outline-none text-subhead text-primary placeholder:text-tertiary" style={{ fontSize: 16 }} enterKeyHint="done" />
        </div>
      </div>

      <div className="mt-1 -ml-2 -mr-2 flex items-center">
        <Button variant="plain" size="sm" loading={actions.schedule.isPending} onClick={() => actions.schedule.mutate(task)} leading={<Icon name="bolt" size={16} />}>
          Schedule
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          Delete
        </Button>
        <div className="flex-1" />
        <Button variant="plain" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
