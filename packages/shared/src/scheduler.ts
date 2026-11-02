// Pure time-boxing engine. No database, no clock: everything it needs is in the input.
// Times inside the engine are minutes since the epoch; local work hours come from the
// process timezone, like every other date helper in this package.
import { hhmmToMinutes, parseDateString } from "./dates.ts";
import type { SchedulerPrefs } from "./schemas.ts";

export interface ScheduleExistingBlock {
  id: string;
  start: string;
  end: string;
  /** User pinned: never moved or removed, always counts as busy. */
  locked: boolean;
}

export interface ScheduleCandidate {
  id: string;
  title: string;
  /** Minutes of work still estimated for the whole task, already calibrated. */
  estimateMinutes: number;
  dueDate: string | null;
  dueTime: string | null;
  /** Not-before date (YYYY-MM-DD). */
  startDate: string | null;
  /** 0 none, 1 low, 2 medium, 3 high. */
  priority: number;
  createdAt: string;
  existingBlocks: ScheduleExistingBlock[];
}

export interface ScheduleBusyInterval {
  start: string;
  end: string;
}

export interface ScheduleInput {
  candidates: ScheduleCandidate[];
  busy: ScheduleBusyInterval[];
  prefs: SchedulerPrefs;
  now: Date;
  horizonDays: number;
}

export interface SchedulePlacedBlock {
  /** Set when an existing block is kept or moved in place; null for a new block. */
  existingBlockId: string | null;
  start: string;
  end: string;
}

export interface SchedulePlacement {
  taskId: string;
  blocks: SchedulePlacedBlock[];
}

export interface ScheduleUnplaced {
  taskId: string;
  reason: string;
}

export interface ScheduleAtRisk {
  taskId: string;
  deadline: string;
  finishesAt: string;
}

export interface ScheduleOutput {
  placements: SchedulePlacement[];
  /** Unlocked existing blocks that are no longer needed. */
  removedBlockIds: string[];
  unplaced: ScheduleUnplaced[];
  atRisk: ScheduleAtRisk[];
}

/** Unlocked blocks starting within this many minutes are kept where they are. */
export const FROZEN_WINDOW_MINUTES = 60;

const PRIORITY_WEIGHT = [0.2, 0.4, 0.7, 1.0] as const;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const HOURS_PER_WEEK = 168;
const AGE_SATURATION_DAYS = 14;

interface Interval {
  start: number;
  end: number;
}

interface Slot extends Interval {
  /** Local midnight of the slot's day, the origin of the snap grid. */
  day: number;
}

interface Grid {
  snap: number;
  buffer: number;
  minBlock: number;
  maxBlock: number;
}

interface Prepared {
  task: ScheduleCandidate;
  remaining: number;
  startFloor: number;
  deadline: number | null;
  kept: SchedulePlacedBlock[];
  keptEnd: number | null;
  reusable: ScheduleExistingBlock[];
  score: number;
}

interface Simulation {
  blocks: Map<string, Interval[]>;
  lateTasks: number;
  lateMinutes: number;
}

interface KeptBlocks {
  blocks: SchedulePlacedBlock[];
  end: number | null;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const minutesOf = (d: Date): number => Math.floor(d.getTime() / 60000);
const toIso = (m: number): string => new Date(m * 60000).toISOString();
const snapUp = (t: number, origin: number, snap: number): number => origin + Math.ceil((t - origin) / snap) * snap;
const snapDown = (t: number, origin: number, snap: number): number => origin + Math.floor((t - origin) / snap) * snap;
const midnight = (d: Date, offsetDays = 0): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays);
const localAt = (day: Date, minutesIntoDay: number): number => minutesOf(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutesIntoDay));

function isoInterval(start: string, end: string): Interval | null {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  return { start: Math.floor(s / 60000), end: Math.ceil(e / 60000) };
}

function gridOf(prefs: SchedulerPrefs): Grid {
  const snap = Math.max(1, prefs.snapMinutes);
  const maxBlock = Math.max(snap, Math.floor(prefs.maxBlockMinutes / snap) * snap);
  return { snap, buffer: Math.max(0, prefs.bufferMinutes), minBlock: Math.min(prefs.minBlockMinutes, maxBlock), maxBlock };
}

function subtract(slots: Slot[], cut: Interval): Slot[] {
  const out: Slot[] = [];
  for (const s of slots) {
    if (cut.end <= s.start || cut.start >= s.end) {
      out.push(s);
      continue;
    }
    if (cut.start > s.start) out.push({ ...s, end: cut.start });
    if (cut.end < s.end) out.push({ ...s, start: cut.end });
  }
  return out;
}

function snapSlots(slots: Slot[], snap: number): Slot[] {
  return slots.map((s) => ({ ...s, start: snapUp(s.start, s.day, snap), end: snapDown(s.end, s.day, snap) })).filter((s) => s.end - s.start >= snap);
}

function cutWithBuffer(slots: Slot[], iv: Interval, grid: Grid): Slot[] {
  return snapSlots(subtract(slots, { start: iv.start - grid.buffer, end: iv.end + grid.buffer }), grid.snap);
}

/** Work hours minus lunch for every day of the horizon whose weekday is enabled. */
function dayWindows(now: Date, prefs: SchedulerPrefs, horizonDays: number): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const d = midnight(now, i);
    const key = WEEKDAYS[d.getDay()];
    const hours = key ? prefs.workHours[key] : null;
    if (!hours) continue;
    const day = minutesOf(d);
    let pieces: Slot[] = [{ start: localAt(d, hhmmToMinutes(hours.start)), end: localAt(d, hhmmToMinutes(hours.end)), day }];
    if (prefs.lunch) pieces = subtract(pieces, { start: localAt(d, hhmmToMinutes(prefs.lunch.start)), end: localAt(d, hhmmToMinutes(prefs.lunch.end)) });
    out.push(...pieces.filter((p) => p.end > p.start));
  }
  return out;
}

function deadlineOf(task: ScheduleCandidate): number | null {
  if (!task.dueDate) return null;
  const day = parseDateString(task.dueDate);
  if (Number.isNaN(day.getTime())) return null;
  const atTime = task.dueTime ? hhmmToMinutes(task.dueTime) : NaN;
  if (!Number.isNaN(atTime)) return localAt(day, atTime);
  return minutesOf(midnight(day, 1));
}

function startFloorOf(task: ScheduleCandidate, floor: number): number {
  if (!task.startDate) return floor;
  const day = parseDateString(task.startDate);
  if (Number.isNaN(day.getTime())) return floor;
  return Math.max(floor, minutesOf(day));
}

function insideFree(block: Interval, windows: Slot[], busy: Interval[]): boolean {
  const inWindow = windows.some((w) => w.start <= block.start && block.end <= w.end);
  return inWindow && !busy.some((b) => b.start < block.end && b.end > block.start);
}

function scoreOf(task: ScheduleCandidate, remaining: number, deadline: number | null, now: Date): number {
  const nowMin = minutesOf(now);
  const slackHours = deadline === null ? null : (deadline - nowMin - remaining) / 60;
  const urgency = slackHours === null ? 0.15 : clamp(1 - slackHours / HOURS_PER_WEEK, 0, 1);
  const priority = PRIORITY_WEIGHT[clamp(Math.round(task.priority), 0, 3)] ?? 0.2;
  const created = Date.parse(task.createdAt);
  const age = Number.isNaN(created) ? 0 : clamp((now.getTime() - created) / 86400000 / AGE_SATURATION_DAYS, 0, 1);
  const sizeBias = remaining > 0 && remaining <= 30 ? 0.05 : 0;
  return 0.55 * urgency + 0.3 * priority + 0.1 * age + sizeBias;
}

const byScore = (a: Prepared, b: Prepared): number => b.score - a.score || a.task.createdAt.localeCompare(b.task.createdAt) || a.task.id.localeCompare(b.task.id);
const byDeadline = (a: Prepared, b: Prepared): number => (a.deadline ?? 0) - (b.deadline ?? 0) || byScore(a, b);

interface Prepass {
  prepared: Prepared[];
  slots: Slot[];
}

/**
 * Decide what stays untouched before any placement: locked blocks, blocks in the frozen
 * window that still sit in free time, and past blocks (which count as time already spent).
 */
function prepare(input: ScheduleInput, grid: Grid, floor: number, windows: Slot[]): Prepass {
  const nowMin = minutesOf(input.now);
  const busy: Interval[] = input.busy.map((b) => isoInterval(b.start, b.end)).filter((b): b is Interval => b !== null);
  let slots = snapSlots(
    windows.map((w) => ({ ...w, start: Math.max(w.start, floor) })).filter((w) => w.end > w.start),
    grid.snap,
  );
  for (const b of busy) slots = cutWithBuffer(slots, b, grid);

  const keptMinutes = new Map<string, number>();
  const kept = new Map<string, KeptBlocks>();
  const addKept = (task: ScheduleCandidate, block: ScheduleExistingBlock, iv: Interval, future: boolean) => {
    keptMinutes.set(task.id, (keptMinutes.get(task.id) ?? 0) + (iv.end - iv.start));
    if (!future) return;
    const list = kept.get(task.id) ?? { blocks: [], end: null };
    list.blocks.push({ existingBlockId: block.id, start: block.start, end: block.end });
    list.end = Math.max(list.end ?? iv.end, iv.end);
    kept.set(task.id, list);
    busy.push(iv);
    slots = cutWithBuffer(slots, iv, grid);
  };

  const pending: { task: ScheduleCandidate; block: ScheduleExistingBlock; iv: Interval }[] = [];
  for (const task of input.candidates) {
    for (const block of task.existingBlocks) {
      const iv = isoInterval(block.start, block.end);
      if (!iv) continue;
      if (block.locked) addKept(task, block, iv, iv.end > nowMin);
      else pending.push({ task, block, iv });
    }
  }
  const reusable = new Map<string, ScheduleExistingBlock[]>();
  for (const { task, block, iv } of pending) {
    if (iv.end <= nowMin) {
      addKept(task, block, iv, false);
      continue;
    }
    const frozen = iv.start - nowMin <= FROZEN_WINDOW_MINUTES && insideFree(iv, windows, busy);
    if (frozen) addKept(task, block, iv, true);
    else reusable.set(task.id, [...(reusable.get(task.id) ?? []), block]);
  }

  const prepared = input.candidates.map((task): Prepared => {
    const estimate = Math.max(grid.snap, snapUp(Math.max(0, task.estimateMinutes), 0, grid.snap));
    const remaining = snapUp(Math.max(0, estimate - (keptMinutes.get(task.id) ?? 0)), 0, grid.snap);
    const deadline = deadlineOf(task);
    const k = kept.get(task.id);
    return {
      task,
      remaining,
      startFloor: startFloorOf(task, floor),
      deadline,
      kept: k?.blocks ?? [],
      keptEnd: k?.end ?? null,
      reusable: (reusable.get(task.id) ?? []).sort((a, b) => a.start.localeCompare(b.start)),
      score: scoreOf(task, remaining, deadline, input.now),
    };
  });
  return { prepared, slots };
}

/** Largest chunk that fits, never leaving a remainder shorter than the minimum block. */
function chunkSize(remaining: number, avail: number, grid: Grid): number {
  let take = Math.min(remaining, grid.maxBlock, avail);
  if (take < remaining && remaining - take < grid.minBlock) take = snapDown(remaining - grid.minBlock, 0, grid.snap);
  if (take < remaining && take < grid.minBlock) return 0;
  return Math.max(0, take);
}

/** A later slot on the same day that holds the whole remainder without crossing the deadline. */
function wholeFitSameDay(p: Prepared, slots: Slot[], from: number, day: number, remaining: number, grid: Grid): Interval | null {
  for (let j = from; j < slots.length && slots[j]!.day === day; j++) {
    const s = slots[j]!;
    const start = Math.max(s.start, snapUp(p.startFloor, s.day, grid.snap));
    if (s.end - start < remaining) continue;
    if (p.deadline !== null && start + remaining > p.deadline) return null;
    return { start, end: start + remaining };
  }
  return null;
}

/** Earliest fit; a task that would be split but fits whole later the same day takes the later slot. */
function firstFit(p: Prepared, slots: Slot[], remaining: number, grid: Grid): Interval | null {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    const start = Math.max(s.start, snapUp(p.startFloor, s.day, grid.snap));
    const avail = s.end - start;
    if (avail < grid.snap) continue;
    const take = chunkSize(remaining, avail, grid);
    if (take <= 0) continue;
    if (take < remaining && remaining <= grid.maxBlock) {
      const whole = wholeFitSameDay(p, slots, i + 1, s.day, remaining, grid);
      if (whole) return whole;
    }
    return { start, end: start + take };
  }
  return null;
}

function placeTask(p: Prepared, slots: Slot[], grid: Grid): { blocks: Interval[]; slots: Slot[] } {
  const blocks: Interval[] = [];
  let remaining = p.remaining;
  let free = slots;
  while (remaining > 0) {
    const pick = firstFit(p, free, remaining, grid);
    if (!pick) break;
    blocks.push(pick);
    remaining -= pick.end - pick.start;
    free = cutWithBuffer(free, pick, grid);
  }
  return { blocks, slots: free };
}

function finishOf(p: Prepared, blocks: Interval[]): number | null {
  let end = p.keptEnd;
  for (const b of blocks) end = Math.max(end ?? b.end, b.end);
  return end;
}

function simulate(order: Prepared[], base: Slot[], grid: Grid): Simulation {
  const blocks = new Map<string, Interval[]>();
  let slots = base;
  let lateTasks = 0;
  let lateMinutes = 0;
  for (const p of order) {
    const r = placeTask(p, slots, grid);
    slots = r.slots;
    blocks.set(p.task.id, r.blocks);
    const finish = finishOf(p, r.blocks);
    if (p.deadline !== null && finish !== null && finish > p.deadline) {
      lateTasks += 1;
      lateMinutes += finish - p.deadline;
    }
  }
  return { blocks, lateTasks, lateMinutes };
}

/**
 * Score order first. When that leaves a deadline unmet, try earliest-deadline-first for the
 * dated tasks (then score order for the rest) and keep whichever misses fewer deadlines.
 */
function chooseOrder(prepared: Prepared[], slots: Slot[], grid: Grid): { order: Prepared[]; sim: Simulation } {
  const scoreOrder = [...prepared].sort(byScore);
  const sim = simulate(scoreOrder, slots, grid);
  if (sim.lateTasks === 0) return { order: scoreOrder, sim };
  const dated = prepared.filter((p) => p.deadline !== null).sort(byDeadline);
  const undated = prepared.filter((p) => p.deadline === null).sort(byScore);
  const edfOrder = [...dated, ...undated];
  const edf = simulate(edfOrder, slots, grid);
  const better = edf.lateTasks < sim.lateTasks || (edf.lateTasks === sim.lateTasks && edf.lateMinutes < sim.lateMinutes);
  return better ? { order: edfOrder, sim: edf } : { order: scoreOrder, sim };
}

/** Reuse existing unlocked blocks: identical times first, then any leftover block is moved in place. */
function matchExisting(fresh: Interval[], reusable: ScheduleExistingBlock[]): { blocks: SchedulePlacedBlock[]; removed: string[] } {
  const unused = new Map(reusable.map((b) => [b.id, b]));
  const keyOf = (iv: Interval) => `${iv.start}|${iv.end}`;
  const exact = new Map<string, string>();
  for (const b of reusable) {
    const iv = isoInterval(b.start, b.end);
    if (iv && !exact.has(keyOf(iv))) exact.set(keyOf(iv), b.id);
  }
  const blocks: (SchedulePlacedBlock | null)[] = fresh.map((iv) => {
    const id = exact.get(keyOf(iv));
    if (id === undefined || !unused.has(id)) return null;
    unused.delete(id);
    return { existingBlockId: id, start: toIso(iv.start), end: toIso(iv.end) };
  });
  const result = blocks.map((b, i) => {
    if (b) return b;
    const iv = fresh[i]!;
    const next = unused.keys().next();
    const id = next.done ? null : next.value;
    if (id !== null) unused.delete(id);
    return { existingBlockId: id, start: toIso(iv.start), end: toIso(iv.end) };
  });
  return { blocks: result, removed: [...unused.keys()] };
}

function unplacedReason(p: Prepared, placedMinutes: number, horizonDays: number, hasBlocks: boolean): string | null {
  const days = `${horizonDays} day${horizonDays === 1 ? "" : "s"}`;
  if (p.remaining > placedMinutes) {
    if (placedMinutes === 0) return `No free time in the next ${days}`;
    return `Only ${placedMinutes} of ${p.remaining} minutes fit in the next ${days}`;
  }
  if (p.remaining === 0 && !hasBlocks) return "Earlier time boxes already cover the estimate";
  return null;
}

export function scheduleTasks(input: ScheduleInput): ScheduleOutput {
  const grid = gridOf(input.prefs);
  const horizonDays = Math.max(1, Math.floor(input.horizonDays));
  const todayStart = minutesOf(midnight(input.now));
  const floor = snapUp(minutesOf(input.now), todayStart, grid.snap);
  const windows = dayWindows(input.now, input.prefs, horizonDays);
  const { prepared, slots } = prepare(input, grid, floor, windows);
  const { order, sim } = chooseOrder(prepared, slots, grid);

  const out: ScheduleOutput = { placements: [], removedBlockIds: [], unplaced: [], atRisk: [] };
  for (const p of order) {
    const fresh = sim.blocks.get(p.task.id) ?? [];
    const { blocks, removed } = matchExisting(fresh, p.reusable);
    const all = [...p.kept, ...blocks].sort((a, b) => a.start.localeCompare(b.start));
    if (all.length) out.placements.push({ taskId: p.task.id, blocks: all });
    out.removedBlockIds.push(...removed);
    const placedMinutes = fresh.reduce((sum, b) => sum + (b.end - b.start), 0);
    const reason = unplacedReason(p, placedMinutes, horizonDays, all.length > 0);
    if (reason) out.unplaced.push({ taskId: p.task.id, reason });
    const finish = finishOf(p, fresh);
    if (p.deadline !== null && finish !== null && finish > p.deadline) out.atRisk.push({ taskId: p.task.id, deadline: toIso(p.deadline), finishesAt: toIso(finish) });
  }
  return out;
}
