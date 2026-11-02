import { useMemo, useState } from "react";
import { addMonths, endOfMonth, format, startOfMonth, startOfWeek, addDays } from "date-fns";
import type { Calendar } from "@aravos/shared";
import { parseDateString, toDateString, todayString } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { selection } from "@/lib/haptics";
import { IconButton, Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { colorVar } from "./model";

export function MiniMonth({ date, weekStartsOn, onSelect, eventDays }: { date: string; weekStartsOn: 0 | 1; onSelect: (d: string) => void; eventDays?: Set<string> }) {
  const [month, setMonth] = useState(() => startOfMonth(parseDateString(date)));
  const today = todayString();
  const cells = useMemo(() => {
    const first = startOfWeek(startOfMonth(month), { weekStartsOn });
    const last = endOfMonth(month);
    const out: Date[] = [];
    for (let d = first; d <= last || out.length % 7 !== 0; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month, weekStartsOn]);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => format(addDays(startOfWeek(month, { weekStartsOn }), i), "EEEEE")), [month, weekStartsOn]);
  return (
    <div data-mini-month>
      <div className="flex items-center justify-between h-9 -mr-2">
        <button type="button" className="text-subhead font-semibold text-primary pressable" onClick={() => setMonth(startOfMonth(parseDateString(today)))}>
          {format(month, "MMMM yyyy")}
        </button>
        <div className="flex">
          <IconButton label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))} className="w-9">
            <Icon name="chevron-left" size={18} />
          </IconButton>
          <IconButton label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))} className="w-9">
            <Icon name="chevron-right" size={18} />
          </IconButton>
        </div>
      </div>
      <div className="grid grid-cols-7 mt-1">
        {weekdays.map((w, i) => (
          <div key={i} className="text-caption-1 text-tertiary text-center h-5">
            {w}
          </div>
        ))}
        {cells.map((d) => {
          const key = toDateString(d);
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = key === today;
          const selected = key === date;
          return (
            <button key={key} type="button" onClick={() => { void selection(); onSelect(key); }} aria-label={format(d, "EEEE d MMMM")} aria-pressed={selected} className="h-8 flex items-center justify-center">
              <span className={cn("w-7 h-7 rounded-full inline-flex items-center justify-center text-footnote tabular transition-colors duration-100", isToday && "bg-accent text-on-accent font-semibold", selected && !isToday && "bg-primary text-canvas font-semibold", !isToday && !selected && (inMonth ? "text-primary hover:bg-pressed" : "text-quaternary"))}>
                {d.getDate()}
              </span>
              {eventDays?.has(key) && !selected && !isToday && <span className="sr-only">has events</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarsList({ calendars, hidden, onToggle }: { calendars: Calendar[]; hidden: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-col">
      {calendars.map((c) => {
        const on = !hidden.includes(c.id);
        return (
          <button key={c.id} type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(c.id)} className="flex items-center gap-3 h-9 px-2 -mx-2 rounded-sm text-subhead text-primary hover:bg-surface-2 transition-colors duration-100">
            <span className="w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0" style={{ background: on ? colorVar(c.color) : "transparent", boxShadow: `inset 0 0 0 1.5px ${colorVar(c.color)}` }}>
              {on && <Icon name="check" size={11} strokeWidth={3} className="text-white" />}
            </span>
            <span className={cn("truncate", !on && "text-secondary")}>{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SidebarPlan({ onPlan, busy }: { onPlan: () => void; busy: boolean }) {
  return (
    <div className="mt-auto pt-4">
      <Button variant="secondary" full loading={busy} onClick={onPlan} leading={<Icon name="bolt" size={18} />}>
        Plan Tasks
      </Button>
      <p className="text-footnote text-secondary mt-2">Places open tasks into free time within work hours.</p>
    </div>
  );
}
