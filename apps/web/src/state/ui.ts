import { create } from "zustand";

interface UiState {
  agentOpen: boolean;
  agentPrefill: string | null;
  openAgent: (prefill?: string) => void;
  closeAgent: () => void;
  quickAddOpen: boolean;
  setQuickAdd: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  agentOpen: false,
  agentPrefill: null,
  openAgent: (prefill) => set({ agentOpen: true, agentPrefill: prefill ?? null }),
  closeAgent: () => set({ agentOpen: false, agentPrefill: null }),
  quickAddOpen: false,
  setQuickAdd: (v) => set({ quickAddOpen: v }),
}));

export function applyTheme(theme: "system" | "light" | "dark"): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
