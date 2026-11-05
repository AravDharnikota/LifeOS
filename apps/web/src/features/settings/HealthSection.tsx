import { useEffect, useState } from "react";
import type { HealthProfile } from "@aravos/shared";
import { Section, ValueRow, Row } from "@/ui/List";
import { FieldRow } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import { Sheet } from "@/ui/Sheet";
import { Stepper } from "@/ui/Stepper";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Skeleton, InlineError } from "@/ui/Empty";
import { toast } from "@/ui/Toast";
import { BigNumber, Legend, SegmentBar } from "@/ui/viz";
import { notify } from "@/lib/haptics";
import { fmt1, fmtDate, fmtInt, fmtMl, fmtWeight, fromDisplayWeight, toDisplayWeight } from "@/lib/format";
import { fetchSuggestedTargets, useApplySuggestedTargets, useUpdateHealth, type SuggestedTargets } from "./api";
import { InlineInput, NumberSheet, OptionSheet, SheetDone } from "./sheets";
import { IconGroup, IconLabel, RowDot, RowIcon } from "./parts";

type Units = "metric" | "imperial";
type Targets = HealthProfile["targets"];
type TargetKey = Exclude<keyof Targets, "stepsPerDay">;

const SEX: { value: "male" | "female" | "unset"; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "unset", label: "Not set" },
];
const ACTIVITY: { value: HealthProfile["activityLevel"]; label: string; hint: string }[] = [
  { value: "sedentary", label: "Sedentary", hint: "Desk work, little exercise" },
  { value: "light", label: "Light", hint: "1 to 3 workouts a week" },
  { value: "moderate", label: "Moderate", hint: "3 to 5 workouts a week" },
  { value: "active", label: "Active", hint: "6 to 7 workouts a week" },
  { value: "very_active", label: "Very active", hint: "Hard training or a physical job" },
];
const activityLabel = (v: HealthProfile["activityLevel"]) => ACTIVITY.find((a) => a.value === v)?.label ?? "Moderate";

const TARGETS: { key: TargetKey; label: string; unit: "kcal" | "g" | "mg" | "ml" | ""; step: number; min: number; max: number }[] = [
  { key: "calories", label: "Calories", unit: "kcal", step: 10, min: 800, max: 8000 },
  { key: "proteinG", label: "Protein", unit: "g", step: 5, min: 20, max: 500 },
  { key: "carbsG", label: "Carbs", unit: "g", step: 5, min: 0, max: 1000 },
  { key: "fatG", label: "Fat", unit: "g", step: 5, min: 10, max: 400 },
  { key: "fiberG", label: "Fiber", unit: "g", step: 1, min: 5, max: 100 },
  { key: "sugarMaxG", label: "Sugar max", unit: "g", step: 5, min: 0, max: 300 },
  { key: "sodiumMaxMg", label: "Sodium max", unit: "mg", step: 100, min: 500, max: 6000 },
  { key: "waterMl", label: "Water", unit: "ml", step: 50, min: 500, max: 8000 },
  { key: "workoutsPerWeek", label: "Workouts per week", unit: "", step: 1, min: 0, max: 14 },
];

const TARGET_COLOR: Record<TargetKey, string> = {
  calories: "var(--energy)",
  proteinG: "var(--protein)",
  carbsG: "var(--carbs)",
  fatG: "var(--fat)",
  fiberG: "var(--activity)",
  sugarMaxG: "var(--text-quaternary)",
  sodiumMaxMg: "var(--text-quaternary)",
  waterMl: "var(--water)",
  workoutsPerWeek: "var(--accent)",
};

function fmtHeight(cm: number | null, units: Units): string {
  if (cm == null) return "Not set";
  if (units === "metric") return `${fmtInt(cm)} cm`;
  const inches = cm / 2.54;
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches - ft * 12);
  return inch === 12 ? `${ft + 1} ft` : `${ft} ft ${inch} in`;
}
function fmtTarget(key: TargetKey, v: number, units: Units): string {
  const def = TARGETS.find((t) => t.key === key)!;
  if (key === "waterMl") return fmtMl(v, units);
  return def.unit ? `${fmtInt(v)} ${def.unit}` : fmtInt(v);
}

export function HealthSection({ profile, units }: { profile: HealthProfile; units: Units }) {
  const update = useUpdateHealth();
  const [sheet, setSheet] = useState<"sex" | "height" | "activity" | "pace" | "targetWeight" | TargetKey | "suggest" | null>(null);
  const close = () => setSheet(null);
  const imperial = units === "imperial";
  const weightUnit = imperial ? "lb" : "kg";
  const target = sheet && TARGETS.find((t) => t.key === sheet);

  return (
    <>
      <Section title="Health profile" footer="Used for calorie and protein suggestions.">
        <IconGroup>
          <ValueRow leading={<RowIcon name="user" />} title="Sex" value={profile.sex ? (profile.sex === "male" ? "Male" : "Female") : "Not set"} chevron onPress={() => setSheet("sex")} />
          <FieldRow label={<IconLabel icon="calendar">Birth date</IconLabel>}>
            <InlineInput type="date" value={profile.birthDate ?? ""} max={new Date().toISOString().slice(0, 10)} onChange={(e) => update.mutate({ birthDate: e.target.value || null })} aria-label="Birth date" />
          </FieldRow>
          <ValueRow leading={<RowIcon name="arrow-up" />} title="Height" value={fmtHeight(profile.heightCm, units)} chevron onPress={() => setSheet("height")} />
          <ValueRow leading={<RowIcon name="bolt" />} title="Activity level" value={activityLabel(profile.activityLevel)} chevron onPress={() => setSheet("activity")} />
          <FieldRow label={<IconLabel icon="target">Goal</IconLabel>}>
            <Segmented options={[{ value: "lose", label: "Lose" }, { value: "maintain", label: "Maintain" }, { value: "gain", label: "Gain" }]} value={profile.goal} onChange={(v) => update.mutate({ goal: v })} size="sm" className="w-full max-w-[240px]" />
          </FieldRow>
          {profile.goal !== "maintain" && <ValueRow leading={<RowIcon name="arrow-right" />} title="Pace" value={`${fmtWeight(profile.paceKgPerWeek, units)} per week`} chevron onPress={() => setSheet("pace")} />}
          <ValueRow leading={<RowIcon name="scale" />} title="Target weight" value={profile.targetWeightKg != null ? fmtWeight(profile.targetWeightKg, units) : "Not set"} chevron onPress={() => setSheet("targetWeight")} />
        </IconGroup>
      </Section>

      <div id="targets" className="mt-8">
        <Section title="Targets">
          <IconGroup>
            <MacroSplit targets={profile.targets} />
            {TARGETS.map((t) => (
              <ValueRow key={t.key} leading={<RowDot color={TARGET_COLOR[t.key]} />} title={t.label} value={fmtTarget(t.key, profile.targets[t.key], units)} chevron onPress={() => setSheet(t.key)} data-testid={`target-${t.key}`} />
            ))}
          </IconGroup>
          <div className="px-[var(--gutter)] pt-3">
            <Button variant="secondary" size="sm" leading={<Icon name="sparkle" size={15} strokeWidth={1.8} />} onClick={() => setSheet("suggest")} data-testid="suggest-targets">
              Suggest Targets
            </Button>
          </div>
        </Section>
      </div>

      <OptionSheet open={sheet === "sex"} onClose={close} title="Sex" value={profile.sex ?? "unset"} options={SEX} onSelect={(v) => update.mutate({ sex: v === "unset" ? null : v })} />
      <OptionSheet open={sheet === "activity"} onClose={close} title="Activity Level" value={profile.activityLevel} options={ACTIVITY} onSelect={(v) => update.mutate({ activityLevel: v })} />
      <HeightSheet open={sheet === "height"} onClose={close} cm={profile.heightCm} units={units} onSave={(cm) => update.mutate({ heightCm: cm })} />
      <NumberSheet
        open={sheet === "pace"}
        onClose={close}
        title="Pace"
        value={imperial ? Math.round((profile.paceKgPerWeek / 0.45359237) * 4) / 4 : profile.paceKgPerWeek}
        step={imperial ? 0.25 : 0.1}
        min={0}
        max={imperial ? 3.25 : 1.5}
        unit={`${weightUnit} per week`}
        onSave={(v) => update.mutate({ paceKgPerWeek: Math.min(1.5, Math.round(fromDisplayWeight(v, units) * 100) / 100) })}
        hint={profile.goal === "lose" ? "Weight lost each week." : "Weight gained each week."}
      />
      <NumberSheet
        open={sheet === "targetWeight"}
        onClose={close}
        title="Target Weight"
        value={profile.targetWeightKg != null ? toDisplayWeight(profile.targetWeightKg, units) : imperial ? 160 : 72}
        step={imperial ? 1 : 0.5}
        min={imperial ? 60 : 30}
        max={imperial ? 700 : 300}
        unit={weightUnit}
        format={(v) => fmt1(v)}
        onSave={(v) => update.mutate({ targetWeightKg: Math.round(fromDisplayWeight(v, units) * 10) / 10 })}
      />
      {target && (
        <NumberSheet
          open
          onClose={close}
          title={target.label}
          value={target.key === "waterMl" && imperial ? Math.round(profile.targets.waterMl / 29.5735) : profile.targets[target.key]}
          step={target.key === "waterMl" && imperial ? 4 : target.step}
          min={target.key === "waterMl" && imperial ? 16 : target.min}
          max={target.key === "waterMl" && imperial ? 280 : target.max}
          unit={target.key === "waterMl" ? (imperial ? "oz" : "ml") : target.unit || undefined}
          onSave={(v) => update.mutate({ targets: { [target.key]: target.key === "waterMl" && imperial ? Math.round(v * 29.5735) : v } })}
        />
      )}
      <SuggestSheet open={sheet === "suggest"} onClose={close} units={units} />
    </>
  );
}

/** The calorie target as a thin number, split into protein, carbs and fat by energy (4, 4 and 9 kcal per gram). */
function MacroSplit({ targets }: { targets: Targets }) {
  const p = targets.proteinG * 4;
  const c = targets.carbsG * 4;
  const f = targets.fatG * 9;
  if (p + c + f <= 0) return null;
  return (
    <div className="px-[var(--gutter)] pt-4 pb-4 hairline-b">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">Daily energy</span>
        <BigNumber value={fmtInt(targets.calories)} unit="kcal" size={26} />
      </div>
      <SegmentBar
        className="mt-3"
        height={10}
        segments={[
          { value: p, color: "var(--protein)", style: "solid" },
          { value: c, color: "var(--carbs)", style: "ticks" },
          { value: f, color: "var(--fat)", style: "solid" },
        ]}
      />
      <div className="flex gap-4 mt-2.5">
        <Legend color="var(--protein)">Protein</Legend>
        <Legend color="var(--carbs)">Carbs</Legend>
        <Legend color="var(--fat)">Fat</Legend>
      </div>
    </div>
  );
}

function HeightSheet({ open, onClose, cm, units, onSave }: { open: boolean; onClose: () => void; cm: number | null; units: Units; onSave: (cm: number) => void }) {
  const base = cm ?? 175;
  const [c, setC] = useState(base);
  const [ft, setFt] = useState(5);
  const [inch, setInch] = useState(9);
  useEffect(() => {
    if (!open) return;
    setC(Math.round(base));
    const inches = base / 2.54;
    setFt(Math.floor(inches / 12));
    setInch(Math.round(inches - Math.floor(inches / 12) * 12));
  }, [open, base]);
  const save = () => {
    onSave(units === "metric" ? c : Math.round((ft * 12 + inch) * 2.54 * 10) / 10);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Height" trailing={<SheetDone onClick={save} />}>
      <div className="pt-6 pb-4 flex flex-col gap-6">
        {units === "metric" ? (
          <Stepper value={c} onChange={setC} step={1} min={100} max={250} unit="cm" size="lg" label="Height" />
        ) : (
          <>
            <Stepper value={ft} onChange={setFt} step={1} min={3} max={8} unit="ft" size="lg" label="Feet" />
            <Stepper value={inch} onChange={setInch} step={1} min={0} max={11} unit="in" size="lg" label="Inches" />
          </>
        )}
      </div>
    </Sheet>
  );
}

const SUGGEST_ROWS: { key: keyof SuggestedTargets["suggestion"] & TargetKey; label: string }[] = [
  { key: "calories", label: "Calories" },
  { key: "proteinG", label: "Protein" },
  { key: "carbsG", label: "Carbs" },
  { key: "fatG", label: "Fat" },
  { key: "fiberG", label: "Fiber" },
  { key: "sugarMaxG", label: "Sugar max" },
  { key: "sodiumMaxMg", label: "Sodium max" },
  { key: "waterMl", label: "Water" },
];

/** Fetches the suggestion on open; Apply writes it to the profile. */
function SuggestSheet({ open, onClose, units }: { open: boolean; onClose: () => void; units: Units }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: SuggestedTargets }>({ status: "loading" });
  const apply = useApplySuggestedTargets();
  const load = () => {
    setState({ status: "loading" });
    fetchSuggestedTargets().then((data) => setState({ status: "ready", data })).catch((e: unknown) => setState({ status: "error", message: e instanceof Error ? e.message : "Unable to suggest targets" }));
  };
  useEffect(() => {
    if (open) load();
  }, [open]);
  const onApply = async () => {
    try {
      await apply.mutateAsync();
      toast("Targets updated.");
      onClose();
    } catch (e) {
      void notify("error");
      setState({ status: "error", message: e instanceof Error ? e.message : "Unable to apply targets" });
    }
  };
  const basis = state.status === "ready" ? state.data.inputs : null;
  const basisText = basis
    ? [basis.weightKg != null ? fmtWeight(basis.weightKg, units) : null, basis.heightCm != null ? fmtHeight(basis.heightCm, units) : null, basis.ageYears != null ? `${basis.ageYears} years` : null, `${activityLabel(basis.activityLevel).toLowerCase()} activity`, basis.goal === "maintain" ? "holding weight" : `${basis.goal === "lose" ? "losing" : "gaining"} ${fmtWeight(basis.requestedPaceKgPerWeek, units)} a week`].filter(Boolean).join(", ")
    : "";

  return (
    <Sheet open={open} onClose={onClose} title="Suggested Targets" detent="large">
      <div className="pt-2 pb-2 flex flex-col gap-4">
        {state.status === "loading" && <Skeleton rows={4} className="mx-0" />}
        {state.status === "error" && (
          <div className="py-6">
            <InlineError onRetry={load}>{state.message}</InlineError>
          </div>
        )}
        {state.status === "ready" && (
          <>
            <div className="rounded-lg overflow-hidden group-rows well">
              {SUGGEST_ROWS.map((r) => {
                const cur = state.data.current[r.key];
                const next = state.data.suggestion[r.key] as number;
                return (
                  <Row
                    key={r.key}
                    title={r.label}
                    className="!bg-transparent"
                    trailing={
                      <span className="tabular">
                        {cur !== next && <span className="text-tertiary mr-2">{fmtTarget(r.key, cur, units)}</span>}
                        <span className="text-primary">{fmtTarget(r.key, next, units)}</span>
                      </span>
                    }
                  />
                );
              })}
            </div>
            <p className="text-footnote text-secondary">
              Based on {basisText}.{basis?.weightKg == null ? " Log a weight for a closer estimate." : basis.weightDate ? ` Weight from ${fmtDate(basis.weightDate)}.` : ""}
              {state.data.suggestion.floorApplied ? ` Calories are held at the ${fmtInt(state.data.suggestion.calorieFloor)} kcal floor.` : ""}
            </p>
            <Button variant="primary" size="lg" full loading={apply.isPending} onClick={() => void onApply()} data-testid="apply-targets">
              Apply
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
