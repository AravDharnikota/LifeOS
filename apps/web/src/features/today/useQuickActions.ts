import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Widget } from "@aravos/shared";
import { useAppSettings } from "@/data/queries";
import { api } from "@/lib/api";
import { selection } from "@/lib/haptics";
import { useUi } from "@/state/ui";
import type { IconName } from "@/ui/Icon";
import { toast } from "@/ui/Toast";

export type QuickAction = Extract<Widget, { type: "quick_actions" }>["actions"][number];

export const QUICK_ACTIONS: Record<QuickAction, { label: string; icon: IconName }> = {
  add_task: { label: "Add Task", icon: "plus" },
  log_meal: { label: "Log Meal", icon: "utensils" },
  add_water: { label: "Add Water", icon: "drop" },
  start_workout: { label: "Start Workout", icon: "dumbbell" },
  log_weight: { label: "Log Weight", icon: "scale" },
  add_event: { label: "Add Event", icon: "calendar" },
};

/** The one-tap actions shared by the header chips and the Quick Actions widget. */
export function useQuickActions() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setQuickAdd = useUi((s) => s.setQuickAdd);
  const imperial = useAppSettings().units === "imperial";
  const [busy, setBusy] = useState<QuickAction | null>(null);
  const [error, setError] = useState(false);

  const addWater = async () => {
    void selection();
    setBusy("add_water");
    setError(false);
    try {
      await api.post("/api/water", { ml: 250 });
      toast(imperial ? "8 oz logged." : "250 ml logged.");
      void qc.invalidateQueries({ queryKey: ["summary"] });
      void qc.invalidateQueries({ queryKey: ["water"] });
      void qc.invalidateQueries({ queryKey: ["meals"] });
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  const run = (a: QuickAction) => {
    switch (a) {
      case "log_meal": navigate("/health/nutrition?log=1"); break;
      case "start_workout": navigate("/health/workouts"); break;
      case "add_task": setQuickAdd(true); break;
      case "add_water": void addWater(); break;
      case "log_weight": navigate("/health?weight=1"); break;
      case "add_event": navigate("/calendar?new=1"); break;
    }
  };

  return { run, busy, error, retryWater: addWater };
}
