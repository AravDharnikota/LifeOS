import { useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import type { Widget } from "@aravos/shared";
import { cn } from "@/lib/cn";
import { impact } from "@/lib/haptics";
import { Icon } from "@/ui/Icon";
import { Menu, type MenuItem } from "@/ui/Menu";

export interface FrameActions {
  moveUp?: () => void;
  moveDown?: () => void;
  resize: (size: Widget["size"]) => void;
  remove: () => void;
}

const SIZE_CLASS: Record<Widget["size"], string> = {
  s: "col-span-1 min-h-[150px] lg:min-h-[168px]",
  m: "col-span-1 row-span-2 min-h-[312px] lg:col-span-2 lg:row-span-1 lg:min-h-[168px]",
  l: "col-span-2 lg:col-span-4",
};

/**
 * A frosted glass card (radius 20, 16px padding) that rises in on mount, staggered by `index`.
 * In edit mode it gets a calm dashed outline, a small remove badge and a tap-for-options menu. No wobble.
 */
export function WidgetFrame({ widget, editing, actions, children, index = 0 }: { widget: Widget; editing: boolean; actions: FrameActions; children: ReactNode; index?: number }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items: MenuItem[] = [
    { label: "Move Up", icon: "arrow-up", onPress: () => actions.moveUp?.(), disabled: !actions.moveUp },
    { label: "Move Down", icon: "arrow-down", onPress: () => actions.moveDown?.(), disabled: !actions.moveDown },
    ...(["s", "m", "l"] as const).map((s) => ({ label: s === "s" ? "Resize to Small" : s === "m" ? "Resize to Medium" : "Resize to Large", onPress: () => actions.resize(s), disabled: widget.size === s })),
    { label: "Remove Widget", icon: "trash", destructive: true, onPress: actions.remove },
  ];
  return (
    <motion.div
      layout={editing ? "position" : false}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      data-widget={widget.id}
      data-widget-type={widget.type}
      style={{ "--i": index } as CSSProperties}
      className={cn("relative glass rounded-lg p-4 flex flex-col min-w-0 rise", SIZE_CLASS[widget.size], editing && "widget-editing")}
    >
      {children}
      {editing && (
        <>
          <button
            type="button"
            aria-label={`Widget options, ${widget.type.replace(/_/g, " ")}`}
            className="absolute inset-0 z-20 rounded-lg cursor-pointer active:bg-pressed transition-colors duration-100"
            onClick={(e) => {
              void impact("medium");
              setMenu({ x: e.clientX, y: e.clientY });
            }}
            onContextMenu={(e) => e.preventDefault()}
          />
          <button
            type="button"
            aria-label="Remove widget"
            className="absolute -top-[13px] -right-[13px] z-30 w-11 h-11 flex items-start justify-end p-0"
            onClick={(e) => {
              e.stopPropagation();
              actions.remove();
            }}
          >
            <span className="w-6 h-6 rounded-full glass-strong text-secondary inline-flex items-center justify-center pressable">
              <Icon name="x" size={12} strokeWidth={2} />
            </span>
          </button>
          <Menu open={menu != null} onClose={() => setMenu(null)} anchor={menu} items={items} />
        </>
      )}
    </motion.div>
  );
}
