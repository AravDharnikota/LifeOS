import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
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
  /** Content fills the sheet edge to edge; the child handles its own gutters and safe area. */
  flush?: boolean;
  /** Inline styles for the sheet surface (e.g. a different background). */
  style?: CSSProperties;
  /** Field to focus once the sheet has finished sliding in (so the keyboard never races the sheet). */
  initialFocus?: RefObject<HTMLElement | null>;
}

let openSheets = 0;

interface SheetCtx {
  /** Run `cb` once the open animation has finished (or now, if it already has). Returns a cancel function. */
  whenSettled: (cb: () => void) => () => void;
}
const SheetContext = createContext<SheetCtx | null>(null);

/** Inside a sheet: defer work (like focusing a field) until the sheet has landed. Outside a sheet: run now. */
export function useSheetSettled(): SheetCtx["whenSettled"] {
  const ctx = useContext(SheetContext);
  return ctx?.whenSettled ?? ((cb) => { cb(); return () => undefined; });
}


const SHEET_EASE = [0.32, 0.72, 0, 1] as const;
/** The slide-in lasts 420ms but is visually done by ~360ms (ease-out); focus then. */
const SHEET_SETTLE_MS = 360;

/**
 * Bottom sheet with the iOS curve (500ms), drag-to-dismiss, grabber, dimmed backdrop.
 * On desktop it becomes a centered dialog.
 */
export function Sheet({ open, onClose, title, detent = "auto", leading, trailing, children, dirty, className, desktop = "dialog", bare, flush, style, initialFocus }: SheetProps) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const controls = useDragControls();
  const contentRef = useRef<HTMLDivElement>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Keyboard timing. On iOS the keyboard slides up the moment a field is focused. If that happens while the
  // sheet is still sliding in, the keyboard beats the sheet and the layout jumps. So: until the open animation
  // finishes, any focus on a text field is caught, undone, and replayed once the sheet has landed.
  const settled = useRef(false);
  const queue = useRef<(() => void)[]>([]);
  const pendingFocus = useRef<HTMLElement | null>(null);
  const whenSettled = useCallback((cb: () => void) => {
    if (settled.current) {
      cb();
      return () => undefined;
    }
    queue.current.push(cb);
    return () => {
      queue.current = queue.current.filter((f) => f !== cb);
    };
  }, []);
  const ctx = useMemo(() => ({ whenSettled }), [whenSettled]);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The exiting sheet keeps its old props (open=true) until it is gone, so read the live value from a ref.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (open) return;
    settled.current = false;
    queue.current = [];
    pendingFocus.current = null;
  }, [open]);
  // Settle on a timer that matches the slide-in (the animation-complete event is unreliable in the iOS
  // web view and arrived ~0.8s late). The keyboard then starts rising just as the sheet lands, and the
  // sheet rides up with it (see src/lib/keyboard.ts), so the keyboard never covers the sheet.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => onOpened(true), isDesktop ? 200 : SHEET_SETTLE_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const onOpened = (force = false) => {
    if (!openRef.current || settled.current) return;
    // Only settle once the sheet has actually landed. React StrictMode's dev double-mount can report an
    // early "complete" while the sheet is still off screen; ignore that and wait for the real one.
    const el = dialogRef.current;
    if (!force && el) {
      const t = getComputedStyle(el).transform;
      if (t && t !== "none" && Math.abs(new DOMMatrix(t).m42) > 2) return;
    }
    settled.current = true;
    const target = initialFocus?.current ?? pendingFocus.current;
    pendingFocus.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    const q = queue.current;
    queue.current = [];
    q.forEach((f) => f());
  };

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

  // Heights subtract the keyboard (--kb) so a sheet shrinks from the top as the keyboard rises under it.
  const height = detent === "large" ? "calc(100dvh - var(--safe-top) - 8px - var(--kb, 0px))" : detent === "medium" ? "50dvh" : undefined;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={cn("fixed inset-0 z-50 flex items-end justify-center", !isDesktop && "kb-lift")} style={isDesktop && desktop === "panel" ? { justifyContent: "flex-end", alignItems: "stretch" } : isDesktop ? { alignItems: "center" } : undefined}>
          <motion.div className="absolute inset-0" style={{ background: "var(--backdrop)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} onClick={requestClose} />
          <SheetContext.Provider value={ctx}>
          <motion.div
            ref={dialogRef}
            role="dialog"
            onAnimationComplete={() => onOpened()}
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
            transition={isDesktop ? { duration: 0.22, ease: [0.23, 1, 0.32, 1] } : { duration: 0.42, ease: SHEET_EASE }}
            className={cn(
              "relative flex flex-col text-primary w-full glass-strong",
              isDesktop && desktop === "dialog" && "max-w-[540px] rounded-xl max-h-[90vh]",
              isDesktop && desktop === "panel" && "max-w-[460px] h-full shadow-popover",
              !isDesktop && "kb-fit rounded-t-[28px] max-h-[calc(100dvh-var(--safe-top)-8px-var(--kb,0px))]",
              className,
            )}
            style={{ ...(!isDesktop && height ? { height } : undefined), ...style }}
          >
            {!isDesktop && !bare && (
              <div className="shrink-0 pt-2.5 pb-1 flex justify-center cursor-grab touch-none" onPointerDown={(e) => controls.start(e)}>
                <div className="w-10 h-[5px] rounded-full bg-border/80" />
              </div>
            )}
            {!bare && (title != null || leading !== null || trailing != null) && (
              <div className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center h-12 px-2" onPointerDown={isDesktop ? undefined : (e) => controls.start(e)}>
                <div className="justify-self-start">{leading === undefined ? <button type="button" className="text-body text-secondary px-3 h-11 rounded-full active:bg-pressed transition-colors" onClick={requestClose}>Cancel</button> : leading}</div>
                <h2 className="text-headline text-center truncate px-2">{title}</h2>
                <div className="justify-self-end">{trailing}</div>
              </div>
            )}
            <div ref={contentRef} className={cn("flex-1 min-h-0", flush ? "flex flex-col" : "scroller px-[var(--gutter)] pb-[max(16px,var(--safe-bottom))]")}>
              {children}
            </div>
            {confirmClose && (
              <div className="absolute inset-0 z-10 flex items-end justify-center rounded-t-[28px]" style={{ background: "var(--backdrop)" }} onClick={() => setConfirmClose(false)}>
                <div className="w-full max-w-[520px] p-2 pb-[max(8px,var(--safe-bottom))] enter" onClick={(e) => e.stopPropagation()}>
                  <div className="glass-strong rounded-xl overflow-hidden">
                    <div className="px-4 py-3 text-footnote text-secondary text-center">Unsaved changes</div>
                    <button type="button" className="w-full h-14 text-body text-danger-text hairline-t active:bg-pressed" onClick={() => { setConfirmClose(false); onClose(); }}>Discard Changes</button>
                  </div>
                  <button type="button" className="w-full h-14 mt-2 glass-strong rounded-xl text-headline text-primary active:bg-pressed" onClick={() => setConfirmClose(false)}>Keep Editing</button>
                </div>
              </div>
            )}
          </motion.div>
          </SheetContext.Provider>
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
          <motion.div className="absolute inset-0" style={{ background: "var(--backdrop)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.div role="alertdialog" initial={isDesktop ? { opacity: 0, scale: 0.98 } : { y: "100%" }} animate={isDesktop ? { opacity: 1, scale: 1 } : { y: 0 }} exit={isDesktop ? { opacity: 0, scale: 0.98 } : { y: "100%" }} transition={{ duration: isDesktop ? 0.2 : 0.4, ease: [0.32, 0.72, 0, 1] }} className="relative w-full max-w-[520px] p-2 pb-[max(8px,var(--safe-bottom))]">
            <div className="glass-strong rounded-xl overflow-hidden">
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
            <button type="button" className="w-full h-14 mt-2 glass-strong rounded-xl text-headline text-primary active:bg-pressed" onClick={onClose}>Cancel</button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
