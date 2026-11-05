import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { Switch } from "@/ui/Field";
import { selection } from "@/lib/haptics";
import { useWorkoutSettings } from "./api";
import { fmtSeconds } from "./lib";
import { useRestRemaining, useRestTimer } from "./store";

const QUICK = [60, 90, 120, 180];

/**
 * Speed-gauge style dial: an open 240° arc of thin radial ticks (every fifth one longer).
 * Ticks up to `progress` are lit in a soft accent ramp; the rest stay faint. The countdown sits in the middle.
 */
function TickDial({ progress, size = 232, ticks = 64, label, children }: { progress: number; size?: number; ticks?: number; label: string; children: React.ReactNode }) {
  const sweep = 240;
  const start = 90 + (360 - sweep) / 2; // gap centered at the bottom
  const c = size / 2;
  const rOuter = c - 6;
  const p = Math.min(1, Math.max(0, progress));
  const lit = Math.round(p * (ticks - 1));
  const pt = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return [c + r * Math.cos(rad), c + r * Math.sin(rad)] as const;
  };
  const markerDeg = start + (lit / (ticks - 1)) * sweep;
  const [mx, my] = pt(markerDeg, rOuter + 1);
  return (
    <div className="relative" style={{ width: size, height: size * 0.86 }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute top-0 left-0" aria-hidden="true">
        {Array.from({ length: ticks }).map((_, i) => {
          const deg = start + (i / (ticks - 1)) * sweep;
          const major = i % 8 === 0 || i === ticks - 1;
          const len = major ? 18 : 11;
          const [x0, y0] = pt(deg, rOuter - len);
          const [x1, y1] = pt(deg, rOuter);
          const on = p > 0 && i <= lit;
          const t = i / (ticks - 1);
          return (
            <line
              key={i}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              className="wk-tick"
              stroke={on ? `color-mix(in oklab, var(--accent) ${Math.round(40 + t * 60)}%, var(--accent-2))` : "var(--text-quaternary)"}
              strokeOpacity={on ? 1 : major ? 0.7 : 0.45}
              strokeWidth={major ? 2 : 1.4}
              strokeLinecap="round"
            />
          );
        })}
        {p > 0 && <circle cx={mx} cy={my} r={3.5} fill="var(--accent)" stroke="var(--glass-fill-strong)" strokeWidth={2} style={{ transition: "cx 260ms var(--ease-out), cy 260ms var(--ease-out)" }} />}
      </svg>
      <div className="absolute inset-x-0 flex flex-col items-center text-center" style={{ top: size * 0.3 }}>{children}</div>
    </div>
  );
}

/** Rest timer sheet: tick dial countdown, -step / +step / Skip, next-set hint, sound toggle. */
export function RestTimerSheet() {
  const open = useRestTimer((s) => s.sheetOpen);
  const setOpen = useRestTimer((s) => s.setSheetOpen);
  const endsAt = useRestTimer((s) => s.endsAt);
  const total = useRestTimer((s) => s.total);
  const hint = useRestTimer((s) => s.hint);
  const muted = useRestTimer((s) => s.muted);
  const setMuted = useRestTimer((s) => s.setMuted);
  const adjust = useRestTimer((s) => s.adjust);
  const skip = useRestTimer((s) => s.skip);
  const start = useRestTimer((s) => s.start);
  const remaining = useRestRemaining();
  const settings = useWorkoutSettings();
  const step = settings.data?.timerIncrementSeconds ?? 10;
  const running = Boolean(endsAt);
  const progress = running && total > 0 ? remaining / total : 0;

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Rest Timer" leading={null} trailing={<button type="button" className="text-headline text-accent-text px-3 h-11" onClick={() => setOpen(false)}>Done</button>} detent="auto">
      <div className="flex flex-col items-center pt-1">
        <TickDial progress={progress} label={running ? `Rest, ${fmtSeconds(remaining)} left` : "Rest timer idle"}>
          <span className="text-[12px] text-tertiary">{running ? "Rest" : "Idle"}</span>
          <span className="num text-primary tabular" style={{ fontSize: 60, lineHeight: "64px", fontWeight: 200 }} data-testid="rest-remaining">{running ? fmtSeconds(remaining) : fmtSeconds(0)}</span>
          <span className="text-[13px] text-tertiary tabular mt-0.5">{running ? `of ${fmtSeconds(total)}` : "Starts after each set"}</span>
        </TickDial>
        {running ? (
          <>
            <p className="text-[14px] text-secondary -mt-1 text-center min-h-5">{hint ?? ""}</p>
            <div className="flex gap-2 mt-5 w-full">
              <Button variant="secondary" className="flex-1 tabular" onClick={() => { adjust(-step); void selection(); }}>{`-${step}s`}</Button>
              <Button variant="secondary" className="flex-1 tabular" onClick={() => { adjust(step); void selection(); }}>{`+${step}s`}</Button>
              <Button variant="primary" className="flex-1" onClick={() => skip()}>Skip</Button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-4 gap-2 mt-4 w-full">
            {QUICK.map((s) => (
              <Button key={s} variant="secondary" className="tabular !px-0" onClick={() => start(s)}>{fmtSeconds(s)}</Button>
            ))}
          </div>
        )}
      </div>
      <div className="well rounded-[16px] mt-5 mb-1 h-[52px] px-4 flex items-center justify-between">
        <span className="text-[15px] text-primary">Sound</span>
        <Switch checked={!muted} onChange={(v) => setMuted(!v)} label="Sound" />
      </div>
    </Sheet>
  );
}
