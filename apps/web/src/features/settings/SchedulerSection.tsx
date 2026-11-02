import { useEffect, useState } from "react";
import type { SchedulerPrefs } from "@aravos/shared";
import { Section, Group, Row, ValueRow, Footnote } from "@/ui/List";
import { FieldRow, Switch } from "@/ui/Field";
import { Sheet } from "@/ui/Sheet";
import { fmtInt, fmtMinutes, fmtRelativeDate, fmtTime } from "@/lib/format";
import { useSchedulerStats, useUpdateScheduler } from "./api";
import { InlineInput, NumberSheet, SheetDone } from "./sheets";

type DayKey = keyof SchedulerPrefs["workHours"];
const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];
const SHORT: Record<DayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** "Mon to Fri 09:00 to 18:00, Sat 10:00 to 14:00" */
function workHoursSummary(wh: SchedulerPrefs["workHours"]): string {
  const runs: { from: DayKey; to: DayKey; text: string }[] = [];
  for (const d of DAYS) {
    const h = wh[d.key];
    if (!h) continue;
    const text = `${h.start} to ${h.end}`;
    const last = runs[runs.length - 1];
    const prevIdx = last ? DAYS.findIndex((x) => x.key === last.to) : -1;
    if (last && last.text === text && prevIdx === DAYS.findIndex((x) => x.key === d.key) - 1) last.to = d.key;
    else runs.push({ from: d.key, to: d.key, text });
  }
  if (!runs.length) return "None";
  return runs.map((r) => `${r.from === r.to ? SHORT[r.from] : `${SHORT[r.from]} to ${SHORT[r.to]}`} ${r.text}`).join(", ");
}

export function SchedulerSection({ prefs, hour12 }: { prefs: SchedulerPrefs; hour12: boolean }) {
  const update = useUpdateScheduler();
  const stats = useSchedulerStats();
  const [sheet, setSheet] = useState<"hours" | "lunch" | "buffer" | "min" | "max" | "estimate" | "horizon" | null>(null);
  const close = () => setSheet(null);
  const f = stats.data?.calibrationFactor;

  return (
    <>
      <Section title="Scheduler" footer="Auto-plan places open tasks into free work hours ahead of their due dates.">
        <Group>
          <FieldRow label="Auto-plan">
            <Switch checked={prefs.autoRun} onChange={(v) => update.mutate({ autoRun: v })} label="Auto-plan" />
          </FieldRow>
          <Row title="Work hours" subtitle={<span className="tabular">{workHoursSummary(prefs.workHours)}</span>} chevron onPress={() => setSheet("hours")} />
          <ValueRow title="Lunch" value={prefs.lunch ? `${prefs.lunch.start} to ${prefs.lunch.end}` : "None"} chevron onPress={() => setSheet("lunch")} />
          <ValueRow title="Buffer" value={`${fmtInt(prefs.bufferMinutes)} min`} chevron onPress={() => setSheet("buffer")} />
          <ValueRow title="Shortest block" value={fmtMinutes(prefs.minBlockMinutes)} chevron onPress={() => setSheet("min")} />
          <ValueRow title="Longest block" value={fmtMinutes(prefs.maxBlockMinutes)} chevron onPress={() => setSheet("max")} />
          <ValueRow title="Default estimate" value={fmtMinutes(prefs.defaultEstimateMinutes)} chevron onPress={() => setSheet("estimate")} />
          <ValueRow title="Horizon" value={`${fmtInt(prefs.horizonDays)} ${prefs.horizonDays === 1 ? "day" : "days"}`} chevron onPress={() => setSheet("horizon")} />
        </Group>
      </Section>

      <Section title="Estimates">
        <Group>
          <ValueRow title="Completed with times" value={stats.isLoading ? "" : stats.data ? fmtInt(stats.data.historyCount) : "Unavailable"} />
          <ValueRow title="Calibration" value={f != null ? `${f.toFixed(2)}x` : stats.isLoading ? "" : "Unavailable"} />
          {stats.data?.lastRun && <ValueRow title="Last run" value={`${fmtRelativeDate(stats.data.lastRun.ranAt)} ${fmtTime(stats.data.lastRun.ranAt, hour12)}`} subtitle={stats.data.lastRun.summary} />}
        </Group>
        {stats.data && (
          <Footnote>
            {stats.data.historyCount === 0 ? "Finish tasks with a time logged and estimates calibrate on their own." : `Tasks take about ${f!.toFixed(1)}x the estimate.`}
            {stats.data.meanAbsErrorMinutes != null ? ` Estimates are off by ${fmtMinutes(stats.data.meanAbsErrorMinutes)} on average.` : ""}
          </Footnote>
        )}
      </Section>

      <WorkHoursSheet open={sheet === "hours"} onClose={close} value={prefs.workHours} onSave={(workHours) => update.mutate({ workHours })} />
      <LunchSheet open={sheet === "lunch"} onClose={close} value={prefs.lunch} onSave={(lunch) => update.mutate({ lunch })} />
      <NumberSheet open={sheet === "buffer"} onClose={close} title="Buffer" value={prefs.bufferMinutes} step={5} min={0} max={60} unit="min" onSave={(v) => update.mutate({ bufferMinutes: v })} hint="Free time kept between blocks." />
      <NumberSheet open={sheet === "min"} onClose={close} title="Shortest Block" value={prefs.minBlockMinutes} step={5} min={5} max={240} unit="min" onSave={(v) => update.mutate({ minBlockMinutes: v })} />
      <NumberSheet open={sheet === "max"} onClose={close} title="Longest Block" value={prefs.maxBlockMinutes} step={5} min={15} max={480} unit="min" onSave={(v) => update.mutate({ maxBlockMinutes: v })} hint="Longer tasks are split into several blocks." />
      <NumberSheet open={sheet === "estimate"} onClose={close} title="Default Estimate" value={prefs.defaultEstimateMinutes} step={5} min={5} max={480} unit="min" onSave={(v) => update.mutate({ defaultEstimateMinutes: v })} hint="Used for tasks without an estimate." />
      <NumberSheet open={sheet === "horizon"} onClose={close} title="Horizon" value={prefs.horizonDays} step={1} min={1} max={30} unit="days" onSave={(v) => update.mutate({ horizonDays: v })} hint="How far ahead tasks are planned." />
    </>
  );
}

function WorkHoursSheet({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: SchedulerPrefs["workHours"]; onSave: (v: SchedulerPrefs["workHours"]) => void }) {
  const [wh, setWh] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setWh(value);
      setError(null);
    }
  }, [open, value]);
  const set = (k: DayKey, h: { start: string; end: string } | null) => setWh((p) => ({ ...p, [k]: h }));
  const save = () => {
    const bad = DAYS.find((d) => wh[d.key] && wh[d.key]!.start >= wh[d.key]!.end);
    if (bad) return setError(`Choose an end after the start on ${bad.label}`);
    onSave(wh);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Work Hours" detent="large" dirty={JSON.stringify(wh) !== JSON.stringify(value)} trailing={<SheetDone onClick={save} />}>
      <div className="pt-1 pb-2">
        <div className="rounded-md overflow-hidden group-rows bg-surface-2">
          {DAYS.map((d) => {
            const h = wh[d.key];
            return (
              <div key={d.key} className="row-sep relative flex flex-col justify-center gap-2 py-2 pl-4 pr-3 min-h-[52px]">
                <div className="flex items-center justify-between gap-3 min-h-[36px]">
                  <span className="text-body text-primary">{d.label}</span>
                  <Switch checked={Boolean(h)} onChange={(v) => set(d.key, v ? { start: "09:00", end: "18:00" } : null)} label={`${d.label} work day`} />
                </div>
                {h && (
                  <div className="flex items-center gap-2 tabular pb-1">
                    <InlineInput type="time" value={h.start} onChange={(e) => set(d.key, { ...h, start: e.target.value })} aria-label={`${d.label} start`} className="bg-surface w-[128px]" />
                    <span className="text-footnote text-secondary">to</span>
                    <InlineInput type="time" value={h.end} onChange={(e) => set(d.key, { ...h, end: e.target.value })} aria-label={`${d.label} end`} className="bg-surface w-[128px]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {error && <p className="text-footnote text-danger-text pt-3 px-1">{error}</p>}
      </div>
    </Sheet>
  );
}

function LunchSheet({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: SchedulerPrefs["lunch"]; onSave: (v: SchedulerPrefs["lunch"]) => void }) {
  const [lunch, setLunch] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setLunch(value);
      setError(null);
    }
  }, [open, value]);
  const save = () => {
    if (lunch && lunch.start >= lunch.end) return setError("Choose an end after the start");
    onSave(lunch);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Lunch" trailing={<SheetDone onClick={save} />}>
      <div className="pt-1 pb-4">
        <div className="rounded-md overflow-hidden group-rows bg-surface-2">
          <div className="row-sep relative flex items-center justify-between gap-3 min-h-[44px] pl-4 pr-3">
            <span className="text-body">Lunch break</span>
            <Switch checked={Boolean(lunch)} onChange={(v) => setLunch(v ? { start: "12:30", end: "13:15" } : null)} label="Lunch break" />
          </div>
          {lunch && (
            <div className="row-sep relative flex items-center gap-2 min-h-[52px] pl-4 pr-3 tabular">
              <InlineInput type="time" value={lunch.start} onChange={(e) => setLunch({ ...lunch, start: e.target.value })} aria-label="Lunch start" className="bg-surface w-[128px]" />
              <span className="text-footnote text-secondary">to</span>
              <InlineInput type="time" value={lunch.end} onChange={(e) => setLunch({ ...lunch, end: e.target.value })} aria-label="Lunch end" className="bg-surface w-[128px]" />
            </div>
          )}
        </div>
        <p className="text-footnote text-secondary pt-3 px-1">No tasks are planned during lunch.</p>
        {error && <p className="text-footnote text-danger-text pt-2 px-1">{error}</p>}
      </div>
    </Sheet>
  );
}
