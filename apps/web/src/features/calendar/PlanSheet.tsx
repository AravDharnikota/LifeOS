import { useState, type ReactNode } from "react";
import type { SchedulerResult } from "@aravos/shared";
import { api } from "@/lib/api";
import { fmtRelativeDate, fmtTimeRange } from "@/lib/format";
import { useInvalidate } from "@/data/queries";
import { Sheet } from "@/ui/Sheet";
import { BigNumber } from "@/ui/viz";
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
          <div className="well rounded-lg px-4 py-3.5 flex items-start gap-7">
            <div>
              <div className="text-[12px] text-tertiary mb-1">Placed</div>
              <BigNumber value={result.placed.length} unit={result.placed.length === 1 ? "task" : "tasks"} size={30} />
            </div>
            {result.unplaced.length > 0 && (
              <div>
                <div className="text-[12px] text-tertiary mb-1">Not placed</div>
                <BigNumber value={result.unplaced.length} size={30} />
              </div>
            )}
            {result.moved > 0 && (
              <div>
                <div className="text-[12px] text-tertiary mb-1">Moved</div>
                <BigNumber value={result.moved} size={30} />
              </div>
            )}
          </div>
          <p className="text-[14px] leading-5 text-secondary mt-3 px-1">{result.summary}</p>
          {result.placed.length > 0 && (
            <PlanGroup label="Placed">
              {result.placed.flatMap((p) =>
                p.blocks.map((b, i) => <PlanRow key={`${p.taskId}-${i}`} color="var(--cal-graphite)" title={p.title} sub={fmtRelativeDate(b.start)} trailing={fmtTimeRange(b.start, b.end)} />),
              )}
            </PlanGroup>
          )}
          {result.unplaced.length > 0 && (
            <PlanGroup label="Not placed">
              {result.unplaced.map((u) => (
                <PlanRow key={u.taskId} color="var(--warning)" title={u.title} sub={u.reason} />
              ))}
            </PlanGroup>
          )}
          {result.placed.length === 0 && result.unplaced.length === 0 && <p className="text-[13px] text-tertiary mt-3 px-1">Nothing to plan. Tasks need a date within the horizon or an existing time box.</p>}
        </div>
      )}
    </Sheet>
  );
  return { run, busy, sheet };
}

function PlanGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="text-[12px] text-tertiary px-1 mb-2">{label}</div>
      <div className="well rounded-lg overflow-hidden group-rows">{children}</div>
    </section>
  );
}

/** Color dot, title with a quiet sub line, and an optional time on the right. */
function PlanRow({ color, title, sub, trailing }: { color: string; title: string; sub?: string; trailing?: string }) {
  return (
    <div className="row-sep relative flex items-center gap-3 min-h-[56px] pl-[var(--gutter)] pr-[var(--gutter)] py-2">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="text-[15px] leading-5 text-primary truncate">{title}</div>
        {sub && <div className="text-[12px] leading-4 text-tertiary truncate-2 mt-0.5">{sub}</div>}
      </div>
      {trailing && <span className="shrink-0 text-[13px] text-secondary tabular">{trailing}</span>}
    </div>
  );
}
