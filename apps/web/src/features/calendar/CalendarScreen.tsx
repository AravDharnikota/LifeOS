import { useCallback, useMemo, useState } from "react";
import { format } from "date-fns";
import type { CalEvent, Task } from "@aravos/shared";
import { parseDateString, todayString } from "@aravos/shared";
import { useHotkey, useIsDesktop, useNow } from "@/lib/hooks";
import { fmtMinutes, fmtTimeRange, plural } from "@/lib/format";
import { useUi } from "@/state/ui";
import { IconButton, Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Segmented } from "@/ui/Segmented";
import { Menu, type MenuItem } from "@/ui/Menu";
import { ActionSheet } from "@/ui/Sheet";
import { InlineError } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { useCalendar } from "./state";
import { useCalendarData, useEventMutations } from "./useCalendarData";
import { TimeGrid, DayHeader } from "./TimeGrid";
import { WeekStrip } from "./WeekStrip";
import { AllDayRow } from "./AllDayRow";
import { EventSheet } from "./EventSheet";
import { usePlanner } from "./PlanSheet";
import { RailBar, RailSheet, DesktopRail } from "./TaskRail";
import { MiniMonth, CalendarsList, SidebarPlan } from "./CalendarSidebar";
import { allDayForDay, defaultStartFor, isoAt, itemsForDay, minutesOfDate, nextFreeSlot, shiftDate, type View } from "./model";
import "./calendar.css";

const VIEWS: { value: View; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
];

/** Pill height of the floating task bar (RailBar). The grid card stops this far above the tab bar plus a gap. */
const RAIL_H = 44;
const GLASS_BTN = "glass !min-w-0 !min-h-0 w-10 h-10";
const GLASS_BTN_SM = "glass !min-w-0 !min-h-0 w-9 h-9";

/** "4 events · 3h 20m busy": count of events and the union of their timed minutes across `days`. */
function summarize(events: CalEvent[], days: string[]): string {
  let count = 0;
  let busy = 0;
  for (const d of days) {
    const items = itemsForDay(events, d).sort((a, b) => a.startMin - b.startMin);
    count += items.length + allDayForDay(events, d).length;
    let end = -1;
    for (const it of items) {
      const s = Math.max(it.startMin, end);
      if (it.endMin > s) busy += it.endMin - s;
      end = Math.max(end, it.endMin);
    }
  }
  if (count === 0) return "Nothing scheduled";
  return busy > 0 ? `${plural(count, "event")} · ${fmtMinutes(busy)} busy` : plural(count, "event");
}

export function CalendarScreen() {
  const isDesktop = useIsDesktop();
  const now = useNow(30000);
  const today = todayString();
  const { date, view, hidden, sheet, railOpen, setDate, setView, toggleCalendar, openSheet, closeSheet, setRail } = useCalendar();
  const data = useCalendarData({ padWeeks: isDesktop ? 0 : 1 });
  const m = useEventMutations();
  const planner = usePlanner();
  const setQuickAdd = useUi((s) => s.setQuickAdd);
  const [menu, setMenu] = useState<{ ev: CalEvent; at: { x: number; y: number } } | null>(null);
  const [confirm, setConfirm] = useState<CalEvent | null>(null);

  const days = useMemo(() => (view === "week" ? data.week : isDesktop ? [date] : [shiftDate(date, -1), date, shiftDate(date, 1)]), [view, data.week, date, isDesktop]);
  const summary = useMemo(() => summarize(data.events, view === "week" ? data.week : [date]), [data.events, data.week, view, date]);
  const pager = useMemo(() => (view === "day" && !isDesktop ? { onPage: (delta: -1 | 1) => setDate(shiftDate(date, delta)) } : undefined), [view, isDesktop, date, setDate]);

  const step = view === "week" ? 7 : 1;
  const goPrev = useCallback(() => setDate(shiftDate(date, -step)), [date, step, setDate]);
  const goNext = useCallback(() => setDate(shiftDate(date, step)), [date, step, setDate]);
  const goToday = useCallback(() => setDate(today), [today, setDate]);
  const newEvent = useCallback(() => {
    const startMin = defaultStartFor(date, new Date());
    openSheet({ event: null, start: isoAt(date, startMin), end: isoAt(date, Math.min(24 * 60, startMin + 60)) });
  }, [date, openSheet]);

  useHotkey("t", goToday, { enabled: isDesktop });
  useHotkey("n", newEvent, { enabled: isDesktop });
  useHotkey("ArrowLeft", goPrev, { enabled: isDesktop });
  useHotkey("ArrowRight", goNext, { enabled: isDesktop });
  useHotkey("d", () => setView("day"), { enabled: isDesktop });
  useHotkey("w", () => setView("week"), { enabled: isDesktop });
  useHotkey("q", () => setQuickAdd(true), { enabled: isDesktop });
  useHotkey("n", () => setQuickAdd(true), { meta: true, enabled: isDesktop });

  const onCreate = (start: string, end: string, title: string) => {
    void m.create.mutateAsync({ title, start, end }).catch((e: Error) => toast(e.message));
  };
  const onMove = (ev: CalEvent, start: string, end: string) => {
    void m.move.mutateAsync({ ev, start, end }).catch((e: Error) => toast(e.message));
  };
  const onResize = (ev: CalEvent, end: string) => {
    void m.move.mutateAsync({ ev, start: ev.start, end }).catch((e: Error) => toast(e.message));
  };
  const onOpen = (ev: CalEvent) => openSheet({ event: ev, start: ev.start, end: ev.end });
  const onToggleTask = (ev: CalEvent, done: boolean) => {
    void (done ? m.completeTask.mutateAsync(ev) : m.reopenTask.mutateAsync(ev)).catch((e: Error) => toast(e.message));
  };
  const onContext = (ev: CalEvent, at: { x: number; y: number }) => setMenu({ ev, at });

  const scheduleTask = (task: Task, start?: string, end?: string) => {
    const duration = Math.max(15, task.estimateMinutes ?? 30);
    const fromMin = date === today ? minutesOfDate(now) + 5 : 9 * 60;
    const slot = start && end ? { start, end } : nextFreeSlot(data.allEvents, date, duration, fromMin);
    void m.create
      .mutateAsync({ title: task.title, taskId: task.id, kind: "timebox", start: slot.start, end: slot.end, locked: true })
      .then(() => toast(`Planned for ${fmtTimeRange(slot.start, slot.end)}.`))
      .catch((e: Error) => toast(e.message));
  };

  const menuItems: MenuItem[] = menu
    ? [
        { label: "Edit", icon: "pencil", onPress: () => onOpen(menu.ev) },
        { label: "Duplicate", icon: "copy", onPress: () => void m.create.mutateAsync({ title: menu.ev.title, start: menu.ev.start, end: menu.ev.end, allDay: menu.ev.allDay, calendarId: menu.ev.calendarId, location: menu.ev.location, notes: menu.ev.notes }).then(() => toast("Duplicated.")) },
        ...(menu.ev.kind === "timebox" ? [{ label: menu.ev.locked ? "Unlock" : "Lock", icon: (menu.ev.locked ? "unlock" : "lock") as MenuItem["icon"], onPress: () => void m.update.mutateAsync({ ev: menu.ev, patch: { locked: !menu.ev.locked } }) }] : []),
        { label: "Delete", icon: "trash", destructive: true, onPress: () => setConfirm(menu.ev) },
      ]
    : [];

  const monthDate = parseDateString(date);
  const dayLabel = view === "week" ? "This week" : date === today ? "Today" : format(monthDate, "EEEE d");
  const monthTitle = (
    <>
      {format(monthDate, "MMMM")} <span className="text-tertiary">{format(monthDate, "yyyy")}</span>
    </>
  );
  const gridProps = { events: data.events, calendars: data.calendars, now, onOpen, onMove, onResize, onCreate, onContext, onToggleTask };

  const sheets = (
    <>
      <EventSheet draft={sheet} onClose={closeSheet} calendars={data.calendarList} />
      {planner.sheet}
      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu?.at ?? null} items={menuItems} />
      <ActionSheet
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm?.instanceOf || confirm?.rrule ? "Delete this repeating event?" : confirm?.kind === "timebox" ? "Remove this time box?" : "Delete this event?"}
        actions={
          confirm?.instanceOf || confirm?.rrule
            ? [
                { label: "Delete This Event", destructive: true, onPress: () => confirm && void m.remove.mutateAsync({ ev: confirm, scope: "this" }) },
                { label: "Delete All Events", destructive: true, onPress: () => confirm && void m.remove.mutateAsync({ ev: confirm, scope: "all" }) },
              ]
            : [{ label: confirm?.kind === "timebox" ? "Remove Time Box" : "Delete Event", destructive: true, onPress: () => confirm && void m.remove.mutateAsync({ ev: confirm }) }]
        }
      />
    </>
  );

  if (isDesktop) {
    return (
      <div className="flex h-full min-h-0 gap-3 py-3 pr-3" data-calendar-screen>
        <aside className="glass rounded-xl w-[232px] min-[1440px]:w-[260px] shrink-0 h-full flex flex-col px-4 pt-4 pb-5 scroller" aria-label="Calendars">
          <MiniMonth date={date} weekStartsOn={data.weekStartsOn} onSelect={setDate} />
          <h2 className="text-[13px] text-tertiary mt-6 mb-1">Calendars</h2>
          <CalendarsList calendars={data.calendarList} hidden={hidden} onToggle={toggleCalendar} />
          <SidebarPlan onPlan={() => void planner.run()} busy={planner.busy} />
        </aside>
        <section className="glass rounded-xl flex-1 min-w-0 h-full flex flex-col overflow-hidden">
          <header className="shrink-0 flex items-center gap-2 pl-6 pr-4 h-[72px]">
            <div className="min-w-0">
              <h1 className="text-[26px] leading-[30px] font-[300] tracking-[-0.03em] text-primary whitespace-nowrap"><span className="sr-only">Calendar, </span>{monthTitle}</h1>
              <p className="text-[12px] text-tertiary tabular whitespace-nowrap mt-0.5">
                {dayLabel} · {summary}
              </p>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-1.5">
              <IconButton label="Previous" onClick={goPrev} className={GLASS_BTN_SM}>
                <Icon name="chevron-left" size={18} strokeWidth={1.8} />
              </IconButton>
              <Button variant="secondary" size="sm" onClick={goToday} disabled={date === today && view === "day"} className="!h-9 !px-3.5 text-[13px]">
                Today
              </Button>
              <IconButton label="Next" onClick={goNext} className={GLASS_BTN_SM}>
                <Icon name="chevron-right" size={18} strokeWidth={1.8} />
              </IconButton>
            </div>
            <Segmented options={VIEWS} value={view} onChange={setView} size="sm" className="w-[128px] ml-2" />
            <IconButton label="Add" onClick={newEvent} className={GLASS_BTN}>
              <Icon name="plus" size={20} strokeWidth={1.8} />
            </IconButton>
          </header>
          {data.error && <InlineError onRetry={data.refetch}>Unable to load events.</InlineError>}
          <TimeGrid
            key={view}
            days={days}
            {...gridProps}
            onDropTask={(task, start, end) => scheduleTask(task, start, end)}
            header={
              <div className="cal-sticky hairline-t hairline-b">
                <DayHeader days={days} selected={date} onSelect={(d) => { setDate(d); if (view === "week") setView("day"); }} />
                <AllDayRow days={days} events={data.events} calendars={data.calendars} onOpen={onOpen} className="hairline-t !border-b-0" />
              </div>
            }
          />
        </section>
        <DesktopRail date={date} onSchedule={(t) => scheduleTask(t)} />
        {sheets}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-calendar-screen>
      <header className="shrink-0 pt-[var(--safe-top)] px-[var(--gutter)]">
        <div className="h-[var(--topbar-h)] grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="justify-self-start">
            {date !== today && (
              <Button variant="secondary" size="sm" onClick={goToday} className="!h-8 !px-3.5 text-[13px]">
                Today
              </Button>
            )}
          </div>
          <Segmented options={VIEWS} value={view} onChange={setView} size="sm" className="w-[132px]" />
          <div className="justify-self-end">
            <IconButton label="Add" onClick={newEvent} className={GLASS_BTN}>
              <Icon name="plus" size={20} strokeWidth={1.8} />
            </IconButton>
          </div>
        </div>
        <div className="flex items-end gap-3 pt-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[30px] leading-[36px] font-[300] tracking-[-0.03em] text-primary truncate"><span className="sr-only">Calendar, </span>{monthTitle}</h1>
            <p className="text-[13px] leading-[18px] text-tertiary tabular truncate mt-0.5" data-day-summary>
              {dayLabel} · {summary}
            </p>
          </div>
          <div className="flex items-center gap-2 pb-0.5 shrink-0">
            <IconButton label="Previous" onClick={goPrev} className={GLASS_BTN_SM}>
              <Icon name="chevron-left" size={18} strokeWidth={1.8} />
            </IconButton>
            <IconButton label="Next" onClick={goNext} className={GLASS_BTN_SM}>
              <Icon name="chevron-right" size={18} strokeWidth={1.8} />
            </IconButton>
          </div>
        </div>
        {view === "day" && (
          <div className="glass rounded-lg mt-3 overflow-hidden">
            <WeekStrip date={date} weekStartsOn={data.weekStartsOn} events={data.events} calendars={data.calendars} onSelect={setDate} />
          </div>
        )}
      </header>
      <div
        className="glass rounded-lg mx-[var(--gutter)] mt-3 flex-1 min-h-0 flex flex-col overflow-hidden"
        style={{ marginBottom: `calc(var(--tabbar-h) + var(--safe-bottom) + ${8 + RAIL_H + 10}px)` }}
      >
        {view === "week" && (
          <div className="shrink-0 hairline-b">
            <DayHeader days={days} selected={date} onSelect={(d) => { setDate(d); setView("day"); }} />
          </div>
        )}
        <AllDayRow days={view === "day" ? [date] : days} events={data.events} calendars={data.calendars} onOpen={onOpen} className="shrink-0" />
        {data.error && <InlineError onRetry={data.refetch}>Unable to load events.</InlineError>}
        <TimeGrid key={view} days={days} pager={pager} {...gridProps} />
      </div>
      <RailBar date={date} open={railOpen} onOpen={setRail} onPlan={() => void planner.run()} planning={planner.busy} />
      <RailSheet date={date} open={railOpen} onClose={() => setRail(false)} onSchedule={(t) => { setRail(false); scheduleTask(t); }} />
      {sheets}
    </div>
  );
}
