import { useMemo, type CSSProperties } from "react";
import { parseISO } from "date-fns";
import { useAppSettings, useDaySummary } from "@/data/queries";
import { cn } from "@/lib/cn";
import { fmtDateLong, fmtTime, plural } from "@/lib/format";
import { useUi } from "@/state/ui";
import { Icon, type IconName } from "@/ui/Icon";
import { Spinner } from "@/ui/Spinner";
import { QUICK_ACTIONS, useQuickActions, type QuickAction } from "./useQuickActions";

function greetingFor(now: Date): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}

/** "Good evening, Arav" as the page's h1 (its accessible name still starts with "Today"), plus date and a one-line summary. */
export function Greeting({ now }: { now: Date }) {
  const settings = useAppSettings();
  const summary = useDaySummary();
  const name = settings.name.trim();

  const line = useMemo(() => {
    const s = summary.data;
    if (!s) return null;
    const open = s.tasks.openCount;
    const next = s.events
      .filter((e) => e.status !== "cancelled" && !e.allDay && parseISO(e.start).getTime() > now.getTime())
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    const parts: string[] = [];
    if (open > 0) parts.push(`${plural(open, "task")} open`);
    if (next) parts.push(`next: ${next.title} at ${fmtTime(next.start, settings.hour12)}`);
    const text = parts.length ? parts.join(", ") : "all clear";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }, [summary.data, now, settings.hour12]);

  return (
    <div className="min-w-0">
      <h1 className="text-large-title text-primary tracking-[-0.025em]">
        <span className="sr-only">Today, </span>
        {greetingFor(now)}
        {name ? `, ${name}` : ""}
      </h1>
      <p className="text-[14px] leading-5 text-tertiary mt-1 truncate">
        {fmtDateLong(now)}
        {line && <span className="text-quaternary"> · </span>}
        {line}
      </p>
    </div>
  );
}

const CHIPS: QuickAction[] = ["add_task", "log_meal", "add_water", "start_workout", "add_event"];

/** A sideways row of glass pills: icon plus label. "Add Task" is the one highlighted action on the page. */
export function QuickChips() {
  const { run, busy } = useQuickActions();
  const openAgent = useUi((s) => s.openAgent);
  const chip = "h-9 px-3.5 rounded-full inline-flex items-center gap-2 text-[14px] whitespace-nowrap shrink-0 pressable-spring rise";
  return (
    <div className="today-chips -mt-1 mb-4 overflow-x-auto no-scrollbar lg:overflow-visible" role="toolbar" aria-label="Quick actions">
      <div className="flex gap-2 px-[var(--gutter)] py-1 w-max lg:w-auto lg:flex-wrap">
        {CHIPS.map((a, i) => (
          <Chip key={a} icon={QUICK_ACTIONS[a].icon} busy={busy === a} className={cn(chip, i === 0 ? "bg-highlight text-on-highlight shadow-thumb" : "glass text-primary")} style={{ "--i": i } as CSSProperties} onClick={() => run(a)}>
            {QUICK_ACTIONS[a].label}
          </Chip>
        ))}
        <Chip icon="sparkle" className={cn(chip, "glass text-primary")} style={{ "--i": CHIPS.length } as CSSProperties} onClick={() => openAgent()}>
          Ask Assistant
        </Chip>
      </div>
    </div>
  );
}

function Chip({ icon, busy, className, style, onClick, children }: { icon: IconName; busy?: boolean; className: string; style?: CSSProperties; onClick: () => void; children: string }) {
  return (
    <button type="button" className={className} style={style} onClick={onClick} disabled={busy}>
      <span className="opacity-70">{busy ? <Spinner size={14} /> : <Icon name={icon} size={16} strokeWidth={1.8} />}</span>
      {children}
    </button>
  );
}
