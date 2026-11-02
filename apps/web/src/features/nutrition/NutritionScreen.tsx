import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { format } from "date-fns";
import type { MealType } from "@aravos/shared";
import { DATE_RE, addDaysString, parseDateString, todayString, weekStartString } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Button, IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row, Section, ValueRow } from "@/ui/List";
import { Bar } from "@/ui/Ring";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { cn } from "@/lib/cn";
import { imageUrl } from "@/lib/api";
import { fmtDate, fmtInt, fmtRelativeDate, fmtTime, plural } from "@/lib/format";
import { useIsDesktop } from "@/lib/hooks";
import { useAppSettings } from "@/data/queries";
import { useNutritionDay, useRange, type DayMealSummary, type NutritionDay, type RangeRow } from "./api";
import { MACROS, MEAL_TYPES, fmtG, fmtKcal, mealTypeLabel, saturatedFatMaxG, toDisplayWater, waterUnit } from "./model";
import { BarChart } from "@/features/health/charts";
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
      <div className="flex items-center justify-between -mx-2">
        <IconButton label={view === "day" ? "Previous day" : "Previous week"} onClick={() => go(addDaysString(date, -step))}>
          <Icon name="chevron-left" size={24} />
        </IconButton>
        <button type="button" className="text-headline text-primary h-11 px-3 rounded-md active:bg-pressed" onClick={() => go(today)} aria-label={date === today ? label : `${label}. Go to today`}>
          {label}
        </button>
        <IconButton label={view === "day" ? "Next day" : "Next week"} disabled={atToday} className="disabled:opacity-40" onClick={() => go(addDaysString(date, step))}>
          <Icon name="chevron-right" size={24} />
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
        <IconButton label="Log Food" tinted onClick={() => openLog()}>
          <Icon name="camera" />
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
  const summary = <SummaryStrip data={data} />;
  const diary = <Diary meals={data.meals} onAdd={onAdd} onOpen={onOpen} />;
  const nutrients = <NutrientRows data={data} />;
  if (isDesktop) {
    return (
      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-6 max-w-[1100px] pt-1">
        <div>
          {summary}
          {nutrients}
        </div>
        <div>{diary}</div>
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

function SummaryStrip({ data }: { data: NutritionDay }) {
  const { totals, targets } = data;
  return (
    <div className="px-[var(--gutter)] pb-2" data-testid="day-summary">
      <div className="flex items-baseline gap-1.5">
        <span className="num text-title-1 text-primary">{fmtInt(totals.calories)}</span>
        <span className="text-subhead text-secondary tabular">/ {fmtInt(targets.calories)} kcal</span>
        <span className={cn("ml-auto text-footnote tabular", totals.calories > targets.calories ? "text-energy-text" : "text-secondary")}>{totals.calories > targets.calories ? `+${fmtInt(totals.calories - targets.calories)} over` : `${fmtInt(targets.calories - totals.calories)} left`}</span>
      </div>
      <Bar progress={targets.calories ? totals.calories / targets.calories : 0} color="var(--energy)" className="mt-2" />
      <div className="grid grid-cols-3 gap-4 mt-4">
        {MACROS.map((m) => (
          <div key={m.key}>
            <div className="text-footnote text-secondary">{m.label}</div>
            <div className="text-subhead tabular text-primary mb-1.5">
              {fmtInt(totals[m.key])} / {fmtInt(targets[m.key])} g
            </div>
            <Bar progress={targets[m.key] ? totals[m.key] / targets[m.key] : 0} color={m.color} height={5} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Diary({ meals, onAdd, onOpen }: { meals: DayMealSummary[]; onAdd: (t: MealType) => void; onOpen: (id: string) => void }) {
  const hour12 = useAppSettings().hour12;
  return (
    <>
      {MEAL_TYPES.map((t) => {
        const list = meals.filter((m) => m.mealType === t.value);
        const kcal = list.reduce((s, m) => s + m.calories, 0);
        return (
          <Section key={t.value} title={t.group} action={list.length ? <span className="text-footnote text-secondary tabular">{fmtKcal(kcal)}</span> : undefined}>
            <Group data-testid={`diary-${t.value}`}>
              {list.map((m) => (
                <Row
                  key={m.id}
                  leading={m.photoPath ? <img src={imageUrl(m.photoPath)} alt="" className="w-11 h-11 rounded-sm object-cover bg-surface-2" /> : undefined}
                  title={m.name ?? mealTypeLabel(m.mealType)}
                  subtitle={`${plural(m.items, "item")} · ${fmtTime(m.loggedAt, hour12)}`}
                  trailing={fmtKcal(m.calories)}
                  chevron
                  onPress={() => onOpen(m.id)}
                  data-testid="meal-row"
                />
              ))}
              <Row leading={<Icon name="plus" size={20} className="text-accent-text" />} title={<span className="text-accent-text">{list.length ? "Add" : `Add ${t.label}`}</span>} onPress={() => onAdd(t.value)} />
            </Group>
          </Section>
        );
      })}
    </>
  );
}

function NutrientRows({ data }: { data: NutritionDay }) {
  const { totals, targets } = data;
  const satMax = saturatedFatMaxG(targets.calories);
  const limit = (value: number | null | undefined, max: number, unit: string) => {
    const v = value ?? 0;
    const over = v > max;
    return <span className={cn(over && "text-danger-text")}>{`${fmtInt(v)} / ${fmtInt(max)} ${unit}`}</span>;
  };
  return (
    <Section title="Nutrients" footer="Fiber is a goal. Sugar, sodium and saturated fat are limits.">
      <Group>
        <ValueRow title="Fiber" value={`${fmtInt(totals.fiberG ?? 0)} / ${fmtInt(targets.fiberG)} g`} />
        <ValueRow title="Sugar" value={limit(totals.sugarG, targets.sugarMaxG, "g")} />
        <ValueRow title="Sodium" value={limit(totals.sodiumMg, targets.sodiumMaxMg, "mg")} />
        <ValueRow title="Saturated fat" value={limit(totals.saturatedFatG, satMax, "g")} />
        <ValueRow title="Cholesterol" value={`${fmtInt(totals.cholesterolMg ?? 0)} mg`} />
        <ValueRow title="Potassium" value={`${fmtInt(totals.potassiumMg ?? 0)} mg`} />
      </Group>
    </Section>
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
  const bars = useMemo(() => rows.map((r) => ({ key: r.date, label: format(parseDateString(r.date), "EEE"), value: r.calories })), [rows]);

  if (range.isPending) return <div className="pt-2"><Skeleton rows={4} /></div>;
  if (range.isError) return <InlineError onRetry={() => void range.refetch()}>Unable to load the week.</InlineError>;

  const chart = (
    <div className="px-[var(--gutter)]">
      <div className="flex items-baseline gap-1.5 min-h-[34px]">
        <span className="num text-title-1 text-primary">{fmtInt(sel ? sel.calories : avg("calories"))}</span>
        <span className="text-subhead text-secondary">{sel ? `kcal · ${fmtRelativeDate(sel.date)}` : logged.length ? "kcal a day" : "kcal"}</span>
        {!sel && targets && <span className="ml-auto text-footnote text-secondary tabular">Target {fmtInt(targets.calories)}</span>}
      </div>
      {logged.length === 0 ? (
        <Empty action={<Button variant="plain" onClick={() => onOpenDay(todayString())}>Open Today</Button>}>No meals logged this week.</Empty>
      ) : (
        <BarChart data={bars} color="var(--energy)" textColor="var(--energy-text)" target={targets?.calories ?? null} selected={selected} onSelect={setSelected} format={(v) => fmtInt(v)} className="mt-2" />
      )}
    </div>
  );
  const averages = (
    <Section title="Averages" footer={logged.length ? `Over ${plural(logged.length, "logged day")}.` : undefined}>
      <Group>
        <ValueRow title="Calories" value={`${fmtInt(sel ? sel.calories : avg("calories"))} kcal`} />
        {MACROS.map((m) => (
          <ValueRow key={m.key} title={m.label} value={fmtG(sel ? sel[m.key] : avg(m.key))} />
        ))}
        <ValueRow title="Water" value={`${fmtInt(toDisplayWater(sel ? sel.waterMl : avg("waterMl"), units))} ${waterUnit(units)}`} />
        <ValueRow title="Meals" value={fmtInt(sel ? sel.meals : logged.reduce((s, r) => s + r.meals, 0))} />
      </Group>
    </Section>
  );
  if (isDesktop) {
    return (
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-6 max-w-[1100px] pt-1">
        <div>{chart}</div>
        <div>{averages}</div>
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
