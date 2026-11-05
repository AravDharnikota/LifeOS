import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { impact } from "@/lib/haptics";
import { Icon, type IconName } from "./Icon";

export interface MenuItem {
  label: string;
  icon?: IconName;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** Context menu anchored to a point (long press) or an element (more button). Popover shadow is permitted here. */
export function Menu({ open, onClose, anchor, items, children }: { open: boolean; onClose: () => void; anchor: { x: number; y: number } | null; items: MenuItem[]; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);
  useEffect(() => {
    if (!open) return;
    openedAt.current = performance.now();
    void impact("medium"); // the menu pops up: a physical "open" beat
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (typeof document === "undefined") return null;
  const w = 240;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = Math.min(Math.max(8, (anchor?.x ?? 0) - w / 2), vw - w - 8);
  const estH = items.length * 44 + 12;
  const below = (anchor?.y ?? 0) + 8 + estH < vh;
  const y = below ? (anchor?.y ?? 0) + 8 : Math.max(8, (anchor?.y ?? 0) - estH - 8);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[65]" onClick={() => { if (performance.now() - openedAt.current > 300) onClose(); }} onContextMenu={(e) => e.preventDefault()}>
          <motion.div ref={ref} role="menu" initial={{ opacity: 0, scale: 0.96, y: below ? -4 : 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }} style={{ left: x, top: y, width: w, transformOrigin: below ? "top center" : "bottom center" }} className="absolute glass-strong rounded-lg overflow-hidden p-1.5" onClick={(e) => e.stopPropagation()}>
            {children}
            {items.map((it) => (
              <button key={it.label} role="menuitem" type="button" disabled={it.disabled} onClick={() => { onClose(); it.onPress(); }} className={cn("w-full h-11 px-3 rounded-[12px] flex items-center justify-between text-[16px] active:bg-pressed", it.destructive ? "text-danger-text" : "text-primary", it.disabled && "opacity-40")}>
                <span>{it.label}</span>
                {it.icon && <Icon name={it.icon} size={20} className={it.destructive ? "text-danger-text" : "text-secondary"} />}
              </button>
            ))}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
