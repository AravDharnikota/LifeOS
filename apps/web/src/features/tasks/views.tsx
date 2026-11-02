import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { todayString } from "@aravos/shared";
import { useLists, useTasks } from "@/data/queries";
import { Group, Row, Section } from "@/ui/List";
import { Sheet } from "@/ui/Sheet";
import { TextField, Chip } from "@/ui/Field";
import { Button } from "@/ui/Button";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { Icon } from "@/ui/Icon";
import { fmtInt } from "@/lib/format";
import { CAL_COLORS, colorVar } from "@/features/calendar/model";
import { TaskBoard } from "./TaskBoard";
import { groupByList, groupLogbook, groupToday, groupUpcoming } from "./model";
import { useTaskActions } from "./useTaskActions";

export function TodayView() {
  const today = todayString();
  const q = useTasks({ view: "today" });
  const groups = useMemo(() => groupToday(q.data ?? [], today), [q.data, today]);
  return <TaskBoard groups={groups} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty="Nothing due today." date={today} />;
}

export function UpcomingView() {
  const q = useTasks({ view: "upcoming" });
  const groups = useMemo(() => groupUpcoming(q.data ?? []), [q.data]);
  return <TaskBoard groups={groups} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty="Nothing scheduled in the next 30 days." />;
}

export function AnytimeView() {
  const q = useTasks({ view: "anytime" });
  const lists = useLists();
  const groups = useMemo(() => groupByList(q.data ?? [], lists.data ?? []), [q.data, lists.data]);
  return <TaskBoard groups={groups} loading={q.isLoading || lists.isLoading} error={q.error ?? lists.error} onRetry={() => void q.refetch()} empty="No undated tasks." />;
}

export function LogbookView() {
  const q = useTasks({ view: "done", limit: 300 });
  const groups = useMemo(() => groupLogbook(q.data ?? []), [q.data]);
  return <TaskBoard groups={groups} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty="Completed tasks will appear here." emptyAction={<span />} logbook />;
}

export function ListTasksView({ listId, listName }: { listId: string; listName: string }) {
  const q = useTasks({ view: "list", listId });
  const groups = useMemo(() => {
    const open = (q.data ?? []).filter((t) => t.status === "open").sort((a, b) => a.sortOrder - b.sortOrder);
    return open.length ? [{ key: listId, title: listName, tasks: open, hideDone: true, reorderable: true }] : [];
  }, [q.data, listId, listName]);
  return <TaskBoard groups={groups} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={`No tasks in ${listName}.`} />;
}

export function ListsView() {
  const lists = useLists();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  if (lists.isLoading) return <Skeleton rows={3} />;
  if (lists.error) return <InlineError onRetry={() => void lists.refetch()}>Unable to load lists.</InlineError>;
  const data = lists.data ?? [];
  return (
    <>
      <Section>
        {data.length === 0 ? (
          <Empty action={<Button variant="plain" onClick={() => setCreating(true)}>New List</Button>}>No lists yet.</Empty>
        ) : (
          <Group>
            {data.map((l) => (
              <Row
                key={l.id}
                data-list-row={l.id}
                leading={<span className="w-3 h-3 rounded-full" style={{ background: colorVar(l.color ?? (l.isDefault ? "graphite" : "gray")) }} />}
                title={l.name}
                trailing={l.openCount > 0 ? <span className="text-footnote text-secondary tabular">{fmtInt(l.openCount)}</span> : undefined}
                chevron
                onPress={() => navigate(`list/${l.id}`)}
              />
            ))}
          </Group>
        )}
      </Section>
      {data.length > 0 && (
        <Section>
          <Group>
            <Row leading={<Icon name="plus" size={20} className="text-accent-text" />} title={<span className="text-accent-text">New List</span>} onPress={() => setCreating(true)} />
          </Group>
        </Section>
      )}
      <NewListSheet open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function NewListSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const actions = useTaskActions();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("blue");
  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    await actions.createList.mutateAsync({ name: n, color });
    setName("");
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="New List" dirty={Boolean(name.trim())} trailing={<button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={!name.trim() || actions.createList.isPending} onClick={() => void submit()}>Add</button>}>
      <div className="pt-2 pb-4 flex flex-col gap-4">
        <TextField label="Name" placeholder="Errands" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} enterKeyHint="done" />
        <div>
          <span className="block text-footnote text-secondary mb-1.5">Color</span>
          <div className="flex gap-2 flex-wrap">
            {CAL_COLORS.filter((c) => c !== "graphite").map((c) => (
              <Chip key={c} selected={color === c} onClick={() => setColor(c)} className="inline-flex items-center gap-1.5 capitalize">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorVar(c) }} />
                {c}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
