import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { selection } from "@/lib/haptics";
import { useUi } from "@/state/ui";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/Toast";
import type { WidgetOf, WidgetProps } from "../types";
import { WidgetLabel, WriteError } from "./shared";

type Action = WidgetOf<"quick_actions">["actions"][number];
const LABELS: Record<Action, string> = { log_meal: "Log Meal", start_workout: "Start Workout", add_task: "Add Task", add_water: "Add Water", log_weight: "Log Weight", add_event: "Add Event" };

/** A row of plain secondary buttons. Each is one tap to the thing it names. */
export function QuickActionsWidget({ widget, editing }: WidgetProps<WidgetOf<"quick_actions">>) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setQuickAdd = useUi((s) => s.setQuickAdd);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState(false);

  const addWater = async () => {
    void selection();
    setBusy("add_water");
    setError(false);
    try {
      await api.post("/api/water", { ml: 250 });
      toast("250 ml logged.");
      void qc.invalidateQueries({ queryKey: ["summary"] });
      void qc.invalidateQueries({ queryKey: ["water"] });
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  const run = (a: Action) => {
    if (editing) return;
    switch (a) {
      case "log_meal": navigate("/health/nutrition?log=1"); break;
      case "start_workout": navigate("/health/workouts"); break;
      case "add_task": setQuickAdd(true); break;
      case "add_water": void addWater(); break;
      case "log_weight": navigate("/health?weight=1"); break;
      case "add_event": navigate("/calendar?new=1"); break;
    }
  };

  const actions = widget.actions.length ? widget.actions : (["log_meal", "start_workout", "add_task"] as Action[]);
  return (
    <>
      {widget.title && <WidgetLabel>{widget.title}</WidgetLabel>}
      <div className={cn("grid gap-2", actions.length <= 2 ? "grid-cols-2" : "grid-cols-2 min-[430px]:grid-cols-3", actions.length > 3 && "lg:grid-cols-6")}>
        {actions.map((a) => (
          <Button key={a} variant="secondary" size="md" className="px-2 text-subhead font-semibold" loading={busy === a} disabled={editing} onClick={() => run(a)}>
            {LABELS[a]}
          </Button>
        ))}
      </div>
      {error && <WriteError message="Unable to log water." onRetry={() => void addWater()} />}
    </>
  );
}
