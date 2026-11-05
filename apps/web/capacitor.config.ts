/// <reference types="@capacitor/keyboard" />
import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

// The iOS app loads the web build from `dist` and talks to the server at
// `ARAVOS_SERVER_URL` (set in the app's Settings screen on first launch).
const config: CapacitorConfig = {
  appId: "com.arav.aravos",
  appName: "AravOS",
  webDir: "dist",
  ios: {
    contentInset: "never",
    backgroundColor: "#f6f4ef",
    preferredContentMode: "mobile",
    // The document never scrolls (every screen has its own scroller). Disabling web view scrolling also stops
    // iOS from shifting the whole page when a field is focused.
    scrollEnabled: false,
    allowsLinkPreview: false,
  },
  plugins: {
    StatusBar: { style: "DEFAULT", overlaysWebView: true },
    // "none": the web view is not resized when the keyboard shows (the native resize lands late, after the
    // keyboard animation). The app lifts sheets itself using the keyboard height; see src/lib/keyboard.ts.
    Keyboard: { resize: KeyboardResize.None, resizeOnFullScreen: true },
  },
};

export default config;
