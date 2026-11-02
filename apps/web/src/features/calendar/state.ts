import { create } from "zustand";
import type { CalEvent } from "@aravos/shared";
import { todayString } from "@aravos/shared";
import type { View } from "./model";

export interface Draft {
  /** Existing event to edit, or null for a new one. */
  event: CalEvent | null;
  start: string;
  end: string;
  allDay?: boolean;
}

interface CalendarState {
  date: string;
  view: View;
  hidden: string[];
  sheet: Draft | null;
  railOpen: boolean;
  setDate: (d: string) => void;
  setView: (v: View) => void;
  toggleCalendar: (id: string) => void;
  openSheet: (d: Draft) => void;
  closeSheet: () => void;
  setRail: (open: boolean) => void;
}

const HIDDEN_KEY = "aravos.calendar.hidden";
const VIEW_KEY = "aravos.calendar.view";

function readHidden(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "week" ? "week" : "day";
  } catch {
    return "day";
  }
}

export const useCalendar = create<CalendarState>((set, get) => ({
  date: todayString(),
  view: readView(),
  hidden: readHidden(),
  sheet: null,
  railOpen: false,
  setDate: (date) => set({ date }),
  setView: (view) => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
    set({ view });
  },
  toggleCalendar: (id) => {
    const hidden = get().hidden.includes(id) ? get().hidden.filter((h) => h !== id) : [...get().hidden, id];
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
    } catch {
      /* ignore */
    }
    set({ hidden });
  },
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
  setRail: (railOpen) => set({ railOpen }),
}));
