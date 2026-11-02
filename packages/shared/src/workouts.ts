import type { ExerciseCategory, PrType, SetType } from "./schemas.ts";

// Calculation rules modelled on the Strong app. All weights are kilograms, distances kilometres, durations seconds.

export type OneRmFormula = "hybrid" | "brzycki" | "epley";

/** Strong only supports records for sets with 12 or fewer reps. */
export const MAX_RECORD_REPS = 12;

const WEIGHT_CATEGORIES: ReadonlySet<ExerciseCategory> = new Set(["barbell", "dumbbell", "machine", "cable"]);
const REPS_CATEGORIES: ReadonlySet<ExerciseCategory> = new Set(["bodyweight", "reps_only", "assisted_bodyweight"]);

export const isWeightCategory = (category: ExerciseCategory | undefined): boolean => category === undefined || WEIGHT_CATEGORIES.has(category);
export const isRepsOnlyCategory = (category: ExerciseCategory): boolean => REPS_CATEGORIES.has(category);

function brzycki(weight: number, reps: number): number {
  if (reps >= 37) return epley(weight, reps);
  return weight * (36 / (37 - reps));
}
function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

/** Estimated one-rep max. Hybrid (Strong default) uses Brzycki below 10 reps and Epley from 10 reps. */
export function estimateOneRepMax(weight: number, reps: number, formula: OneRmFormula = "hybrid"): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  if (formula === "brzycki") return brzycki(weight, reps);
  if (formula === "epley") return epley(weight, reps);
  return reps < 10 ? brzycki(weight, reps) : epley(weight, reps);
}

/** Predicted weight for a rep count, inverting the chosen formula on an estimated 1RM. */
export function weightForReps(oneRm: number, reps: number, formula: OneRmFormula = "hybrid"): number {
  if (reps <= 1) return oneRm;
  const useBrzycki = formula === "brzycki" || (formula === "hybrid" && reps < 10);
  if (useBrzycki && reps < 37) return oneRm * ((37 - reps) / 36);
  return oneRm / (1 + reps / 30);
}

export interface SetLike {
  setType: SetType;
  weight: number | null;
  reps: number | null;
  seconds?: number | null;
  distance?: number | null;
  completed: boolean;
}

export interface VolumeOptions {
  category?: ExerciseCategory;
  /** Latest logged bodyweight in kilograms; used for weighted and assisted bodyweight volume. */
  bodyweightKg?: number | null;
  countDumbbellsTwice?: boolean;
  includeWeightedBodyweight?: boolean;
  includeAssistedBodyweight?: boolean;
}

export type RecordMap = Partial<Record<PrType, number>>;

export function setCountsForRecords(s: SetLike): boolean {
  return s.completed && s.setType !== "warmup";
}

/** Volume of a single set following Strong's rules. Warm-up status is not considered here. */
export function setVolume(s: SetLike, opts: VolumeOptions = {}): number {
  const weight = s.weight ?? 0;
  const reps = s.reps ?? 0;
  const bodyweight = opts.bodyweightKg ?? 0;
  switch (opts.category) {
    case undefined:
    case "barbell":
    case "machine":
    case "cable":
      return weight * reps;
    case "dumbbell":
      return weight * reps * (opts.countDumbbellsTwice ? 2 : 1);
    case "weighted_bodyweight":
      return opts.includeWeightedBodyweight === false ? 0 : reps * (weight + bodyweight);
    case "assisted_bodyweight":
      return opts.includeAssistedBodyweight === false ? 0 : reps * Math.max(0, bodyweight - weight);
    default:
      return 0;
  }
}

/** Record types tracked for an exercise category. */
export function recordTypesFor(category: ExerciseCategory | undefined): PrType[] {
  if (isWeightCategory(category)) return ["weight", "one_rm", "volume"];
  switch (category) {
    case "weighted_bodyweight":
      return ["reps", "weight", "volume"];
    case "cardio":
      return ["distance", "duration"];
    case "duration":
      return ["duration"];
    default:
      return ["reps"];
  }
}

/** The value a set would hold for a record type, or null when the set has no such value. */
export function recordValueForSet(s: SetLike, type: PrType, category: ExerciseCategory | undefined, formula: OneRmFormula = "hybrid"): number | null {
  const w = s.weight ?? 0;
  const r = s.reps ?? 0;
  const repCapped = r >= 1 && r <= MAX_RECORD_REPS;
  switch (type) {
    case "weight":
      return w > 0 && repCapped ? w : null;
    case "one_rm":
      return isWeightCategory(category) && w > 0 && repCapped ? estimateOneRepMax(w, r, formula) : null;
    case "volume":
      return w > 0 && repCapped ? w * r : null;
    case "reps":
      return r >= 1 ? r : null;
    case "distance":
      return (s.distance ?? 0) > 0 ? (s.distance ?? 0) : null;
    case "duration":
      return (s.seconds ?? 0) > 0 ? (s.seconds ?? 0) : null;
  }
}

export interface PrOptions {
  category?: ExerciseCategory;
  formula?: OneRmFormula;
}

/**
 * Which record types a set beats. Warm-up and incomplete sets never count, ties do not count,
 * and weight-based records require 1 to 12 reps.
 */
export function prsForSet(s: SetLike, records: RecordMap, opts: PrOptions = {}): PrType[] {
  if (!setCountsForRecords(s)) return [];
  const out: PrType[] = [];
  for (const type of recordTypesFor(opts.category)) {
    const value = recordValueForSet(s, type, opts.category, opts.formula);
    if (value !== null && value > (records[type] ?? 0) + 1e-9) out.push(type);
  }
  return out;
}

/**
 * Walk sets in order, updating records as they are beaten so a later set in the same workout that beats
 * an earlier one is also flagged. Returns the records after the walk and per-set flags.
 */
export function evaluateWorkoutPrs<T extends SetLike & { id: string }>(setsInOrder: T[], startingRecords: RecordMap, opts: PrOptions = {}): { records: RecordMap; prs: Map<string, PrType[]>; holders: Map<PrType, T> } {
  const records: RecordMap = { ...startingRecords };
  const prs = new Map<string, PrType[]>();
  const holders = new Map<PrType, T>();
  for (const s of setsInOrder) {
    const got = prsForSet(s, records, opts);
    prs.set(s.id, got);
    for (const type of got) {
      records[type] = recordValueForSet(s, type, opts.category, opts.formula) ?? records[type];
      holders.set(type, s);
    }
  }
  return { records, prs, holders };
}

/** Total volume (completed, non warm-up sets) and completed set count. */
export function workoutTotals(sets: (SetLike & { category?: ExerciseCategory })[], opts: Omit<VolumeOptions, "category"> = {}): { volume: number; completedSets: number } {
  let volume = 0;
  let completedSets = 0;
  for (const s of sets) {
    if (!s.completed) continue;
    completedSets++;
    if (s.setType === "warmup") continue;
    volume += setVolume(s, { ...opts, category: s.category });
  }
  return { volume, completedSets };
}

export interface RepMaxRow {
  reps: number;
  /** Heaviest weight lifted for exactly this many reps. */
  best: number | null;
  /** Weight predicted from the best estimated 1RM, or the actual best when it is higher. */
  predicted: number | null;
}

/** Records table for reps 1 to 12 from eligible (completed, non warm-up) performances. */
export function repMaxTable(performances: { weight: number; reps: number }[], formula: OneRmFormula = "hybrid"): RepMaxRow[] {
  let bestOneRm = 0;
  const best = new Map<number, number>();
  for (const p of performances) {
    if (p.weight <= 0 || p.reps < 1 || p.reps > MAX_RECORD_REPS) continue;
    bestOneRm = Math.max(bestOneRm, estimateOneRepMax(p.weight, p.reps, formula));
    best.set(p.reps, Math.max(best.get(p.reps) ?? 0, p.weight));
  }
  return Array.from({ length: MAX_RECORD_REPS }, (_, i) => {
    const reps = i + 1;
    const actual = best.get(reps) ?? null;
    const predicted = bestOneRm > 0 ? Math.max(weightForReps(bestOneRm, reps, formula), actual ?? 0) : actual;
    return { reps, best: actual, predicted: predicted === null ? null : round2(predicted) };
  });
}

/** Score used to rank sets of one exercise; higher is better. */
export function setScore(s: SetLike, category: ExerciseCategory | undefined, formula: OneRmFormula = "hybrid"): number {
  const w = s.weight ?? 0;
  const r = s.reps ?? 0;
  if (isWeightCategory(category) || category === "weighted_bodyweight") return w > 0 && r > 0 ? estimateOneRepMax(w, r, formula) + w * 1e-6 : r * 1e-3;
  if (category === "cardio") return (s.distance ?? 0) * 1e6 + (s.seconds ?? 0);
  if (category === "duration") return s.seconds ?? 0;
  if (category === "assisted_bodyweight") return r * 1e3 - w;
  return r;
}

/** The best completed, non warm-up set of an exercise, or null. */
export function bestSet<T extends SetLike>(sets: T[], category: ExerciseCategory | undefined, formula: OneRmFormula = "hybrid"): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const s of sets) {
    if (!setCountsForRecords(s)) continue;
    const score = setScore(s, category, formula);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** A set with no logged values; Strong drops these when a workout is finished. */
export function isEmptySet(s: SetLike, category: ExerciseCategory | undefined): boolean {
  if (category === "cardio") return !(s.distance ?? 0) && !(s.seconds ?? 0);
  if (category === "duration") return !(s.seconds ?? 0);
  return !(s.reps ?? 0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const KG_PER_LB = 0.45359237;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;

export const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
export const LB_PLATES = [45, 35, 25, 10, 5, 2.5];

/** Plates needed per side for a target bar weight (kilograms and an Olympic bar by default). */
export function platesPerSide(target: number, bar = 20, plates: number[] = KG_PLATES): number[] {
  let remaining = (target - bar) / 2;
  const out: number[] = [];
  for (const p of plates) {
    while (remaining >= p - 1e-9) {
      out.push(p);
      remaining -= p;
    }
  }
  return out;
}

/** Warm-up sets for a work-set weight: Strong's default formula (40% x 5, 60% x 5, 80% x 3), rounded to a plate step, never below the bar. */
export function warmupSets(workWeight: number, opts: { bar?: number; step?: number; formula?: { percent: number; reps: number }[] } = {}): { weight: number; reps: number }[] {
  const bar = opts.bar ?? 20;
  const step = opts.step ?? 5;
  const formula = opts.formula ?? [
    { percent: 0.4, reps: 5 },
    { percent: 0.6, reps: 5 },
    { percent: 0.8, reps: 3 },
  ];
  return formula.map((f) => ({ weight: Math.max(bar, Math.round((workWeight * f.percent) / step) * step), reps: f.reps }));
}
