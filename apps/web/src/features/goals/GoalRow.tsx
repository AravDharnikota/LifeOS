import { useRef } from "react";
import type { Goal } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { impact } from "@/lib/haptics";
import { useLongPress } from "@/lib/hooks";
import { Checkbox } from "@/ui/Checkbox";
import { Bar } from "@/ui/Ring";
import { Icon } from "@/ui/Icon";
import { fmtInt } from "@/lib/format";
import { colorVar, deadlineLabel, fmtNum, habitDoneToday, milestoneCounts, periodLabel, streakLabel } from "./model";
import { useGoalWithEntries } from "./api";

export interface GoalRowProps {
  goal: Goal;
  /** Desktop: a self-contained tappable card instead of a list row. */
  card?: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onMenu: (anchor: { x: number; y: number }) => void;
  togglePending?: boolean;
}

/** One goal: title, the kind-specific progress, and a check-in where the kind has one. Long press opens the menu. */
export function GoalRow({ goal: raw, card, onOpen, onToggle, onMenu, togglePending }: GoalRowProps) {
  const goal = useGoalWithEntries(raw);
  const anchorRef = useRef({ x: 0, y: 0 });
  const lp = useLongPress(() => {
    void impact("medium");
    onMenu(anchorRef.current);
  });
  const paused = goal.status === "paused";
  const done = goal.status === "done";
  const checkable = goal.kind === "habit" || goal.kind === "boolean";
  const checked = goal.kind === "boolean" ? done : habitDoneToday(goal);

  const trailing = checkable ? (
    <Checkbox checked={checked} onChange={onToggle} disabled={togglePending || paused} tint={goal.color ? colorVar(goal.color) : undefined} label={goal.kind === "habit" ? `Check in ${goal.title}` : `Mark ${goal.title} done`} />
  ) : null;

  const common = {
    role: "button" as const,
    tabIndex: 0,
    onClick: () => {
      if (lp.fired.current) return;
      onOpen();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen();
      }
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onMenu({ x: e.clientX, y: e.clientY });
    },
    onPointerDown: (e: React.PointerEvent) => {
      anchorRef.current = { x: e.clientX, y: e.clientY };
      lp.onPointerDown(e);
    },
    onPointerMove: lp.onPointerMove,
    onPointerUp: lp.onPointerUp,
    onPointerCancel: lp.onPointerCancel,
    onPointerLeave: lp.onPointerLeave,
    "data-testid": "goal-row",
    "data-goal-id": goal.id,
  };

  if (card) {
    return (
      <div {...common} className={cn("group relative bg-surface rounded-lg hairline p-4 cursor-pointer row-hover active:bg-pressed transition-colors duration-100 select-none", paused && "opacity-60")}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-headline text-primary truncate">{goal.title}</div>
            <StatusLine goal={goal} />
          </div>
          {trailing}
          <button
            type="button"
            aria-label="More"
            className="hit-44 -m-3 inline-flex items-center justify-center text-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150"
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onMenu({ x: r.left + r.width / 2, y: r.bottom });
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Icon name="more" size={20} />
          </button>
        </div>
        <div className="mt-3">
          <Body goal={goal} card />
        </div>
      </div>
    );
  }

  return (
    <div {...common} className={cn("row-sep relative flex items-center gap-3 pl-[var(--gutter)] pr-[var(--gutter)] bg-surface cursor-pointer row-hover active:bg-pressed transition-colors duration-100 select-none", paused && "opacity-60")}>
      <div className="flex-1 min-w-0 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-body text-primary truncate">{goal.title}</div>
          <StatusLine goal={goal} />
        </div>
        <Body goal={goal} />
      </div>
      {trailing}
    </div>
  );
}

/** Trailing status: deadline, Paused, or Done. */
function StatusLine({ goal }: { goal: Goal }) {
  if (goal.status === "done") return <span className="text-footnote text-success-text shrink-0">Done</span>;
  if (goal.status === "paused") return <span className="text-footnote text-secondary shrink-0">Paused</span>;
  const dl = deadlineLabel(goal.deadline);
  if (!dl) return null;
  return <span className={cn("text-footnote tabular shrink-0", dl.overdue ? "text-danger-text" : "text-secondary")}>{dl.text}</span>;
}

function Body({ goal, card }: { goal: Goal; card?: boolean }) {
  const color = colorVar(goal.color);
  const progress = goal.progress ?? 0;
  switch (goal.kind) {
    case "number": {
      const cur = goal.currentValue ?? 0;
      return (
        <div className={card ? "" : "mt-1"}>
          <div className="flex items-baseline gap-1.5 tabular">
            {card ? (
              <>
                <span className="num text-title-1 text-primary">{fmtNum(cur)}</span>
                {goal.targetValue != null && <span className="text-subhead text-secondary">of {fmtNum(goal.targetValue)}</span>}
                {goal.unit && <span className="text-subhead text-secondary">{goal.unit}</span>}
              </>
            ) : (
              <span className="text-subhead text-secondary">
                {fmtNum(cur)}
                {goal.targetValue != null ? ` / ${fmtNum(goal.targetValue)}` : ""}
                {goal.unit ? ` ${goal.unit}` : ""}
              </span>
            )}
          </div>
          <Bar progress={progress} color={color} className="mt-2" height={card ? 6 : 4} />
        </div>
      );
    }
    case "habit": {
      const s = streakLabel(goal);
      return (
        <div className={cn("flex items-baseline gap-x-3 gap-y-0 flex-wrap", card ? "" : "mt-0.5")}>
          <span className="flex items-baseline gap-1.5">
            <span className="num text-title-1 text-primary" data-testid="streak-value">{fmtInt(s.n)}</span>
            <span className="text-subhead text-secondary">{s.unit}</span>
          </span>
          <span className="text-footnote text-secondary tabular">{periodLabel(goal)}</span>
        </div>
      );
    }
    case "milestone": {
      const { done, total } = milestoneCounts(goal);
      return (
        <div className={card ? "" : "mt-1"}>
          <div className="flex items-baseline gap-1.5 tabular">
            {card ? (
              <>
                <span className="num text-title-1 text-primary">{fmtInt(done)}</span>
                <span className="text-subhead text-secondary">of {fmtInt(total)} milestones</span>
              </>
            ) : (
              <span className="text-subhead text-secondary">
                {fmtInt(done)} of {fmtInt(total)} milestones
              </span>
            )}
          </div>
          <Bar progress={progress} color={color} className="mt-2" height={card ? 6 : 4} />
        </div>
      );
    }
    default:
      return card ? <div className="text-subhead text-secondary">{goal.status === "done" ? "Done" : "Not yet"}</div> : goal.description ? <div className="text-subhead text-secondary truncate mt-0.5">{goal.description}</div> : null;
  }
}
