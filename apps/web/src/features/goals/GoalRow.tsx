import { useRef } from "react";
import type { Goal } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { impact, notify } from "@/lib/haptics";
import { useLongPress } from "@/lib/hooks";
import { Checkbox } from "@/ui/Checkbox";
import { Icon } from "@/ui/Icon";
import { ArcRing, StatusPill } from "@/ui/viz";
import { fmtInt } from "@/lib/format";
import { STANDING_LABEL, STANDING_TONE, colorVar, deadlineLabel, habitDoneToday, quietValue, standing, streakLabel } from "./model";
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

/**
 * One goal, laid out like a challenge row: a thin progress ring (or a check for habits and yes/no goals),
 * the title, a quiet value line, and a status pill. Long press opens the menu.
 */
export function GoalRow({ goal: raw, card, onOpen, onToggle, onMenu, togglePending }: GoalRowProps) {
  const goal = useGoalWithEntries(raw);
  const anchorRef = useRef({ x: 0, y: 0 });
  const lp = useLongPress(() => {
    void impact("medium");
    onMenu(anchorRef.current);
  });
  const paused = goal.status === "paused";
  const checkable = goal.kind === "habit" || goal.kind === "boolean";
  const checked = goal.kind === "boolean" ? goal.status === "done" : habitDoneToday(goal);
  const st = standing(goal);

  const toggle = () => {
    // Boolean goals get their success haptic from the log mutation when they turn done.
    if (goal.kind === "habit" && !checked) void notify("success");
    onToggle();
  };

  const lead = checkable ? (
    <Checkbox checked={checked} onChange={toggle} size={card ? 30 : 26} disabled={togglePending || paused} tint={goal.color ? colorVar(goal.color) : undefined} label={goal.kind === "habit" ? `Check in ${goal.title}` : `Mark ${goal.title} done`} />
  ) : (
    <ProgressRing goal={goal} size={card ? 40 : 30} />
  );

  const common = {
    role: "button" as const,
    tabIndex: 0,
    onClick: () => {
      if (lp.fired.current) return;
      onOpen();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
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
      <div {...common} className={cn("group relative glass rounded-lg p-4 cursor-pointer pressable-spring select-none", paused && "opacity-60")}>
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 shrink-0 flex items-center justify-center">{lead}</div>
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="text-[16px] leading-[22px] text-primary truncate">{goal.title}</div>
            <Quiet goal={goal} className="mt-0.5" />
          </div>
          <StatusPill tone={STANDING_TONE[st]} className="mt-0.5">{STANDING_LABEL[st]}</StatusPill>
          <button
            type="button"
            aria-label="More"
            className="hit-44 -my-2.5 -mr-2.5 inline-flex items-center justify-center text-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150"
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
      </div>
    );
  }

  return (
    <div {...common} className={cn("row-sep relative flex items-center gap-3 min-h-[64px] pl-[var(--gutter)] pr-[var(--gutter)] cursor-pointer row-hover active:bg-pressed transition-colors duration-100 select-none", paused && "opacity-60")}>
      <div className="w-[30px] shrink-0 flex items-center justify-center">{lead}</div>
      <div className="flex-1 min-w-0 py-3">
        <div className="text-[16px] leading-[21px] text-primary truncate">{goal.title}</div>
        <Quiet goal={goal} className="mt-0.5" />
      </div>
      <StatusPill tone={STANDING_TONE[st]} className="shrink-0">{STANDING_LABEL[st]}</StatusPill>
    </div>
  );
}

/** A small thin ring with the goal's color; exposed to assistive tech as a progressbar. */
function ProgressRing({ goal, size }: { goal: Goal; size: number }) {
  const progress = goal.progress ?? 0;
  const pct = Math.round(progress * 100);
  return (
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}%`} className="inline-flex">
      <ArcRing progress={progress} size={size} stroke={size >= 40 ? 4 : 3.5} color={colorVar(goal.color)} />
    </div>
  );
}

/** "2/12 books · 12 days left", "4 day streak · Every day". Muted, tabular. */
function Quiet({ goal, className }: { goal: Goal; className?: string }) {
  const dl = goal.status === "active" ? deadlineLabel(goal.deadline) : null;
  return (
    <div className={cn("text-[13px] leading-[18px] text-tertiary tabular truncate", className)}>
      {goal.kind === "habit" ? (
        <>
          <span className="text-secondary" data-testid="streak-value">{fmtInt(streakLabel(goal).n)}</span> {streakLabel(goal).unit}
          <span aria-hidden="true"> · </span>
          {quietValue(goal)}
        </>
      ) : goal.kind === "boolean" ? (
        goal.description ? <span>{goal.description}</span> : <span>{quietValue(goal)}</span>
      ) : (
        <span className="text-secondary">{quietValue(goal)}</span>
      )}
      {dl && goal.kind !== "habit" && (
        <>
          <span aria-hidden="true"> · </span>
          <span className={dl.overdue ? "text-danger-text" : undefined}>{dl.text}</span>
        </>
      )}
    </div>
  );
}
