import { create } from "zustand";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; onPress: () => void };
}
interface ToastState {
  items: ToastItem[];
  show: (text: string, action?: ToastItem["action"], ms?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 1;
export const useToast = create<ToastState>((set, get) => ({
  items: [],
  show: (text, action, ms = 3000) => {
    const id = seq++;
    set({ items: [...get().items.slice(-1), { id, text, action }] });
    window.setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, action?: ToastItem["action"], ms?: number) => useToast.getState().show(text, action, ms);

/** Bottom toast for confirmations with an optional single action (Undo). Never for errors the user can fix in place. */
export function Toaster() {
  const items = useToast((s) => s.items);
  const dismiss = useToast((s) => s.dismiss);
  return createPortal(
    <div className="fixed left-0 right-0 z-[70] flex flex-col items-center gap-2 pointer-events-none px-4" style={{ bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 12px)" }}>
      <AnimatePresence>
        {items.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8, transition: { duration: 0.16 } }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }} className="pointer-events-auto flex items-center gap-4 bg-primary text-canvas rounded-md pl-4 pr-2 h-11 max-w-[420px] w-full shadow-popover">
            <span className="text-subhead flex-1 truncate">{t.text}</span>
            {t.action && (
              <button type="button" className="text-subhead font-semibold px-2 h-9 rounded-sm active:opacity-60" style={{ color: "var(--bg-canvas)" }} onClick={() => { t.action?.onPress(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
