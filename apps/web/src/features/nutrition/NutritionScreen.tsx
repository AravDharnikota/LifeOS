import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { format } from "date-fns";
import type { MealType } from "@aravos/shared";
import { DATE_RE, addDaysString, parseDateString, todayString, weekStartString } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Footnote, Group, Row, Section, SectionHeader, ValueRow } from "@/ui/List";
import { ArcRing, BigNumber, CapsuleBars, CardHeader, Legend, StatusPill, ThinBar } from "@/ui/viz";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { cn } from "@/lib/cn";
import { imageUrl } from "@/lib/api";
import { fmtDate, fmtInt, fmtRelativeDate, fmtTime, plural } from "@/lib/format";
import { useIsDesktop } from "@/lib/hooks";
import { useAppSettings } from "@/data/queries";
import { useNutritionDay, useRange, type DayMealSummary, type NutritionDay, type RangeRow } from "./api";
import { MACROS, MEAL_TYPES, fmtG, fmtKcal, mealTypeLabel, saturatedFatMaxG, toDisplayWater, waterUnit } from "./model";
import { GoalCheck, IconTile, RangeBar, WellGroup, riseStyle } from "@/features/health/parts";
import { LogFoodSheet } from "./LogFoodSheet";
import { MealSheet } from "./MealSheet";

type View = "day" | "week";

/** Diary by meal, nutrient totals against targets, and a seven-day view. */
export default function NutritionScreen() {
  const params = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const isDesktop = useIsDesktop();
  const { weekStartsOn } = useAppSettings();
  const today = todayString();
  const date = params.date && DATE_RE.test(params.date) ? params.date : today;
  const [view, setView] = useState<View>("day");
  const [logOpen, setLogOpen] = useState(false);
  const [logType, setLogType] = useState<MealType | undefined>(undefined);
  const [mealId, setMealId] = useState<string | null>(null);
  const day = useNutritionDay(date);

  useEffect(() => {
    if (search.get("log") === "1") {
      setLogOpen(true);
      setLogType(undefined);
      search.delete("log");
      setSearch(search, { replace: true });
    }
  }, [search, setSearch]);

  const go = (d: string) => navigate(d === today ? "/health/nutrition" : `/health/nutrition/day/${d}`, { replace: true });
  const step = view === "week" ? 7 : 1;
  const weekStart = weekStartString(date, weekStartsOn);
  const thisWeekStart = weekStartString(today, weekStartsOn);
  const label =
    view === "day"
      ? fmtRelativeDate(date)
      : weekStart === thisWeekStart
        ? "This week"
        : weekStart === addDaysString(thisWeekStart, -7)
          ? "Last week"
          : `${fmtDate(weekStart)} to ${fmtDate(addDaysString(weekStart, 6))}`;
  const atToday = view === "day" ? date >= today : weekStart >= thisWeekStart;

  const openLog = (type?: MealType) => {
    setLogType(type);
    setLogOpen(true);
  };

  const header = (
    <div className={cn("flex flex-col gap-3", isDesktop && "max-w-[400px]")}>
      <div className="flex items-center justify-between gap-2">
        <IconButton label={view === "day" ? "Previous day" : "Previous week"} className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={() => go(addDaysString(date, -step))}>
          <Icon name="chevron-left" size={20} strokeWidth={1.8} />
        </IconButton>
        <button type="button" className="h-10 px-4 rounded-full text-[15px] text-primary tabular active:bg-pressed transition-colors" onClick={() => go(today)} aria-label={date === today ? label : `${label}. Go to today`}>
          {label}
        </button>
        <IconButton label={view === "day" ? "Next day" : "Next week"} disabled={atToday} className="glass !min-w-0 !min-h-0 w-10 h-10 disabled:opacity-40" onClick={() => go(addDaysString(date, step))}>
          <Icon name="chevron-right" size={20} strokeWidth={1.8} />
        </IconButton>
      </div>
      <Segmented options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }]} value={view} onChange={setView} />
    </div>
  );

  return (
    <Screen
      title="Nutrition"
      back="/health"
      subtitle={view === "day" && date !== today ? fmtDate(date) : undefined}
      header={header}
      actions={
        <IconButton label="Log Food" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={() => openLog()}>
          <Icon name="camera" size={19} strokeWidth={1.8} />
        </IconButton>
      }
    >
      {view === "day" ? (
        day.isPending ? (
          <div className="flex flex-col gap-6 pt-2">
            <Skeleton rows={2} />
            <Skeleton rows={3} />
          </div>
        ) : day.isError ? (
          <InlineError onRetry={() => void day.refetch()}>Unable to load the day.</InlineError>
        ) : (
          <DayView data={day.data} isDesktop={isDesktop} onAdd={openLog} onOpen={setMealId} />
        )
      ) : (
        <WeekView weekStart={weekStart} isDesktop={isDesktop} targets={day.data?.targets ?? null} onOpenDay={(d) => { setView("day"); go(d); }} />
      )}
      <LogFoodSheet open={logOpen} onClose={() => setLogOpen(false)} date={date} mealType={logType} initialMode={logType ? "search" : "photo"} />
      <MealSheet mealId={mealId} open={mealId != null} onClose={() => setMealId(null)} />
    </Screen>
  );
}

// ---------- day ----------
function DayView({ data, isDesktop, onAdd, onOpen }: { data: NutritionDay; isDesktop: boolean; onAdd: (t: MealType) => void; onOpen: (id: string) => void }) {
  const summary = <SummaryCard data={data} />;
  const diary = <Diary meals={data.meals} onAdd={onAdd} onOpen={onOpen} />;
  const nutrients = <NutrientCard data={data} />;
  if (isDesktop) {
    return (
      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-6 max-w-[1100px] pt-1">
        <div>
          {summary}
          {nutrients}
        </div>
        <div className="[&>section]:mt-0">{diary}</div>
      </div>
    );
  }
  return (
    <div className="pt-1">
      {summary}
      {diary}
      {nutrients}
    </div>
  );
}

/** Calorie hero: an open ring for the day, eaten against the target, then one small card per macro. */
function SummaryCard({ data }: { data: NutritionDay }) {
  const { totals, targets } = data;
  const over = totals.calories > targets.calories;
  const pct = targets.calories ? totals.calories / targets.calories : 0;
  return (
    <div className="mx-[var(--gutter)] glass-strong rounded-lg p-4 rise" style={riseStyle(0)} data-testid="day-summary">
      <div className="flex items-center gap-4">
        <ArcRing progress={pct} open size={116} stroke={9} color={pct > 0 ? "var(--energy)" : "transparent"} color2={pct > 0 ? "var(--carbs)" : "transparent"} label={`Calories, ${fmtInt(totals.calories)} of ${fmtInt(targets.calories)}`} className="shrink-0">
          <span className="num text-[26px] leading-none text-primary">{fmtInt(Math.round(pct * 100))}<span className="text-[13px] text-tertiary">%</span></span>
          <span className="text-[11px] text-tertiary mt-1">of target</span>
        </ArcRing>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-tertiary">Eaten</div>
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <BigNumber value={fmtInt(totals.calories)} size={34} />
            <span className="text-[13px] text-tertiary tabular">/ {fmtInt(targets.calories)} kcal</span>
          </div>
          <StatusPill tone={over ? "warning" : "neutral"} className="mt-2 tabular">{over ? `+${fmtInt(totals.calories - targets.calories)} over` : `${fmtInt(targets.calories - totals.calories)} left`}</StatusPill>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4">
        {MACROS.map((m) => {
          const p = targets[m.key] ? totals[m.key] / targets[m.key] : 0;
          const done = p >= 1;
          return (
            <div key={m.key} className="well rounded-[14px] p-2.5 transition-shadow duration-500" style={done ? { boxShadow: `inset 0 0 0 1px var(--glass-edge), 0 0 0 1px color-mix(in oklab, ${m.color} 35%, transparent)` } : undefined}>
              <div className="flex items-center justify-between gap-1">
                <Legend color={m.color} className="!text-[11px]">{m.label}</Legend>
                {done && <GoalCheck size={14} />}
              </div>
              <div className="mt-1.5 flex items-baseline gap-0.5">
                <span className="num text-[20px] leading-6 text-primary">{fmtInt(totals[m.key])}</span>
                <span className="text-[11px] text-tertiary tabular truncate">/ {fmtInt(targets[m.key])} g</span>
              </div>
              <ThinBar progress={p} color={m.color} height={4} className="mt-2" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MEAL_ICONS: Record<MealType, "sun" | "utensils" | "moon" | "apple"> = { breakfast: "sun", lunch: "utensils", dinner: "moon", snack: "apple" };

/** One glass card per meal slot; logged meals sit as quiet rows in a white well. */
function Diary({ meals, onAdd, onOpen }: { meals: DayMealSummary[]; onAdd: (t: MealType) => void; onOpen: (id: string) => void }) {
  const hour12 = useAppSettings().hour12;
  return (
    <section className="mt-7">
      <SectionHeader title="Meals" />
      <div className="flex flex-col gap-3 px-[var(--gutter)]">
        {MEAL_TYPES.map((t, i) => {
          const list = meals.filter((m) => m.mealType === t.value);
          const kcal = list.reduce((s, m) => s + m.calories, 0);
          return (
            <div key={t.value} className="glass rounded-lg p-3 rise" style={riseStyle(i + 1)} data-testid={`diary-${t.value}`}>
              <div className="flex items-center gap-2.5">
                <IconTile name={MEAL_ICONS[t.value]} />
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] leading-5 text-primary">{t.group}</div>
                  <div className="text-[12px] leading-4 text-tertiary tabular mt-0.5">{list.length ? `${fmtKcal(kcal)} · ${plural(list.length, "meal")}` : "Not logged"}</div>
                </div>
                <IconButton label={`Add ${t.label}`} className="well !min-w-0 !min-h-0 w-9 h-9 text-secondary" onClick={() => onAdd(t.value)}>
                  <Icon name="plus" size={18} strokeWidth={1.8} />
                </IconButton>
              </div>
              {list.length > 0 && (
                <WellGroup inset={false} className="mt-3">
                  {list.map((m) => (
                    <Row
                      key={m.id}
                      leading={m.photoPath ? <img src={imageUrl(m.photoPath)} alt="" className="w-10 h-10 rounded-[10px] object-cover bg-surface-2" /> : undefined}
                      title={m.name ?? mealTypeLabel(m.mealType)}
                      subtitle={`${plural(m.items, "item")} · ${fmtTime(m.loggedAt, hour12)}`}
                      trailing={fmtKcal(m.calories)}
                      chevron
                      onPress={() => onOpen(m.id)}
                      className="!pl-3 !pr-3 min-h-[56px]"
                      data-testid="meal-row"
                    />
                  ))}
                </WellGroup>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Fiber against its goal, sugar, sodium and saturated fat against their limits: range bars with a marker. */
function NutrientCard({ data }: { data: NutritionDay }) {
  const { totals, targets } = data;
  const satMax = saturatedFatMaxG(targets.calories);
  const rows: { title: string; value: number; mark: number; unit: string; kind: "goal" | "limit" }[] = [
    { title: "Fiber", value: totals.fiberG ?? 0, mark: targets.fiberG, unit: "g", kind: "goal" },
    { title: "Sugar", value: totals.sugarG ?? 0, mark: targets.sugarMaxG, unit: "g", kind: "limit" },
    { title: "Sodium", value: totals.sodiumMg ?? 0, mark: targets.sodiumMaxMg, unit: "mg", kind: "limit" },
    { title: "Saturated fat", value: totals.saturatedFatG ?? 0, mark: satMax, unit: "g", kind: "limit" },
  ];
  return (
    <section className="mt-7">
      <div className="mx-[var(--gutter)] glass rounded-lg p-4">
        <CardHeader icon="list" title="Nutrients" sub="Goal and limits" />
        <div className="flex flex-col gap-4 mt-4">
          {rows.map((r) => {
            const over = r.kind === "limit" && r.value > r.mark;
            const met = r.kind === "goal" && r.mark > 0 && r.value >= r.mark;
            return (
              <div key={r.title}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex-1 text-[14px] text-primary">{r.title}</span>
                  {over && <StatusPill tone="danger">Over</StatusPill>}
                  {met && <GoalCheck size={16} />}
                  <span className={cn("text-[13px] tabular", over ? "text-danger-text" : "text-secondary")}>{`${fmtInt(r.value)} / ${fmtInt(r.mark)} ${r.unit}`}</span>
                </div>
                <RangeBar value={r.value} mark={r.mark} kind={r.kind} color={r.kind === "goal" ? "var(--protein)" : "var(--text-tertiary)"} />
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          {[
            { title: "Cholesterol", value: `${fmtInt(totals.cholesterolMg ?? 0)} mg` },
            { title: "Potassium", value: `${fmtInt(totals.potassiumMg ?? 0)} mg` },
          ].map((c) => (
            <div key={c.title} className="well rounded-[14px] px-3 py-2.5">
              <div className="text-[12px] text-tertiary">{c.title}</div>
              <div className="text-[15px] text-primary tabular mt-0.5">{c.value}</div>
            </div>
          ))}
        </div>
      </div>
      <Footnote>Fiber is a goal. Sugar, sodium and saturated fat are limits. The tick marks each one.</Footnote>
    </section>
  );
}

// ---------- week ----------
function WeekView({ weekStart, isDesktop, targets, onOpenDay }: { weekStart: string; isDesktop: boolean; targets: NutritionDay["targets"] | null; onOpenDay: (d: string) => void }) {
  const units = useAppSettings().units;
  const weekEnd = addDaysString(weekStart, 6);
  const range = useRange(weekStart, weekEnd);
  const [selected, setSelected] = useState<number | null>(null);
  const rows: RangeRow[] = range.data ?? [];
  const logged = rows.filter((r) => r.meals > 0);
  const avg = (key: keyof RangeRow) => (logged.length ? logged.reduce((s, r) => s + (r[key] as number), 0) / logged.length : 0);
  const sel = selected != null ? rows[selected] : undefined;
  const labels = useMemo(() => rows.map((r) => format(parseDateString(r.date), "EEEEE")), [rows]);
  const today = todayString();
  const todayIndex = rows.findIndex((r) => r.date === today);

  if (range.isPending) return <div className="pt-2"><Skeleton rows={4} /></div>;
  if (range.isError) return <InlineError onRetry={() => void range.refetch()}>Unable to load the week.</InlineError>;

  const max = Math.max(targets?.calories ?? 0, ...rows.map((r) => r.calories), 1);
  const chart = (
    <div className="mx-[var(--gutter)] glass-strong rounded-lg p-4 rise" style={riseStyle(0)}>
      <CardHeader icon="bars" iconColor="var(--energy)" title="Calories" sub={sel ? fmtRelativeDate(sel.date) : logged.length ? "Daily average" : "This week"} trailing={targets ? <span className="tabular">Target {fmtInt(targets.calories)}</span> : undefined} />
      <div className="mt-3 min-h-[38px]">
        <BigNumber value={fmtInt(sel ? sel.calories : avg("calories"))} unit={sel ? "kcal" : logged.length ? "kcal a day" : "kcal"} size={34} />
      </div>
      {logged.length === 0 ? (
        <Empty className="pt-6 pb-2" action={<Button variant="plain" onClick={() => onOpenDay(todayString())}>Open Today</Button>}>No meals logged this week.</Empty>
      ) : (
        <div className="relative mt-4">
          <CapsuleBars values={rows.map((r) => r.calories)} labels={labels} max={max} height={150} color="linear-gradient(0deg, var(--energy), color-mix(in oklab, var(--energy) 55%, var(--carbs)))" activeIndex={selected ?? undefined} showPct />
          <div className="absolute inset-x-0 top-0 h-[150px] flex justify-between gap-2">
            {rows.map((r, i) => (
              <button
                key={r.date}
                type="button"
                className={cn("flex-1 h-full rounded-full", i === todayIndex && selected == null && "ring-1 ring-separator-strong")}
                aria-label={`${format(parseDateString(r.date), "EEEE")}, ${fmtInt(r.calories)} kcal`}
                aria-pressed={selected === i}
                onClick={() => setSelected((s) => (s === i ? null : i))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
  const averages = (
    <Section title={sel ? fmtRelativeDate(sel.date) : "Averages"} footer={sel ? "Tap the day again to see the averages." : logged.length ? `Over ${plural(logged.length, "logged day")}.` : undefined}>
      <Group>
        <ValueRow title="Calories" leading={<Dot color={"var(--energy)"} />} value={`${fmtInt(sel ? sel.calories : avg("calories"))} kcal`} />
        {MACROS.map((m) => (
          <ValueRow key={m.key} leading={<Dot color={m.color} />} title={m.label} value={fmtG(sel ? sel[m.key] : avg(m.key))} />
        ))}
        <ValueRow title="Water" leading={<Dot color={"var(--water)"} />} value={`${fmtInt(toDisplayWater(sel ? sel.waterMl : avg("waterMl"), units))} ${waterUnit(units)}`} />
        <ValueRow title="Meals" leading={<Dot color={"var(--text-quaternary)"} />} value={fmtInt(sel ? sel.meals : logged.reduce((s, r) => s + r.meals, 0))} />
      </Group>
    </Section>
  );
  if (isDesktop) {
    return (
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-6 max-w-[1100px] pt-1">
        <div>{chart}</div>
        <div className="[&>section]:mt-0">{averages}</div>
      </div>
    );
  }
  return (
    <div className="pt-1">
      {chart}
      {averages}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="w-2 h-2 rounded-full" style={{ background: color }} />;
}
