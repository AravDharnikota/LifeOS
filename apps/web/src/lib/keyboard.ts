import { useSyncExternalStore } from "react";
import { Keyboard } from "@capacitor/keyboard";
import { isNative, platform } from "./platform";

/*
 * Keyboard tracking.
 *
 * On iOS the Keyboard plugin used to resize the whole web view ("native" mode). That resize only lands
 * AFTER the keyboard has finished sliding up, so for ~0.5s the keyboard covered the sheet you had just
 * opened, and then the sheet jumped up. Now the web view never resizes ("none" mode in capacitor.config).
 * Instead we read the keyboard height from `keyboardWillShow`, which fires as the keyboard STARTS to
 * animate, and publish it as the CSS variable `--kb`. Sheets and bars lift by `--kb` with the same timing
 * as the keyboard (see `--kb-ease` in tokens.css), so they rise together with it.
 *
 * In a browser (PWA, desktop) the visual viewport gives the same number.
 */

let height = 0;
const subs = new Set<() => void>();

function isTextEntry(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  return !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes((el as HTMLInputElement).type);
}

/** Keep the focused field visible: scroll its own scroll container (the document itself never scrolls). */
function revealFocused(): void {
  const el = document.activeElement;
  if (!isTextEntry(el) || el.closest('[role="dialog"]')) return;
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function set(next: number): void {
  const h = Math.max(0, Math.round(next));
  if (h === height) return;
  height = h;
  const root = document.documentElement;
  root.style.setProperty("--kb", `${h}px`);
  root.classList.toggle("kb-open", h > 0);
  subs.forEach((f) => f());
  if (h > 0) requestAnimationFrame(revealFocused);
}

let installed = false;
export function installKeyboard(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  document.documentElement.style.setProperty("--kb", "0px");
  if (isNative && platform === "ios") {
    void Keyboard.setScroll({ isDisabled: true }).catch(() => undefined);
    void Keyboard.addListener("keyboardWillShow", (info) => set(info.keyboardHeight));
    void Keyboard.addListener("keyboardWillHide", () => set(0));
    return;
  }
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => set(window.innerHeight - vv.height - vv.offsetTop);
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
}

/** Current keyboard height in px (0 when hidden). */
export function useKeyboardHeight(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => height,
    () => 0,
  );
}
