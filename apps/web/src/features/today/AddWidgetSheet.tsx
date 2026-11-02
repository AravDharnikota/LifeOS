import { useEffect, useState } from "react";
import { WIDGET_CATALOG, todayString, type Widget } from "@aravos/shared";
import { useGoals, useTrackers } from "@/data/queries";
import { useUi } from "@/state/ui";
import { Button } from "@/ui/Button";
import { Empty, InlineError, Skeleton } from "@/ui/Empty";
import { TextField } from "@/ui/Field";
import { Icon } from "@/ui/Icon";
import { Group, Row } from "@/ui/List";
import { Sheet } from "@/ui/Sheet";
import { STAT_LABELS } from "./widgets/Stat";
import { newWidgetId, type WidgetOf } from "./types";

type Type = Widget["type"];
const ORDER: Type[] = ["agenda", "tasks", "nutrition_rings", "water", "workout_streak", "weight_trend", "goal", "goals_overview", "habit_grid", "tracker", "quick_actions", "stat", "countdown", "note", "recent_prs"];
const NEEDS_STEP = new Set<Type>(["goal", "habit_grid", "tracker", "stat", "countdown"]);

/** Sensible defaults for every widget type. Types that need a pick (goal, tracker, metric, date) get a second step. */
export function defaultWidget(type: Type, extra: Record<string, unknown> = {}): Widget {
  const id = newWidgetId(type);
  switch (type) {
    case "agenda": return { id, type, size: "l", hours: 12 };
    case "tasks": return { id, type, size: "l", filter: "today", limit: 8 };
    case "nutrition_rings": return { id, type, size: "m" };
    case "water": return { id, type, size: "s" };
    case "workout_streak": return { id, type, size: "s" };
    case "weight_trend": return { id, type, size: "s", days: 30 };
    case "goal": return { id, type, size: "s", goalId: String(extra.goalId ?? "") };
    case "goals_overview": return { id, type, size: "l", limit: 5 };
    case "tracker": return { id, type, size: "s", trackerId: String(extra.trackerId ?? "") };
    case "habit_grid": return { id, type, size: "m", goalId: String(extra.goalId ?? ""), weeks: 12 };
    case "note": return { id, type, size: "m", text: "" };
    case "quick_actions": return { id, type, size: "l", actions: ["log_meal", "start_workout", "add_task", "add_water"] };
    case "stat": return { id, type, size: "s", metric: (extra.metric as WidgetOf<"stat">["metric"]) ?? "open_tasks" };
    case "countdown": return { id, type, size: "s", date: String(extra.date ?? todayString()), label: String(extra.label ?? "Countdown") };
    case "recent_prs": return { id, type, size: "m", limit: 5 };
  }
}

export function AddWidgetSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (widget: Widget) => Promise<void> }) {
  const [step, setStep] = useState<Type | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setStep(null);
      setError(null);
    }
  }, [open]);

  const add = async (widget: Widget) => {
    setBusy(true);
    setError(null);
    try {
      await onAdd(widget);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to add widget.");
    } finally {
      setBusy(false);
    }
  };

  const title = step ? WIDGET_CATALOG[step]?.label ?? "Add Widget" : "Add Widget";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      detent="large"
      leading={step ? (
        <button type="button" className="text-body text-accent-text h-11 px-2 inline-flex items-center gap-0.5 -ml-1" onClick={() => setStep(null)}>
          <Icon name="chevron-left" size={22} />
          Back
        </button>
      ) : undefined}
    >
      {error && <InlineError onRetry={() => setError(null)}>{error}</InlineError>}
      {step === null ? (
        <Group inset={false} className="mt-2 mb-4">
          {ORDER.map((t) => {
            const entry = WIDGET_CATALOG[t];
            if (!entry) return null;
            return (
              <Row
                key={t}
                title={entry.label}
                subtitle={entry.description}
                chevron={NEEDS_STEP.has(t)}
                disabled={busy}
                onPress={() => (NEEDS_STEP.has(t) ? setStep(t) : void add(defaultWidget(t)))}
                data-add-widget={t}
              />
            );
          })}
        </Group>
      ) : step === "goal" || step === "habit_grid" ? (
        <GoalPicker habits={step === "habit_grid"} busy={busy} onPick={(goalId) => void add(defaultWidget(step, { goalId }))} />
      ) : step === "tracker" ? (
        <TrackerPicker busy={busy} onPick={(trackerId) => void add(defaultWidget("tracker", { trackerId }))} />
      ) : step === "stat" ? (
        <Group inset={false} className="mt-2 mb-4">
          {(Object.keys(STAT_LABELS) as WidgetOf<"stat">["metric"][]).map((m) => (
            <Row key={m} title={STAT_LABELS[m]} disabled={busy} onPress={() => void add(defaultWidget("stat", { metric: m }))} />
          ))}
        </Group>
      ) : step === "countdown" ? (
        <CountdownForm busy={busy} onSubmit={(label, date) => void add(defaultWidget("countdown", { label, date }))} />
      ) : null}
    </Sheet>
  );
}

function GoalPicker({ habits, busy, onPick }: { habits: boolean; busy: boolean; onPick: (id: string) => void }) {
  const goals = useGoals("active");
  const openAgent = useUi((s) => s.openAgent);
  const list = (goals.data ?? []).filter((g) => (habits ? g.kind === "habit" : true));
  if (goals.isPending) return <Skeleton rows={3} className="mx-0 mt-2" />;
  if (goals.isError) return <InlineError onRetry={() => void goals.refetch()}>Unable to load goals.</InlineError>;
  if (list.length === 0)
    return (
      <Empty action={<Button variant="plain" onClick={() => openAgent(habits ? "Add a daily habit to " : "Add a goal to ")}>Ask Assistant</Button>}>
        {habits ? "No habits yet." : "No active goals."}
      </Empty>
    );
  return (
    <Group inset={false} className="mt-2 mb-4">
      {list.map((g) => (
        <Row key={g.id} title={g.title} subtitle={g.kind === "habit" ? `${g.cadence ?? "daily"} habit` : g.unit ? `${g.currentValue ?? 0} of ${g.targetValue ?? 0} ${g.unit}` : g.kind} disabled={busy} onPress={() => onPick(g.id)} />
      ))}
    </Group>
  );
}

function TrackerPicker({ busy, onPick }: { busy: boolean; onPick: (id: string) => void }) {
  const trackers = useTrackers();
  const openAgent = useUi((s) => s.openAgent);
  if (trackers.isPending) return <Skeleton rows={3} className="mx-0 mt-2" />;
  if (trackers.isError) return <InlineError onRetry={() => void trackers.refetch()}>Unable to load trackers.</InlineError>;
  if (!trackers.data?.length)
    return (
      <Empty action={<Button variant="plain" onClick={() => openAgent("Add a counter for ")}>Ask Assistant</Button>}>No trackers yet.</Empty>
    );
  return (
    <Group inset={false} className="mt-2 mb-4">
      {trackers.data.map((t) => (
        <Row key={t.id} title={t.name} subtitle={t.target != null ? `Target ${t.target}${t.unit ? ` ${t.unit}` : ""}, resets ${t.reset}` : `Resets ${t.reset}`} disabled={busy} onPress={() => onPick(t.id)} />
      ))}
    </Group>
  );
}

function CountdownForm({ busy, onSubmit }: { busy: boolean; onSubmit: (label: string, date: string) => void }) {
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const valid = label.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <form
      className="flex flex-col gap-4 pt-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(label.trim(), date);
      }}
    >
      <TextField label="Label" placeholder="Trip to Lisbon" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} autoFocus />
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="[&_input]:tabular" />
      <Button type="submit" variant="primary" size="lg" full disabled={!valid} loading={busy}>
        Add Widget
      </Button>
    </form>
  );
}
