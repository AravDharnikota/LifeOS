import { useMemo } from "react";
import type { Goal } from "@aravos/shared";
import { addDaysString, parseDateString, todayString, weekStartString } from "@aravos/shared";
import { format } from "date-fns";
import { cn } from "@/lib/cn";
import { impact } from "@/lib/haptics";
import { colorVar } from "./model";

const WEEKS = 12;

/**
 * 12 weeks of check-ins: one column per week, one dot per day. Today is tappable and toggles the entry.
 * Dots are the goal's color when done, the field tone when missed, and hollow for days still ahead.
 */
export function HabitGrid({ goal, weekStartsOn = 1, onToggleToday, pending }: { goal: Goal; weekStartsOn?: 0 | 1; onToggleToday: () => void; pending?: boolean }) {
  const today = todayString();
  const done = useMemo(() => new Set((goal.recentEntries ?? []).map((e) => e.date)), [goal.recentEntries]);
  const color = colorVar(goal.color);
  const firstWeek = addDaysString(weekStartString(today, weekStartsOn), -7 * (WEEKS - 1));
  const weeks = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDaysString(firstWeek, w * 7 + d)));
  const dayNames = Array.from({ length: 7 }, (_, d) => format(parseDateString(addDaysString(firstWeek, d)), "EEEEE"));
  const monthLabels = weeks.map((w, i) => {
    const d = parseDateString(w[0]!);
    const prev = i > 0 ? parseDateString(weeks[i - 1]![0]!) : null;
    return !prev || prev.getMonth() !== d.getMonth() ? format(d, "MMM") : "";
  });
  const doneCount = weeks.flat().filter((d) => d <= today && done.has(d)).length;

  return (
    <div className="px-[var(--gutter)]" role="img" aria-label={`${doneCount} check-ins in the last ${WEEKS} weeks`}>
      <div className="grid gap-1" style={{ gridTemplateColumns: `20px repeat(${WEEKS}, minmax(0, 1fr))` }}>
        <div />
        {monthLabels.map((m, i) => (
          <div key={i} className="text-caption-1 text-tertiary h-4 leading-4 truncate">
            {m}
          </div>
        ))}
        {Array.from({ length: 7 }, (_, d) => (
          <RowOfDots key={d} label={d % 2 === 0 ? dayNames[d]! : ""} dates={weeks.map((w) => w[d]!)} today={today} done={done} color={color} onToggleToday={onToggleToday} pending={pending} />
        ))}
      </div>
    </div>
  );
}

function RowOfDots({ label, dates, today, done, color, onToggleToday, pending }: { label: string; dates: string[]; today: string; done: Set<string>; color: string; onToggleToday: () => void; pending?: boolean }) {
  return (
    <>
      <div className="text-caption-1 text-tertiary flex items-center">{label}</div>
      {dates.map((date) => {
        const isToday = date === today;
        const future = date > today;
        const hit = done.has(date);
        const base = "block w-full aspect-square rounded-full";
        if (isToday) {
          return (
            <button
              key={date}
              type="button"
              aria-label={hit ? "Checked in today. Undo" : "Check in today"}
              aria-pressed={hit}
              disabled={pending}
              onClick={() => {
                if (!hit) void impact("light");
                onToggleToday();
              }}
              className="relative flex items-center justify-center -m-1 p-1 touch-manipulation active:opacity-70"
              data-testid="habit-today"
            >
              <span className={cn(base, "transition-colors duration-150")} style={hit ? { background: color } : { boxShadow: `inset 0 0 0 2px ${color}` }} />
            </button>
          );
        }
        return <span key={date} className={base} style={future ? { boxShadow: "inset 0 0 0 1px var(--separator)" } : hit ? { background: color } : { background: "var(--bg-surface-2)" }} />;
      })}
    </>
  );
}
