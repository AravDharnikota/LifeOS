import { useCallback, useEffect, useRef, useState } from "react";
import type { Widget } from "@aravos/shared";
import { useLayout } from "@/data/queries";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { useUi } from "@/state/ui";
import { Button, IconButton } from "@/ui/Button";
import { InlineError } from "@/ui/Empty";
import { Icon } from "@/ui/Icon";
import { Menu } from "@/ui/Menu";
import { toast } from "@/ui/Toast";
import { AddWidgetSheet } from "./AddWidgetSheet";
import { Greeting, QuickChips } from "./Header";
import { WidgetGrid } from "./WidgetGrid";
import { useLayoutActions } from "./useLayoutActions";
import "./today.css";

/**
 * The Today dashboard: a greeting header, a row of quick-action chips, then the layout spec
 * rendered as sections of glass widgets, with an edit mode.
 * It draws its own header (instead of <Screen>) so the h1 can be the greeting; the compact bar still reads "Today".
 */
export function Today() {
  const now = useNow(60_000);
  const layout = useLayout("today");
  const actions = useLayoutActions();
  const openAgent = useUi((s) => s.openAgent);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Same collapse rule as <Screen>: once the large header scrolls away, the frosted bar shows "Today".
  useEffect(() => {
    const el = sentinel.current;
    const root = scrollRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setCollapsed(!(e?.isIntersecting ?? true)), { root, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const revert = useCallback(async () => {
    try {
      await actions.revert();
      toast("Layout reverted.");
    } catch (e) {
      toast(e instanceof ApiError && e.status === 400 ? "Nothing to revert." : "Unable to revert layout.");
    }
  }, [actions]);

  const reset = async () => {
    try {
      await actions.reset();
      toast("Layout reset.", { label: "Undo", onPress: () => void revert() });
    } catch {
      toast("Unable to reset layout.");
    }
  };

  const remove = async (id: string) => {
    try {
      await actions.removeWidget(id);
      toast("Widget removed.", { label: "Undo", onPress: () => void revert() });
    } catch {
      toast("Unable to remove widget.");
    }
  };

  const resize = async (id: string, size: Widget["size"]) => {
    try {
      await actions.updateWidget(id, { size });
    } catch {
      toast("Unable to resize widget.");
    }
  };

  const move = async (id: string, sectionId: string, index: number) => {
    try {
      await actions.moveWidget(id, { sectionId, index });
    } catch {
      toast("Unable to move widget.");
    }
  };

  const openMenu = () => {
    const r = moreRef.current?.getBoundingClientRect();
    setMenu(r ? { x: r.left + r.width / 2, y: r.bottom } : { x: window.innerWidth - 24, y: 56 });
  };

  const headerActions = editing ? (
    <Button variant="primary" size="sm" onClick={() => setEditing(false)}>
      Done
    </Button>
  ) : (
    <>
      <IconButton label="Assistant" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={() => openAgent()}>
        <Icon name="sparkle" size={18} strokeWidth={1.8} />
      </IconButton>
      <IconButton ref={moreRef} label="More" className="glass !min-w-0 !min-h-0 w-10 h-10" onClick={openMenu} aria-haspopup="menu" aria-expanded={menu != null}>
        <Icon name="more" size={18} strokeWidth={1.8} />
      </IconButton>
    </>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className={cn("shrink-0 relative z-20 pt-[var(--safe-top)] transition-[background-color,box-shadow] duration-200", collapsed && "hairline-b")}
        style={collapsed ? { background: "var(--glass-fill-strong)", backdropFilter: "blur(24px) saturate(1.7)", WebkitBackdropFilter: "blur(24px) saturate(1.7)" } : undefined}
      >
        <div className="h-[var(--topbar-h)] grid grid-cols-[1fr_auto_1fr] items-center px-1">
          <div />
          <button
            type="button"
            data-haptic="off"
            tabIndex={-1}
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className={cn("text-[16px] font-medium text-primary truncate transition-[opacity,transform] duration-200", collapsed ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none")}
          >
            Today
          </button>
          <div className="justify-self-end flex items-center gap-2 pr-[calc(var(--gutter)-4px)]">{headerActions}</div>
        </div>
      </div>
      <div ref={scrollRef} className="scroller flex-1 min-h-0 pb-[calc(var(--tabbar-h)+var(--safe-bottom)+24px)] lg:pb-10">
        <header className="px-[var(--gutter)] pt-1 pb-5">
          <Greeting now={now} />
          <div ref={sentinel} className="h-px" />
        </header>
        {!editing && layout.isSuccess && layout.data.spec.sections.length > 0 && <QuickChips />}
        {layout.isPending ? (
          <div className="px-[var(--gutter)] grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4" aria-hidden="true">
            <div className="col-span-2 lg:col-span-4 h-40 rounded-lg glass p-4 flex flex-col gap-3">
              <div className="h-3 w-24 rounded-full shimmer" />
              <div className="h-2.5 w-2/3 rounded-full shimmer" />
            </div>
            <div className="h-36 rounded-lg glass" />
            <div className="h-36 rounded-lg glass" />
          </div>
        ) : layout.isError ? (
          <InlineError onRetry={() => void layout.refetch()}>Unable to load the dashboard.</InlineError>
        ) : layout.data.spec.sections.length === 0 ? (
          <div className="mx-[var(--gutter)] glass rounded-lg flex flex-col items-center text-center px-6 py-10 gap-2">
            <p className="text-[15px] text-secondary">No widgets yet.</p>
            <Button variant="plain" onClick={() => { setEditing(true); setAdding(true); }}>Add Widget</Button>
          </div>
        ) : (
          <WidgetGrid spec={layout.data.spec} editing={editing} handlers={{ onMove: (id, s, i) => void move(id, s, i), onResize: (id, size) => void resize(id, size), onRemove: (id) => void remove(id) }} />
        )}
        {editing && layout.data && (
          <div className="px-[var(--gutter)] mt-6 flex flex-col gap-3">
            <Button variant="secondary" full leading={<Icon name="plus" size={18} />} onClick={() => setAdding(true)}>
              Add Widget
            </Button>
            <p className="text-[13px] text-tertiary text-center">Tap a widget to move or resize it.</p>
          </div>
        )}
      </div>
      <Menu
        open={menu != null}
        onClose={() => setMenu(null)}
        anchor={menu}
        items={[
          { label: "Edit Layout", icon: "pencil", onPress: () => setEditing(true) },
          { label: "Revert Layout", icon: "undo", onPress: () => void revert() },
          { label: "Reset to Default", icon: "refresh", onPress: () => void reset() },
        ]}
      />
      <AddWidgetSheet open={adding} onClose={() => setAdding(false)} onAdd={async (w) => { await actions.addWidget(w); toast("Widget added."); }} />
    </div>
  );
}
