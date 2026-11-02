import type { CapacitorConfig } from "@capacitor/cli";

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
    scrollEnabled: true,
    allowsLinkPreview: false,
  },
  plugins: {
    StatusBar: { style: "DEFAULT", overlaysWebView: true },
    Keyboard: { resize: "native", resizeOnFullScreen: true },
  },
};

export default config;
