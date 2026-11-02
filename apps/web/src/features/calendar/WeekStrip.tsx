import { useCallback, useMemo } from "react";
import { format } from "date-fns";
import type { CalEvent } from "@aravos/shared";
import { parseDateString, todayString } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { selection } from "@/lib/haptics";
import { SnapPager } from "./SnapPager";
import { eventColor, shiftDate, weekOf } from "./model";
import type { Calendar } from "@aravos/shared";

interface Props {
  date: string;
  weekStartsOn: 0 | 1;
  events: CalEvent[];
  calendars: Map<string, Calendar>;
  onSelect: (date: string) => void;
}

/** Seven numerals with the weekday above; swipe pages weeks. Today sits in a 28px accent circle. */
export function WeekStrip({ date, weekStartsOn, events, calendars, onSelect }: Props) {
  const today = todayString();
  const dotsByDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const ev of events) {
      if (ev.status === "cancelled") continue;
      const key = ev.allDay ? ev.start.slice(0, 10) : format(new Date(ev.start), "yyyy-MM-dd");
      const arr = m.get(key) ?? [];
      if (arr.length < 3) arr.push(eventColor(ev, calendars));
      m.set(key, arr);
    }
    return m;
  }, [events, calendars]);

  const onPage = useCallback((delta: -1 | 1) => onSelect(shiftDate(date, delta * 7)), [date, onSelect]);

  const renderWeek = (offset: -1 | 0 | 1) => {
    const days = weekOf(shiftDate(date, offset * 7), weekStartsOn);
    return (
      <div className="grid grid-cols-7 px-1" data-week-offset={offset}>
        {days.map((d) => {
          const isToday = d === today;
          const selected = d === date;
          const dots = dotsByDay.get(d) ?? [];
          return (
            <button
              key={d}
              type="button"
              onClick={() => {
                if (d !== date) void selection();
                onSelect(d);
              }}
              aria-pressed={selected}
              aria-label={format(parseDateString(d), "EEEE d MMMM")}
              data-date={d}
              className="flex flex-col items-center pt-1 pb-1.5 min-h-[56px] select-none active:opacity-70"
            >
              <span className={cn("text-caption-1 font-medium leading-4", isToday ? "text-accent-text" : "text-secondary")}>{format(parseDateString(d), "EEE")}</span>
              <span className={cn("mt-0.5 w-7 h-7 rounded-full inline-flex items-center justify-center text-subhead tabular transition-colors duration-100", selected && isToday && "bg-accent text-on-accent font-semibold", selected && !isToday && "bg-primary text-canvas font-semibold", !selected && isToday && "text-accent-text font-semibold", !selected && !isToday && "text-primary")}>
                {parseDateString(d).getDate()}
              </span>
              <span className="h-1.5 mt-1 flex gap-[3px] items-center">
                {dots.map((c, i) => (
                  <span key={i} className="w-1 h-1 rounded-full" style={{ background: c }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return <SnapPager render={renderWeek} onPage={onPage} className="w-full" />;
}
