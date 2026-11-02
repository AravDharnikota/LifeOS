import { useMemo, useState } from "react";
import { format } from "date-fns";
import type { WeightLog } from "@aravos/shared";
import { addDaysString, parseDateString } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row, Section, ValueRow } from "@/ui/List";
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

  const hero = (
    <div className="px-[var(--gutter)] pt-1">
      {latest ? (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className="num text-display-44 text-primary" data-testid="weight-hero">{fmt1(toDisplayWeight(latest.weightKg, units))}</span>
            <span className="text-subhead text-secondary">{unit}</span>
          </div>
          <p className="text-footnote text-secondary mt-1">
            {fmtRelativeDate(latest.date)}
            {latest.bodyFatPct != null ? ` · ${fmt1(latest.bodyFatPct)}% body fat` : ""}
          </p>
        </>
      ) : (
        <Empty className="pt-4 pb-2" action={<Button variant="plain" onClick={() => setLogOpen(true)}>Log Weight</Button>}>No weight logged yet.</Empty>
      )}
    </div>
  );

  const chart = (
    <Section title="Trend">
      <div className="px-[var(--gutter)]">
        <Segmented options={PERIODS} value={period} onChange={(p) => { setPeriod(p); setSelected(null); }} className={isDesktop ? "max-w-[280px]" : undefined} />
        <div className="flex items-baseline gap-1.5 mt-4 min-h-[34px]">
          {sel ? (
            <>
              <span className="num text-title-1 text-primary">{fmt1(sel.raw ?? sel.value)}</span>
              <span className="text-subhead text-secondary">{unit} · {fmtRelativeDate(sel.key)}</span>
              <span className="ml-auto text-footnote text-secondary tabular">trend {fmt1(sel.value)}</span>
            </>
          ) : periodChange == null ? (
            <span className="text-callout text-secondary">Two weigh-ins show a trend.</span>
          ) : (
            <>
              <span className={cn("num text-title-1", deltaClass(periodChange))}>{`${signOf(periodChange)}${fmt1(Math.abs(periodChange))}`}</span>
              <span className="text-subhead text-secondary">{unit} over {days === 365 ? "a year" : `${days} days`}</span>
            </>
          )}
        </div>
        {points.length === 0 ? (
          <p className="text-callout text-secondary text-center py-8">No weigh-ins in this period.</p>
        ) : (
          <LineChart points={points} target={profile?.targetWeightKg ? toDisplayWeight(profile.targetWeightKg, units) : null} format={(v) => fmt1(v)} selected={selected} onSelect={setSelected} className="mt-2" />
        )}
      </div>
    </Section>
  );

  const changes = (
    <Section title="Change">
      <Group>
        <ValueRow title="7 days" value={<span className={cn("flex items-center gap-1", deltaClass(data?.change7d ?? null))}>{data?.change7d != null && Math.abs(data.change7d) >= 0.05 && <Icon name={data.change7d > 0 ? "arrow-up" : "arrow-down"} size={14} strokeWidth={2} />}{deltaText(data?.change7d ?? null)}</span>} />
        <ValueRow title="30 days" value={<span className={cn("flex items-center gap-1", deltaClass(data?.change30d ?? null))}>{data?.change30d != null && Math.abs(data.change30d) >= 0.05 && <Icon name={data.change30d > 0 ? "arrow-up" : "arrow-down"} size={14} strokeWidth={2} />}{deltaText(data?.change30d ?? null)}</span>} />
        {profile?.targetWeightKg != null && latest && <ValueRow title="To target" value={deltaText(profile.targetWeightKg - latest.weightKg)} />}
      </Group>
    </Section>
  );

  const history = (
    <Section title="History" footer={data?.logs.length ? "Tap a weigh-in to delete it." : undefined}>
      {data && data.logs.length ? (
        <Group>
          {data.logs.slice(0, 60).map((l) => (
            <Row key={l.id} title={fmtRelativeDate(l.date)} subtitle={l.bodyFatPct != null ? `${fmt1(l.bodyFatPct)}% body fat` : undefined} trailing={fmtWeight(l.weightKg, units)} onPress={() => setConfirm(l)} />
          ))}
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
        <IconButton label="Log Weight" tinted onClick={() => setLogOpen(true)} data-testid="open-log-weight">
          <Icon name="plus" />
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
          <div>
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
