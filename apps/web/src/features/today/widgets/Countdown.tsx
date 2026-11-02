import { differenceInCalendarDays } from "date-fns";
import { parseDateString } from "@aravos/shared";
import { fmtDate, fmtInt } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { WidgetOf, WidgetProps } from "../types";
import { Hero, Sub, WidgetLabel } from "./shared";

/** Days until a date. */
export function CountdownWidget({ widget }: WidgetProps<WidgetOf<"countdown">>) {
  const now = useNow(60_000);
  const days = differenceInCalendarDays(parseDateString(widget.date), now);
  const past = days < 0;
  return (
    <>
      <WidgetLabel>{widget.title ?? widget.label}</WidgetLabel>
      {days === 0 ? (
        <Hero value="Today" />
      ) : (
        <Hero value={fmtInt(Math.abs(days))} unit={past ? (days === -1 ? "day ago" : "days ago") : days === 1 ? "day" : "days"} />
      )}
      <Sub className="tabular">{fmtDate(widget.date)}</Sub>
    </>
  );
}
