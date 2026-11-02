import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { Workout, WorkoutStats } from "@aravos/shared";
import { todayString } from "@aravos/shared";
import { Screen } from "@/ui/Screen";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Group, Row, Section } from "@/ui/List";
import { Bar, Ring } from "@/ui/Ring";
import { InlineError, Skeleton } from "@/ui/Empty";
import { Spinner } from "@/ui/Spinner";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { fmt1, fmtDateLong, fmtInt, fmtRelativeDate, plural, toDisplayWeight } from "@/lib/format";
import { impact, notify } from "@/lib/haptics";
import { useIsDesktop, useLongPress } from "@/lib/hooks";
import { useAppSettings, useSettings } from "@/data/queries";
import { useAddWater, useNutritionDay, useWeight } from "@/features/nutrition/api";
import { MACROS, WATER_TAP_ML, celebrateOnce, signOf, toDisplayWater, waterUnit } from "@/features/nutrition/model";
import { LogFoodSheet } from "@/features/nutrition/LogFoodSheet";
import { WaterSheet } from "@/features/nutrition/WaterSheet";
import { useBodyPhotos } from "@/features/body/api";
import { WeightSheet } from "./WeightSheet";

const useWorkoutStats = () => useQuery({ queryKey: ["workouts", "stats"], queryFn: () => api.get<WorkoutStats>("/api/workouts/stats"), staleTime: 30_000 });
const useActiveWorkout = () => useQuery({ queryKey: ["workouts", "active"], queryFn: () => api.get<Workout | null>("/api/workouts/active"), staleTime: 5_000 });

/** Health hub: calories ring as the hero, water and weight tiles, then the areas. */
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

  const hero = day.isPending ? (
    <div className="px-[var(--gutter)] pt-2 flex items-center gap-5" aria-hidden="true">
      <div className="w-[160px] h-[160px] rounded-full border-[14px] border-surface-2 shrink-0" />
      <div className="flex-1 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-3 rounded-full bg-surface-2" style={{ width: `${70 - i * 12}%` }} />
        ))}
      </div>
    </div>
  ) : day.isError ? (
    <InlineError onRetry={() => void day.refetch()}>Unable to load today.</InlineError>
  ) : (
    <CaloriesHero totals={day.data.totals} targets={day.data.targets} />
  );

  const tiles = (
    <div className="px-[var(--gutter)] mt-6 grid grid-cols-2 gap-3">
      <WaterTile ml={day.data?.water.ml ?? 0} target={day.data?.water.target ?? targets?.waterMl ?? 0} loading={day.isPending} onLongPress={() => setWaterOpen(true)} />
      <WeightTile latestKg={weight.data?.latest?.weightKg ?? day.data?.weight?.weightKg ?? null} latestDate={weight.data?.latest?.date ?? day.data?.weight?.date ?? null} change7d={weight.data?.change7d ?? null} goal={profile?.goal ?? "maintain"} loading={weight.isPending && day.isPending} onPress={() => navigate("/health/weight")} onLog={() => setWeightOpen(true)} />
    </div>
  );

  const areas = (
    <Section className={isDesktop ? "mt-0" : "mt-8"}>
      <Group>
        <Row title="Nutrition" subtitle={day.data ? (mealsCount ? `${plural(mealsCount, "meal")} logged` : "No meals logged") : ""} chevron onPress={() => navigate("/health/nutrition")} />
        <Row title="Workouts" subtitle={workoutsSub} chevron onPress={() => navigate("/health/workouts")} />
        <Row title="Progress Photos" subtitle={photos.data ? (latestPhoto ? `Last photo ${fmtRelativeDate(latestPhoto.date)}` : "No photos yet") : ""} chevron onPress={() => navigate("/health/body")} />
        <Row title="Health Goals" subtitle={goalsSub} chevron onPress={() => navigate("/settings")} />
      </Group>
    </Section>
  );

  return (
    <Screen
      title="Health"
      subtitle={fmtDateLong(today)}
      actions={
        <IconButton label="Log Food" tinted onClick={() => setLogOpen(true)} data-testid="log-food">
          <Icon name="camera" />
        </IconButton>
      }
    >
      {isDesktop ? (
        <div className="grid grid-cols-[minmax(0,6fr)_minmax(0,5fr)] gap-8 max-w-[1100px] pt-2">
          <div>
            {hero}
            {tiles}
          </div>
          <div className="pt-2">{areas}</div>
        </div>
      ) : (
        <>
          {hero}
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

function CaloriesHero({ totals, targets }: { totals: { calories: number; proteinG: number; carbsG: number; fatG: number }; targets: { calories: number; proteinG: number; carbsG: number; fatG: number } }) {
  const remaining = targets.calories - totals.calories;
  const over = remaining < 0;
  const text = over ? `+${fmtInt(-remaining)}` : fmtInt(remaining);
  return (
    <div className="px-[var(--gutter)] pt-2 flex items-center gap-5" data-testid="calories-hero">
      <Ring progress={targets.calories ? totals.calories / targets.calories : 0} size={160} stroke={14} color="var(--energy)" label={`Calories, ${fmtInt(totals.calories)} of ${fmtInt(targets.calories)}`} className="shrink-0">
        <span className={cn("num", text.length > 5 ? "text-title-1" : "text-display-44", over ? "text-energy-text" : "text-primary")}>{text}</span>
        <span className="text-footnote text-secondary mt-1">{over ? "over" : "left"}</span>
      </Ring>
      <div className="flex-1 min-w-0 flex flex-col gap-3.5">
        {MACROS.map((m) => (
          <div key={m.key}>
            <div className="flex items-baseline justify-between gap-2 text-footnote mb-1.5">
              <span className="text-secondary">{m.label}</span>
              <span className="tabular text-primary">
                {fmtInt(totals[m.key])} / {fmtInt(targets[m.key])} g
              </span>
            </div>
            <Bar progress={targets[m.key] ? totals[m.key] / targets[m.key] : 0} color={m.color} />
          </div>
        ))}
        <p className="text-footnote text-tertiary tabular">
          {fmtInt(totals.calories)} of {fmtInt(targets.calories)} kcal
        </p>
      </div>
    </div>
  );
}

const tileClass = "text-left bg-surface rounded-lg p-4 min-h-[96px] flex flex-col pressable active:bg-pressed";

function WaterTile({ ml, target, loading, onLongPress }: { ml: number; target: number; loading: boolean; onLongPress: () => void }) {
  const { units } = useAppSettings();
  const add = useAddWater();
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(false);
  const unit = waterUnit(units);
  const shown = ml + pending;
  const left = Math.max(0, target - shown);
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
      const reached = target > 0 && shown < target && shown + WATER_TAP_ML >= target && celebrateOnce("water");
      void (reached ? notify("success") : impact("light"));
    } catch {
      setPending((p) => p - WATER_TAP_ML);
      setFailed(true);
      void notify("error");
    }
  };
  return (
    <button type="button" className={tileClass} aria-label={`Water, ${fmtInt(toDisplayWater(shown, units))} ${unit}. Tap to add ${fmtInt(toDisplayWater(WATER_TAP_ML, units))} ${unit}, hold for more`} onClick={() => void tap()} onContextMenu={(e) => e.preventDefault()} {...lp} data-testid="water-tile">
      <span className="text-subhead font-medium text-secondary">Water</span>
      {loading ? (
        <span className="mt-2 h-7 w-20 rounded-xs bg-surface-2" aria-hidden="true" />
      ) : (
        <span className="flex items-baseline gap-1 mt-1">
          <span className={cn("num text-title-1 text-primary", add.isPending && "opacity-60")} data-testid="water-value">{fmtInt(toDisplayWater(shown, units))}</span>
          <span className="text-subhead text-secondary">{unit}</span>
          {add.isPending && <Spinner size={12} className="text-tertiary ml-1" />}
        </span>
      )}
      <span className={cn("text-footnote mt-auto pt-1 tabular", failed ? "text-danger-text" : "text-secondary")}>{failed ? "Unable to log. Tap to retry" : target > 0 ? (left > 0 ? `${fmtInt(toDisplayWater(left, units))} ${unit} left` : "Target reached") : "No target"}</span>
    </button>
  );
}

function WeightTile({ latestKg, latestDate, change7d, goal, loading, onPress, onLog }: { latestKg: number | null; latestDate: string | null; change7d: number | null; goal: "lose" | "maintain" | "gain"; loading: boolean; onPress: () => void; onLog: () => void }) {
  const { units } = useAppSettings();
  const unit = units === "imperial" ? "lb" : "kg";
  const good = change7d == null || Math.abs(change7d) < 0.05 ? null : goal === "lose" ? change7d < 0 : goal === "gain" ? change7d > 0 : null;
  const tone = good === true ? "text-success-text" : good === false ? "text-danger-text" : "text-secondary";
  return (
    <button type="button" className={tileClass} onClick={latestKg == null && !loading ? onLog : onPress} aria-label={latestKg == null ? "Weight, log a weigh-in" : `Weight, ${fmt1(toDisplayWeight(latestKg, units))} ${unit}`} data-testid="weight-tile">
      <span className="text-subhead font-medium text-secondary">Weight</span>
      {loading ? (
        <span className="mt-2 h-7 w-20 rounded-xs bg-surface-2" aria-hidden="true" />
      ) : latestKg == null ? (
        <span className="text-subhead text-accent-text font-medium mt-1">Log Weight</span>
      ) : (
        <span className="flex items-baseline gap-1 mt-1">
          <span className="num text-title-1 text-primary" data-testid="weight-tile-value">{fmt1(toDisplayWeight(latestKg, units))}</span>
          <span className="text-subhead text-secondary">{unit}</span>
        </span>
      )}
      <span className={cn("text-footnote mt-auto pt-1 flex items-center gap-1 tabular", change7d != null ? tone : "text-secondary")}>
        {change7d != null && Math.abs(change7d) >= 0.05 && <Icon name={change7d > 0 ? "arrow-up" : "arrow-down"} size={13} strokeWidth={2} />}
        {change7d != null ? `${signOf(change7d)}${fmt1(toDisplayWeight(Math.abs(change7d), units))} ${unit} in 7 days` : latestDate ? fmtRelativeDate(latestDate) : loading ? "" : "No weigh-ins"}
      </span>
    </button>
  );
}
