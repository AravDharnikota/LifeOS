import { useCallback, useRef, useState } from "react";
import type { Widget } from "@aravos/shared";
import { useLayout } from "@/data/queries";
import { ApiError } from "@/lib/api";
import { fmtDateLong } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useUi } from "@/state/ui";
import { Button, IconButton } from "@/ui/Button";
import { InlineError, Skeleton } from "@/ui/Empty";
import { Icon } from "@/ui/Icon";
import { Menu } from "@/ui/Menu";
import { Screen } from "@/ui/Screen";
import { toast } from "@/ui/Toast";
import { AddWidgetSheet } from "./AddWidgetSheet";
import { WidgetGrid } from "./WidgetGrid";
import { useLayoutActions } from "./useLayoutActions";
import "./today.css";

/** The Today dashboard: the layout spec rendered as sections of widgets, with an edit mode. */
export function Today() {
  const now = useNow(60_000);
  const layout = useLayout("today");
  const actions = useLayoutActions();
  const openAgent = useUi((s) => s.openAgent);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

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
    <button type="button" className="text-headline text-accent-text h-11 px-3" onClick={() => setEditing(false)}>
      Done
    </button>
  ) : (
    <>
      <IconButton label="Assistant" onClick={() => openAgent()}>
        <Icon name="sparkle" />
      </IconButton>
      <IconButton ref={moreRef} label="More" onClick={openMenu} aria-haspopup="menu" aria-expanded={menu != null}>
        <Icon name="more" />
      </IconButton>
    </>
  );

  return (
    <Screen title="Today" subtitle={fmtDateLong(now)} actions={headerActions}>
      <div className="pt-2">
        {layout.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton rows={3} />
            <Skeleton rows={2} />
          </div>
        ) : layout.isError ? (
          <InlineError onRetry={() => void layout.refetch()}>Unable to load the dashboard.</InlineError>
        ) : layout.data.spec.sections.length === 0 ? (
          <div className="flex flex-col items-center text-center px-[var(--gutter)] pt-10 gap-2">
            <p className="text-callout text-secondary">No widgets yet.</p>
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
            <p className="text-footnote text-tertiary text-center">Tap a widget to move or resize it.</p>
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
    </Screen>
  );
}
