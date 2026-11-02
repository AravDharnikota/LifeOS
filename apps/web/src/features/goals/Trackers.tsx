import { useEffect, useRef, useState } from "react";
import type { Tracker } from "@aravos/shared";
import { Group, Section } from "@/ui/List";
import { Stepper } from "@/ui/Stepper";
import { Sheet, ActionSheet } from "@/ui/Sheet";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { TextField } from "@/ui/Field";
import { Skeleton, InlineError } from "@/ui/Empty";
import { cn } from "@/lib/cn";
import { impact, notify } from "@/lib/haptics";
import { useLongPress } from "@/lib/hooks";
import { useTrackers } from "@/data/queries";
import { useCreateTracker, useDeleteTracker, useLogTracker } from "./api";
import { fmtNum } from "./model";

/** User-defined counters under the goals list: hero number with a stepper, add via a sheet, delete via the menu. */
export function TrackersSection() {
  const { data, isLoading, error, refetch } = useTrackers();
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ tracker: Tracker; anchor: { x: number; y: number } } | null>(null);
  const [confirm, setConfirm] = useState<Tracker | null>(null);
  const del = useDeleteTracker();

  return (
    <Section
      title="Trackers"
      action={
        <button type="button" className="text-footnote text-accent-text font-medium -mb-0.5" onClick={() => setAdding(true)} data-testid="add-tracker">
          Add Tracker
        </button>
      }
      footer={data && data.length ? "Hold a tracker for options." : undefined}
    >
      {isLoading ? (
        <Skeleton rows={2} />
      ) : error ? (
        <InlineError onRetry={() => void refetch()}>Unable to load trackers</InlineError>
      ) : !data?.length ? (
        <Group>
          <div className="min-h-[44px] flex items-center px-[var(--gutter)] text-callout text-secondary">No trackers yet.</div>
        </Group>
      ) : (
        <Group>
          {data.map((t) => (
            <TrackerRow key={t.id} tracker={t} onMenu={(anchor) => setMenu({ tracker: t, anchor })} />
          ))}
        </Group>
      )}
      <Menu open={Boolean(menu)} onClose={() => setMenu(null)} anchor={menu?.anchor ?? null} items={[{ label: "Delete", icon: "trash", destructive: true, onPress: () => menu && setConfirm(menu.tracker) }]} />
      <ActionSheet open={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm ? `Delete ${confirm.name}?` : undefined} message="Logged values are removed as well." actions={[{ label: "Delete Tracker", destructive: true, onPress: () => confirm && del.mutate(confirm.id) }]} />
      <TrackerSheet open={adding} onClose={() => setAdding(false)} />
    </Section>
  );
}

function resetWord(reset: Tracker["reset"]): string {
  return reset === "daily" ? "today" : reset === "weekly" ? "this week" : "";
}

function TrackerRow({ tracker: t, onMenu }: { tracker: Tracker; onMenu: (anchor: { x: number; y: number }) => void }) {
  const log = useLogTracker();
  const server = t.todayValue ?? 0;
  const [local, setLocal] = useState(server);
  const delta = useRef(0);
  const timer = useRef<number | null>(null);
  const anchor = useRef({ x: 0, y: 0 });
  const lp = useLongPress(() => {
    void impact("medium");
    onMenu(anchor.current);
  });

  useEffect(() => {
    if (delta.current === 0) setLocal(server);
  }, [server]);

  const flush = () => {
    timer.current = null;
    const d = delta.current;
    delta.current = 0;
    if (d !== 0) log.mutate({ id: t.id, delta: d });
  };
  const change = (v: number) => {
    delta.current += v - local;
    setLocal(v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 450);
  };
  useEffect(() => () => { if (timer.current) { window.clearTimeout(timer.current); flush(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sub = t.target != null ? `of ${fmtNum(t.target)}${t.unit ? ` ${t.unit}` : ""} ${resetWord(t.reset)}`.trim() : [t.unit, resetWord(t.reset)].filter(Boolean).join(" ") || null;
  const reached = t.target != null && local >= t.target;

  return (
    <div
      className="row-sep relative flex items-center gap-3 pl-[var(--gutter)] pr-3 min-h-[60px] bg-surface select-none"
      data-testid="tracker-row"
      onContextMenu={(e) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY }); }}
      onPointerDown={(e) => { anchor.current = { x: e.clientX, y: e.clientY }; lp.onPointerDown(e); }}
      onPointerMove={lp.onPointerMove}
      onPointerUp={lp.onPointerUp}
      onPointerCancel={lp.onPointerCancel}
      onPointerLeave={lp.onPointerLeave}
    >
      <div className="flex-1 min-w-0 py-2">
        <div className="text-body text-primary truncate">{t.name}</div>
        {sub && <div className={cn("text-footnote tabular mt-0.5", reached ? "text-success-text" : "text-secondary")}>{sub}</div>}
      </div>
      <Stepper value={local} onChange={change} step={t.step || 1} min={0} className="w-[168px] shrink-0" label={t.name} />
    </div>
  );
}

function TrackerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateTracker();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [step, setStep] = useState("1");
  const [target, setTarget] = useState("");
  const [reset, setReset] = useState<Tracker["reset"]>("daily");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setUnit("");
      setStep("1");
      setTarget("");
      setReset("daily");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) return setError("Enter a name");
    const s = Number(step.replace(",", "."));
    if (!(s > 0)) return setError("Choose a step above 0");
    const tg = target.trim() ? Number(target.replace(",", ".")) : null;
    if (tg != null && !Number.isFinite(tg)) return setError("Enter a number for the target");
    try {
      await create.mutateAsync({ name: name.trim(), unit: unit.trim() || null, step: s, target: tg, reset });
      onClose();
    } catch (e) {
      void notify("error");
      setError(e instanceof Error ? e.message : "Unable to add tracker");
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New Tracker"
      dirty={Boolean(name || unit || target)}
      trailing={
        <button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={create.isPending} onClick={() => void submit()} data-testid="tracker-done">
          Done
        </button>
      }
    >
      <div className="pt-2 pb-4 flex flex-col gap-4">
        <TextField label="Name" placeholder="Water" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} autoFocus data-testid="tracker-name" />
        <div className="grid grid-cols-3 gap-3">
          <TextField label="Unit" placeholder="glasses" value={unit} onChange={(e) => setUnit(e.target.value)} autoCapitalize="none" />
          <TextField label="Step" placeholder="1" inputMode="decimal" value={step} onChange={(e) => setStep(e.target.value)} />
          <TextField label="Target" placeholder="8" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div>
          <span className="block text-footnote text-secondary mb-1.5">Resets</span>
          <Segmented options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "never", label: "Never" }]} value={reset} onChange={setReset} />
        </div>
        {error && <p className="text-footnote text-danger-text">{error}</p>}
      </div>
    </Sheet>
  );
}
