import { useMemo } from "react";
import { useNavigate } from "react-router";
import { parseISO } from "date-fns";
import type { CalEvent } from "@aravos/shared";
import { useCalendars, useDaySummary } from "@/data/queries";
import { fmtTime } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import { colorVar, type WidgetOf, type WidgetProps } from "../types";
import { Pressable, WidgetEmpty, WidgetError, WidgetLabel, WidgetSkeleton } from "./shared";

type Row = { kind: "event"; event: CalEvent } | { kind: "now" };

/** Next events for today: time gutter plus title. Time boxes get a dashed outline and a check circle. */
export function AgendaWidget({ widget, sectionTitle }: WidgetProps<WidgetOf<"agenda">>) {
  const navigate = useNavigate();
  const now = useNow(30_000);
  const summary = useDaySummary();
  const calendars = useCalendars();
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

  return (
    <Pressable label="Open calendar" onPress={open}>
      {label && <WidgetLabel trailing={total > 0 ? `${total - past} of ${total}` : undefined}>{label}</WidgetLabel>}
      {summary.isPending ? (
        <WidgetSkeleton lines={3} />
      ) : summary.isError ? (
        <WidgetError onRetry={() => void summary.refetch()} />
      ) : rows.length === 0 && allDay.length === 0 ? (
        <WidgetEmpty action={total > 0 ? "Open Calendar" : "Add Event"} onAction={() => navigate(total > 0 ? "/calendar" : "/calendar?new=1")}>
          {total > 0 ? "No more events today." : "No events today."}
        </WidgetEmpty>
      ) : (
        <div className="flex flex-col gap-1.5">
          {allDay.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1">
              {allDay.map((e) => (
                <span key={e.id} className="cal-fill rounded-xs px-2 h-6 inline-flex items-center text-caption-1 font-medium max-w-full truncate" style={{ ["--cal-color" as string]: colorOf(e) }}>
                  {e.title}
                </span>
              ))}
            </div>
          )}
          {rows.map((r, i) =>
            r.kind === "now" ? (
              <div key={`now-${i}`} className="flex items-center gap-2 h-4" aria-label={`Now, ${fmtTime(now)}`}>
                <span className="w-11 text-right text-caption-1 font-medium tabular text-danger-text">{fmtTime(now)}</span>
                <span className="flex-1 h-px bg-danger" />
              </div>
            ) : (
              <EventRow key={r.event.id + r.event.start} event={r.event} color={colorOf(r.event)} now={now} />
            ),
          )}
        </div>
      )}
    </Pressable>
  );
}

function EventRow({ event, color, now }: { event: CalEvent; color: string; now: Date }) {
  const live = parseISO(event.start).getTime() <= now.getTime();
  const timebox = event.kind === "timebox";
  const done = event.taskStatus === "done";
  return (
    <div className="flex items-stretch gap-2 min-h-[32px]">
      <div className="w-11 shrink-0 text-right pt-[7px]">
        <span className={cn("text-caption-1 tabular", live ? "text-primary font-medium" : "text-tertiary")}>{fmtTime(event.start)}</span>
      </div>
      <div className={cn("flex-1 min-w-0 flex items-center gap-2 rounded-xs px-2 py-1.5", timebox ? "timebox-outline" : "cal-fill")} style={{ ["--cal-color" as string]: color }}>
        {timebox && (
          <span className={cn("w-3.5 h-3.5 rounded-full border-[1.5px] shrink-0", done ? "bg-success border-success" : "border-border")} aria-hidden="true" />
        )}
        <span className={cn("text-footnote font-semibold truncate", timebox && (done ? "text-tertiary" : "text-secondary"))}>{event.title}</span>
        <span className={cn("ml-auto text-caption-1 tabular shrink-0", timebox ? "text-tertiary" : "opacity-70")}>{fmtTime(event.end)}</span>
      </div>
    </div>
  );
}
