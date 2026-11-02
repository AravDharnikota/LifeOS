import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/hooks";
import { IconButton } from "@/ui/Button";
import { useNavigate } from "react-router";
import type { WorkoutListItem } from "@aravos/shared";
import { Icon } from "@/ui/Icon";
import { Group, Row } from "@/ui/List";
import { Sheet } from "@/ui/Sheet";
import { Checkbox } from "@/ui/Checkbox";
import { toast } from "@/ui/Toast";
import { ApiError } from "@/lib/api";
import { fmtRelativeDate } from "@/lib/format";
import { useAppSettings } from "@/data/queries";
import { useStartWorkout } from "./api";
import { fmtDuration, fmtSeconds, fmtVolume, nextSupersetGroup, WORKOUTS } from "./lib";

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

/** History row: name, then date · duration · volume, trophy count trailing. */
export function WorkoutRow({ workout: w, onPress }: { workout: WorkoutListItem; onPress: () => void }) {
  const units = useAppSettings().units;
  const date = w.finishedAt ?? w.startedAt;
  const meta: ReactNode[] = [fmtRelativeDate(date), fmtDuration(w.durationSeconds ?? 0), fmtVolume(w.totalVolume ?? 0, units)];
  return (
    <Row
      title={w.name}
      subtitle={<span className="tabular">{meta.join(" · ")}</span>}
      trailing={w.prCount > 0 ? <span className="inline-flex items-center gap-1 text-footnote text-warning-text"><Icon name="trophy" size={16} />{w.prCount}</span> : undefined}
      chevron
      onPress={onPress}
      data-testid="workout-row"
    />
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

/** Compact bar (no large title) used by the editor and its loading states. */
export function ScreenFrame({ title, onBack, left, right, children, center }: { title?: string; onBack: () => void; left?: ReactNode; right?: ReactNode; center?: ReactNode; children: ReactNode }) {
  const isDesktop = useIsDesktop();
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 relative z-20 pt-[var(--safe-top)] hairline-b bg-canvas">
        <div className="h-[var(--topbar-h)] grid grid-cols-[1fr_auto_1fr] items-center px-1 lg:max-w-[640px] lg:mx-auto w-full">
          <div className="justify-self-start flex items-center gap-0.5">
            <IconButton label="Back" onClick={onBack}><Icon name="chevron-left" size={24} /></IconButton>
            {left}
          </div>
          <div className="text-headline text-primary">{center ?? title}</div>
          <div className="justify-self-end flex items-center gap-1 pr-2">{right}</div>
        </div>
      </div>
      <div className={cn("scroller flex-1 min-h-0 pb-[calc(var(--tabbar-h)+var(--safe-bottom)+24px)] lg:pb-10")}>
        <div className={cn("w-full", isDesktop && "max-w-[640px] mx-auto")}>{children}</div>
      </div>
    </div>
  );
}

