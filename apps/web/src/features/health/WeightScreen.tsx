import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { WeightLog } from "@aravos/shared";
import { addDaysString, parseDateString } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row, Section } from "@/ui/List";
import { BigNumber, CardHeader, StatusPill, Trend } from "@/ui/viz";
import { ActionSheet } from "@/ui/Sheet";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { cn } from "@/lib/cn";
import { fmt1, fmtRelativeDate, fmtWeight, toDisplayWeight } from "@/lib/format";
import { useIsDesktop } from "@/lib/hooks";
import { useAppSettings, useSettings } from "@/data/queries";
import { useDeleteWeight, useWeight } from "@/features/nutrition/api";
import { signOf } from "@/features/nutrition/model";
import { LineChart } from "./charts";
import { WeightSheet } from "./WeightSheet";
import { riseStyle } from "./parts";

type Period = "30" | "90" | "365";
const PERIODS: { value: Period; label: string }[] = [
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "365", label: "1Y" },
];

/** Latest weight as the hero, the smoothed trend over raw weigh-ins, changes, and the log. */
export default function WeightScreen() {
  const isDesktop = useIsDesktop();
  const { units } = useAppSettings();
  const profile = useSettings().data?.healthProfile;
  const unit = units === "imperial" ? "lb" : "kg";
  const [period, setPeriod] = useState<Period>("30");
  const [logOpen, setLogOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<WeightLog | null>(null);
  const weight = useWeight(400);
  const del = useDeleteWeight();
  const days = Number(period);
  const data = weight.data;
  const latest = data?.latest ?? null;
  const goal = profile?.goal ?? "maintain";

  const points = useMemo(() => {
    if (!data) return [];
    const last = data.trend[data.trend.length - 1];
    if (!last) return [];
    const cutoff = addDaysString(last.date, -days);
    return data.trend
      .filter((p) => p.date > cutoff)
      .map((p) => ({ key: p.date, label: format(parseDateString(p.date), days > 90 ? "MMM" : "d MMM"), value: toDisplayWeight(p.emaKg, units), raw: toDisplayWeight(p.weightKg, units) }));
  }, [data, days, units]);
  const first = points[0];
  const lastPoint = points[points.length - 1];
  const periodChange = first && lastPoint && points.length > 1 ? lastPoint.value - first.value : null;
  const sel = selected != null ? points[selected] : undefined;

  const good = (delta: number | null) => (delta == null || Math.abs(delta) < 0.05 ? null : goal === "lose" ? delta < 0 : goal === "gain" ? delta > 0 : null);
  const deltaText = (kg: number | null) => {
    if (kg == null) return "Not enough data";
    const v = toDisplayWeight(Math.abs(kg), units);
    return `${signOf(kg)}${fmt1(v)} ${unit}`;
  };
  const deltaClass = (kg: number | null) => {
    const g = good(kg);
    return g === true ? "text-success-text" : g === false ? "text-danger-text" : "text-secondary";
  };

  const moved = (kg: number | null): kg is number => kg != null && Math.abs(kg) >= 0.05;
  const trendBadge = (kg: number | null) => {
    if (!moved(kg)) return null;
    const g = good(kg);
    const text = `${signOf(kg)}${fmt1(toDisplayWeight(Math.abs(kg), units))}`;
    return g == null ? <StatusPill tone="neutral" className="tabular">{text}</StatusPill> : <Trend value={text} up={kg > 0} good={g} />;
  };

  const hero = latest ? (
    <div className="mx-[var(--gutter)] glass-strong rounded-lg p-4 rise" style={riseStyle(0)}>
      <CardHeader icon="scale" iconColor="var(--accent)" title="Latest" sub={`${fmtRelativeDate(latest.date)}${latest.bodyFatPct != null ? ` · ${fmt1(latest.bodyFatPct)}% body fat` : ""}`} trailing={trendBadge(data?.change7d ?? null)} />
      <div className="mt-3 flex items-end justify-between gap-3">
        <BigNumber value={<span data-testid="weight-hero">{fmt1(toDisplayWeight(latest.weightKg, units))}</span>} unit={unit} size={48} />
        {profile?.targetWeightKg != null && <span className="text-[12px] text-tertiary tabular pb-1.5">Target {fmtWeight(profile.targetWeightKg, units)}</span>}
      </div>
    </div>
  ) : (
    <div className="mx-[var(--gutter)] glass rounded-lg">
      <Empty className="pt-6 pb-4" action={<Button variant="plain" onClick={() => setLogOpen(true)}>Log Weight</Button>}>No weight logged yet.</Empty>
    </div>
  );

  const chart = (
    <section className="mt-3">
      <div className="mx-[var(--gutter)] glass rounded-lg p-4 rise" style={riseStyle(1)}>
        <CardHeader icon="bars" title="Trend" sub="Smoothed, with each weigh-in as a dot" />
        <Segmented options={PERIODS} value={period} onChange={(p) => { setPeriod(p); setSelected(null); }} size="sm" className={cn("mt-3", isDesktop ? "max-w-[280px]" : undefined)} />
        <div className="flex items-baseline gap-1.5 mt-4 min-h-[34px]">
          {sel ? (
            <>
              <BigNumber value={fmt1(sel.raw ?? sel.value)} unit={`${unit} · ${fmtRelativeDate(sel.key)}`} size={28} />
              <span className="ml-auto text-[12px] text-tertiary tabular">trend {fmt1(sel.value)}</span>
            </>
          ) : periodChange == null ? (
            points.length > 0 && <span className="text-[15px] text-secondary">Two weigh-ins show a trend.</span>
          ) : (
            <>
              <span className={cn("num text-[28px] leading-[30px]", deltaClass(periodChange))}>{`${signOf(periodChange)}${fmt1(Math.abs(periodChange))}`}</span>
              <span className="text-[13px] text-tertiary">{unit} over {days === 365 ? "a year" : `${days} days`}</span>
            </>
          )}
        </div>
        {points.length === 0 ? (
          <p className="text-[15px] text-secondary text-center py-8">No weigh-ins in this period.</p>
        ) : (
          <LineChart points={points} target={profile?.targetWeightKg ? toDisplayWeight(profile.targetWeightKg, units) : null} format={(v) => fmt1(v)} selected={selected} onSelect={setSelected} className="mt-2" />
        )}
      </div>
    </section>
  );

  const cells: { title: string; kg: number | null; show: boolean }[] = [
    { title: "7 days", kg: data?.change7d ?? null, show: true },
    { title: "30 days", kg: data?.change30d ?? null, show: true },
    { title: "To target", kg: profile?.targetWeightKg != null && latest ? profile.targetWeightKg - latest.weightKg : null, show: profile?.targetWeightKg != null && latest != null },
  ];
  const changes = (
    <Section title="Change">
      <div className={cn("mx-[var(--gutter)] grid gap-2 rise", cells.filter((c) => c.show).length === 3 ? "grid-cols-3" : "grid-cols-2")} style={riseStyle(2)}>
        {cells.filter((c) => c.show).map((c) => (
          <div key={c.title} className="glass rounded-[16px] px-3 py-3">
            <div className="text-[12px] text-tertiary">{c.title}</div>
            <div className={cn("mt-1 flex items-center gap-1 text-[15px] tabular", c.title === "To target" ? "text-primary" : deltaClass(c.kg))}>
              {c.title !== "To target" && moved(c.kg) && <Icon name={c.kg > 0 ? "arrow-up" : "arrow-down"} size={13} strokeWidth={2} />}
              <span className="truncate">{deltaText(c.kg)}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );

  const logs = data?.logs.slice(0, 60) ?? [];
  const history = (
    <Section title="History" footer={logs.length ? "Tap a weigh-in to delete it." : undefined}>
      {logs.length ? (
        <Group>
          {logs.map((l, i) => {
            const prev = logs[i + 1];
            const d = prev ? l.weightKg - prev.weightKg : null;
            return (
              <Row
                key={l.id}
                title={fmtRelativeDate(l.date)}
                subtitle={l.bodyFatPct != null ? `${fmt1(l.bodyFatPct)}% body fat` : undefined}
                trailing={
                  <>
                    {moved(d) && <span className={cn("text-[12px]", deltaClass(d))}>{`${signOf(d)}${fmt1(toDisplayWeight(Math.abs(d), units))}`}</span>}
                    <span className="text-primary">{fmtWeight(l.weightKg, units)}</span>
                  </>
                }
                onPress={() => setConfirm(l)}
              />
            );
          })}
        </Group>
      ) : (
        <Group>
          <Row title={<span className="text-secondary">No weigh-ins</span>} />
        </Group>
      )}
    </Section>
  );

  return (
    <Screen
      title="Weight"
      back="/health"
      actions={
        <IconButton label="Log Weight" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={() => setLogOpen(true)} data-testid="open-log-weight">
          <Icon name="plus" size={20} strokeWidth={1.8} />
        </IconButton>
      }
    >
      {weight.isPending ? (
        <div className="flex flex-col gap-6 pt-2">
          <Skeleton rows={1} />
          <Skeleton rows={3} />
        </div>
      ) : weight.isError ? (
        <InlineError onRetry={() => void weight.refetch()}>Unable to load weight.</InlineError>
      ) : isDesktop ? (
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-6 max-w-[1100px]">
          <div>
            {hero}
            {chart}
          </div>
          <div className="[&>section:first-child]:mt-0">
            {changes}
            {history}
          </div>
        </div>
      ) : (
        <>
          {hero}
          {chart}
          {changes}
          {history}
        </>
      )}
      <WeightSheet open={logOpen} onClose={() => setLogOpen(false)} />
      <ActionSheet
        open={confirm != null}
        onClose={() => setConfirm(null)}
        title={confirm ? `${fmtWeight(confirm.weightKg, units)} on ${fmtRelativeDate(confirm.date)}` : undefined}
        actions={[{ label: "Delete Weigh-in", destructive: true, onPress: () => { if (confirm) del.mutate(confirm.id, { onSuccess: () => toast("Weigh-in deleted"), onError: () => toast("Unable to delete the weigh-in") }); } }]}
      />
    </Screen>
  );
}
