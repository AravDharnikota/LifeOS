import type { PrType, SetType } from "./schemas.ts";

/** Estimated one-rep max. Strong uses the Brzycki formula; it is undefined above 36 reps. */
export function estimateOneRepMax(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  if (reps >= 37) return weight * (1 + reps / 30); // Epley fallback
  return weight * (36 / (37 - reps));
}

/** Percent of 1RM for a given rep count (Brzycki inverse) */
export function weightForReps(oneRm: number, reps: number): number {
  if (reps <= 1) return oneRm;
  return oneRm * ((37 - reps) / 36);
}

export interface SetLike {
  setType: SetType;
  weight: number | null;
  reps: number | null;
  seconds?: number | null;
  distance?: number | null;
  completed: boolean;
}

export interface RecordMap {
  weight?: number;
  one_rm?: number;
  volume?: number;
  reps?: number;
}

export function setCountsForRecords(s: SetLike): boolean {
  return s.completed && s.setType !== "warmup";
}

export function setVolume(s: SetLike): number {
  return (s.weight ?? 0) * (s.reps ?? 0);
}

/**
 * Determine which PR types a set achieves against existing records.
 * Rules (Strong): warm-up sets never count. weight: heaviest weight lifted for >=1 rep.
 * one_rm: highest estimated 1RM. volume: highest weight*reps in a single set.
 * reps: most reps in a single set (only meaningful for bodyweight/reps_only; we still track it).
 */
export function prsForSet(s: SetLike, records: RecordMap): PrType[] {
  if (!setCountsForRecords(s)) return [];
  const out: PrType[] = [];
  const w = s.weight ?? 0;
  const r = s.reps ?? 0;
  if (w > 0 && r > 0 && w > (records.weight ?? 0)) out.push("weight");
  if (w > 0 && r > 0) {
    const e = estimateOneRepMax(w, r);
    if (e > (records.one_rm ?? 0) + 1e-9) out.push("one_rm");
    const v = w * r;
    if (v > (records.volume ?? 0) + 1e-9) out.push("volume");
  }
  if (r > 0 && w === 0 && r > (records.reps ?? 0)) out.push("reps");
  return out;
}

/**
 * Walk a workout's sets per exercise in order, computing PRs incrementally so a later set in the same
 * workout that beats an earlier PR also gets flagged. Returns updated records and per-set PR flags.
 */
export function evaluateWorkoutPrs<T extends SetLike & { id: string }>(
  setsInOrder: T[],
  startingRecords: RecordMap,
): { records: RecordMap; prs: Map<string, PrType[]> } {
  const records: RecordMap = { ...startingRecords };
  const prs = new Map<string, PrType[]>();
  for (const s of setsInOrder) {
    const got = prsForSet(s, records);
    prs.set(s.id, got);
    const w = s.weight ?? 0;
    const r = s.reps ?? 0;
    for (const p of got) {
      if (p === "weight") records.weight = w;
      if (p === "one_rm") records.one_rm = estimateOneRepMax(w, r);
      if (p === "volume") records.volume = w * r;
      if (p === "reps") records.reps = r;
    }
  }
  return { records, prs };
}

export function workoutTotals(sets: SetLike[]): { volume: number; completedSets: number } {
  let volume = 0;
  let completedSets = 0;
  for (const s of sets) {
    if (!s.completed) continue;
    completedSets++;
    volume += setVolume(s);
  }
  return { volume, completedSets };
}

export const KG_PER_LB = 0.45359237;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;

/** Plates needed per side for a target bar weight. */
export function platesPerSide(target: number, bar = 45, plates = [45, 35, 25, 10, 5, 2.5]): number[] {
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
