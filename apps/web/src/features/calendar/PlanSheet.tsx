import { useState } from "react";
import type { SchedulerResult } from "@aravos/shared";
import { api } from "@/lib/api";
import { fmtRelativeDate, fmtTimeRange } from "@/lib/format";
import { useInvalidate } from "@/data/queries";
import { Sheet } from "@/ui/Sheet";
import { Group, Row, Section } from "@/ui/List";
import { toast } from "@/ui/Toast";
import { notify } from "@/lib/haptics";

/** Runs the planner and shows what it placed. Returns the trigger and the sheet element. */
export function usePlanner() {
  const [result, setResult] = useState<SchedulerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidate();
  const run = async (taskIds?: string[]) => {
    if (busy) return null;
    setBusy(true);
    try {
      const r = await api.post<SchedulerResult>("/api/scheduler/run", taskIds ? { taskIds } : {});
      invalidate(["events", "tasks", "summary"]);
      if (taskIds) {
        const block = r.placed[0]?.blocks[0];
        toast(block ? `Planned for ${fmtRelativeDate(block.start)} ${fmtTimeRange(block.start, block.end)}.` : (r.unplaced[0]?.reason ?? r.summary));
      } else {
        setResult(r);
      }
      return r;
    } catch (e) {
      void notify("error");
      toast(e instanceof Error ? e.message : "Unable to plan");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const sheet = (
    <Sheet open={Boolean(result)} onClose={() => setResult(null)} title="Plan" leading={null} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11" onClick={() => setResult(null)}>Done</button>}>
      {result && (
        <div className="pt-1 pb-4">
          <p className="text-callout text-primary">{result.summary}</p>
          {result.placed.length > 0 && (
            <Section title="Placed" className="mt-5">
              <Group inset={false}>
                {result.placed.flatMap((p) => p.blocks.map((b, i) => <Row key={`${p.taskId}-${i}`} title={p.title} subtitle={`${fmtRelativeDate(b.start)} ${fmtTimeRange(b.start, b.end)}`} />))}
              </Group>
            </Section>
          )}
          {result.unplaced.length > 0 && (
            <Section title="Not placed" className="mt-5">
              <Group inset={false}>
                {result.unplaced.map((u) => (
                  <Row key={u.taskId} title={u.title} subtitle={u.reason} />
                ))}
              </Group>
            </Section>
          )}
          {result.placed.length === 0 && result.unplaced.length === 0 && <p className="text-footnote text-secondary mt-3">Nothing to plan. Tasks need a date within the horizon or an existing time box.</p>}
        </div>
      )}
    </Sheet>
  );
  return { run, busy, sheet };
}
