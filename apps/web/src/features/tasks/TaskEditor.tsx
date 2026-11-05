import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Task } from "@aravos/shared";
import { api } from "@/lib/api";
import { keys } from "@/data/queries";
import { cn } from "@/lib/cn";
import { fmtMinutes } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Icon } from "@/ui/Icon";
import { RRULE_PRESETS, colorVar } from "@/features/calendar/model";
import { ESTIMATES, PRIORITIES, type ListMap } from "./model";
import type { TaskActions } from "./useTaskActions";

/** One property line inside the editor's well: quiet label on the left, value on the right. */
function Prop({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center min-h-[44px] gap-3 px-3 py-1.5", className)}>
      <span className="w-[60px] shrink-0 text-[13px] text-tertiary">{label}</span>
      <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">{children}</div>
    </div>
  );
}

/** Small selectable pill for estimate and priority. */
function PropChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cn("h-7 px-2.5 rounded-full text-[13px] tabular whitespace-nowrap transition-colors duration-150", selected ? "bg-primary text-canvas" : "bg-pressed text-secondary")}>
      {children}
    </button>
  );
}

const inputCls = "text-[14px] tabular text-primary bg-pressed rounded-[8px] h-7 px-2 outline-none focus:ring-1 focus:ring-accent/50 transition-shadow duration-150";

function NativeSelect({ value, onChange, options, label, display }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; display?: ReactNode }) {
  return (
    <span className="relative inline-flex items-center gap-1.5 h-7 px-2 rounded-[8px] bg-pressed text-[14px] text-primary">
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

/** The title, edited in place of the row title. Enter or blur saves; Escape restores. Opening a task never pops the keyboard: the user taps the title to type. */
export function TaskTitleInput({ task, actions, onClose, autoFocus = false }: { task: Task; actions: TaskActions; onClose: () => void; autoFocus?: boolean }) {
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
      className="w-full bg-transparent outline-none text-primary py-3 leading-[21px]"
      style={{ fontSize: 16 }}
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
    <div className="pl-[var(--gutter)] pr-3 pb-3" data-task-editor onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <textarea ref={notesRef} aria-label="Notes" value={notes} placeholder="Notes" rows={1} onChange={(e) => setNotes(e.target.value)} onBlur={commitNotes} className="block w-full pl-[34px] bg-transparent outline-none text-[15px] text-secondary placeholder:text-quaternary resize-none leading-[22px] overflow-hidden -mt-1.5" style={{ fontSize: 16 }} />

      <div className="mt-2 well rounded-[14px] flex flex-col divide-y divide-separator">
        <Prop label="When">
          <input type="date" aria-label="When" value={task.startDate ?? ""} onChange={(e) => save({ startDate: e.target.value || null })} className={cn(inputCls, "w-[132px]")} />
          {task.startDate && (
            <button type="button" className="text-[12px] text-tertiary h-7 px-1.5" onClick={() => save({ startDate: null })}>
              Clear
            </button>
          )}
        </Prop>
        <Prop label="Deadline">
          <input type="date" aria-label="Deadline" value={task.dueDate ?? ""} onChange={(e) => save({ dueDate: e.target.value || null, ...(e.target.value ? {} : { dueTime: null }) })} className={cn(inputCls, "w-[132px]")} />
          {task.dueDate && <input type="time" aria-label="Deadline time" value={task.dueTime ?? ""} step={300} onChange={(e) => save({ dueTime: e.target.value || null })} className={cn(inputCls, "w-[104px]")} />}
        </Prop>
        <Prop label="Estimate">
          {ESTIMATES.map((m) => (
            <PropChip key={m} selected={task.estimateMinutes === m} onClick={() => save({ estimateMinutes: task.estimateMinutes === m ? null : m })}>
              {fmtMinutes(m)}
            </PropChip>
          ))}
        </Prop>
        <Prop label="Priority">
          {PRIORITIES.filter((p) => p.value !== "0").map((p) => (
            <PropChip key={p.value} selected={String(task.priority) === p.value} onClick={() => save({ priority: String(task.priority) === p.value ? 0 : Number(p.value) })}>
              {p.label}
            </PropChip>
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
          <input aria-label="Tags" value={tags} placeholder="errand, home" onChange={(e) => setTags(e.target.value)} onBlur={commitTags} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} className={cn(inputCls, "w-full max-w-[260px] placeholder:text-quaternary")} style={{ fontSize: 16 }} />
        </Prop>
        <Prop label="Repeat">
          <NativeSelect label="Repeat" value={rrule} onChange={(v) => save({ recurrence: v || null })} options={RRULE_PRESETS} />
        </Prop>
      </div>

      <div className="mt-2 pl-[36px]">
        {subtasks.map((s) => (
          <div key={s.id} className="flex items-center gap-3 min-h-[40px]">
            <Checkbox checked={s.status === "done"} onChange={(v) => toggleSub(s, v)} size={18} label={s.title} />
            <span className={cn("text-[15px] flex-1 min-w-0 truncate transition-colors duration-200", s.status === "done" ? "text-tertiary" : "text-primary")}>{s.title}</span>
          </div>
        ))}
        <div className="flex items-center gap-3 min-h-[40px]">
          <span className="w-[18px] h-[18px] rounded-full border border-dashed border-separator-strong shrink-0 inline-flex items-center justify-center">
            <Icon name="plus" size={10} className="text-tertiary" />
          </span>
          <input aria-label="Add subtask" value={sub} placeholder="Add subtask" onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSubtask()} onBlur={addSubtask} className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-primary placeholder:text-quaternary" style={{ fontSize: 16 }} enterKeyHint="done" />
        </div>
      </div>

      <div className="mt-2 pl-[26px] flex items-center gap-1">
        <Button variant="plain" size="sm" loading={actions.schedule.isPending} onClick={() => actions.schedule.mutate(task)} leading={<Icon name="bolt" size={15} strokeWidth={1.7} />} className="!text-[13px] !font-normal">
          Schedule
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} className="!text-[13px] !font-normal">
          Delete
        </Button>
        <div className="flex-1" />
        <Button variant="primary" size="sm" onClick={onClose} className="!h-8 !px-4 !text-[13px]">
          Done
        </Button>
      </div>
    </div>
  );
}
