import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import type { CalEvent, Calendar, EventCreate } from "@aravos/shared";
import { localDateTime, toDateString } from "@aravos/shared";
import { Sheet, ActionSheet } from "@/ui/Sheet";
import { Group, Section } from "@/ui/List";
import { TextField, TextArea, FieldRow, Switch } from "@/ui/Field";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { notify } from "@/lib/haptics";
import { fmtTimeRange } from "@/lib/format";
import { RRULE_PRESETS, colorVar } from "./model";
import { useEventMutations } from "./useCalendarData";
import type { Draft } from "./state";

interface Form {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  endDate: string;
  allDay: boolean;
  calendarId: string;
  rrule: string;
  location: string;
  notes: string;
  locked: boolean;
}

function formFrom(d: Draft, defaultCalendar: string): Form {
  const ev = d.event;
  const allDay = ev ? ev.allDay : Boolean(d.allDay);
  const s = new Date(allDay ? (ev?.start ?? d.start).slice(0, 10) + "T00:00:00" : (ev?.start ?? d.start));
  const e = new Date(allDay ? (ev?.end ?? d.end).slice(0, 10) + "T00:00:00" : (ev?.end ?? d.end));
  return {
    title: ev?.title ?? "",
    date: toDateString(s),
    startTime: allDay ? "09:00" : format(s, "HH:mm"),
    endTime: allDay ? "10:00" : format(e, "HH:mm"),
    endDate: toDateString(e),
    allDay,
    calendarId: ev?.calendarId ?? defaultCalendar,
    rrule: (ev?.rrule ?? "").replace(/^RRULE:/, ""),
    location: ev?.location ?? "",
    notes: ev?.notes ?? "",
    locked: ev?.locked ?? false,
  };
}

function SelectRow({ label, value, onChange, options, display }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string; swatch?: string }[]; display?: ReactNode }) {
  return (
    <FieldRow label={label}>
      <span className="relative inline-flex items-center gap-2 text-subhead text-secondary">
        {display ?? options.find((o) => o.value === value)?.label}
        <Icon name="chevron-down" size={16} className="text-quaternary" />
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </FieldRow>
  );
}

function TimeInput({ label, value, onChange, type = "time" }: { label: string; value: string; onChange: (v: string) => void; type?: "time" | "date" }) {
  return (
    <FieldRow label={label}>
      <input type={type} aria-label={label} value={value} step={type === "time" ? 300 : undefined} onChange={(e) => e.target.value && onChange(e.target.value)} className="text-subhead tabular text-secondary bg-transparent text-right outline-none focus:text-primary min-h-[44px] max-w-[160px]" />
    </FieldRow>
  );
}

/**
 * Create or edit an event or time box. Opens at the large detent; Cancel/Done header; asks before
 * discarding edits. Recurring instances ask whether a change applies to this event or all events.
 */
export function EventSheet({ draft, onClose, calendars }: { draft: Draft | null; onClose: () => void; calendars: Calendar[] }) {
  const open = Boolean(draft);
  const defaultCalendar = calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id ?? "";
  const [form, setForm] = useState<Form | null>(null);
  const [initial, setInitial] = useState<Form | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmScope, setConfirmScope] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const m = useEventMutations();
  const ev = draft?.event ?? null;
  const isNew = !ev;
  const recurring = Boolean(ev?.instanceOf || ev?.rrule);
  const timebox = ev?.kind === "timebox";

  useEffect(() => {
    if (!draft) return;
    const f = formFrom(draft, defaultCalendar);
    setForm(f);
    setInitial(f);
    setError(null);
    if (!draft.event) {
      const id = window.setTimeout(() => titleRef.current?.focus(), 350);
      return () => window.clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const dirty = useMemo(() => Boolean(form && initial && JSON.stringify(form) !== JSON.stringify(initial)), [form, initial]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const payload = (): EventCreate | null => {
    if (!form) return null;
    const title = form.title.trim() || (timebox ? ev?.title : "") || "";
    if (!title) {
      setError("Add a title");
      titleRef.current?.focus();
      return null;
    }
    if (form.allDay) {
      const endDate = form.endDate < form.date ? form.date : form.endDate;
      return { title, start: form.date, end: endDate, allDay: true, calendarId: form.calendarId || null, rrule: form.rrule || null, location: form.location.trim() || null, notes: form.notes.trim() || null, locked: form.locked };
    }
    const start = localDateTime(form.date, form.startTime);
    const end = localDateTime(form.date, form.endTime);
    if (end <= start) {
      setError("Choose an end after the start");
      return null;
    }
    return { title, start: start.toISOString(), end: end.toISOString(), allDay: false, calendarId: form.calendarId || null, rrule: form.rrule || null, location: form.location.trim() || null, notes: form.notes.trim() || null, locked: form.locked };
  };

  const save = async (scope?: "this" | "all") => {
    const body = payload();
    if (!body) {
      void notify("error");
      return;
    }
    try {
      if (isNew) await m.create.mutateAsync(body);
      else if (ev) {
        const patch = { ...body };
        if (scope === "all" && initial && form && initial.startTime === form.startTime && initial.endTime === form.endTime && initial.date === form.date && initial.allDay === form.allDay) {
          delete (patch as Partial<EventCreate>).start;
          delete (patch as Partial<EventCreate>).end;
        }
        await m.update.mutateAsync({ ev, patch, scope });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
      void notify("error");
    }
  };

  const onDone = () => {
    if (!isNew && ev?.instanceOf && dirty) {
      if (!payload()) return;
      setConfirmScope(true);
      return;
    }
    void save();
  };

  const remove = async (scope?: "this" | "all") => {
    if (!ev) return;
    try {
      await m.remove.mutateAsync({ ev, scope });
      onClose();
      toast(timebox ? "Time box removed." : "Event deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete");
    }
  };

  const title = timebox ? "Time Box" : isNew ? "New Event" : "Event";
  const timeRow = form && !form.allDay ? fmtTimeRange(localDateTime(form.date, form.startTime).toISOString(), localDateTime(form.date, form.endTime).toISOString()) : null;
  const calendarOptions = calendars.map((c) => ({ value: c.id, label: c.name, swatch: colorVar(c.color) }));
  const selectedCal = calendars.find((c) => c.id === form?.calendarId);

  return (
    <>
      <Sheet open={open} onClose={onClose} title={title} detent="large" dirty={dirty} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" onClick={onDone} disabled={m.create.isPending || m.update.isPending}>{isNew ? "Add" : "Done"}</button>}>
        {form && (
          <div className="flex flex-col pt-2 pb-4">
            <TextField ref={titleRef} label={undefined} placeholder={timebox ? ev?.title : "Title"} value={form.title} onChange={(e) => { set("title", e.target.value); setError(null); }} enterKeyHint="done" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onDone(); } }} error={error === "Add a title" ? error : undefined} className="[&>span]:h-12 [&_input]:text-body" />
            {timeRow && <p className="text-footnote text-secondary tabular mt-2 px-1">{timeRow}</p>}

            <Section className="mt-4">
              <Group inset={false}>
                <FieldRow label="All-day">
                  <Switch checked={form.allDay} onChange={(v) => set("allDay", v)} label="All-day" />
                </FieldRow>
                <TimeInput label={form.allDay ? "Starts" : "Date"} type="date" value={form.date} onChange={(v) => { set("date", v); if (form.endDate < v) set("endDate", v); }} />
                {form.allDay ? (
                  <TimeInput label="Ends" type="date" value={form.endDate} onChange={(v) => set("endDate", v)} />
                ) : (
                  <>
                    <TimeInput label="Starts" value={form.startTime} onChange={(v) => { set("startTime", v); setError(null); }} />
                    <TimeInput label="Ends" value={form.endTime} onChange={(v) => { set("endTime", v); setError(null); }} />
                  </>
                )}
                {error && error !== "Add a title" && <p className="text-footnote text-danger-text px-[var(--gutter)] py-2 bg-surface">{error}</p>}
              </Group>
            </Section>

            <Section className="mt-6">
              <Group inset={false}>
                {!timebox && (
                  <SelectRow
                    label="Calendar"
                    value={form.calendarId}
                    onChange={(v) => set("calendarId", v)}
                    options={calendarOptions}
                    display={
                      <span className="inline-flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorVar(selectedCal?.color) }} />
                        {selectedCal?.name ?? "Calendar"}
                      </span>
                    }
                  />
                )}
                {!timebox && <SelectRow label="Repeat" value={form.rrule} onChange={(v) => set("rrule", v)} options={RRULE_PRESETS} />}
                {timebox && (
                  <FieldRow label="Locked">
                    <Switch checked={form.locked} onChange={(v) => set("locked", v)} label="Locked" />
                  </FieldRow>
                )}
              </Group>
              {timebox && <p className="text-footnote text-secondary pt-2">A locked time box stays where it is when the planner runs.</p>}
            </Section>

            {!timebox && (
              <Section className="mt-6">
                <div className="flex flex-col gap-3">
                  <TextField placeholder="Location" aria-label="Location" value={form.location} onChange={(e) => set("location", e.target.value)} leading={<Icon name="home" size={18} className="text-tertiary" />} />
                  <TextArea placeholder="Notes" aria-label="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
                </div>
              </Section>
            )}

            {timebox && ev?.taskId && (
              <Section className="mt-6">
                <div className="flex gap-3">
                  <Button variant="secondary" full onClick={() => { void m.completeTask.mutateAsync(ev).then(() => { onClose(); toast("Task completed."); }); }} disabled={ev.taskStatus === "done"}>
                    Complete Task
                  </Button>
                </div>
              </Section>
            )}

            {!isNew && (
              <div className={cn("mt-8 flex justify-center")}>
                <Button variant="destructive" onClick={() => setConfirmDelete(true)}>{timebox ? "Remove Time Box" : "Delete Event"}</Button>
              </div>
            )}
          </div>
        )}
      </Sheet>
      <ActionSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={recurring ? "Delete this repeating event?" : timebox ? "Remove this time box?" : "Delete this event?"}
        actions={recurring ? [{ label: "Delete This Event", destructive: true, onPress: () => void remove("this") }, { label: "Delete All Events", destructive: true, onPress: () => void remove("all") }] : [{ label: timebox ? "Remove Time Box" : "Delete Event", destructive: true, onPress: () => void remove() }]}
      />
      <ActionSheet open={confirmScope} onClose={() => setConfirmScope(false)} title="Save changes for" actions={[{ label: "This Event", onPress: () => void save("this") }, { label: "All Events", onPress: () => void save("all") }]} />
    </>
  );
}
