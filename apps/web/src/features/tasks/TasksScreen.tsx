import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toDateString, todayString } from "@aravos/shared";
import { Route, Routes, useNavigate, useParams } from "react-router";
import { create } from "zustand";
import { useLists, useTasks } from "@/data/queries";
import { useHotkey, useIsDesktop } from "@/lib/hooks";
import { plural } from "@/lib/format";
import { useUi } from "@/state/ui";
import { Screen } from "@/ui/Screen";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Segmented } from "@/ui/Segmented";
import { Menu } from "@/ui/Menu";
import { CardHeader, GlassCard, StatusPill, ThinBar, useCountUp } from "@/ui/viz";
import { useQuickAddPrefs } from "./QuickAdd";
import { AnytimeView, ListTasksView, ListsView, LogbookView, TodayView, UpcomingView } from "./views";

type Tab = "today" | "upcoming" | "anytime" | "lists" | "logbook";
const TABS: { value: Tab; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "anytime", label: "Anytime" },
  { value: "lists", label: "Lists" },
];

const useTab = create<{ tab: Tab; setTab: (t: Tab) => void }>((set) => ({ tab: "today", setTab: (tab) => set({ tab }) }));

function useQuickAddHotkeys() {
  const isDesktop = useIsDesktop();
  const setQuickAdd = useUi((s) => s.setQuickAdd);
  useHotkey("q", () => setQuickAdd(true), { enabled: isDesktop });
  useHotkey("n", () => setQuickAdd(true), { meta: true, enabled: isDesktop });
}

/** Today at a glance: open vs done, a thin progress bar, overdue as one red pill. Shares the Today view's queries. */
function TodaySummary() {
  const today = todayString();
  const q = useTasks({ view: "today" });
  const doneQ = useTasks({ view: "done", limit: 100 });
  const s = useMemo(() => {
    const open = (q.data ?? []).filter((t) => t.status === "open");
    const doneIds = new Set<string>();
    for (const t of [...(q.data ?? []), ...(doneQ.data ?? [])]) {
      if (t.status === "done" && t.completedAt && toDateString(new Date(t.completedAt)) === today) doneIds.add(t.id);
    }
    const done = doneIds.size;
    const total = open.length + done;
    return { open: open.length, done, overdue: open.filter((t) => t.dueDate && t.dueDate < today).length, progress: total ? done / total : 0 };
  }, [q.data, doneQ.data, today]);
  const pct = useCountUp(Math.round(s.progress * 100));
  const loading = q.isLoading;
  const sub = loading ? "\u00a0" : s.open + s.done === 0 ? "Nothing due today" : s.open === 0 ? `All clear · ${s.done} done today` : `${s.open} open · ${s.done} done today`;
  return (
    <GlassCard className="rise mb-3" tone="strong">
      <CardHeader icon="sun" title="Today" sub={sub} trailing={s.overdue > 0 ? <StatusPill tone="danger" dot>{s.overdue} overdue</StatusPill> : undefined} />
      <div className="mt-3.5 flex items-center gap-3">
        <ThinBar progress={loading ? 0 : s.progress} color="var(--success)" height={6} className="flex-1" />
        <span className="w-9 text-right text-[12px] text-secondary tabular">{loading ? "" : `${pct}%`}</span>
      </div>
    </GlassCard>
  );
}

/** Thumb-reach Add on the phone: a round ink button floating just above the tab bar. Desktop keeps the header button. */
function AddFab({ onPress }: { onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label="Add"
      title="Add"
      onClick={onPress}
      className="fixed z-20 right-[var(--gutter)] w-14 h-14 rounded-full bg-primary text-canvas inline-flex items-center justify-center pressable-spring"
      style={{ bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 12px)", boxShadow: "var(--shadow-float)" }}
    >
      <Icon name="plus" size={24} strokeWidth={1.7} />
    </button>
  );
}

/** The one Add control for a tasks screen: header glass button on desktop, floating button on the phone. */
function AddControl({ desktop }: { desktop: boolean }) {
  const setQuickAdd = useUi((s) => s.setQuickAdd);
  if (!desktop) return <AddFab onPress={() => setQuickAdd(true)} />;
  return (
    <IconButton label="Add" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={() => setQuickAdd(true)}>
      <Icon name="plus" size={20} strokeWidth={1.7} />
    </IconButton>
  );
}

/** Keeps the last card clear of the floating Add button on the phone. */
const FabSpacer = () => <div className="h-16 lg:hidden" aria-hidden="true" />;

function Home() {
  const isDesktop = useIsDesktop();
  const { tab, setTab } = useTab();
  const setListId = useQuickAddPrefs((s) => s.setListId);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const navigate = useNavigate();
  useQuickAddHotkeys();
  useEffect(() => setListId(null), [setListId]);
  const options = isDesktop ? [...TABS, { value: "logbook" as Tab, label: "Logbook" }] : TABS;
  const current: Tab = tab === "logbook" && !isDesktop ? "today" : tab;
  return (
    <>
    <Screen
      title="Tasks"
      subtitle={format(new Date(), "EEEE, d MMMM")}
      actions={
        <>
          {!isDesktop && (
            <IconButton label="More" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMore({ x: r.left + r.width / 2, y: r.bottom }); }}>
              <Icon name="more" size={20} strokeWidth={1.7} />
            </IconButton>
          )}
          {isDesktop && <AddControl desktop />}
        </>
      }
      header={
        <>
          <TodaySummary />
          <Segmented options={options} value={current} onChange={setTab} className={isDesktop ? "max-w-[560px]" : undefined} />
        </>
      }
      contentClassName={isDesktop ? "[&>*]:max-w-[760px]" : undefined}
    >
      {current === "today" && <TodayView />}
      {current === "upcoming" && <UpcomingView />}
      {current === "anytime" && <AnytimeView />}
      {current === "lists" && <ListsView />}
      {current === "logbook" && <LogbookView />}
      <FabSpacer />
      <Menu open={Boolean(more)} onClose={() => setMore(null)} anchor={more} items={[{ label: "Logbook", icon: "book", onPress: () => navigate("logbook") }]} />
    </Screen>
    {!isDesktop && <AddControl desktop={false} />}
    </>
  );
}

function ListScreen() {
  const { id = "" } = useParams();
  const lists = useLists();
  const isDesktop = useIsDesktop();
  const setListId = useQuickAddPrefs((s) => s.setListId);
  useQuickAddHotkeys();
  useEffect(() => {
    setListId(id);
    return () => setListId(null);
  }, [id, setListId]);
  const list = (lists.data ?? []).find((l) => l.id === id);
  const name = list?.name ?? "List";
  return (
    <>
      <Screen
        title={name}
        subtitle={list ? (list.openCount ? plural(list.openCount, "open task") : "No open tasks") : undefined}
        back="/tasks"
        actions={isDesktop ? <AddControl desktop /> : undefined}
        contentClassName={isDesktop ? "[&>*]:max-w-[760px]" : undefined}
      >
        <ListTasksView listId={id} listName={name} />
        <FabSpacer />
      </Screen>
      {!isDesktop && <AddControl desktop={false} />}
    </>
  );
}

function LogbookScreen() {
  useQuickAddHotkeys();
  return (
    <Screen title="Logbook" back="/tasks">
      <LogbookView />
    </Screen>
  );
}

export function TasksScreen() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="list/:id" element={<ListScreen />} />
      <Route path="logbook" element={<LogbookScreen />} />
    </Routes>
  );
}
