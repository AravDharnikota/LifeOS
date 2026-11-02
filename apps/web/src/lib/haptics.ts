import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNative } from "./platform";

let enabled = true;
export function setHapticsEnabled(v: boolean): void {
  enabled = v;
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
    input.style.cssText = "position:fixed;opacity:0;pointer-events:none;width:0;height:0;left:-9999px";
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.style.cssText = "position:fixed;opacity:0;pointer-events:none;width:0;height:0;left:-9999px";
    document.body.append(input, label);
    switchLabel = label;
  }
  switchLabel.click();
}

const styles = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy } as const;

/** Impact: a physical snap (check a task, snap to a detent, drag pick up). */
export async function impact(style: keyof typeof styles = "light"): Promise<void> {
  if (!enabled) return;
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
  try {
    if (isNative) await Haptics.selectionChanged();
  } catch {
    /* ignore */
  }
}

/** Notification: the outcome of a task (finished workout, rest timer done, save failed). */
export async function notify(type: "success" | "warning" | "error"): Promise<void> {
  if (!enabled) return;
  try {
    if (isNative) await Haptics.notification({ type: type === "success" ? NotificationType.Success : type === "warning" ? NotificationType.Warning : NotificationType.Error });
    else if (type === "success") webTap();
    else if (navigator.vibrate) navigator.vibrate(type === "error" ? [30, 40, 30] : 20);
  } catch {
    /* ignore */
  }
}

export const haptics = { impact, selection, notify };
