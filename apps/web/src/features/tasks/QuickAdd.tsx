import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { parseTaskInput, localDateTime, todayString } from "@aravos/shared";
import { useUi } from "@/state/ui";
import { useLists } from "@/data/queries";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/hooks";
import { fmtMinutes, fmtRelativeDate } from "@/lib/format";
import { Sheet } from "@/ui/Sheet";
import { Chip } from "@/ui/Field";
import { Icon } from "@/ui/Icon";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { toast } from "@/ui/Toast";
import { notify } from "@/lib/haptics";
import { colorVar } from "@/features/calendar/model";
import { useTaskActions } from "./useTaskActions";
import { priorityLabel } from "./model";

interface QuickAddPrefs {
  listId: string | null;
  setListId: (id: string | null) => void;
}
/** The list a quick-added task goes to (the list screen sets it while open). */
export const useQuickAddPrefs = create<QuickAddPrefs>((set) => ({ listId: null, setListId: (listId) => set({ listId }) }));

type Kind = "task" | "event";
const KINDS: { value: Kind; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "event", label: "Event" },
];

function detectEvent(text: string): { isEvent: boolean; body: string } {
  const m = /^(event|\/calendar)\s+/i.exec(text) ?? /\s\/calendar\b/i.exec(text);
  if (!m) return { isEvent: false, body: text };
  return { isEvent: true, body: text.replace(/^(event|\/calendar)\s+/i, "").replace(/\s\/calendar\b/i, "") };
}

/**
 * One input, parsed as you type: "Call dentist tomorrow 4pm !high 30m #health". Enter adds and keeps
 * the sheet open for the next one. Opens from the Add button and from `useUi.quickAddOpen`.
 */
export function QuickAdd() {
  const open = useUi((s) => s.quickAddOpen);
  const setOpen = useUi((s) => s.setQuickAdd);
  const listId = useQuickAddPrefs((s) => s.listId);
  const setListId = useQuickAddPrefs((s) => s.setListId);
  const isDesktop = useIsDesktop();
  const lists = useLists();
  const actions = useTaskActions();
  const [text, setText] = useState("");
  const [kindOverride, setKind] = useState<Kind | null>(null);
  const [listMenu, setListMenu] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);

  // Focus happens in <Sheet initialFocus>, after the sheet has finished sliding in.
  useEffect(() => {
    if (open) return;
    setText("");
    setKind(null);
  }, [open]);

  const detected = detectEvent(text);
  const kind: Kind = kindOverride ?? (detected.isEvent ? "event" : "task");
  const parsed = useMemo(() => parseTaskInput(detected.body), [detected.body]);
  const list = (lists.data ?? []).find((l) => l.id === listId) ?? (lists.data ?? []).find((l) => l.isDefault);

  const chips: { key: string; text: string; icon?: "calendar" | "clock" | "flag" | "timer" }[] = [];
  if (parsed.dueDate) chips.push({ key: "date", text: fmtRelativeDate(parsed.dueDate), icon: "calendar" });
  if (parsed.dueTime) chips.push({ key: "time", text: parsed.dueTime, icon: "clock" });
  if (parsed.priority) chips.push({ key: "pri", text: priorityLabel(parsed.priority), icon: "flag" });
  if (parsed.estimateMinutes) chips.push({ key: "est", text: fmtMinutes(parsed.estimateMinutes), icon: "timer" });
  for (const t of parsed.tags) chips.push({ key: `tag-${t}`, text: `#${t}` });

  const submit = async () => {
    const raw = text.trim();
    if (!raw || busy) return;
    setBusy(true);
    try {
      if (kind === "event") {
        const date = parsed.dueDate ?? todayString();
        const start = localDateTime(date, parsed.dueTime ?? "09:00");
        const end = new Date(start.getTime() + (parsed.estimateMinutes ?? 60) * 60000);
        const title = parsed.title || raw;
        await api.post("/api/events", { title, start: start.toISOString(), end: end.toISOString() });
        actions.create.reset();
        actions.quick.reset();
      } else {
        await actions.quick.mutateAsync({ text: detected.body, listId: list?.id ?? null });
      }
      setText("");
      setKind(null);
      setCount((c) => c + 1);
      toast(kind === "event" ? "Event added." : "Added.");
      ref.current?.focus();
    } catch (e) {
      void notify("error");
      toast(e instanceof Error ? e.message : "Unable to add");
    } finally {
      setBusy(false);
    }
  };

  const close = () => setOpen(false);

  return (
    <>
      <Sheet open={open} onClose={close} title="Quick Add" detent="auto" initialFocus={ref} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={!text.trim() || busy} onClick={() => void submit()}>Add</button>}>
        <div className="pt-2 pb-3 flex flex-col gap-3" data-quick-add>
          <div className={cn("well flex items-center gap-2.5 h-[52px] pl-3.5 pr-3 rounded-[16px] focus-within:shadow-[inset_0_0_0_1px_var(--glass-edge),0_0_0_4px_var(--accent-soft)] transition-shadow duration-200")}>
            <Icon name={kind === "event" ? "calendar" : "plus"} size={18} strokeWidth={1.7} className="text-tertiary shrink-0" />
            <input
              ref={ref}
              aria-label={kind === "event" ? "New event" : "New task"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === "event" ? "Lunch with Sam tomorrow 12:30 1h" : "Call dentist tomorrow 4pm !high 30m #health"}
              enterKeyHint="done"
              autoCapitalize="sentences"
              className="flex-1 min-w-0 h-full bg-transparent outline-none text-[16px] text-primary placeholder:text-quaternary"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap min-h-7">
            {chips.map((c) => (
              <span key={c.key} className="enter inline-flex items-center gap-1 h-6 px-2 rounded-[7px] well text-secondary text-[12px] tabular" data-chip={c.key}>
                {c.icon && <Icon name={c.icon} size={12} strokeWidth={1.7} className="text-tertiary" />}
                {c.text}
              </span>
            ))}
            {kind === "task" && (
              <span ref={chipRef} className="inline-flex">
                <Chip
                  onClick={() => {
                    const r = chipRef.current?.getBoundingClientRect();
                    setListMenu(r ? { x: r.left + r.width / 2, y: r.bottom } : { x: 100, y: 200 });
                  }}
                  className="inline-flex items-center gap-1.5 !h-7 !px-2.5 !text-[12px]"
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: colorVar(list?.color ?? "gray") }} />
                  {list?.name ?? "Inbox"}
                  <Icon name="chevron-down" size={12} className="text-tertiary" />
                </Chip>
              </span>
            )}
            {text.trim() && <span className="text-[12px] text-tertiary truncate ml-auto max-w-[45%]">{parsed.title || "Untitled"}</span>}
          </div>
          <div className="flex items-center justify-between gap-3">
            <Segmented size="sm" className="w-[150px]" options={KINDS} value={kind} onChange={(v) => setKind(v)} />
            <span className="text-[12px] text-tertiary tabular">{count > 0 ? `${count} added` : isDesktop ? "Enter adds, Esc closes" : "Enter adds"}</span>
          </div>
        </div>
      </Sheet>
      <Menu
        open={Boolean(listMenu)}
        onClose={() => setListMenu(null)}
        anchor={listMenu}
        items={(lists.data ?? []).map((l) => ({ label: l.name, onPress: () => setListId(l.id) }))}
      />
    </>
  );
}
