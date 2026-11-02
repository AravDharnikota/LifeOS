import type { ExerciseCategory, PrType, SetType, Workout, WorkoutExercise, WorkoutSet, WorkoutSettings, WorkoutTemplate, AppSettings } from "@aravos/shared";
import { bestSet as pickBestSet, isEmptySet, kgToLb, lbToKg, round2 } from "@aravos/shared";
import { fmt1, fmtInt } from "@/lib/format";

export type Units = AppSettings["units"];
export const WORKOUTS = "/health/workouts";

// ---------- units ----------
export const weightUnit = (units: Units): string => (units === "imperial" ? "lb" : "kg");
export const distanceUnit = (units: Units): string => (units === "imperial" ? "mi" : "km");
export const KM_PER_MI = 1.609344;

export function displayWeight(kg: number, units: Units): number {
  return Math.round((units === "imperial" ? kgToLb(kg) : kg) * 10) / 10;
}
export function storeWeight(display: number, units: Units): number {
  return round2(units === "imperial" ? lbToKg(display) : display);
}
export function displayDistance(km: number, units: Units): number {
  return Math.round((units === "imperial" ? km / KM_PER_MI : km) * 1000) / 1000;
}
export function storeDistance(display: number, units: Units): number {
  return Math.round((units === "imperial" ? display * KM_PER_MI : display) * 1000) / 1000;
}
/** Weight increment for the keyboard accessory: 2.5 kg or 5 lb. */
export const weightStep = (units: Units): number => (units === "imperial" ? 5 : 2.5);

const trim = (n: number, digits = 2): string => Number(n.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
export const fmtNum = trim;
export const fmtWeightValue = (kg: number, units: Units): string => `${trim(displayWeight(kg, units))} ${weightUnit(units)}`;
export const fmtVolume = (kg: number, units: Units): string => `${fmtInt(units === "imperial" ? kgToLb(kg) : kg)} ${weightUnit(units)}`;
export const fmtDistanceValue = (km: number, units: Units): string => `${trim(displayDistance(km, units), 2)} ${distanceUnit(units)}`;

// ---------- time ----------
/** "45m", "1h 5m", "9s" (Strong shows seconds for very short workouts). */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
/** "2:30" or "1:02:05" for set durations and the timers. */
export function fmtSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}
/** Accepts "2:30", "1:02:05", "2.30" (decimal keypad) or "230" (m:ss without a separator). */
export function parseSeconds(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const parts = v.split(/[:.]/).map((p) => p.trim());
  if (parts.some((p) => p === "" || !/^\d+$/.test(p))) {
    if (/^\d+$/.test(v)) return parseSeconds(v.length > 2 ? `${v.slice(0, -2)}:${v.slice(-2)}` : v);
    return null;
  }
  if (parts.length === 1) {
    const digits = parts[0]!;
    if (digits.length > 2) return parseSeconds(`${digits.slice(0, -2)}:${digits.slice(-2)}`);
    return Number(digits);
  }
  const nums = parts.map(Number);
  if (nums.length === 2) return nums[0]! * 60 + nums[1]!;
  return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
}

// ---------- categories and columns ----------
export type ColumnKind = "weight" | "reps" | "distance" | "seconds";
export interface ColumnSpec {
  kind: ColumnKind;
  label: string;
}
const WEIGHTED: ReadonlySet<ExerciseCategory> = new Set(["barbell", "dumbbell", "machine", "cable"]);
export const isWeighted = (c: ExerciseCategory): boolean => WEIGHTED.has(c);

/** Which value columns a set row has, Strong's table per category (section 1.2 of the spec). */
export function columnsFor(category: ExerciseCategory, units: Units): ColumnSpec[] {
  const w = weightUnit(units);
  switch (category) {
    case "cardio":
      return [{ kind: "distance", label: distanceUnit(units) }, { kind: "seconds", label: "Time" }];
    case "duration":
      return [{ kind: "seconds", label: "Time" }];
    case "bodyweight":
    case "reps_only":
      return [{ kind: "reps", label: "Reps" }];
    case "weighted_bodyweight":
      return [{ kind: "weight", label: `+${w}` }, { kind: "reps", label: "Reps" }];
    case "assisted_bodyweight":
      return [{ kind: "weight", label: `-${w}` }, { kind: "reps", label: "Reps" }];
    default:
      return [{ kind: "weight", label: w }, { kind: "reps", label: "Reps" }];
  }
}
/** CSS grid template for a set row: Set | Previous | columns | check. */
export function gridTemplate(columns: ColumnSpec[]): string {
  const cols = columns.map((c) => (c.kind === "seconds" ? "76px" : c.kind === "distance" ? "72px" : c.kind === "weight" ? "70px" : "60px")).join(" ");
  return `40px minmax(0,1fr) ${cols} 44px`;
}

export interface SetValues {
  weight: number | null;
  reps: number | null;
  seconds: number | null;
  distance: number | null;
}

/** Display value for a field of a set (in display units), or "" when empty. */
export function fieldText(values: SetValues, kind: ColumnKind, units: Units): string {
  switch (kind) {
    case "weight":
      return values.weight == null ? "" : trim(displayWeight(values.weight, units));
    case "reps":
      return values.reps == null ? "" : String(values.reps);
    case "distance":
      return values.distance == null ? "" : trim(displayDistance(values.distance, units), 3);
    case "seconds":
      return values.seconds == null ? "" : fmtSeconds(values.seconds);
  }
}
/** Parse typed text for a field back into stored units; null when empty, undefined when invalid. */
export function parseField(text: string, kind: ColumnKind, units: Units): number | null | undefined {
  const v = text.trim().replace(",", ".");
  if (!v) return null;
  if (kind === "seconds") {
    const s = parseSeconds(v);
    return s == null || Number.isNaN(s) ? undefined : s;
  }
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) return undefined;
  if (kind === "weight") return storeWeight(n, units);
  if (kind === "distance") return storeDistance(n, units);
  return Math.round(n);
}

/** "25 kg × 5", "12 reps", "0.48 km | 2:00", "2:00". */
export function fmtSetValues(values: SetValues | null | undefined, category: ExerciseCategory, units: Units): string {
  if (!values) return "";
  switch (category) {
    case "cardio": {
      const parts: string[] = [];
      if (values.distance != null) parts.push(fmtDistanceValue(values.distance, units));
      if (values.seconds != null) parts.push(fmtSeconds(values.seconds));
      return parts.join(" | ");
    }
    case "duration":
      return values.seconds == null ? "" : fmtSeconds(values.seconds);
    case "bodyweight":
    case "reps_only":
      return values.reps == null ? "" : `${values.reps} reps`;
    case "weighted_bodyweight":
    case "assisted_bodyweight": {
      const sign = category === "weighted_bodyweight" ? "+" : "-";
      if (values.reps == null) return "";
      return values.weight ? `${sign}${fmtWeightValue(values.weight, units)} × ${values.reps}` : `${values.reps} reps`;
    }
    default:
      if (values.weight == null && values.reps == null) return "";
      return `${fmtWeightValue(values.weight ?? 0, units)} × ${values.reps ?? 0}`;
  }
}

export const hasValues = (s: SetValues, category: ExerciseCategory): boolean => !isEmptySet({ setType: "normal", completed: false, ...s }, category);

// ---------- set types ----------
export const SET_TYPES: { value: SetType; label: string; letter: string }[] = [
  { value: "warmup", label: "Warm-up", letter: "W" },
  { value: "normal", label: "Normal", letter: "" },
  { value: "drop", label: "Drop Set", letter: "D" },
  { value: "failure", label: "Failure", letter: "F" },
];
/** Strong numbers only normal sets; typed sets show the letter. */
export function setLabel(sets: { setType: SetType }[], index: number): string {
  const s = sets[index]!;
  if (s.setType !== "normal") return SET_TYPES.find((t) => t.value === s.setType)?.letter ?? "";
  let n = 0;
  for (let i = 0; i <= index; i++) if (sets[i]!.setType === "normal") n++;
  return String(n);
}

// ---------- supersets ----------
const SS_COLORS = ["var(--cal-blue)", "var(--cal-green)", "var(--cal-orange)", "var(--cal-pink)", "var(--cal-purple)", "var(--cal-yellow)", "var(--cal-red)"];
export const supersetColor = (group: number): string => SS_COLORS[Math.abs(group) % SS_COLORS.length]!;
export function nextSupersetGroup(exercises: { supersetGroup: number | null }[]): number {
  return exercises.reduce((m, e) => Math.max(m, e.supersetGroup ?? 0), 0) + 1;
}

// ---------- records ----------
export function prLabel(type: PrType): string {
  switch (type) {
    case "one_rm":
      return "1RM";
    case "weight":
      return "Weight";
    case "volume":
      return "Volume";
    case "reps":
      return "Reps";
    case "distance":
      return "Distance";
    case "duration":
      return "Duration";
  }
}
export function fmtPrValue(type: PrType, value: number, units: Units): string {
  switch (type) {
    case "one_rm":
    case "weight":
      return fmtWeightValue(value, units);
    case "volume":
      return fmtVolume(value, units);
    case "reps":
      return `${fmtInt(value)} reps`;
    case "distance":
      return fmtDistanceValue(value, units);
    case "duration":
      return fmtSeconds(value);
  }
}

// ---------- rest ----------
export function restFor(exercise: { restSeconds: number | null }, setType: SetType, settings: WorkoutSettings | undefined, app: AppSettings): number {
  if (setType === "warmup" && settings?.warmupRestSeconds != null) return settings.warmupRestSeconds;
  if (setType === "drop" && settings?.dropSetRestSeconds != null) return settings.dropSetRestSeconds;
  if (setType === "drop") return 0;
  return exercise.restSeconds ?? app.defaultRestSeconds ?? 120;
}

// ---------- summaries ----------
export function exerciseSummary(names: string[]): string {
  if (!names.length) return "No exercises";
  const first = names.slice(0, 3);
  const rest = names.length - first.length;
  return rest > 0 ? `${first.join(", ")} and ${rest} more` : first.join(", ");
}
export const plural = (n: number, one: string, many = `${one}s`): string => `${fmtInt(n)} ${n === 1 ? one : many}`;

export function bestOf(sets: WorkoutSet[], category: ExerciseCategory): WorkoutSet | null {
  return pickBestSet(sets, category);
}

export const fmt1Dec = fmt1;

// ---------- template diff (Strong's "Update Template" prompt) ----------
export interface TemplateDiff {
  structural: boolean;
  valueChanges: number;
  removes: boolean;
  text: string;
  valueText: string;
}
const near = (a: number | null, b: number | null): boolean => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.01);

export function templateDiff(template: WorkoutTemplate, workout: Workout, keep: (s: WorkoutSet) => boolean): TemplateDiff {
  const tex = template.exercises ?? [];
  const wex = (workout.exercises ?? []).map((e) => ({ ...e, sets: (e.sets ?? []).filter(keep) })).filter((e) => e.sets.length > 0);
  let addedExercises = 0;
  let removedExercises = 0;
  let addedSets = 0;
  let removedSets = 0;
  let typeChanges = 0;
  let valueChanges = 0;
  const used = new Set<number>();
  const match = new Map<number, number>();
  wex.forEach((e, wi) => {
    const ti = tex.findIndex((t, i) => !used.has(i) && t.exerciseId === e.exerciseId);
    if (ti < 0) {
      addedExercises++;
      addedSets += e.sets.length;
      return;
    }
    used.add(ti);
    match.set(wi, ti);
    const tsets = tex[ti]!.sets ?? [];
    const n = Math.min(tsets.length, e.sets.length);
    addedSets += Math.max(0, e.sets.length - tsets.length);
    removedSets += Math.max(0, tsets.length - e.sets.length);
    for (let i = 0; i < n; i++) {
      const ts = tsets[i]!;
      const ws = e.sets[i]!;
      if (ts.setType !== ws.setType) typeChanges++;
      if (!near(ts.targetWeight, ws.weight) || !near(ts.targetReps, ws.reps) || !near(ts.targetSeconds, ws.seconds) || !near(ts.targetDistance, ws.distance)) valueChanges++;
    }
  });
  tex.forEach((t, i) => {
    if (!used.has(i)) {
      removedExercises++;
      removedSets += (t.sets ?? []).length;
    }
  });
  const order = Array.from(match.entries()).sort((a, b) => a[0] - b[0]).map(([, ti]) => ti);
  const reordered = order.some((ti, i) => i > 0 && ti < order[i - 1]!);
  const supersetChanged = wex.some((e, wi) => {
    const ti = match.get(wi);
    return ti != null && (tex[ti]!.supersetGroup ?? null) !== (e.supersetGroup ?? null);
  });
  const structural = addedExercises + removedExercises + addedSets + removedSets + typeChanges > 0 || reordered || supersetChanged;
  const parts: string[] = [];
  if (addedExercises) parts.push(`Adds ${plural(addedExercises, "exercise")}.`);
  if (removedExercises) parts.push(`Removes ${plural(removedExercises, "exercise")}.`);
  if (addedSets) parts.push(`Adds ${plural(addedSets, "set")}.`);
  if (removedSets) parts.push(`Removes ${plural(removedSets, "set")}.`);
  if (typeChanges) parts.push(`Changes ${plural(typeChanges, "set type")}.`);
  if (reordered) parts.push("Reorders exercises.");
  if (supersetChanged && !parts.length) parts.push("Changes supersets.");
  return { structural, valueChanges, removes: removedExercises + removedSets > 0, text: parts.join(" "), valueText: valueChanges ? `Updates values for ${plural(valueChanges, "set")}.` : "" };
}

/** Plain-text summary for the clipboard share. */
export function shareText(workout: Workout, units: Units, prs: { exerciseName: string; type: PrType; value: number }[]): string {
  const lines: string[] = [workout.name];
  if (workout.durationSeconds != null) lines.push(`${fmtDuration(workout.durationSeconds)}, ${fmtVolume(workout.totalVolume ?? 0, units)}${prs.length ? `, ${plural(prs.length, "PR")}` : ""}`);
  for (const e of workout.exercises ?? []) {
    const sets = e.sets ?? [];
    lines.push("", `${sets.length} × ${e.exercise?.name ?? "Exercise"}`);
    sets.forEach((s, i) => lines.push(`${setLabel(sets, i)}  ${fmtSetValues(s, e.exercise?.category ?? "barbell", units)}${s.prs.length ? "  PR" : ""}`));
  }
  if (prs.length) {
    lines.push("", "Personal records");
    for (const p of prs) lines.push(`${p.exerciseName}: ${prLabel(p.type)} ${fmtPrValue(p.type, p.value, units)}`);
  }
  return lines.join("\n");
}

export type { WorkoutExercise };
