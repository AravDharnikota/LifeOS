import type { Widget } from "@aravos/shared";

export type WidgetOf<T extends Widget["type"]> = Extract<Widget, { type: T }>;

export interface WidgetProps<W extends Widget = Widget> {
  widget: W;
  /** Title of the section the widget sits in; widgets skip a header that would repeat it. */
  sectionTitle?: string;
  editing: boolean;
}

/** Calendar palette names to CSS variables. Unknown names fall back to gray. */
const PALETTE = new Set(["blue", "green", "yellow", "orange", "red", "pink", "purple", "gray", "graphite"]);
export function colorVar(name: string | null | undefined, fallback = "var(--cal-gray)"): string {
  if (!name) return fallback;
  const n = name.toLowerCase();
  return PALETTE.has(n) ? `var(--cal-${n})` : fallback;
}

export function newWidgetId(type: string): string {
  return `${type}-${Math.random().toString(36).slice(2, 8)}`;
}
