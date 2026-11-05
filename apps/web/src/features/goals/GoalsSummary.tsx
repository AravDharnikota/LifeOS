import type { CSSProperties } from "react";
import type { Goal } from "@aravos/shared";
import { fmtInt } from "@/lib/format";
import { BigNumber, CardHeader, Gauge, StatusPill, useCountUp } from "@/ui/viz";
import { STANDING_LABEL, STANDING_TONE, habitDoneToday, quietValue, standing, type Standing } from "./model";

const RANK: Record<Standing, number> = { behind: 0, ongoing: 1, paused: 2, complete: 3 };

/**
 * The pulse card at the top of Goals: a segmented gauge of average progress across active goals,
 * counts as pills (Active / Done / Behind), and the three goals that most need attention.
 */
export function GoalsSummary({ goals, doneCount, onOpen, style }: { goals: Goal[]; doneCount: number; onOpen: (g: Goal) => void; style?: CSSProperties }) {
  const avg = goals.length ? goals.reduce((a, g) => a + Math.min(1, g.progress ?? 0), 0) / goals.length : 0;
  const pct = Math.round(avg * 100);
  const shown = useCountUp(pct);
  const habits = goals.filter((g) => g.kind === "habit" && g.cadence !== "weekly");
  const habitsDone = habits.filter(habitDoneToday).length;
  const ranked = goals
    .map((g) => ({ g, st: standing(g) }))
    .sort((a, b) => RANK[a.st] - RANK[b.st] || (a.g.deadline ?? "9999").localeCompare(b.g.deadline ?? "9999") || (a.g.progress ?? 0) - (b.g.progress ?? 0));
  const behind = ranked.filter((r) => r.st === "behind").length;
  const key = ranked.slice(0, 3);

  return (
    <div className="mx-[var(--gutter)] glass-strong rounded-lg p-4 rise lg:flex lg:items-start lg:gap-6" style={style}>
      <div className="lg:w-[300px] lg:shrink-0">
        <CardHeader icon="target" title="Progress pulse" sub={`Across ${fmtInt(goals.length)} active ${goals.length === 1 ? "goal" : "goals"}`} />
        <div className="flex justify-center mt-3">
          <Gauge value={avg} size={196} stroke={12} label={`${pct}% average progress`}>
            <span className="text-[12px] text-tertiary">Average progress</span>
            <BigNumber value={Math.round(shown)} unit="%" size={44} className="mt-0.5" />
            {habits.length > 0 && <span className="text-[12px] text-tertiary tabular mt-1">{fmtInt(habitsDone)} of {fmtInt(habits.length)} {habits.length === 1 ? "habit" : "habits"} today</span>}
          </Gauge>
        </div>
        <div className="flex justify-center gap-1.5 -mt-1">
          <StatusPill tone="accent">{fmtInt(goals.length)} Active</StatusPill>
          <StatusPill tone="success">{fmtInt(doneCount)} Done</StatusPill>
          <StatusPill tone={behind ? "warning" : "neutral"}>{fmtInt(behind)} Behind</StatusPill>
        </div>
      </div>
      {key.length > 0 && (
        <div className="well rounded-[14px] mt-4 lg:mt-0 lg:flex-1 overflow-hidden">
          <div className="px-3.5 pt-3 pb-1 text-[12px] text-tertiary">Key goals</div>
          {key.map(({ g, st }, i) => (
            <button key={g.id} type="button" onClick={() => onOpen(g)} className={`w-full flex items-center gap-3 px-3.5 min-h-[48px] text-left row-hover active:bg-pressed transition-colors duration-100 ${i > 0 ? "hairline-t" : ""}`}>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] leading-[19px] text-primary truncate">{g.title}</span>
                <span className="block text-[12px] leading-4 text-tertiary tabular truncate">{quietValue(g)}</span>
              </span>
              <StatusPill tone={STANDING_TONE[st]}>{STANDING_LABEL[st]}</StatusPill>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
