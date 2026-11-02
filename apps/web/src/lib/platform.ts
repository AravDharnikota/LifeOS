import { Capacitor } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // "ios" | "android" | "web"
export const isIOSDevice = /iPhone|iPad|iPod/.test(typeof navigator === "undefined" ? "" : navigator.userAgent) || isNative;
export const isStandalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
export const hasFinePointer = typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
export const isAppleOS = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? navigator.userAgent);
