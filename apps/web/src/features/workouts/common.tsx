import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/hooks";
import { IconButton } from "@/ui/Button";
import { useNavigate } from "react-router";
import type { ExerciseCategory, WorkoutListItem } from "@aravos/shared";
import { Icon, type IconName } from "@/ui/Icon";
import { StatusPill } from "@/ui/viz";
import { Group, Row } from "@/ui/List";
import { Sheet } from "@/ui/Sheet";
import { Checkbox } from "@/ui/Checkbox";
import { toast } from "@/ui/Toast";
import { ApiError } from "@/lib/api";
import { fmtRelativeDate } from "@/lib/format";
import { useAppSettings } from "@/data/queries";
import { useStartWorkout } from "./api";
import { exerciseSummary, fmtDuration, fmtSeconds, fmtVolume, nextSupersetGroup, WORKOUTS } from "./lib";

/** Starts a workout (empty or from a template) and opens the live screen. A 409 means one is already running: resume it. */
export function useStartFlow() {
  const navigate = useNavigate();
  const start = useStartWorkout();
  return {
    pending: start.isPending,
    start: (templateId?: string | null) =>
      start.mutate(
        { templateId: templateId ?? null },
        {
          onSuccess: () => navigate(`${WORKOUTS}/active`),
          onError: (e) => {
            if (e instanceof ApiError && e.status === 409) {
              toast("A workout is already in progress.");
              navigate(`${WORKOUTS}/active`);
            } else toast("Unable to start the workout.");
          },
        },
      ),
  };
}

/** "1h 5m" / "1,240 lb" as thin numbers with small units. Text content keeps its spaces ("1,240 lb"). */
export function NumUnit({ text, size = 20, className, testId }: { text: string; size?: number; className?: string; testId?: string }) {
  const parts = text.match(/[\d.,:]+|[^\d.,:]+/g) ?? [text];
  return (
    <span className={cn("inline-flex items-baseline whitespace-nowrap", className)} data-testid={testId}>
      {parts.map((p, i) => (/\d/.test(p) ? <span key={i} className="num text-primary" style={{ fontSize: size, lineHeight: `${Math.round(size * 1.1)}px` }}>{p}</span> : <span key={i} className="text-[12px] text-tertiary whitespace-pre">{p}</span>))}
    </span>
  );
}

/** Search input in a whiter well pill. Never auto-focuses; the keyboard only opens when the user taps it. */
export function SearchField({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("flex items-center gap-2 h-11 px-4 rounded-full well focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)] transition-shadow duration-200", className)}>
      <Icon name="search" size={17} className="text-tertiary shrink-0" />
      <input type="search" autoCorrect="off" autoCapitalize="none" enterKeyHint="search" className="flex-1 min-w-0 h-full bg-transparent outline-none text-[16px] text-primary placeholder:text-tertiary focus-visible:!outline-none" {...rest} />
    </label>
  );
}

/** Small icon well for exercise rows: a neutral glyph by tracking type. */
export function ExerciseIcon({ category, className }: { category: ExerciseCategory; className?: string }) {
  const name: IconName = category === "cardio" ? "heart" : category === "duration" ? "timer" : category === "reps_only" ? "repeat" : category === "bodyweight" || category === "weighted_bodyweight" || category === "assisted_bodyweight" ? "user" : "dumbbell";
  return (
    <span className={cn("w-9 h-9 rounded-[11px] well inline-flex items-center justify-center text-secondary shrink-0", className)} aria-hidden="true">
      <Icon name={name} size={17} strokeWidth={1.8} />
    </span>
  );
}

/** History item as a glass card: name and date, a PR pill, then time / volume / sets as thin numbers, then the exercise summary. */
export function WorkoutRow({ workout: w, onPress }: { workout: WorkoutListItem; onPress: () => void }) {
  const units = useAppSettings().units;
  const date = w.finishedAt ?? w.startedAt;
  const names = (w.exerciseSummary ?? []).map((e) => `${e.setCount} × ${e.name}`);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPress}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPress(); } }}
      className="glass rounded-lg px-4 pt-3.5 pb-3 pressable-spring cursor-pointer select-none"
      data-testid="workout-row"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[16px] leading-5 text-primary truncate">{w.name}</div>
          <div className="text-[12px] leading-4 text-tertiary mt-0.5">{fmtRelativeDate(date)}</div>
        </div>
        {w.prCount > 0 && <StatusPill tone="success" className="shrink-0">{w.prCount === 1 ? "PR" : `${w.prCount} PRs`}</StatusPill>}
        <Icon name="chevron-right" size={16} className="text-quaternary shrink-0 mt-0.5" />
      </div>
      <div className="flex items-end gap-5 mt-3">
        <Metric label="Time"><NumUnit text={fmtDuration(w.durationSeconds ?? 0)} /></Metric>
        <Metric label="Volume"><NumUnit text={fmtVolume(w.totalVolume ?? 0, units)} /></Metric>
        <Metric label="Sets"><NumUnit text={String(w.totalSets ?? 0)} /></Metric>
      </div>
      {names.length > 0 && <div className="text-[12px] text-tertiary truncate mt-2.5 pt-2.5 hairline-t">{exerciseSummary(names)}</div>}
    </div>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      {children}
      <div className="text-[11px] text-tertiary mt-0.5">{label}</div>
    </div>
  );
}

export const REST_CHOICES = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];

/** Per-exercise rest override. Off stops the timer from starting after this exercise's sets. */
export function RestSheet({ open, onClose, value, onPick }: { open: boolean; onClose: () => void; value: number | null; onPick: (v: number | null) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Rest Timer" trailing={null}>
      <Group inset={false} className="mt-1 mb-4">
        {REST_CHOICES.map((s) => (
          <Row key={s} title={s === 0 ? "Off" : fmtSeconds(s)} trailing={(value ?? 0) === s ? <Icon name="check" size={20} className="text-accent-text" /> : undefined} onPress={() => onPick(s === 0 ? 0 : s)} />
        ))}
      </Group>
    </Sheet>
  );
}

export interface SupersetMember {
  id: string;
  name: string;
  supersetGroup: number | null;
}

/** Pick two or more exercises to group; the group keeps a color bar on the left. */
export function SupersetSheet({ open, onClose, current, all, onSave }: { open: boolean; onClose: () => void; current: SupersetMember; all: SupersetMember[]; onSave: (ids: string[], group: number) => void }) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (open) setIds(all.filter((x) => x.id === current.id || (current.supersetGroup != null && x.supersetGroup === current.supersetGroup)).map((x) => x.id));
  }, [open, all, current]);
  const group = current.supersetGroup ?? nextSupersetGroup(all);
  return (
    <Sheet open={open} onClose={onClose} title="Superset" trailing={<button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={ids.length < 2 && current.supersetGroup == null} onClick={() => { onSave(ids.length >= 2 ? ids : [], group); onClose(); }}>Save</button>}>
      <p className="text-footnote text-secondary pt-1 pb-3">Select two or more exercises. Choosing only one removes the superset.</p>
      <Group inset={false} className="mb-4">
        {all.map((x) => (
          <Row key={x.id} title={x.name} leading={<Checkbox checked={ids.includes(x.id)} onChange={(v) => setIds((cur) => (v ? [...cur, x.id] : cur.filter((i) => i !== x.id)))} label={x.name} />} onPress={() => setIds((cur) => (cur.includes(x.id) ? cur.filter((i) => i !== x.id) : [...cur, x.id]))} />
        ))}
      </Group>
    </Sheet>
  );
}

/**
 * Compact glass bar (no large title) used by the live workout, the editor and their loading states.
 * Same chrome as ui/Screen when collapsed: frosted 44px bar, round glass back button, content scrolls under it.
 */
export function ScreenFrame({ title, onBack, left, right, children, center }: { title?: string; onBack: () => void; left?: ReactNode; right?: ReactNode; center?: ReactNode; children: ReactNode }) {
  const isDesktop = useIsDesktop();
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 relative z-20 pt-[var(--safe-top)] hairline-b" style={{ background: "var(--glass-fill-strong)", backdropFilter: "blur(24px) saturate(1.7)", WebkitBackdropFilter: "blur(24px) saturate(1.7)" }}>
        <div className="h-[var(--topbar-h)] grid grid-cols-[1fr_auto_1fr] items-center px-1 lg:max-w-[680px] lg:mx-auto w-full">
          <div className="justify-self-start flex items-center gap-2 pl-1">
            <IconButton label="Back" className="!min-w-0 !min-h-0 w-10 h-10 glass" onClick={onBack}>
              <Icon name="chevron-left" size={20} strokeWidth={1.8} />
            </IconButton>
            {left}
          </div>
          <div className="text-[16px] font-medium text-primary truncate max-w-[40vw] lg:max-w-none">{center ?? title}</div>
          <div className="justify-self-end flex items-center gap-2 pr-[calc(var(--gutter)-4px)]">{right}</div>
        </div>
      </div>
      <div className={cn("scroller flex-1 min-h-0 pb-[calc(var(--tabbar-h)+var(--safe-bottom)+24px)] lg:pb-10")}>
        <div className={cn("w-full", isDesktop && "max-w-[680px] mx-auto")}>{children}</div>
      </div>
    </div>
  );
}
