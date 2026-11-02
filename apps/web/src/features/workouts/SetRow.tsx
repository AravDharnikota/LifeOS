import { useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import type { ExerciseCategory, WorkoutSet } from "@aravos/shared";
import { Icon } from "@/ui/Icon";
import { cn } from "@/lib/cn";
import { impact } from "@/lib/haptics";
import { hasFinePointer } from "@/lib/platform";
import { fieldText, parseField, setLabel, type ColumnKind, type ColumnSpec, type SetValues, type Units } from "./lib";
import { useSetFocus } from "./store";

export interface SetRowProps {
  set: WorkoutSet;
  index: number;
  sets: WorkoutSet[];
  columns: ColumnSpec[];
  grid: string;
  previous: SetValues | null;
  category: ExerciseCategory;
  units: Units;
  /** Templates have no check column. */
  checkable?: boolean;
  onChangeValue: (kind: ColumnKind, value: number | null) => void;
  onCommit: () => void;
  onToggleComplete?: () => void;
  onDelete: () => void;
  onSetType: (anchor: { x: number; y: number }) => void;
  onCopyPrevious?: () => void;
}

const SWIPE_W = 72;

/** Focus the next value input in document order (Enter on desktop, Next on the keyboard accessory). */
export function focusNextInput(from?: Element | null): boolean {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input.wk-input"));
  const i = from ? inputs.indexOf(from as HTMLInputElement) : -1;
  const next = inputs[i + 1];
  if (!next) return false;
  next.focus();
  next.select();
  return true;
}

/**
 * One set: number or type tag, ghost previous, value inputs, check. 44px tall, tabular digits.
 * Swipe left (touch) reveals Delete; a full swipe commits with a medium impact. Desktop shows a trash glyph on hover.
 */
export function SetRow({ set, index, sets, columns, grid, previous, category, units, checkable = true, onChangeValue, onCommit, onToggleComplete, onDelete, onSetType, onCopyPrevious }: SetRowProps) {
  const x = useMotionValue(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const label = setLabel(sets, index);
  const prevText = previous ? fieldTextAll(previous, columns, units) : "";
  const tagClass = `wk-tag wk-tag-${set.setType}`;

  const onDragEnd = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    const width = rowRef.current?.clientWidth ?? 300;
    if (info.offset.x < -width * 0.55 || info.velocity.x < -900) {
      void impact("medium");
      animate(x, -width, { duration: 0.15 }).then(onDelete);
    } else if (info.offset.x < -SWIPE_W / 2) {
      animate(x, -SWIPE_W, { type: "spring", stiffness: 158, damping: 20.7 });
    } else {
      animate(x, 0, { type: "spring", stiffness: 158, damping: 20.7 });
    }
  };

  return (
    <div ref={rowRef} className="relative overflow-hidden" data-testid="set-row" data-completed={set.completed ? "true" : "false"} data-set-type={set.setType}>
      {!hasFinePointer && (
        <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width: SWIPE_W }}>
          <button type="button" className="wk-swipe-bg flex-1 text-footnote font-semibold" onClick={() => { void impact("medium"); onDelete(); }}>Delete</button>
        </div>
      )}
      <motion.div
        drag={hasFinePointer ? false : "x"}
        dragConstraints={{ left: -SWIPE_W, right: 0 }}
        dragElastic={{ left: 0.4, right: 0 }}
        dragDirectionLock
        onDragEnd={onDragEnd}
        style={{ x, gridTemplateColumns: grid }}
        className={cn("wk-grid relative px-[var(--gutter)] bg-surface group", set.completed && "wk-set-done")}
      >
        <button type="button" tabIndex={-1} aria-label={`Set ${label || set.setType}, change type`} className="h-11 w-10 -ml-1 inline-flex items-center justify-center" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onSetType({ x: r.left + r.width / 2, y: r.bottom }); }}>
          <span className={cn("inline-flex items-center justify-center min-w-[28px] h-7 px-1 rounded-sm bg-surface-2 text-footnote", tagClass)}>{label}</span>
        </button>
        <button type="button" tabIndex={-1} className={cn("h-11 text-left text-footnote tabular truncate min-w-0 flex items-center gap-1.5", prevText ? "text-tertiary active:text-primary" : "text-quaternary")} onClick={() => prevText && onCopyPrevious?.()} disabled={!prevText} aria-label={prevText ? `Previous ${prevText}, copy into this set` : "No previous set"}>
          <span className="truncate">{prevText || "–"}</span>
          {set.prs.length > 0 && <Icon name="trophy" size={14} className="text-warning-text shrink-0" data-testid="pr-badge" />}
        </button>
        {columns.map((c) => (
          <ValueCell key={c.kind} setId={set.id} kind={c.kind} value={set} units={units} placeholder={previous ? fieldText(previous, c.kind, units) : c.kind === "seconds" ? "0:00" : "0"} onChange={(v) => onChangeValue(c.kind, v)} onCommit={onCommit} />
        ))}
        {checkable ? (
          <button type="button" tabIndex={-1} role="checkbox" aria-checked={set.completed} aria-label={set.completed ? "Mark set incomplete" : "Complete set"} className="h-11 w-11 -mr-1 inline-flex items-center justify-center" onClick={onToggleComplete} data-testid="set-check">
            <span className={cn("wk-check", set.completed && "wk-check-on")}>
              <Icon name="check" size={18} strokeWidth={2.2} />
            </span>
          </button>
        ) : (
          <span className="h-11 w-11 -mr-1 inline-flex items-center justify-center text-quaternary"><Icon name="lock" size={16} /></span>
        )}
        {hasFinePointer && (
          <button type="button" tabIndex={-1} aria-label="Delete set" className="h-11 w-8 -mr-2 inline-flex items-center justify-center text-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150" onClick={onDelete}>
            <Icon name="x" size={16} />
          </button>
        )}
      </motion.div>
    </div>
  );
}

function fieldTextAll(v: SetValues, columns: ColumnSpec[], units: Units): string {
  const parts = columns.map((c) => fieldText(v, c.kind, units));
  if (parts.every((p) => !p)) return "";
  if (columns.length === 2 && columns[0]!.kind === "weight") return `${parts[0] || "0"} × ${parts[1] || "0"}`;
  return parts.filter(Boolean).join(" | ");
}

/** One numeric input. Keeps a local draft so a server round-trip never clobbers what is being typed. */
function ValueCell({ setId, kind, value, units, placeholder, onChange, onCommit }: { setId: string; kind: ColumnKind; value: SetValues; units: Units; placeholder: string; onChange: (v: number | null) => void; onCommit: () => void }) {
  const text = fieldText(value, kind, units);
  const [draft, setDraft] = useState(text);
  const setFocused = useSetFocus((s) => s.setFocused);
  useEffect(() => {
    const a = parseField(draft, kind, units);
    const b = parseField(text, kind, units);
    const same = (a == null && b == null) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 0.011);
    if (!same) setDraft(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <input
      className="wk-input num"
      type="text"
      inputMode={kind === "reps" ? "numeric" : "decimal"}
      enterKeyHint="next"
      autoComplete="off"
      placeholder={placeholder}
      value={draft}
      aria-label={kind}
      data-field={kind}
      data-set={setId}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        const parsed = parseField(v, kind, units);
        if (parsed !== undefined) onChange(parsed);
      }}
      onFocus={(e) => {
        setFocused({ setId, field: kind });
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onBlur={() => {
        setFocused(null);
        setDraft(text);
        onCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (!focusNextInput(e.currentTarget)) e.currentTarget.blur();
        }
      }}
    />
  );
}
