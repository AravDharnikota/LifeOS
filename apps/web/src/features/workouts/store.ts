import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Rest timer. `endsAt` is an epoch timestamp so a reload (or a route change) restores the countdown.
 * The completion side effects (haptic, sound, toast) live in RestTimerHost, mounted once under WorkoutsRoutes.
 */
interface RestTimerState {
  endsAt: number | null;
  total: number;
  hint: string | null;
  muted: boolean;
  sheetOpen: boolean;
  start: (seconds: number, hint?: string | null) => void;
  adjust: (deltaSeconds: number) => void;
  skip: () => void;
  setSheetOpen: (v: boolean) => void;
  setMuted: (v: boolean) => void;
}

export const useRestTimer = create<RestTimerState>()(
  persist(
    (set, get) => ({
      endsAt: null,
      total: 0,
      hint: null,
      muted: false,
      sheetOpen: false,
      start: (seconds, hint = null) => {
        if (seconds <= 0) {
          set({ endsAt: null, total: 0, hint: null });
          return;
        }
        set({ endsAt: Date.now() + seconds * 1000, total: seconds, hint });
      },
      adjust: (delta) => {
        const { endsAt, total } = get();
        if (!endsAt) return;
        const next = Math.max(Date.now() + 1000, endsAt + delta * 1000);
        set({ endsAt: next, total: Math.max(1, total + delta) });
      },
      skip: () => set({ endsAt: null, total: 0, hint: null, sheetOpen: false }),
      setSheetOpen: (v) => set({ sheetOpen: v }),
      setMuted: (v) => set({ muted: v }),
    }),
    { name: "aravos.workouts.rest", partialize: (s) => ({ endsAt: s.endsAt, total: s.total, hint: s.hint, muted: s.muted }) },
  ),
);

/** Seconds left on the rest timer (0 when idle), ticking four times a second while running. */
export function useRestRemaining(): number {
  const endsAt = useRestTimer((s) => s.endsAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [endsAt]);
  // Derived during render so the first paint after start() already shows the full countdown.
  return endsAt ? Math.max(0, Math.ceil((endsAt - Math.max(now, Date.now() - 300)) / 1000)) : 0;
}

/** Which set input has focus, shared between the set table and the keyboard accessory. */
interface FocusState {
  focused: { setId: string; field: "weight" | "reps" | "distance" | "seconds" } | null;
  setFocused: (f: FocusState["focused"]) => void;
}
export const useSetFocus = create<FocusState>((set) => ({ focused: null, setFocused: (focused) => set({ focused }) }));
