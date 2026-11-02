import { useEffect, useState } from "react";
import { Route, Routes, useNavigate, useParams } from "react-router";
import { create } from "zustand";
import { useLists } from "@/data/queries";
import { useHotkey, useIsDesktop } from "@/lib/hooks";
import { plural } from "@/lib/format";
import { useUi } from "@/state/ui";
import { Screen } from "@/ui/Screen";
import { IconButton } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Segmented } from "@/ui/Segmented";
import { Menu } from "@/ui/Menu";
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

function Home() {
  const isDesktop = useIsDesktop();
  const { tab, setTab } = useTab();
  const setQuickAdd = useUi((s) => s.setQuickAdd);
  const setListId = useQuickAddPrefs((s) => s.setListId);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const navigate = useNavigate();
  useQuickAddHotkeys();
  useEffect(() => setListId(null), [setListId]);
  const options = isDesktop ? [...TABS, { value: "logbook" as Tab, label: "Logbook" }] : TABS;
  const current: Tab = tab === "logbook" && !isDesktop ? "today" : tab;
  return (
    <Screen
      title="Tasks"
      actions={
        <>
          {!isDesktop && (
            <IconButton label="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMore({ x: r.left + r.width / 2, y: r.bottom }); }}>
              <Icon name="more" />
            </IconButton>
          )}
          <IconButton label="Add" tinted onClick={() => setQuickAdd(true)}>
            <Icon name="plus" />
          </IconButton>
        </>
      }
      header={<Segmented options={options} value={current} onChange={setTab} className={isDesktop ? "max-w-[560px]" : undefined} />}
      contentClassName={isDesktop ? "[&>*]:max-w-[760px]" : undefined}
    >
      {current === "today" && <TodayView />}
      {current === "upcoming" && <UpcomingView />}
      {current === "anytime" && <AnytimeView />}
      {current === "lists" && <ListsView />}
      {current === "logbook" && <LogbookView />}
      <Menu open={Boolean(more)} onClose={() => setMore(null)} anchor={more} items={[{ label: "Logbook", icon: "book", onPress: () => navigate("logbook") }]} />
    </Screen>
  );
}

function ListScreen() {
  const { id = "" } = useParams();
  const lists = useLists();
  const setQuickAdd = useUi((s) => s.setQuickAdd);
  const setListId = useQuickAddPrefs((s) => s.setListId);
  useQuickAddHotkeys();
  useEffect(() => {
    setListId(id);
    return () => setListId(null);
  }, [id, setListId]);
  const list = (lists.data ?? []).find((l) => l.id === id);
  const name = list?.name ?? "List";
  return (
    <Screen
      title={name}
      subtitle={list ? (list.openCount ? plural(list.openCount, "open task") : "No open tasks") : undefined}
      back="/tasks"
      actions={
        <IconButton label="Add" tinted onClick={() => setQuickAdd(true)}>
          <Icon name="plus" />
        </IconButton>
      }
    >
      <ListTasksView listId={id} listName={name} />
    </Screen>
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
