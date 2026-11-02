import { Sheet } from "@/ui/Sheet";
import { Ring } from "@/ui/Ring";
import { Button } from "@/ui/Button";
import { Switch, FieldRow } from "@/ui/Field";
import { Group } from "@/ui/List";
import { selection } from "@/lib/haptics";
import { useWorkoutSettings } from "./api";
import { fmtSeconds } from "./lib";
import { useRestRemaining, useRestTimer } from "./store";

const QUICK = [60, 90, 120, 180];

/** Medium-detent sheet: large ring countdown, -10s / +10s / Skip, next-set hint, sound toggle. */
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
    <Sheet open={open} onClose={() => setOpen(false)} title="Rest Timer" leading={null} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={() => setOpen(false)}>Done</button>} detent="auto">
      <div className="flex flex-col items-center pt-2 pb-2">
        <Ring progress={progress} size={180} stroke={12} color="var(--accent)" label={running ? `Rest, ${fmtSeconds(remaining)} left` : "Rest timer idle"} animate={false}>
          <span className="num text-display-44 text-primary" data-testid="rest-remaining">{running ? fmtSeconds(remaining) : fmtSeconds(0)}</span>
          {running && <span className="text-footnote text-secondary mt-1 tabular">of {fmtSeconds(total)}</span>}
        </Ring>
        {running ? (
          <>
            {hint && <p className="text-subhead text-secondary mt-4 text-center">{hint}</p>}
            <div className="flex gap-3 mt-5 w-full">
              <Button variant="secondary" className="flex-1 tabular" onClick={() => { adjust(-step); void selection(); }}>{`-${step}s`}</Button>
              <Button variant="secondary" className="flex-1 tabular" onClick={() => { adjust(step); void selection(); }}>{`+${step}s`}</Button>
              <Button variant="secondary" className="flex-1" onClick={() => skip()}>Skip</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-subhead text-secondary mt-4 text-center">Starts after each completed set.</p>
            <div className="grid grid-cols-4 gap-2 mt-4 w-full">
              {QUICK.map((s) => (
                <Button key={s} variant="secondary" className="tabular" onClick={() => start(s)}>{fmtSeconds(s)}</Button>
              ))}
            </div>
          </>
        )}
      </div>
      <Group inset={false} className="mt-4">
        <FieldRow label="Sound">
          <Switch checked={!muted} onChange={(v) => setMuted(!v)} label="Sound" />
        </FieldRow>
      </Group>
    </Sheet>
  );
}
