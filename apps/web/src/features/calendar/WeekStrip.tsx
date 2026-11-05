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

/**
 * Seven day pills (weekday above the numeral, tiny event dots below); swipe pages weeks.
 * Selected day = white well pill, today = ink pill. Sits inside a glass card owned by the screen.
 */
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
      <div className="grid grid-cols-7 px-1.5" data-week-offset={offset}>
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
              className="flex justify-center py-1.5 select-none"
            >
              <span
                className={cn(
                  "relative flex flex-col items-center w-[42px] h-[60px] pt-[9px] rounded-full transition-[background-color,box-shadow,color] duration-200 active:scale-[0.96]",
                  isToday && "bg-primary text-canvas",
                  selected && !isToday && "well shadow-thumb",
                  selected && isToday && "shadow-thumb",
                )}
              >
                <span className={cn("text-[11px] leading-[13px]", isToday ? "opacity-70" : "text-tertiary")}>{format(parseDateString(d), "EEE")}</span>
                <span className={cn("mt-1 text-[16px] leading-5 tabular", !isToday && "text-primary")}>{parseDateString(d).getDate()}</span>
                <span className="absolute bottom-[7px] h-1 flex gap-[3px] items-center" aria-hidden="true">
                  {dots.map((c, i) => (
                    <span key={i} className="w-1 h-1 rounded-full" style={{ background: c, boxShadow: isToday ? "0 0 0 0.5px rgba(255,255,255,0.4)" : undefined }} />
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return <SnapPager render={renderWeek} onPage={onPage} className="w-full" />;
}
