import { useCallback, useMemo, useState } from "react";
import { format } from "date-fns";
import type { CalEvent, Task } from "@aravos/shared";
import { parseDateString, todayString } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { useHotkey, useIsDesktop, useNow } from "@/lib/hooks";
import { fmtTimeRange } from "@/lib/format";
import { useUi } from "@/state/ui";
import { IconButton, Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Segmented } from "@/ui/Segmented";
import { Menu, type MenuItem } from "@/ui/Menu";
import { ActionSheet } from "@/ui/Sheet";
import { InlineError } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { QuickAdd } from "@/features/tasks/QuickAdd";
import { useCalendar } from "./state";
import { useCalendarData, useEventMutations } from "./useCalendarData";
import { TimeGrid, DayHeader } from "./TimeGrid";
import { WeekStrip } from "./WeekStrip";
import { AllDayRow } from "./AllDayRow";
import { EventSheet } from "./EventSheet";
import { usePlanner } from "./PlanSheet";
import { RailBar, RailSheet, DesktopRail } from "./TaskRail";
import { MiniMonth, CalendarsList, SidebarPlan } from "./CalendarSidebar";
import { defaultStartFor, isoAt, minutesOfDate, nextFreeSlot, shiftDate, type View } from "./model";

const VIEWS: { value: View; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
];

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

  const monthLabel = format(parseDateString(date), "MMMM yyyy");
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
      <div className="flex h-full min-h-0" data-calendar-screen>
        <aside className="w-[224px] min-[1440px]:w-[260px] shrink-0 h-full flex flex-col border-r border-separator px-4 min-[1440px]:px-5 pt-5 pb-6 scroller" aria-label="Calendars">
          <MiniMonth date={date} weekStartsOn={data.weekStartsOn} onSelect={setDate} />
          <h2 className="text-footnote text-secondary mt-6 mb-1">Calendars</h2>
          <CalendarsList calendars={data.calendarList} hidden={hidden} onToggle={toggleCalendar} />
          <SidebarPlan onPlan={() => void planner.run()} busy={planner.busy} />
        </aside>
        <section className="flex-1 min-w-0 h-full flex flex-col">
          <header className="shrink-0 flex items-center gap-2 pl-5 pr-3 h-14 hairline-b">
            <h1 className="text-title-3 text-primary whitespace-nowrap">Calendar</h1>
            <span className="text-subhead text-secondary whitespace-nowrap hidden min-[1440px]:inline">{view === "day" ? format(parseDateString(date), "EEE d MMM") : monthLabel}</span>
            <div className="flex-1" />
            <div className="flex items-center -mr-1">
              <IconButton label="Previous" onClick={goPrev} className="w-9">
                <Icon name="chevron-left" size={20} />
              </IconButton>
              <Button variant="plain" size="sm" onClick={goToday} disabled={date === today && view === "day"} className="px-1.5">
                Today
              </Button>
              <IconButton label="Next" onClick={goNext} className="w-9">
                <Icon name="chevron-right" size={20} />
              </IconButton>
            </div>
            <Segmented options={VIEWS} value={view} onChange={setView} className="w-[128px]" />
            <IconButton label="Add" tinted onClick={newEvent}>
              <Icon name="plus" />
            </IconButton>
          </header>
          {data.error && <InlineError onRetry={data.refetch}>Unable to load events.</InlineError>}
          <TimeGrid
            key={view}
            days={days}
            {...gridProps}
            onDropTask={(task, start, end) => scheduleTask(task, start, end)}
            header={
              <div className="bg-canvas hairline-b">
                <DayHeader days={days} selected={date} onSelect={(d) => { setDate(d); if (view === "week") setView("day"); }} />
                <AllDayRow days={days} events={data.events} calendars={data.calendars} onOpen={onOpen} className="hairline-t" />
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
      <div className="shrink-0 pt-[var(--safe-top)]">
        <div className="h-[var(--topbar-h)] grid grid-cols-[1fr_auto_1fr] items-center px-1">
          <div className="justify-self-start">
            {date !== today && (
              <Button variant="plain" size="sm" onClick={goToday}>
                Today
              </Button>
            )}
          </div>
          <Segmented options={VIEWS} value={view} onChange={setView} size="sm" className="w-[132px]" />
          <div className="justify-self-end flex items-center pr-1">
            <IconButton label="Add" tinted onClick={newEvent}>
              <Icon name="plus" />
            </IconButton>
          </div>
        </div>
        <div className="px-[var(--gutter)] pt-1 pb-1">
          <h1 className="text-large-title text-primary leading-[41px]">Calendar</h1>
          <button type="button" className="text-subhead text-secondary mt-0.5 block" onClick={goToday}>
            {monthLabel}
          </button>
        </div>
        {view === "day" ? <WeekStrip date={date} weekStartsOn={data.weekStartsOn} events={data.events} calendars={data.calendars} onSelect={setDate} /> : <DayHeader days={days} selected={date} onSelect={(d) => { setDate(d); setView("day"); }} />}
        <div className={cn("hairline-b", view === "day" ? "mt-1" : "")} />
        <AllDayRow days={view === "day" ? [date] : days} events={data.events} calendars={data.calendars} onOpen={onOpen} />
      </div>
      {data.error && <InlineError onRetry={data.refetch}>Unable to load events.</InlineError>}
      <TimeGrid key={view} days={days} pager={pager} {...gridProps} />
      <RailBar date={date} open={railOpen} onOpen={setRail} onPlan={() => void planner.run()} planning={planner.busy} />
      <RailSheet date={date} open={railOpen} onClose={() => setRail(false)} onSchedule={(t) => { setRail(false); scheduleTask(t); }} />
      {sheets}
    </div>
  );
}
