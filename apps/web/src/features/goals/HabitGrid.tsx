import { useMemo } from "react";
import type { Goal } from "@aravos/shared";
import { addDaysString, parseDateString, todayString, weekStartString } from "@aravos/shared";
import { format } from "date-fns";
import { notify } from "@/lib/haptics";
import { fmtInt } from "@/lib/format";
import { CardHeader, Legend } from "@/ui/viz";
import { colorVar } from "./model";

const WEEKS = 12;

/**
 * 12 weeks of check-ins as a calm dot matrix: one column per week, one dot per day.
 * Done = the goal's color, missed = a faint dot, days ahead = a hairline ring. Today's dot is a button that toggles the entry.
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
    <div className="mx-[var(--gutter)] glass rounded-lg p-4">
      <CardHeader icon="grid" iconColor={color} title="Last 12 weeks" sub={`${fmtInt(doneCount)} check-ins`} />
      <div className="mt-4" role="img" aria-label={`${doneCount} check-ins in the last ${WEEKS} weeks`}>
        <div className="grid gap-y-[7px]" style={{ gridTemplateColumns: `18px repeat(${WEEKS}, minmax(0, 1fr))` }}>
          <div />
          {monthLabels.map((m, i) => (
            <div key={i} className="text-[11px] leading-4 text-tertiary h-4 whitespace-nowrap overflow-visible">
              {m}
            </div>
          ))}
          {Array.from({ length: 7 }, (_, d) => (
            <RowOfDots key={d} label={d % 2 === 0 ? dayNames[d]! : ""} dates={weeks.map((w) => w[d]!)} today={today} done={done} color={color} onToggleToday={onToggleToday} pending={pending} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 mt-4">
        <Legend color={color}>Done</Legend>
        <Legend color="var(--bg-pressed)">Missed</Legend>
      </div>
    </div>
  );
}

const DOT = "block w-[9px] h-[9px] rounded-full";

function RowOfDots({ label, dates, today, done, color, onToggleToday, pending }: { label: string; dates: string[]; today: string; done: Set<string>; color: string; onToggleToday: () => void; pending?: boolean }) {
  return (
    <>
      <div className="text-[11px] leading-[9px] text-quaternary flex items-center">{label}</div>
      {dates.map((date) => {
        const isToday = date === today;
        const future = date > today;
        const hit = done.has(date);
        if (isToday) {
          return (
            <div key={date} className="flex items-center justify-center">
              <button
                type="button"
                aria-label={hit ? "Checked in today. Undo" : "Check in today"}
                aria-pressed={hit}
                disabled={pending}
                onClick={() => {
                  if (!hit) void notify("success");
                  onToggleToday();
                }}
                className="relative -m-3 p-3 inline-flex items-center justify-center touch-manipulation active:opacity-70"
                data-testid="habit-today"
              >
                <span className="block w-[15px] h-[15px] rounded-full flex items-center justify-center transition-[box-shadow] duration-200" style={{ boxShadow: `0 0 0 1.5px ${color}` }}>
                  <span className={DOT} style={{ background: hit ? color : "transparent", transform: hit ? "scale(1)" : "scale(0.4)", transition: "transform 260ms var(--ease-out), background-color 160ms linear" }} />
                </span>
              </button>
            </div>
          );
        }
        return (
          <div key={date} className="flex items-center justify-center">
            <span className={DOT} style={future ? { boxShadow: "inset 0 0 0 1px var(--separator-strong)" } : { background: hit ? color : "var(--bg-pressed)" }} />
          </div>
        );
      })}
    </>
  );
}
