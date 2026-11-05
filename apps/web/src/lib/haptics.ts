import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNative } from "./platform";

let enabled = true;
export function setHapticsEnabled(v: boolean): void {
  enabled = v;
}

/** Time of the last haptic, so the global tap haptic never doubles a specific one. */
let lastFired = 0;
function mark(): void {
  lastFired = performance.now();
}

// Safari fallback: a hidden switch-style checkbox whose label click plays one system tap (iOS 17.4+).
let switchLabel: HTMLLabelElement | null = null;
function webTap(): void {
  if (typeof document === "undefined") return;
  if (!switchLabel) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.id = "aravos-haptic-switch";
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    input.style.cssText = "position:fixed;opacity:0;pointer-events:none;width:0;height:0;left:-9999px";
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.style.cssText = "position:fixed;opacity:0;pointer-events:none;width:0;height:0;left:-9999px";
    document.body.append(input, label);
    switchLabel = label;
  }
  // Clicking the label moves focus to the hidden switch. Put focus back so a tap never steals it from a field.
  const prev = document.activeElement as HTMLElement | null;
  switchLabel.click();
  if (prev && prev !== document.activeElement && prev !== document.body) prev.focus({ preventScroll: true });
  else if (document.activeElement?.id === "aravos-haptic-switch") (document.activeElement as HTMLElement).blur();
}

const styles = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy } as const;

/** Impact: a physical snap (check a task, snap to a detent, drag pick up). */
export async function impact(style: keyof typeof styles = "light"): Promise<void> {
  if (!enabled) return;
  mark();
  try {
    if (isNative) await Haptics.impact({ style: styles[style] });
    else if (style === "light") webTap();
    else if (navigator.vibrate) navigator.vibrate(10);
  } catch {
    /* no haptics available */
  }
}

/** Selection: a value is changing (stepper tick, segmented control, scrubbing). */
let lastSelection = 0;
export async function selection(): Promise<void> {
  if (!enabled) return;
  const now = performance.now();
  if (now - lastSelection < 30) return;
  lastSelection = now;
  mark();
  try {
    if (isNative) await Haptics.selectionChanged();
  } catch {
    /* ignore */
  }
}

/** Notification: the outcome of a task (finished workout, rest timer done, save failed). */
export async function notify(type: "success" | "warning" | "error"): Promise<void> {
  if (!enabled) return;
  mark();
  try {
    if (isNative) await Haptics.notification({ type: type === "success" ? NotificationType.Success : type === "warning" ? NotificationType.Warning : NotificationType.Error });
    else if (type === "success") webTap();
    else if (navigator.vibrate) navigator.vibrate(type === "error" ? [30, 40, 30] : 20);
  } catch {
    /* ignore */
  }
}

export const haptics = { impact, selection, notify };

const TAPPABLE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="option"], summary, select';

/**
 * One light tap for every press in the app: buttons, tabs, links, rows, menu items.
 * Listens on document in the bubble phase, so it runs after React's handlers (React listens on #root).
 * If a handler already played a haptic during this click, this one skips. Opt out with data-haptic="off".
 * Uses `click`, not `pointerdown`, so starting a scroll on a row never buzzes.
 */
export function installGlobalHaptics(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const onClick = (e: MouseEvent) => {
    if (!enabled) return;
    const target = e.target instanceof Element ? e.target.closest(TAPPABLE) : null;
    if (!target || target.closest('[data-haptic="off"]')) return;
    if ((target as HTMLButtonElement).disabled || target.getAttribute("aria-disabled") === "true") return;
    if (performance.now() - lastFired < 120) return;
    if (target.getAttribute("role") === "option" || target.tagName === "SELECT") void selection();
    else void impact("light");
  };
  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
