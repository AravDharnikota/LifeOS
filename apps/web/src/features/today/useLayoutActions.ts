import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_TODAY_LAYOUT, type Layout, type LayoutSpec, type Widget } from "@aravos/shared";
import { api } from "@/lib/api";
import { keys } from "@/data/queries";

const LAYOUT_ID = "today";

/** Layout mutations. Every call invalidates the layout query; moves and removes update the cache first so the grid responds at once. */
export function useLayoutActions() {
  const qc = useQueryClient();
  const key = keys.layout(LAYOUT_ID);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["layout"] });
  const setSpec = (spec: LayoutSpec) => qc.setQueryData<Layout>(key, (old) => (old ? { ...old, spec } : old));

  return {
    async addWidget(widget: Widget, opts: { sectionId?: string; position?: "top" | "bottom"; sectionTitle?: string } = {}): Promise<Layout> {
      const res = await api.post<Layout>(`/api/layout/${LAYOUT_ID}/widgets`, { widget, ...opts });
      qc.setQueryData(key, res);
      void invalidate();
      return res;
    },
    async removeWidget(widgetId: string): Promise<void> {
      const prev = qc.getQueryData<Layout>(key);
      if (prev) setSpec({ ...prev.spec, sections: prev.spec.sections.map((s) => ({ ...s, widgets: s.widgets.filter((w) => w.id !== widgetId) })).filter((s) => s.widgets.length > 0) });
      try {
        await api.delete(`/api/layout/${LAYOUT_ID}/widgets/${widgetId}`);
      } finally {
        void invalidate();
      }
    },
    async updateWidget(widgetId: string, patch: Record<string, unknown>): Promise<void> {
      const prev = qc.getQueryData<Layout>(key);
      if (prev) setSpec({ ...prev.spec, sections: prev.spec.sections.map((s) => ({ ...s, widgets: s.widgets.map((w) => (w.id === widgetId ? ({ ...w, ...patch } as Widget) : w)) })) });
      try {
        await api.patch(`/api/layout/${LAYOUT_ID}/widgets/${widgetId}`, patch);
      } finally {
        void invalidate();
      }
    },
    async moveWidget(widgetId: string, to: { sectionId: string; index: number }): Promise<void> {
      const prev = qc.getQueryData<Layout>(key);
      if (prev) {
        const sections = prev.spec.sections.map((s) => ({ ...s, widgets: [...s.widgets] }));
        let widget: Widget | undefined;
        for (const s of sections) {
          const i = s.widgets.findIndex((w) => w.id === widgetId);
          if (i >= 0) widget = s.widgets.splice(i, 1)[0];
        }
        const target = sections.find((s) => s.id === to.sectionId);
        if (widget && target) target.widgets.splice(Math.max(0, Math.min(to.index, target.widgets.length)), 0, widget);
        setSpec({ ...prev.spec, sections: sections.filter((s) => s.widgets.length > 0) });
      }
      try {
        await api.post(`/api/layout/${LAYOUT_ID}/widgets/${widgetId}/move`, to);
      } finally {
        void invalidate();
      }
    },
    async revert(): Promise<Layout> {
      const res = await api.post<Layout>(`/api/layout/${LAYOUT_ID}/revert`);
      qc.setQueryData(key, res);
      void invalidate();
      return res;
    },
    async reset(): Promise<Layout> {
      const res = await api.put<Layout>(`/api/layout/${LAYOUT_ID}`, { spec: DEFAULT_TODAY_LAYOUT, reason: "Reset to default" });
      qc.setQueryData(key, res);
      void invalidate();
      return res;
    },
  };
}
