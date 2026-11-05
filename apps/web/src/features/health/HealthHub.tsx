import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { Workout, WorkoutStats } from "@aravos/shared";
import { todayString } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row, Section } from "@/ui/List";
import { CardHeader, Gauge, Legend, Sparkline, ThinBar, Trend } from "@/ui/viz";
import { InlineError } from "@/ui/Empty";
import { Spinner } from "@/ui/Spinner";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { fmt1, fmtDateLong, fmtInt, fmtRelativeDate, plural, toDisplayWeight } from "@/lib/format";
import { impact, notify } from "@/lib/haptics";
import { useIsDesktop, useLongPress } from "@/lib/hooks";
import { useAppSettings, useSettings } from "@/data/queries";
import { useAddWater, useNutritionDay, useWeight } from "@/features/nutrition/api";
import { MACROS, WATER_TAP_ML, celebrateOnce, mealTypeForNow, mealTypeLabel, signOf, toDisplayWater, waterUnit } from "@/features/nutrition/model";
import { LogFoodSheet } from "@/features/nutrition/LogFoodSheet";
import { WaterSheet } from "@/features/nutrition/WaterSheet";
import { useBodyPhotos } from "@/features/body/api";
import { WeightSheet } from "./WeightSheet";
import { Banner, GoalCheck, IconTile, ValueChip, riseStyle } from "./parts";

const useWorkoutStats = () => useQuery({ queryKey: ["workouts", "stats"], queryFn: () => api.get<WorkoutStats>("/api/workouts/stats"), staleTime: 30_000 });
const useActiveWorkout = () => useQuery({ queryKey: ["workouts", "active"], queryFn: () => api.get<Workout | null>("/api/workouts/active"), staleTime: 5_000 });

/** Health hub: the calorie gauge with macros as the hero, a log banner, water and weight cards, then the areas. */
export default function HealthHub() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const isDesktop = useIsDesktop();
  const { units } = useAppSettings();
  const profile = useSettings().data?.healthProfile;
  const today = todayString();
  const day = useNutritionDay(today);
  const weight = useWeight(60);
  const stats = useWorkoutStats();
  const active = useActiveWorkout();
  const photos = useBodyPhotos();
  const [logOpen, setLogOpen] = useState(false);
  const [waterOpen, setWaterOpen] = useState(false);
  const [weightOpen, setWeightOpen] = useState(false);

  useEffect(() => {
    const w = search.get("weight") === "1";
    const l = search.get("log") === "1";
    if (!w && !l) return;
    if (w) setWeightOpen(true);
    if (l) setLogOpen(true);
    search.delete("weight");
    search.delete("log");
    setSearch(search, { replace: true });
  }, [search, setSearch]);

  const targets = day.data?.targets ?? profile?.targets ?? null;
  const mealsCount = day.data?.meals.length ?? 0;
  const latestPhoto = photos.data?.[0] ?? null;
  const workoutsSub = stats.data
    ? `${fmtInt(stats.data.thisWeek)} of ${fmtInt(stats.data.weeklyTarget)} this week${active.data ? ` · ${active.data.name} in progress` : ""}`
    : stats.isError
      ? "Unable to load"
      : "";
  const goalsSub = targets ? `${fmtInt(targets.calories)} kcal · ${fmtInt(targets.proteinG)} g protein · ${fmtInt(toDisplayWater(targets.waterMl, units))} ${waterUnit(units)} water` : "";
  const next = mealTypeLabel(mealTypeForNow());

  const hero = day.isPending ? (
    <div className="mx-[var(--gutter)] glass-strong rounded-lg p-4 flex items-center gap-4" aria-hidden="true">
      <div className="w-[148px] h-[122px] rounded-t-full shimmer shrink-0" />
      <div className="flex-1 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-3 rounded-full shimmer" style={{ width: `${80 - i * 12}%` }} />
        ))}
      </div>
    </div>
  ) : day.isError ? (
    <InlineError onRetry={() => void day.refetch()}>Unable to load today.</InlineError>
  ) : (
    <CaloriesHero totals={day.data.totals} targets={day.data.targets} />
  );

  const banner = (
    <Banner
      className="mx-[var(--gutter)] mt-3 rise"
      style={riseStyle(1)}
      title={`Log ${next}`}
      text={mealsCount ? `${plural(mealsCount, "meal")} today. A photo is enough, the macros fill in.` : "Nothing logged yet. A photo is enough, the macros fill in."}
      action="Log Meal"
      onAction={() => setLogOpen(true)}
    />
  );

  const trend = useMemo(() => (weight.data?.trend ?? []).slice(-21).map((p) => toDisplayWeight(p.emaKg, units)), [weight.data, units]);
  const tiles = (
    <div className="px-[var(--gutter)] mt-3 grid grid-cols-2 gap-3">
      <WaterTile ml={day.data?.water.ml ?? 0} target={day.data?.water.target ?? targets?.waterMl ?? 0} loading={day.isPending} onLongPress={() => setWaterOpen(true)} />
      <WeightTile latestKg={weight.data?.latest?.weightKg ?? day.data?.weight?.weightKg ?? null} latestDate={weight.data?.latest?.date ?? day.data?.weight?.date ?? null} change7d={weight.data?.change7d ?? null} trend={trend} goal={profile?.goal ?? "maintain"} loading={weight.isPending && day.isPending} onPress={() => navigate("/health/weight")} onLog={() => setWeightOpen(true)} />
    </div>
  );

  const areas = (
    <Section className={isDesktop ? "mt-0" : "mt-7"} title="Areas">
      <Group className="rise" style={riseStyle(4)}>
        <Row leading={<IconTile name="utensils" />} title="Nutrition" subtitle={day.data ? (mealsCount ? `${plural(mealsCount, "meal")} logged` : "No meals logged") : ""} chevron onPress={() => navigate("/health/nutrition")} />
        <Row leading={<IconTile name="dumbbell" />} title="Workouts" subtitle={workoutsSub} chevron onPress={() => navigate("/health/workouts")} />
        <Row leading={<IconTile name="image" />} title="Progress Photos" subtitle={photos.data ? (latestPhoto ? `Last photo ${fmtRelativeDate(latestPhoto.date)}` : "No photos yet") : ""} chevron onPress={() => navigate("/health/body")} />
        <Row leading={<IconTile name="target" />} title="Health Goals" subtitle={goalsSub} chevron onPress={() => navigate("/settings")} />
      </Group>
    </Section>
  );

  return (
    <Screen
      title="Health"
      subtitle={fmtDateLong(today)}
      actions={
        <IconButton label="Log Food" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={() => setLogOpen(true)} data-testid="log-food">
          <Icon name="camera" size={19} strokeWidth={1.8} />
        </IconButton>
      }
    >
      {isDesktop ? (
        <div className="grid grid-cols-[minmax(0,6fr)_minmax(0,5fr)] gap-6 max-w-[1100px] pt-1">
          <div>
            {hero}
            {banner}
            {tiles}
          </div>
          <div>{areas}</div>
        </div>
      ) : (
        <>
          {hero}
          {banner}
          {tiles}
          {areas}
        </>
      )}
      <LogFoodSheet open={logOpen} onClose={() => setLogOpen(false)} />
      <WaterSheet open={waterOpen} onClose={() => setWaterOpen(false)} />
      <WeightSheet open={weightOpen} onClose={() => setWeightOpen(false)} />
    </Screen>
  );
}

type Totals = { calories: number; proteinG: number; carbsG: number; fatG: number };

/** Calorie gauge (orange to green as the day fills) with the macro legend beside it, like Lifestats' Overview. */
function CaloriesHero({ totals, targets }: { totals: Totals; targets: Totals }) {
  const remaining = targets.calories - totals.calories;
  const over = remaining < 0;
  const text = over ? `+${fmtInt(-remaining)}` : fmtInt(remaining);
  return (
    <div className="mx-[var(--gutter)] glass-strong rounded-lg p-4 rise" style={riseStyle(0)} data-testid="calories-hero">
      <CardHeader icon="flame" iconColor="var(--energy)" title="Calories" sub="Today" trailing={<span className="tabular">{fmtInt(totals.calories)} of {fmtInt(targets.calories)} kcal</span>} />
      <div className="flex items-center gap-4 mt-3">
        <Gauge value={targets.calories ? totals.calories / targets.calories : 0} size={148} stroke={12} colors={["var(--energy)", "var(--carbs)", "var(--protein)"]} label={`Calories, ${fmtInt(totals.calories)} of ${fmtInt(targets.calories)}`} className="shrink-0 -mb-2">
          <span className={cn("num leading-none", text.length > 5 ? "text-[26px]" : "text-[34px]", over ? "text-energy-text" : "text-primary")}>{text}</span>
          <span className="text-[12px] text-tertiary mt-1">{over ? "over" : "left"}</span>
        </Gauge>
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {MACROS.map((m) => {
            const p = targets[m.key] ? totals[m.key] / targets[m.key] : 0;
            return (
              <div key={m.key}>
                <div className="flex items-center gap-2">
                  <Legend color={m.color} className="flex-1 min-w-0">{m.label}</Legend>
                  {p >= 1 && <GoalCheck size={14} />}
                  <span className="text-[13px] tabular text-primary">
                    {fmtInt(totals[m.key])} / {fmtInt(targets[m.key])} g
                  </span>
                </div>
                <ThinBar progress={p} color={m.color} height={4} className="mt-2" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const tileClass = "glass rounded-lg p-3.5 min-h-[148px] flex flex-col text-left pressable-spring cursor-pointer rise";

function WaterTile({ ml, target, loading, onLongPress }: { ml: number; target: number; loading: boolean; onLongPress: () => void }) {
  const { units } = useAppSettings();
  const add = useAddWater();
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(false);
  const unit = waterUnit(units);
  const shown = ml + pending;
  const left = Math.max(0, target - shown);
  const reached = target > 0 && shown >= target;
  useEffect(() => setPending(0), [ml]);
  const lp = useLongPress(() => {
    void impact("medium");
    onLongPress();
  });
  const tap = async () => {
    if (lp.fired.current) return;
    setFailed(false);
    setPending((p) => p + WATER_TAP_ML);
    try {
      await add.mutateAsync({ ml: WATER_TAP_ML, date: todayString() });
      const hit = target > 0 && shown < target && shown + WATER_TAP_ML >= target && celebrateOnce("water");
      void (hit ? notify("success") : impact("light"));
    } catch {
      setPending((p) => p - WATER_TAP_ML);
      setFailed(true);
      void notify("error");
    }
  };
  // Eight glasses: each cell fills as the day's water goes in.
  const cells = 8;
  const filled = target > 0 ? Math.min(cells, Math.floor((shown / target) * cells)) : 0;
  return (
    <button
      type="button"
      className={tileClass}
      style={{ ...riseStyle(2), ...(reached ? { boxShadow: "0 0 0 1px var(--water-soft), 0 10px 30px -14px var(--water)" } : undefined) }}
      aria-label={`Water, ${fmtInt(toDisplayWater(shown, units))} ${unit}. Tap to add ${fmtInt(toDisplayWater(WATER_TAP_ML, units))} ${unit}, hold for more`}
      onClick={() => void tap()}
      onContextMenu={(e) => e.preventDefault()}
      {...lp}
      data-testid="water-tile"
    >
      <div className="flex items-start gap-2 w-full">
        <IconTile name="drop" color="var(--water)" size={28} />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] leading-[18px] text-primary">Water</div>
          <div className="text-[11px] leading-[14px] text-tertiary truncate">Tap +{fmtInt(toDisplayWater(WATER_TAP_ML, units))} {unit}</div>
        </div>
        {reached && <GoalCheck size={18} />}
      </div>
      <div className="flex items-end gap-1 h-7 mt-3" aria-hidden="true">
        {Array.from({ length: cells }).map((_, i) => (
          <span key={i} className="flex-1 rounded-full transition-[background-color,height] duration-500" style={{ height: i < filled ? "100%" : "55%", background: i < filled ? "var(--water)" : "var(--bg-pressed)", transitionTimingFunction: "var(--ease-out)", transitionDelay: `${i * 30}ms` }} />
        ))}
      </div>
      <div className="mt-auto pt-3 flex items-end justify-between gap-2">
        {loading ? (
          <span className="h-8 w-20 rounded-[12px] shimmer" aria-hidden="true" />
        ) : (
          <ValueChip>
            <span className={cn("num text-[22px] leading-[24px] text-primary", add.isPending && "opacity-60")} data-testid="water-value">{fmtInt(toDisplayWater(shown, units))}</span>
            <span className="text-[11px] text-tertiary">{unit}</span>
          </ValueChip>
        )}
        {add.isPending && <Spinner size={12} className="text-tertiary mb-2" />}
      </div>
      <span className={cn("text-[12px] mt-2 tabular truncate", failed ? "text-danger-text" : "text-tertiary")}>{failed ? "Unable to log. Tap to retry" : target > 0 ? (left > 0 ? `${fmtInt(toDisplayWater(left, units))} ${unit} left` : "Target reached") : "No target"}</span>
    </button>
  );
}

function WeightTile({ latestKg, latestDate, change7d, trend, goal, loading, onPress, onLog }: { latestKg: number | null; latestDate: string | null; change7d: number | null; trend: number[]; goal: "lose" | "maintain" | "gain"; loading: boolean; onPress: () => void; onLog: () => void }) {
  const { units } = useAppSettings();
  const unit = units === "imperial" ? "lb" : "kg";
  const moved = change7d != null && Math.abs(change7d) >= 0.05;
  const good = !moved ? null : goal === "lose" ? change7d < 0 : goal === "gain" ? change7d > 0 : null;
  return (
    <button type="button" className={tileClass} style={riseStyle(3)} onClick={latestKg == null && !loading ? onLog : onPress} aria-label={latestKg == null ? "Weight, log a weigh-in" : `Weight, ${fmt1(toDisplayWeight(latestKg, units))} ${unit}`} data-testid="weight-tile">
      <div className="flex items-start gap-2 w-full">
        <IconTile name="scale" color="var(--accent)" size={28} />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] leading-[18px] text-primary">Weight</div>
          <div className="text-[11px] leading-[14px] text-tertiary truncate">{latestDate ? fmtRelativeDate(latestDate) : "No weigh-ins"}</div>
        </div>
      </div>
      <div className="h-7 mt-3">{trend.length > 1 ? <Sparkline values={trend} height={28} color="var(--accent)" /> : <div className="h-px mt-[14px] bg-separator" />}</div>
      <div className="mt-auto pt-3 flex items-end justify-between gap-2">
        {loading ? (
          <span className="h-8 w-20 rounded-[12px] shimmer" aria-hidden="true" />
        ) : latestKg == null ? (
          <span className="text-[14px] text-accent-text font-medium pb-1">Log Weight</span>
        ) : (
          <ValueChip>
            <span className="num text-[22px] leading-[24px] text-primary" data-testid="weight-tile-value">{fmt1(toDisplayWeight(latestKg, units))}</span>
            <span className="text-[11px] text-tertiary">{unit}</span>
          </ValueChip>
        )}
      </div>
      <span className="text-[12px] mt-2 tabular truncate text-tertiary flex items-center gap-1.5">
        {moved && good != null ? (
          <Trend value={`${signOf(change7d)}${fmt1(toDisplayWeight(Math.abs(change7d), units))}`} up={change7d > 0} good={good} />
        ) : moved ? (
          <span className="text-secondary">{`${signOf(change7d)}${fmt1(toDisplayWeight(Math.abs(change7d), units))} ${unit}`}</span>
        ) : null}
        {change7d != null ? (moved ? "in 7 days" : "Steady this week") : loading ? "" : latestKg == null ? "Tap to log" : "Not enough data"}
      </span>
    </button>
  );
}
