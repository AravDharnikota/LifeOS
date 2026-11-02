import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { cn } from "@/lib/cn";
import { impact } from "@/lib/haptics";
import { useMediaQuery } from "@/lib/hooks";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** medium = half height, large = nearly full, auto = fit content (max 92%) */
  detent?: "medium" | "large" | "auto";
  /** Leading header action (default Cancel). Pass null to hide. */
  leading?: ReactNode | null;
  /** Trailing header action (e.g. Done). */
  trailing?: ReactNode;
  children: ReactNode;
  /** Ask before closing when there are unsaved edits. */
  dirty?: boolean;
  className?: string;
  /** Desktop presentation: centered dialog (default) or right-side panel. */
  desktop?: "dialog" | "panel";
  /** Hide the drag grabber and header entirely (e.g. custom chrome). */
  bare?: boolean;
}

let openSheets = 0;

/**
 * Bottom sheet with the iOS curve (500ms), drag-to-dismiss, grabber, dimmed backdrop.
 * On desktop it becomes a centered dialog.
 */
export function Sheet({ open, onClose, title, detent = "auto", leading, trailing, children, dirty, className, desktop = "dialog", bare }: SheetProps) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const controls = useDragControls();
  const contentRef = useRef<HTMLDivElement>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  useEffect(() => {
    if (!open) return;
    openSheets++;
    document.documentElement.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      openSheets--;
      if (openSheets === 0) document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dirty]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const shouldClose = info.offset.y > 120 || info.velocity.y > 600;
    if (shouldClose) requestClose();
    else void impact("light");
  };

  const height = detent === "large" ? "calc(100dvh - var(--safe-top) - 8px)" : detent === "medium" ? "50dvh" : undefined;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={isDesktop && desktop === "panel" ? { justifyContent: "flex-end", alignItems: "stretch" } : isDesktop ? { alignItems: "center" } : undefined}>
          <motion.div className="absolute inset-0" style={{ background: "var(--backdrop)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={requestClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            drag={isDesktop ? false : "y"}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.6 }}
            onDragEnd={onDragEnd}
            initial={isDesktop ? { opacity: 0, scale: 0.98, y: 8 } : { y: "100%" }}
            animate={isDesktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={isDesktop ? { opacity: 0, scale: 0.98, y: 8, transition: { duration: 0.16 } } : { y: "100%", transition: { duration: 0.3, ease: [0.32, 0.72, 0, 1] } }}
            transition={isDesktop ? { duration: 0.2, ease: [0.23, 1, 0.32, 1] } : { duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
            className={cn(
              "relative flex flex-col bg-elevated text-primary w-full",
              isDesktop && desktop === "dialog" && "max-w-[520px] rounded-lg max-h-[90vh] shadow-popover",
              isDesktop && desktop === "panel" && "max-w-[440px] h-full",
              !isDesktop && "rounded-t-lg max-h-[calc(100dvh-var(--safe-top)-8px)]",
              className,
            )}
            style={!isDesktop && height ? { height } : undefined}
          >
            {!isDesktop && !bare && (
              <div className="shrink-0 pt-2 pb-1 flex justify-center cursor-grab touch-none" onPointerDown={(e) => controls.start(e)}>
                <div className="w-9 h-[5px] rounded-full bg-border" />
              </div>
            )}
            {!bare && (title != null || leading !== null || trailing != null) && (
              <div className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center h-11 px-2" onPointerDown={isDesktop ? undefined : (e) => controls.start(e)}>
                <div className="justify-self-start">{leading === undefined ? <button type="button" className="text-body text-accent-text px-2 h-11" onClick={requestClose}>Cancel</button> : leading}</div>
                <h2 className="text-headline text-center truncate px-2">{title}</h2>
                <div className="justify-self-end">{trailing}</div>
              </div>
            )}
            <div ref={contentRef} className="scroller flex-1 min-h-0 px-[var(--gutter)] pb-[max(16px,var(--safe-bottom))]">
              {children}
            </div>
            {confirmClose && (
              <div className="absolute inset-0 z-10 flex items-end justify-center" style={{ background: "var(--backdrop)" }} onClick={() => setConfirmClose(false)}>
                <div className="w-full max-w-[520px] p-2 pb-[max(8px,var(--safe-bottom))] enter" onClick={(e) => e.stopPropagation()}>
                  <div className="bg-elevated rounded-lg overflow-hidden">
                    <div className="px-4 py-3 text-footnote text-secondary text-center">Unsaved changes</div>
                    <button type="button" className="w-full h-14 text-body text-danger-text hairline-t active:bg-pressed" onClick={() => { setConfirmClose(false); onClose(); }}>Discard Changes</button>
                  </div>
                  <button type="button" className="w-full h-14 mt-2 bg-elevated rounded-lg text-headline text-accent-text active:bg-pressed" onClick={() => setConfirmClose(false)}>Keep Editing</button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** iOS action sheet: title is what will happen, destructive first, Cancel separate. */
export function ActionSheet({ open, onClose, title, message, actions }: { open: boolean; onClose: () => void; title?: string; message?: string; actions: { label: string; onPress: () => void; destructive?: boolean }[] }) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={cn("fixed inset-0 z-[60] flex justify-center", isDesktop ? "items-center" : "items-end")}>
          <motion.div className="absolute inset-0" style={{ background: "var(--backdrop)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.div role="alertdialog" initial={isDesktop ? { opacity: 0, scale: 0.98 } : { y: "100%" }} animate={isDesktop ? { opacity: 1, scale: 1 } : { y: 0 }} exit={isDesktop ? { opacity: 0, scale: 0.98 } : { y: "100%" }} transition={{ duration: isDesktop ? 0.2 : 0.4, ease: [0.32, 0.72, 0, 1] }} className="relative w-full max-w-[520px] p-2 pb-[max(8px,var(--safe-bottom))]">
            <div className="bg-elevated rounded-lg overflow-hidden">
              {(title || message) && (
                <div className="px-4 py-3 text-center">
                  {title && <div className="text-footnote font-semibold text-secondary">{title}</div>}
                  {message && <div className="text-footnote text-secondary mt-1">{message}</div>}
                </div>
              )}
              {actions.map((a) => (
                <button key={a.label} type="button" className={cn("w-full h-14 text-body hairline-t active:bg-pressed", a.destructive ? "text-danger-text" : "text-accent-text")} onClick={() => { onClose(); a.onPress(); }}>
                  {a.label}
                </button>
              ))}
            </div>
            <button type="button" className="w-full h-14 mt-2 bg-elevated rounded-lg text-headline text-accent-text active:bg-pressed" onClick={onClose}>Cancel</button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
