import { useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import type { AgentThread } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { fmtRelativeDate, fmtTime } from "@/lib/format";
import { Menu } from "@/ui/Menu";
import { toast } from "@/ui/Toast";
import { ErrorLine, WorkingLine } from "./Spinner";
import { createThread, deleteThread, threadKeys, useThreads } from "./useAgent";

/** Threads as a terminal listing: `❯` marks the current one, `·` the rest, the time on the right. */
export function ThreadList({ current, onSelect }: { current: string | null; onSelect: (id: string | null) => void }) {
  const qc = useQueryClient();
  const threads = useThreads(true);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      const t = await createThread();
      await qc.invalidateQueries({ queryKey: threadKeys.list });
      onSelect(t.id);
    } catch {
      toast("Unable to start a thread.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const prev = qc.getQueryData<AgentThread[]>(threadKeys.list);
    qc.setQueryData<AgentThread[]>(threadKeys.list, (old) => old?.filter((t) => t.id !== id));
    try {
      await deleteThread(id);
      if (id === current) onSelect(null);
      toast("Thread deleted.");
    } catch {
      qc.setQueryData(threadKeys.list, prev);
      toast("Unable to delete thread.");
    } finally {
      void qc.invalidateQueries({ queryKey: threadKeys.list });
    }
  };

  const when = (t: AgentThread) => {
    const d = parseISO(t.updatedAt);
    return `${fmtRelativeDate(d)} ${fmtTime(d)}`;
  };

  const rowKey = (e: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };

  return (
    <div className="flex-1 min-h-0 scroller px-3 py-2 pb-[max(16px,var(--safe-bottom))]" data-testid="thread-list">
      <button type="button" onClick={() => void add()} disabled={busy} className="grid grid-cols-[2ch_1fr] w-[calc(100%+8px)] -mx-1 px-1 text-left min-h-[44px] lg:min-h-[32px] items-center text-term-prompt rounded-xs hover:bg-term-bg-hover active:bg-term-bg-hover disabled:opacity-50">
        <span aria-hidden="true" className="select-none">+</span>
        <span>new thread</span>
      </button>
      {threads.isPending ? (
        <div className="mt-3">
          <WorkingLine>loading threads…</WorkingLine>
        </div>
      ) : threads.isError ? (
        <div className="mt-3">
          <ErrorLine onRetry={() => void threads.refetch()}>Unable to load threads.</ErrorLine>
        </div>
      ) : threads.data.length === 0 ? (
        <div className="mt-3 pl-[2ch] text-term-fg-faint">no threads yet.</div>
      ) : (
        <div className="mt-3 flex flex-col" role="list">
          {threads.data.map((t) => {
            const isCurrent = t.id === current;
            const title = t.title?.trim() || "New conversation";
            return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => onSelect(t.id)}
                onKeyDown={(e) => rowKey(e, t.id)}
                className="grid grid-cols-[2ch_1fr_auto] items-center min-h-[44px] lg:min-h-[32px] -mx-1 px-1 rounded-xs cursor-pointer hover:bg-term-bg-hover active:bg-term-bg-hover focus-visible:bg-term-bg-hover"
              >
                <span aria-hidden="true" className={cn("select-none", isCurrent ? "text-term-prompt" : "text-term-fg-faint")}>
                  {isCurrent ? "❯" : "·"}
                </span>
                <span className="min-w-0 flex items-baseline gap-3">
                  <span className={cn("truncate", isCurrent ? "text-term-fg" : "text-term-fg-dim")}>{title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-term-fg-faint tabular">{when(t)}</span>
                </span>
                <button
                  type="button"
                  aria-label="Thread options"
                  className="inline-flex items-center justify-center w-11 h-11 lg:w-8 lg:h-8 -mr-1 text-term-fg-faint hover:text-term-fg-dim"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ id: t.id, x: r.left + r.width / 2, y: r.bottom });
                  }}
                >
                  <span aria-hidden="true">⋯</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      <Menu open={menu != null} onClose={() => setMenu(null)} anchor={menu} items={[{ label: "Delete Thread", icon: "trash", destructive: true, onPress: () => { if (menu) void remove(menu.id); } }]} />
    </div>
  );
}
