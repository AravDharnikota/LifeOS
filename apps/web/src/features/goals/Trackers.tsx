import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Tracker } from "@aravos/shared";
import { Section } from "@/ui/List";
import { Icon } from "@/ui/Icon";
import { BigNumber, ThinBar } from "@/ui/viz";
import { Sheet, ActionSheet } from "@/ui/Sheet";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { Skeleton, InlineError } from "@/ui/Empty";
import { cn } from "@/lib/cn";
import { impact, notify, selection } from "@/lib/haptics";
import { useLongPress } from "@/lib/hooks";
import { useTrackers } from "@/data/queries";
import { useCreateTracker, useDeleteTracker, useLogTracker } from "./api";
import { fmtNum } from "./model";
import { FormLabel, WellGroup, WellInput } from "./form";

/** User-defined counters under the goals list: small glass stat cards with round −/+ buttons. Hold a card for options. */
export function TrackersSection() {
  const { data, isLoading, error, refetch } = useTrackers();
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ tracker: Tracker; anchor: { x: number; y: number } } | null>(null);
  const [confirm, setConfirm] = useState<Tracker | null>(null);
  const del = useDeleteTracker();

  return (
    <Section
      title={<span className="text-[13px] text-secondary">Trackers</span>}
      action={
        <button type="button" className="text-[13px] text-accent-text -mb-0.5 h-8 px-1 active:opacity-60" onClick={() => setAdding(true)} data-testid="add-tracker">
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
        <div className="mx-[var(--gutter)] glass rounded-lg min-h-[52px] flex items-center px-4 text-[15px] text-secondary">No trackers yet.</div>
      ) : (
        <div className="px-[var(--gutter)] grid grid-cols-2 lg:grid-cols-3 gap-3">
          {data.map((t, i) => (
            <TrackerCard key={t.id} tracker={t} index={i} onMenu={(anchor) => setMenu({ tracker: t, anchor })} />
          ))}
        </div>
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

function precisionOf(step: number): number {
  const s = String(step);
  return s.includes(".") ? s.split(".")[1]!.length : 0;
}

function TrackerCard({ tracker: t, index, onMenu }: { tracker: Tracker; index: number; onMenu: (anchor: { x: number; y: number }) => void }) {
  const log = useLogTracker();
  const server = t.todayValue ?? 0;
  const [local, setLocal] = useState(server);
  const latest = useRef(server);
  latest.current = local;
  const delta = useRef(0);
  const timer = useRef<number | null>(null);
  const anchor = useRef({ x: 0, y: 0 });
  const lp = useLongPress(() => {
    void impact("medium");
    onMenu(anchor.current);
  });
  const step = t.step || 1;
  const prec = precisionOf(step);

  useEffect(() => {
    if (delta.current === 0) setLocal(server);
  }, [server]);

  const flush = () => {
    timer.current = null;
    const d = delta.current;
    delta.current = 0;
    if (d !== 0) log.mutate({ id: t.id, delta: d });
  };
  /** One tick: update the number now, send the summed change to the server once the taps stop. */
  const bump = (dir: 1 | -1) => {
    const prev = latest.current;
    const next = Math.max(0, Number((prev + dir * step).toFixed(prec)));
    if (next === prev) return;
    delta.current = Number((delta.current + next - prev).toFixed(prec));
    latest.current = next;
    setLocal(next);
    if (t.target != null && prev < t.target && next >= t.target) void notify("success");
    else void selection();
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 450);
  };
  useEffect(() => () => { if (timer.current) { window.clearTimeout(timer.current); flush(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unitWord = t.unit ? ` ${t.unit}` : "";
  const when = resetWord(t.reset);
  const sub = t.target != null ? `of ${fmtNum(t.target)}${unitWord} ${when}`.trim() : when ? when[0]!.toUpperCase() + when.slice(1) : null;
  const reached = t.target != null && local >= t.target;
  const shown = Number(local.toFixed(prec));

  return (
    <div
      className="glass rounded-lg p-3.5 select-none rise flex flex-col"
      style={{ "--i": index } as CSSProperties}
      data-testid="tracker-row"
      onContextMenu={(e) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY }); }}
      onPointerDown={(e) => { anchor.current = { x: e.clientX, y: e.clientY }; lp.onPointerDown(e); }}
      onPointerMove={lp.onPointerMove}
      onPointerUp={lp.onPointerUp}
      onPointerCancel={lp.onPointerCancel}
      onPointerLeave={lp.onPointerLeave}
    >
      <div className="text-[13px] leading-[18px] text-secondary truncate">{t.name}</div>
      <BigNumber value={fmtNum(shown)} unit={t.target == null ? t.unit ?? undefined : undefined} size={32} className="mt-1" />
      {t.target != null && <ThinBar progress={t.target > 0 ? local / t.target : 0} color={reached ? "var(--success)" : "var(--accent)"} height={4} className="mt-2.5" />}
      {sub && <div className={cn("text-[12px] leading-4 tabular mt-1.5 truncate", reached ? "text-success-text" : "text-tertiary")}>{sub}</div>}
      <div className="flex items-center justify-between mt-auto pt-3" role="group" aria-label={t.name}>
        <RoundStep dir={-1} onStep={bump} disabled={local <= 0} />
        <RoundStep dir={1} onStep={bump} />
      </div>
    </div>
  );
}

/**
 * Round glass −/+ button. Tap = one step; hold repeats after 400ms every 110ms.
 * Pointer events stop here so holding a button never opens the card menu.
 */
function RoundStep({ dir, onStep, disabled }: { dir: 1 | -1; onStep: (dir: 1 | -1) => void; disabled?: boolean }) {
  const t = useRef<{ wait?: number; rep?: number; repeated?: boolean }>({});
  const stop = () => {
    if (t.current.wait) window.clearTimeout(t.current.wait);
    if (t.current.rep) window.clearInterval(t.current.rep);
    t.current.wait = undefined;
    t.current.rep = undefined;
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      aria-label={dir > 0 ? "Increase" : "Decrease"}
      disabled={disabled}
      className="w-10 h-10 rounded-full glass inline-flex items-center justify-center text-primary active:scale-95 active:bg-pressed transition-[transform,background-color,opacity] duration-150 touch-none disabled:opacity-40"
      onPointerDown={(e) => {
        e.stopPropagation();
        t.current.repeated = false;
        stop();
        t.current.wait = window.setTimeout(() => {
          t.current.rep = window.setInterval(() => {
            t.current.repeated = true;
            onStep(dir);
          }, 110);
        }, 400);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => {
        e.stopPropagation();
        stop();
        if (t.current.repeated) {
          t.current.repeated = false;
          return;
        }
        onStep(dir);
      }}
    >
      <Icon name={dir > 0 ? "plus" : "minus"} size={18} strokeWidth={1.8} />
    </button>
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
  const nameRef = useRef<HTMLInputElement>(null);

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
      initialFocus={nameRef}
      trailing={
        <button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={create.isPending} onClick={() => void submit()} data-testid="tracker-done">
          Done
        </button>
      }
    >
      <div className="pt-2 pb-4 flex flex-col gap-5">
        <WellGroup error={error}>
          <WellInput ref={nameRef} label="Name" placeholder="Water" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} enterKeyHint="next" data-testid="tracker-name" />
          <WellInput label="Unit" placeholder="glasses" value={unit} onChange={(e) => setUnit(e.target.value)} autoCapitalize="none" />
          <WellInput label="Step" placeholder="1" inputMode="decimal" value={step} onChange={(e) => setStep(e.target.value)} />
          <WellInput label="Target" placeholder="Optional" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </WellGroup>
        <div>
          <FormLabel>Resets</FormLabel>
          <Segmented options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "never", label: "Never" }]} value={reset} onChange={setReset} />
        </div>
      </div>
    </Sheet>
  );
}
