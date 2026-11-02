import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import type { AgentThread } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { fmtRelativeDate, fmtTime } from "@/lib/format";
import { IconButton } from "@/ui/Button";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { Icon } from "@/ui/Icon";
import { Group, Row } from "@/ui/List";
import { Menu } from "@/ui/Menu";
import { toast } from "@/ui/Toast";
import { createThread, deleteThread, threadKeys, useThreads } from "./useAgent";

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

  const subtitle = (t: AgentThread) => {
    const d = parseISO(t.updatedAt);
    return `${fmtRelativeDate(d)} ${fmtTime(d)}`;
  };

  return (
    <div className="pt-2 pb-4" data-testid="thread-list">
      <Group inset={false}>
        <Row title={<span className="text-accent-text">New Thread</span>} leading={<Icon name="plus" size={20} className="text-accent-text" />} onPress={() => void add()} disabled={busy} />
      </Group>
      {threads.isPending ? (
        <Skeleton rows={3} className="mx-0 mt-6" />
      ) : threads.isError ? (
        <InlineError onRetry={() => void threads.refetch()}>Unable to load threads.</InlineError>
      ) : threads.data.length === 0 ? (
        <Empty>No threads yet.</Empty>
      ) : (
        <Group inset={false} className="mt-6">
          {threads.data.map((t) => (
            <Row
              key={t.id}
              title={t.title?.trim() || "New conversation"}
              subtitle={subtitle(t)}
              onPress={() => onSelect(t.id)}
              className={cn(t.id === current && "bg-selected")}
              trailing={
                <IconButton
                  label="Thread options"
                  className="-mr-3 text-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenu({ id: t.id, x: r.left + r.width / 2, y: r.bottom });
                  }}
                >
                  <Icon name="more" size={20} />
                </IconButton>
              }
            />
          ))}
        </Group>
      )}
      <Menu open={menu != null} onClose={() => setMenu(null)} anchor={menu} items={[{ label: "Delete Thread", icon: "trash", destructive: true, onPress: () => { if (menu) void remove(menu.id); } }]} />
    </div>
  );
}
