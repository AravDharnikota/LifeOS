import { describe, expect, it } from "vitest";
import { bestSet, estimateOneRepMax, evaluateWorkoutPrs, isEmptySet, platesPerSide, prsForSet, recordTypesFor, repMaxTable, setVolume, warmupSets, weightForReps, workoutTotals } from "../src/workouts.ts";

const set = (weight: number | null, reps: number | null, extra: Partial<{ setType: "normal" | "warmup" | "drop" | "failure"; completed: boolean; seconds: number | null; distance: number | null; id: string }> = {}) => ({
  id: extra.id ?? `${weight}x${reps}`,
  setType: extra.setType ?? "normal",
  weight,
  reps,
  seconds: extra.seconds ?? null,
  distance: extra.distance ?? null,
  completed: extra.completed ?? true,
});

describe("estimated 1RM", () => {
  it("uses Brzycki below 10 reps and Epley from 10 reps (hybrid)", () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(100 * (36 / 32), 6);
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(100 * (1 + 10 / 30), 6);
    expect(estimateOneRepMax(100, 10, "brzycki")).toBeCloseTo(100 * (36 / 27), 6);
    expect(estimateOneRepMax(100, 5, "epley")).toBeCloseTo(100 * (1 + 5 / 30), 6);
    expect(estimateOneRepMax(0, 5)).toBe(0);
    expect(estimateOneRepMax(100, 0)).toBe(0);
  });
  it("inverts the formula for predicted rep maxes", () => {
    const oneRm = estimateOneRepMax(100, 5);
    expect(weightForReps(oneRm, 5)).toBeCloseTo(100, 6);
    const high = estimateOneRepMax(80, 12);
    expect(weightForReps(high, 12)).toBeCloseTo(80, 6);
    expect(weightForReps(120, 1)).toBe(120);
  });
});

describe("volume rules", () => {
  it("counts barbell, machine and cable as weight x reps", () => {
    expect(setVolume(set(100, 5), { category: "barbell" })).toBe(500);
    expect(setVolume(set(50, 10), { category: "cable" })).toBe(500);
    expect(setVolume(set(50, 10))).toBe(500);
  });
  it("counts dumbbells twice only when the setting is on", () => {
    expect(setVolume(set(20, 10), { category: "dumbbell" })).toBe(200);
    expect(setVolume(set(20, 10), { category: "dumbbell", countDumbbellsTwice: true })).toBe(400);
  });
  it("adds bodyweight for weighted and subtracts assistance for assisted bodyweight", () => {
    expect(setVolume(set(10, 5), { category: "weighted_bodyweight", bodyweightKg: 80 })).toBe(450);
    expect(setVolume(set(20, 5), { category: "assisted_bodyweight", bodyweightKg: 80 })).toBe(300);
    expect(setVolume(set(10, 5), { category: "weighted_bodyweight", bodyweightKg: 80, includeWeightedBodyweight: false })).toBe(0);
    expect(setVolume(set(20, 5), { category: "assisted_bodyweight", bodyweightKg: 80, includeAssistedBodyweight: false })).toBe(0);
  });
  it("gives no volume to reps only, cardio and duration", () => {
    expect(setVolume(set(0, 20), { category: "bodyweight" })).toBe(0);
    expect(setVolume(set(null, 20), { category: "reps_only" })).toBe(0);
    expect(setVolume(set(null, null, { distance: 5, seconds: 1500 }), { category: "cardio" })).toBe(0);
  });
  it("totals skip warm-ups and incomplete sets but count every completed set", () => {
    const totals = workoutTotals([
      { ...set(60, 5, { setType: "warmup" }), category: "barbell" },
      { ...set(100, 5), category: "barbell" },
      { ...set(100, 5, { completed: false }), category: "barbell" },
      { ...set(20, 10), category: "dumbbell" },
    ]);
    expect(totals.volume).toBe(700);
    expect(totals.completedSets).toBe(3);
  });
});

describe("personal records", () => {
  it("tracks weight, 1RM and volume for weight exercises", () => {
    expect(prsForSet(set(100, 5), {}, { category: "barbell" })).toEqual(["weight", "one_rm", "volume"]);
    expect(recordTypesFor("dumbbell")).toEqual(["weight", "one_rm", "volume"]);
  });
  it("only flags strictly better values", () => {
    const records = { weight: 100, one_rm: estimateOneRepMax(100, 5), volume: 500 };
    expect(prsForSet(set(100, 5), records, { category: "barbell" })).toEqual([]);
    expect(prsForSet(set(100, 6), records, { category: "barbell" })).toEqual(["one_rm", "volume"]);
    expect(prsForSet(set(102.5, 1), records, { category: "barbell" })).toEqual(["weight"]);
  });
  it("never flags warm-up sets, incomplete sets or sets above 12 reps", () => {
    expect(prsForSet(set(100, 5, { setType: "warmup" }), {}, { category: "barbell" })).toEqual([]);
    expect(prsForSet(set(100, 5, { completed: false }), {}, { category: "barbell" })).toEqual([]);
    expect(prsForSet(set(100, 13), {}, { category: "barbell" })).toEqual([]);
    expect(prsForSet(set(100, 12), {}, { category: "barbell" })).toEqual(["weight", "one_rm", "volume"]);
  });
  it("drop and failure sets still count", () => {
    expect(prsForSet(set(100, 5, { setType: "drop" }), {}, { category: "barbell" })).toEqual(["weight", "one_rm", "volume"]);
    expect(prsForSet(set(100, 5, { setType: "failure" }), {}, { category: "barbell" })).toEqual(["weight", "one_rm", "volume"]);
  });
  it("uses max reps for reps-only exercises and added weight for weighted bodyweight", () => {
    expect(prsForSet(set(null, 15), {}, { category: "bodyweight" })).toEqual(["reps"]);
    expect(prsForSet(set(0, 15), { reps: 15 }, { category: "reps_only" })).toEqual([]);
    expect(prsForSet(set(10, 8), {}, { category: "weighted_bodyweight" })).toEqual(["reps", "weight", "volume"]);
    expect(prsForSet(set(0, 8), {}, { category: "weighted_bodyweight" })).toEqual(["reps"]);
  });
  it("uses distance and duration for cardio", () => {
    expect(prsForSet(set(null, null, { distance: 5, seconds: 1500 }), {}, { category: "cardio" })).toEqual(["distance", "duration"]);
    expect(prsForSet(set(null, null, { distance: 4, seconds: 1600 }), { distance: 5, duration: 1500 }, { category: "cardio" })).toEqual(["duration"]);
    expect(prsForSet(set(null, null, { seconds: 60 }), {}, { category: "duration" })).toEqual(["duration"]);
  });
  it("evaluates sets in order so later sets must beat earlier ones", () => {
    const result = evaluateWorkoutPrs([set(60, 5, { setType: "warmup", id: "w" }), set(100, 5, { id: "a" }), set(100, 5, { id: "b" }), set(105, 5, { id: "c" })], {}, { category: "barbell" });
    expect(result.prs.get("w")).toEqual([]);
    expect(result.prs.get("a")).toEqual(["weight", "one_rm", "volume"]);
    expect(result.prs.get("b")).toEqual([]);
    expect(result.prs.get("c")).toEqual(["weight", "one_rm", "volume"]);
    expect(result.records.weight).toBe(105);
    expect(result.records.volume).toBe(525);
    expect(result.holders.get("weight")?.id).toBe("c");
  });
});

describe("records table and best set", () => {
  it("fills best performance and predicted columns for 1 to 12 reps", () => {
    const rows = repMaxTable([
      { weight: 100, reps: 5 },
      { weight: 90, reps: 8 },
      { weight: 80, reps: 15 },
    ]);
    expect(rows).toHaveLength(12);
    expect(rows[4]).toMatchObject({ reps: 5, best: 100 });
    expect(rows[7]?.best).toBe(90);
    expect(rows[0]?.best).toBeNull();
    expect(rows[0]?.predicted).toBeCloseTo(estimateOneRepMax(100, 5), 1);
    expect(rows[7]?.predicted).toBeGreaterThanOrEqual(90);
    expect(rows[11]?.best).toBeNull();
  });
  it("picks the best set by estimated 1RM for weight exercises and by reps otherwise", () => {
    expect(bestSet([set(100, 5, { id: "a" }), set(90, 10, { id: "b" }), set(120, 1, { setType: "warmup", id: "w" })], "barbell")?.id).toBe("b");
    expect(bestSet([set(null, 12, { id: "a" }), set(null, 15, { id: "b" })], "bodyweight")?.id).toBe("b");
    expect(bestSet([set(null, 5, { completed: false })], "bodyweight")).toBeNull();
  });
  it("detects empty sets per category", () => {
    expect(isEmptySet(set(100, null), "barbell")).toBe(true);
    expect(isEmptySet(set(100, 0), "barbell")).toBe(true);
    expect(isEmptySet(set(null, 10), "bodyweight")).toBe(false);
    expect(isEmptySet(set(null, null, { seconds: 60 }), "duration")).toBe(false);
    expect(isEmptySet(set(null, null), "cardio")).toBe(true);
  });
});

describe("calculators", () => {
  it("computes plates per side in kilograms", () => {
    expect(platesPerSide(100)).toEqual([25, 15]);
    expect(platesPerSide(60)).toEqual([20]);
    expect(platesPerSide(62.5)).toEqual([20, 1.25]);
    expect(platesPerSide(20)).toEqual([]);
  });
  it("builds warm-up sets that never go below the bar", () => {
    expect(warmupSets(100)).toEqual([
      { weight: 40, reps: 5 },
      { weight: 60, reps: 5 },
      { weight: 80, reps: 3 },
    ]);
    expect(warmupSets(30)[0]).toEqual({ weight: 20, reps: 5 });
  });
});
