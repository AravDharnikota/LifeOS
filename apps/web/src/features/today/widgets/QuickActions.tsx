import { cn } from "@/lib/cn";
import { Icon } from "@/ui/Icon";
import { Spinner } from "@/ui/Spinner";
import { QUICK_ACTIONS, useQuickActions, type QuickAction } from "../useQuickActions";
import type { WidgetOf, WidgetProps } from "../types";
import { WidgetLabel, WriteError } from "./shared";

/** A grid of white pills, icon plus label. Each is one tap to the thing it names. */
export function QuickActionsWidget({ widget, editing }: WidgetProps<WidgetOf<"quick_actions">>) {
  const { run, busy, error, retryWater } = useQuickActions();
  const actions = widget.actions.length ? widget.actions : (["log_meal", "start_workout", "add_task"] as QuickAction[]);
  return (
    <>
      {widget.title && <WidgetLabel>{widget.title}</WidgetLabel>}
      <div className={cn("grid gap-2", actions.length <= 2 ? "grid-cols-2" : "grid-cols-2 min-[430px]:grid-cols-3", actions.length > 3 && "lg:grid-cols-6")}>
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            disabled={editing || busy === a}
            onClick={() => !editing && run(a)}
            className="h-11 px-3 rounded-full well inline-flex items-center justify-center gap-2 text-[14px] text-primary whitespace-nowrap active:bg-pressed pressable-spring disabled:opacity-40 min-w-0"
          >
            <span className="text-secondary shrink-0">{busy === a ? <Spinner size={14} /> : <Icon name={QUICK_ACTIONS[a].icon} size={16} strokeWidth={1.8} />}</span>
            <span className="truncate">{QUICK_ACTIONS[a].label}</span>
          </button>
        ))}
      </div>
      {error && <WriteError message="Unable to log water." onRetry={() => void retryWater()} />}
    </>
  );
}
