import { useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";
import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { toDateString } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Section } from "@/ui/List";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { cn } from "@/lib/cn";
import { useAppSettings } from "@/data/queries";
import { useIsDesktop } from "@/lib/hooks";
import { useWorkoutCalendar, useWorkouts } from "./api";
import { plural, WORKOUTS } from "./lib";
import { WorkoutRow } from "./common";

export default function HistoryScreen() {
  const navigate = useNavigate();
  const q = useWorkouts(200);
  const groups = useMemo(() => {
    const map = new Map<string, typeof q.data>();
    for (const w of q.data ?? []) {
      const key = format(new Date(w.finishedAt ?? w.startedAt), "MMMM yyyy");
      map.set(key, [...(map.get(key) ?? []), w]);
    }
    return Array.from(map.entries());
  }, [q.data]);
  const isDesktop = useIsDesktop();
  const list = (
    <>
      {q.isPending ? (
        <Skeleton rows={5} />
      ) : q.isError ? (
        <InlineError onRetry={() => void q.refetch()}>Unable to load history.</InlineError>
      ) : q.data.length === 0 ? (
        <Empty>No workouts yet.</Empty>
      ) : (
        groups.map(([month, list], gi) => (
          <Section key={month} title={month} action={<span className="text-[12px] text-tertiary tabular pb-0.5">{plural((list ?? []).length, "workout")}</span>} className="mt-6 first:mt-1">
            <div className="px-[var(--gutter)] lg:px-0 flex flex-col gap-2.5" data-testid="history-group">
              {(list ?? []).map((w, i) => (
                <div key={w.id} className="rise" style={{ "--i": Math.min(gi * 3 + i, 10) } as CSSProperties}>
                  <WorkoutRow workout={w} onPress={() => navigate(`${WORKOUTS}/history/${w.id}`)} />
                </div>
              ))}
            </div>
          </Section>
        ))
      )}
    </>
  );
  if (isDesktop) {
    return (
      <Screen title="History" back={WORKOUTS}>
        <div className="grid grid-cols-[360px_minmax(0,1fr)] gap-6 pr-[var(--gutter)] max-w-[1100px]">
          <div className="pl-[var(--gutter)]"><div className="sticky top-0"><CalendarStrip /></div></div>
          <div className="wk-desktop-list">{list}</div>
        </div>
      </Screen>
    );
  }
  return (
    <Screen title="History" back={WORKOUTS} header={<CalendarStrip />}>
      {list}
    </Screen>
  );
}

/** One month, dots on workout days. Tap a day to open that workout. */
export function CalendarStrip() {
  const navigate = useNavigate();
  const weekStartsOn = useAppSettings().weekStartsOn;
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const from = toDateString(startOfMonth(month));
  const to = toDateString(endOfMonth(month));
  const q = useWorkoutCalendar(from, to);
  const days = useMemo(() => {
    const first = startOfMonth(month);
    const lead = (first.getDay() - weekStartsOn + 7) % 7;
    const total = endOfMonth(month).getDate();
    const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [month, weekStartsOn]);
  const byDate = new Map((q.data ?? []).map((d) => [d.date, d.workouts]));
  const monthCount = (q.data ?? []).reduce((n, d) => n + d.workouts.length, 0);
  const today = toDateString(new Date());
  const labels = weekStartsOn === 1 ? ["M", "T", "W", "T", "F", "S", "S"] : ["S", "M", "T", "W", "T", "F", "S"];
  return (
    <div className="glass rounded-lg px-2.5 pt-2 pb-3 lg:max-w-[420px]" data-testid="calendar-strip">
      <div className="flex items-center justify-between pl-2">
        <span className="flex items-baseline gap-2">
          <span className="text-[15px] text-primary">{format(month, "MMMM yyyy")}</span>
          <span className="text-[12px] text-tertiary tabular">{plural(monthCount, "workout")}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <IconButton label="Previous month" className="well !min-w-0 !min-h-0 w-8 h-8" onClick={() => setMonth((m) => addMonths(m, -1))}><Icon name="chevron-left" size={16} strokeWidth={1.8} /></IconButton>
          <IconButton label="Next month" className="well !min-w-0 !min-h-0 w-8 h-8" onClick={() => setMonth((m) => addMonths(m, 1))}><Icon name="chevron-right" size={16} strokeWidth={1.8} /></IconButton>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-tertiary mt-2">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 mt-1">
        {days.map((d, i) => {
          if (!d) return <span key={i} />;
          const key = toDateString(d);
          const list = byDate.get(key) ?? [];
          const has = list.length > 0;
          const isToday = key === today;
          return (
            <button key={i} type="button" disabled={!has} onClick={() => has && navigate(`${WORKOUTS}/history/${list[0]!.id}`)} className="h-9 flex items-center justify-center" aria-label={`${format(d, "d MMM")}${has ? `, ${list.length} workout${list.length === 1 ? "" : "s"}` : ""}`}>
              <span className={cn("w-8 h-8 rounded-full inline-flex items-center justify-center text-[13px] tabular transition-transform duration-150", has ? "bg-accent-soft text-accent-text font-medium shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_30%,transparent)] active:scale-95" : isToday ? "text-accent-text shadow-[inset_0_0_0_1px_var(--accent)]" : "text-secondary")}>{d.getDate()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
