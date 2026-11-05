import { useEffect, useMemo, useRef, useState } from "react";
import type { Goal, GoalCreate } from "@aravos/shared";
import { Sheet } from "@/ui/Sheet";
import { Segmented } from "@/ui/Segmented";
import { Stepper } from "@/ui/Stepper";
import { Chip } from "@/ui/Field";
import { Icon } from "@/ui/Icon";
import { notify } from "@/lib/haptics";
import { FormLabel, WellGroup, WellInput, WellRow, WellTextArea } from "./form";
import { AREAS, COLORS, COLOR_LABEL, KINDS, areaLabel, colorVar } from "./model";

type Kind = Goal["kind"];

interface Draft {
  kind: Kind;
  title: string;
  description: string;
  area: string;
  unit: string;
  startValue: string;
  targetValue: string;
  direction: "increase" | "decrease";
  cadence: "daily" | "weekly";
  timesPerPeriod: number;
  deadline: string;
  color: string | null;
  milestones: string[];
}

const numStr = (n: number | null | undefined) => (n == null ? "" : String(n));

function fromGoal(g: Goal | undefined, kind: Kind): Draft {
  return {
    kind: g?.kind ?? kind,
    title: g?.title ?? "",
    description: g?.description ?? "",
    area: g?.area ?? "life",
    unit: g?.unit ?? "",
    startValue: numStr(g?.startValue),
    targetValue: numStr(g?.targetValue),
    direction: g?.direction ?? "increase",
    cadence: g?.cadence === "weekly" ? "weekly" : "daily",
    timesPerPeriod: g?.timesPerPeriod ?? (g?.cadence === "weekly" ? 3 : 1),
    deadline: g?.deadline ?? "",
    color: g?.color ?? null,
    milestones: [],
  };
}

const parseNum = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export interface GoalSheetProps {
  open: boolean;
  onClose: () => void;
  /** Present to edit; absent to create. */
  goal?: Goal;
  initialKind?: Kind;
  /** Resolves once saved; the parent closes the sheet or navigates. Reject to show the message inline. */
  onSubmit: (input: GoalCreate, milestones: string[]) => Promise<unknown>;
  pending?: boolean;
}

/** Create and edit share this sheet. Kind is chosen once, at creation. */
export function GoalSheet({ open, onClose, goal, initialKind = "number", onSubmit, pending }: GoalSheetProps) {
  const [d, setD] = useState<Draft>(() => fromGoal(goal, initialKind));
  const [errors, setErrors] = useState<Partial<Record<"title" | "target" | "start" | "submit", string>>>({});
  const [newMilestone, setNewMilestone] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => fromGoal(goal, initialKind), [goal, initialKind]);
  const editing = Boolean(goal);

  useEffect(() => {
    if (open) {
      setD(initial);
      setErrors({});
      setNewMilestone("");
    }
  }, [open, initial]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  const submit = async () => {
    const next: typeof errors = {};
    if (!d.title.trim()) next.title = "Enter a title";
    const start = parseNum(d.startValue);
    const target = parseNum(d.targetValue);
    if (d.kind === "number") {
      if (d.startValue.trim() && start == null) next.start = "Enter a number";
      if (d.targetValue.trim() && target == null) next.target = "Enter a number";
    }
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    const input: GoalCreate = {
      title: d.title.trim(),
      description: d.description.trim() || null,
      area: d.area,
      deadline: d.deadline || null,
      color: d.color,
    };
    if (!editing) input.kind = d.kind;
    if (d.kind === "number") {
      input.unit = d.unit.trim() || null;
      input.startValue = start;
      input.targetValue = target;
      input.direction = d.direction;
    }
    if (d.kind === "habit") {
      input.cadence = d.cadence;
      input.timesPerPeriod = d.cadence === "weekly" ? d.timesPerPeriod : 1;
    }
    try {
      await onSubmit(input, d.milestones);
    } catch (e) {
      void notify("error");
      setErrors({ submit: e instanceof Error ? e.message : "Unable to save" });
    }
  };

  const addMilestone = () => {
    const t = newMilestone.trim();
    if (!t) return;
    set("milestones", [...d.milestones, t]);
    setNewMilestone("");
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit Goal" : "New Goal"}
      detent="large"
      dirty={dirty}
      initialFocus={editing ? undefined : titleRef}
      trailing={
        <button type="button" className="text-headline text-accent-text px-2 h-11 disabled:opacity-40" disabled={pending} onClick={() => void submit()} data-testid="goal-done">
          Done
        </button>
      }
    >
      <div className="pt-2 pb-4 flex flex-col gap-5">
        {!editing && <Segmented options={KINDS.map((k) => ({ value: k.value, label: k.label }))} value={d.kind} onChange={(k) => set("kind", k)} />}

        <WellGroup error={errors.title}>
          <WellInput ref={titleRef} aria-label="Title" placeholder={placeholderFor(d.kind)} value={d.title} onChange={(e) => { set("title", e.target.value); setErrors((p) => ({ ...p, title: undefined })); }} invalid={Boolean(errors.title)} enterKeyHint="done" className="[&_input]:text-[17px]" data-testid="goal-title" />
        </WellGroup>

        <div>
          <FormLabel>Area</FormLabel>
          <div className="flex gap-2 flex-wrap">
            {AREAS.map((a) => (
              <Chip key={a} selected={d.area === a} onClick={() => set("area", a)}>
                {areaLabel(a)}
              </Chip>
            ))}
          </div>
        </div>

        {d.kind === "number" && (
          <div>
            <FormLabel>Progress</FormLabel>
            <WellGroup error={errors.start ?? errors.target}>
              <WellInput label="Start" placeholder="0" inputMode="decimal" value={d.startValue} onChange={(e) => set("startValue", e.target.value)} invalid={Boolean(errors.start)} data-testid="goal-start" />
              <WellInput label="Target" placeholder="100" inputMode="decimal" value={d.targetValue} onChange={(e) => set("targetValue", e.target.value)} invalid={Boolean(errors.target)} data-testid="goal-target" />
              <WellInput label="Unit" placeholder="kg" value={d.unit} onChange={(e) => set("unit", e.target.value)} autoCapitalize="none" data-testid="goal-unit" />
              <WellRow label="Direction">
                <Segmented size="sm" options={[{ value: "increase", label: "Up" }, { value: "decrease", label: "Down" }]} value={d.direction} onChange={(v) => set("direction", v)} className="w-[132px]" />
              </WellRow>
            </WellGroup>
          </div>
        )}

        {d.kind === "habit" && (
          <div>
            <FormLabel>Schedule</FormLabel>
            <WellGroup>
              <WellRow label="Cadence">
                <Segmented size="sm" options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} value={d.cadence} onChange={(v) => set("cadence", v)} className="w-[160px]" />
              </WellRow>
              {d.cadence === "weekly" && (
                <WellRow label="Days per week">
                  <Stepper value={d.timesPerPeriod} onChange={(v) => set("timesPerPeriod", v)} min={1} max={7} editable={false} className="w-[150px]" />
                </WellRow>
              )}
            </WellGroup>
          </div>
        )}

        {d.kind === "milestone" && !editing && (
          <div>
            <FormLabel>Milestones</FormLabel>
            <WellGroup>
              {d.milestones.map((m, i) => (
                <div key={`${m}-${i}`} className="flex items-center gap-3 pl-4 pr-1 min-h-[50px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-quaternary shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0 text-[16px] text-primary truncate">{m}</span>
                  <button type="button" aria-label={`Remove ${m}`} className="hit-44 inline-flex items-center justify-center text-tertiary active:opacity-60" onClick={() => set("milestones", d.milestones.filter((_, j) => j !== i))}>
                    <Icon name="x" size={16} />
                  </button>
                </div>
              ))}
              <WellInput
                aria-label="Add a milestone"
                placeholder="Add a milestone"
                value={newMilestone}
                onChange={(e) => setNewMilestone(e.target.value)}
                enterKeyHint="next"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addMilestone();
                  }
                }}
                trailing={
                  newMilestone.trim() ? (
                    <button type="button" className="text-[15px] text-accent-text px-1 h-9 active:opacity-60" onClick={addMilestone}>
                      Add
                    </button>
                  ) : (
                    <Icon name="plus" size={18} className="text-quaternary" />
                  )
                }
              />
            </WellGroup>
          </div>
        )}

        <WellGroup>
          <WellInput label="Deadline" type="date" value={d.deadline} onChange={(e) => set("deadline", e.target.value)} data-testid="goal-deadline" />
          <WellTextArea aria-label="Notes" placeholder="Notes" value={d.description} onChange={(e) => set("description", e.target.value)} />
        </WellGroup>

        <div>
          <FormLabel>Color</FormLabel>
          <div className="flex gap-1 flex-wrap -ml-2">
            <ColorDot label="Default" selected={d.color === null} color="var(--accent)" onClick={() => set("color", null)} />
            {COLORS.map((c) => (
              <ColorDot key={c} label={COLOR_LABEL[c] ?? c} selected={d.color === c} color={colorVar(c)} onClick={() => set("color", c)} />
            ))}
          </div>
        </div>
        {errors.submit && <p className="text-footnote text-danger-text px-1">{errors.submit}</p>}
      </div>
    </Sheet>
  );
}

function ColorDot({ color, selected, onClick, label }: { color: string; selected: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-label={label} aria-pressed={selected} onClick={onClick} className="hit-44 inline-flex items-center justify-center active:opacity-70">
      <span className="w-[30px] h-[30px] rounded-full inline-flex items-center justify-center transition-[box-shadow] duration-200" style={{ boxShadow: selected ? `0 0 0 2px var(--bg-surface-2), 0 0 0 3.5px ${color}` : undefined }}>
        <span className="w-[22px] h-[22px] rounded-full" style={{ background: color }} />
      </span>
    </button>
  );
}

function placeholderFor(kind: Kind): string {
  switch (kind) {
    case "number":
      return "Read 20 books";
    case "habit":
      return "Morning run";
    case "milestone":
      return "Ship the app";
    default:
      return "Run a half marathon";
  }
}
