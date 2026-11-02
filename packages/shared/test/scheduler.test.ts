import { describe, expect, it } from "vitest";
import { SchedulerPrefs } from "../src/schemas.ts";
import { FROZEN_WINDOW_MINUTES, scheduleTasks, type ScheduleCandidate, type ScheduleInput, type ScheduleOutput } from "../src/scheduler.ts";

// 2026-11-02 is a Monday. All times are local, so these tests hold in any process timezone.
const local = (day: number, hh: number, mm = 0): Date => new Date(2026, 10, day, hh, mm, 0, 0);
const iso = (day: number, hh: number, mm = 0): string => local(day, hh, mm).toISOString();
const MONDAY_8 = local(2, 8);
const prefs = SchedulerPrefs.parse({});

function task(over: Partial<ScheduleCandidate> & { id: string }): ScheduleCandidate {
  return { title: over.id, estimateMinutes: 60, dueDate: null, dueTime: null, startDate: null, priority: 0, createdAt: iso(1, 12), existingBlocks: [], ...over };
}

function run(candidates: ScheduleCandidate[], over: Partial<ScheduleInput> = {}): ScheduleOutput {
  return scheduleTasks({ candidates, busy: [], prefs, now: MONDAY_8, horizonDays: 7, ...over });
}

function blocksOf(out: ScheduleOutput, taskId: string): { start: Date; end: Date; existingBlockId: string | null }[] {
  const p = out.placements.find((x) => x.taskId === taskId);
  return (p?.blocks ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end), existingBlockId: b.existingBlockId }));
}

const minutes = (a: Date, b: Date): number => (b.getTime() - a.getTime()) / 60000;
const hm = (d: Date): string => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("scheduleTasks", () => {
  it("places inside work hours and never before now", () => {
    const out = run([task({ id: "a" })]);
    const [b] = blocksOf(out, "a");
    expect(b).toBeDefined();
    expect(b!.start.getTime()).toBe(local(2, 9).getTime());
    expect(b!.end.getTime()).toBe(local(2, 10).getTime());
    expect(out.unplaced).toEqual([]);
    expect(out.atRisk).toEqual([]);
  });

  it("starts from the snapped current time when now is inside work hours", () => {
    const out = run([task({ id: "a", estimateMinutes: 20 })], { now: local(2, 15, 7) });
    const [b] = blocksOf(out, "a");
    expect(hm(b!.start)).toBe("15:15");
    expect(minutes(b!.start, b!.end)).toBe(30);
    expect(b!.start.getTime()).toBeGreaterThan(local(2, 15, 7).getTime());
  });

  it("never places anything in the past", () => {
    const out = run([task({ id: "a" }), task({ id: "b" }), task({ id: "c" })], { now: local(2, 17) });
    for (const id of ["a", "b", "c"]) {
      for (const b of blocksOf(out, id)) expect(b.start.getTime()).toBeGreaterThanOrEqual(local(2, 17).getTime());
    }
  });

  it("avoids lunch", () => {
    const out = run([task({ id: "a", estimateMinutes: 120 })], { now: local(2, 11, 30) });
    const bs = blocksOf(out, "a");
    expect(bs.map((b) => [hm(b.start), hm(b.end)])).toEqual([
      ["11:30", "12:30"],
      ["13:15", "14:15"],
    ]);
  });

  it("keeps a buffer after meetings and between blocks", () => {
    const meeting = { start: iso(2, 10), end: iso(2, 11) };
    const out = run([task({ id: "a", estimateMinutes: 45 }), task({ id: "b", estimateMinutes: 60 }), task({ id: "c", estimateMinutes: 30 })], { busy: [meeting] });
    const a = blocksOf(out, "a")[0]!;
    const b = blocksOf(out, "b")[0]!;
    const c = blocksOf(out, "c")[0]!;
    expect([hm(a.start), hm(a.end)]).toEqual(["09:00", "09:45"]);
    expect(b.start.getTime()).toBeGreaterThanOrEqual(local(2, 11, 10).getTime());
    expect(hm(b.start)).toBe("11:15");
    expect(minutes(b.end, c.start)).toBeGreaterThanOrEqual(prefs.bufferMinutes);
  });

  it("leaves at least the buffer between consecutive blocks on an empty day", () => {
    const out = run([task({ id: "a", estimateMinutes: 45 }), task({ id: "b", estimateMinutes: 45 })]);
    const a = blocksOf(out, "a")[0]!;
    const b = blocksOf(out, "b")[0]!;
    expect(minutes(a.end, b.start)).toBeGreaterThanOrEqual(prefs.bufferMinutes);
    expect(hm(b.start)).toBe("10:00");
  });

  it("splits long tasks into chunks between the min and max block size", () => {
    const out = run([task({ id: "a", estimateMinutes: 200 })]);
    const bs = blocksOf(out, "a");
    expect(bs.length).toBe(3);
    const sizes = bs.map((b) => minutes(b.start, b.end));
    expect(sizes.reduce((s, n) => s + n, 0)).toBe(210);
    for (const n of sizes) {
      expect(n).toBeLessThanOrEqual(prefs.maxBlockMinutes);
      expect(n).toBeGreaterThanOrEqual(prefs.minBlockMinutes);
    }
    expect(out.unplaced).toEqual([]);
  });

  it("snaps block edges to the grid", () => {
    const busy = [{ start: iso(2, 9), end: iso(2, 10, 5) }];
    const out = run([task({ id: "a", estimateMinutes: 40 })], { busy });
    const [b] = blocksOf(out, "a");
    expect(hm(b!.start)).toBe("10:30");
    expect(b!.start.getMinutes() % prefs.snapMinutes).toBe(0);
    expect(minutes(b!.start, b!.end)).toBe(45);
  });

  it("places a task shorter than the minimum block", () => {
    const out = run([task({ id: "tiny", estimateMinutes: 10 })]);
    const [b] = blocksOf(out, "tiny");
    expect(minutes(b!.start, b!.end)).toBe(prefs.snapMinutes);
    expect(out.unplaced).toEqual([]);
  });

  it("does not leave an orphan shorter than the minimum block when a slot is almost big enough", () => {
    const busy = [{ start: iso(2, 9, 45), end: iso(2, 12, 30) }];
    const out = run([task({ id: "a", estimateMinutes: 60 })], { busy });
    for (const b of blocksOf(out, "a")) expect(minutes(b.start, b.end)).toBeGreaterThanOrEqual(prefs.minBlockMinutes);
  });

  it("orders a near deadline ahead of a higher priority task due later", () => {
    const memo = task({ id: "memo", dueDate: "2026-11-02", dueTime: "11:00", priority: 0 });
    const report = task({ id: "report", dueDate: "2026-11-06", priority: 3 });
    const out = run([report, memo]);
    expect(hm(blocksOf(out, "memo")[0]!.start)).toBe("09:00");
    expect(blocksOf(out, "memo")[0]!.end.getTime()).toBeLessThanOrEqual(local(2, 11).getTime());
    expect(blocksOf(out, "report")[0]!.start.getTime()).toBeGreaterThan(blocksOf(out, "memo")[0]!.end.getTime());
    expect(out.atRisk).toEqual([]);
  });

  it("falls back to earliest deadline first when score order would miss a deadline", () => {
    const big = task({ id: "big", estimateMinutes: 90, dueDate: "2026-11-02", priority: 3 });
    const tight = task({ id: "tight", estimateMinutes: 90, dueDate: "2026-11-02", dueTime: "11:00", priority: 0 });
    const out = run([big, tight]);
    expect(hm(blocksOf(out, "tight")[0]!.start)).toBe("09:00");
    expect(out.atRisk).toEqual([]);
    expect(out.placements.map((p) => p.taskId)).toEqual(["tight", "big"]);
  });

  it("reports a task at risk when it cannot finish before its deadline and still places it as early as possible", () => {
    const busy = [{ start: iso(2, 9), end: iso(2, 9, 45) }];
    const out = run([task({ id: "late", dueDate: "2026-11-02", dueTime: "10:00" })], { busy });
    const [b] = blocksOf(out, "late");
    expect(hm(b!.start)).toBe("10:00");
    expect(out.atRisk).toHaveLength(1);
    expect(out.atRisk[0]!.taskId).toBe("late");
    expect(new Date(out.atRisk[0]!.deadline).getTime()).toBe(local(2, 10).getTime());
    expect(new Date(out.atRisk[0]!.finishesAt).getTime()).toBe(b!.end.getTime());
  });

  it("treats a deadline without a time as the end of that day", () => {
    const out = run([task({ id: "a", dueDate: "2026-11-02" })], { now: local(2, 16, 30) });
    const [b] = blocksOf(out, "a");
    expect(hm(b!.start)).toBe("16:30");
    expect(out.atRisk).toEqual([]);
  });

  it("respects locked blocks: keeps them, counts them as busy and never removes them", () => {
    const pinned = task({ id: "pinned", estimateMinutes: 60, existingBlocks: [{ id: "lock1", start: iso(2, 9), end: iso(2, 10), locked: true }] });
    const other = task({ id: "other", estimateMinutes: 60 });
    const out = run([other, pinned]);
    const pb = blocksOf(out, "pinned");
    expect(pb).toHaveLength(1);
    expect(pb[0]!.existingBlockId).toBe("lock1");
    expect(hm(pb[0]!.start)).toBe("09:00");
    const ob = blocksOf(out, "other")[0]!;
    expect(ob.start.getTime()).toBeGreaterThanOrEqual(local(2, 10, 10).getTime());
    expect(out.removedBlockIds).toEqual([]);
  });

  it("keeps a locked block even when it overlaps a meeting", () => {
    const pinned = task({ id: "pinned", existingBlocks: [{ id: "lock1", start: iso(2, 9), end: iso(2, 10), locked: true }] });
    const out = run([pinned], { busy: [{ start: iso(2, 9, 30), end: iso(2, 10, 30) }] });
    expect(blocksOf(out, "pinned").map((b) => b.existingBlockId)).toEqual(["lock1"]);
    expect(out.removedBlockIds).toEqual([]);
  });

  it("keeps an unlocked block that starts within the frozen window", () => {
    const soon = task({ id: "soon", existingBlocks: [{ id: "blk", start: iso(2, 9), end: iso(2, 10), locked: false }] });
    const now = local(2, 8, 30);
    expect(minutes(now, local(2, 9))).toBeLessThanOrEqual(FROZEN_WINDOW_MINUTES);
    const out = run([task({ id: "first", priority: 3, dueDate: "2026-11-02" }), soon], { now });
    const sb = blocksOf(out, "soon");
    expect(sb).toHaveLength(1);
    expect(sb[0]!.existingBlockId).toBe("blk");
    expect(hm(sb[0]!.start)).toBe("09:00");
    expect(blocksOf(out, "first")[0]!.start.getTime()).toBeGreaterThanOrEqual(local(2, 10, 10).getTime());
  });

  it("re-places a frozen block that no longer sits in free time", () => {
    const soon = task({ id: "soon", existingBlocks: [{ id: "blk", start: iso(2, 9), end: iso(2, 10), locked: false }] });
    const out = run([soon], { now: local(2, 8, 30), busy: [{ start: iso(2, 9, 15), end: iso(2, 9, 45) }] });
    const sb = blocksOf(out, "soon");
    expect(sb).toHaveLength(1);
    expect(sb[0]!.existingBlockId).toBe("blk");
    expect(sb[0]!.start.getTime()).toBeGreaterThanOrEqual(local(2, 9, 55).getTime());
  });

  it("moves an existing block that is outside the frozen window and reuses its id", () => {
    const t = task({ id: "a", existingBlocks: [{ id: "old", start: iso(2, 15), end: iso(2, 16), locked: false }] });
    const out = run([t]);
    const bs = blocksOf(out, "a");
    expect(bs).toHaveLength(1);
    expect(bs[0]!.existingBlockId).toBe("old");
    expect(hm(bs[0]!.start)).toBe("09:00");
    expect(out.removedBlockIds).toEqual([]);
  });

  it("removes unlocked blocks that are no longer needed", () => {
    const t = task({
      id: "a",
      estimateMinutes: 60,
      existingBlocks: [
        { id: "lock1", start: iso(2, 14), end: iso(2, 15), locked: true },
        { id: "extra", start: iso(3, 9), end: iso(3, 10), locked: false },
      ],
    });
    const out = run([t]);
    expect(blocksOf(out, "a").map((b) => b.existingBlockId)).toEqual(["lock1"]);
    expect(out.removedBlockIds).toEqual(["extra"]);
    expect(out.unplaced).toEqual([]);
  });

  it("counts past blocks as time already spent", () => {
    const t = task({ id: "a", estimateMinutes: 90, existingBlocks: [{ id: "past", start: iso(2, 9), end: iso(2, 10), locked: false }] });
    const out = run([t], { now: local(2, 10, 30) });
    const bs = blocksOf(out, "a");
    expect(bs).toHaveLength(1);
    expect(bs[0]!.existingBlockId).toBeNull();
    expect(minutes(bs[0]!.start, bs[0]!.end)).toBe(30);
    expect(out.removedBlockIds).toEqual([]);
  });

  it("skips days whose weekday is null and respects the horizon", () => {
    const sunday = local(1, 8);
    const out = run([task({ id: "a" })], { now: sunday });
    const [b] = blocksOf(out, "a");
    expect(b!.start.getDay()).toBe(1);
    expect(hm(b!.start)).toBe("09:00");
    const none = run([task({ id: "a" })], { now: sunday, horizonDays: 1 });
    expect(none.placements).toEqual([]);
    expect(none.unplaced).toEqual([{ taskId: "a", reason: "No free time in the next 1 day" }]);
  });

  it("does not place beyond the horizon and reports partial fits", () => {
    const tasks = Array.from({ length: 8 }, (_, i) => task({ id: `t${i}`, estimateMinutes: 90 }));
    const out = run(tasks, { horizonDays: 1 });
    const dayEnd = local(2, 18).getTime();
    for (const p of out.placements) for (const b of p.blocks) expect(new Date(b.end).getTime()).toBeLessThanOrEqual(dayEnd);
    expect(out.unplaced.length).toBeGreaterThan(0);
    const partial = out.unplaced.find((u) => u.reason.startsWith("Only"));
    const none = out.unplaced.find((u) => u.reason.startsWith("No free time"));
    expect(partial ?? none).toBeDefined();
  });

  it("honours a not-before start date", () => {
    const out = run([task({ id: "later", startDate: "2026-11-04" })]);
    const [b] = blocksOf(out, "later");
    expect(b!.start.getTime()).toBe(local(4, 9).getTime());
  });

  it("is deterministic", () => {
    const input: ScheduleInput = {
      candidates: [task({ id: "b", priority: 2 }), task({ id: "a", dueDate: "2026-11-03", estimateMinutes: 150 }), task({ id: "c", estimateMinutes: 20 })],
      busy: [{ start: iso(2, 10), end: iso(2, 11) }],
      prefs,
      now: MONDAY_8,
      horizonDays: 7,
    };
    expect(scheduleTasks(input)).toEqual(scheduleTasks(input));
  });
});
