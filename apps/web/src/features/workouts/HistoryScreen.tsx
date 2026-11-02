import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { toDateString } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Group, Section, SectionHeader } from "@/ui/List";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { cn } from "@/lib/cn";
import { useAppSettings } from "@/data/queries";
import { useWorkoutCalendar, useWorkouts } from "./api";
import { WORKOUTS } from "./lib";
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
  return (
    <Screen title="History" back={WORKOUTS} header={<CalendarStrip />}>
      {q.isPending ? (
        <Skeleton rows={5} />
      ) : q.isError ? (
        <InlineError onRetry={() => void q.refetch()}>Unable to load history.</InlineError>
      ) : q.data.length === 0 ? (
        <Empty>No workouts yet.</Empty>
      ) : (
        groups.map(([month, list]) => (
          <Section key={month} title={month} className="mt-4 first:mt-0">
            <Group data-testid="history-group">
              {(list ?? []).map((w) => (
                <WorkoutRow key={w.id} workout={w} onPress={() => navigate(`${WORKOUTS}/history/${w.id}`)} />
              ))}
            </Group>
          </Section>
        ))
      )}
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
  const today = toDateString(new Date());
  const labels = weekStartsOn === 1 ? ["M", "T", "W", "T", "F", "S", "S"] : ["S", "M", "T", "W", "T", "F", "S"];
  return (
    <div className="bg-surface rounded-md px-2 pt-1 pb-2 lg:max-w-[420px]" data-testid="calendar-strip">
      <div className="flex items-center justify-between">
        <IconButton label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}><Icon name="chevron-left" size={20} /></IconButton>
        <span className="text-subhead font-semibold text-primary">{format(month, "MMMM yyyy")}</span>
        <IconButton label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}><Icon name="chevron-right" size={20} /></IconButton>
      </div>
      <div className="grid grid-cols-7 text-center text-caption-1 text-tertiary font-medium">
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
            <button key={i} type="button" disabled={!has} onClick={() => has && navigate(`${WORKOUTS}/history/${list[0]!.id}`)} className={cn("h-9 flex flex-col items-center justify-center rounded-sm text-footnote tabular", has ? "text-primary font-semibold active:bg-pressed" : "text-secondary", isToday && "text-accent-text")} aria-label={`${format(d, "d MMM")}${has ? `, ${list.length} workout${list.length === 1 ? "" : "s"}` : ""}`}>
              <span>{d.getDate()}</span>
              <span className={cn("w-1 h-1 rounded-full mt-0.5", has ? "bg-success" : "bg-transparent")} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
