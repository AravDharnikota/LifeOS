import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar, Style } from "@capacitor/status-bar";
import "@fontsource-variable/outfit";
import "./styles/base.css";
import { router } from "./app/router";
import { Connect } from "./app/Connect";
import { Toaster } from "./ui/Toast";
import { useAuth } from "./state/auth";
import { applyTheme } from "./state/ui";
import { useSettings } from "./data/queries";
import { installGlobalHaptics, setHapticsEnabled } from "./lib/haptics";
import { installKeyboard } from "./lib/keyboard";
import { isNative } from "./lib/platform";
import { ApiError } from "./lib/api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});

function ThemeSync() {
  const { data } = useSettings();
  useEffect(() => {
    if (!data) return;
    applyTheme(data.app.theme);
    setHapticsEnabled(data.app.haptics);
    if (isNative) {
      const dark = data.app.theme === "dark" || (data.app.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
    }
  }, [data]);
  return null;
}

function App() {
  const status = useAuth((s) => s.status);
  const boot = useAuth((s) => s.boot);
  useEffect(() => {
    void boot();
  }, [boot]);
  if (status === "booting") return <div className="min-h-dvh bg-canvas" />;
  if (status !== "ready") return <Connect />;
  return (
    <>
      <ThemeSync />
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}

installGlobalHaptics();
installKeyboard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
