import { useMemo } from "react";
import { useNavigate } from "react-router";
import { parseISO } from "date-fns";
import type { CalEvent } from "@aravos/shared";
import { useAppSettings, useCalendars, useDaySummary } from "@/data/queries";
import { fmtTime } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import { StatusPill } from "@/ui/viz";
import { colorVar, type WidgetOf, type WidgetProps } from "../types";
import { Pressable, WidgetEmpty, WidgetError, WidgetLabel, WidgetSkeleton } from "./shared";

type Row = { kind: "event"; event: CalEvent } | { kind: "now" };

/** Next events for today as rows in a white well: time, a color tick, title, and a status (Live, Done, or end time). */
export function AgendaWidget({ widget, sectionTitle }: WidgetProps<WidgetOf<"agenda">>) {
  const navigate = useNavigate();
  const now = useNow(30_000);
  const summary = useDaySummary();
  const calendars = useCalendars();
  const hour12 = useAppSettings().hour12;
  const colorOf = (e: CalEvent) => colorVar(e.color ?? calendars.data?.find((c) => c.id === e.calendarId)?.color);

  const { allDay, rows, past, total } = useMemo(() => {
    const events = (summary.data?.events ?? []).filter((e) => e.status !== "cancelled");
    const allDay = events.filter((e) => e.allDay);
    const timed = events.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start));
    const horizon = now.getTime() + widget.hours * 3600_000;
    const upcoming = timed.filter((e) => parseISO(e.end).getTime() > now.getTime() && parseISO(e.start).getTime() <= horizon);
    const rows: Row[] = [];
    let placedNow = false;
    for (const e of upcoming) {
      if (!placedNow && parseISO(e.start).getTime() > now.getTime()) {
        if (rows.length > 0) rows.push({ kind: "now" });
        placedNow = true;
      }
      rows.push({ kind: "event", event: e });
    }
    return { allDay, rows: rows.slice(0, 7), past: timed.length - upcoming.length, total: timed.length };
  }, [summary.data, now, widget.hours]);

  const label = widget.title ?? (sectionTitle === "Agenda" ? null : "Agenda");
  const open = () => navigate("/calendar");
  const left = total - past;
  const sub = summary.data ? (total === 0 && allDay.length === 0 ? "Nothing scheduled" : `${total} ${total === 1 ? "event" : "events"}${allDay.length ? `, ${allDay.length} all day` : ""}`) : undefined;

  return (
    <Pressable label="Open calendar" onPress={open}>
      {label ? (
        <WidgetLabel icon="calendar" sub={sub} trailing={past > 0 && left > 0 ? `${left} left` : undefined}>{label}</WidgetLabel>
      ) : (
        sub && <p className="text-[12px] leading-4 text-tertiary mb-3">{sub}</p>
      )}
      {summary.isPending ? (
        <WidgetSkeleton lines={3} />
      ) : summary.isError ? (
        <WidgetError onRetry={() => void summary.refetch()} />
      ) : rows.length === 0 && allDay.length === 0 ? (
        <WidgetEmpty action={total > 0 ? "Open Calendar" : "Add Event"} onAction={() => navigate(total > 0 ? "/calendar" : "/calendar?new=1")}>
          {total > 0 ? "No more events today." : "No events today."}
        </WidgetEmpty>
      ) : (
        <div className="flex flex-col gap-2.5">
          {allDay.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allDay.map((e) => (
                <span key={e.id} className="cal-fill rounded-full px-2.5 h-6 inline-flex items-center text-[12px] max-w-full truncate" style={{ ["--cal-color" as string]: colorOf(e) }}>
                  {e.title}
                </span>
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <div className="well rounded-md overflow-hidden">
              {rows.map((r, i) =>
                r.kind === "now" ? (
                  <div key={`now-${i}`} className="flex items-center gap-2 h-5 px-3" aria-label={`Now, ${fmtTime(now, hour12)}`}>
                    <span className="w-11 text-[11px] tabular text-danger-text">{fmtTime(now, hour12)}</span>
                    <span className="flex-1 h-px bg-danger opacity-60" />
                  </div>
                ) : (
                  <EventRow key={r.event.id + r.event.start} event={r.event} color={colorOf(r.event)} now={now} hour12={hour12} first={i === 0} />
                ),
              )}
            </div>
          )}
        </div>
      )}
    </Pressable>
  );
}

function EventRow({ event, color, now, hour12, first }: { event: CalEvent; color: string; now: Date; hour12: boolean; first: boolean }) {
  const live = parseISO(event.start).getTime() <= now.getTime();
  const timebox = event.kind === "timebox";
  const done = event.taskStatus === "done";
  return (
    <div className={cn("flex items-center gap-3 min-h-[44px] px-3", !first && "hairline-t")}>
      <span className={cn("w-11 shrink-0 text-[12px] tabular", live ? "text-primary" : "text-tertiary")}>{fmtTime(event.start, hour12)}</span>
      <span className={cn("w-[3px] h-5 rounded-full shrink-0", timebox && "opacity-50")} style={{ background: color }} aria-hidden="true" />
      <span className={cn("flex-1 min-w-0 text-[14px] leading-5 truncate", done ? "text-tertiary line-through decoration-[1px]" : timebox ? "text-secondary" : "text-primary")}>{event.title}</span>
      {done ? (
        <StatusPill tone="success">Done</StatusPill>
      ) : live ? (
        <StatusPill tone="success" dot>Live</StatusPill>
      ) : (
        <span className="text-[12px] tabular text-tertiary shrink-0">{fmtTime(event.end, hour12)}</span>
      )}
    </div>
  );
}
