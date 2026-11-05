import { useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import type { AgentThread } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { fmtRelativeDate, fmtTime } from "@/lib/format";
import { Menu } from "@/ui/Menu";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { StatusPill } from "@/ui/viz";
import { toast } from "@/ui/Toast";
import { createThread, deleteThread, threadKeys, useThreads } from "./useAgent";

/** Threads as glass rows: an icon well (ink for the current thread), the title and when it last moved, and an options button. */
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
    <div className="flex-1 min-h-0 scroller px-[var(--gutter)] pt-2 pb-[max(16px,var(--safe-bottom))]" data-testid="thread-list">
      <Button variant="primary" full loading={busy} leading={<Icon name="plus" size={17} strokeWidth={2} />} onClick={() => void add()}>
        New Thread
      </Button>
      {threads.isPending ? (
        <div className="mt-4 well rounded-lg overflow-hidden" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn("h-[60px] flex items-center gap-3 px-3", i > 0 && "hairline-t")}>
              <span className="w-8 h-8 rounded-[10px] shimmer" />
              <span className="h-3 rounded-full shimmer" style={{ width: `${45 + i * 12}%` }} />
            </div>
          ))}
        </div>
      ) : threads.isError ? (
        <div className="mt-4 flex items-center justify-between gap-3 px-1 text-[13px] text-secondary" role="alert">
          <span>Unable to load threads.</span>
          <button type="button" className="text-accent-text font-medium" onClick={() => void threads.refetch()}>
            Retry
          </button>
        </div>
      ) : threads.data.length === 0 ? (
        <p className="mt-6 text-center text-[14px] text-tertiary">No threads yet.</p>
      ) : (
        <div className="mt-4 well rounded-lg overflow-hidden" role="list">
          {threads.data.map((t, i) => {
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
                className="relative flex items-center gap-3 min-h-[60px] pl-3 pr-1 cursor-pointer row-hover active:bg-pressed transition-colors duration-150"
              >
                {i > 0 && <span aria-hidden="true" className="absolute left-14 right-0 top-0 h-px bg-separator" />}
                <span className={cn("w-8 h-8 rounded-[10px] inline-flex items-center justify-center shrink-0", isCurrent ? "bg-primary text-canvas" : "well text-secondary")} aria-hidden="true">
                  <Icon name={isCurrent ? "sparkle" : "chat"} size={15} strokeWidth={1.8} />
                </span>
                <span className="flex-1 min-w-0 py-2.5">
                  <span className="block text-[15px] leading-5 text-primary truncate">{title}</span>
                  <span className="block text-[12px] leading-4 text-tertiary tabular mt-0.5">{when(t)}</span>
                </span>
                {isCurrent && <StatusPill tone="accent">Current</StatusPill>}
                <button
                  type="button"
                  aria-label="Thread options"
                  className="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-full text-tertiary hover:text-secondary active:bg-pressed"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ id: t.id, x: r.left + r.width / 2, y: r.bottom });
                  }}
                >
                  <Icon name="more" size={18} />
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
