import { create } from "zustand";
import type { Task } from "@aravos/shared";

export interface GridApi {
  locate: (x: number, y: number) => { date: string; dayIdx: number; startMin: number } | null;
  drop: (task: Task, date: string, startMin: number, duration: number) => void;
}

export interface DragHover {
  task: Task;
  date: string;
  dayIdx: number;
  startMin: number;
  duration: number;
}

interface TaskDragState {
  api: GridApi | null;
  task: Task | null;
  point: { x: number; y: number } | null;
  hover: DragHover | null;
  register: (api: GridApi) => () => void;
  begin: (task: Task, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: () => boolean;
  cancel: () => void;
}

/** Pointer-based drag from the task rail onto the grid. The grid registers a hit-tester; the rail drives it. */
export const useTaskDrag = create<TaskDragState>((set, get) => ({
  api: null,
  task: null,
  point: null,
  hover: null,
  register: (api) => {
    set({ api });
    return () => {
      if (get().api === api) set({ api: null });
    };
  },
  begin: (task, x, y) => set({ task, point: { x, y }, hover: null }),
  move: (x, y) => {
    const { task, api } = get();
    if (!task) return;
    const loc = api?.locate(x, y) ?? null;
    const duration = Math.max(15, task.estimateMinutes ?? 30);
    const prev = get().hover;
    const hover = loc ? { task, ...loc, duration } : null;
    if (prev?.startMin === hover?.startMin && prev?.dayIdx === hover?.dayIdx && Boolean(prev) === Boolean(hover)) {
      set({ point: { x, y } });
      return;
    }
    set({ point: { x, y }, hover });
  },
  end: () => {
    const { hover, api, task } = get();
    set({ task: null, point: null, hover: null });
    if (hover && api && task) {
      api.drop(task, hover.date, hover.startMin, hover.duration);
      return true;
    }
    return false;
  },
  cancel: () => set({ task: null, point: null, hover: null }),
}));
