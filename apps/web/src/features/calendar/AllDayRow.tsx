import type { CalEvent, Calendar } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { GUTTER_WIDTH, allDayForDay, eventColor } from "./model";

/** Row of all-day chips above the grid. Mobile shows the selected day; desktop shows one cell per column. */
export function AllDayRow({ days, events, calendars, onOpen, className }: { days: string[]; events: CalEvent[]; calendars: Map<string, Calendar>; onOpen: (ev: CalEvent) => void; className?: string }) {
  const perDay = days.map((d) => allDayForDay(events, d));
  if (perDay.every((l) => l.length === 0)) return null;
  return (
    <div className={cn("grid items-start hairline-b py-1.5", className)} style={{ gridTemplateColumns: `${GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))` }} data-all-day-row>
      <div className="text-[11px] text-tertiary text-right pr-1 leading-[22px] whitespace-nowrap">all-day</div>
      {perDay.map((list, i) => (
        <div key={days[i]} className={cn("flex flex-col gap-0.5 min-h-6 px-0.5", i > 0 && "border-l border-separator")}>
          {list.map((ev) => (
            <button key={ev.id} type="button" onClick={() => onOpen(ev)} data-event-id={ev.id} className="cal-fill cal-block rounded-[7px] h-[22px] pl-2 pr-1.5 text-[12px] font-medium text-left truncate w-full active:opacity-70" style={{ ["--cal-color" as string]: eventColor(ev, calendars) }}>
              {ev.title}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
