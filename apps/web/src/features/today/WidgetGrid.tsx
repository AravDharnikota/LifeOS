import type { LayoutSpec, Widget } from "@aravos/shared";
import { Section } from "@/ui/List";
import { renderWidget } from "./widgets";
import { WidgetFrame } from "./WidgetFrame";

export interface GridHandlers {
  onMove: (widgetId: string, sectionId: string, index: number) => void;
  onResize: (widgetId: string, size: Widget["size"]) => void;
  onRemove: (widgetId: string) => void;
}

/** Sections of widgets. Mobile: two columns (s = 1, m = 1 tall, l = 2). Desktop: four (s = 1, m = 2, l = 4). */
export function WidgetGrid({ spec, editing, handlers }: { spec: LayoutSpec; editing: boolean; handlers: GridHandlers }) {
  return (
    <div className="flex flex-col">
      {spec.sections.map((section, si) => (
        <Section key={section.id} title={section.title} className={si > 0 && section.title ? "mt-8" : undefined}>
          <div className="px-[var(--gutter)] grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 [grid-auto-flow:dense]" data-section={section.id}>
            {section.widgets.map((widget, wi) => (
              <WidgetFrame
                key={widget.id}
                widget={widget}
                editing={editing}
                actions={{
                  moveUp: wi > 0 ? () => handlers.onMove(widget.id, section.id, wi - 1) : si > 0 ? () => handlers.onMove(widget.id, spec.sections[si - 1]!.id, spec.sections[si - 1]!.widgets.length) : undefined,
                  moveDown: wi < section.widgets.length - 1 ? () => handlers.onMove(widget.id, section.id, wi + 1) : si < spec.sections.length - 1 ? () => handlers.onMove(widget.id, spec.sections[si + 1]!.id, 0) : undefined,
                  resize: (size) => handlers.onResize(widget.id, size),
                  remove: () => handlers.onRemove(widget.id),
                }}
              >
                {renderWidget({ widget, sectionTitle: section.title, editing })}
              </WidgetFrame>
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}
