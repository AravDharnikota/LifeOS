import { differenceInCalendarDays } from "date-fns";
import { parseDateString } from "@aravos/shared";
import { fmtDate, fmtInt } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { WidgetOf, WidgetProps } from "../types";
import { Hero, WidgetLabel } from "./shared";

/** Days until a date: a large thin number and the date in a white chip. */
export function CountdownWidget({ widget }: WidgetProps<WidgetOf<"countdown">>) {
  const now = useNow(60_000);
  const days = differenceInCalendarDays(parseDateString(widget.date), now);
  const past = days < 0;
  return (
    <>
      <WidgetLabel>{widget.title ?? widget.label}</WidgetLabel>
      {days === 0 ? (
        <Hero value="Today" size="display-44" />
      ) : (
        <Hero value={fmtInt(Math.abs(days))} size="display-44" unit={past ? (days === -1 ? "day ago" : "days ago") : days === 1 ? "day" : "days"} />
      )}
      <div className="mt-auto pt-3">
        <span className="h-7 px-2.5 rounded-full well inline-flex items-center text-[12px] text-secondary tabular">{fmtDate(widget.date)}</span>
      </div>
    </>
  );
}
